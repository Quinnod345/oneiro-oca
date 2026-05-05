#!/usr/bin/env python3
"""
pairwise_grade.py — Phase 8+ pairwise grader.

Asks Opus for explicit A-vs-B preference comparisons on informative
manifest sample pairs and appends the results to comparisons.json,
where train_v7's pair loader picks them up automatically.

Why this beats more raw self_train data
  Opus's per-dimension absolute scores carry meaningful noise (±10% on
  a 0-1 scale isn't unusual — see how regrade_uncertain finds dims that
  shift across re-evaluations).  Pairwise judgments are statistically
  more reliable for the same dollar spent: "is A's typography better
  than B's?" is a more constrained question than "what's A's typography
  score from 0 to 1?".  v7's Phase 8 already showed pair signal driving
  most of the val_loss improvement; this script generates the higher-
  quality version of that signal.

Sample selection
  - Restrict to samples with screenshots on disk.
  - Apply the same train/val split as train_v7 (seed=42, ratio=0.15)
    and ONLY sample pairs from the train split — keeps the val MAE
    a clean held-out metric.
  - Pair candidates: same-train-split samples whose overall_aesthetic
    scores differ by < pair_overall_max (default 0.10).  Close-score
    pairs are the most informative — Opus's verdict refines fine-grained
    orderings the absolute scores can't.
  - Stratify by source category (with a cap per category) so we don't
    over-sample one type of design.

Cost control
  Each pair = one Opus API call with two images = roughly $0.05-0.10.
  Default --max-pairs 50 (~$3-5).  Use --dry-run to preview the pair
  list and --max-pairs 5 for a smoke test.

Output
  Appends to data/comparisons.json with source='opus_pairwise_grader'.
  Backs up the old comparisons.json (timestamped .bak.json) before any
  write so existing flywheel pairs are recoverable.
"""

import argparse
import base64
import json
import re
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

# Reuse self_train's anthropic client setup so we don't duplicate env loading
ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from self_train import client  # already initialized with .env API key

DATA_DIR = ROOT / "data"
MANIFEST_PATH = DATA_DIR / "manifest.json"
COMPARISONS_PATH = DATA_DIR / "comparisons.json"

DEFAULT_MAX_PAIRS = 50
DEFAULT_OVERALL_MAX_MARGIN = 0.10
DEFAULT_PER_CATEGORY_CAP = 8
DEFAULT_MODEL = "claude-opus-4-20250514"

SCORE_NAMES = [
    "typography_quality", "color_harmony", "spatial_composition",
    "motion_elegance", "emotional_resonance", "craft_visibility",
    "minimalism_coherence", "native_integration",
    "visceral_score", "behavioral_score", "reflective_score",
    "overall_aesthetic",
    "innovation_score", "system_creativity", "design_distinctiveness",
    "problem_level",
]

# Match train_v7.FeatureDatasetV7.split() exactly — same seed, same ratio
SPLIT_SEED = 42
VAL_RATIO = 0.15


# ═══════════════════════════════════════════════════
# SAMPLE LOADING & PAIR SELECTION
# ═══════════════════════════════════════════════════


def load_train_samples():
    """Return list of (manifest_index, sample_dict) for samples in the
    train split with both pooled features and an on-disk screenshot.
    Mirrors train_v7's split logic so we never grade a val pair."""
    with open(MANIFEST_PATH) as f:
        manifest = json.load(f)

    eligible = []
    for mi, sample in enumerate(manifest["samples"]):
        feat = sample.get("mobilenet_features")
        if not feat or len(feat) != 1280:
            continue
        screenshot = sample.get("screenshot_path") or sample.get("image")
        if not screenshot or not Path(screenshot).exists():
            continue
        if not screenshot.endswith((".png", ".jpg", ".jpeg")):
            continue
        scores = sample.get("scores", {})
        if "overall_aesthetic" not in scores:
            continue
        eligible.append((mi, sample))

    # Same split as train_v7
    rng = np.random.default_rng(SPLIT_SEED)
    n = len(eligible)
    indices = np.arange(n)
    rng.shuffle(indices)
    n_val = max(2, int(n * VAL_RATIO))
    val_set = set(indices[:n_val].tolist())

    train_samples = [eligible[i] for i in range(n) if i not in val_set]
    return train_samples


