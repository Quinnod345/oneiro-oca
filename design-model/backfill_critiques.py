#!/usr/bin/env python3
"""
backfill_critiques.py — generate Phase 5 critique JSONs for older
opus_self_train manifest samples that pre-date the critique-saving code.

The Phase 5 aux head needs ≥20 manifest samples whose `source_name`
cycle id has a matching cycle-{id:06d}.json critique on disk.  Currently
that overlap is 0 — older opus_self_train cycles (ids 13-6827) have no
critique JSONs because save_critique_for_training was added later, and
the newer cycles that DO have critiques (13723-13741) haven't yet been
through the manifest pipeline in matching numbers.

This script closes the gap deterministically: for every opus_self_train
manifest sample that's missing a critique JSON, it asks Opus to write a
short structural critique using the stored screenshot as the input,
then writes data/critiques/cycle-{id:06d}.json in the canonical format
embed_critiques.py expects.

Cost: ~$0.05 per sample with claude-opus-4-* + image input.  170 samples
≈ $8-10 total.  Wall time ≈ 30 minutes (Opus latency dominates).

Idempotent: skips samples that already have a critique on disk.

Usage:
    python3 backfill_critiques.py                     # default: all 170
    python3 backfill_critiques.py --max-samples 5     # smoke test
    python3 backfill_critiques.py --dry-run           # list targets only
    python3 backfill_critiques.py --source flywheel   # backfill flywheel too

After this:
    python3 mlx/embed_critiques.py        # embed the new critique texts
    python3 mlx/train_v7.py --epochs 500 --patience 80 --seeds 3
    # — Phase 5 aux head should auto-enable now
"""

import argparse
import base64
import io
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from self_train import client, SCORE_NAMES, save_critique_for_training  # noqa

DATA_DIR = ROOT / "data"
MANIFEST_PATH = DATA_DIR / "manifest.json"
CRITIQUES_DIR = DATA_DIR / "critiques"
CRITIQUES_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_MODEL = "claude-opus-4-7"

# Match the resize/encode logic from pairwise_grade.py — Anthropic vision
# rejects >5MB encoded images; pre-shrinking + JPEG keeps us safely under.
MAX_LONG_EDGE = 1568
JPEG_QUALITY = 90
JPEG_QUALITY_FALLBACK = 75
MAX_BYTES = 4 * 1024 * 1024


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


CRITIQUE_PROMPT = f"""You are a world-class product designer reviewing a design
artifact for a structural critique.

Look at the screenshot and write a 2-3 sentence critique that explains the
*structural* qualities of the design — what works, what fails, and WHY.
Focus on relationships between dimensions, not isolated scores.  Examples
of useful structural notes:
  - "Great typography but clashes with the palette"
  - "Strong visceral impact, weak behavioral affordances"
  - "Innovative concept undermined by generic execution at the detail layer"
  - "Painstaking craft on the components but the gestalt feels generic"

Be concrete and concise.  No grades, no fixes — just the WHY.

Respond with ONLY this JSON shape:

{{"critique": "..."}}
"""


def call_opus_critique(image_path: str, model: str = DEFAULT_MODEL) -> str | None:
    img_b64, media_type = encode_image(image_path)
    msg = client.messages.create(
        model=model,
        max_tokens=600,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {
                    "type": "base64", "media_type": media_type, "data": img_b64
                }},
                {"type": "text", "text": CRITIQUE_PROMPT},
            ],
        }],
    )
    raw = msg.content[0].text
    m = re.search(r"\{[\s\S]*\}", raw)
    if not m:
        return None
    try:
        parsed = json.loads(m.group())
        crit = (parsed.get("critique") or "").strip()
        return crit if len(crit) > 20 else None
    except json.JSONDecodeError:
        return None


_CYCLE_RE = re.compile(r"(?:self[-_]train[-_](\d+))|(?:cycle[-_]?(\d+))",
                       re.IGNORECASE)


def extract_cycle_id(s):
    if not s:
        return None
    m = _CYCLE_RE.search(str(s))
    if m:
        try:
            return int(m.group(1) or m.group(2))
        except (ValueError, TypeError):
            return None
    return None


def find_targets(source_filter: str | None) -> list[dict]:
    """Return list of {cycle_id, sample, manifest_index} for samples that
    match the source filter and don't already have a critique JSON."""
    manifest = json.loads(MANIFEST_PATH.read_text())
    existing_files = {p.name for p in CRITIQUES_DIR.glob("cycle-*.json")}

    targets = []
    for mi, sample in enumerate(manifest["samples"]):
        if source_filter and sample.get("source") != source_filter:
            continue
        if not source_filter and sample.get("source") != "opus_self_train":
            # Default scope is opus_self_train — that's where the gap lives.
            continue

        meta = sample.get("metadata", {})
        cycle_id = extract_cycle_id(meta.get("source_name"))
        if cycle_id is None:
            cycle_id = extract_cycle_id(meta.get("code_path"))
        if cycle_id is None:
            continue

        # Skip if critique already exists with content
        critique_filename = f"cycle-{cycle_id:06d}.json"
        if critique_filename in existing_files:
            try:
                rec = json.loads((CRITIQUES_DIR / critique_filename).read_text())
                if rec.get("critique"):
                    continue  # already done
            except Exception:
                pass  # corrupt — overwrite

        screenshot = sample.get("screenshot_path") or sample.get("image", "")
        if not screenshot or not Path(screenshot).exists():
            continue
        if not screenshot.endswith((".png", ".jpg", ".jpeg")):
            continue

        targets.append({
            "cycle_id": cycle_id,
            "sample": sample,
            "manifest_index": mi,
        })
    return targets


