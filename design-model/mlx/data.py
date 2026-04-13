"""
Design Dataset — multi-source training data management for the design evaluation model.
Sources: LLM-judged artifacts, human-scored screenshots, comparative pairs, reference app screenshots.
Optimized for M4 Max unified memory — no CPU→GPU transfer overhead.
"""

import json
import os
from pathlib import Path
from typing import Optional

import mlx.core as mx
import numpy as np
from PIL import Image

DATA_DIR = Path(__file__).parent.parent / "data"
MANIFEST_PATH = DATA_DIR / "manifest.json"
IMAGE_SIZE = 224  # MobileNet V2 input size

# 12 design dimensions
SCORE_NAMES = [
    "typography_quality", "color_harmony", "spatial_composition",
    "motion_elegance", "emotional_resonance", "craft_visibility",
    "minimalism_coherence", "native_integration",
    "visceral_score", "behavioral_score", "reflective_score",
    "overall_aesthetic",
]

# Per-dimension loss weights (emotional_resonance and overall weighted highest)
DIMENSION_WEIGHTS = mx.array([
    1.2,  # typography_quality
    1.1,  # color_harmony
    1.1,  # spatial_composition
    0.9,  # motion_elegance (harder from static image)
    1.3,  # emotional_resonance (most important)
    1.2,  # craft_visibility
    1.0,  # minimalism_coherence
    1.0,  # native_integration
    1.2,  # visceral_score
    1.0,  # behavioral_score
    1.1,  # reflective_score
    1.5,  # overall_aesthetic (highest weight)
], dtype=mx.float32)


def load_and_preprocess_image(path: str, size: int = IMAGE_SIZE) -> np.ndarray:
    """Load image, resize to (size, size), normalize to [0, 1]."""
    img = Image.open(path).convert("RGB")
    img = img.resize((size, size), Image.LANCZOS)
    arr = np.array(img, dtype=np.float32) / 255.0
    return arr  # (H, W, 3)


