#!/usr/bin/env python3
"""
regrade_uncertain.py — Phase 6 active-learning loop.

Closes the loop on Phase 6's uncertainty head: scan the full manifest, pick
the K samples the model is least confident about (highest dimension-weighted
predicted std), re-grade each with Opus using the stored code + screenshot,
and write the new scores back to manifest.json.

This is the highest-ROI use of Opus grading API spend: instead of grading
random new self_train cycles, target the existing samples whose labels are
likely most stale or noisy.  Each re-grade compresses the dataset's
*effective* noise floor, which directly improves what the next train_v6
retrain can extract.

Safety:
  - Manifest is backed up to data/manifest.{timestamp}.bak.json before any
    write.
  - Each sample's pre-existing scores are preserved under
    `metadata.regrade_history` so we never lose original grades.
  - --dry-run prints the ranking + grading targets without calling the API.

Usage:
  python3 regrade_uncertain.py                     # default: top-10 regrade
  python3 regrade_uncertain.py --top-k 25 --source opus_self_train
  python3 regrade_uncertain.py --dry-run --top-k 50

Integration:
  Wired into self_train via `--regrade-every N` so every N cycles a small
  uncertainty-driven regrade pass runs automatically.  Manual invocation
  is also fine — this script doesn't share state with self_train's loop.
"""

import argparse
import json
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
MANIFEST_PATH = DATA_DIR / "manifest.json"
MLX_DIR = ROOT / "mlx"

# Reuse self_train's grading function — same Opus prompt, same dimensions,
# same scoring conventions.  Self_train owns the canonical grading logic.
sys.path.insert(0, str(ROOT))


def load_uncertainty_ranking(top_k: int, source_filter: str | None) -> list[dict]:
    """Run select_uncertain --all-manifest and parse the JSON ranking."""
    cmd = [
        sys.executable,
        str(MLX_DIR / "select_uncertain.py"),
        "--all-manifest",
        "--top-k", str(top_k),
    ]
    if source_filter:
        cmd += ["--source-filter", source_filter]

    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(MLX_DIR))
    if result.returncode != 0:
        print(f"[regrade] select_uncertain failed: {result.stderr[:300]}",
              file=sys.stderr)
        sys.exit(1)
    payload = json.loads(result.stdout)
    return [r for r in payload["ranking"] if "error" not in r]


def load_code_for_sample(sample: dict) -> tuple[str | None, str]:
    """Return (code, language).  Best-effort: tries metadata.code_path then
    .html siblings of the screenshot.
    """
    meta = sample.get("metadata", {})

    # Direct code path
    code_path = meta.get("code_path")
    if code_path and Path(code_path).exists():
        try:
            return Path(code_path).read_text(), _infer_language(code_path)
        except Exception:
            pass

    # Try .html sibling of the screenshot (flywheel layout)
    img = sample.get("image") or sample.get("screenshot_path")
    if img:
        for ext in (".html", ".swift", ".jsx"):
            candidate = Path(img).with_suffix(ext)
            if candidate.exists():
                try:
                    return candidate.read_text(), _infer_language(str(candidate))
                except Exception:
                    pass

    return None, "html"


def _infer_language(path: str) -> str:
    s = str(path).lower()
    if s.endswith(".swift"):
        return "swiftui"
    if s.endswith(".jsx") or s.endswith(".tsx"):
        return "react"
    return "html"


def backup_manifest() -> Path:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = MANIFEST_PATH.parent / f"manifest.{ts}.bak.json"
    shutil.copyfile(MANIFEST_PATH, backup)
    return backup


