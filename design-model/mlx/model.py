"""
Design Evaluator — MLX model for design aesthetic evaluation on M4 Max.

Architecture:
  Phase 2a: Lightweight CNN backbone + design head (trainable from scratch)
  Phase 2b: MobileNet V2 backbone (frozen) + design head
  Phase 3:  Progressive expert columns

Optimized for M4 Max:
  - bfloat16 training for memory efficiency
  - Gradient checkpointing on heavy layers
  - Batch size 32-64 to saturate GPU
  - Unified memory = zero CPU→GPU transfer
"""

import math
from pathlib import Path
from typing import Optional

import mlx.core as mx
import mlx.nn as nn

OUTPUT_DIM = 12  # 12 design dimensions
WEIGHTS_DIR = Path(__file__).parent.parent / "weights"

# ═══════════════════════════════════════════════════
# BUILDING BLOCKS
# ═══════════════════════════════════════════════════


class ConvBnAct(nn.Module):
    """Conv2d → BatchNorm → GELU"""

    def __init__(self, in_ch: int, out_ch: int, kernel: int = 3, stride: int = 1, groups: int = 1):
        super().__init__()
        pad = kernel // 2
        self.conv = nn.Conv2d(in_ch, out_ch, kernel_size=kernel, stride=stride, padding=pad, bias=False)
        self.bn = nn.BatchNorm(out_ch)

    def __call__(self, x):
        return nn.gelu(self.bn(self.conv(x)))


class InvertedResidual(nn.Module):
    """MobileNet V2 style inverted residual block."""

    def __init__(self, in_ch: int, out_ch: int, stride: int = 1, expand_ratio: int = 6):
        super().__init__()
        hidden = in_ch * expand_ratio
        self.use_residual = stride == 1 and in_ch == out_ch

        layers = []
        if expand_ratio != 1:
            layers.append(ConvBnAct(in_ch, hidden, kernel=1))
        layers.append(ConvBnAct(hidden, hidden, kernel=3, stride=stride, groups=hidden))
        # Pointwise linear (no activation)
        layers.append(nn.Conv2d(hidden, out_ch, kernel_size=1, bias=False))
        layers.append(nn.BatchNorm(out_ch))
        self.layers = layers

    def __call__(self, x):
        out = x
        for layer in self.layers:
            out = layer(out)
        if self.use_residual:
            out = out + x
        return out


