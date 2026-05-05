#!/usr/bin/env python3
"""
distill_collect.py — collect rich Opus teacher data for VLM distillation.

What this is for
  v9 is a scalar regressor: image + brief → 16 numbers.  It cannot
  EXPLAIN why a design fails — that's a fundamentally different
  capability from scoring it.  To distill into a small VLM (PaliGemma 2,
  SmolVLM, Qwen2.5-VL) that can both score AND reason, we need teacher
  data that pairs each (image, brief) with not just scores but a rich
  natural-language rationale.

Output schema
  data/distill/cycle-{idx:06d}.json — one record per sample:
    {
      "manifest_index": int,
      "screenshot_path": str,
      "brief": str,                   # composed by extract_text.compose_brief
      "scores": {dim: float},         # 16 dims, Opus's verdict
      "rationale": {                  # rich teacher signal
        "dominant_strengths": [...],   # 2-3 bullet points
        "dominant_weaknesses": [...],
        "fix_priorities": [...],       # ordered by expected impact
        "norman_balance": str,         # 1-sentence visceral/behavioral/reflective read
        "intent_fit": str              # 1-sentence "does it solve THIS brief?"
      },
      "captured_at": iso8601
    }

  This is the teacher target — distill_train.py will fine-tune a small
  VLM to reproduce both the scores AND the rationale fields, ideally
  with chain-of-thought (model reasons through dims before scoring).

Cost / time
  Opus image+text → structured JSON: ~$0.07-0.10 per sample, ~10-15s.
  500-sample collection ≈ $35-50, ~75-125 min.  Use --max-samples 5
  for a smoke test (~$0.50, ~1 min).

Usage
  python3 distill_collect.py --dry-run                       # preview targets
  python3 distill_collect.py --max-samples 5                 # smoke test
  python3 distill_collect.py --max-samples 500               # full run
  python3 distill_collect.py --source opus_self_train        # filter source
"""

import argparse
import base64
import io
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from self_train import client  # already-initialized anthropic client

# Reuse the same brief-composition logic so distill targets match what
# train_v9 actually saw at training time.
sys.path.insert(0, str(ROOT / "mlx"))
from extract_text import compose_brief  # noqa: E402

DATA_DIR = ROOT / "data"
MANIFEST_PATH = DATA_DIR / "manifest.json"
DISTILL_DIR = DATA_DIR / "distill"
DISTILL_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_MODEL = "claude-opus-4-7"
MAX_LONG_EDGE = 1568
JPEG_QUALITY = 90
JPEG_QUALITY_FALLBACK = 75
MAX_BYTES = 4 * 1024 * 1024

SCORE_NAMES = [
    "typography_quality", "color_harmony", "spatial_composition",
    "motion_elegance", "emotional_resonance", "craft_visibility",
    "minimalism_coherence", "native_integration",
    "visceral_score", "behavioral_score", "reflective_score",
    "overall_aesthetic",
    "innovation_score", "system_creativity", "design_distinctiveness",
    "problem_level",
]


def encode_image(path: str) -> tuple[str, str]:
    img = Image.open(path).convert("RGB")
    long_edge = max(img.size)
    if long_edge > MAX_LONG_EDGE:
        scale = MAX_LONG_EDGE / long_edge
        img = img.resize(
            (max(1, int(img.size[0] * scale)), max(1, int(img.size[1] * scale))),
            Image.LANCZOS,
        )
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    data = buf.getvalue()
    if len(data) > MAX_BYTES:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=JPEG_QUALITY_FALLBACK, optimize=True)
        data = buf.getvalue()
    return base64.b64encode(data).decode("ascii"), "image/jpeg"


PROMPT_TEMPLATE = """You are a world-class product designer creating teacher
data for distillation.  You will be shown a design (screenshot) and the
intended brief / category.  Produce a rich structured judgment that a
student VLM can learn to reproduce.

DESIGN BRIEF (intent): {brief}

Analyze the design across these 16 dimensions:
  {dim_list}

Return ONLY this JSON shape (no prose, no fences):

{{
  "scores": {{
    "typography_quality": <0.0-1.0>,
    ...all 16 dimensions...
  }},
  "rationale": {{
    "dominant_strengths": ["..", ".."],
    "dominant_weaknesses": ["..", ".."],
    "fix_priorities": ["..", ".."],
    "norman_balance": "1 sentence: visceral vs behavioral vs reflective",
    "intent_fit": "1 sentence: does this design solve the stated brief?"
  }}
}}

Be HARSH and structural.  A 0.7 typography paired with a 0.3 color is a
1-sentence "great type but clashes with the palette" coherence problem,
not just two independent grades.  Strengths/weaknesses should each be
2-3 concrete bullets (10-25 words each).  fix_priorities lists 2-4
ordered by expected impact.
"""


def grade_for_distillation(image_path: str, brief: str,
                           model: str = DEFAULT_MODEL) -> dict | None:
    img_b64, media_type = encode_image(image_path)
    dim_list = ", ".join(SCORE_NAMES)
    prompt = PROMPT_TEMPLATE.format(brief=brief or "unknown design", dim_list=dim_list)

    msg = client.messages.create(
        model=model,
        max_tokens=2500,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {
                    "type": "base64", "media_type": media_type, "data": img_b64
                }},
                {"type": "text", "text": prompt},
            ],
        }],
    )
    raw = msg.content[0].text
    m = re.search(r"\{[\s\S]*\}", raw)
    if not m:
        return None
    try:
        parsed = json.loads(m.group())
    except json.JSONDecodeError:
        return None

    # Validate shape
    if "scores" not in parsed or "rationale" not in parsed:
        return None
    scores = parsed["scores"]
    if not all(name in scores for name in SCORE_NAMES):
        return None
    return parsed


