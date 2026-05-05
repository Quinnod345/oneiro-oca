#!/usr/bin/env python3
"""
Extract DINOv2 ViT-B/14 features from all training images using PyTorch.

What's cached
  - `dinov2_features` (manifest field, 768-d list) — the CLS token, used by
    v8/v9 single-token vision streams.
  - `dinov2_patch_features.npz` (sidecar) — the full 256-patch tensor
    (256, 768) per sample.  v10 attention-pools these patches to recover
    spatial information the CLS token abstracts away (per benchmarks,
    +5-10% on craft dims).

Why both
  CLS encodes a global summary; patches preserve local spatial detail.
  Attention-pooling the patches gives the trunk both perspectives
  without paying for live ViT inference at training time — the
  patch tensor is ~750 KB per sample, ~340 MB across 458 samples.

Usage
  python extract_dinov2.py                     # CLS only (v8/v9 default)
  python extract_dinov2.py --include-patches   # CLS + patch tokens (v10+)
  python extract_dinov2.py --model facebook/dinov2-small  # 21M, 384-d
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
PATCH_FEATURES_PATH = DATA_DIR / "dinov2_patch_features.npz"

DEFAULT_MODEL = "facebook/dinov2-base"  # ViT-B/14, 86M params, 768-d
PATCHES_PER_IMAGE = 256  # 224x224 / 14 = 16x16 grid


def extract(model_id: str = DEFAULT_MODEL, include_patches: bool = False):
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
          f"{feature_dim}-d output"
          + (" (+ patch tokens)" if include_patches else ""))

    with open(MANIFEST_PATH) as f:
        manifest = json.load(f)

    # Existing patch features (sidecar) — used to skip already-extracted samples
    cached_patch_indices = set()
    if include_patches and PATCH_FEATURES_PATH.exists():
        try:
            with np.load(PATCH_FEATURES_PATH) as npz:
                cached_patch_indices = set(int(i) for i in npz["indices"].tolist())
        except Exception as e:
            print(f"[dinov2] patch cache unreadable ({e}); will regenerate")

    total = len(manifest["samples"])
    extracted = 0
    skipped = 0
    cached = 0

    new_patch_indices = []
    new_patch_features = []

    print(f"[dinov2] processing {total} samples...")
    t_loop = time.time()

    for i, sample in enumerate(manifest["samples"]):
        img_path = sample.get("screenshot_path") or sample.get("image", "")
        if not os.path.isabs(img_path):
            img_path = str(DATA_DIR / img_path)

        if not os.path.exists(img_path) or img_path.endswith(".html"):
            skipped += 1
            continue

        # Decide whether each piece is already cached
        existing_cls = sample.get("dinov2_features")
        cls_cached = existing_cls and len(existing_cls) == feature_dim
        patch_cached = i in cached_patch_indices

        # If the user asked for patches AND CLS is cached AND patches are cached, skip
        if cls_cached and (not include_patches or patch_cached):
            cached += 1
            continue

        try:
            img = Image.open(img_path).convert("RGB")
            inputs = processor(images=img, return_tensors="pt")
            inputs = {k: v.to(device) for k, v in inputs.items()}
            with torch.no_grad():
                out = model(**inputs)
            # last_hidden_state: (1, 1+num_patches, 768) — index 0 = CLS
            hidden = out.last_hidden_state[0]  # (257, 768)

            if not cls_cached:
                cls = hidden[0].cpu().numpy().astype(np.float32)
                sample["dinov2_features"] = cls.tolist()

            if include_patches and not patch_cached:
                # Skip the CLS token, take the 256 patch tokens
                patches = hidden[1:].cpu().numpy().astype(np.float32)
                if patches.shape[0] != PATCHES_PER_IMAGE:
                    # Some image sizes give different patch counts; warn + skip
                    print(f"  [{i + 1}/{total}] WARN: {patches.shape[0]} patches "
                          f"(expected {PATCHES_PER_IMAGE}) — skipping patch cache")
                else:
                    new_patch_indices.append(i)
                    new_patch_features.append(patches)

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

    # Merge patch sidecar
    if include_patches and new_patch_features:
        existing_idx = np.zeros(0, dtype=np.int64)
        existing_feats = np.zeros((0, PATCHES_PER_IMAGE, feature_dim), dtype=np.float32)
        if PATCH_FEATURES_PATH.exists():
            try:
                with np.load(PATCH_FEATURES_PATH) as npz:
                    existing_idx = npz["indices"].copy()
                    existing_feats = npz["features"].copy()
            except Exception:
                pass
        new_idx_arr = np.asarray(new_patch_indices, dtype=np.int64)
        new_feat_arr = np.stack(new_patch_features).astype(np.float32)
        all_idx = np.concatenate([existing_idx, new_idx_arr])
        all_feat = (np.concatenate([existing_feats, new_feat_arr], axis=0)
                    if existing_feats.shape[0] > 0 else new_feat_arr)
        np.savez(PATCH_FEATURES_PATH, indices=all_idx, features=all_feat)
        print(f"[dinov2] saved patch features: {PATCH_FEATURES_PATH.name}, "
              f"shape={all_feat.shape}, "
              f"size={PATCH_FEATURES_PATH.stat().st_size / 1024 / 1024:.1f} MB")

    elapsed = time.time() - t_loop
    with_features = sum(1 for s in manifest["samples"]
                        if s.get("dinov2_features")
                        and len(s["dinov2_features"]) == feature_dim)

    print(f"\n[dinov2] done: {extracted} extracted, {cached} cached, "
          f"{skipped} skipped in {elapsed:.1f}s")
    print(f"[dinov2] feature dim: {feature_dim} ({model_id})")
    print(f"[dinov2] samples with CLS features: {with_features}/{total}")
    if include_patches:
        with np.load(PATCH_FEATURES_PATH) as npz:
            print(f"[dinov2] samples with patch features: {len(npz['indices'])}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract DINOv2 features")
    parser.add_argument("--model", default=DEFAULT_MODEL,
                        help="HuggingFace model id (default: facebook/dinov2-base)")
    parser.add_argument("--include-patches", action="store_true",
                        help="Also cache the 256 patch tokens to a sidecar "
                             ".npz (Phase 11 attention pooling)")
    args = parser.parse_args()
    extract(model_id=args.model, include_patches=args.include_patches)