def augment_image(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """
    Light augmentation for design screenshots.
    NO horizontal flip (design is directional).
    NO heavy distortion (preserve design intent).
    """
    h, w, c = img.shape

    # Random brightness (±20%)
    brightness = 1.0 + rng.uniform(-0.2, 0.2)
    img = np.clip(img * brightness, 0, 1)

    # Random contrast (±20%)
    mean = img.mean()
    contrast = 1.0 + rng.uniform(-0.2, 0.2)
    img = np.clip((img - mean) * contrast + mean, 0, 1)

    # Random saturation shift (±15%)
    gray = np.mean(img, axis=-1, keepdims=True)
    sat = 1.0 + rng.uniform(-0.15, 0.15)
    img = np.clip(gray + sat * (img - gray), 0, 1)

    # Random crop and resize (70-100% of original)
    scale = rng.uniform(0.7, 1.0)
    crop_h = int(h * scale)
    crop_w = int(w * scale)
    top = rng.integers(0, h - crop_h + 1)
    left = rng.integers(0, w - crop_w + 1)
    cropped = img[top:top + crop_h, left:left + crop_w]

    # Resize back
    from PIL import Image as PILImage
    pil = PILImage.fromarray((cropped * 255).astype(np.uint8))
    pil = pil.resize((w, h), PILImage.LANCZOS)
    img = np.array(pil, dtype=np.float32) / 255.0

    return img


class DesignDataset:
    """
    Multi-source design training dataset.

    Manifest format (manifest.json):
    {
        "samples": [
            {
                "image": "path/to/screenshot.png",
                "scores": {"typography_quality": 0.8, ...},
                "source": "llm_judge",
                "code_features": [0.5, 0.3, ...],  // optional 64-dim
                "metadata": {"app": "alcove", ...}  // optional
            },
            ...
        ]
    }
    """

    def __init__(self, data_dir: Optional[str] = None, augment: bool = True):
        self.data_dir = Path(data_dir) if data_dir else DATA_DIR
        self.augment = augment
        self.rng = np.random.default_rng(42)
        self.samples = []
        self._load_manifest()

    def _load_manifest(self):
        manifest_path = self.data_dir / "manifest.json"
        if not manifest_path.exists():
            # Create empty manifest
            self.data_dir.mkdir(parents=True, exist_ok=True)
            with open(manifest_path, "w") as f:
                json.dump({"samples": []}, f, indent=2)
            return

        with open(manifest_path) as f:
            data = json.load(f)

        self.samples = []
        for sample in data.get("samples", []):
            # Prefer screenshot_path (PNG) over image (may be HTML)
            img_path = sample.get("screenshot_path") or sample.get("image", "")
            if not os.path.isabs(img_path):
                img_path = str(self.data_dir / img_path)
            # Skip non-image files (HTML artifacts without screenshots)
            if not os.path.exists(img_path) or img_path.endswith('.html'):
                continue
            self.samples.append({
                "image": img_path,
                "scores": sample.get("scores", {}),
                "source": sample.get("source", "unknown"),
                "code_features": sample.get("code_features"),
                "metadata": sample.get("metadata", {}),
            })

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        sample = self.samples[idx]
        img = load_and_preprocess_image(sample["image"])

        if self.augment:
            img = augment_image(img, self.rng)

        # Build target scores (12-dim)
        target = np.zeros(len(SCORE_NAMES), dtype=np.float32)
        for i, name in enumerate(SCORE_NAMES):
            target[i] = float(sample["scores"].get(name, 0.5))

        # Code features (64-dim, optional)
        code_features = None
        if sample.get("code_features"):
            code_features = np.array(sample["code_features"], dtype=np.float32)

        return img, target, code_features

    def batches(self, batch_size: int = 32, shuffle: bool = True):
        """Yield batches as MLX arrays. M4 Max optimized — large batch sizes."""
        indices = np.arange(len(self.samples))
        if shuffle:
            self.rng.shuffle(indices)

        for start in range(0, len(indices), batch_size):
            batch_idx = indices[start:start + batch_size]
            imgs, targets, features_list = [], [], []
            has_all_features = True

            for idx in batch_idx:
                img, target, code_feat = self[idx]
                imgs.append(img)
                targets.append(target)
                if code_feat is not None:
                    features_list.append(code_feat)
                else:
                    has_all_features = False
                    # Zero-fill missing code features so batches stay consistent
                    features_list.append(np.zeros(64, dtype=np.float32))

            # Stack into MLX arrays (bfloat16 for M4 Max efficiency)
            batch_imgs = mx.array(np.stack(imgs))
            batch_targets = mx.array(np.stack(targets))
            # Only pass features if at least some samples have them
            batch_features = mx.array(np.stack(features_list)) if features_list else None

            yield batch_imgs, batch_targets, batch_features

    def add_sample(self, image_path: str, scores: dict, source: str = "llm_judge",
                   code_features=None, metadata=None):
        """Add a new training sample to the dataset."""
        sample = {
            "image": image_path,
            "scores": scores,
            "source": source,
        }
        if code_features is not None:
            sample["code_features"] = list(code_features) if hasattr(code_features, '__iter__') else code_features
        if metadata:
            sample["metadata"] = metadata

        self.samples.append({
            "image": image_path,
            "scores": scores,
            "source": source,
            "code_features": code_features,
            "metadata": metadata or {},
        })

        # Update manifest
        self._save_manifest()

    def _save_manifest(self):
        manifest_path = self.data_dir / "manifest.json"
        data = {"samples": []}
        for s in self.samples:
            entry = {
                "image": s["image"],
                "scores": s["scores"],
                "source": s["source"],
            }
            if s.get("code_features") is not None:
                cf = s["code_features"]
                entry["code_features"] = list(cf) if hasattr(cf, '__iter__') else cf
            if s.get("metadata"):
                entry["metadata"] = s["metadata"]
            data["samples"].append(entry)

        self.data_dir.mkdir(parents=True, exist_ok=True)
        with open(manifest_path, "w") as f:
            json.dump(data, f, indent=2)

    def split(self, val_ratio: float = 0.15):
        """Split into train and validation sets."""
        n = len(self.samples)
        n_val = max(1, int(n * val_ratio))
        indices = np.arange(n)
        self.rng.shuffle(indices)

        val_indices = set(indices[:n_val].tolist())
        train = DesignDataset.__new__(DesignDataset)
        val = DesignDataset.__new__(DesignDataset)

        train.data_dir = self.data_dir
        train.augment = True
        train.rng = np.random.default_rng(42)
        train.samples = [s for i, s in enumerate(self.samples) if i not in val_indices]

        val.data_dir = self.data_dir
        val.augment = False  # No augmentation for validation
        val.rng = np.random.default_rng(123)
        val.samples = [s for i, s in enumerate(self.samples) if i in val_indices]

        return train, val

    def stats(self):
        """Return dataset statistics."""
        if not self.samples:
            return {"count": 0, "sources": {}}

        sources = {}
        for s in self.samples:
            src = s.get("source", "unknown")
            sources[src] = sources.get(src, 0) + 1

        # Score distribution
        all_scores = {name: [] for name in SCORE_NAMES}
        for s in self.samples:
            for name in SCORE_NAMES:
                if name in s.get("scores", {}):
                    all_scores[name].append(s["scores"][name])

        score_stats = {}
        for name, vals in all_scores.items():
            if vals:
                arr = np.array(vals)
                score_stats[name] = {
                    "mean": float(arr.mean()),
                    "std": float(arr.std()),
                    "min": float(arr.min()),
                    "max": float(arr.max()),
                }

        return {
            "count": len(self.samples),
            "sources": sources,
            "score_stats": score_stats,
            "has_code_features": sum(1 for s in self.samples if s.get("code_features")),
        }


class ComparativeDataset:
    """
    Dataset for comparative preference training (RLHF-style).
    Each sample is a pair of images with per-dimension preference labels.

    Manifest format:
    {
        "pairs": [
            {
                "image_a": "path/to/a.png",
                "image_b": "path/to/b.png",
                "preferences": {
                    "typography_quality": {"winner": "A", "margin": 0.3},
                    ...
                }
            }
        ]
    }
    """

    def __init__(self, data_dir: Optional[str] = None):
        self.data_dir = Path(data_dir) if data_dir else DATA_DIR
        self.pairs = []
        self._load()

    def _load(self):
        path = self.data_dir / "comparisons.json"
        if not path.exists():
            return
        with open(path) as f:
            data = json.load(f)
        self.pairs = data.get("pairs", [])

    def __len__(self):
        return len(self.pairs)

    def batches(self, batch_size: int = 16):
        """Yield paired batches for preference training."""
        indices = np.arange(len(self.pairs))
        np.random.shuffle(indices)

        for start in range(0, len(indices), batch_size):
            batch_idx = indices[start:start + batch_size]
            imgs_a, imgs_b, prefs = [], [], []

            for idx in batch_idx:
                pair = self.pairs[idx]
                img_a = load_and_preprocess_image(pair["image_a"])
                img_b = load_and_preprocess_image(pair["image_b"])
                imgs_a.append(img_a)
                imgs_b.append(img_b)

                # Encode preferences as target difference
                pref_vec = np.zeros(len(SCORE_NAMES), dtype=np.float32)
                for i, name in enumerate(SCORE_NAMES):
                    p = pair.get("preferences", {}).get(name, {})
                    margin = float(p.get("margin", 0.5)) * 0.2
                    winner = p.get("winner", "tie")
                    if winner == "A":
                        pref_vec[i] = margin
                    elif winner == "B":
                        pref_vec[i] = -margin
                prefs.append(pref_vec)

            yield (
                mx.array(np.stack(imgs_a)),
                mx.array(np.stack(imgs_b)),
                mx.array(np.stack(prefs)),
            )


if __name__ == "__main__":
    # Quick test
    ds = DesignDataset()
    print(f"Dataset: {len(ds)} samples")
    print(f"Stats: {json.dumps(ds.stats(), indent=2)}")
