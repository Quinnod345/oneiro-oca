"""
Design Evaluator Phase 3 — Expert Column Architecture.

7 specialized experts, each deeply understanding one design domain:
  Typography, Color, Spatial, Motion, Emotion, Craft, Native

Lateral attention allows cross-expert knowledge sharing.
Aggregator combines expert outputs for refined overall score.

Architecture:
  MobileNet V2 features (1280-dim, frozen)
    ├── Typography Expert → typography_quality
    ├── Color Expert → color_harmony
    ├── Spatial Expert → spatial_composition, minimalism_coherence
    ├── Motion Expert → motion_elegance
    ├── Emotion Expert → emotional_resonance, visceral_score
    ├── Craft Expert → craft_visibility, behavioral_score, reflective_score
    └── Native Expert → native_integration
    ↕ Lateral Attention (cross-expert sharing)
    → Aggregator → overall_aesthetic (refined)

Total: ~7M trainable params
Inference: ~15ms on M4 Max GPU
"""

from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
from mlx.utils import tree_flatten

OUTPUT_DIM = 16
WEIGHTS_DIR = Path(__file__).parent.parent / "weights"

SCORE_NAMES = [
    "typography_quality", "color_harmony", "spatial_composition",
    "motion_elegance", "emotional_resonance", "craft_visibility",
    "minimalism_coherence", "native_integration",
    "visceral_score", "behavioral_score", "reflective_score",
    "overall_aesthetic",
    "innovation_score", "system_creativity", "design_distinctiveness",
    "problem_level",
]

# Which dimensions each expert is responsible for
EXPERT_DIMS = {
    "typography": ["typography_quality"],
    "color": ["color_harmony"],
    "spatial": ["spatial_composition", "minimalism_coherence"],
    "motion": ["motion_elegance"],
    "emotion": ["emotional_resonance", "visceral_score"],
    "craft": ["craft_visibility", "behavioral_score", "reflective_score"],
    "native": ["native_integration"],
    "innovation": ["innovation_score", "system_creativity", "design_distinctiveness", "problem_level"],
}

EXPERT_NAMES = list(EXPERT_DIMS.keys())


# ═══════════════════════════════════════════════════
# EXPERT HEAD
# ═══════════════════════════════════════════════════


class ExpertHead(nn.Module):
    """
    One expert column. Processes MobileNet features to produce
    scores for its assigned dimensions.

    Architecture:
      1280 → 512 → LayerNorm → GELU → Dropout
      → 256 → LayerNorm → GELU → Dropout  (← lateral context injected here)
      → 128 → LayerNorm → GELU → Dropout
      → N_dims → Sigmoid
    """

    def __init__(self, name: str, n_dims: int, visual_dim: int = 1280,
                 code_dim: int = 64, dropout: float = 0.4):
        super().__init__()
        self.name = name
        self.n_dims = n_dims

        # Visual processing
        self.vis_proj = nn.Linear(visual_dim, 512)
        self.vis_norm = nn.LayerNorm(512)
        self.vis_drop = nn.Dropout(dropout)

        # Code features
        self.code_proj = nn.Linear(code_dim, 64)

        # Hidden layers (256-dim is the "hidden state" shared with lateral attention)
        self.fc1 = nn.Linear(512 + 64, 256)
        self.ln1 = nn.LayerNorm(256)
        self.drop1 = nn.Dropout(dropout * 0.75)

        # Post-lateral processing
        self.fc2 = nn.Linear(256, 128)
        self.ln2 = nn.LayerNorm(128)
        self.drop2 = nn.Dropout(dropout * 0.5)

        self.output = nn.Linear(128, n_dims)

    def encode(self, visual_features, code_features=None):
        """Produce the 256-dim hidden state (before lateral attention)."""
        v = self.vis_drop(nn.gelu(self.vis_norm(self.vis_proj(visual_features))))

        if code_features is not None:
            c = nn.gelu(self.code_proj(code_features))
        else:
            c = mx.zeros((v.shape[0], 64))

        x = mx.concatenate([v, c], axis=-1)
        h = self.drop1(nn.gelu(self.ln1(self.fc1(x))))
        return h  # (B, 256)

    def decode(self, hidden, lateral_context=None):
        """Produce final scores from hidden state + optional lateral context."""
        if lateral_context is not None:
            hidden = hidden + lateral_context  # Residual add

        x = self.drop2(nn.gelu(self.ln2(self.fc2(hidden))))
        x = mx.sigmoid(self.output(x))
        return x  # (B, n_dims)

    def __call__(self, visual_features, code_features=None, lateral_context=None):
        h = self.encode(visual_features, code_features)
        return self.decode(h, lateral_context)


# ═══════════════════════════════════════════════════
# LATERAL ATTENTION
# ═══════════════════════════════════════════════════


