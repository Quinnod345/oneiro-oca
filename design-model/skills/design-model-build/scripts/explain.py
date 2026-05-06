#!/usr/bin/env python3
"""
explain.py — wrap the distilled VLM (Qwen2.5-VL 3B + LoRA) for deep
structural critique with strengths / weaknesses / fix priorities /
intent fit / Norman balance.

Slower than grade.py (~17s warm vs ~50ms) but produces structured
free-text critique alongside the 16 numerical scores.  Use when the
fast scorer flags an iteration is needed and the LLM wants context
beyond per-dim numbers.

Returns clean JSON to stdout (single object).

Usage
  python3 explain.py path/to/screenshot.png \
      --brief "A minimal task list inspired by Things 3"
"""

import argparse
import json
import sys
from pathlib import Path

# Reuse the implementation from design-model/distill_inference.py
DESIGN_MODEL_DIR = Path(
    "/Users/quinnodonnell/.openclaw/workspace/oneiro-core/cognitive/design-model"
)
sys.path.insert(0, str(DESIGN_MODEL_DIR))


def main() -> int:
    parser = argparse.ArgumentParser(description="Deep VLM critique of a design")
    parser.add_argument("screenshot", help="Path to screenshot PNG")
    parser.add_argument("--brief", default="", help="Design intent / brief")
    parser.add_argument("--max-tokens", type=int, default=700)
    parser.add_argument("--temperature", type=float, default=0.0)
    args = parser.parse_args()

    screenshot = Path(args.screenshot).expanduser().resolve()
    if not screenshot.exists():
        print(json.dumps({"error": f"screenshot not found: {screenshot}"}))
        return 1

    try:
        from distill_inference import DistillModel  # noqa: E402
    except Exception as e:
        print(json.dumps({"error": f"distill_inference unavailable: {e}"}))
        return 1

    model = DistillModel()
    result = model.evaluate(
        screenshot_path=str(screenshot),
        brief=args.brief,
        max_new_tokens=args.max_tokens,
        temperature=args.temperature,
    )
    # Strip raw_output to keep response compact for LLM consumption
    result.pop("raw_output", None)
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
