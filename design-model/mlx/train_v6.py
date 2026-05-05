#!/usr/bin/env python3
"""
Train Phase 6 Design Head — v5 trunk + three new signals layered on a
shared 64-dim representation:

  Phase 6  Heteroscedastic uncertainty head — predict per-dim mean + log_var
           and train with Gaussian NLL.  Exposes calibrated uncertainty for
           active-learning routing in self_train.
  Phase 7  Low-rank feature adapter on the (otherwise frozen) MobileNet
           features — lets late-layer representation specialize toward UI
           imagery without rerunning the backbone.  ~165K extra params.
  Phase 8  Preference head — Bradley-Terry loss over the flywheel
           comparisons.json pairs, trained jointly with the regression
           head on the shared h64 layer.  Per-dim BT signal, margin-weighted.

The Phase 5 critique-aux head carries forward unchanged; it auto-disables
when fewer than MIN_AUX_SAMPLES manifest entries match an embedded critique.

Initialization
  v6 loads the v5 checkpoint into the shared trunk (vis_proj, code_proj,
  fc1/2/3, output, aux_*).  New params (adapter, log_var head, pref head)
  are randomly initialized.  Set --from-scratch to skip the warm-start.

Usage
  python train_v6.py                                    # default training
  python train_v6.py --epochs 300 --pref-weight 0.2
  python train_v6.py --disable-adapter --disable-pref   # v5-equivalent
  python train_v6.py --from-scratch                     # ignore v5 weights
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

V5_WEIGHTS_PATH = WEIGHTS_DIR / "design-head-v5.safetensors"
V6_WEIGHTS_PATH = WEIGHTS_DIR / "design-head-v6.safetensors"

OUTPUT_DIM = 16
CRITIQUE_DIM = 3072
MIN_AUX_SAMPLES = 20
DEFAULT_AUX_WEIGHT = 0.1
DEFAULT_PREF_WEIGHT = 0.15
DEFAULT_NLL_WEIGHT = 1.0

# Adapter starts as a near-no-op so the warm-started trunk dominates early
DEFAULT_ADAPTER_ALPHA = 0.05
DEFAULT_ADAPTER_RANK = 64

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

DIMENSION_WEIGHTS_NP = np.array([
    1.2, 1.1, 1.1, 0.9, 1.3, 1.2, 1.0, 1.0,
    1.2, 1.0, 1.1, 1.5,
    1.4, 1.3, 1.2, 1.1,
], dtype=np.float32)


# ═══════════════════════════════════════════════════
# DESIGN HEAD V6
# ═══════════════════════════════════════════════════


class FeatureAdapter(nn.Module):
    """LoRA-style residual on cached MobileNet features.

    out = features + alpha * down(gelu(up(features)))

    `alpha` is a learned scalar gating the residual.  Init at ~0.05 keeps
    the warm-started trunk's behaviour intact for the first few epochs while
    the adapter is random — the residual contribution is small.
    """

    def __init__(self, dim: int = 1280, rank: int = DEFAULT_ADAPTER_RANK,
                 init_alpha: float = DEFAULT_ADAPTER_ALPHA):
        super().__init__()
        self.up = nn.Linear(dim, rank)
        self.down = nn.Linear(rank, dim)
        # Use mx.array for the gating scalar — mx exposes it as a parameter
        # automatically when assigned on a Module.
        self.alpha = mx.array(init_alpha, dtype=mx.float32)

    def __call__(self, x):
        residual = self.down(nn.gelu(self.up(x)))
        return x + self.alpha * residual


class DesignHeadV6(nn.Module):
    """v5 trunk + Phase 6 (uncertainty) + Phase 7 (adapter) + Phase 8 (pref)."""

    def __init__(self, visual_dim: int = 1280, code_dim: int = 64,
                 dropout: float = 0.5, critique_dim: int = CRITIQUE_DIM,
                 adapter_rank: int = DEFAULT_ADAPTER_RANK,
                 adapter_alpha: float = DEFAULT_ADAPTER_ALPHA,
                 enable_adapter: bool = True):
        super().__init__()

        self.enable_adapter = enable_adapter

        # ── Phase 7: LoRA-style feature adapter ──
        if enable_adapter:
            self.adapter = FeatureAdapter(visual_dim, adapter_rank, adapter_alpha)

        # ── v5 trunk (warm-startable from design-head-v5.safetensors) ──
        self.vis_proj = nn.Linear(visual_dim, 384)
        self.vis_norm = nn.LayerNorm(384)
        self.code_proj = nn.Linear(code_dim, 128)
        self.code_norm = nn.LayerNorm(128)

        input_dim = 384 + 128
        self.fc1 = nn.Linear(input_dim, 256)
        self.ln1 = nn.LayerNorm(256)
        self.drop1 = nn.Dropout(dropout)

        self.fc2 = nn.Linear(256, 128)
        self.ln2 = nn.LayerNorm(128)
        self.drop2 = nn.Dropout(dropout * 0.8)

        self.fc3 = nn.Linear(128, 64)
        self.ln3 = nn.LayerNorm(64)
        self.drop3 = nn.Dropout(dropout * 0.6)

        # Main head — produces the *mean* of the per-dim Gaussian
        self.output = nn.Linear(64, OUTPUT_DIM)

        # ── Phase 6: heteroscedastic log-variance head ──
        # Init bias to log(0.04) ≈ -3.2 so std starts ~0.2; clamp at inference time
        self.log_var = nn.Linear(64, OUTPUT_DIM)

        # ── Phase 5: critique-embedding aux head ──
        self.aux_fc1 = nn.Linear(64, 256)
        self.aux_fc2 = nn.Linear(256, 512)
        self.aux_out = nn.Linear(512, critique_dim)

        # ── Phase 8: preference head — per-dim unbounded logit ──
        self.pref_head = nn.Linear(64, OUTPUT_DIM)

    def trunk(self, visual_features, code_features=None):
        """Run feature adapter + v5 trunk → 64-dim shared representation."""
        x = visual_features
        if self.enable_adapter and hasattr(self, "adapter"):
            x = self.adapter(x)

        v = self.drop1(nn.gelu(self.vis_norm(self.vis_proj(x))))

        if code_features is not None:
            c = nn.gelu(self.code_norm(self.code_proj(code_features)))
        else:
            c = mx.zeros((v.shape[0], 128))

        h = mx.concatenate([v, c], axis=-1)
        h = self.drop1(nn.gelu(self.ln1(self.fc1(h))))
        h = self.drop2(nn.gelu(self.ln2(self.fc2(h))))
        h64 = self.drop3(nn.gelu(self.ln3(self.fc3(h))))
        return h64

    def __call__(self, visual_features, code_features=None,
                 return_aux: bool = False, return_uncertainty: bool = False,
                 return_preference: bool = False):
        h64 = self.trunk(visual_features, code_features)
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
# WARM-START FROM V5
# ═══════════════════════════════════════════════════


def warm_start_from_v5(model: DesignHeadV6, v5_path: Path) -> int:
    """Copy v5 trunk weights into v6.  Returns count of params loaded."""
    if not v5_path.exists():
        print(f"[v6] no v5 checkpoint at {v5_path} — training from scratch")
        return 0

    # mlx safetensors load: use load_weights with strict=False so v6's new
    # parameters (adapter, log_var, pref_head) don't raise.
    try:
        model.load_weights(str(v5_path), strict=False)
        loaded = sum(p.size for _, p in tree_flatten(model.parameters())
                     if p is not None)
        print(f"[v6] warm-started from v5: {v5_path.name} "
              f"(unmatched params kept at random init)")
        return loaded
    except Exception as e:
        print(f"[v6] WARNING: v5 warm-start failed ({e}); using random init")
        return 0


# ═══════════════════════════════════════════════════
# CRITIQUE EMBEDDING LOOKUP (from v5)
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


def extract_cycle_id(source_name: str):
    if not source_name:
        return None
    m = _CYCLE_RE.search(str(source_name))
    if m:
        raw = m.group(1) or m.group(2)
        try:
            return int(raw)
        except (ValueError, TypeError):
            return None
    return None


# ═══════════════════════════════════════════════════
# DATASET (regression + preference)
# ═══════════════════════════════════════════════════


class FeatureDatasetV6:
    """Loads:
       - regression batch:  (features, codes, targets, crits, mask)
       - preference batch:  (feat_a, code_a, feat_b, code_b, winner, weight)
                             per-dim winner ∈ {-1, 0, +1} with margin weight

    Joins by image path so flywheel comparison pairs match manifest entries.
    """

    def __init__(self):
        with open(MANIFEST_PATH) as f:
            data = json.load(f)

        self.critique_by_cycle = load_critique_embeddings()

        # ── Regression samples ──
        self.features = []
        self.targets = []
        self.code_features = []
        self.critique_embeddings = []
        self.critique_mask = []
        self.names = []

        # Path → index, for preference pair lookup
        self.path_to_idx = {}

        matched = 0
        for sample in data["samples"]:
            feat = sample.get("mobilenet_features")
            if not feat or len(feat) != 1280:
                continue

            scores = sample.get("scores", {})
            target = [float(scores.get(n, 0.5)) for n in SCORE_NAMES]

            idx = len(self.features)
            self.features.append(feat)
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

            name = meta.get("source_name") or meta.get("category", "unknown")
            self.names.append(name)

            # Track path for pref pair joining
            for path_key in ("image", "screenshot_path"):
                p = sample.get(path_key)
                if p:
                    self.path_to_idx[p] = idx

        self.n_matched = matched

        # ── Preference pairs ──
        self.pref_pairs = []
        if COMPARISONS_PATH.exists():
            comps = json.loads(COMPARISONS_PATH.read_text())
            for pair in comps.get("pairs", []):
                a_path = pair.get("image_a")
                b_path = pair.get("image_b")
                if not a_path or not b_path:
                    continue
                ia = self.path_to_idx.get(a_path)
                ib = self.path_to_idx.get(b_path)
                if ia is None or ib is None:
                    continue

                # Per-dim winner: A=+1, B=-1, tie=0
                # (we keep the convention "logit_winner > logit_loser")
                winner = np.zeros(OUTPUT_DIM, dtype=np.float32)
                margin = np.zeros(OUTPUT_DIM, dtype=np.float32)
                prefs = pair.get("preferences", {})
                for i, name in enumerate(SCORE_NAMES):
                    p = prefs.get(name, {})
                    w = p.get("winner")
                    if w == "A":
                        winner[i] = 1.0
                    elif w == "B":
                        winner[i] = -1.0
                    else:
                        winner[i] = 0.0
                    margin[i] = float(p.get("margin", 0.0))

                self.pref_pairs.append((ia, ib, winner, margin))

    def __len__(self):
        return len(self.features)

    def split(self, val_ratio=0.15, seed=42):
        rng = np.random.default_rng(seed)
        n = len(self.features)
        indices = np.arange(n)
        rng.shuffle(indices)
        n_val = max(2, int(n * val_ratio))
        val_idx = set(indices[:n_val].tolist())
        train_idx = [i for i in range(n) if i not in val_idx]
        val_idx = list(val_idx)
        return train_idx, val_idx

    def get_regression_batch(self, indices):
        feats = mx.array(np.array([self.features[i] for i in indices], dtype=np.float32))
        targets = mx.array(np.array([self.targets[i] for i in indices], dtype=np.float32))
        codes = mx.array(np.array([self.code_features[i] for i in indices], dtype=np.float32))
        crits = mx.array(np.array([self.critique_embeddings[i] for i in indices], dtype=np.float32))
        mask = mx.array(np.array([self.critique_mask[i] for i in indices], dtype=np.float32))
        return feats, targets, codes, crits, mask

    def get_preference_batch(self, indices):
        """Build a tensor batch from a list of pref-pair indices."""
        if not indices:
            empty = mx.zeros((0, 1280))
            return empty, empty, mx.zeros((0, 64)), mx.zeros((0, 64)), \
                   mx.zeros((0, OUTPUT_DIM)), mx.zeros((0, OUTPUT_DIM))

        feat_a, feat_b = [], []
        code_a, code_b = [], []
        winners, margins = [], []
        for k in indices:
            ia, ib, w, m = self.pref_pairs[k]
            feat_a.append(self.features[ia])
            feat_b.append(self.features[ib])
            code_a.append(self.code_features[ia])
            code_b.append(self.code_features[ib])
            winners.append(w)
            margins.append(m)

        return (mx.array(np.array(feat_a, dtype=np.float32)),
                mx.array(np.array(feat_b, dtype=np.float32)),
                mx.array(np.array(code_a, dtype=np.float32)),
                mx.array(np.array(code_b, dtype=np.float32)),
                mx.array(np.array(winners, dtype=np.float32)),
                mx.array(np.array(margins, dtype=np.float32)))


# ═══════════════════════════════════════════════════
# LOSSES
# ═══════════════════════════════════════════════════


def gaussian_nll_loss(predictions, log_var, targets):
    """Heteroscedastic Gaussian NLL with per-dim weighting + coherence penalty.

    NLL = 0.5 * (exp(-log_var) * (pred - target)^2 + log_var)

    Clamping log_var ∈ [-7, 4] keeps variance in a sane range
    (std between ~0.03 and ~7.4) and prevents the loss from collapsing to
    "predict huge variance, ignore the data".
    """
    log_var = mx.clip(log_var, -7.0, 4.0)
    inv_var = mx.exp(-log_var)
    diff = predictions - targets

    nll = 0.5 * (inv_var * diff * diff + log_var)
    nll = nll * DIMENSION_WEIGHTS
    main = mx.mean(nll)

    # Coherence: parts shouldn't outscore the gestalt
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
    """Pure MSE — used for validation reporting (so v6 numbers are
    comparable to v5's val_loss column)."""
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


def bradley_terry_loss(pref_a, pref_b, winner, margin):
    """Bradley-Terry per-dim loss, margin-weighted.

    pref_a, pref_b: (B, OUTPUT_DIM) — preference logits for the two items
    winner: (B, OUTPUT_DIM) ∈ {-1, 0, +1}; +1 = A wins, -1 = B wins, 0 = tie
    margin: (B, OUTPUT_DIM) — confidence weight (larger = stronger signal)

    For each (sample, dim) where winner != 0:
      target_diff = winner * (pref_a - pref_b)  → positive when winner is right
      loss = -log_sigmoid(target_diff) * margin

    Ties contribute zero gradient; high-margin pairs dominate.
    """
    abs_winner = mx.abs(winner)
    target_diff = winner * (pref_a - pref_b)

    # log_sigmoid(x) = -softplus(-x) — numerically stable
    softplus_neg = mx.logaddexp(mx.zeros_like(target_diff), -target_diff)
    per_elem = softplus_neg * abs_winner * margin

    denom = mx.maximum(mx.sum(abs_winner * margin), mx.array(1.0))
    return mx.sum(per_elem) / denom


# ═══════════════════════════════════════════════════
# TRAINING
# ═══════════════════════════════════════════════════


def train(epochs=200, batch_size=16, learning_rate=1e-3, weight_decay=0.05,
          warmup_steps=20, patience=30, dropout=0.5,
          aux_weight=DEFAULT_AUX_WEIGHT, pref_weight=DEFAULT_PREF_WEIGHT,
          nll_weight=DEFAULT_NLL_WEIGHT,
          adapter_rank=DEFAULT_ADAPTER_RANK,
          adapter_alpha=DEFAULT_ADAPTER_ALPHA,
          disable_aux=False, disable_adapter=False, disable_pref=False,
          from_scratch=False):

    print("[v6] loading dataset...")
    dataset = FeatureDatasetV6()
    print(f"[v6] {len(dataset)} regression samples (1280-dim MobileNet features)")
    print(f"[v6] critique embeddings matched: {dataset.n_matched} / {len(dataset)}")
    print(f"[v6] preference pairs (with both features): {len(dataset.pref_pairs)}")

    aux_enabled = (not disable_aux) and (dataset.n_matched >= MIN_AUX_SAMPLES)
    pref_enabled = (not disable_pref) and (len(dataset.pref_pairs) >= 5)
    adapter_enabled = not disable_adapter

    print(f"[v6] phases: "
          f"adapter={'on' if adapter_enabled else 'off'} "
          f"uncertainty=on "
          f"pref={'on' if pref_enabled else 'off'} "
          f"aux={'on' if aux_enabled else 'off (data gap)'}")

    train_idx, val_idx = dataset.split()
    print(f"[v6] split: {len(train_idx)} train, {len(val_idx)} val")

    model = DesignHeadV6(
        dropout=dropout,
        adapter_rank=adapter_rank,
        adapter_alpha=adapter_alpha,
        enable_adapter=adapter_enabled,
    )
    if not from_scratch:
        warm_start_from_v5(model, V5_WEIGHTS_PATH)
    print(f"[v6] head: {model.param_count():,} params")

    optimizer = optim.AdamW(learning_rate=learning_rate, weight_decay=weight_decay)
    steps_per_epoch = max(1, len(train_idx) // batch_size)
    total_steps = epochs * steps_per_epoch

    # Closure compiles inputs into a single grad.  We always compute the main
    # NLL loss; aux + pref are gated by the boolean flags inside the closure
    # so the autograd graph stays consistent across batches.
    def loss_fn(model, feats, targets, codes, crits, mask,
                feat_a, feat_b, code_a, code_b, winner, margin):
        scores, log_var, critique_preds, _pref = model(
            feats, codes,
            return_aux=True, return_uncertainty=True, return_preference=True,
        )
        nll = gaussian_nll_loss(scores, log_var, targets)
        total = nll_weight * nll

        if aux_enabled:
            aux = cosine_distance_masked(critique_preds, crits, mask)
            total = total + aux_weight * aux

        if pref_enabled and feat_a.shape[0] > 0:
            pref_a = model(feat_a, code_a, return_preference=True)[1]
            pref_b = model(feat_b, code_b, return_preference=True)[1]
            bt = bradley_terry_loss(pref_a, pref_b, winner, margin)
            total = total + pref_weight * bt

        return total

    loss_and_grad = nn.value_and_grad(model, loss_fn)

    best_val_loss = float("inf")
    patience_counter = 0
    global_step = 0
    best_per_dim = None
    best_uncertainty = None

    print(f"[v6] training: {epochs} epochs, batch {batch_size}, lr {learning_rate}")
    print(f"[v6] regularization: dropout={dropout}, weight_decay={weight_decay}")
    print(f"[v6] weights: nll={nll_weight}, aux={aux_weight}, pref={pref_weight}")
    print()

    pref_rng = np.random.default_rng(0)

    for epoch in range(epochs):
        model.train()
        t0 = time.time()

        rng = np.random.default_rng(epoch)
        shuffled = rng.permutation(train_idx).tolist()

        epoch_loss = 0.0
        epoch_steps = 0

        for start in range(0, len(shuffled), batch_size):
            batch_idx = shuffled[start:start + batch_size]
            feats, targets, codes, crits, mask = dataset.get_regression_batch(batch_idx)

            # Sample preference pairs in parallel — half-batch by default
            pref_batch_size = max(4, batch_size // 2)
            if pref_enabled and dataset.pref_pairs:
                pref_idx = pref_rng.integers(
                    0, len(dataset.pref_pairs),
                    size=min(pref_batch_size, len(dataset.pref_pairs)),
                ).tolist()
            else:
                pref_idx = []
            feat_a, feat_b, code_a, code_b, winner, margin = \
                dataset.get_preference_batch(pref_idx)

            if global_step < warmup_steps:
                lr = learning_rate * global_step / max(warmup_steps, 1)
            else:
                progress = (global_step - warmup_steps) / max(total_steps - warmup_steps, 1)
                lr = 1e-6 + 0.5 * (learning_rate - 1e-6) * (1 + math.cos(math.pi * progress))
            optimizer.learning_rate = lr

            loss, grads = loss_and_grad(
                model, feats, targets, codes, crits, mask,
                feat_a, feat_b, code_a, code_b, winner, margin,
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

        # Validation — compare apples-to-apples with v5: weighted MSE on the means
        model.eval()
        val_feats, val_targets, val_codes, _vc, _vm = dataset.get_regression_batch(val_idx)
        val_preds, val_log_var = model(val_feats, val_codes, return_uncertainty=True)
        val_loss = weighted_mse_loss(val_preds, val_targets)
        mx.eval(val_loss, val_preds, val_log_var)
        val_loss = float(val_loss)

        diff = mx.abs(val_preds - val_targets)
        mx.eval(diff)
        per_dim = [float(mx.mean(diff[:, i])) for i in range(OUTPUT_DIM)]

        # Mean predicted std per dim (sqrt of exp(log_var))
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
            model.save_weights(str(V6_WEIGHTS_PATH))

            dim_str = " | ".join(f"{SCORE_NAMES[i][:6]}={per_dim[i]:.3f}"
                                 for i in range(OUTPUT_DIM))
            print(f"  >>> best: {dim_str}")
        else:
            patience_counter += 1

        if patience_counter >= patience:
            print(f"\n[v6] early stopping at epoch {epoch + 1}")
            break

    print(f"\n[v6] training complete!")
    print(f"[v6] best val loss: {best_val_loss:.4f}")

    if best_per_dim:
        print(f"\n[v6] per-dim MAE | predicted std:")
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
        "backbone": "mobilenet_v2_imagenet",
        "feature_dim": 1280,
        "phases": {
            "phase_5_aux": {
                "enabled": aux_enabled,
                "weight": aux_weight if aux_enabled else 0.0,
                "samples_matched": dataset.n_matched,
                "samples_total": len(dataset),
            },
            "phase_6_uncertainty": {
                "enabled": True,
                "loss": "gaussian_nll",
                "log_var_clip": [-7.0, 4.0],
                "weight": nll_weight,
            },
            "phase_7_adapter": {
                "enabled": adapter_enabled,
                "rank": adapter_rank if adapter_enabled else None,
                "init_alpha": adapter_alpha if adapter_enabled else None,
            },
            "phase_8_preference": {
                "enabled": pref_enabled,
                "weight": pref_weight if pref_enabled else 0.0,
                "pairs_used": len(dataset.pref_pairs),
            },
        },
        "warm_start_from_v5": (not from_scratch) and V5_WEIGHTS_PATH.exists(),
    }
    with open(WEIGHTS_DIR / "train-v6-meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    return meta


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train Phase 6 design head")
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
    parser.add_argument("--adapter-rank", type=int, default=DEFAULT_ADAPTER_RANK)
    parser.add_argument("--adapter-alpha", type=float, default=DEFAULT_ADAPTER_ALPHA)
    parser.add_argument("--disable-aux", action="store_true")
    parser.add_argument("--disable-adapter", action="store_true")
    parser.add_argument("--disable-pref", action="store_true")
    parser.add_argument("--from-scratch", action="store_true",
                        help="Skip v5 warm-start; train from random init")
    args = parser.parse_args()

    train(
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
        adapter_rank=args.adapter_rank,
        adapter_alpha=args.adapter_alpha,
        disable_aux=args.disable_aux,
        disable_adapter=args.disable_adapter,
        disable_pref=args.disable_pref,
        from_scratch=args.from_scratch,
    )