def find_targets(source_filter: str | None,
                 only_with_critique: bool = False) -> list[dict]:
    """Return manifest samples that have a screenshot and aren't yet
    distilled.  Filter by source / critique availability if requested."""
    manifest = json.loads(MANIFEST_PATH.read_text())
    existing = {p.stem.replace("cycle-", "") for p in DISTILL_DIR.glob("cycle-*.json")}

    targets = []
    for mi, sample in enumerate(manifest["samples"]):
        if source_filter and sample.get("source") != source_filter:
            continue
        screenshot = sample.get("screenshot_path") or sample.get("image", "")
        if not screenshot or not Path(screenshot).exists():
            continue
        if not screenshot.endswith((".png", ".jpg", ".jpeg")):
            continue
        # Idempotent — skip already-distilled samples
        idx_str = f"{mi:06d}"
        if idx_str in existing:
            continue
        brief = compose_brief(sample)
        targets.append({
            "manifest_index": mi,
            "screenshot_path": screenshot,
            "brief": brief,
            "category": sample.get("metadata", {}).get("category", ""),
            "source": sample.get("source", ""),
        })
    return targets


def main():
    parser = argparse.ArgumentParser(description="Collect Opus teacher data for VLM distillation")
    parser.add_argument("--max-samples", type=int, default=None)
    parser.add_argument("--source", default=None,
                        help="Filter by manifest source (e.g., opus_self_train)")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-failures", type=int, default=3)
    args = parser.parse_args()

    print(f"[distill] scanning manifest for samples needing teacher data...")
    targets = find_targets(args.source)
    print(f"[distill] {len(targets)} candidates "
          f"(source={args.source or 'any'})")

    if not targets:
        print("[distill] nothing to do — all samples already distilled.")
        return 0

    if args.max_samples:
        targets = targets[: args.max_samples]
        print(f"[distill] capping to {len(targets)}")

    for t in targets[:5]:
        print(f"  idx {t['manifest_index']:3d} ({t['source']:<18s}) "
              f"{Path(t['screenshot_path']).name}: {t['brief'][:60]}")
    if len(targets) > 5:
        print(f"  ... ({len(targets) - 5} more)")

    cost_est = len(targets) * 0.08
    print(f"[distill] estimated cost: ~${cost_est:.2f}")

    if args.dry_run:
        print("[distill] dry run — no API calls made.")
        return 0

    failures_in_a_row = 0
    succeeded = 0
    t0_total = time.time()

    for k, t in enumerate(targets, 1):
        idx = t["manifest_index"]
        print(f"\n[{k:3d}/{len(targets)}] cycle idx={idx} ({t['source']}) "
              f"calling Opus...")
        t_start = time.time()
        try:
            parsed = grade_for_distillation(
                t["screenshot_path"], t["brief"], model=args.model
            )
        except Exception as e:
            failures_in_a_row += 1
            print(f"  [FAIL] api error: {str(e)[:120]} "
                  f"[{failures_in_a_row}/{args.max_failures}]")
            if failures_in_a_row >= args.max_failures:
                print(f"\n[distill] aborting — {failures_in_a_row} failures in a row")
                break
            continue

        elapsed = time.time() - t_start
        if not parsed:
            failures_in_a_row += 1
            print(f"  [FAIL] no usable JSON parsed ({elapsed:.1f}s) "
                  f"[{failures_in_a_row}/{args.max_failures}]")
            if failures_in_a_row >= args.max_failures:
                break
            continue
        failures_in_a_row = 0

        record = {
            "manifest_index": idx,
            "screenshot_path": t["screenshot_path"],
            "brief": t["brief"],
            "category": t["category"],
            "source": t["source"],
            "scores": {n: max(0.0, min(1.0, float(parsed["scores"].get(n, 0.5))))
                       for n in SCORE_NAMES},
            "rationale": parsed["rationale"],
            "model": args.model,
            "captured_at": datetime.now(timezone.utc).isoformat(),
        }
        out_path = DISTILL_DIR / f"cycle-{idx:06d}.json"
        out_path.write_text(json.dumps(record, indent=2))
        succeeded += 1

        rate = succeeded / max(time.time() - t0_total, 1)
        eta = (len(targets) - k) / max(rate, 0.01)
        overall = record["scores"]["overall_aesthetic"]
        print(f"  [done] saved {out_path.name} ({elapsed:.1f}s) "
              f"overall={overall:.2f}  ~{eta/60:.1f} min remaining")

    elapsed_total = time.time() - t0_total
    print(f"\n[distill] complete: {succeeded}/{len(targets)} records written")
    print(f"[distill] elapsed: {elapsed_total/60:.1f} min")
    print(f"[distill] ${succeeded * 0.08:.2f} approximate spend")
    print(f"[distill] next: python3 mlx/distill_train.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
