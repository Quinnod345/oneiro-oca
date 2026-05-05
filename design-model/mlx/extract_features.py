#!/usr/bin/env python3
"""
Extract MobileNet V2 features from all training images using PyTorch.

This pre-computes 1280-dim visual features for each screenshot,
so we can train the design head directly on features without needing
to run the CNN backbone during training.

Approach:
  1. Load pretrained MobileNet V2 (ImageNet)
  2. Remove classifier head (keep features only)
  3. Forward pass each image → 1280-dim feature vector
  4. Save features to manifest.json
  5. (--include-pre) Also save the features[17] output (B,7,7,320) to a
     sidecar .npz so train_v7 can fine-tune the final 1×1 conv (Phase 7)

Usage: python extract_features.py
       python extract_features.py --include-pre
"""

import argparse
import json
import os
from pathlib import Path

import numpy as np
import torch
import torchvision.models as models
import torchvision.transforms as T
from PIL import Image

DATA_DIR = Path(__file__).parent.parent / "data"
MANIFEST_PATH = DATA_DIR / "manifest.json"
PRE_FEATURES_PATH = DATA_DIR / "mobilenet_pre_features.npz"


def extract(include_pre: bool = False):
    print("[extract] loading MobileNet V2 pretrained backbone...")

    # Load model, remove classifier
    model = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.IMAGENET1K_V1)
    model.eval()

    # Backbone split: features[0..17] outputs the (B, 320, 7, 7) tensor that
    # feature[18] (1×1 conv 320→1280) consumes.  Phase 7 fine-tuning trains
    # features[18] in MLX, so we cache features[0..17] outputs as the
    # "pre" features and the standard pooled 1280-dim vector as before.
    pre_extractor = torch.nn.Sequential(*list(model.features)[:18])

    feature_extractor = torch.nn.Sequential(
        model.features,
        torch.nn.AdaptiveAvgPool2d((1, 1)),
        torch.nn.Flatten(),
    )

    # ImageNet normalization
    transform = T.Compose([
        T.Resize((224, 224)),
        T.ToTensor(),  # HWC uint8 → CHW float [0, 1]
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    # Load manifest
    with open(MANIFEST_PATH) as f:
        manifest = json.load(f)

    total = len(manifest["samples"])
    extracted = 0
    skipped = 0

    # Sidecar accumulators for pre-features
    # Stored as ordered arrays keyed by manifest index → save once at end.
    pre_indices: list[int] = []
    pre_arrays: list[np.ndarray] = []

    # If include_pre, look at what's already cached so we skip re-doing them
    cached_pre = set()
    if include_pre and PRE_FEATURES_PATH.exists():
        try:
            with np.load(PRE_FEATURES_PATH) as npz:
                cached_pre = set(int(i) for i in npz["indices"].tolist())
            print(f"[extract] pre-features cache exists: {len(cached_pre)} samples")
        except Exception as e:
            print(f"[extract] pre-features cache unreadable ({e}); will regenerate")
            cached_pre = set()

    print(f"[extract] processing {total} samples"
          f"{' (with pre-features)' if include_pre else ''}...")

    for i, sample in enumerate(manifest["samples"]):
        # Find the image path (prefer screenshot_path over image)
        img_path = sample.get("screenshot_path") or sample.get("image", "")
        if not os.path.isabs(img_path):
            img_path = str(DATA_DIR / img_path)

        if not os.path.exists(img_path) or img_path.endswith(".html"):
            print(f"  [{i + 1}/{total}] skip (no image): {os.path.basename(img_path)}")
            skipped += 1
            continue

        has_pooled = (sample.get("mobilenet_features")
                      and len(sample["mobilenet_features"]) == 1280)
        has_pre = i in cached_pre

        # Skip both work paths if everything's cached
        if has_pooled and (not include_pre or has_pre):
            print(f"  [{i + 1}/{total}] skip (cached): {os.path.basename(img_path)}")
            extracted += 1
            continue

        try:
            img = Image.open(img_path).convert("RGB")
            tensor = transform(img).unsqueeze(0)  # (1, 3, 224, 224)

            with torch.no_grad():
                if not has_pooled:
                    features = feature_extractor(tensor)  # (1, 1280)
                    sample["mobilenet_features"] = features[0].numpy().tolist()

                if include_pre and not has_pre:
                    pre = pre_extractor(tensor)  # (1, 320, 7, 7)
                    # Store NHWC to match MLX conv convention used elsewhere
                    pre_np = pre[0].permute(1, 2, 0).numpy().astype(np.float32)
                    pre_indices.append(i)
                    pre_arrays.append(pre_np)

            extracted += 1
            if (i + 1) % 10 == 0 or i == total - 1:
                print(f"  [{i + 1}/{total}] extracted ({os.path.basename(img_path)})")

        except Exception as e:
            print(f"  [{i + 1}/{total}] ERROR: {e}")
            skipped += 1

    # Save updated manifest
    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2)

    # Merge pre-features sidecar (load existing, append, save)
    if include_pre and pre_arrays:
        existing_indices = np.zeros(0, dtype=np.int64)
        existing_features = np.zeros((0, 7, 7, 320), dtype=np.float32)
        if PRE_FEATURES_PATH.exists():
            try:
                with np.load(PRE_FEATURES_PATH) as npz:
                    existing_indices = npz["indices"].copy()
                    existing_features = npz["features"].copy()
            except Exception:
                pass

        new_indices = np.asarray(pre_indices, dtype=np.int64)
        new_features = np.stack(pre_arrays).astype(np.float32)

        all_indices = np.concatenate([existing_indices, new_indices])
        all_features = (
            np.concatenate([existing_features, new_features], axis=0)
            if existing_features.shape[0] > 0 else new_features
        )

        np.savez(PRE_FEATURES_PATH, indices=all_indices, features=all_features)
        print(f"[extract] saved pre-features: {PRE_FEATURES_PATH.name}, "
              f"shape={all_features.shape}, "
              f"size={PRE_FEATURES_PATH.stat().st_size / 1024 / 1024:.1f} MB")

    print(f"\n[extract] done: {extracted} extracted, {skipped} skipped")
    print(f"[extract] feature dim: 1280 (MobileNet V2 ImageNet)")

    # Verify
    with_features = sum(1 for s in manifest["samples"]
                       if s.get("mobilenet_features") and len(s["mobilenet_features"]) == 1280)
    print(f"[extract] samples with pooled features: {with_features}/{total}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract MobileNet V2 features")
    parser.add_argument("--include-pre", action="store_true",
                        help="Also cache the pre-pool (B,7,7,320) features[17] "
                             "output to a sidecar .npz (Phase 7 fine-tuning)")
    args = parser.parse_args()
    extract(include_pre=args.include_pre)
