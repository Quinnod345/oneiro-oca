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

Usage: python extract_features.py
"""

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


def extract():
    print("[extract] loading MobileNet V2 pretrained backbone...")

    # Load model, remove classifier
    model = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.IMAGENET1K_V1)
    model.eval()

    # Use only the feature extractor + adaptive avg pool
    # MobileNet V2: features → adaptive_avg_pool2d → classifier
    # We want: features → adaptive_avg_pool2d → 1280-dim vector
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

    print(f"[extract] processing {total} samples...")

    for i, sample in enumerate(manifest["samples"]):
        # Find the image path (prefer screenshot_path over image)
        img_path = sample.get("screenshot_path") or sample.get("image", "")
        if not os.path.isabs(img_path):
            img_path = str(DATA_DIR / img_path)

        if not os.path.exists(img_path) or img_path.endswith(".html"):
            print(f"  [{i + 1}/{total}] skip (no image): {os.path.basename(img_path)}")
            skipped += 1
            continue

        # Check if already extracted
        if sample.get("mobilenet_features") and len(sample["mobilenet_features"]) == 1280:
            print(f"  [{i + 1}/{total}] skip (cached): {os.path.basename(img_path)}")
            extracted += 1
            continue

        try:
            img = Image.open(img_path).convert("RGB")
            tensor = transform(img).unsqueeze(0)  # (1, 3, 224, 224)

            with torch.no_grad():
                features = feature_extractor(tensor)  # (1, 1280)

            # Save as list of floats
            feat_list = features[0].numpy().tolist()
            sample["mobilenet_features"] = feat_list
            extracted += 1

            if (i + 1) % 10 == 0 or i == total - 1:
                print(f"  [{i + 1}/{total}] extracted ({os.path.basename(img_path)})")

        except Exception as e:
            print(f"  [{i + 1}/{total}] ERROR: {e}")
            skipped += 1

    # Save updated manifest
    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\n[extract] done: {extracted} extracted, {skipped} skipped")
    print(f"[extract] feature dim: 1280 (MobileNet V2 ImageNet)")

    # Verify
    with_features = sum(1 for s in manifest["samples"]
                       if s.get("mobilenet_features") and len(s["mobilenet_features"]) == 1280)
    print(f"[extract] samples with features: {with_features}/{total}")


if __name__ == "__main__":
    extract()
