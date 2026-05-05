#!/usr/bin/env python3
"""
Train Phase 10 design head — adds text-intent encoding alongside DINOv2.

Why
  v8 (DINOv2 vision only) reached val_loss 0.0189 best, with big wins on
  abstract dims (innovation, distinctiveness) but slight regressions on
  Norman-craft dims (color, behavioral, reflective).  The model still
  doesn't know WHAT is being designed — a music player and a settings
  panel get judged by the same yardstick.  Phase 10 fixes this by giving
  the model the design intent as a third input stream.

Architecture vs v8
  vis_proj   nn.Linear(768, 384)          — DINOv2 ViT-B/14 CLS
  text_proj  nn.Linear(384, 128)  ← NEW   — MiniLM brief embedding
  code_proj  nn.Linear(64, 128)           — code-feature signal
  concat (384+128+128 = 640) → fc1 → fc2 → fc3 → 64-dim trunk → 4 heads

The text embedding comes from data/text_embeddings.npz, populated by
extract_text.py: a frozen 22M-param MiniLM L6 sentence-transformer
embeds each sample's brief / category / source_name composite.  At
inference, the server runs the same MiniLM live on whatever brief
the caller passes (default "unknown design" if omitted).

Heads carried from v8 unchanged
  Phase 5  critique-embedding aux head (cosine distance loss, weight 0.02)
  Phase 6  heteroscedastic uncertainty (Gaussian NLL, log_var clipped)
  Phase 8  per-dim Bradley-Terry preference, real_pair_weight=5
"""

import argparse
import json
import math
import re
import time
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
from mlx.utils import tree_flatten, tree_map
import numpy as np


DATA_DIR = Path(__file__).parent.parent / "data"
WEIGHTS_DIR = Path(__file__).parent.parent / "weights"
MANIFEST_PATH = DATA_DIR / "manifest.json"
COMPARISONS_PATH = DATA_DIR / "comparisons.json"
CRITIQUE_EMBEDDINGS_PATH = DATA_DIR / "critique_embeddings.npz"
TEXT_EMBEDDINGS_PATH = DATA_DIR / "text_embeddings.npz"

V8_WEIGHTS_PATH = WEIGHTS_DIR / "design-head-v8.safetensors"
V9_WEIGHTS_PATH = WEIGHTS_DIR / "design-head-v9.safetensors"

VISUAL_DIM = 768   # DINOv2 ViT-B/14 hidden size
TEXT_DIM = 384     # MiniLM L6 hidden size
OUTPUT_DIM = 16
CRITIQUE_DIM = 3072
MIN_AUX_SAMPLES = 20

DEFAULT_AUX_WEIGHT = 0.02
DEFAULT_PREF_WEIGHT = 0.2
DEFAULT_NLL_WEIGHT = 1.0
DEFAULT_PAIR_MARGIN = 0.10
DEFAULT_PAIR_DIM_MARGIN = 0.05
DEFAULT_MAX_SYNTH_PAIRS = 2000
DEFAULT_ADAPTER_RANK = 64
DEFAULT_ADAPTER_ALPHA = 0.05
DEFAULT_REAL_PAIR_WEIGHT = 5.0
# Drop text 10% of the time so the model handles the no-brief inference case
DEFAULT_TEXT_DROPOUT = 0.10

SCORE_NAMES = [
    "typography_quality", "color_harmony", "spatial_composition",
    "motion_elegance", "emotional_resonance", "craft_visibility",
    "minimalism_coherence", "native_integration",
    "visceral_score", "behavioral_score", "reflective_score",
    "overall_aesthetic",
    "innovation_score", "system_creativity", "design_distinctiveness",
    "problem_level",
]

DIMENSION_WEIGHTS = mx.array([
    1.2, 1.1, 1.1, 0.9, 1.3, 1.2, 1.0, 1.0,
    1.2, 1.0, 1.1, 1.5,
    1.4, 1.3, 1.2, 1.1,
], dtype=mx.float32)


# ═══════════════════════════════════════════════════
# DESIGN HEAD V9 — DINOv2 vision + MiniLM text + code → 4 heads
# ═══════════════════════════════════════════════════


class FeatureAdapter(nn.Module):
    """LoRA-style residual on cached DINOv2 features (carried from v8)."""

    def __init__(self, dim: int = VISUAL_DIM, rank: int = DEFAULT_ADAPTER_RANK,
                 init_alpha: float = DEFAULT_ADAPTER_ALPHA):
        super().__init__()
        self.up = nn.Linear(dim, rank)
        self.down = nn.Linear(rank, dim)
        self.alpha = mx.array(init_alpha, dtype=mx.float32)

    def __call__(self, x):
        return x + self.alpha * self.down(nn.gelu(self.up(x)))


