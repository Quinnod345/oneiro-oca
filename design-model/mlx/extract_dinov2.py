#!/usr/bin/env python3
"""
Extract DINOv2 ViT-B/14 features from all training images using PyTorch.

Why DINOv2 over MobileNet V2
  MobileNet V2 (ImageNet 2017) was trained for natural-image
  classification — it's tuned to discriminate cats from dogs, not to
  notice typography pairings or spatial composition rhythm.  Designs
  that look distinct to a human ("Things 3 vs Bootstrap typography")
  collapse to similar regions of ImageNet feature space.

  DINOv2 (Meta, 2023) is self-supervised on 142M images at higher
  resolution.  Its features encode spatial composition + texture
  detail far more crisply for non-natural images.  Public benchmarks
  show 2-5x better dense-prediction quality on out-of-distribution
  tasks compared to ImageNet-trained CNNs.

  Drop-in cost: 1280-d MobileNet → 768-d DINOv2 (CLS token).  Trunk
  vis_proj layer changes from Linear(1280, 384) to Linear(768, 384)
  in train_v8.

Output
  Writes `dinov2_features` (768-d list) onto each manifest sample.
  Leaves `mobilenet_features` (1280-d) intact for backward compat
  with v6/v7 weights and any cached pre-pool features.

Usage
  python extract_dinov2.py
  python extract_dinov2.py --model facebook/dinov2-small  # 21M params, 384-d
"""

import argparse
import json
import os
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from transformers import AutoImageProcessor, AutoModel

DATA_DIR = Path(__file__).parent.parent / "data"
MANIFEST_PATH = DATA_DIR / "manifest.json"

DEFAULT_MODEL = "facebook/dinov2-base"  # ViT-B/14, 86M params, 768-d


def extract(model_id: str = DEFAULT_MODEL):
    print(f"[dinov2] loading {model_id}...")
    t0 = time.time()
    # MPS (Apple Silicon GPU) cuts forward-pass time ~30x vs CPU on M4 Max.
    if torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    model = AutoModel.from_pretrained(model_id).to(device)
    processor = AutoImageProcessor.from_pretrained(model_id)
    model.eval()
    feature_dim = model.config.hidden_size
    print(f"[dinov2] loaded on {device} in {time.time()-t0:.1f}s · "
          f"{sum(p.numel() for p in model.parameters())/1e6:.1f}M params · "
          f"{feature_dim}-d output")

    with open(MANIFEST_PATH) as f:
        manifest = json.load(f)

    total = len(manifest["samples"])
    extracted = 0
    skipped = 0
    cached = 0

    print(f"[dinov2] processing {total} samples...")
    t_loop = time.time()

    for i, sample in enumerate(manifest["samples"]):
        img_path = sample.get("screenshot_path") or sample.get("image", "")
        if not os.path.isabs(img_path):
            img_path = str(DATA_DIR / img_path)

        if not os.path.exists(img_path) or img_path.endswith(".html"):
            skipped += 1
            continue

        # Cache: skip if dinov2_features already present and matches dim.
        # If feature_dim differs (e.g., switched models), force re-extract.
        existing = sample.get("dinov2_features")
        if existing and len(existing) == feature_dim:
            cached += 1
            continue

        try:
            img = Image.open(img_path).convert("RGB")
            inputs = processor(images=img, return_tensors="pt")
            inputs = {k: v.to(device) for k, v in inputs.items()}
            with torch.no_grad():
                out = model(**inputs)
            # CLS token at position 0 — global feature
            features = out.last_hidden_state[0, 0, :].cpu().numpy()
            sample["dinov2_features"] = features.astype(np.float32).tolist()
            extracted += 1

            if (i + 1) % 25 == 0 or i == total - 1:
                rate = (extracted + cached) / max(time.time() - t_loop, 1)
                eta = (total - i - 1) / max(rate, 0.01)
                print(f"  [{i + 1}/{total}] extracted={extracted} cached={cached} "
                      f"skipped={skipped}  ~{eta:.0f}s remaining")
        except Exception as e:
            print(f"  [{i + 1}/{total}] ERROR: {e}")
            skipped += 1

    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2)

    elapsed = time.time() - t_loop
    with_features = sum(1 for s in manifest["samples"]
                        if s.get("dinov2_features")
                        and len(s["dinov2_features"]) == feature_dim)

    print(f"\n[dinov2] done: {extracted} extracted, {cached} cached, "
          f"{skipped} skipped in {elapsed:.1f}s")
    print(f"[dinov2] feature dim: {feature_dim} ({model_id})")
    print(f"[dinov2] samples with features: {with_features}/{total}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract DINOv2 features")
    parser.add_argument("--model", default=DEFAULT_MODEL,
                        help="HuggingFace model id (default: facebook/dinov2-base)")
    args = parser.parse_args()
    extract(model_id=args.model)
