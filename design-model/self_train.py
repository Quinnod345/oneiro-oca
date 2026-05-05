#!/usr/bin/env python3
"""
Self-Training Loop v2 — the model builds itself, and learns from every failure.

Key changes from v1:
  - Opus generates AND grades (not Sonnet — Opus produces better designs)
  - Past critiques feed into next generation (learns from failures)
  - Briefs are generated dynamically, not from a fixed list
  - If a design scores below 0.5, Opus iterates on it with specific fixes
  - The best designs' HTML is used as reference examples for future generations
  - Diverse categories: apps, components, dashboards, tools, creative, experimental

Usage:
  python self_train.py --cycles 50
  python self_train.py --forever
"""

import argparse
import copy
import fcntl
import json
import os
import random
import re
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

import anthropic
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env", override=True)
client = anthropic.Anthropic()

# Import renderers
sys.path.insert(0, str(Path(__file__).parent))
from renderers import render as render_code

# Languages to rotate through
LANGUAGES = ["html", "swiftui", "react"]

LANGUAGE_PROMPTS = {
    "html": {
        "framing": "Create a complete HTML page (1440x900) with inline CSS.",
        "rules": "System fonts. CSS custom properties. No Inter. No generic gradients. No centered hero + 3 cards.",
        "format": "Return ONLY the complete HTML. No markdown fences, no explanation.",
    },
    "swiftui": {
        "framing": "Create a SwiftUI ContentView (and supporting types) for a native macOS app (1440x900 frame). Do NOT include @main, App struct, import statements, or NSApplication code — just `struct ContentView: View { ... }` and any helper structs/classes.",
        "rules": (
            "STRICT SWIFT 6.2 / macOS 26 RULES:\n"
            "- Use ONLY standard SwiftUI APIs. No experimental, no beta-only features.\n"
            "- Every `let`/`var` must be used, or use `_` for discards.\n"
            "- All @State variables need explicit types.\n"
            "- Complex closures need explicit return types.\n"
            "- Colors: use Color.black/.white/.gray/.red/.blue/.orange/.green/.yellow/.purple/.pink, OR Color(red: X, green: Y, blue: Z) where X/Y/Z are 0.0-1.0 Doubles. NO hex literals, NO string-named colors.\n"
            "- Fonts: use .system(size:, weight:, design:). Available designs: .default, .rounded, .monospaced, .serif.\n"
            "- No force-unwraps unless guaranteed safe.\n"
            "- No CGWindowList, ScreenCaptureKit, NSApplication, or any system-capture APIs.\n"
            "- If you use a ForEach with an array of custom structs, those structs must conform to Identifiable (add `let id = UUID()`).\n"
            "- No `print()` inside view bodies. No side effects in computed properties.\n"
            "- Test mentally: will this compile cleanly with `swiftc -parse-as-library`?\n"
        ),
        "format": "Return ONLY the Swift code. No markdown fences, no explanation. Start with `struct ContentView: View {` or a helper struct.",
    },
    "react": {
        "framing": "Create a React component called `App` using React.createElement (NOT JSX — we're using Babel standalone). Full-page component (100vw x 100vh).",
        "rules": "Inline styles with system font stack. CSS custom properties via style object. No external dependencies — only React and React.createElement. Define the component as `function App() { return React.createElement(...) }`.",
        "format": "Return ONLY the JavaScript code starting with `function App()`. You may define helper functions and a <style> block at the top. No markdown fences.",
    },
}

DATA_DIR = Path(__file__).parent / "data"
MANIFEST_PATH = DATA_DIR / "manifest.json"
SELF_TRAIN_DIR = DATA_DIR / "self-train"
STATE_PATH = DATA_DIR / "self-train-state.json"
SKILL_PATH = Path.home() / ".claude" / "skills" / "frontend-design" / "SKILL.md"

SELF_TRAIN_DIR.mkdir(parents=True, exist_ok=True)

SCORE_NAMES = [
    "typography_quality", "color_harmony", "spatial_composition",
    "motion_elegance", "emotional_resonance", "craft_visibility",
    "minimalism_coherence", "native_integration",
    "visceral_score", "behavioral_score", "reflective_score",
    "overall_aesthetic",
    "innovation_score", "system_creativity", "design_distinctiveness",
    "problem_level",
]