class DesignHeadV9(nn.Module):
    """v8 head + text-intent stream."""

    def __init__(self, dropout: float = 0.5,
                 critique_dim: int = CRITIQUE_DIM,
                 adapter_rank: int = DEFAULT_ADAPTER_RANK,
                 adapter_alpha: float = DEFAULT_ADAPTER_ALPHA,
                 enable_adapter: bool = True):
        super().__init__()

        self.enable_adapter = enable_adapter

        if enable_adapter:
            self.adapter = FeatureAdapter(VISUAL_DIM, adapter_rank, adapter_alpha)

        # ── three input streams ──
        self.vis_proj = nn.Linear(VISUAL_DIM, 384)
        self.vis_norm = nn.LayerNorm(384)

        self.text_proj = nn.Linear(TEXT_DIM, 128)
        self.text_norm = nn.LayerNorm(128)

        self.code_proj = nn.Linear(64, 128)
        self.code_norm = nn.LayerNorm(128)

        # ── shared trunk ──
        input_dim = 384 + 128 + 128  # vis + text + code
        self.fc1 = nn.Linear(input_dim, 256)
        self.ln1 = nn.LayerNorm(256)
        self.drop1 = nn.Dropout(dropout)

        self.fc2 = nn.Linear(256, 128)
        self.ln2 = nn.LayerNorm(128)
        self.drop2 = nn.Dropout(dropout * 0.8)

        self.fc3 = nn.Linear(128, 64)
        self.ln3 = nn.LayerNorm(64)
        self.drop3 = nn.Dropout(dropout * 0.6)

        # ── output heads ──
        self.output = nn.Linear(64, OUTPUT_DIM)
        self.log_var = nn.Linear(64, OUTPUT_DIM)

        # Phase 5 critique aux head
        self.aux_fc1 = nn.Linear(64, 256)
        self.aux_fc2 = nn.Linear(256, 512)
        self.aux_out = nn.Linear(512, critique_dim)

        # Phase 8 preference head
        self.pref_head = nn.Linear(64, OUTPUT_DIM)

    def trunk(self, visual_features, text_features=None, code_features=None):
        """Run trunk → 64-dim representation."""
        x = visual_features
        if self.enable_adapter and hasattr(self, "adapter"):
            x = self.adapter(x)
        v = self.drop1(nn.gelu(self.vis_norm(self.vis_proj(x))))

        batch_size = v.shape[0]
        if text_features is None:
            t = mx.zeros((batch_size, 128))
        else:
            t = nn.gelu(self.text_norm(self.text_proj(text_features)))

        if code_features is None:
            c = mx.zeros((batch_size, 128))
        else:
            c = nn.gelu(self.code_norm(self.code_proj(code_features)))

        h = mx.concatenate([v, t, c], axis=-1)
        h = self.drop1(nn.gelu(self.ln1(self.fc1(h))))
        h = self.drop2(nn.gelu(self.ln2(self.fc2(h))))
        return self.drop3(nn.gelu(self.ln3(self.fc3(h))))

    def __call__(self, visual_features, text_features=None, code_features=None,
                 return_aux: bool = False, return_uncertainty: bool = False,
                 return_preference: bool = False):
        h64 = self.trunk(visual_features, text_features, code_features)
        scores = mx.sigmoid(self.output(h64))
        out = [scores]
        if return_uncertainty:
            out.append(self.log_var(h64))
        if return_aux:
            aux = nn.gelu(self.aux_fc1(h64))
            aux = nn.gelu(self.aux_fc2(aux))
            out.append(self.aux_out(aux))
        if return_preference:
            out.append(self.pref_head(h64))
        return out[0] if len(out) == 1 else tuple(out)

    def param_count(self):
        return sum(p.size for _, p in tree_flatten(self.parameters()))


# ═══════════════════════════════════════════════════
# CRITIQUE EMBEDDING LOOKUP
# ═══════════════════════════════════════════════════


def load_critique_embeddings():
    if not CRITIQUE_EMBEDDINGS_PATH.exists():
        return {}
    try:
        with np.load(CRITIQUE_EMBEDDINGS_PATH) as npz:
            cycle_ids = npz["cycle_ids"].tolist()
            embeddings = npz["embeddings"]
            if len(cycle_ids) != embeddings.shape[0]:
                return {}
            return {int(cid): embeddings[i] for i, cid in enumerate(cycle_ids)}
    except Exception:
        return {}


_CYCLE_RE = re.compile(r"(?:self[-_]train[-_](\d+))|(?:cycle[-_]?(\d+))",
                       re.IGNORECASE)


def extract_cycle_id(s):
    if not s:
        return None
    m = _CYCLE_RE.search(str(s))
    if m:
        try:
            return int(m.group(1) or m.group(2))
        except (ValueError, TypeError):
            return None
    return None


# ═══════════════════════════════════════════════════
# DATASET — DINOv2 + text + pair synthesis
# ═══════════════════════════════════════════════════


