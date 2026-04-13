#!/usr/bin/env python3
"""
Convert PyTorch MobileNet V2 pretrained weights to MLX safetensors format.
Run once, then never need PyTorch again.

Usage: python convert_mobilenet.py
"""

import numpy as np
from pathlib import Path

WEIGHTS_DIR = Path(__file__).parent.parent / "weights"
OUTPUT_PATH = WEIGHTS_DIR / "mobilenet_v2_imagenet.safetensors"


def convert():
    """Download MobileNet V2 from torchvision and convert to MLX safetensors."""
    import torch
    import torchvision.models as models

    print("[convert] loading MobileNet V2 pretrained weights...")
    model = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.IMAGENET1K_V1)
    model.eval()

    # Extract only the feature backbone (remove the classifier head)
    # MobileNet V2 features: model.features (Sequential of InvertedResidual blocks)
    # Output: 1280-dim feature vector after adaptive avg pool

    state_dict = model.state_dict()

    # Convert all tensors to numpy, filtering to only feature backbone
    # (skip classifier.* weights — we'll use our own design head)
    numpy_weights = {}
    for key, tensor in state_dict.items():
        if key.startswith("classifier"):
            continue  # Skip ImageNet classifier head

        arr = tensor.cpu().numpy()

        # PyTorch Conv2d: (out_ch, in_ch, H, W) → MLX Conv2d: (out_ch, H, W, in_ch)
        if arr.ndim == 4:
            arr = np.transpose(arr, (0, 2, 3, 1))

        numpy_weights[key] = arr

    # Save as safetensors using MLX
    import mlx.core as mx

    mlx_weights = {k: mx.array(v) for k, v in numpy_weights.items()}

    WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)

    # Use mx.save_safetensors
    mx.save_safetensors(str(OUTPUT_PATH), mlx_weights)

    print(f"[convert] saved {len(mlx_weights)} tensors to {OUTPUT_PATH}")
    print(f"[convert] file size: {OUTPUT_PATH.stat().st_size / 1024 / 1024:.1f} MB")

    # Print architecture summary
    print("\n[convert] MobileNet V2 backbone layers:")
    layer_shapes = {}
    for key, arr in numpy_weights.items():
        parts = key.split(".")
        layer_name = ".".join(parts[:2])
        if layer_name not in layer_shapes:
            layer_shapes[layer_name] = []
        layer_shapes[layer_name].append((key, arr.shape))

    for layer_name, params in sorted(layer_shapes.items()):
        total = sum(np.prod(s) for _, s in params)
        print(f"  {layer_name}: {total:,} params")

    total_params = sum(np.prod(v.shape) for v in numpy_weights.values())
    print(f"\n[convert] total backbone params: {total_params:,}")


if __name__ == "__main__":
    convert()