class LateralAttention(nn.Module):
    """
    Multi-head attention over expert hidden states.

    Takes 7 expert hidden states (each 256-dim), runs 2-head self-attention,
    and returns contextualized hidden states for each expert.

    This allows:
      - Color expert to inform emotion expert (color affects emotion)
      - Spatial expert to inform craft expert (alignment is craft)
      - Typography expert to inform native expert (font choice signals nativeness)
    """

    def __init__(self, hidden_dim: int = 256, num_heads: int = 2):
        super().__init__()
        self.num_heads = num_heads
        self.head_dim = hidden_dim // num_heads

        self.q_proj = nn.Linear(hidden_dim, hidden_dim)
        self.k_proj = nn.Linear(hidden_dim, hidden_dim)
        self.v_proj = nn.Linear(hidden_dim, hidden_dim)
        self.out_proj = nn.Linear(hidden_dim, hidden_dim)
        self.norm = nn.LayerNorm(hidden_dim)

    def __call__(self, expert_hidden_states):
        """
        Args:
            expert_hidden_states: (B, 7, 256) — stacked expert hidden states
        Returns:
            (B, 7, 256) — contextualized hidden states
        """
        B, N, D = expert_hidden_states.shape

        # Compute Q, K, V
        Q = self.q_proj(expert_hidden_states)  # (B, 7, 256)
        K = self.k_proj(expert_hidden_states)
        V = self.v_proj(expert_hidden_states)

        # Reshape for multi-head: (B, num_heads, 7, head_dim)
        Q = Q.reshape(B, N, self.num_heads, self.head_dim).transpose(0, 2, 1, 3)
        K = K.reshape(B, N, self.num_heads, self.head_dim).transpose(0, 2, 1, 3)
        V = V.reshape(B, N, self.num_heads, self.head_dim).transpose(0, 2, 1, 3)

        # Scaled dot-product attention
        scale = self.head_dim ** -0.5
        attn = (Q @ K.transpose(0, 1, 3, 2)) * scale  # (B, heads, 7, 7)
        attn = mx.softmax(attn, axis=-1)

        # Apply attention
        out = attn @ V  # (B, heads, 7, head_dim)
        out = out.transpose(0, 2, 1, 3).reshape(B, N, D)  # (B, 7, 256)
        out = self.out_proj(out)

        # Residual + LayerNorm
        out = self.norm(expert_hidden_states + out)
        return out


# ═══════════════════════════════════════════════════
# AGGREGATOR
# ═══════════════════════════════════════════════════


class Aggregator(nn.Module):
    """
    Combines expert outputs + lateral context into refined overall_aesthetic.

    The aggregator learns that overall quality is NOT a simple average —
    some dimension interactions matter more than others.
    """

    def __init__(self, expert_dim: int = 11, lateral_dim: int = 1792,  # 7*256
                 hidden: int = 256):
        super().__init__()
        input_dim = expert_dim + lateral_dim  # 11 expert scores + 1792 lateral context

        self.fc1 = nn.Linear(input_dim, hidden)
        self.ln1 = nn.LayerNorm(hidden)
        self.fc2 = nn.Linear(hidden, 64)
        self.ln2 = nn.LayerNorm(64)
        self.output = nn.Linear(64, 1)

    def __call__(self, expert_scores, lateral_context_flat):
        """
        Args:
            expert_scores: (B, 11) — all expert dimension scores except overall
            lateral_context_flat: (B, 1792) — flattened lateral hidden states
        Returns:
            (B, 1) — refined overall_aesthetic
        """
        x = mx.concatenate([expert_scores, lateral_context_flat], axis=-1)
        x = nn.gelu(self.ln1(self.fc1(x)))
        x = nn.gelu(self.ln2(self.fc2(x)))
        x = mx.sigmoid(self.output(x))
        return x


# ═══════════════════════════════════════════════════
# FULL EXPERT MODEL
# ═══════════════════════════════════════════════════