class FeatureDatasetV9:
    def __init__(self, max_synth_pairs: int = DEFAULT_MAX_SYNTH_PAIRS,
                 pair_overall_margin: float = DEFAULT_PAIR_MARGIN,
                 pair_dim_margin: float = DEFAULT_PAIR_DIM_MARGIN,
                 real_pair_weight: float = DEFAULT_REAL_PAIR_WEIGHT,
                 split_seed: int = 42):
        self.real_pair_weight = real_pair_weight
        self.split_seed = split_seed

        with open(MANIFEST_PATH) as f:
            data = json.load(f)
        self.critique_by_cycle = load_critique_embeddings()

        # Load text embeddings sidecar
        if not TEXT_EMBEDDINGS_PATH.exists():
            raise FileNotFoundError(
                f"No text embeddings at {TEXT_EMBEDDINGS_PATH}. "
                f"Run `python extract_text.py` first."
            )
        with np.load(TEXT_EMBEDDINGS_PATH, allow_pickle=True) as npz:
            text_indices = npz["indices"].astype(np.int64)
            text_embeddings = npz["embeddings"].astype(np.float32)
        text_by_idx = {int(i): k for k, i in enumerate(text_indices.tolist())}

        # Build aligned arrays for samples that have BOTH DINOv2 + text
        self.features = []
        self.text_features = []
        self.targets = []
        self.code_features = []
        self.critique_embeddings = []
        self.critique_mask = []
        self.names = []

        self.path_to_idx = {}

        matched = 0
        for mi, sample in enumerate(data["samples"]):
            feat = sample.get("dinov2_features")
            if not feat or len(feat) != VISUAL_DIM:
                continue
            if mi not in text_by_idx:
                continue  # text embedding wasn't extracted for this sample

            scores = sample.get("scores", {})
            target = [float(scores.get(n, 0.5)) for n in SCORE_NAMES]

            row = len(self.features)
            self.features.append(feat)
            self.text_features.append(text_embeddings[text_by_idx[mi]])
            self.targets.append(target)

            code = sample.get("code_features")
            if code and len(code) == 64:
                self.code_features.append(code)
            else:
                self.code_features.append([0.0] * 64)

            meta = sample.get("metadata", {})
            cycle_id = extract_cycle_id(meta.get("source_name", ""))
            if cycle_id is None:
                cycle_id = extract_cycle_id(meta.get("code_path", ""))

            if cycle_id is not None and cycle_id in self.critique_by_cycle:
                self.critique_embeddings.append(self.critique_by_cycle[cycle_id].tolist())
                self.critique_mask.append(1.0)
                matched += 1
            else:
                self.critique_embeddings.append([0.0] * CRITIQUE_DIM)
                self.critique_mask.append(0.0)

            self.names.append(meta.get("source_name") or meta.get("category", "unknown"))

            for k in ("image", "screenshot_path"):
                p = sample.get(k)
                if p:
                    self.path_to_idx[p] = row

        self.n_matched = matched

        # Real flywheel + opus_pairwise pairs
        self.real_pairs = []
        if COMPARISONS_PATH.exists():
            comps = json.loads(COMPARISONS_PATH.read_text())
            for pair in comps.get("pairs", []):
                ia = self.path_to_idx.get(pair.get("image_a"))
                ib = self.path_to_idx.get(pair.get("image_b"))
                if ia is None or ib is None:
                    continue
                winner = np.zeros(OUTPUT_DIM, dtype=np.float32)
                margin = np.zeros(OUTPUT_DIM, dtype=np.float32)
                prefs = pair.get("preferences", {})
                for d, name in enumerate(SCORE_NAMES):
                    p = prefs.get(name, {})
                    w = p.get("winner")
                    winner[d] = 1.0 if w == "A" else -1.0 if w == "B" else 0.0
                    margin[d] = float(p.get("margin", 0.0))
                self.real_pairs.append((ia, ib, winner, margin))

        self.synth_pairs = []
        self.pair_overall_margin = pair_overall_margin
        self.pair_dim_margin = pair_dim_margin
        self.max_synth_pairs = max_synth_pairs

    def __len__(self):
        return len(self.features)

    def split(self, val_ratio=0.15, seed=None):
        if seed is None:
            seed = self.split_seed
        rng = np.random.default_rng(seed)
        n = len(self.features)
        indices = np.arange(n)
        rng.shuffle(indices)
        n_val = max(2, int(n * val_ratio))
        val_idx = set(indices[:n_val].tolist())
        train_idx = [i for i in range(n) if i not in val_idx]
        val_idx = list(val_idx)
        self.synth_pairs = self._synthesize_pairs(train_idx, rng)
        return train_idx, val_idx

    def _synthesize_pairs(self, train_idx, rng):
        targets = np.asarray(self.targets, dtype=np.float32)
        overall_idx = SCORE_NAMES.index("overall_aesthetic")
        candidates = []
        train_set = list(train_idx)
        max_to_examine = min(50_000, len(train_set) * (len(train_set) - 1) // 2)
        examined = 0
        for i in range(len(train_set)):
            for j in range(i + 1, len(train_set)):
                if examined >= max_to_examine:
                    break
                examined += 1
                a, b = train_set[i], train_set[j]
                m = abs(targets[a, overall_idx] - targets[b, overall_idx])
                if m > self.pair_overall_margin:
                    candidates.append((a, b, m))
        if not candidates:
            return []
        if len(candidates) > self.max_synth_pairs:
            picks = rng.choice(len(candidates), self.max_synth_pairs, replace=False)
            candidates = [candidates[k] for k in picks]
        pairs = []
        for a, b, _m in candidates:
            winner = np.zeros(OUTPUT_DIM, dtype=np.float32)
            margin = np.zeros(OUTPUT_DIM, dtype=np.float32)
            for d in range(OUTPUT_DIM):
                ma = float(targets[a, d])
                mb = float(targets[b, d])
                diff = ma - mb
                if abs(diff) > self.pair_dim_margin:
                    winner[d] = 1.0 if diff > 0 else -1.0
                    margin[d] = abs(diff)
            pairs.append((a, b, winner, margin))
        return pairs

    @property
    def all_pairs(self):
        return self.real_pairs + self.synth_pairs

    def get_regression_batch(self, indices, text_dropout=0.0, rng=None):
        feats = mx.array(np.array([self.features[i] for i in indices], dtype=np.float32))
        targets = mx.array(np.array([self.targets[i] for i in indices], dtype=np.float32))
        codes = mx.array(np.array([self.code_features[i] for i in indices], dtype=np.float32))
        crits = mx.array(np.array([self.critique_embeddings[i] for i in indices], dtype=np.float32))
        mask = mx.array(np.array([self.critique_mask[i] for i in indices], dtype=np.float32))

        # Text — with optional per-sample dropout to teach the model the no-text case
        text_arr = np.array([self.text_features[i] for i in indices], dtype=np.float32)
        if text_dropout > 0 and rng is not None:
            keep = rng.random(text_arr.shape[0]) >= text_dropout
            text_arr = text_arr * keep[:, None].astype(np.float32)
        texts = mx.array(text_arr)

        return feats, texts, targets, codes, crits, mask

    def get_preference_batch(self, indices, text_dropout=0.0, rng=None):
        if not indices:
            empty_v = mx.zeros((0, VISUAL_DIM))
            empty_t = mx.zeros((0, TEXT_DIM))
            return (empty_v, empty_t, empty_v, empty_t,
                    mx.zeros((0, 64)), mx.zeros((0, 64)),
                    mx.zeros((0, OUTPUT_DIM)), mx.zeros((0, OUTPUT_DIM)),
                    mx.zeros((0,)))

        pairs = self.all_pairs
        n_real = len(self.real_pairs)
        feat_a, feat_b, text_a, text_b, code_a, code_b = [], [], [], [], [], []
        win, marg, weights = [], [], []
        for k in indices:
            a, b, w, m = pairs[k]
            feat_a.append(self.features[a])
            feat_b.append(self.features[b])
            text_a.append(self.text_features[a])
            text_b.append(self.text_features[b])
            code_a.append(self.code_features[a])
            code_b.append(self.code_features[b])
            win.append(w)
            marg.append(m)
            weights.append(self.real_pair_weight if k < n_real else 1.0)

        text_a_np = np.array(text_a, dtype=np.float32)
        text_b_np = np.array(text_b, dtype=np.float32)
        if text_dropout > 0 and rng is not None:
            keep_a = rng.random(text_a_np.shape[0]) >= text_dropout
            keep_b = rng.random(text_b_np.shape[0]) >= text_dropout
            text_a_np = text_a_np * keep_a[:, None].astype(np.float32)
            text_b_np = text_b_np * keep_b[:, None].astype(np.float32)

        return (mx.array(np.array(feat_a, dtype=np.float32)),
                mx.array(text_a_np),
                mx.array(np.array(feat_b, dtype=np.float32)),
                mx.array(text_b_np),
                mx.array(np.array(code_a, dtype=np.float32)),
                mx.array(np.array(code_b, dtype=np.float32)),
                mx.array(np.array(win, dtype=np.float32)),
                mx.array(np.array(marg, dtype=np.float32)),
                mx.array(np.asarray(weights, dtype=np.float32)))


# ═══════════════════════════════════════════════════
# LOSSES (unchanged from v8)
# ═══════════════════════════════════════════════════


def gaussian_nll_loss(predictions, log_var, targets):
    log_var = mx.clip(log_var, -7.0, 4.0)
    inv_var = mx.exp(-log_var)
    diff = predictions - targets
    nll = 0.5 * (inv_var * diff * diff + log_var) * DIMENSION_WEIGHTS
    main = mx.mean(nll)
    overall_idx = SCORE_NAMES.index("overall_aesthetic")
    pred_overall = predictions[:, overall_idx]
    part_indices = [i for i, n in enumerate(SCORE_NAMES)
                    if n not in ("overall_aesthetic", "innovation_score",
                                 "system_creativity", "design_distinctiveness",
                                 "problem_level")]
    pred_parts_mean = mx.mean(predictions[:, part_indices], axis=1)
    incoherence = mx.maximum(pred_parts_mean - pred_overall - 0.05, 0)
    coherence = mx.mean(incoherence * incoherence) * 2.0
    return main + coherence


def weighted_mse_loss(predictions, targets):
    diff = predictions - targets
    loss = diff * diff * DIMENSION_WEIGHTS
    mse = mx.mean(loss)
    overall_idx = SCORE_NAMES.index("overall_aesthetic")
    pred_overall = predictions[:, overall_idx]
    part_indices = [i for i, n in enumerate(SCORE_NAMES)
                    if n not in ("overall_aesthetic", "innovation_score",
                                 "system_creativity", "design_distinctiveness",
                                 "problem_level")]
    pred_parts_mean = mx.mean(predictions[:, part_indices], axis=1)
    incoherence = mx.maximum(pred_parts_mean - pred_overall - 0.05, 0)
    coherence_penalty = mx.mean(incoherence * incoherence) * 2.0
    return mse + coherence_penalty


def cosine_distance_masked(pred_emb, target_emb, mask):
    pred_norm = pred_emb / (mx.linalg.norm(pred_emb, axis=-1, keepdims=True) + 1e-8)
    target_norm = target_emb / (mx.linalg.norm(target_emb, axis=-1, keepdims=True) + 1e-8)
    cos_sim = mx.sum(pred_norm * target_norm, axis=-1)
    distance = 1.0 - cos_sim
    masked = distance * mask
    denom = mx.maximum(mx.sum(mask), mx.array(1.0))
    return mx.sum(masked) / denom


def bradley_terry_loss(pref_a, pref_b, winner, margin, pair_weight=None):
    abs_winner = mx.abs(winner)
    target_diff = winner * (pref_a - pref_b)
    softplus_neg = mx.logaddexp(mx.zeros_like(target_diff), -target_diff)
    per_elem = softplus_neg * abs_winner * margin
    weight_mass = abs_winner * margin
    if pair_weight is not None:
        per_elem = per_elem * pair_weight[:, None]
        weight_mass = weight_mass * pair_weight[:, None]
    denom = mx.maximum(mx.sum(weight_mass), mx.array(1.0))
    return mx.sum(per_elem) / denom


# ═══════════════════════════════════════════════════
# WARM-START FROM V8 (where shapes overlap)
# ═══════════════════════════════════════════════════


def warm_start_from_v8(model: DesignHeadV9, v8_path: Path) -> bool:
    """Load v8 weights into v9, skipping parameters whose shapes don't
    match (fc1 went from 512→256 to 640→256 because of the new text stream).

    MLX's load_weights with strict=False unfortunately still copies tensors
    whose names match even if shapes mismatch, leaving parameters in an
    inconsistent state.  We side-step that by filtering the v8 state dict
    against the v9 model's expected parameter shapes.
    """
    if not v8_path.exists():
        print(f"[v9] no v8 checkpoint at {v8_path}; trunk init random")
        return False
    try:
        v8_weights = mx.load(str(v8_path))

        # Build a shape map from the freshly-init v9 model
        v9_shapes = dict(tree_flatten(model.parameters()))

        compatible = []
        skipped = []
        for k, v in v8_weights.items():
            if k in v9_shapes and tuple(v9_shapes[k].shape) == tuple(v.shape):
                compatible.append((k, v))
            else:
                skipped.append(k)

        model.load_weights(compatible, strict=False)
        loaded = len(compatible)
        total = len(v9_shapes)
        print(f"[v9] warm-started from v8: {v8_path.name} "
              f"({loaded}/{total} params matched; "
              f"{len(skipped)} skipped: {skipped[:4]}{'...' if len(skipped)>4 else ''})")
        return True
    except Exception as e:
        print(f"[v9] WARNING: v8 warm-start failed ({e}); using random init")
        return False


# ═══════════════════════════════════════════════════
# TRAINING
# ═══════════════════════════════════════════════════


def train(epochs=200, batch_size=16, learning_rate=1e-3,
          weight_decay=0.05, warmup_steps=20, patience=30, dropout=0.5,
          aux_weight=DEFAULT_AUX_WEIGHT, pref_weight=DEFAULT_PREF_WEIGHT,
          nll_weight=DEFAULT_NLL_WEIGHT,
          adapter_rank=DEFAULT_ADAPTER_RANK,
          adapter_alpha=DEFAULT_ADAPTER_ALPHA,
          max_synth_pairs=DEFAULT_MAX_SYNTH_PAIRS,
          pair_overall_margin=DEFAULT_PAIR_MARGIN,
          pair_dim_margin=DEFAULT_PAIR_DIM_MARGIN,
          real_pair_weight=DEFAULT_REAL_PAIR_WEIGHT,
          text_dropout=DEFAULT_TEXT_DROPOUT,
          disable_aux=False, disable_adapter=False, disable_pref=False,
          from_scratch=False,
          seed=42, split_seed=42, output_suffix=""):

    print(f"[v9] loading dataset (split_seed={split_seed}, train_seed={seed})...")
    dataset = FeatureDatasetV9(
        max_synth_pairs=max_synth_pairs,
        pair_overall_margin=pair_overall_margin,
        pair_dim_margin=pair_dim_margin,
        real_pair_weight=real_pair_weight,
        split_seed=split_seed,
    )
    print(f"[v9] {len(dataset)} samples (DINOv2 768-d + MiniLM 384-d)")
    print(f"[v9] critique embeddings matched: {dataset.n_matched}")

    train_idx, val_idx = dataset.split()
    print(f"[v9] split: {len(train_idx)} train, {len(val_idx)} val")
    print(f"[v9] pairs: {len(dataset.real_pairs)} real + "
          f"{len(dataset.synth_pairs)} synth = {len(dataset.all_pairs)} total")

    aux_enabled = (not disable_aux) and (dataset.n_matched >= MIN_AUX_SAMPLES)
    pref_enabled = (not disable_pref) and (len(dataset.all_pairs) >= 5)
    adapter_enabled = not disable_adapter

    print(f"[v9] phases: backbone=DINOv2 (frozen) text=MiniLM (frozen, {text_dropout:.0%} dropout) "
          f"adapter={'on' if adapter_enabled else 'off'} "
          f"uncertainty=on "
          f"pref={'on' if pref_enabled else 'off'} "
          f"aux={'on' if aux_enabled else 'off'}")

    model = DesignHeadV9(
        dropout=dropout,
        adapter_rank=adapter_rank,
        adapter_alpha=adapter_alpha,
        enable_adapter=adapter_enabled,
    )
    if not from_scratch:
        warm_start_from_v8(model, V8_WEIGHTS_PATH)
    print(f"[v9] head: {model.param_count():,} params")

    optimizer = optim.AdamW(learning_rate=learning_rate, weight_decay=weight_decay)
    steps_per_epoch = max(1, len(train_idx) // batch_size)
    total_steps = epochs * steps_per_epoch

    def loss_fn(model, feats, texts, targets, codes, crits, mask,
                feat_a, text_a, feat_b, text_b, code_a, code_b,
                winner, margin, pair_weight):
        scores, log_var, critique_preds, _pref = model(
            feats, texts, codes,
            return_aux=True, return_uncertainty=True, return_preference=True,
        )
        nll = gaussian_nll_loss(scores, log_var, targets)
        total = nll_weight * nll

        if aux_enabled:
            aux = cosine_distance_masked(critique_preds, crits, mask)
            total = total + aux_weight * aux

        if pref_enabled and feat_a.shape[0] > 0:
            pref_a = model(feat_a, text_a, code_a, return_preference=True)[1]
            pref_b = model(feat_b, text_b, code_b, return_preference=True)[1]
            bt = bradley_terry_loss(pref_a, pref_b, winner, margin, pair_weight)
            total = total + pref_weight * bt

        return total

    loss_and_grad = nn.value_and_grad(model, loss_fn)

    best_val_loss = float("inf")
    patience_counter = 0
    global_step = 0
    best_per_dim = None
    best_uncertainty = None

    print(f"[v9] training: {epochs} epochs, batch {batch_size}, lr {learning_rate}")
    print()

    pref_rng = np.random.default_rng(seed)
    text_rng = np.random.default_rng(seed + 9999)

    for epoch in range(epochs):
        model.train()
        t0 = time.time()
        rng = np.random.default_rng(epoch + seed * 1000)
        shuffled = rng.permutation(train_idx).tolist()

        epoch_loss = 0.0
        epoch_steps = 0

        for start in range(0, len(shuffled), batch_size):
            batch_idx = shuffled[start:start + batch_size]
            feats, texts, targets, codes, crits, mask = \
                dataset.get_regression_batch(batch_idx, text_dropout, text_rng)

            if pref_enabled and dataset.all_pairs:
                pref_batch_size = max(4, batch_size // 2)
                pref_idx = pref_rng.integers(
                    0, len(dataset.all_pairs),
                    size=min(pref_batch_size, len(dataset.all_pairs)),
                ).tolist()
            else:
                pref_idx = []
            (feat_a, text_a, feat_b, text_b,
             code_a, code_b, winner, margin, pair_weight) = \
                dataset.get_preference_batch(pref_idx, text_dropout, text_rng)

            if global_step < warmup_steps:
                lr = learning_rate * global_step / max(warmup_steps, 1)
            else:
                progress = (global_step - warmup_steps) / max(total_steps - warmup_steps, 1)
                lr = 1e-6 + 0.5 * (learning_rate - 1e-6) * (1 + math.cos(math.pi * progress))
            optimizer.learning_rate = lr

            loss, grads = loss_and_grad(
                model, feats, texts, targets, codes, crits, mask,
                feat_a, text_a, feat_b, text_b,
                code_a, code_b, winner, margin, pair_weight,
            )

            grad_flat = tree_flatten(grads)
            grad_norm = mx.sqrt(sum(mx.sum(g * g) for _, g in grad_flat))
            if grad_norm > 1.0:
                scale = 1.0 / (grad_norm + 1e-8)
                grads = tree_map(lambda g: g * scale, grads)

            optimizer.update(model, grads)
            mx.eval(model.parameters(), optimizer.state, loss)

            epoch_loss += float(loss)
            epoch_steps += 1
            global_step += 1

        avg_train = epoch_loss / max(epoch_steps, 1)

        model.eval()
        # Validation always passes text — measures the "with intent" ceiling
        val_feats, val_texts, val_targets, val_codes, _vc, _vm = \
            dataset.get_regression_batch(val_idx)
        val_preds, val_log_var = model(val_feats, val_texts, val_codes,
                                        return_uncertainty=True)
        val_loss = weighted_mse_loss(val_preds, val_targets)
        mx.eval(val_loss, val_preds, val_log_var)
        val_loss = float(val_loss)

        diff = mx.abs(val_preds - val_targets)
        mx.eval(diff)
        per_dim = [float(mx.mean(diff[:, i])) for i in range(OUTPUT_DIM)]

        std_per_dim = mx.sqrt(mx.exp(mx.clip(val_log_var, -7.0, 4.0)))
        mx.eval(std_per_dim)
        std_per_dim_list = [float(mx.mean(std_per_dim[:, i])) for i in range(OUTPUT_DIM)]

        elapsed = time.time() - t0

        if (epoch + 1) % 10 == 0 or val_loss < best_val_loss:
            print(f"  epoch {epoch + 1:4d}/{epochs} | "
                  f"train {avg_train:.4f} | val {val_loss:.4f} | "
                  f"lr {lr:.2e} | {elapsed:.2f}s")

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            patience_counter = 0
            best_per_dim = per_dim
            best_uncertainty = std_per_dim_list

            WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
            weights_out = (WEIGHTS_DIR / f"design-head-v9{output_suffix}.safetensors"
                           if output_suffix else V9_WEIGHTS_PATH)
            model.save_weights(str(weights_out))

            dim_str = " | ".join(f"{SCORE_NAMES[i][:6]}={per_dim[i]:.3f}"
                                 for i in range(OUTPUT_DIM))
            print(f"  >>> best: {dim_str}")
        else:
            patience_counter += 1

        if patience_counter >= patience:
            print(f"\n[v9] early stopping at epoch {epoch + 1}")
            break

    print(f"\n[v9] training complete!")
    print(f"[v9] best val loss: {best_val_loss:.4f}")

    if best_per_dim:
        print(f"\n[v9] per-dim MAE | predicted std:")
        for i, name in enumerate(SCORE_NAMES):
            mae = best_per_dim[i]
            std = best_uncertainty[i] if best_uncertainty else 0.0
            bar = "█" * int(mae * 50)
            print(f"  {name:25s}: {mae:.4f}  σ={std:.3f}  {bar}")

    meta = {
        "best_val_loss": best_val_loss,
        "epochs": epoch + 1,
        "per_dim_mae": {n: best_per_dim[i] for i, n in enumerate(SCORE_NAMES)} if best_per_dim else {},
        "per_dim_predicted_std": {n: best_uncertainty[i] for i, n in enumerate(SCORE_NAMES)} if best_uncertainty else {},
        "param_count": model.param_count(),
        "backbone_vision": "dinov2-base (ViT-B/14, frozen)",
        "backbone_text": "all-MiniLM-L6-v2 (22M, frozen)",
        "feature_dim_vision": VISUAL_DIM,
        "feature_dim_text": TEXT_DIM,
        "phases": {
            "phase_5_aux": {
                "enabled": aux_enabled,
                "weight": aux_weight if aux_enabled else 0.0,
                "samples_matched": dataset.n_matched,
            },
            "phase_6_uncertainty": {"enabled": True, "weight": nll_weight},
            "phase_7_adapter": {"enabled": adapter_enabled,
                                "rank": adapter_rank if adapter_enabled else None},
            "phase_8_preference": {
                "enabled": pref_enabled,
                "weight": pref_weight if pref_enabled else 0.0,
                "real_pairs": len(dataset.real_pairs),
                "synth_pairs": len(dataset.synth_pairs),
                "real_pair_weight_multiplier": real_pair_weight,
            },
            "phase_10_text_intent": {
                "enabled": True,
                "encoder": "all-MiniLM-L6-v2",
                "feature_dim": TEXT_DIM,
                "train_dropout": text_dropout,
            },
        },
        "warm_start_from_v8": (not from_scratch) and V8_WEIGHTS_PATH.exists(),
        "seed": seed,
        "split_seed": split_seed,
    }
    meta_path = (WEIGHTS_DIR / f"train-v9{output_suffix}-meta.json"
                 if output_suffix else WEIGHTS_DIR / "train-v9-meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    return meta


def train_multi_seed(seeds, split_seed=42, **train_kwargs):
    base_suffix = train_kwargs.pop("output_suffix", "")
    runs = []
    for seed in seeds:
        run_suffix = f"{base_suffix}-seed{seed}"
        print(f"\n{'═' * 60}")
        print(f"[multi-seed] starting run train_seed={seed} (split_seed={split_seed})")
        print('═' * 60)
        meta = train(seed=seed, split_seed=split_seed,
                     output_suffix=run_suffix, **train_kwargs)
        runs.append({"seed": seed, "suffix": run_suffix, "meta": meta})

    val_losses = np.array([r["meta"]["best_val_loss"] for r in runs])
    per_dim_arrays = {n: np.array([r["meta"]["per_dim_mae"].get(n, 0.0) for r in runs])
                      for n in SCORE_NAMES}

    best_run = min(runs, key=lambda r: r["meta"]["best_val_loss"])
    best_path = WEIGHTS_DIR / f"design-head-v9{best_run['suffix']}.safetensors"
    canonical_target = (WEIGHTS_DIR / f"design-head-v9{base_suffix}.safetensors"
                        if base_suffix else V9_WEIGHTS_PATH)
    canonical_meta_target = (WEIGHTS_DIR / f"train-v9{base_suffix}-meta.json"
                             if base_suffix else WEIGHTS_DIR / "train-v9-meta.json")
    best_meta_path = WEIGHTS_DIR / f"train-v9{best_run['suffix']}-meta.json"
    if best_path.exists():
        import shutil as _sh
        _sh.copyfile(str(best_path), str(canonical_target))
        if best_meta_path.exists():
            _sh.copyfile(str(best_meta_path), str(canonical_meta_target))

    print(f"\n{'═' * 60}")
    print(f"[multi-seed] {len(runs)} runs complete")
    print('═' * 60)
    print(f"\nval_loss: mean {val_losses.mean():.4f}  ±  std {val_losses.std():.4f}  "
          f"min {val_losses.min():.4f}  max {val_losses.max():.4f}")
    print(f"\nper-run val_loss:")
    for r, vl in zip(runs, val_losses):
        flag = " ← canonical" if r is best_run else ""
        print(f"  seed={r['seed']:3d}: val_loss={vl:.4f} epochs={r['meta']['epochs']:3d}{flag}")

    print(f"\nper-dim MAE (mean ± std across seeds):")
    for name in SCORE_NAMES:
        arr = per_dim_arrays[name]
        bar = "█" * int(arr.mean() * 50)
        print(f"  {name:25s}: {arr.mean():.4f} ± {arr.std():.4f}  {bar}")

    summary = {
        "n_seeds": len(runs),
        "seeds": list(seeds),
        "best_seed": best_run["seed"],
        "val_loss": {
            "mean": float(val_losses.mean()),
            "std": float(val_losses.std()),
            "min": float(val_losses.min()),
            "max": float(val_losses.max()),
        },
        "per_dim_mae_mean": {n: float(per_dim_arrays[n].mean()) for n in SCORE_NAMES},
        "per_dim_mae_std": {n: float(per_dim_arrays[n].std()) for n in SCORE_NAMES},
        "runs": [{"seed": r["seed"],
                  "best_val_loss": r["meta"]["best_val_loss"],
                  "epochs": r["meta"]["epochs"]} for r in runs],
    }
    with open(WEIGHTS_DIR / f"train-v9{base_suffix}-multiseed-summary.json", "w") as f:
        json.dump(summary, f, indent=2)
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train Phase 10 design head (DINOv2 + text)")
    parser.add_argument("--epochs", type=int, default=200)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=0.05)
    parser.add_argument("--warmup", type=int, default=20)
    parser.add_argument("--patience", type=int, default=30)
    parser.add_argument("--dropout", type=float, default=0.5)
    parser.add_argument("--aux-weight", type=float, default=DEFAULT_AUX_WEIGHT)
    parser.add_argument("--pref-weight", type=float, default=DEFAULT_PREF_WEIGHT)
    parser.add_argument("--nll-weight", type=float, default=DEFAULT_NLL_WEIGHT)
    parser.add_argument("--max-synth-pairs", type=int, default=DEFAULT_MAX_SYNTH_PAIRS)
    parser.add_argument("--pair-overall-margin", type=float, default=DEFAULT_PAIR_MARGIN)
    parser.add_argument("--pair-dim-margin", type=float, default=DEFAULT_PAIR_DIM_MARGIN)
    parser.add_argument("--real-pair-weight", type=float, default=DEFAULT_REAL_PAIR_WEIGHT)
    parser.add_argument("--text-dropout", type=float, default=DEFAULT_TEXT_DROPOUT,
                        help="Probability of zeroing text input per sample (teaches no-text robustness)")
    parser.add_argument("--disable-aux", action="store_true")
    parser.add_argument("--disable-adapter", action="store_true")
    parser.add_argument("--disable-pref", action="store_true")
    parser.add_argument("--from-scratch", action="store_true")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--split-seed", type=int, default=42)
    parser.add_argument("--seeds", type=str, default=None)
    parser.add_argument("--output-suffix", default="")
    args = parser.parse_args()

    common_kwargs = dict(
        epochs=args.epochs,
        batch_size=args.batch,
        learning_rate=args.lr,
        weight_decay=args.weight_decay,
        warmup_steps=args.warmup,
        patience=args.patience,
        dropout=args.dropout,
        aux_weight=args.aux_weight,
        pref_weight=args.pref_weight,
        nll_weight=args.nll_weight,
        max_synth_pairs=args.max_synth_pairs,
        pair_overall_margin=args.pair_overall_margin,
        pair_dim_margin=args.pair_dim_margin,
        real_pair_weight=args.real_pair_weight,
        text_dropout=args.text_dropout,
        disable_aux=args.disable_aux,
        disable_adapter=args.disable_adapter,
        disable_pref=args.disable_pref,
        from_scratch=args.from_scratch,
    )

    if args.seeds:
        if "," in args.seeds:
            seeds = [int(s.strip()) for s in args.seeds.split(",")]
        else:
            seeds = list(range(int(args.seeds)))
        train_multi_seed(seeds, split_seed=args.split_seed,
                         output_suffix=args.output_suffix, **common_kwargs)
    else:
        train(seed=args.seed, split_seed=args.split_seed,
              output_suffix=args.output_suffix, **common_kwargs)