def select_pairs(samples, max_pairs, overall_max_margin, per_category_cap, seed=0):
    """Sample up to max_pairs close-score pairs, stratified by category."""
    rng = np.random.default_rng(seed)
    overalls = np.array([s["scores"]["overall_aesthetic"] for _, s in samples])

    # Group by category for stratification
    cats = {}
    for k, (_, s) in enumerate(samples):
        cat = s.get("metadata", {}).get("category") or s.get("source", "unknown")
        cats.setdefault(cat, []).append(k)

    candidates = []  # (k_a, k_b, overall_margin, category)
    for cat, idxs in cats.items():
        if len(idxs) < 2:
            continue
        # All within-category pairs whose overall margin is small enough
        cat_pairs = []
        for i in range(len(idxs)):
            for j in range(i + 1, len(idxs)):
                ki, kj = idxs[i], idxs[j]
                margin = abs(overalls[ki] - overalls[kj])
                if margin < overall_max_margin:
                    cat_pairs.append((ki, kj, float(margin), cat))
        # Cap per category
        if len(cat_pairs) > per_category_cap:
            picks = rng.choice(len(cat_pairs), per_category_cap, replace=False)
            cat_pairs = [cat_pairs[k] for k in picks]
        candidates.extend(cat_pairs)

    # Also allow a small fraction of cross-category close pairs to add diversity
    cross_pool = []
    n = len(samples)
    for _ in range(max_pairs * 3):
        i = int(rng.integers(0, n))
        j = int(rng.integers(0, n))
        if i == j:
            continue
        margin = abs(float(overalls[i]) - float(overalls[j]))
        if margin < overall_max_margin / 2:  # tighter — only very close cross-cat
            cross_pool.append((i, j, margin, "cross_category"))
    rng.shuffle(cross_pool)
    candidates.extend(cross_pool[: max_pairs // 4])

    # Deduplicate by unordered (k_a, k_b)
    seen = set()
    deduped = []
    for ka, kb, m, cat in candidates:
        key = (min(ka, kb), max(ka, kb))
        if key in seen:
            continue
        seen.add(key)
        deduped.append((ka, kb, m, cat))

    rng.shuffle(deduped)
    return deduped[:max_pairs]


# ═══════════════════════════════════════════════════
# OPUS PAIRWISE GRADING
# ═══════════════════════════════════════════════════


def encode_image(path: str) -> str:
    return base64.b64encode(Path(path).read_bytes()).decode("ascii")


PROMPT = f"""You are a world-class product designer judging a pairwise design
comparison.

Two designs are shown: IMAGE A (first) and IMAGE B (second).  Compare them
across the 16 design dimensions below.  For each dimension state the
winner ("A", "B", or "tie") and a margin between 0.0 (essentially equal)
and 1.0 (one is dramatically better).

Be HARSH and consistent.  A small margin (0.05-0.15) means "noticeably
better"; large (0.3+) means "clearly superior".  Use "tie" liberally —
many dimensions will be roughly equal.

Dimensions:
  {", ".join(SCORE_NAMES)}

Respond with ONLY this JSON shape (no prose, no fences):

{{
  "preferences": {{
    "typography_quality": {{"winner": "A|B|tie", "margin": 0.0-1.0}},
    ...all 16 dimensions...
  }},
  "rationale": "1 sentence on what tipped the overall balance"
}}
"""


def grade_pair(image_a: str, image_b: str, model: str = DEFAULT_MODEL):
    """Single Opus call comparing two screenshots.  Returns parsed dict
    or None on parse failure."""
    a_b64 = encode_image(image_a)
    b_b64 = encode_image(image_b)

    media_type_a = "image/png" if image_a.endswith(".png") else "image/jpeg"
    media_type_b = "image/png" if image_b.endswith(".png") else "image/jpeg"

    msg = client.messages.create(
        model=model,
        max_tokens=2000,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {
                    "type": "base64", "media_type": media_type_a, "data": a_b64
                }},
                {"type": "image", "source": {
                    "type": "base64", "media_type": media_type_b, "data": b_b64
                }},
                {"type": "text", "text": PROMPT},
            ],
        }],
    )
    raw = msg.content[0].text

    m = re.search(r"\{[\s\S]*\}", raw)
    if not m:
        return None
    try:
        return json.loads(m.group())
    except json.JSONDecodeError:
        return None


def normalize_preferences(preferences: dict) -> dict:
    """Coerce winners + margins to the canonical schema used by
    flywheel.js comparisons.json."""
    out = {}
    for name in SCORE_NAMES:
        entry = preferences.get(name, {}) or {}
        winner = str(entry.get("winner", "tie")).strip().upper()
        if winner not in ("A", "B", "TIE"):
            winner = "TIE"
        if winner == "TIE":
            winner = "tie"
        try:
            margin = float(entry.get("margin", 0.0))
        except (TypeError, ValueError):
            margin = 0.0
        margin = max(0.0, min(1.0, margin))
        out[name] = {"winner": winner, "margin": margin}
    return out


# ═══════════════════════════════════════════════════
# COMPARISONS.JSON IO
# ═══════════════════════════════════════════════════


def backup_comparisons() -> Path:
    if not COMPARISONS_PATH.exists():
        return None
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = COMPARISONS_PATH.parent / f"comparisons.{ts}.bak.json"
    shutil.copyfile(COMPARISONS_PATH, backup)
    return backup


def load_comparisons() -> dict:
    if COMPARISONS_PATH.exists():
        return json.loads(COMPARISONS_PATH.read_text())
    return {"pairs": []}


def save_comparisons(data: dict) -> None:
    COMPARISONS_PATH.write_text(json.dumps(data, indent=2))


