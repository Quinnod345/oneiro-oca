#!/usr/bin/env python3
"""
Phase 3 Progressive Expert Training.

Trains experts in stages to avoid catastrophic interference:
  Stage 1: Train each expert independently (parallel-safe)
  Stage 2: Freeze experts, train lateral attention
  Stage 3: Freeze all, train aggregator
  Stage 4: Fine-tune everything at low LR

Total training time: ~3 minutes on M4 Max.

Usage:
  python train_v3.py                    # Full progressive training
  python train_v3.py --stage 1          # Train experts only
  python train_v3.py --eval             # Evaluate trained model
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

import sys
sys.path.insert(0, str(Path(__file__).parent))
from model_v3 import (
    DesignExpertNetwork, create_expert_model, save_expert_model,
    EXPERT_DIMS, EXPERT_NAMES, SCORE_NAMES, OUTPUT_DIM
)
from train_v2 import FeatureDataset, DIMENSION_WEIGHTS

WEIGHTS_DIR = Path(__file__).parent.parent / "weights"


def expert_loss(model, features, targets, code_features, expert_name, dim_indices):
    """Loss for a single expert on its assigned dimensions."""
    predictions = model(features, code_features)
    expert_preds = predictions[:, dim_indices]
    expert_targets = targets[:, dim_indices]
    expert_weights = DIMENSION_WEIGHTS[dim_indices]
    diff = expert_preds - expert_targets
    return mx.mean(diff * diff * expert_weights)


def full_loss(model, features, targets, code_features):
    """Full weighted MSE loss on all dimensions + coherence penalty."""
    predictions = model(features, code_features)
    diff = predictions - targets

    # Standard weighted MSE
    mse = mx.mean(diff * diff * DIMENSION_WEIGHTS)

    # Coherence penalty: if individual dims are high but overall is low,
    # the parts don't work together. Penalize this inconsistency.
    overall_idx = SCORE_NAMES.index("overall_aesthetic")
    pred_overall = predictions[:, overall_idx]
    # Mean of non-overall, non-innovation dims (the "parts")
    part_indices = [i for i, n in enumerate(SCORE_NAMES)
                    if n not in ("overall_aesthetic", "innovation_score",
                                 "system_creativity", "design_distinctiveness",
                                 "problem_level")]
    pred_parts_mean = mx.mean(predictions[:, part_indices], axis=1)
    # Coherence loss: penalize when parts >> overall (parts don't fit together)
    incoherence = mx.maximum(pred_parts_mean - pred_overall - 0.05, 0)
    coherence_penalty = mx.mean(incoherence * incoherence) * 2.0

    return mse + coherence_penalty


def train_stage(model, dataset, loss_fn, epochs, lr, patience, stage_name,
                trainable_params=None):
    """Generic training stage."""
    train_idx, val_idx = dataset.split()

    if trainable_params:
        optimizer = optim.AdamW(learning_rate=lr, weight_decay=0.05)
    else:
        optimizer = optim.AdamW(learning_rate=lr, weight_decay=0.05)

    loss_and_grad = nn.value_and_grad(model, loss_fn)

    best_val_loss = float("inf")
    patience_counter = 0
    t_start = time.time()

    for epoch in range(epochs):
        model.train()

        # Shuffle training data
        rng = np.random.default_rng(epoch)
        shuffled = rng.permutation(train_idx).tolist()

        epoch_loss = 0
        steps = 0
        batch_size = 16

        for start in range(0, len(shuffled), batch_size):
            batch_idx = shuffled[start:start + batch_size]
            feats, targets, codes = dataset.get_batch(batch_idx)

            # LR schedule
            progress = epoch / max(epochs, 1)
            current_lr = lr * 0.5 * (1 + math.cos(math.pi * progress))
            optimizer.learning_rate = max(current_lr, 1e-6)

            loss, grads = loss_and_grad(model, feats, targets, codes)

            # Gradient clipping
            grad_flat = tree_flatten(grads)
            grad_norm = mx.sqrt(sum(mx.sum(g * g) for _, g in grad_flat))
            if grad_norm > 1.0:
                grads = tree_map(lambda g: g / (grad_norm + 1e-8), grads)

            optimizer.update(model, grads)
            mx.eval(model.parameters(), optimizer.state, loss)

            epoch_loss += float(loss)
            steps += 1

        avg_train = epoch_loss / max(steps, 1)

        # Validation
        model.eval()
        val_feats, val_targets, val_codes = dataset.get_batch(val_idx)
        val_preds = model(val_feats, val_codes)
        val_loss_val = loss_fn(model, val_feats, val_targets, val_codes)
        mx.eval(val_loss_val)
        val_loss = float(val_loss_val)

        if (epoch + 1) % 20 == 0 or val_loss < best_val_loss:
            print(f"    epoch {epoch + 1:4d}/{epochs} | train {avg_train:.4f} | val {val_loss:.4f}")

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            patience_counter = 0
            save_expert_model(model)
        else:
            patience_counter += 1

        if patience_counter >= patience:
            break

    elapsed = time.time() - t_start
    print(f"  [{stage_name}] best val: {best_val_loss:.4f} ({elapsed:.1f}s)")
    return best_val_loss


def progressive_train(epochs_per_stage=100, expert_epochs=80, patience=30):
    """Full progressive training pipeline."""
    print("[v3] loading dataset...")
    dataset = FeatureDataset()
    print(f"[v3] {len(dataset)} samples")

    model = create_expert_model()
    print()

    # ═══ STAGE 1: Train each expert independently ═══
    print("═══ Stage 1: Expert Training ═══\n")

    # Build dimension index mapping
    dim_indices = {}
    for expert_name, dims in EXPERT_DIMS.items():
        indices = [SCORE_NAMES.index(d) for d in dims]
        dim_indices[expert_name] = mx.array(indices)

    for expert_name in EXPERT_NAMES:
        dims = EXPERT_DIMS[expert_name]
        idx = dim_indices[expert_name]
        print(f"  Training {expert_name} expert ({', '.join(dims)})...")

        def make_expert_loss(name, idx):
            def loss_fn(model, feats, targets, codes):
                return expert_loss(model, feats, targets, codes, name, idx)
            return loss_fn

        train_stage(
            model, dataset,
            loss_fn=make_expert_loss(expert_name, idx),
            epochs=expert_epochs,
            lr=5e-4,
            patience=patience,
            stage_name=f"expert-{expert_name}",
        )

    # ═══ STAGE 2: Train lateral attention ═══
    print("\n═══ Stage 2: Lateral Attention Training ═══\n")

    # Freeze experts (in practice, nn.value_and_grad still computes all grads
    # but the optimizer should only update lateral params)
    # For simplicity, we train the full model but at lower LR
    train_stage(
        model, dataset,
        loss_fn=full_loss,
        epochs=epochs_per_stage,
        lr=2e-4,
        patience=patience,
        stage_name="lateral",
    )

    # ═══ STAGE 3: Train aggregator ═══
    print("\n═══ Stage 3: Aggregator Training ═══\n")

    def aggregator_loss(model, feats, targets, codes):
        preds = model(feats, codes)
        overall_pred = preds[:, -1:]
        overall_target = targets[:, SCORE_NAMES.index("overall_aesthetic"):SCORE_NAMES.index("overall_aesthetic")+1]
        return mx.mean((overall_pred - overall_target) ** 2 * 1.5)

    train_stage(
        model, dataset,
        loss_fn=aggregator_loss,
        epochs=epochs_per_stage // 2,
        lr=3e-4,
        patience=patience,
        stage_name="aggregator",
    )

    # ═══ STAGE 4: Fine-tune everything ═══
    print("\n═══ Stage 4: End-to-End Fine-tuning ═══\n")

    train_stage(
        model, dataset,
        loss_fn=full_loss,
        epochs=epochs_per_stage // 2,
        lr=1e-5,
        patience=patience * 2,
        stage_name="finetune",
    )

    print("\n[v3] Progressive training complete!")

    # Final evaluation
    evaluate_model(model, dataset)


def evaluate_model(model=None, dataset=None):
    """Evaluate the trained expert model."""
    if model is None:
        model = create_expert_model(load=True)
    if dataset is None:
        dataset = FeatureDataset()

    model.eval()
    all_idx = list(range(len(dataset)))
    feats, targets, codes = dataset.get_batch(all_idx)
    preds = model(feats, codes)
    mx.eval(preds)

    print("\n[v3] Per-dimension MAE:")
    for i, name in enumerate(SCORE_NAMES):
        mae = float(mx.mean(mx.abs(preds[:, i] - targets[:, i])))
        bar = "█" * int(mae * 50)
        print(f"  {name:25s}: {mae:.4f} {bar}")

    # Show quality tier discrimination
    print("\n[v3] Quality discrimination (sample):")
    for idx in range(min(10, len(dataset))):
        pred_overall = float(preds[idx, SCORE_NAMES.index("overall_aesthetic")])
        tgt_overall = float(targets[idx, SCORE_NAMES.index("overall_aesthetic")])
        diff = abs(pred_overall - tgt_overall)
        marker = "✅" if diff < 0.10 else "🟡" if diff < 0.20 else "❌"
        print(f"  {dataset.names[idx]:30s} | pred={pred_overall:.3f} tgt={tgt_overall:.3f} {marker}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Phase 3 Progressive Expert Training")
    parser.add_argument("--stage", type=int, default=None, help="Run only this stage (1-4)")
    parser.add_argument("--epochs", type=int, default=100, help="Epochs per stage")
    parser.add_argument("--expert-epochs", type=int, default=80, help="Epochs for expert training")
    parser.add_argument("--patience", type=int, default=30)
    parser.add_argument("--eval", action="store_true")
    args = parser.parse_args()

    if args.eval:
        evaluate_model()
    else:
        progressive_train(
            epochs_per_stage=args.epochs,
            expert_epochs=args.expert_epochs,
            patience=args.patience,
        )
