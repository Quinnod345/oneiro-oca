"""
Design Model Export — convert MLX model to ONNX and Core ML for cross-platform inference.

Export pipeline:
  MLX weights → NumPy → PyTorch model → ONNX → quantized ONNX
  MLX weights → NumPy → PyTorch model → Core ML (for Neural Engine)

Usage:
  python export.py                    # Export to ONNX
  python export.py --coreml           # Also export to Core ML
  python export.py --quantize         # 8-bit quantized ONNX
"""

import argparse
import json
from pathlib import Path

import numpy as np

EXPORTS_DIR = Path(__file__).parent.parent / "exports"


def export_to_onnx(version: int = 1, quantize: bool = False):
    """Export MLX model to ONNX format."""
    try:
        import torch
        import torch.nn as torch_nn
    except ImportError:
        print("[export] ERROR: PyTorch required for ONNX export. Install: pip install torch")
        return None

    try:
        import mlx.core as mx
        from model import create_model
    except ImportError:
        print("[export] ERROR: cannot import MLX model")
        return None

    print("[export] loading MLX model...")
    mlx_model = create_model(load=True, version=version)
    mlx_model.eval()

    # Build equivalent PyTorch model
    print("[export] building PyTorch equivalent...")

    class TorchDesignEvaluator(torch_nn.Module):
        def __init__(self, param_count):
            super().__init__()
            # Simplified equivalent for export
            # In production, mirror the exact MLX architecture
            self.backbone = torch_nn.Sequential(
                torch_nn.Conv2d(3, 32, 3, stride=2, padding=1),
                torch_nn.BatchNorm2d(32),
                torch_nn.GELU(),
                torch_nn.AdaptiveAvgPool2d((7, 7)),
                torch_nn.Flatten(),
                torch_nn.Linear(32 * 7 * 7, 512),
                torch_nn.GELU(),
            )
            self.head = torch_nn.Sequential(
                torch_nn.Linear(512 + 64, 256),
                torch_nn.GELU(),
                torch_nn.Linear(256, 128),
                torch_nn.GELU(),
                torch_nn.Linear(128, 12),
                torch_nn.Sigmoid(),
            )

        def forward(self, images, code_features):
            x = self.backbone(images)
            x = torch.cat([x, code_features], dim=-1)
            return self.head(x)

    # Note: For production, we'd transfer weights from MLX to PyTorch.
    # For now, this creates the ONNX graph structure that can be populated later.
    torch_model = TorchDesignEvaluator(mlx_model.param_count())
    torch_model.eval()

    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

    # Export to ONNX
    dummy_img = torch.randn(1, 3, 224, 224)  # PyTorch uses NCHW
    dummy_feat = torch.randn(1, 64)

    onnx_path = str(EXPORTS_DIR / f"design-eval-v{version}.onnx")

    torch.onnx.export(
        torch_model,
        (dummy_img, dummy_feat),
        onnx_path,
        input_names=["screenshot", "code_features"],
        output_names=["design_scores"],
        dynamic_axes={
            "screenshot": {0: "batch"},
            "code_features": {0: "batch"},
            "design_scores": {0: "batch"},
        },
        opset_version=17,
    )
    print(f"[export] ONNX saved to {onnx_path}")

    # Quantize
    if quantize:
        try:
            from onnxruntime.quantization import quantize_dynamic, QuantType
            q_path = str(EXPORTS_DIR / f"design-eval-v{version}-q8.onnx")
            quantize_dynamic(onnx_path, q_path, weight_type=QuantType.QUInt8)
            print(f"[export] quantized ONNX saved to {q_path}")
            return q_path
        except ImportError:
            print("[export] WARNING: onnxruntime not installed, skipping quantization")

    return onnx_path


def export_to_coreml(version: int = 1):
    """Export to Core ML for Neural Engine inference on macOS/iOS."""
    try:
        import torch
        import coremltools as ct
    except ImportError:
        print("[export] ERROR: coremltools required. Install: pip install coremltools")
        return None

    print("[export] Core ML export not yet implemented — requires PyTorch model with transferred weights")
    print("[export] Coming in Phase 2b when weight transfer from MLX is automated")
    return None


def export_metadata(version: int = 1):
    """Save model metadata alongside exports."""
    try:
        from model import create_model
        model = create_model(load=True, version=version)
        summary = model.summary()
    except:
        summary = {"error": "could not load model"}

    metadata = {
        "version": version,
        "architecture": summary,
        "score_names": [
            "typography_quality", "color_harmony", "spatial_composition",
            "motion_elegance", "emotional_resonance", "craft_visibility",
            "minimalism_coherence", "native_integration",
            "visceral_score", "behavioral_score", "reflective_score",
            "overall_aesthetic",
        ],
        "input": {
            "screenshot": {"shape": [1, 224, 224, 3], "dtype": "float32", "range": [0, 1]},
            "code_features": {"shape": [1, 64], "dtype": "float32", "range": [0, 1]},
        },
        "output": {
            "design_scores": {"shape": [1, 12], "dtype": "float32", "range": [0, 1]},
        },
    }

    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    meta_path = EXPORTS_DIR / f"design-eval-v{version}-metadata.json"
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"[export] metadata saved to {meta_path}")
    return str(meta_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export design model")
    parser.add_argument("--version", type=int, default=1)
    parser.add_argument("--onnx", action="store_true", default=True)
    parser.add_argument("--coreml", action="store_true")
    parser.add_argument("--quantize", action="store_true")
    parser.add_argument("--metadata-only", action="store_true")
    args = parser.parse_args()

    if args.metadata_only:
        export_metadata(args.version)
    else:
        export_metadata(args.version)
        if args.onnx:
            export_to_onnx(args.version, args.quantize)
        if args.coreml:
            export_to_coreml(args.version)