def main():
    parser = argparse.ArgumentParser(description="Phase 5 critique backfill")
    parser.add_argument("--max-samples", type=int, default=None,
                        help="Cap number of samples to backfill (default: all)")
    parser.add_argument("--source", default=None,
                        help="Filter by manifest source (default: opus_self_train)")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-failures", type=int, default=3,
                        help="Abort after N consecutive parse/API failures")
    args = parser.parse_args()

    print(f"[backfill] scanning manifest for samples missing critique JSONs...")
    targets = find_targets(args.source)
    print(f"[backfill] {len(targets)} samples need critiques "
          f"(source={args.source or 'opus_self_train'})")

    if not targets:
        print("[backfill] nothing to do — Phase 5 critique coverage is complete "
              "for this source.")
        return 0

    if args.max_samples:
        targets = targets[: args.max_samples]
        print(f"[backfill] capping to {len(targets)}")

    # Show first few
    for t in targets[:5]:
        sn = t["sample"].get("metadata", {}).get("source_name", "")
        print(f"  cycle {t['cycle_id']} (idx {t['manifest_index']:3d}): {sn}")
    if len(targets) > 5:
        print(f"  ... ({len(targets) - 5} more)")

    cost_est = len(targets) * 0.05
    print(f"[backfill] estimated cost: ~${cost_est:.2f}")

    if args.dry_run:
        print("[backfill] dry run — no API calls made.")
        return 0

    failures_in_a_row = 0
    succeeded = 0
    t0_total = time.time()

    for k, t in enumerate(targets, 1):
        cycle_id = t["cycle_id"]
        sample = t["sample"]
        screenshot = sample.get("screenshot_path") or sample.get("image")

        # Detect language from extension or category
        meta = sample.get("metadata", {})
        sn = meta.get("source_name", "")
        if "swiftui" in sn:
            language = "swiftui"
        elif "react" in sn:
            language = "react"
        else:
            language = "html"

        print(f"\n[{k:3d}/{len(targets)}] cycle {cycle_id} ({language}) — "
              f"calling Opus...")
        t0 = time.time()
        try:
            critique = call_opus_critique(screenshot, model=args.model)
        except Exception as e:
            failures_in_a_row += 1
            print(f"  [FAIL] api error: {str(e)[:120]} "
                  f"[{failures_in_a_row}/{args.max_failures}]")
            if failures_in_a_row >= args.max_failures:
                print(f"\n[backfill] aborting — {failures_in_a_row} failures in a row")
                break
            continue

        elapsed = time.time() - t0

        if not critique:
            failures_in_a_row += 1
            print(f"  [FAIL] no usable critique parsed ({elapsed:.1f}s) "
                  f"[{failures_in_a_row}/{args.max_failures}]")
            if failures_in_a_row >= args.max_failures:
                print(f"\n[backfill] aborting — {failures_in_a_row} failures in a row")
                break
            continue
        failures_in_a_row = 0

        # Write a Phase-5-format critique record using the same helper as
        # the live self_train loop.  Scores come from the manifest (already
        # graded); fixes is empty since we're not regrading.
        save_critique_for_training(
            cycle_num=cycle_id,
            language=language,
            brief=meta.get("category", "") or "",
            code="",  # not strictly needed for embed_critiques
            scores=sample.get("scores", {}) or {},
            overall=float(sample.get("scores", {}).get("overall_aesthetic", 0.5)),
            innovation=float(sample.get("scores", {}).get("innovation_score", 0.5)),
            critique=critique,
            fixes=[],
            has_screenshot=True,
            code_path=meta.get("code_path", "") or "",
            png_path=screenshot,
        )
        succeeded += 1
        rate = succeeded / max(time.time() - t0_total, 1)
        eta = (len(targets) - k) / max(rate, 0.01)
        print(f"  [done] saved cycle-{cycle_id:06d}.json ({elapsed:.1f}s, "
              f"~{eta/60:.1f} min remaining)")
        print(f"  critique: {critique[:140]}{'...' if len(critique) > 140 else ''}")

    elapsed_total = time.time() - t0_total
    print(f"\n[backfill] complete: {succeeded}/{len(targets)} critiques written")
    print(f"[backfill] elapsed: {elapsed_total/60:.1f} min")
    print(f"[backfill] ${succeeded * 0.05:.2f} approximate spend")
    print(f"[backfill] next: python3 mlx/embed_critiques.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
