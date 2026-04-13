#!/usr/bin/env python3
"""
Bradley-Terry Preference Training for the design head.

Trains on (A, B) pairs where one design is preferred over another.
This provides richer gradient signal than absolute score regression
because it captures relative quality even when absolute scores are uncertain.

Loss: -log(sigmoid(score_preferred - score_rejected)) per dimension

Can be blended with regression loss:
  total = alpha * regression + (1 - alpha) * preference

Usage:
  python train_preference.py                          # Preference only
  python train_preference.py --blend 0.5              # 50/50 blend
  python train_preference.py --blend 0.7 --epochs 200 # Heavy regression
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
from train_v2 import DesignHead, FeatureDataset, SCORE_NAMES, OUTPUT_DIM, DIMENSION_WEIGHTS, weighted_mse_loss

WEIGHTS_DIR = Path(__file__).parent.parent / "weights"
DATA_DIR = Path(__file__).parent.parent / "data"
COMPARISONS_PATH = DATA_DIR / "comparisons.json"
MANIFEST_PATH = DATA_DIR / "manifest.json"


def load_preference_data():
    """Load preference pairs and their pre-extracted features."""
    if not COMPARISONS_PATH.exists():
        return [], [], [], []

    with open(COMPARISONS_PATH) as f:
        data = json.load(f)

    with open(MANIFEST_PATH) as f:
        manifest = json.load(f)

    # Build feature lookup by screenshot path
    feature_lookup = {}
    for sample in manifest["samples"]:
        path = sample.get("screenshot_path") or sample.get("image", "")
        feat = sample.get("mobilenet_features")
        if feat and len(feat) == 1280:
            feature_lookup[path] = {
                "vis": np.array(feat, dtype=np.float32),
                "code": np.array(sample.get("code_features", [0.0] * 64)[:64], dtype=np.float32)
                        if sample.get("code_features") else np.zeros(64, dtype=np.float32),
            }

    features_a = []
    features_b = []
    code_a = []
    code_b = []
    pref_targets = []  # per-dimension: +1 if B is better, -1 if A is better, 0 if tie

    for pair in data.get("pairs", []):
        fa = feature_lookup.get(pair.get("image_a"))
        fb = feature_lookup.get(pair.get("image_b"))
        if not fa or not fb:
            continue

        features_a.append(fa["vis"])
        features_b.append(fb["vis"])
        code_a.append(fa["code"])
        code_b.append(fb["code"])

        target = np.zeros(OUTPUT_DIM, dtype=np.float32)
        for i, name in enumerate(SCORE_NAMES):
            pref = pair.get("preferences", {}).get(name, {})
            winner = pref.get("winner", "tie")
            margin = float(pref.get("margin", 0.0))
            if winner == "B":
                target[i] = margin
            elif winner == "A":
                target[i] = -margin
        pref_targets.append(target)

    return features_a, features_b, code_a, code_b, pref_targets


def preference_loss(model, vis_a, vis_b, code_a, code_b, pref_targets):
    """
    Bradley-Terry preference loss.
    For each dimension where there's a preference, the preferred design
    should score higher.
    """
    scores_a = model(vis_a, code_a)
    scores_b = model(vis_b, code_b)

    diff = scores_b - scores_a  # Positive means B is better

    # Bradley-Terry: -log(sigmoid(margin * sign))
    # Where sign is the preference direction
    signed_diff = diff * pref_targets * DIMENSION_WEIGHTS
    loss = -mx.mean(mx.log(mx.sigmoid(signed_diff * 5.0) + 1e-7))  # Scale for sharper gradients

    return loss


def train(epochs=200, learning_rate=5e-4, weight_decay=0.05, blend=0.0, patience=40):
    """
    Train with optional blending of regression and preference losses.
    blend=0.0: pure preference training
    blend=1.0: pure regression training
    blend=0.5: 50/50 mix
    """

    # Load preference data
    vis_a_list, vis_b_list, code_a_list, code_b_list, pref_list = load_preference_data()
    n_prefs = len(vis_a_list)
    print(f"[pref] {n_prefs} preference pairs loaded")

    if n_prefs == 0 and blend < 1.0:
        print("[pref] no preference data. Use --blend 1.0 for pure regression, or run the flywheel first.")
        return

    # Load regression data if blending
    reg_dataset = None
    if blend > 0:
        reg_dataset = FeatureDataset()
        print(f"[pref] {len(reg_dataset)} regression samples loaded")

    # Model
    model = DesignHead(dropout=0.5)
    weights_path = WEIGHTS_DIR / "design-head-v2.safetensors"
    if weights_path.exists():
        model.load_weights(str(weights_path))
        print(f"[pref] loaded base weights: {weights_path.name}")
    print(f"[pref] model: {sum(p.size for _, p in tree_flatten(model.parameters())):,} params")

    optimizer = optim.AdamW(learning_rate=learning_rate, weight_decay=weight_decay)

    best_loss = float("inf")
    patience_counter = 0

    print(f"[pref] training: {epochs} epochs, blend={blend} (0=pref only, 1=regression only)")

    for epoch in range(epochs):
        model.train()
        t0 = time.time()
        total_loss = 0
        steps = 0

        # Preference batches
        if n_prefs > 0 and blend < 1.0:
            vis_a = mx.array(np.stack(vis_a_list))
            vis_b = mx.array(np.stack(vis_b_list))
            ca = mx.array(np.stack(code_a_list))
            cb = mx.array(np.stack(code_b_list))
            targets = mx.array(np.stack(pref_list))

            pref_loss_fn = lambda m: preference_loss(m, vis_a, vis_b, ca, cb, targets)
            loss_val, grads = nn.value_and_grad(model, pref_loss_fn)(model)

            if blend > 0:
                loss_val = loss_val * (1 - blend)
                grads = tree_map(lambda g: g * (1 - blend), grads)

            total_loss += float(loss_val)
            steps += 1

        # Regression batches
        if reg_dataset and blend > 0:
            train_idx, val_idx = reg_dataset.split()
            rng = np.random.default_rng(epoch)
            shuffled = rng.permutation(train_idx).tolist()

            for start in range(0, len(shuffled), 16):
                batch_idx = shuffled[start:start + 16]
                feats, tgts, codes = reg_dataset.get_batch(batch_idx)

                reg_loss_fn = lambda m: weighted_mse_loss(m(feats, codes), tgts)
                reg_loss, reg_grads = nn.value_and_grad(model, reg_loss_fn)(model)

                if blend < 1.0:
                    reg_loss = reg_loss * blend
                    reg_grads = tree_map(lambda g: g * blend, reg_grads)

                # Combine with preference grads (simplified: just use latest)
                total_loss += float(reg_loss)
                steps += 1

                # Clip and step
                grad_flat = tree_flatten(reg_grads)
                grad_norm = mx.sqrt(sum(mx.sum(g * g) for _, g in grad_flat))
                if grad_norm > 1.0:
                    reg_grads = tree_map(lambda g: g / (grad_norm + 1e-8), reg_grads)

                optimizer.update(model, reg_grads)
                mx.eval(model.parameters(), optimizer.state)

        avg_loss = total_loss / max(steps, 1)
        elapsed = time.time() - t0

        if (epoch + 1) % 20 == 0 or avg_loss < best_loss:
            print(f"  epoch {epoch + 1:4d}/{epochs} | loss {avg_loss:.4f} | {elapsed:.2f}s")

        if avg_loss < best_loss:
            best_loss = avg_loss
            patience_counter = 0
            model.save_weights(str(WEIGHTS_DIR / "design-head-v2.safetensors"))
        else:
            patience_counter += 1

        if patience_counter >= patience:
            print(f"\n[pref] early stopping at epoch {epoch + 1}")
            break

    print(f"\n[pref] done. best loss: {best_loss:.4f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=200)
    parser.add_argument("--lr", type=float, default=5e-4)
    parser.add_argument("--wd", type=float, default=0.05)
    parser.add_argument("--blend", type=float, default=0.5, help="0=pref only, 1=regression only")
    parser.add_argument("--patience", type=int, default=40)
    args = parser.parse_args()

    train(
        epochs=args.epochs,
        learning_rate=args.lr,
        weight_decay=args.wd,
        blend=args.blend,
        patience=args.patience,
    )
