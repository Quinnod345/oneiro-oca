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
import json
import os
import random
import re
import subprocess
import sys
import time
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
        model="claude-opus-4-20250514",
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

def retrain():
    mlx_dir = Path(__file__).parent / "mlx"
    print("[retrain] extracting features...")
    subprocess.run(["python3", "extract_features.py"], cwd=mlx_dir, capture_output=True, timeout=180)
    print("[retrain] training...")
    result = subprocess.run(
        ["python3", "train_v2.py", "--epochs", "300", "--batch", "16", "--patience", "40"],
        cwd=mlx_dir, capture_output=True, text=True, timeout=120,
    )
    for line in result.stdout.split("\n"):
        if "best val loss" in line:
            print(f"[retrain] {line.strip()}")
            break


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
    args = parser.parse_args()

    total = float("inf") if args.forever else args.cycles

    print(f"\n{'═' * 55}")
    print("SELF-TRAINING LOOP v2")
    print("Opus generates → Opus grades → learns from failures → repeat")
    print(f"Cycles: {'forever' if args.forever else args.cycles}")
    print("═" * 55)

    state = load_state()
    cycle_scores = []
    i = 0

    while i < total:
        cycle_num = state["totalCycles"] + i + 1

        result = run_cycle(cycle_num, state)
        if result:
            cycle_scores.append(result["overall"])
            state["totalSamples"] += 1

        if len(cycle_scores) > 0 and len(cycle_scores) % 10 == 0:
            retrain()
            state["retrains"] += 1

        state["totalCycles"] = cycle_num
        if cycle_scores:
            state["scores"] = cycle_scores[-20:]
        save_state(state)
        i += 1

    print(f"\n{'═' * 55}")
    print("COMPLETE")
    print(f"Cycles: {i}")
    print(f"Samples: {state['totalSamples']}")
    if cycle_scores:
        print(f"Avg: {sum(cycle_scores)/len(cycle_scores):.3f}")
        print(f"Best: {max(cycle_scores):.3f}")
    print("═" * 55)


if __name__ == "__main__":
    main()
