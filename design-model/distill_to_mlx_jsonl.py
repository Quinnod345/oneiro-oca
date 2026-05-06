#!/usr/bin/env python3
"""
distill_to_mlx_jsonl.py — convert data/distill/cycle-*.json teacher records
into a HuggingFace-loadable JSONL dataset for mlx-vlm LoRA training.

Output structure
  data/distill_mlx/train.jsonl    one record per training example
  data/distill_mlx/test.jsonl     a small held-out slice for eval

Each line:
  {
    "images": ["/abs/path/to/screenshot.png"],
    "messages": [
      {"role": "user", "content": [
        {"type": "image"},
        {"type": "text", "text": "<prompt with brief>"}
      ]},
      {"role": "assistant", "content": [
        {"type": "text", "text": "<rationale + scores>"}
      ]}
    ]
  }

Usage
  python3 distill_to_mlx_jsonl.py
  python3 distill_to_mlx_jsonl.py --val-ratio 0.1
"""

import argparse
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).parent
DISTILL_DIR = ROOT / "data" / "distill"
OUT_DIR = ROOT / "data" / "distill_mlx"

SCORE_NAMES = [
    "typography_quality", "color_harmony", "spatial_composition",
    "motion_elegance", "emotional_resonance", "craft_visibility",
    "minimalism_coherence", "native_integration",
    "visceral_score", "behavioral_score", "reflective_score",
    "overall_aesthetic",
    "innovation_score", "system_creativity", "design_distinctiveness",
    "problem_level",
]


def format_target(record: dict) -> str:
    rat = record["rationale"]
    scores = record["scores"]
    parts = ["DESIGN ANALYSIS"]
    if rat.get("dominant_strengths"):
        parts.append("Strengths: " + " | ".join(rat["dominant_strengths"]))
    if rat.get("dominant_weaknesses"):
        parts.append("Weaknesses: " + " | ".join(rat["dominant_weaknesses"]))
    if rat.get("intent_fit"):
        parts.append(f"Intent fit: {rat['intent_fit']}")
    if rat.get("norman_balance"):
        parts.append(f"Norman balance: {rat['norman_balance']}")
    if rat.get("fix_priorities"):
        parts.append("Fix priorities: " + " > ".join(rat["fix_priorities"]))
    parts.append("")
    parts.append("SCORES")
    for name in SCORE_NAMES:
        parts.append(f"  {name}: {scores.get(name, 0.5):.2f}")
    return "\n".join(parts)


def format_prompt(record: dict) -> str:
    return (
        f"You are a world-class product designer evaluating a UI/app design.\n"
        f"BRIEF: {record.get('brief', 'unknown')}\n\n"
        f"Examine the design above and produce a structured analysis with "
        f"strengths, weaknesses, intent fit, Norman balance, fix priorities, "
        f"and 16-dimensional scores."
    )


def to_mlx_record(record: dict) -> dict | None:
    """Emit a {images, question, answer} record.  mlx-vlm's
    transform_dataset_to_messages will wrap question/answer in the
    model-specific chat template at training time, so this format
    works across LLaVA, Qwen2.5-VL, PaliGemma, etc. without us having
    to reimplement each model's prompt grammar."""
    img_path = record["screenshot_path"]
    if not Path(img_path).exists():
        return None
    return {
        "images": [str(Path(img_path).resolve())],
        "question": format_prompt(record),
        "answer": format_target(record),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--val-ratio", type=float, default=0.05,
                        help="Fraction of records held out for eval split")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--epochs", type=int, default=1,
                        help="Pre-duplicate train records this many times "
                             "(workaround for mlx-vlm 0.4.4 select bug — "
                             "epoch math with --epochs N tries to slice "
                             "the dataset to N*size, which errors). Set "
                             "the same number you'd otherwise pass to "
                             "--epochs in mlx-vlm.")
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    records = []
    for path in sorted(DISTILL_DIR.glob("cycle-*.json")):
        try:
            rec = json.loads(path.read_text())
            mlx_rec = to_mlx_record(rec)
            if mlx_rec:
                records.append(mlx_rec)
        except Exception as e:
            print(f"  [skip] {path.name}: {e}", file=sys.stderr)

    if not records:
        print("[convert] no usable records found", file=sys.stderr)
        return 1

    rng = random.Random(args.seed)
    rng.shuffle(records)
    n_val = max(1, int(len(records) * args.val_ratio))
    base_train = records[n_val:]
    val_records = records[:n_val]

    # Bake epochs into train.jsonl by duplicating + reshuffling per epoch.
    # Each epoch gets a different shuffle so the optimizer sees varied
    # ordering, equivalent to running multiple epochs natively.
    train_records = []
    for ep in range(args.epochs):
        ep_rng = random.Random(args.seed + ep + 1)
        epoch_copy = list(base_train)
        ep_rng.shuffle(epoch_copy)
        train_records.extend(epoch_copy)

    train_path = OUT_DIR / "train.jsonl"
    val_path = OUT_DIR / "test.jsonl"

    with train_path.open("w") as f:
        for r in train_records:
            f.write(json.dumps(r) + "\n")
    with val_path.open("w") as f:
        for r in val_records:
            f.write(json.dumps(r) + "\n")

    print(f"[convert] wrote {len(train_records)} train ({len(base_train)} unique × {args.epochs} epochs) "
          f"+ {len(val_records)} val records")
    print(f"[convert] columns per record: {sorted(records[0].keys())}")
    print(f"[convert] sample question: {records[0]['question'][:140]}...")
    return 0


if __name__ == "__main__":
    sys.exit(main())
