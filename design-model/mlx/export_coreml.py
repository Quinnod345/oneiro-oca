#!/usr/bin/env python3
"""
Export Design Model to Core ML for Neural Engine inference on macOS/iOS.

Pipeline: MLX weights → PyTorch equivalent → ONNX → Core ML

The exported model takes:
  - 1280-dim MobileNet V2 features (pre-extracted)
  - 64-dim code features (optional, zero-filled if not available)
  → 16-dim design quality scores

For full end-to-end inference in a Swift app:
  1. Use Vision framework to run MobileNet V2 on a screenshot → 1280-dim
  2. Feed into this Core ML model → 16 design scores

Usage:
  python export_coreml.py                    # Export Phase 2b head
  python export_coreml.py --verify           # Export + verify accuracy
"""

import argparse
import json
import os
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

WEIGHTS_DIR = Path(__file__).parent.parent / "weights"
EXPORT_DIR = Path(__file__).parent.parent / "exports"

SCORE_NAMES = [
    "typography_quality", "color_harmony", "spatial_composition",
    "motion_elegance", "emotional_resonance", "craft_visibility",
    "minimalism_coherence", "native_integration",
    "visceral_score", "behavioral_score", "reflective_score",
    "overall_aesthetic",
    "innovation_score", "system_creativity", "design_distinctiveness",
    "problem_level",
]

OUTPUT_DIM = 16


# ═══════════════════════════════════════════════════
# PYTORCH EQUIVALENT OF THE MLX DESIGN HEAD
# ═══════════════════════════════════════════════════


class DesignHeadTorch(nn.Module):
    """PyTorch mirror of the MLX DesignHead for export."""

    def __init__(self, visual_dim=1280, code_dim=64):
        super().__init__()

        self.vis_proj = nn.Linear(visual_dim, 384)
        self.vis_norm = nn.LayerNorm(384)
        self.code_proj = nn.Linear(code_dim, 128)
        self.code_norm = nn.LayerNorm(128)

        input_dim = 384 + 128
        self.fc1 = nn.Linear(input_dim, 256)
        self.ln1 = nn.LayerNorm(256)
        self.fc2 = nn.Linear(256, 128)
        self.ln2 = nn.LayerNorm(128)
        self.fc3 = nn.Linear(128, 64)
        self.ln3 = nn.LayerNorm(64)
        self.output = nn.Linear(64, OUTPUT_DIM)

    def forward(self, visual_features, code_features):
        v = torch.nn.functional.gelu(self.vis_norm(self.vis_proj(visual_features)))
        c = torch.nn.functional.gelu(self.code_norm(self.code_proj(code_features)))
        x = torch.cat([v, c], dim=-1)
        x = torch.nn.functional.gelu(self.ln1(self.fc1(x)))
        x = torch.nn.functional.gelu(self.ln2(self.fc2(x)))
        x = torch.nn.functional.gelu(self.ln3(self.fc3(x)))
        x = torch.sigmoid(self.output(x))
        return x


def load_mlx_weights_to_torch(torch_model):
    """Load MLX safetensors weights into the PyTorch model."""
    import mlx.core as mx

    weights_path = WEIGHTS_DIR / "design-head-v2.safetensors"
    if not weights_path.exists():
        raise FileNotFoundError(f"No weights at {weights_path}")

    mlx_weights = mx.load(str(weights_path))
    print(f"[export] loaded {len(mlx_weights)} MLX tensors")

    # Map MLX flat keys to PyTorch state dict
    state_dict = torch_model.state_dict()
    loaded = 0

    for torch_key in state_dict:
        # MLX safetensors keys match the PyTorch keys for simple models
        mlx_key = torch_key
        if mlx_key in mlx_weights:
            mlx_arr = np.array(mlx_weights[mlx_key])
            state_dict[torch_key] = torch.from_numpy(mlx_arr)
            loaded += 1

    torch_model.load_state_dict(state_dict)
    print(f"[export] mapped {loaded}/{len(state_dict)} weights")
    return torch_model


# ═══════════════════════════════════════════════════
# ONNX EXPORT
# ═══════════════════════════════════════════════════


def export_onnx(model, path):
    """Export to ONNX format."""
    model.eval()
    dummy_vis = torch.randn(1, 1280)
    dummy_code = torch.randn(1, 64)

    torch.onnx.export(
        model,
        (dummy_vis, dummy_code),
        str(path),
        input_names=["visual_features", "code_features"],
        output_names=["design_scores"],
        dynamic_axes={
            "visual_features": {0: "batch"},
            "code_features": {0: "batch"},
            "design_scores": {0: "batch"},
        },
        opset_version=17,
    )
    print(f"[export] ONNX saved: {path} ({path.stat().st_size / 1024:.0f} KB)")


# ═══════════════════════════════════════════════════
# CORE ML EXPORT
# ═══════════════════════════════════════════════════


