#!/usr/bin/env python3
"""
Phase 6 active-learning helper — rank candidate samples by predicted uncertainty.

self_train.py burns expensive Opus grading API calls on whatever Sonnet
generates next.  With v6's heteroscedastic uncertainty head, we can route
that grading toward the candidates the model is *least* confident about,
which produces the largest expected gain in val_loss per dollar.

This script is a small, dependency-light scoring utility:

  python3 select_uncertain.py --features ./candidates/*.npz [--top-k 5]
  python3 select_uncertain.py --image ./candidates/*.png   [--top-k 5]

For each input it loads the v6 head (or v5 if v6 missing — falls back to
zero uncertainty so callers still work), runs a forward pass, and prints
JSON like:

  {
    "ranking": [
      {"path": "...", "uncertainty_score": 1.23, "overall": 0.62, "per_dim_std": {...}},
      ...
    ],
    "model_version": "v6"
  }

`uncertainty_score` is the **dimension-weighted mean predicted std**, which
is what should drive the active-learning router (high = grade this one
first).  Falls back to 0.0 for v5 weights.
"""

import argparse
import json
import sys
from pathlib import Path

import mlx.core as mx
import numpy as np

# Ensure we can import train_v6 / train_v5 from this script's dir
sys.path.insert(0, str(Path(__file__).parent))

from train_v6 import (
    DesignHeadV6, V5_WEIGHTS_PATH, V6_WEIGHTS_PATH,
    SCORE_NAMES, OUTPUT_DIM, DIMENSION_WEIGHTS_NP,
)


def load_model() -> tuple[DesignHeadV6, str]:
    """Prefer v6; fall back to v5 (uncertainty will be 0)."""
    model = DesignHeadV6(dropout=0.0)
    if V6_WEIGHTS_PATH.exists():
        model.load_weights(str(V6_WEIGHTS_PATH))
        version = "v6"
    elif V5_WEIGHTS_PATH.exists():
        model.load_weights(str(V5_WEIGHTS_PATH), strict=False)
        version = "v5"
    else:
        raise FileNotFoundError(
            f"No weights at {V6_WEIGHTS_PATH} or {V5_WEIGHTS_PATH}"
        )
    model.eval()
    return model, version


def score_features(model: DesignHeadV6, features: np.ndarray,
                   code_features: np.ndarray | None = None) -> dict:
    """Single forward pass returning per-dim mean + std + summary score."""
    if features.ndim == 1:
        features = features[None, :]
    if code_features is None:
        code_features = np.zeros((features.shape[0], 64), dtype=np.float32)
    elif code_features.ndim == 1:
        code_features = code_features[None, :]

    feat_mx = mx.array(features.astype(np.float32))
    code_mx = mx.array(code_features.astype(np.float32))

    scores, log_var = model(feat_mx, code_mx, return_uncertainty=True)
    mx.eval(scores, log_var)

    means = np.array(scores)[0]
    log_var = np.clip(np.array(log_var)[0], -7.0, 4.0)
    stds = np.sqrt(np.exp(log_var))

    # Weighted aggregate uncertainty — higher = better candidate to grade
    weighted_std = float(np.sum(stds * DIMENSION_WEIGHTS_NP) / DIMENSION_WEIGHTS_NP.sum())

    return {
        "overall": float(means[SCORE_NAMES.index("overall_aesthetic")]),
        "per_dim_mean": {n: float(means[i]) for i, n in enumerate(SCORE_NAMES)},
        "per_dim_std": {n: float(stds[i]) for i, n in enumerate(SCORE_NAMES)},
        "uncertainty_score": weighted_std,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Rank candidate samples by Phase 6 predicted uncertainty"
    )
    parser.add_argument("--features", nargs="*", default=[],
                        help=".npz files with key 'features' (1280-dim)")
    parser.add_argument("--manifest-indices", nargs="*", default=[],
                        help="Manifest sample indices to score (uses cached features)")
    parser.add_argument("--top-k", type=int, default=None,
                        help="Return only the K highest-uncertainty entries")
    parser.add_argument("--json", action="store_true",
                        help="JSON output (default)")
    args = parser.parse_args()

    model, version = load_model()

    items = []

    # Score precomputed feature files
    for path in args.features:
        try:
            with np.load(path) as npz:
                feat = npz["features"]
                code = npz["code_features"] if "code_features" in npz.files else None
            scored = score_features(model, feat, code)
            scored["path"] = path
            items.append(scored)
        except Exception as e:
            items.append({"path": path, "error": str(e)})

    # Score manifest entries by index — useful for "regrade these stale samples"
    if args.manifest_indices:
        from train_v6 import MANIFEST_PATH
        manifest = json.loads(Path(MANIFEST_PATH).read_text())
        for raw_i in args.manifest_indices:
            try:
                i = int(raw_i)
                sample = manifest["samples"][i]
                feat = np.array(sample.get("mobilenet_features", []), dtype=np.float32)
                if feat.size == 0:
                    items.append({"manifest_index": i, "error": "no features"})
                    continue
                code_arr = sample.get("code_features") or [0.0] * 64
                code = np.array(code_arr, dtype=np.float32)
                scored = score_features(model, feat, code)
                scored["manifest_index"] = i
                scored["source_name"] = sample.get("metadata", {}).get("source_name")
                items.append(scored)
            except Exception as e:
                items.append({"manifest_index": raw_i, "error": str(e)})

    # Rank by uncertainty (descending), errors last
    def sort_key(it):
        if "error" in it:
            return (1, 0.0)
        return (0, -it.get("uncertainty_score", 0.0))

    items.sort(key=sort_key)
    if args.top_k is not None:
        items = items[: args.top_k]

    out = {"model_version": version, "ranking": items}
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