def main() -> int:
    parser = argparse.ArgumentParser(description="Regrade uncertain manifest samples")
    parser.add_argument("--top-k", type=int, default=10,
                        help="Number of most-uncertain samples to regrade")
    parser.add_argument("--source", default=None,
                        help="Only consider this source (e.g. opus_self_train)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print targets without calling Opus")
    parser.add_argument("--max-grade-failures", type=int, default=3,
                        help="Stop after this many grading failures in a row "
                             "(API outage detection)")
    args = parser.parse_args()

    print(f"[regrade] scoring full manifest for uncertainty (top {args.top_k})...")
    ranking = load_uncertainty_ranking(args.top_k * 2, args.source)
    if not ranking:
        print("[regrade] nothing rankable — manifest empty or no features.")
        return 0

    # Drop ones we can't load code for, until we hit top_k actionable targets
    manifest = json.loads(MANIFEST_PATH.read_text())

    targets = []
    for entry in ranking:
        idx = entry["manifest_index"]
        sample = manifest["samples"][idx]
        code, lang = load_code_for_sample(sample)
        if code is None:
            continue
        targets.append({
            "manifest_index": idx,
            "code": code,
            "language": lang,
            "uncertainty_score": entry["uncertainty_score"],
            "predicted_overall": entry["overall"],
            "current_overall": sample.get("scores", {}).get("overall_aesthetic"),
            "source": sample.get("source"),
            "source_name": sample.get("metadata", {}).get("source_name"),
        })
        if len(targets) >= args.top_k:
            break

    print(f"[regrade] actionable targets (have code on disk): {len(targets)}/{len(ranking)}")
    for t in targets:
        cur = t["current_overall"]
        cur_str = f"{cur:.3f}" if cur is not None else "n/a"
        pred = t["predicted_overall"]
        print(f"  idx={t['manifest_index']:3d} σ={t['uncertainty_score']:.3f} "
              f"current={cur_str} predicted={pred:.3f} "
              f"lang={t['language']:<7} {(t['source_name'] or t['source'] or '')[:50]}")

    if args.dry_run:
        print("[regrade] dry run — no API calls made.")
        return 0

    if not targets:
        print("[regrade] no actionable targets — exiting.")
        return 0

    # Now we actually grade.  Import lazily so the dry-run path doesn't need
    # ANTHROPIC_API_KEY.
    from self_train import grade  # noqa: E402

    backup = backup_manifest()
    print(f"[regrade] manifest backed up to {backup.name}")

    failures_in_a_row = 0
    regraded = 0
    for t in targets:
        idx = t["manifest_index"]
        print(f"\n[regrade] cycle idx={idx} ({t['language']}, σ={t['uncertainty_score']:.3f})...")
        t0 = time.time()
        result = grade(t["code"], t["language"])
        elapsed = time.time() - t0

        if not result or "scores" not in result:
            failures_in_a_row += 1
            print(f"  [FAIL] grade returned no scores ({elapsed:.1f}s) "
                  f"[{failures_in_a_row}/{args.max_grade_failures}]")
            if failures_in_a_row >= args.max_grade_failures:
                print(f"[regrade] aborting — {failures_in_a_row} failures in a row")
                break
            continue
        failures_in_a_row = 0

        sample = manifest["samples"][idx]
        old_scores = dict(sample.get("scores", {}))
        new_scores = result["scores"]

        # Preserve original grades in regrade_history
        meta = sample.setdefault("metadata", {})
        history = meta.setdefault("regrade_history", [])
        history.append({
            "regraded_at": datetime.now(timezone.utc).isoformat(),
            "previous_scores": old_scores,
            "previous_source": sample.get("source"),
            "uncertainty_at_regrade": t["uncertainty_score"],
            "predicted_overall_at_regrade": t["predicted_overall"],
        })

        sample["scores"] = new_scores
        sample["source"] = "opus_regrade_v6"
        meta["last_regraded_at"] = datetime.now(timezone.utc).isoformat()
        if "critique" in result:
            meta["last_critique"] = result["critique"][:1000]
        if "fixes" in result:
            meta["last_fixes"] = result["fixes"][:5]

        delta = new_scores.get("overall_aesthetic", 0.5) - (
            old_scores.get("overall_aesthetic") or 0.5)
        marker = "↑" if delta > 0.03 else "↓" if delta < -0.03 else "→"
        print(f"  [done] overall {old_scores.get('overall_aesthetic', 'n/a')} → "
              f"{new_scores.get('overall_aesthetic'):.3f} ({marker}{abs(delta):.3f}) "
              f"in {elapsed:.1f}s")
        regraded += 1

        # Save after each successful regrade — protects against partial failure
        MANIFEST_PATH.write_text(json.dumps(manifest, indent=2))

    print(f"\n[regrade] complete: {regraded}/{len(targets)} samples regraded")
    print(f"[regrade] manifest written to {MANIFEST_PATH}")
    print(f"[regrade] backup at {backup}")
    print(f"[regrade] re-train recommended: python3 mlx/train_v6.py --epochs 300")

    return 0


if __name__ == "__main__":
    sys.exit(main())