# ═══════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 8+ pairwise grader")
    parser.add_argument("--max-pairs", type=int, default=DEFAULT_MAX_PAIRS,
                        help=f"Number of pair comparisons to grade (default {DEFAULT_MAX_PAIRS})")
    parser.add_argument("--overall-max-margin", type=float,
                        default=DEFAULT_OVERALL_MAX_MARGIN,
                        help="Only pair samples whose overall_aesthetic "
                             "scores differ by less than this (default 0.10)")
    parser.add_argument("--per-category-cap", type=int,
                        default=DEFAULT_PER_CATEGORY_CAP,
                        help="Max pairs per source/category (stratify diversity)")
    parser.add_argument("--seed", type=int, default=0,
                        help="RNG seed for pair sampling")
    parser.add_argument("--model", default=DEFAULT_MODEL,
                        help=f"Anthropic model id (default {DEFAULT_MODEL})")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print pair selection without calling Opus")
    parser.add_argument("--max-failures", type=int, default=3,
                        help="Abort after this many consecutive parse/API failures")
    args = parser.parse_args()

    print(f"[pairwise] loading manifest + applying train split...")
    samples = load_train_samples()
    print(f"[pairwise] {len(samples)} train-split samples eligible "
          f"(have features, screenshots, overall_aesthetic)")

    pairs = select_pairs(
        samples,
        max_pairs=args.max_pairs,
        overall_max_margin=args.overall_max_margin,
        per_category_cap=args.per_category_cap,
        seed=args.seed,
    )
    print(f"[pairwise] selected {len(pairs)} pairs to grade "
          f"(target {args.max_pairs})")

    if not pairs:
        print("[pairwise] no eligible pairs — try increasing --overall-max-margin")
        return 0

    # Show the pair list
    for k, (ka, kb, margin, cat) in enumerate(pairs[:10]):
        mi_a, sa = samples[ka]
        mi_b, sb = samples[kb]
        print(f"  pair {k+1:3d}: idx {mi_a:3d} ↔ {mi_b:3d} "
              f"|Δoverall|={margin:.3f} category={cat}")
    if len(pairs) > 10:
        print(f"  ... ({len(pairs) - 10} more)")

    if args.dry_run:
        cost_est = len(pairs) * 0.07
        print(f"[pairwise] dry run — would spend ~${cost_est:.2f} on Opus API calls")
        return 0

    # ── Live grading ──
    backup = backup_comparisons()
    if backup:
        print(f"[pairwise] backed up comparisons.json → {backup.name}")
    comparisons = load_comparisons()

    failures_in_a_row = 0
    graded = 0
    for k, (ka, kb, margin, cat) in enumerate(pairs):
        mi_a, sa = samples[ka]
        mi_b, sb = samples[kb]
        path_a = sa.get("screenshot_path") or sa["image"]
        path_b = sb.get("screenshot_path") or sb["image"]

        print(f"\n[pair {k+1}/{len(pairs)}] idx {mi_a} ↔ {mi_b} "
              f"(|Δoverall|={margin:.3f}, {cat})")
        t0 = time.time()
        try:
            result = grade_pair(path_a, path_b, model=args.model)
        except Exception as e:
            failures_in_a_row += 1
            print(f"  [FAIL] api error: {str(e)[:120]} "
                  f"[{failures_in_a_row}/{args.max_failures}]")
            if failures_in_a_row >= args.max_failures:
                print(f"[pairwise] aborting — {failures_in_a_row} failures in a row")
                break
            continue

        elapsed = time.time() - t0

        if not result or "preferences" not in result:
            failures_in_a_row += 1
            print(f"  [FAIL] no preferences in response ({elapsed:.1f}s) "
                  f"[{failures_in_a_row}/{args.max_failures}]")
            if failures_in_a_row >= args.max_failures:
                break
            continue
        failures_in_a_row = 0

        prefs = normalize_preferences(result["preferences"])
        rationale = result.get("rationale", "")[:200]

        # Quick verdict snapshot
        a_wins = sum(1 for p in prefs.values() if p["winner"] == "A")
        b_wins = sum(1 for p in prefs.values() if p["winner"] == "B")
        ties = sum(1 for p in prefs.values() if p["winner"] == "tie")
        overall_winner = prefs.get("overall_aesthetic", {}).get("winner", "tie")
        print(f"  [done] A={a_wins} B={b_wins} ties={ties} "
              f"overall→{overall_winner} ({elapsed:.1f}s)")
        if rationale:
            print(f"  rationale: {rationale}")

        comparisons.setdefault("pairs", []).append({
            "image_a": path_a,
            "image_b": path_b,
            "preferences": prefs,
            "source": "opus_pairwise_grader",
            "model": args.model,
            "manifest_index_a": mi_a,
            "manifest_index_b": mi_b,
            "category": cat,
            "rationale": rationale,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        save_comparisons(comparisons)  # save after each successful pair
        graded += 1

    print(f"\n[pairwise] complete: {graded}/{len(pairs)} pairs graded")
    print(f"[pairwise] comparisons.json now has {len(comparisons.get('pairs', []))} total pairs")
    print(f"[pairwise] re-train recommended: python3 mlx/train_v7.py --epochs 500 --patience 80")
    return 0


if __name__ == "__main__":
    sys.exit(main())