class DesignSpatialAttention(nn.Module):
    """Learns WHERE to look in the design (e.g., typography areas, color blocks)."""

    def __init__(self, channels: int):
        super().__init__()
        self.query = nn.Linear(channels, channels // 4)
        self.key = nn.Linear(channels, channels // 4)
        self.value = nn.Linear(channels, channels)
        self.scale = 1.0 / math.sqrt(channels // 4)

    def __call__(self, x):
        # x: (B, H, W, C)
        b, h, w, c = x.shape
        flat = x.reshape(b, h * w, c)  # (B, HW, C)

        q = self.query(flat)   # (B, HW, C//4)
        k = self.key(flat)     # (B, HW, C//4)
        v = self.value(flat)   # (B, HW, C)

        attn = (q @ k.transpose(0, 2, 1)) * self.scale  # (B, HW, HW)
        attn = mx.softmax(attn, axis=-1)

        out = attn @ v  # (B, HW, C)
        out = out.reshape(b, h, w, c)

        return out + x  # Residual


class MultiScaleFeatures(nn.Module):
    """Extract features at multiple scales (global + detail)."""

    def __init__(self, in_channels: int, out_dim: int):
        super().__init__()
        # Global average pool path
        self.global_proj = nn.Linear(in_channels, out_dim // 2)
        # Max pool path (captures strongest activations)
        self.max_proj = nn.Linear(in_channels, out_dim // 2)

    def __call__(self, x):
        # x: (B, H, W, C)
        # Global average pool
        global_feat = x.mean(axis=(1, 2))  # (B, C)
        global_out = nn.gelu(self.global_proj(global_feat))

        # Global max pool
        max_feat = x.max(axis=(1, 2))  # (B, C)
        max_out = nn.gelu(self.max_proj(max_feat))

        return mx.concatenate([global_out, max_out], axis=-1)  # (B, out_dim)


# ═══════════════════════════════════════════════════
# LIGHTWEIGHT CNN BACKBONE (Phase 2a — trainable from scratch)
# ═══════════════════════════════════════════════════


class DesignBackbone(nn.Module):
    """
    Lightweight CNN inspired by MobileNet V2 architecture.
    Trainable from scratch on design screenshots.

    ~2.5M parameters — suitable for 200-5K training images.

    Input: (B, 224, 224, 3) — MLX uses channels-last
    Output: (B, 7, 7, 320) — spatial feature map
    """

    def __init__(self):
        super().__init__()

        # Stem
        self.stem = ConvBnAct(3, 32, kernel=3, stride=2)  # 224→112

        # Inverted residual blocks (simplified MobileNet V2)
        self.blocks = [
            InvertedResidual(32, 16, stride=1, expand_ratio=1),   # 112
            InvertedResidual(16, 24, stride=2, expand_ratio=6),   # 112→56
            InvertedResidual(24, 24, stride=1, expand_ratio=6),   # 56
            InvertedResidual(24, 32, stride=2, expand_ratio=6),   # 56→28
            InvertedResidual(32, 32, stride=1, expand_ratio=6),   # 28
            InvertedResidual(32, 64, stride=2, expand_ratio=6),   # 28→14
            InvertedResidual(64, 64, stride=1, expand_ratio=6),   # 14
            InvertedResidual(64, 96, stride=1, expand_ratio=6),   # 14
            InvertedResidual(96, 160, stride=2, expand_ratio=6),  # 14→7
            InvertedResidual(160, 320, stride=1, expand_ratio=6), # 7
        ]

        # Final conv
        self.head_conv = ConvBnAct(320, 640, kernel=1)  # 7x7x640

    def __call__(self, x):
        # x: (B, 224, 224, 3)
        x = self.stem(x)
        for block in self.blocks:
            x = block(x)
        x = self.head_conv(x)
        return x  # (B, 7, 7, 640)


# ═══════════════════════════════════════════════════
# DESIGN EVALUATION HEAD
# ═══════════════════════════════════════════════════


class DesignHead(nn.Module):
    """
    Design evaluation head — takes backbone features and optional code features,
    outputs 12 design quality scores.

    Architecture:
      MultiScale(640) → 512
      + CodeFeatures(64) → 128  (optional)
      → Dense(640 or 512, 256) → GELU → Dropout
      → Dense(256, 128) → GELU → Dropout
      → Dense(128, 12) → Sigmoid
    """

    def __init__(self, backbone_dim: int = 512, code_feat_dim: int = 64,
                 hidden_1: int = 256, hidden_2: int = 128, dropout: float = 0.3):
        super().__init__()

        self.multi_scale = MultiScaleFeatures(640, backbone_dim)

        self.code_proj = nn.Linear(code_feat_dim, 128)
        self.has_code = False  # Set dynamically based on input

        input_dim = backbone_dim + 128  # backbone + code features

        self.fc1 = nn.Linear(input_dim, hidden_1)
        self.drop1 = nn.Dropout(dropout)
        self.fc2 = nn.Linear(hidden_1, hidden_2)
        self.drop2 = nn.Dropout(dropout * 0.67)
        self.fc3 = nn.Linear(hidden_2, OUTPUT_DIM)

    def __call__(self, backbone_features, code_features=None):
        # Multi-scale pooling of spatial features
        x = self.multi_scale(backbone_features)  # (B, backbone_dim)

        # Add code features if available
        if code_features is not None:
            code_x = nn.gelu(self.code_proj(code_features))  # (B, 128)
            x = mx.concatenate([x, code_x], axis=-1)
        else:
            # Zero-pad to maintain consistent input dim
            zeros = mx.zeros((x.shape[0], 128))
            x = mx.concatenate([x, zeros], axis=-1)

        x = self.drop1(nn.gelu(self.fc1(x)))
        x = self.drop2(nn.gelu(self.fc2(x)))
        x = mx.sigmoid(self.fc3(x))  # Scores in [0, 1]
        return x


# ═══════════════════════════════════════════════════
# FULL MODEL
# ═══════════════════════════════════════════════════


class DesignEvaluator(nn.Module):
    """
    Full design evaluation model.

    Phase 2a: DesignBackbone (trainable CNN) + DesignHead
    Phase 2b: Frozen MobileNet V2 backbone + DesignHead + DesignSpatialAttention

    Input: screenshot (B, 224, 224, 3) + optional code features (B, 64)
    Output: 12 design quality scores (B, 12)
    """

    def __init__(self, use_attention: bool = True, code_feat_dim: int = 64):
        super().__init__()

        self.backbone = DesignBackbone()
        self.attention = DesignSpatialAttention(640) if use_attention else None
        self.head = DesignHead(
            backbone_dim=512,
            code_feat_dim=code_feat_dim,
            hidden_1=256,
            hidden_2=128,
            dropout=0.5,  # High dropout for small dataset generalization
        )

    def __call__(self, images, code_features=None):
        """
        Forward pass.

        Args:
            images: (B, 224, 224, 3) — RGB images normalized to [0, 1]
            code_features: (B, 64) — optional code-extracted features

        Returns:
            (B, 12) — design quality scores in [0, 1]
        """
        features = self.backbone(images)  # (B, 7, 7, 640)

        if self.attention is not None:
            features = self.attention(features)  # (B, 7, 7, 640)

        scores = self.head(features, code_features)  # (B, 12)
        return scores

    def param_count(self):
        """Count total trainable parameters."""
        from mlx.utils import tree_flatten
        total = 0
        flat = tree_flatten(self.parameters())
        for _, param in flat:
            total += param.size
        return total

    def summary(self):
        """Return model architecture summary."""
        return {
            "architecture": "DesignBackbone + SpatialAttention + DesignHead",
            "backbone": "Lightweight CNN (MobileNet V2 style)",
            "attention": self.attention is not None,
            "input_size": "224x224x3",
            "output_dim": OUTPUT_DIM,
            "param_count": self.param_count(),
            "phase": "2a",
        }


# ═══════════════════════════════════════════════════
# WEIGHT MANAGEMENT
# ═══════════════════════════════════════════════════


def save_weights(model: DesignEvaluator, path: Optional[str] = None, version: int = 1):
    """Save model weights to disk."""
    WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
    if path is None:
        path = str(WEIGHTS_DIR / f"mlx-design-v{version}.safetensors")

    model.save_weights(path)
    print(f"[design-mlx] saved weights to {path}")
    return path


def load_weights(model: DesignEvaluator, path: Optional[str] = None, version: int = 1):
    """Load model weights from disk."""
    if path is None:
        path = str(WEIGHTS_DIR / f"mlx-design-v{version}.safetensors")

    if not Path(path).exists():
        print(f"[design-mlx] no weights found at {path}, using random init")
        return False

    model.load_weights(path)
    print(f"[design-mlx] loaded weights from {path}")
    return True


# ═══════════════════════════════════════════════════
# FACTORY
# ═══════════════════════════════════════════════════


def create_model(use_attention: bool = True, code_feat_dim: int = 64,
                 load: bool = True, version: int = 1) -> DesignEvaluator:
    """Create and optionally load a design evaluator model."""
    model = DesignEvaluator(use_attention=use_attention, code_feat_dim=code_feat_dim)
    if load:
        load_weights(model, version=version)
    print(f"[design-mlx] model: {model.param_count():,} parameters")
    return model


if __name__ == "__main__":
    # Quick test
    model = create_model(load=False)
    print(f"Summary: {model.summary()}")

    # Test forward pass
    dummy_img = mx.random.normal((2, 224, 224, 3))
    dummy_feat = mx.random.normal((2, 64))
    scores = model(dummy_img, dummy_feat)
    mx.eval(scores)
    print(f"Output shape: {scores.shape}")  # (2, 12)
    print(f"Scores: {scores.tolist()}")
