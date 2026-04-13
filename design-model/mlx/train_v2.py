#!/usr/bin/env python3
"""
Train Phase 2b Design Head on pre-extracted MobileNet V2 features.

This trains ONLY the design evaluation head (~870K params) on 1280-dim
ImageNet features pre-extracted by extract_features.py.

Training is extremely fast (sub-second per epoch) because:
  - No CNN forward pass — features are pre-computed
  - Small model (~870K params)
  - MLX GPU acceleration on M4 Max

Usage:
  python train_v2.py                         # Default training
  python train_v2.py --epochs 200 --lr 1e-3  # Custom settings
"""

import argparse
import json
import math
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

OUTPUT_DIM = 12

SCORE_NAMES = [
    "typography_quality", "color_harmony", "spatial_composition",
    "motion_elegance", "emotional_resonance", "craft_visibility",
    "minimalism_coherence", "native_integration",
    "visceral_score", "behavioral_score", "reflective_score",
    "overall_aesthetic",
]

DIMENSION_WEIGHTS = mx.array([
    1.2, 1.1, 1.1, 0.9, 1.3, 1.2, 1.0, 1.0,
    1.2, 1.0, 1.1, 1.5,
], dtype=mx.float32)


# ═══════════════════════════════════════════════════
# DESIGN HEAD MODEL
# ═══════════════════════════════════════════════════


class DesignHead(nn.Module):
    """
    Design evaluation head trained on pre-extracted visual features.

    Input: (B, 1280) MobileNet features + (B, 64) code features (optional)
    Output: (B, 12) design quality scores
    """

    def __init__(self, visual_dim: int = 1280, code_dim: int = 64,
                 dropout: float = 0.5):
        super().__init__()

        # Visual feature projection
        self.vis_proj = nn.Linear(visual_dim, 384)
        self.vis_norm = nn.LayerNorm(384)

        # Code feature projection
        self.code_proj = nn.Linear(code_dim, 128)
        self.code_norm = nn.LayerNorm(128)

        input_dim = 384 + 128

        # Classifier with strong regularization
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

    def __call__(self, visual_features, code_features=None):
        v = self.drop1(nn.gelu(self.vis_norm(self.vis_proj(visual_features))))

        if code_features is not None:
            c = nn.gelu(self.code_norm(self.code_proj(code_features)))
        else:
            c = mx.zeros((v.shape[0], 128))

        x = mx.concatenate([v, c], axis=-1)

        x = self.drop1(nn.gelu(self.ln1(self.fc1(x))))
        x = self.drop2(nn.gelu(self.ln2(self.fc2(x))))
        x = self.drop3(nn.gelu(self.ln3(self.fc3(x))))
        x = mx.sigmoid(self.output(x))
        return x

    def param_count(self):
        return sum(p.size for _, p in tree_flatten(self.parameters()))


# ═══════════════════════════════════════════════════
# DATASET
# ═══════════════════════════════════════════════════


class FeatureDataset:
    """Load pre-extracted features from manifest."""

    def __init__(self):
        with open(MANIFEST_PATH) as f:
            data = json.load(f)

        self.features = []
        self.targets = []
        self.code_features = []
        self.names = []

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

            name = sample.get("metadata", {}).get("source_name") or \
                   sample.get("metadata", {}).get("category", "unknown")
            quality = sample.get("metadata", {}).get("quality_target", "?")
            self.names.append(f"{name} ({quality})")

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
        return feats, targets, codes


# ═══════════════════════════════════════════════════
# TRAINING
# ═══════════════════════════════════════════════════


def weighted_mse_loss(predictions, targets):
    diff = predictions - targets
    return mx.mean(diff * diff * DIMENSION_WEIGHTS)


def loss_fn(model, features, targets, code_features):
    predictions = model(features, code_features)
    return weighted_mse_loss(predictions, targets)