def call_opus(prompt: str, max_tokens: int = 16000) -> str:
    # Use streaming for long generations (>10min non-streaming limit)
    with client.messages.stream(
        model="claude-opus-4-7",
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        return stream.get_final_message().content[0].text


def extract_code(text: str, language: str) -> str:
    """Extract code from LLM response, handling various wrapping formats."""
    # Try language-tagged code fence
    for lang_tag in [language, "html", "swift", "javascript", "js", "jsx"]:
        m = re.search(rf"```{lang_tag}\n?([\s\S]*?)\n?```", text)
        if m: return m.group(1).strip()
    # Generic code fence
    m = re.search(r"```\n?([\s\S]*?)\n?```", text)
    if m: return m.group(1).strip()

    # Language-specific entry points
    if language == "html":
        for marker in ["<!DOCTYPE", "<html", "<head", "<body"]:
            idx = text.find(marker)
            if idx >= 0: return text[idx:].strip()
    elif language == "swiftui":
        for marker in ["struct ContentView", "import SwiftUI"]:
            idx = text.find(marker)
            if idx >= 0: return text[idx:].strip()
    elif language == "react":
        for marker in ["function App", "const App", "class App"]:
            idx = text.find(marker)
            if idx >= 0: return text[idx:].strip()

    return text.strip()


# Keep old function for backward compat
def extract_html(text: str) -> str:
    return extract_code(text, "html")


def render_screenshot(code: str, png_path: str, language: str = "html") -> tuple[bool, str | None]:
    """Render code to screenshot. Returns (success, error_message)."""
    ok, path, err = render_code(language, code, png_path)
    return ok, err


def grade(code: str, language: str = "html") -> dict | None:
    try:
        raw = call_opus(
            f"Grade this {language.upper()} UI design 0-1 per dimension. Be HARSH. Coherent — if parts clash, BOTH scores drop.\n\n"
            f"Dimensions: {', '.join(SCORE_NAMES)}\n\n"
            "Write a 2-sentence critique and 3 specific fixes.\n"
            'Return ONLY JSON: {"scores":{...all 16...},"critique":"...","fixes":["fix1","fix2","fix3"]}\n\n'
            f"CODE:\n{code[:8000]}",
            max_tokens=2000,
        )
        m = re.search(r"\{[\s\S]*\}", raw)
        if not m: return None
        result = json.loads(m.group())
        for name in SCORE_NAMES:
            result["scores"][name] = max(0.0, min(1.0, float(result["scores"].get(name, 0.5))))
        return result
    except Exception as e:
        print(f"  [grade failed] {e}")
        return None


# ═══════════════════════════════════════════════════
# DYNAMIC BRIEF GENERATION
# ═══════════════════════════════════════════════════

def generate_brief(past_critiques: list[str], best_examples: list[str]) -> str:
    """Ask Opus to generate a fresh, creative design brief based on what went wrong before."""

    critique_context = ""
    if past_critiques:
        recent = past_critiques[-5:]
        critique_context = "\n\nPAST FAILURES (avoid these patterns):\n" + "\n".join(f"- {c}" for c in recent)

    example_context = ""
    if best_examples:
        example_context = "\n\nBEST SCORING DESIGNS SO FAR scored 0.55-0.60. The bar is higher. Beat them."

    raw = call_opus(
        f"Generate ONE creative design brief for a unique UI/app concept.\n\n"
        f"Requirements:\n"
        f"- Must be a SPECIFIC, UNUSUAL problem — not 'a todo app' or 'a settings panel'\n"
        f"- Must have a clear visual metaphor or unique interaction concept\n"
        f"- Must be achievable in a single HTML page with CSS\n"
        f"- Should force the designer to think at Level 5+ (redefine the problem)\n"
        f"- Should be something that would make a designer say 'I've never seen that before'\n"
        f"{critique_context}"
        f"{example_context}\n\n"
        f"Return ONLY the brief as a single paragraph. No titles, no bullet points. Just the concept.",
        max_tokens=300,
    )
    return raw.strip()


# ═══════════════════════════════════════════════════
# CORE LOOP
# ═══════════════════════════════════════════════════

def load_state():
    if STATE_PATH.exists(): return json.loads(STATE_PATH.read_text())
    return {"totalCycles": 0, "totalSamples": 0, "retrains": 0, "scores": [],
            "past_critiques": [], "best_htmls": []}

def save_state(state):
    STATE_PATH.write_text(json.dumps(state, indent=2))


# ═══════════════════════════════════════════════════
# PARALLEL-WORKER COORDINATION
# Multiple self_train processes run concurrently (spawned by
# cognitive-loop.js).  State updates need atomic read-modify-write so
# counters don't get clobbered; retrain needs a try-lock so only one
# worker retrains at a time.
# ═══════════════════════════════════════════════════

STATE_LOCK_PATH = DATA_DIR / "self-train-state.lock"
RETRAIN_LOCK_PATH = DATA_DIR / "self-train-retrain.lock"


@contextmanager
def locked_state():
    """Exclusive file lock around state read-modify-write.

    Usage:
        with locked_state() as state:
            state["totalCycles"] += 1
            cycle_num = state["totalCycles"]
        # state is auto-saved on exit
    """
    with open(STATE_LOCK_PATH, "w") as lf:
        fcntl.flock(lf, fcntl.LOCK_EX)
        try:
            state = load_state()
            yield state
            save_state(state)
        finally:
            fcntl.flock(lf, fcntl.LOCK_UN)


@contextmanager
def try_retrain_lock():
    """Non-blocking retrain lock.  If another worker holds it, `acquired`
    is False and the caller should skip retraining."""
    lf = open(RETRAIN_LOCK_PATH, "w")
    acquired = False
    try:
        try:
            fcntl.flock(lf, fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
        except (IOError, BlockingIOError):
            acquired = False
        yield acquired
    finally:
        if acquired:
            fcntl.flock(lf, fcntl.LOCK_UN)
        lf.close()

def retrain():
    mlx_dir = Path(__file__).parent / "mlx"
    design_dir = Path(__file__).parent

    # ── 0. Defense in depth: backfill any opus_self_train manifest sample
    #       that's missing its Phase 5 critique JSON.  Older entries
    #       pre-date save_critique_for_training; without backfilling them
    #       the aux head can't activate.  Idempotent (skips samples that
    #       already have critiques) and capped to a small batch per retrain
    #       so a single retrain doesn't burn the daily Opus budget. ──
    backfill_script = design_dir / "backfill_critiques.py"
    if backfill_script.exists():
        print("[retrain] backfilling missing critique JSONs (max 30 / retrain)...")
        try:
            bf_result = subprocess.run(
                ["python3", str(backfill_script), "--max-samples", "30"],
                cwd=design_dir, capture_output=True, text=True, timeout=900,
            )
            for line in (bf_result.stdout or "").split("\n"):
                if any(k in line for k in ("complete:", "nothing to do",
                                           "[backfill] aborting", "approximate spend")):
                    print(f"[retrain] {line.strip()}")
            if bf_result.returncode != 0 and bf_result.stderr:
                print(f"[retrain] backfill stderr: {bf_result.stderr[:200]}")
        except Exception as e:
            print(f"[retrain] backfill error (non-fatal): {str(e)[:120]}")

    # ── 1. Embed any newly-captured critiques into critique_embeddings.npz ──
    # Idempotent and cheap when there's nothing new. This is the Phase 5
    # pipeline — critique text → OpenAI embeddings → training signal.
    embed_script = design_dir / "embed_critiques.py"
    if embed_script.exists():
        print("[retrain] embedding new critiques...")
        try:
            embed_result = subprocess.run(
                ["python3", str(embed_script), "--max-new", "200"],
                cwd=design_dir, capture_output=True, text=True,
            )
            # Surface the summary lines if any
            for line in (embed_result.stdout or "").split("\n"):
                if any(k in line for k in ("Embedded:", "Nothing to embed", "Unembedded:", "ERROR")):
                    print(f"[retrain] {line.strip()}")
            if embed_result.returncode != 0 and embed_result.stderr:
                print(f"[retrain] embed stderr: {embed_result.stderr[:200]}")
        except Exception as e:
            print(f"[retrain] embed error (non-fatal): {str(e)[:120]}")

    # ── 2. Extract DINOv2 vision features + MiniLM text-intent features ──
    print("[retrain] extracting DINOv2 features...")
    subprocess.run(["python3", "extract_dinov2.py"],
                   cwd=mlx_dir, capture_output=True)
    print("[retrain] extracting MiniLM text features...")
    subprocess.run(["python3", "extract_text.py"],
                   cwd=mlx_dir, capture_output=True)

    # ── 3. Train the Phase 10 v9 design head (DINOv2 vision + MiniLM text
    #       intent + Phase 5 critique aux + Phase 6 uncertainty
    #       + Phase 8 preference). ──
    print("[retrain] training v9...")
    result = subprocess.run(
        ["python3", "train_v9.py", "--epochs", "300", "--batch", "16", "--patience", "40"],
        cwd=mlx_dir, capture_output=True, text=True,
    )
    for line in (result.stdout or "").split("\n"):
        if any(k in line for k in ("phases:", "best val loss", "matched:", "pairs:")):
            print(f"[retrain] {line.strip()}")
    if result.returncode != 0 and result.stderr:
        print(f"[retrain] train_v9 stderr: {result.stderr[:300]}")


CRITIQUES_DIR = DATA_DIR / "critiques"
CRITIQUES_DIR.mkdir(parents=True, exist_ok=True)


def save_critique_for_training(
    cycle_num: int,
    language: str,
    brief: str,
    code: str,
    scores: dict,
    overall: float,
    innovation: float,
    critique: str,
    fixes: list,
    has_screenshot: bool,
    code_path: str,
    png_path: str | None,
) -> None:
    """Write a per-cycle critique record for Phase 5 embedding training.

    The Phase 5 model architecture (per VISION.md:211) adds an auxiliary
    head that learns to predict Opus's critique text as an embedding
    from the code's feature vector.  Scores alone teach WHAT, critiques
    teach WHY — "great typography but clashes with the palette" carries
    structural information that per-dimension scores can't capture.

    We save ONE JSON file per cycle so:
      • embed_critiques.py can batch them through OpenAI text-embedding-3
        without re-running LLM generation
      • each record is self-contained (scores + critique + code reference)
      • records are append-only (safe for parallel workers)

    Without a critique, we still emit a record (with critique="") so the
    file inventory stays in lockstep with cycle numbers.
    """
    if not critique:
        # Still write a stub so the filesystem matches the state counter;
        # embed_critiques.py will skip empty critiques.
        pass

    record = {
        "cycle": cycle_num,
        "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "language": language,
        "brief": (brief or "")[:500],
        "scores": {k: round(float(v), 4) for k, v in (scores or {}).items()},
        "overall": round(float(overall), 4),
        "innovation": round(float(innovation), 4),
        "critique": critique or "",
        "fixes": list(fixes or [])[:10],
        "compiled": bool(has_screenshot),
        "code_path": code_path,
        "png_path": png_path,
        # Code snippet so reviewers can read the critique in context
        # without opening another file. Capped to keep files lean.
        "code_snippet": (code or "")[:3000],
    }

    out_path = CRITIQUES_DIR / f"cycle-{cycle_num:06d}.json"
    try:
        out_path.write_text(json.dumps(record, indent=2))
    except Exception as e:
        print(f"  [critique] write failed: {e}")


def maybe_inject_target_reference(
    language: str,
    code: str,
    cycle_num: int,
    overall: float,
    innovation: float,
    critique: str,
    has_screenshot: bool,
) -> None:
    """Copy high-scoring compiled swiftui samples into the active target
    project's reference pool.

    Gates:
      • language == 'swiftui' — Sill is SwiftUI-only for now
      • has_screenshot — proves the Swift actually compiled
      • overall >= 0.80 — Opus rated it high
      • target-project.json exists — there's a pinned project to inject into

    The pool is capped at 5 auto-injected entries; we keep the top 5 by
    `overall_score` and delete the rest from disk + manifest to prevent
    unbounded growth. Seeded (non-auto) references are never touched.
    """
    if language != "swiftui":
        return
    if not has_screenshot:
        return
    if overall < 0.80:
        return

    target_path = Path(__file__).parent / "target-project.json"
    if not target_path.exists():
        return

    try:
        target = json.loads(target_path.read_text())
    except Exception:
        return
    project_name = target.get("name")
    if not project_name:
        return

    refs_dir = Path(__file__).parent / "active-project" / project_name / "references"
    refs_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = refs_dir / "manifest.json"

    if manifest_path.exists():
        try:
            ref_manifest = json.loads(manifest_path.read_text())
        except Exception:
            ref_manifest = {"version": 1, "references": []}
    else:
        ref_manifest = {"version": 1, "references": []}

    # Copy the swift source to the references dir
    ref_filename = f"auto-cycle-{cycle_num}.swift"
    ref_path = refs_dir / ref_filename
    ref_path.write_text(code)

    critique_snippet = (critique or "").strip().replace("\n", " ")[:140]
    new_entry = {
        "name": f"auto-cycle-{cycle_num}",
        "kind": "compile-correctness",
        "source_type": "self_train_auto",
        "source_origin": f"self_train cycle {cycle_num}",
        "path": ref_filename,
        "compile_verified": True,
        "overall_score": round(float(overall), 3),
        "innovation_score": round(float(innovation), 3),
        "tags": [],
        "description": (
            f"Auto-injected from self_train cycle {cycle_num} "
            f"(overall={overall:.2f}, innovation={innovation:.2f}). "
            f"{critique_snippet}"
        ),
        "best_for": [],
        "added_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }

    # De-dupe by path (in case this cycle number already has an entry)
    ref_manifest["references"] = [
        e for e in ref_manifest["references"] if e.get("path") != ref_filename
    ]
    ref_manifest["references"].append(new_entry)

    # Cap auto entries at top 5 by overall_score; prune the rest from
    # both manifest and disk. Seeded (non-auto) refs are preserved.
    MAX_AUTO_REFS = 5
    auto_entries = [
        e for e in ref_manifest["references"]
        if e.get("source_type") == "self_train_auto"
    ]
    if len(auto_entries) > MAX_AUTO_REFS:
        auto_entries.sort(key=lambda e: e.get("overall_score", 0), reverse=True)
        keep_paths = {e["path"] for e in auto_entries[:MAX_AUTO_REFS]}
        pruned_paths = {e["path"] for e in auto_entries[MAX_AUTO_REFS:]}
        ref_manifest["references"] = [
            e for e in ref_manifest["references"]
            if e.get("source_type") != "self_train_auto" or e["path"] in keep_paths
        ]
        for old_path in pruned_paths:
            try:
                (refs_dir / old_path).unlink()
            except Exception:
                pass

    manifest_path.write_text(json.dumps(ref_manifest, indent=2))
    print(
        f"  [refs] ✨ auto-injected cycle-{cycle_num} → "
        f"{project_name}/references/ (score={overall:.2f}, kept {min(len([e for e in ref_manifest['references'] if e.get('source_type') == 'self_train_auto']), MAX_AUTO_REFS)} auto refs)"
    )


def run_cycle(cycle_num: int, state: dict, language: str | None = None) -> dict | None:
    # Pick language (rotate through LANGUAGES if not specified)
    if language is None:
        language = LANGUAGES[(cycle_num - 1) % len(LANGUAGES)]

    lang_cfg = LANGUAGE_PROMPTS[language]

    # Load skill
    skill = SKILL_PATH.read_text()[:1500] if SKILL_PATH.exists() else ""

    # ── 1. GENERATE BRIEF (dynamic, learns from past failures) ──
    brief = generate_brief(state.get("past_critiques", []), state.get("best_htmls", []))
    print(f"\n[cycle {cycle_num}] [{language}] {brief[:55]}...")

    # ── 2. OPUS GENERATES (with skill + past failure context) ──
    t0 = time.time()

    past_failure_hints = ""
    recent_critiques = state.get("past_critiques", [])[-3:]
    if recent_critiques:
        past_failure_hints = (
            "\n\nCOMMON FAILURES TO AVOID:\n" +
            "\n".join(f"- {c}" for c in recent_critiques) +
            "\n\nDo NOT repeat these mistakes. Each design must be genuinely different."
        )

    # Best reference from the same language (if available)
    best_reference = ""
    best_by_lang = state.get("best_by_lang", {}).get(language, [])
    if best_by_lang:
        best_reference = (
            f"\n\nHere is a snippet from a good {language} design so far. "
            f"Study its approach but create something COMPLETELY different:\n"
            f"```\n{best_by_lang[-1][:1500]}\n```"
        )

    try:
        raw = call_opus(
            f"You are a world-class product designer. {lang_cfg['framing']}\n\n"
            f"BRIEF: {brief}\n\n"
            f"{f'DESIGN SKILL:{chr(10)}{skill}{chr(10)}' if skill else ''}"
            f"LANGUAGE RULES ({language}): {lang_cfg['rules']}\n\n"
            f"CRITICAL DESIGN RULES:\n"
            f"- Every element must serve the whole. Great typography that clashes with the palette = FAILURE.\n"
            f"- Solve at Level 5+. Don't execute — REDEFINE what this type of interface means.\n"
            f"- No purple gradients. No centered hero + 3 cards. No generic glassmorphism.\n"
            f"- Imperfection is human. Perfect symmetry is AI. Add intentional visual tension.\n"
            f"- The design should make someone say 'I've never seen that before' — not 'that's nice'.\n"
            f"{past_failure_hints}"
            f"{best_reference}\n\n"
            f"{lang_cfg['format']}"
        )
        code = extract_code(raw, language)
        if len(code) < 200:
            print(f"  [FAIL] invalid code ({len(code)} chars)")
            return None
    except Exception as e:
        print(f"  [FAIL] generate: {e}")
        return None

    gen_time = time.time() - t0

    # ── 3. RENDER ──
    ext = {"html": "html", "swiftui": "swift", "react": "jsx"}[language]
    code_path = str(SELF_TRAIN_DIR / f"cycle-{cycle_num}-{language}.{ext}")
    png_path = str(SELF_TRAIN_DIR / f"cycle-{cycle_num}-{language}.png")
    Path(code_path).write_text(code)

    render_ok, render_err = render_screenshot(code, png_path, language)
    if not render_ok:
        print(f"  [render failed] {render_err}")
        # For SwiftUI compile errors: give Opus the actual error and let it fix the code
        if language == "swiftui" and render_err and "Compile" in render_err:
            for fix_attempt in range(3):  # Up to 3 compile-fix attempts
                print(f"  [swift compile-fix attempt {fix_attempt + 1}/3]")
                try:
                    fixed_raw = call_opus(
                        f"The following Swift code failed to compile. Fix the compile errors and return "
                        f"the COMPLETE corrected code. Keep the design intent but make it compile cleanly.\n\n"
                        f"COMPILER ERROR:\n{render_err[:2000]}\n\n"
                        f"SWIFT RULES:\n"
                        f"- Use only standard SwiftUI. No experimental APIs.\n"
                        f"- Every variable must be used or declared with _.\n"
                        f"- All @State vars need types. All closures need explicit return types if complex.\n"
                        f"- Color literals: use Color.black/.white/.gray/.red/.blue/.orange/.green/.yellow/.purple/.pink or Color(red:green:blue:).\n"
                        f"- No force-unwraps unless guaranteed.\n"
                        f"- Don't use CGWindowList, ScreenCaptureKit, or NSApplication — just define ContentView.\n\n"
                        f"BROKEN CODE:\n{code[:6000]}\n\n"
                        f"{lang_cfg['format']}"
                    )
                    fixed_code = extract_code(fixed_raw, language)
                    if len(fixed_code) < 200:
                        continue

                    # Try rendering again
                    Path(code_path).write_text(fixed_code)
                    render_ok, render_err = render_screenshot(fixed_code, png_path, language)
                    if render_ok:
                        code = fixed_code
                        print(f"  [swift compile-fix succeeded on attempt {fix_attempt + 1}] ✅")
                        break
                    else:
                        print(f"  [still failing] {str(render_err)[:80]}")
                except Exception as e:
                    print(f"  [compile-fix error] {str(e)[:80]}")
                    break

    # ── 4. OPUS GRADES ──
    t1 = time.time()
    result = grade(code, language)
    grade_time = time.time() - t1

    if not result:
        print(f"  [FAIL] grading")
        return None

    overall = result["scores"]["overall_aesthetic"]
    innovation = result["scores"]["innovation_score"]
    critique = result.get("critique", "")
    fixes = result.get("fixes", [])

    print(f"  v1: overall={overall:.2f} innovation={innovation:.2f} "
          f"({gen_time:.0f}s gen, {grade_time:.0f}s grade)")
    if critique:
        print(f"    {critique[:80]}")

    # ── 5. ITERATE IF BELOW 0.55 ──
    if overall < 0.55 and fixes:
        try:
            t2 = time.time()
            fix_prompt = (
                f"Improve this {language} design. Current score: {overall:.2f}/1.0\n\n"
                f"Critique: {critique}\n\n"
                f"Specific fixes:\n" + "\n".join(f"- {f}" for f in fixes[:5]) +
                f"\n\nCurrent code:\n{code[:5000]}\n\n"
                f"Return the COMPLETE improved {language} code. Every fix must serve the WHOLE design.\n"
                f"{lang_cfg['format']}"
            )
            improved_raw = call_opus(fix_prompt)
            improved_code = extract_code(improved_raw, language)

            if len(improved_code) > 200:
                code_path_v2 = str(SELF_TRAIN_DIR / f"cycle-{cycle_num}-{language}-v2.{ext}")
                png_path_v2 = str(SELF_TRAIN_DIR / f"cycle-{cycle_num}-{language}-v2.png")
                Path(code_path_v2).write_text(improved_code)
                render_screenshot(improved_code, png_path_v2, language)

                result_v2 = grade(improved_code, language)
                if result_v2:
                    overall_v2 = result_v2["scores"]["overall_aesthetic"]
                    innov_v2 = result_v2["scores"]["innovation_score"]
                    iter_time = time.time() - t2

                    if overall_v2 > overall:
                        code = improved_code
                        code_path = code_path_v2
                        png_path = png_path_v2 if os.path.exists(png_path_v2) else png_path
                        result = result_v2
                        overall = overall_v2
                        innovation = innov_v2
                        critique = result_v2.get("critique", critique)
                        print(f"  v2: overall={overall_v2:.2f} innovation={innov_v2:.2f} ({iter_time:.0f}s) ↑")
                    else:
                        print(f"  v2: overall={overall_v2:.2f} (no improvement)")
        except Exception as e:
            print(f"  [iterate failed] {e}")

    # ── 6. STORE ──
    has_screenshot = os.path.exists(png_path)
    manifest = json.loads(MANIFEST_PATH.read_text())
    manifest["samples"].append({
        "image": png_path if has_screenshot else code_path,
        "screenshot_path": png_path if has_screenshot else None,
        "scores": result["scores"],
        "source": "opus_self_train",
        "confidence": 0.9,
        "metadata": {
            "source_name": f"self-train-{cycle_num}-{language}",
            "category": "self-train",
            "language": language,
            "quality_target": "high" if overall > 0.7 else "medium" if overall > 0.4 else "low",
            "brief": brief[:200],
            "critique": critique,
            "code_path": code_path,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        },
    })
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2))

    # ── 6b. TARGET-PROJECT REFERENCE POOL INJECTION ──
    # When a swiftui cycle produces a high-scoring sample that actually
    # compiled (has_screenshot == True), also copy it into the active
    # target project's reference pool so builder.py can draw on it as a
    # few-shot example on future iterations. This closes the feedback
    # loop: self_train discovers good patterns → target project uses
    # them as anchors → Sill iterations climb → better self_train data →
    # flywheel.
    try:
        maybe_inject_target_reference(
            language=language,
            code=code,
            cycle_num=cycle_num,
            overall=overall,
            innovation=innovation,
            critique=critique,
            has_screenshot=has_screenshot,
        )
    except Exception as e:
        print(f"  [refs] auto-inject failed: {str(e)[:120]}")

    # ── 6c. PHASE 5 CRITIQUE CAPTURE ──
    # Save a structured per-cycle critique record to data/critiques/ so the
    # Phase 5 critique-embedding training pipeline can batch-embed them
    # later.  Each file contains the full critique text (not truncated),
    # per-dimension scores, fixes, and a code reference.  embed_critiques.py
    # consumes these and produces a .npz of embedding vectors.
    try:
        save_critique_for_training(
            cycle_num=cycle_num,
            language=language,
            brief=brief,
            code=code,
            scores=result["scores"],
            overall=overall,
            innovation=innovation,
            critique=critique,
            fixes=fixes,
            has_screenshot=has_screenshot,
            code_path=code_path,
            png_path=png_path if has_screenshot else None,
        )
    except Exception as e:
        print(f"  [critique] capture failed: {str(e)[:120]}")

    # ── 7. UPDATE STATE ──
    if critique and overall < 0.5:
        state.setdefault("past_critiques", []).append(critique[:150])
        state["past_critiques"] = state["past_critiques"][-20:]

    if overall >= 0.55:
        state.setdefault("best_by_lang", {}).setdefault(language, []).append(code[:2000])
        state["best_by_lang"][language] = state["best_by_lang"][language][-3:]

    return {"overall": overall, "innovation": innovation, "critique": critique, "brief": brief[:60], "language": language}


# ═══════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cycles", type=int, default=10)
    parser.add_argument("--forever", action="store_true")
    parser.add_argument(
        "--worker-id", type=int, default=0,
        help="Worker index (0-based) for parallel workers",
    )
    parser.add_argument(
        "--num-workers", type=int, default=1,
        help="Total number of workers running in parallel",
    )
    parser.add_argument(
        "--language-bias",
        choices=["html", "swiftui", "react", "auto"],
        default="auto",
        help="Force a specific language for this worker (default: random rotation)",
    )
    parser.add_argument(
        "--regrade-every", type=int, default=0,
        help="Run regrade_uncertain.py every N successful cycles "
             "(0 = disabled). Worker 0 only — other workers skip to avoid "
             "double regrading.",
    )
    parser.add_argument(
        "--regrade-top-k", type=int, default=10,
        help="Regrade this many of the most-uncertain samples per regrade pass",
    )
    args = parser.parse_args()

    total = float("inf") if args.forever else args.cycles
    prefix = f"[W{args.worker_id}/{args.num_workers}] " if args.num_workers > 1 else ""
    forced_lang = None if args.language_bias == "auto" else args.language_bias

    print(f"\n{'═' * 55}")
    print(f"{prefix}SELF-TRAINING LOOP v2")
    print(f"{prefix}Opus generates → Opus grades → learns from failures → repeat")
    print(f"{prefix}Cycles: {'forever' if args.forever else args.cycles}")
    if args.num_workers > 1:
        print(f"{prefix}Parallel mode: worker {args.worker_id} of {args.num_workers}")
    if forced_lang:
        print(f"{prefix}Language bias: {forced_lang}")
    print("═" * 55)
    sys.stdout.flush()

    i = 0
    cycle_scores = []

    while i < total:
        # ── Atomically claim the next global cycle number ──
        with locked_state() as state:
            state["totalCycles"] += 1
            cycle_num = state["totalCycles"]
            # Snapshot state for run_cycle context reads (past_critiques,
            # best_by_lang, etc.). Mutations made by run_cycle to the
            # snapshot are merged back in the post-cycle locked block.
            state_snapshot = copy.deepcopy(state)

        result = run_cycle(cycle_num, state_snapshot, language=forced_lang)

        if result:
            cycle_scores.append(result["overall"])

            # ── Merge-back state deltas atomically ──
            with locked_state() as state:
                state["totalSamples"] += 1
                state.setdefault("scores", []).append(result["overall"])
                state["scores"] = state["scores"][-20:]

                # Merge past_critiques (additive, deduped, capped at 20)
                snap_crits = state_snapshot.get("past_critiques", []) or []
                if snap_crits:
                    existing = state.get("past_critiques", []) or []
                    merged = existing + [c for c in snap_crits if c not in existing]
                    state["past_critiques"] = merged[-20:]

                # Merge best_by_lang (per-language last-3)
                snap_best = state_snapshot.get("best_by_lang", {}) or {}
                if snap_best:
                    state.setdefault("best_by_lang", {})
                    for lang, items in snap_best.items():
                        existing = state["best_by_lang"].get(lang, []) or []
                        for item in items:
                            if item not in existing:
                                existing.append(item)
                        state["best_by_lang"][lang] = existing[-3:]

                current_samples = state["totalSamples"]

            # Emit structured line for cognitive-loop.js log capture
            print(
                f"{prefix}[self-train] cycle {cycle_num}: {result['language']} "
                f"{result.get('brief', '')[:30]} score={result['overall']:.3f}"
            )
            sys.stdout.flush()

            # ── Retrain every 10 global samples (try-lock so only one
            # worker retrains at a time). ──
            if current_samples % 10 == 0:
                with try_retrain_lock() as acquired:
                    if acquired:
                        print(f"{prefix}[retrain] starting at sample {current_samples}")
                        sys.stdout.flush()
                        try:
                            retrain()
                            with locked_state() as state:
                                state["retrains"] += 1
                                state["lastRetrain"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                        except Exception as e:
                            print(f"{prefix}[retrain] error: {e}")
                            sys.stdout.flush()
                    else:
                        print(f"{prefix}[retrain] skipped — another worker is retraining")
                        sys.stdout.flush()

            # ── Active-learning regrade pass (Phase 6) ──
            # Only worker 0 runs this so we don't double-regrade in parallel
            # mode.  Costs API spend, so opt-in via --regrade-every.
            if (args.regrade_every > 0
                    and args.worker_id == 0
                    and current_samples > 0
                    and current_samples % args.regrade_every == 0):
                print(f"{prefix}[regrade] uncertainty-driven regrade pass "
                      f"(top {args.regrade_top_k})")
                sys.stdout.flush()
                try:
                    rg = subprocess.run(
                        ["python3", "regrade_uncertain.py",
                         "--top-k", str(args.regrade_top_k)],
                        cwd=str(Path(__file__).parent),
                        capture_output=True, text=True, timeout=600,
                    )
                    for line in (rg.stdout or "").split("\n"):
                        if line.strip():
                            print(f"{prefix}[regrade] {line.rstrip()}")
                    if rg.returncode != 0:
                        print(f"{prefix}[regrade] failed: {(rg.stderr or '')[:200]}")
                    sys.stdout.flush()
                except Exception as e:
                    print(f"{prefix}[regrade] error: {e}")
                    sys.stdout.flush()

        i += 1

    print(f"\n{'═' * 55}")
    print(f"{prefix}COMPLETE")
    print(f"{prefix}Local cycles: {i}")
    if cycle_scores:
        print(f"{prefix}Avg: {sum(cycle_scores)/len(cycle_scores):.3f}")
        print(f"{prefix}Best: {max(cycle_scores):.3f}")
    print("═" * 55)


if __name__ == "__main__":
    main()