def export_coreml(onnx_path, output_path):
    """Convert ONNX to Core ML."""
    import coremltools as ct

    # Convert ONNX → Core ML (coremltools 7+ API)
    model = ct.convert(
        str(onnx_path),
        minimum_deployment_target=ct.target.macOS15,
        convert_to="mlprogram",
    )

    # Set metadata
    model.author = "Design Model"
    model.short_description = "Evaluates design quality across 16 dimensions from visual + code features"
    model.version = "2b"

    # Label the outputs
    spec = model.get_spec()
    output = spec.description.output[0]
    output.shortDescription = "16 design quality scores (0-1): " + ", ".join(SCORE_NAMES)

    # Input descriptions
    for inp in spec.description.input:
        if inp.name == "visual_features":
            inp.shortDescription = "1280-dim MobileNet V2 features from screenshot"
        elif inp.name == "code_features":
            inp.shortDescription = "64-dim code analysis features (zero-fill if unavailable)"

    model = ct.models.MLModel(spec)
    model.save(str(output_path))
    print(f"[export] Core ML saved: {output_path} ({output_path.stat().st_size / 1024:.0f} KB)")
    return model


# ═══════════════════════════════════════════════════
# VERIFICATION
# ═══════════════════════════════════════════════════


def verify(torch_model, coreml_path):
    """Verify Core ML output matches PyTorch."""
    import coremltools as ct

    torch_model.eval()
    coreml_model = ct.models.MLModel(str(coreml_path))

    # Random test inputs
    test_vis = np.random.randn(1, 1280).astype(np.float32)
    test_code = np.random.randn(1, 64).astype(np.float32)

    # PyTorch prediction
    with torch.no_grad():
        torch_out = torch_model(
            torch.from_numpy(test_vis),
            torch.from_numpy(test_code),
        ).numpy()[0]

    # Core ML prediction
    coreml_out = coreml_model.predict({
        "visual_features": test_vis,
        "code_features": test_code,
    })
    coreml_scores = list(coreml_out.values())[0].flatten()

    # Compare
    max_diff = np.max(np.abs(torch_out - coreml_scores))
    print(f"\n[verify] Max difference: {max_diff:.6f}")
    print(f"[verify] {'PASS' if max_diff < 0.001 else 'FAIL'} (threshold: 0.001)")

    if max_diff < 0.01:
        print("[verify] Sample scores:")
        for i, name in enumerate(SCORE_NAMES):
            print(f"  {name:25s}: torch={torch_out[i]:.4f}  coreml={coreml_scores[i]:.4f}")


# ═══════════════════════════════════════════════════
# METADATA
# ═══════════════════════════════════════════════════


def export_metadata(export_dir):
    """Save model metadata for Swift integration."""
    meta = {
        "model_version": "2b",
        "input_visual_dim": 1280,
        "input_code_dim": 64,
        "output_dim": OUTPUT_DIM,
        "score_names": SCORE_NAMES,
        "backbone": "MobileNetV2_ImageNet",
        "description": "Design quality evaluation across 16 dimensions",
        "inference_target": "Neural Engine (macOS 15+ / iOS 18+)",
        "dimension_groups": {
            "core": SCORE_NAMES[:12],
            "innovation": SCORE_NAMES[12:],
            "norman": ["visceral_score", "behavioral_score", "reflective_score"],
        },
    }
    path = export_dir / "model-metadata.json"
    with open(path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"[export] metadata: {path}")


# ═══════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════


def main():
    parser = argparse.ArgumentParser(description="Export Design Model to Core ML")
    parser.add_argument("--verify", action="store_true", help="Verify Core ML matches PyTorch")
    args = parser.parse_args()

    EXPORT_DIR.mkdir(parents=True, exist_ok=True)

    # Step 1: Create PyTorch model + load MLX weights
    print("[export] creating PyTorch equivalent...")
    torch_model = DesignHeadTorch()
    torch_model = load_mlx_weights_to_torch(torch_model)
    torch_model.eval()

    # Step 2: Export to ONNX
    onnx_path = EXPORT_DIR / "design-head-v2.onnx"
    print("[export] exporting to ONNX...")
    export_onnx(torch_model, onnx_path)

    # Step 3: Convert to Core ML directly from PyTorch traced model
    coreml_path = EXPORT_DIR / "DesignEvaluator.mlpackage"
    print("[export] converting to Core ML...")
    try:
        import coremltools as ct

        traced = torch.jit.trace(torch_model, (torch.randn(1, 1280), torch.randn(1, 64)))
        coreml_model = ct.convert(
            traced,
            inputs=[
                ct.TensorType(name="visual_features", shape=(1, 1280)),
                ct.TensorType(name="code_features", shape=(1, 64)),
            ],
            outputs=[ct.TensorType(name="design_scores")],
            compute_precision=ct.precision.FLOAT32,
        )
        coreml_model.author = "Design Model"
        coreml_model.short_description = "Design quality evaluation: 16 dimensions from visual + code features"
        coreml_model.version = "2b"
        coreml_model.save(str(coreml_path))
        print(f"[export] Core ML saved: {coreml_path}")
    except Exception as e:
        print(f"[export] Core ML conversion failed: {e}")
        print("[export] ONNX export succeeded — convert manually if needed")
        export_metadata(EXPORT_DIR)
        return

    # Step 4: Save metadata
    export_metadata(EXPORT_DIR)

    # Step 5: Verify
    if args.verify:
        verify(torch_model, coreml_path)

    print(f"\n[export] Complete!")
    print(f"  ONNX:    {onnx_path}")
    print(f"  CoreML:  {coreml_path}")
    print(f"  Use in Swift: let model = try DesignEvaluator()")


if __name__ == "__main__":
    main()
