"""
Design Model Training — MLX GPU training pipeline for M4 Max.

Optimized for Apple Silicon:
  - bfloat16 mixed precision (halves memory, stable training)
  - Gradient checkpointing on backbone
  - Batch size 32 to saturate 40-core GPU
  - Unified memory = zero data transfer overhead
  - Per-dimension weighted MSE loss
  - Cosine annealing learning rate with warmup
  - Early stopping with patience
  - Automatic weight saving with best validation loss

Usage:
  python train.py                           # Train on dataset in data/
  python train.py --epochs 100 --batch 32   # Custom settings
  python train.py --resume                  # Resume from checkpoint
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

from model import DesignEvaluator, create_model, save_weights, OUTPUT_DIM
from data import DesignDataset, DIMENSION_WEIGHTS, SCORE_NAMES

WEIGHTS_DIR = Path(__file__).parent.parent / "weights"


# ═══════════════════════════════════════════════════
# LOSS FUNCTION
# ═══════════════════════════════════════════════════


def weighted_mse_loss(predictions, targets):
    """
    Per-dimension weighted MSE loss.
    Dimensions like emotional_resonance and overall_aesthetic are weighted higher.
    """
    diff = predictions - targets
    weighted = diff * diff * DIMENSION_WEIGHTS
    return mx.mean(weighted)


def loss_fn(model, images, targets, code_features=None):
    """Compute loss for a batch."""
    predictions = model(images, code_features)
    return weighted_mse_loss(predictions, targets)


# ═══════════════════════════════════════════════════
# LEARNING RATE SCHEDULE
# ═══════════════════════════════════════════════════


def cosine_warmup_lr(step, warmup_steps, total_steps, base_lr, min_lr=1e-6):
    """Cosine annealing with linear warmup."""
    if step < warmup_steps:
        return base_lr * step / max(warmup_steps, 1)
    progress = (step - warmup_steps) / max(total_steps - warmup_steps, 1)
    return min_lr + 0.5 * (base_lr - min_lr) * (1 + math.cos(math.pi * progress))


# ═══════════════════════════════════════════════════
# TRAINING LOOP
# ═══════════════════════════════════════════════════


def train(
    epochs: int = 50,
    batch_size: int = 32,
    learning_rate: float = 3e-4,
    warmup_steps: int = 100,
    weight_decay: float = 0.01,
    gradient_clip: float = 1.0,
    patience: int = 10,
    val_ratio: float = 0.15,
    data_dir: str = None,
    resume: bool = False,
    version: int = 1,
):
    """Main training loop."""

    # Load dataset
    print("[train] loading dataset...")
    dataset = DesignDataset(data_dir)

    if len(dataset) == 0:
        print("[train] ERROR: no training data found. Add samples to data/manifest.json first.")
        print("[train] Use the JS trainer (trainWithLLMJudge) to bootstrap data, or add screenshots manually.")
        return

    train_ds, val_ds = dataset.split(val_ratio)
    print(f"[train] dataset: {len(train_ds)} train, {len(val_ds)} val")
    print(f"[train] stats: {json.dumps(dataset.stats()['sources'], indent=2)}")

    # Create model
    model = create_model(load=resume, version=version)
    print(f"[train] model: {model.param_count():,} parameters")

    # Optimizer (AdamW — best for vision models)
    optimizer = optim.AdamW(learning_rate=learning_rate, weight_decay=weight_decay)

    # Compute total steps for LR schedule
    steps_per_epoch = max(1, len(train_ds) // batch_size)
    total_steps = epochs * steps_per_epoch

    # Training state
    best_val_loss = float("inf")
    patience_counter = 0
    global_step = 0
    history = {"train_loss": [], "val_loss": [], "lr": []}

    loss_and_grad_fn = nn.value_and_grad(model, loss_fn)

    print(f"[train] starting training: {epochs} epochs, batch {batch_size}, lr {learning_rate}")
    print(f"[train] device: {mx.default_device()}")
    print()

    for epoch in range(epochs):
        t0 = time.time()
        model.train()

        epoch_loss = 0
        epoch_steps = 0

        for batch_imgs, batch_targets, batch_features in train_ds.batches(batch_size):
            # Update learning rate
            lr = cosine_warmup_lr(global_step, warmup_steps, total_steps, learning_rate)
            optimizer.learning_rate = lr

            # Forward + backward
            loss, grads = loss_and_grad_fn(model, batch_imgs, batch_targets, batch_features)

            # Gradient clipping (handles nested parameter dicts)
            grad_flat = tree_flatten(grads)
            grad_norm = mx.sqrt(sum(mx.sum(g * g) for _, g in grad_flat))
            if grad_norm > gradient_clip:
                scale = gradient_clip / (grad_norm + 1e-8)
                grads = tree_map(lambda g: g * scale, grads)

            # Update
            optimizer.update(model, grads)
            mx.eval(model.parameters(), optimizer.state, loss)

            epoch_loss += float(loss)
            epoch_steps += 1
            global_step += 1

        avg_train_loss = epoch_loss / max(epoch_steps, 1)

        # Validation
        model.eval()
        val_loss = 0
        val_steps = 0
        per_dim_errors = [0.0] * OUTPUT_DIM

        for batch_imgs, batch_targets, batch_features in val_ds.batches(batch_size, shuffle=False):
            predictions = model(batch_imgs, batch_features)
            loss = weighted_mse_loss(predictions, batch_targets)
            mx.eval(loss)
            val_loss += float(loss)
            val_steps += 1

            # Per-dimension errors
            diff = mx.abs(predictions - batch_targets)
            mx.eval(diff)
            for i in range(OUTPUT_DIM):
                per_dim_errors[i] += float(mx.mean(diff[:, i]))

        avg_val_loss = val_loss / max(val_steps, 1)
        per_dim_avg = [e / max(val_steps, 1) for e in per_dim_errors]

        elapsed = time.time() - t0
        current_lr = cosine_warmup_lr(global_step, warmup_steps, total_steps, learning_rate)

        history["train_loss"].append(avg_train_loss)
        history["val_loss"].append(avg_val_loss)
        history["lr"].append(current_lr)

        # Print progress
        print(f"  epoch {epoch + 1:3d}/{epochs} | "
              f"train {avg_train_loss:.4f} | "
              f"val {avg_val_loss:.4f} | "
              f"lr {current_lr:.2e} | "
              f"{elapsed:.1f}s")

        # Best model saving
        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            patience_counter = 0
            save_weights(model, version=version)

            # Log per-dimension performance
            dim_report = " | ".join(f"{SCORE_NAMES[i][:8]}={per_dim_avg[i]:.3f}" for i in range(OUTPUT_DIM))
            print(f"  >>> best val loss: {best_val_loss:.4f}")
            print(f"  >>> per-dim: {dim_report}")
        else:
            patience_counter += 1

        # Early stopping
        if patience_counter >= patience:
            print(f"\n[train] early stopping at epoch {epoch + 1} (patience {patience})")
            break

    # Save training history
    history_path = WEIGHTS_DIR / f"train-history-v{version}.json"
    WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
    with open(history_path, "w") as f:
        json.dump(history, f, indent=2)

    print(f"\n[train] complete! best val loss: {best_val_loss:.4f}")
    print(f"[train] weights: {WEIGHTS_DIR / f'mlx-design-v{version}.safetensors'}")
    print(f"[train] history: {history_path}")

    return {
        "best_val_loss": best_val_loss,
        "epochs_trained": epoch + 1,
        "param_count": model.param_count(),
        "history": history,
    }


# ═══════════════════════════════════════════════════
# EVALUATION
# ═══════════════════════════════════════════════════


def evaluate_model(version: int = 1, data_dir: str = None, batch_size: int = 32):
    """Evaluate a trained model on the full dataset."""
    dataset = DesignDataset(data_dir, augment=False)
    if len(dataset) == 0:
        print("[eval] no data")
        return

    model = create_model(load=True, version=version)
    model.eval()

    total_loss = 0
    total_steps = 0
    per_dim_errors = [0.0] * OUTPUT_DIM

    for batch_imgs, batch_targets, batch_features in dataset.batches(batch_size, shuffle=False):
        predictions = model(batch_imgs, batch_features)
        loss = weighted_mse_loss(predictions, batch_targets)
        mx.eval(loss, predictions)
        total_loss += float(loss)
        total_steps += 1

        diff = mx.abs(predictions - batch_targets)
        mx.eval(diff)
        for i in range(OUTPUT_DIM):
            per_dim_errors[i] += float(mx.mean(diff[:, i]))

    avg_loss = total_loss / max(total_steps, 1)
    per_dim_avg = [e / max(total_steps, 1) for e in per_dim_errors]

    print(f"[eval] loss: {avg_loss:.4f}")
    print("[eval] per-dimension MAE:")
    for i, name in enumerate(SCORE_NAMES):
        print(f"  {name:25s}: {per_dim_avg[i]:.4f}")


# ═══════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train design evaluation model on M4 Max")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--warmup", type=int, default=100)
    parser.add_argument("--patience", type=int, default=10)
    parser.add_argument("--data", type=str, default=None)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--version", type=int, default=1)
    parser.add_argument("--eval-only", action="store_true")
    args = parser.parse_args()

    if args.eval_only:
        evaluate_model(version=args.version, data_dir=args.data, batch_size=args.batch)
    else:
        train(
            epochs=args.epochs,
            batch_size=args.batch,
            learning_rate=args.lr,
            warmup_steps=args.warmup,
            patience=args.patience,
            data_dir=args.data,
            resume=args.resume,
            version=args.version,
        )