class DesignExpertNetwork(nn.Module):
    """
    Phase 3: Expert Column Design Evaluator.

    7 specialized experts + lateral attention + aggregator.

    Input: (B, 1280) visual features + optional (B, 64) code features
    Output: (B, 12) design scores + (B, 1) refined overall

    The 12th output (overall_aesthetic) comes from the aggregator,
    not from any single expert. This allows the overall score to
    capture dimension interactions.
    """

    def __init__(self, dropout: float = 0.4):
        super().__init__()

        # Create experts
        self.experts = {}
        for name, dims in EXPERT_DIMS.items():
            self.experts[name] = ExpertHead(
                name=name,
                n_dims=len(dims),
                dropout=dropout,
            )

        # Lateral attention
        self.lateral = LateralAttention(hidden_dim=256, num_heads=2)

        # Aggregator for overall_aesthetic
        self.aggregator = Aggregator(
            expert_dim=15,  # 16 dims minus overall_aesthetic
            lateral_dim=len(EXPERT_NAMES) * 256,  # 8 experts × 256 hidden
        )

    def __call__(self, visual_features, code_features=None):
        """
        Forward pass through all experts with lateral attention.

        Returns: (B, 13) — 12 dimension scores + 1 refined overall
        """
        B = visual_features.shape[0]

        # 1. Get hidden states from all experts
        hidden_states = []
        for name in EXPERT_NAMES:
            h = self.experts[name].encode(visual_features, code_features)
            hidden_states.append(h)

        # Stack: (B, 7, 256)
        stacked = mx.stack(hidden_states, axis=1)

        # 2. Lateral attention — cross-expert knowledge sharing
        contextualized = self.lateral(stacked)  # (B, 7, 256)

        # 3. Each expert decodes with lateral context
        all_scores = []
        for i, name in enumerate(EXPERT_NAMES):
            lateral_ctx = contextualized[:, i, :]  # (B, 256)
            scores = self.experts[name].decode(hidden_states[i], lateral_ctx)
            all_scores.append(scores)

        # 4. Assemble dimension scores (in SCORE_NAMES order, excluding overall)
        dim_scores = {}
        for name, expert_scores in zip(EXPERT_NAMES, all_scores):
            dims = EXPERT_DIMS[name]
            for j, dim_name in enumerate(dims):
                dim_scores[dim_name] = expert_scores[:, j:j+1]

        # Stack in SCORE_NAMES order (first 11, excluding overall_aesthetic)
        ordered_scores = []
        for sn in SCORE_NAMES:
            if sn == "overall_aesthetic":
                continue
            ordered_scores.append(dim_scores[sn])
        expert_output = mx.concatenate(ordered_scores, axis=-1)  # (B, 11)

        # 5. Aggregator produces refined overall_aesthetic
        lateral_flat = contextualized.reshape(B, -1)  # (B, 1792)
        overall = self.aggregator(expert_output, lateral_flat)  # (B, 1)

        # 6. Combine: (B, 12) in SCORE_NAMES order
        final_scores = mx.concatenate([expert_output, overall], axis=-1)  # (B, 12)

        return final_scores

    def param_count(self):
        total = sum(p.size for _, p in tree_flatten(self.parameters()))
        by_component = {
            "experts": {},
            "lateral": sum(p.size for _, p in tree_flatten(self.lateral.parameters())),
            "aggregator": sum(p.size for _, p in tree_flatten(self.aggregator.parameters())),
        }
        for name in EXPERT_NAMES:
            by_component["experts"][name] = sum(
                p.size for _, p in tree_flatten(self.experts[name].parameters())
            )
        return total, by_component

    def freeze_experts(self):
        """Freeze all expert weights (for lateral/aggregator training)."""
        for name in EXPERT_NAMES:
            self.experts[name].freeze()

    def unfreeze_experts(self):
        """Unfreeze all expert weights."""
        for name in EXPERT_NAMES:
            self.experts[name].unfreeze()


def create_expert_model(load: bool = False):
    """Create a Phase 3 expert model."""
    model = DesignExpertNetwork()
    total, by_component = model.param_count()

    print(f"[v3] expert network: {total:,} total params")
    for name, count in by_component["experts"].items():
        dims = EXPERT_DIMS[name]
        print(f"  {name:12s}: {count:>10,} params → {', '.join(dims)}")
    print(f"  {'lateral':12s}: {by_component['lateral']:>10,} params")
    print(f"  {'aggregator':12s}: {by_component['aggregator']:>10,} params")

    if load:
        path = WEIGHTS_DIR / "design-expert-v3.safetensors"
        if path.exists():
            model.load_weights(str(path))
            print(f"[v3] loaded weights from {path}")

    return model


def save_expert_model(model: DesignExpertNetwork):
    """Save expert model weights."""
    WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
    path = WEIGHTS_DIR / "design-expert-v3.safetensors"
    model.save_weights(str(path))
    print(f"[v3] saved to {path}")


if __name__ == "__main__":
    model = create_expert_model()

    # Test forward pass
    dummy_vis = mx.random.uniform(shape=(2, 1280))
    dummy_code = mx.random.uniform(shape=(2, 64))

    scores = model(dummy_vis, dummy_code)
    mx.eval(scores)

    print(f"\n[v3] output shape: {scores.shape}")
    print(f"[v3] sample scores:")
    for i, name in enumerate(SCORE_NAMES):
        print(f"  {name:25s}: {scores[0, i].item():.4f}")
    print(f"[v3] test passed")