def train(epochs=200, batch_size=16, learning_rate=1e-3, weight_decay=0.05,
          warmup_steps=20, patience=30, dropout=0.5, label_smoothing=0.0):

    print("[v2] loading pre-extracted features...")
    dataset = FeatureDataset()
    print(f"[v2] {len(dataset)} samples with 1280-dim MobileNet V2 features")

    train_idx, val_idx = dataset.split()
    print(f"[v2] split: {len(train_idx)} train, {len(val_idx)} val")

    # Model
    model = DesignHead(dropout=dropout)
    print(f"[v2] head: {model.param_count():,} params")

    # Optimizer
    optimizer = optim.AdamW(learning_rate=learning_rate, weight_decay=weight_decay)

    # Total steps for cosine schedule
    steps_per_epoch = max(1, len(train_idx) // batch_size)
    total_steps = epochs * steps_per_epoch

    loss_and_grad = nn.value_and_grad(model, loss_fn)

    best_val_loss = float("inf")
    patience_counter = 0
    global_step = 0
    best_per_dim = None

    print(f"[v2] training: {epochs} epochs, batch {batch_size}, lr {learning_rate}")
    print(f"[v2] regularization: dropout={dropout}, weight_decay={weight_decay}")
    print()

    for epoch in range(epochs):
        model.train()
        t0 = time.time()

        # Shuffle training indices
        rng = np.random.default_rng(epoch)
        shuffled = rng.permutation(train_idx).tolist()

        epoch_loss = 0
        epoch_steps = 0

        for start in range(0, len(shuffled), batch_size):
            batch_idx = shuffled[start:start + batch_size]
            feats, targets, codes = dataset.get_batch(batch_idx)

            # Optional label smoothing
            if label_smoothing > 0:
                targets = targets * (1 - label_smoothing) + 0.5 * label_smoothing

            # LR schedule
            if global_step < warmup_steps:
                lr = learning_rate * global_step / max(warmup_steps, 1)
            else:
                progress = (global_step - warmup_steps) / max(total_steps - warmup_steps, 1)
                lr = 1e-6 + 0.5 * (learning_rate - 1e-6) * (1 + math.cos(math.pi * progress))
            optimizer.learning_rate = lr

            loss, grads = loss_and_grad(model, feats, targets, codes)

            # Gradient clipping
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

        # Validation
        model.eval()
        val_feats, val_targets, val_codes = dataset.get_batch(val_idx)
        val_preds = model(val_feats, val_codes)
        val_loss = weighted_mse_loss(val_preds, val_targets)
        mx.eval(val_loss, val_preds)
        val_loss = float(val_loss)

        # Per-dimension MAE
        diff = mx.abs(val_preds - val_targets)
        mx.eval(diff)
        per_dim = [float(mx.mean(diff[:, i])) for i in range(OUTPUT_DIM)]

        elapsed = time.time() - t0

        # Print every 10 epochs or on improvement
        if (epoch + 1) % 10 == 0 or val_loss < best_val_loss:
            print(f"  epoch {epoch + 1:4d}/{epochs} | "
                  f"train {avg_train:.4f} | val {val_loss:.4f} | "
                  f"lr {lr:.2e} | {elapsed:.2f}s")

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            patience_counter = 0
            best_per_dim = per_dim

            # Save best weights
            WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
            path = WEIGHTS_DIR / "design-head-v2.safetensors"
            model.save_weights(str(path))

            dim_str = " | ".join(f"{SCORE_NAMES[i][:6]}={per_dim[i]:.3f}" for i in range(OUTPUT_DIM))
            print(f"  >>> best: {dim_str}")
        else:
            patience_counter += 1

        if patience_counter >= patience:
            print(f"\n[v2] early stopping at epoch {epoch + 1}")
            break

    print(f"\n[v2] training complete!")
    print(f"[v2] best val loss: {best_val_loss:.4f}")

    if best_per_dim:
        print(f"\n[v2] per-dimension MAE at best:")
        for i, name in enumerate(SCORE_NAMES):
            bar = "█" * int(best_per_dim[i] * 50)
            print(f"  {name:25s}: {best_per_dim[i]:.4f} {bar}")

    # Save training metadata
    meta = {
        "best_val_loss": best_val_loss,
        "epochs": epoch + 1,
        "per_dim_mae": {n: best_per_dim[i] for i, n in enumerate(SCORE_NAMES)} if best_per_dim else {},
        "param_count": model.param_count(),
        "backbone": "mobilenet_v2_imagenet",
        "feature_dim": 1280,
    }
    with open(WEIGHTS_DIR / "train-v2-meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    return meta


# ═══════════════════════════════════════════════════
# EVALUATION
# ═══════════════════════════════════════════════════


def evaluate():
    """Evaluate the trained head on all samples."""
    dataset = FeatureDataset()

    model = DesignHead()
    path = WEIGHTS_DIR / "design-head-v2.safetensors"
    model.load_weights(str(path))
    model.eval()
    print(f"[v2-eval] loaded model: {model.param_count():,} params")

    all_idx = list(range(len(dataset)))
    feats, targets, codes = dataset.get_batch(all_idx)
    preds = model(feats, codes)
    mx.eval(preds)

    print(f"\n{'Name':30s} | {'Predicted':>9s} | {'Target':>7s} | {'Diff':>6s} |")
    print("-" * 65)

    for i in range(len(dataset)):
        pred_overall = float(preds[i][SCORE_NAMES.index("overall_aesthetic")])
        tgt_overall = float(targets[i][SCORE_NAMES.index("overall_aesthetic")])
        diff = abs(pred_overall - tgt_overall)
        marker = "✅" if diff < 0.10 else "🟡" if diff < 0.20 else "❌"
        print(f"  {dataset.names[i]:28s} | {pred_overall:9.3f} | {tgt_overall:7.3f} | {diff:6.3f} | {marker}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train Phase 2b design head")
    parser.add_argument("--epochs", type=int, default=300)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--wd", type=float, default=0.05)
    parser.add_argument("--warmup", type=int, default=20)
    parser.add_argument("--patience", type=int, default=40)
    parser.add_argument("--dropout", type=float, default=0.5)
    parser.add_argument("--label-smoothing", type=float, default=0.05)
    parser.add_argument("--eval", action="store_true")
    args = parser.parse_args()

    if args.eval:
        evaluate()
    else:
        train(
            epochs=args.epochs,
            batch_size=args.batch,
            learning_rate=args.lr,
            weight_decay=args.wd,
            warmup_steps=args.warmup,
            patience=args.patience,
            dropout=args.dropout,
            label_smoothing=args.label_smoothing,
        )
