#!/usr/bin/env python3
"""
Train Phase 5 Design Head — v2 architecture + auxiliary critique-embedding head.

Phase 5 (per VISION.md:211) adds an auxiliary training signal: predict
Opus's critique text embedding from the same code+visual features that
produce numeric scores. The hypothesis: critiques like *"great typography
but clashes with the palette"* encode structural information (WHY) that
per-dimension scores (WHAT) don't capture. Teaching the feature
hierarchy to predict that embedding gives the main head a sharper
gradient and improves the quality of numeric score predictions.

Architecture: identical to train_v2's DesignHead through the 64-dim
fc3 output, then branches:
  • Main head (existing):     64 → linear(16) → sigmoid → scores
  • Aux head (new):           64 → linear(256) → linear(512) → linear(3072)
                              regresses to OpenAI text-embedding-3-large

Loss: main_loss + AUX_WEIGHT * (1 - mean_cosine_similarity)
  where AUX_WEIGHT=0.1 keeps the numeric task dominant.

Graceful degradation: if <20 manifest samples have matching critique
embeddings, the aux loss is disabled and this script behaves exactly
like train_v2 — but still saves to design-head-v5.safetensors so
inference can fall forward to v5 when it becomes meaningful.

Usage:
  python train_v5.py                         # Default training
  python train_v5.py --epochs 300 --aux-weight 0.1
  python train_v5.py --disable-aux           # Force v2-equivalent
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
CRITIQUE_EMBEDDINGS_PATH = DATA_DIR / "critique_embeddings.npz"

OUTPUT_DIM = 16
CRITIQUE_DIM = 3072  # OpenAI text-embedding-3-large native dimension
MIN_AUX_SAMPLES = 20  # below this, aux head is disabled
DEFAULT_AUX_WEIGHT = 0.1

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
# DESIGN HEAD V5 — main + auxiliary critique branch
# ═══════════════════════════════════════════════════


class DesignHeadV5(nn.Module):
    """
    Extends train_v2.DesignHead with an auxiliary critique-embedding
    head that branches off the 64-dim fc3 output.  Main head
    structure is byte-for-byte identical to DesignHead so weights
    transfer cleanly (v5 checkpoint can be loaded as v2 by dropping
    aux_* params).

    Input:
      visual_features: (B, 1280) MobileNet V2 features
      code_features:   (B, 64) code-level features
      return_aux:      if True, also return critique embedding predictions

    Output:
      scores:          (B, 16)   sigmoided design scores
      critique_emb:    (B, 3072) predicted OpenAI text-embedding-3-large vec
                                 (only if return_aux=True)
    """

    def __init__(self, visual_dim: int = 1280, code_dim: int = 64,
                 dropout: float = 0.5, critique_dim: int = CRITIQUE_DIM):
        super().__init__()

        # ── Main head (identical to train_v2.DesignHead) ──
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

        self.output = nn.Linear(64, OUTPUT_DIM)

        # ── Auxiliary critique-embedding head (new in v5) ──
        # Branches from the 64-dim pre-output layer.  No dropout on the
        # aux path — the target signal is rarer and we don't want to
        # weaken it further.
        self.aux_fc1 = nn.Linear(64, 256)
        self.aux_fc2 = nn.Linear(256, 512)
        self.aux_out = nn.Linear(512, critique_dim)

    def __call__(self, visual_features, code_features=None, return_aux: bool = False):
        v = self.drop1(nn.gelu(self.vis_norm(self.vis_proj(visual_features))))

        if code_features is not None:
            c = nn.gelu(self.code_norm(self.code_proj(code_features)))
        else:
            c = mx.zeros((v.shape[0], 128))

        x = mx.concatenate([v, c], axis=-1)

        x = self.drop1(nn.gelu(self.ln1(self.fc1(x))))
        x = self.drop2(nn.gelu(self.ln2(self.fc2(x))))
        h64 = self.drop3(nn.gelu(self.ln3(self.fc3(x))))  # shared 64-dim layer

        scores = mx.sigmoid(self.output(h64))

        if return_aux:
            aux = nn.gelu(self.aux_fc1(h64))
            aux = nn.gelu(self.aux_fc2(aux))
            critique_emb = self.aux_out(aux)
            return scores, critique_emb
        return scores

    def param_count(self):
        return sum(p.size for _, p in tree_flatten(self.parameters()))


# ═══════════════════════════════════════════════════
# CRITIQUE EMBEDDING LOOKUP
# ═══════════════════════════════════════════════════


def load_critique_embeddings():
    """Return dict[cycle_id: int] → np.ndarray[3072]. Empty if archive missing."""
    if not CRITIQUE_EMBEDDINGS_PATH.exists():
        return {}
    try:
        with np.load(CRITIQUE_EMBEDDINGS_PATH) as npz:
            cycle_ids = npz["cycle_ids"].tolist()
            embeddings = npz["embeddings"]
            if len(cycle_ids) != embeddings.shape[0]:
                print(f"[v5] WARNING: critique archive cycle_ids/embeddings length mismatch")
                return {}
            return {int(cid): embeddings[i] for i, cid in enumerate(cycle_ids)}
    except Exception as e:
        print(f"[v5] WARNING: failed to load critique embeddings: {e}")
        return {}


# Two manifest formats observed:
#   source_name = "self-train-13"        → matches group 1 below
#   code_path   = ".../cycle-13.html"    → matches group 2 below
# Both should yield cycle_id = 13.
_CYCLE_RE = re.compile(r"(?:self[-_]train[-_](\d+))|(?:cycle[-_]?(\d+))", re.IGNORECASE)


def extract_cycle_id(source_name: str) -> int | None:
    """Try to pull a cycle number out of a manifest source_name or path."""
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
# DATASET
# ═══════════════════════════════════════════════════


class FeatureDatasetV5:
    """Loads manifest samples + joins critique embeddings by cycle_id."""

    def __init__(self):
        with open(MANIFEST_PATH) as f:
            data = json.load(f)

        self.critique_by_cycle = load_critique_embeddings()

        self.features = []
        self.targets = []
        self.code_features = []
        self.critique_embeddings = []
        self.critique_mask = []
        self.names = []

        matched = 0
        for sample in data["samples"]:
            feat = sample.get("mobilenet_features")
            if not feat or len(feat) != 1280:
                continue

            scores = sample.get("scores", {})
            target = [float(scores.get(n, 0.5)) for n in SCORE_NAMES]

            self.features.append(feat)
            self.targets.append(target)

            # Code features (64-dim, zero-fill if missing)
            code = sample.get("code_features")
            if code and len(code) == 64:
                self.code_features.append(code)
            else:
                self.code_features.append([0.0] * 64)

            # Critique embedding lookup
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

        self.n_matched = matched

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

    def get_batch(self, indices):
        feats = mx.array(np.array([self.features[i] for i in indices], dtype=np.float32))
        targets = mx.array(np.array([self.targets[i] for i in indices], dtype=np.float32))
        codes = mx.array(np.array([self.code_features[i] for i in indices], dtype=np.float32))
        crits = mx.array(np.array([self.critique_embeddings[i] for i in indices], dtype=np.float32))
        mask = mx.array(np.array([self.critique_mask[i] for i in indices], dtype=np.float32))
        return feats, targets, codes, crits, mask


# ═══════════════════════════════════════════════════
# LOSS
# ═══════════════════════════════════════════════════


def weighted_mse_loss(predictions, targets, confidence=None):
    diff = predictions - targets
    loss = diff * diff * DIMENSION_WEIGHTS
    if confidence is not None:
        loss = loss * confidence[:, None]

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
    """Mean cosine distance (1 - cos_sim) over masked samples.

    Samples with mask==0 contribute 0 to the loss.  If the mask is
    all-zero, returns 0 (no aux signal this batch).
    """
    # L2 normalize both
    pred_norm = pred_emb / (mx.linalg.norm(pred_emb, axis=-1, keepdims=True) + 1e-8)
    target_norm = target_emb / (mx.linalg.norm(target_emb, axis=-1, keepdims=True) + 1e-8)

    cos_sim = mx.sum(pred_norm * target_norm, axis=-1)  # (B,)
    distance = 1.0 - cos_sim                              # (B,)

    masked = distance * mask
    denom = mx.maximum(mx.sum(mask), mx.array(1.0))
    return mx.sum(masked) / denom


def make_loss_fn(aux_enabled: bool, aux_weight: float):
    """Returns a closure appropriate for value_and_grad."""
    if aux_enabled:
        def loss_fn(model, features, targets, code_features, crits, mask):
            predictions, critique_preds = model(features, code_features, return_aux=True)
            main = weighted_mse_loss(predictions, targets)
            aux = cosine_distance_masked(critique_preds, crits, mask)
            return main + aux_weight * aux
        return loss_fn
    else:
        def loss_fn(model, features, targets, code_features, _crits, _mask):
            predictions = model(features, code_features)
            return weighted_mse_loss(predictions, targets)
        return loss_fn


# ═══════════════════════════════════════════════════
# TRAINING
# ═══════════════════════════════════════════════════


def train(epochs=200, batch_size=16, learning_rate=1e-3, weight_decay=0.05,
          warmup_steps=20, patience=30, dropout=0.5, label_smoothing=0.0,
          aux_weight=DEFAULT_AUX_WEIGHT, disable_aux=False):

    print("[v5] loading pre-extracted features + critique embeddings...")
    dataset = FeatureDatasetV5()
    print(f"[v5] {len(dataset)} samples with 1280-dim MobileNet V2 features")
    print(f"[v5] critique embeddings matched: {dataset.n_matched} / {len(dataset)}")

    # Aux head is enabled only if we have enough matched samples AND the
    # user didn't force it off.  Below MIN_AUX_SAMPLES the gradient is
    # too sparse to be useful.
    aux_enabled = (not disable_aux) and (dataset.n_matched >= MIN_AUX_SAMPLES)
    if aux_enabled:
        print(f"[v5] ✨ aux head ENABLED (aux_weight={aux_weight})")
    elif disable_aux:
        print(f"[v5] aux head DISABLED (--disable-aux)")
    else:
        print(f"[v5] aux head DISABLED (only {dataset.n_matched} matched samples, need {MIN_AUX_SAMPLES}+). "
              f"Behaves like train_v2 — saves a v5 checkpoint for forward-compat.")

    train_idx, val_idx = dataset.split()
    print(f"[v5] split: {len(train_idx)} train, {len(val_idx)} val")

    model = DesignHeadV5(dropout=dropout)
    print(f"[v5] head: {model.param_count():,} params (main + aux combined)")

    optimizer = optim.AdamW(learning_rate=learning_rate, weight_decay=weight_decay)
    steps_per_epoch = max(1, len(train_idx) // batch_size)
    total_steps = epochs * steps_per_epoch

    loss_fn = make_loss_fn(aux_enabled, aux_weight)
    loss_and_grad = nn.value_and_grad(model, loss_fn)

    best_val_loss = float("inf")
    patience_counter = 0
    global_step = 0
    best_per_dim = None

    print(f"[v5] training: {epochs} epochs, batch {batch_size}, lr {learning_rate}")
    print(f"[v5] regularization: dropout={dropout}, weight_decay={weight_decay}")
    print()

    for epoch in range(epochs):
        model.train()
        t0 = time.time()

        rng = np.random.default_rng(epoch)
        shuffled = rng.permutation(train_idx).tolist()

        epoch_loss = 0
        epoch_steps = 0

        for start in range(0, len(shuffled), batch_size):
            batch_idx = shuffled[start:start + batch_size]
            feats, targets, codes, crits, mask = dataset.get_batch(batch_idx)

            if label_smoothing > 0:
                targets = targets * (1 - label_smoothing) + 0.5 * label_smoothing

            if global_step < warmup_steps:
                lr = learning_rate * global_step / max(warmup_steps, 1)
            else:
                progress = (global_step - warmup_steps) / max(total_steps - warmup_steps, 1)
                lr = 1e-6 + 0.5 * (learning_rate - 1e-6) * (1 + math.cos(math.pi * progress))
            optimizer.learning_rate = lr

            loss, grads = loss_and_grad(model, feats, targets, codes, crits, mask)

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

        # Validation (main-task only — aux doesn't affect early stopping)
        model.eval()
        val_feats, val_targets, val_codes, _vc, _vm = dataset.get_batch(val_idx)
        val_preds = model(val_feats, val_codes)
        val_loss = weighted_mse_loss(val_preds, val_targets)
        mx.eval(val_loss, val_preds)
        val_loss = float(val_loss)

        diff = mx.abs(val_preds - val_targets)
        mx.eval(diff)
        per_dim = [float(mx.mean(diff[:, i])) for i in range(OUTPUT_DIM)]

        elapsed = time.time() - t0

        if (epoch + 1) % 10 == 0 or val_loss < best_val_loss:
            print(f"  epoch {epoch + 1:4d}/{epochs} | "
                  f"train {avg_train:.4f} | val {val_loss:.4f} | "
                  f"lr {lr:.2e} | {elapsed:.2f}s")

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            patience_counter = 0
            best_per_dim = per_dim

            WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
            path = WEIGHTS_DIR / "design-head-v5.safetensors"
            model.save_weights(str(path))

            dim_str = " | ".join(f"{SCORE_NAMES[i][:6]}={per_dim[i]:.3f}" for i in range(OUTPUT_DIM))
            print(f"  >>> best: {dim_str}")
        else:
            patience_counter += 1

        if patience_counter >= patience:
            print(f"\n[v5] early stopping at epoch {epoch + 1}")
            break

    print(f"\n[v5] training complete!")
    print(f"[v5] best val loss: {best_val_loss:.4f}")

    if best_per_dim:
        print(f"\n[v5] per-dimension MAE at best:")
        for i, name in enumerate(SCORE_NAMES):
            bar = "█" * int(best_per_dim[i] * 50)
            print(f"  {name:25s}: {best_per_dim[i]:.4f} {bar}")

    meta = {
        "best_val_loss": best_val_loss,
        "epochs": epoch + 1,
        "per_dim_mae": {n: best_per_dim[i] for i, n in enumerate(SCORE_NAMES)} if best_per_dim else {},
        "param_count": model.param_count(),
        "backbone": "mobilenet_v2_imagenet",
        "feature_dim": 1280,
        "aux_head_enabled": aux_enabled,
        "aux_weight": aux_weight if aux_enabled else 0.0,
        "critique_samples_matched": dataset.n_matched,
        "critique_total_samples": len(dataset),
    }
    with open(WEIGHTS_DIR / "train-v5-meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    return meta


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train Phase 5 design head + critique aux")
    parser.add_argument("--epochs", type=int, default=200)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=0.05)
    parser.add_argument("--warmup", type=int, default=20)
    parser.add_argument("--patience", type=int, default=30)
    parser.add_argument("--dropout", type=float, default=0.5)
    parser.add_argument("--aux-weight", type=float, default=DEFAULT_AUX_WEIGHT,
                        help="Weight of the auxiliary critique-embedding loss")
    parser.add_argument("--disable-aux", action="store_true",
                        help="Force disable the aux head (equivalent to train_v2)")
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
        disable_aux=args.disable_aux,
    )
