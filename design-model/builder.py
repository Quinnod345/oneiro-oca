#!/usr/bin/env python3
"""
Design Builder — generate → render → evaluate → iterate → deliver.

Uses the Anthropic API directly. No CLI hangs.
Language-aware: produces HTML, SwiftUI, or React.  Accretes into a
persistent project dir when --project is passed (so OCA builds a single
app over time instead of scattering throwaway builds).

Usage:
  python builder.py "A focus timer" --language swiftui
  python builder.py "A settings panel" --style "dark, native" --iterations 6
  python builder.py "Next iteration" --project presence   # accretes into active-project/presence/iterations/
  python builder.py --help
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import anthropic
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env", override=True)

client = anthropic.Anthropic()

# Reuse self_train.py's language-aware helpers so builder + self-train stay
# in sync on fence extraction, prompt shape, and rendering.
sys.path.insert(0, str(Path(__file__).parent))
from self_train import LANGUAGE_PROMPTS, extract_code  # noqa: E402
from renderers import render as render_code  # noqa: E402

SCORE_NAMES = [
    "typography_quality", "color_harmony", "spatial_composition",
    "motion_elegance", "emotional_resonance", "craft_visibility",
    "minimalism_coherence", "native_integration",
    "visceral_score", "behavioral_score", "reflective_score",
    "overall_aesthetic",
    "innovation_score", "system_creativity", "design_distinctiveness",
    "problem_level",
]

LANGUAGE_EXT = {"html": "html", "swiftui": "swift", "react": "jsx"}

BUILDS_DIR = Path(__file__).parent / "builds"
ACTIVE_PROJECT_DIR = Path(__file__).parent / "active-project"
MANIFEST_PATH = Path(__file__).parent / "data" / "manifest.json"
SKILL_PATH = Path.home() / ".claude" / "skills" / "frontend-design" / "SKILL.md"

# Per-reference truncation cap — each reference is trimmed to this many chars
# before being injected into the generate prompt so two refs + skill + goal
# stay well under Sonnet's context comfortable-zone. 3200 chars ≈ 100 lines
# of Swift, enough to show structural patterns without dominating context.
REFERENCE_CHAR_CAP = 3200
# Maximum total reference injection (across all refs combined). 8000 chars
# is ~2000 tokens — leaves plenty of room for the skill + goal + rules.
MAX_REFS_TOTAL_CHARS = 8000


def sonnet(prompt: str) -> str:
    msg = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=16000,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text


def opus(prompt: str) -> str:
    msg = client.messages.create(
        model="claude-opus-4-20250514",
        max_tokens=4000,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text


def render_to_png(code: str, png_path: str, language: str) -> tuple[bool, str | None]:
    """Render the generated code to a screenshot via renderers.py dispatch.

    Returns (success, error_message). The error message propagates into
    the next iteration's prompt so the LLM sees exactly what broke —
    this is what lets the compile-error feedback loop actually close.
    """
    try:
        success, out_path, err = render_code(language, code, png_path)
        if not success:
            preview = (err or '').strip()[:180]
            print(f"  [render] {language} failed: {preview}")
        return success, err
    except Exception as e:
        print(f"  [render] exception: {e}")
        return False, str(e)


def try_compile_fix(
    code: str,
    png_path: str,
    language: str,
    render_error: str,
    max_attempts: int = 3,
) -> tuple[str, bool, str | None]:
    """Attempt in-place compile fixes when a render fails.

    Mirrors self_train.py's proven pattern: when swiftc fails, give Opus
    the exact compiler stderr and ask it to fix the broken code. Re-render.
    Up to `max_attempts` tries. Each attempt costs one Opus call (~5-10s)
    but saves a whole iteration slot, so net it's a strong win for the
    autonomous build loop.

    Returns (code, has_png, latest_error). On success `code` is the fixed
    version and `has_png` is True. On failure it's the original code and
    the last render error.
    """
    # Only swiftui + react benefit — html never "compiles", just renders.
    if language not in ("swiftui", "react"):
        return code, False, render_error
    if not render_error or "Compile" not in render_error:
        return code, False, render_error

    lang_cfg = LANGUAGE_PROMPTS[language]

    for attempt in range(max_attempts):
        print(f"  [compile-fix {attempt+1}/{max_attempts}] asking Opus to fix…")
        try:
            fix_prompt = (
                f"The following {language} code failed to compile. Return COMPLETE "
                f"corrected code that compiles cleanly.\n\n"
                f"COMPILER ERROR:\n{render_error[:2000]}\n\n"
                f"HOW TO FIX COMPILE ERRORS:\n"
                f"- If an error says 'cannot find X in scope', you MUST either "
                f"DEFINE X inline as a struct/class/enum/function, OR REPLACE the "
                f"reference to X with an equivalent built-in. Do NOT return code "
                f"that still references X — that will fail the same way.\n"
                f"- If an error says 'has no member Y', replace .Y with a valid "
                f"member of that type. Never guess — use only documented API.\n"
                f"- If a type is missing protocol conformance (Identifiable, etc.), "
                f"add the conformance or wrap in a type that has it.\n"
                f"- If a closure has a type inference error, add explicit types.\n"
                f"- You are authorized to RESTRUCTURE the code if needed — "
                f"preserving design intent matters less than producing code that "
                f"actually compiles. A non-compiling iteration is worthless.\n\n"
                f"LANGUAGE RULES:\n{lang_cfg['rules']}\n\n"
                f"BROKEN CODE:\n{code[:6000]}\n\n"
                f"Respond ONLY with complete corrected code (no prose, no fences). "
                f"{lang_cfg['format']}"
            )
            fixed_raw = opus(fix_prompt)
            fixed_code = extract_code(fixed_raw, language)
            if len(fixed_code) < 100:
                print(f"  [compile-fix {attempt+1}] fix output too short")
                continue

            has_png, new_err = render_to_png(fixed_code, png_path, language)
            if has_png:
                print(f"  [compile-fix {attempt+1}] ✅ compile green")
                return fixed_code, True, None
            # Still failing — update error and loop
            render_error = new_err or render_error
            code = fixed_code  # stage the latest attempt as starting point
        except Exception as e:
            print(f"  [compile-fix {attempt+1}] exception: {str(e)[:80]}")
            break

    return code, False, render_error


def grade(code: str, language: str) -> dict | None:
    """Opus grades the design. Prompt is language-aware so the judge knows
    it's looking at SwiftUI / React / HTML and calibrates native_integration."""
    try:
        lang_label = {
            "html": "HTML/CSS web component",
            "swiftui": "native SwiftUI macOS view",
            "react": "React component",
        }.get(language, "UI design")

        raw = opus(
            f"Grade this {lang_label} 0-1 per dimension. Be HARSH and COHERENT — "
            f"great typography that clashes with the palette means BOTH drop.\n\n"
            f"For native_integration: {'reward platform-native idioms (SF Pro, NSVisualEffectView, system materials)' if language == 'swiftui' else 'reward fit-for-web conventions'}.\n\n"
            f"Dimensions: {', '.join(SCORE_NAMES)}\n\n"
            f"2-sentence critique. What's weak and HOW to fix it.\n"
            f'Return ONLY JSON: {{"scores":{{...all 16...}},"critique":"...","fixes":["specific fix 1","specific fix 2","specific fix 3"]}}\n\n'
            f"{language.upper()}:\n{code[:8000]}"
        )
        m = re.search(r"\{[\s\S]*\}", raw)
        if not m:
            return None
        result = json.loads(m.group())
        for name in SCORE_NAMES:
            result["scores"][name] = max(0.0, min(1.0, float(result["scores"].get(name, 0.5))))
        return result
    except Exception as e:
        print(f"  [grade failed] {e}")
        return None


def _next_iter_num(project_dir: Path) -> int:
    """Find the next iteration number in active-project/<name>/iterations/."""
    iters_dir = project_dir / "iterations"
    if not iters_dir.exists():
        return 1
    existing = [p for p in iters_dir.iterdir() if p.is_dir() and p.name.startswith("iter-")]
    if not existing:
        return 1
    nums = []
    for p in existing:
        try:
            nums.append(int(p.name.split("-", 1)[1]))
        except Exception:
            continue
    return (max(nums) + 1) if nums else 1


def load_references(project: str, language: str, goal: str) -> list[dict]:
    """Load reference pool for the active project and pick 1-2 per build.

    Strategy:
      • Read active-project/<project>/references/manifest.json
      • Filter to entries matching the target language (Swift refs only
        apply to swiftui builds)
      • Score each by tag overlap with the goal text
      • Pick the top `compile-correctness` entry (must compile standalone)
        and the top `style` entry (can be incomplete as long as it's
        aesthetic guidance)
      • Read each file from disk, truncate, return as dicts

    Returns a list of {name, kind, source_type, content, truncated, path_ok}
    dicts in the order they should appear in the prompt. An empty list
    means references are unavailable or the project has no manifest —
    in that case builder.py falls through to the legacy skill-only path.
    """
    if not project:
        return []
    manifest_path = ACTIVE_PROJECT_DIR / project / "references" / "manifest.json"
    if not manifest_path.exists():
        return []

    try:
        manifest = json.loads(manifest_path.read_text())
    except Exception as e:
        print(f"  [refs] manifest parse failed: {e}")
        return []

    entries = manifest.get("references", [])
    if not entries:
        return []

    # Only SwiftUI refs apply to SwiftUI builds and so on — skip mismatches.
    # All seeded refs are currently .swift so they're language-tagged via path.
    def lang_match(entry):
        path = entry.get("path", "")
        if language == "swiftui":
            return path.endswith(".swift")
        if language == "html":
            return path.endswith((".html", ".htm"))
        if language == "react":
            return path.endswith((".jsx", ".tsx", ".js"))
        return True

    applicable = [e for e in entries if lang_match(e)]

    # Score by tag overlap with the goal text (simple substring match).
    goal_lower = (goal or "").lower()
    def score(entry):
        tags = [t.lower() for t in entry.get("tags", [])]
        return sum(1 for t in tags if t in goal_lower) + \
               sum(1 for word in entry.get("best_for", []) if str(word).lower() in goal_lower) * 2

    applicable.sort(key=score, reverse=True)

    # Pick one per kind — 1 compile-correctness + 1 style if both available.
    picked = []
    seen_kinds = set()
    for entry in applicable:
        kind = entry.get("kind", "style")
        if kind in seen_kinds:
            continue
        picked.append(entry)
        seen_kinds.add(kind)
        if len(picked) >= 2:
            break

    # Fallback picks — ensure we have at least one of each kind when
    # available, even if tag scoring didn't surface it.  Sill benefits
    # from BOTH a compile-correctness anchor AND a style anchor on
    # every build; tag-only matching is too stingy in the early days
    # when the goal text doesn't happen to mention "frosted-glass" or
    # "rounded-rectangle".
    for kind in ("compile-correctness", "style"):
        if kind in seen_kinds:
            continue
        for entry in applicable:
            if entry.get("kind") == kind:
                picked.append(entry)
                seen_kinds.add(kind)
                break

    # Deduplicate (can happen if we re-added an entry above)
    seen_paths = set()
    deduped = []
    for p in picked:
        if p.get("path") in seen_paths:
            continue
        seen_paths.add(p.get("path"))
        deduped.append(p)

    # Load each file, respect per-ref + total char caps.
    result = []
    total = 0
    for entry in deduped[:3]:  # hard cap at 3 refs for prompt budget safety
        raw_path = entry.get("path", "")
        if not raw_path:
            continue
        # Absolute paths (MindGarden) used as-is; relative paths join against
        # the project's references/ dir.
        if raw_path.startswith("/"):
            full_path = Path(raw_path)
        else:
            full_path = ACTIVE_PROJECT_DIR / project / "references" / raw_path

        if not full_path.exists():
            print(f"  [refs] missing: {entry.get('name')} → {full_path}")
            continue

        try:
            content = full_path.read_text()
        except Exception as e:
            print(f"  [refs] read failed: {entry.get('name')} → {e}")
            continue

        truncated = False
        if len(content) > REFERENCE_CHAR_CAP:
            content = content[:REFERENCE_CHAR_CAP] + "\n// … [truncated for prompt budget]"
            truncated = True

        # Total budget check — drop this ref if it would blow the cap
        if total + len(content) > MAX_REFS_TOTAL_CHARS and result:
            break

        total += len(content)
        result.append({
            "name": entry.get("name"),
            "kind": entry.get("kind", "style"),
            "source_type": entry.get("source_type", "unknown"),
            "description": entry.get("description", ""),
            "content": content,
            "truncated": truncated,
            "path_ok": True,
        })

    if result:
        kinds = ",".join(r["kind"] for r in result)
        print(f"  [refs] injected {len(result)} references: {kinds}")
    return result


def format_references_for_prompt(refs: list[dict]) -> str:
    """Format loaded references as a prompt-ready block. Each reference
    is clearly labeled with its role so the LLM knows how to use it."""
    if not refs:
        return ""

    parts = [
        "REFERENCE EXAMPLES — study these before generating.",
        "",
        "Two kinds of references:",
        "  • `compile-correctness` — these compile cleanly under Swift 6.2 / macOS 26. "
        "Study their patterns (Identifiable conformance, Color literal style, state "
        "management, ForEach index patterns) and MATCH them. Your output should be "
        "structurally similar to these.",
        "  • `style` — these show Quinn's preferred aesthetic (color palette choices, "
        "material layering, spacing rhythm, button treatment). They may reference "
        "external assets or EnvironmentObjects that won't be in your output — use "
        "them for LOOK AND FEEL only, not for structure.",
        "",
    ]
    for i, ref in enumerate(refs, 1):
        role_note = (
            "copy its structural patterns"
            if ref["kind"] == "compile-correctness"
            else "match its aesthetic choices"
        )
        parts.append(
            f"--- Reference {i}: {ref['name']} "
            f"[{ref['kind']}] ({ref['source_type']}) — {role_note} ---"
        )
        if ref.get("description"):
            parts.append(f"// {ref['description']}")
        parts.append(ref["content"])
        parts.append("")

    parts.append("--- END REFERENCES ---")
    return "\n".join(parts)


def build(
    goal: str,
    style: str = "",
    constraints: list[str] = None,
    max_iterations: int = 6,
    quality_threshold: float = 0.72,
    innovation_threshold: float = 0.40,
    language: str = "swiftui",
    project: str | None = None,
) -> dict:
    """
    Build a design artifact with quality-guided iteration.

    If `project` is given, accretes into active-project/<project>/iterations/iter-<N>/
    (the singular-project pattern — OCA iterates on one app over time).
    Otherwise writes a throwaway into builds/build-<timestamp>/.

    Returns: {code, screenshot, scores, iterations, history, success, build_dir, language}
    """
    if language not in LANGUAGE_PROMPTS:
        raise ValueError(f"Unknown language: {language}. Expected one of {list(LANGUAGE_PROMPTS)}")

    # ── Build-dir selection ──
    if project:
        project_dir = ACTIVE_PROJECT_DIR / project
        iter_num = _next_iter_num(project_dir)
        build_dir = project_dir / "iterations" / f"iter-{iter_num:04d}"
        print(f"[builder] project: {project} — iteration {iter_num}")
    else:
        build_dir = BUILDS_DIR / f"build-{int(time.time())}"
    build_dir.mkdir(parents=True, exist_ok=True)

    ext = LANGUAGE_EXT[language]
    lang_cfg = LANGUAGE_PROMPTS[language]

    # Load skill
    skill = SKILL_PATH.read_text()[:1500] if SKILL_PATH.exists() else ""

    # Load reference pool — 1-2 examples matched by tag against the goal.
    # These become few-shot anchors in the first-iteration prompt so the LLM
    # starts from known-good patterns instead of rolling fresh every build.
    refs = load_references(project or "", language, goal) if project else []
    refs_block = format_references_for_prompt(refs)

    print(f"[builder] goal: {goal}")
    print(f"[builder] language: {language} | thresholds: quality={quality_threshold} innovation={innovation_threshold}")
    if refs:
        ref_names = ", ".join(r["name"] for r in refs)
        print(f"[builder] references: {ref_names}")

    history = []
    best_code = None
    best_score = 0
    best_scores = None
    best_png = None

    for i in range(max_iterations):
        t0 = time.time()

        # ── GENERATE ──
        if i == 0 or not history:
            parts = []
            if skill:
                parts.append(f"DESIGN SKILL:\n{skill}\n")
            if refs_block:
                parts.append(refs_block)
            parts.append(f"{lang_cfg['framing']}\n\nGoal: {goal}")
            if style:
                parts.append(f"Style: {style}")
            if constraints:
                parts.append("Constraints:\n" + "\n".join(f"- {c}" for c in constraints))
            parts.append(f"Rules:\n{lang_cfg['rules']}")
            parts.append(
                "Aim for Level 5+ thinking (problem redefinition, not just execution). "
                "Cohesive design — every part must serve the whole. If references were "
                "provided above, your output should feel structurally adjacent to them "
                "while solving the specific goal."
            )
            parts.append(lang_cfg["format"])
            prompt = "\n\n".join(parts)
        else:
            last = history[-1]
            fixes = last.get("fixes", [])
            render_error = last.get("render_error") or ""

            # When the previous iteration failed to render (compile error,
            # missing type, wrong ShapeStyle member, etc.), hoist the full
            # error output to the TOP of the improve prompt as a P0 hard
            # constraint. This is the single biggest lever on autonomous
            # build success rate — without specific error text, the LLM
            # keeps re-making the same mistakes because it never sees
            # them. With the error text, it fixes them precisely.
            error_block = ""
            if render_error:
                error_block = (
                    f"⚠️ PREVIOUS ITERATION FAILED TO RENDER — FIX THIS FIRST\n\n"
                    f"{render_error.strip()}\n\n"
                    f"Your P0 task is to produce code that compiles cleanly. "
                    f"Read the error above carefully — the message points to the "
                    f"exact line/symbol that broke. Do not re-use the same "
                    f"pattern that caused this error. Do not introduce new "
                    f"features until the compile is green.\n\n"
                )

            prompt = (
                f"{error_block}"
                f"Improve this {language} design. Current score: {last['overall']:.2f}\n\n"
                f"Critique: {last.get('critique', '')}\n\n"
                f"Specific fixes needed:\n" +
                "\n".join(f"- {f}" for f in fixes[:5]) +
                f"\n\nCurrent code:\n{last['code'][:6000]}\n\n"
                f"Return the COMPLETE improved code. {lang_cfg['format']}\n"
                f"Make sure fixes work with the WHOLE design."
            )

        try:
            raw = sonnet(prompt)
            code = extract_code(raw, language)
            if len(code) < 100:
                print(f"  [{i+1}] generated code too short, skipping")
                continue
        except Exception as e:
            print(f"  [{i+1}] generate failed: {e}")
            continue

        gen_time = time.time() - t0

        # ── RENDER ──
        code_path = build_dir / f"iter-{i}.{ext}"
        png_path = build_dir / f"iter-{i}.png"
        code_path.write_text(code)
        has_png, render_error = render_to_png(code, str(png_path), language)

        # ── MID-ITERATION COMPILE FIX ──
        # When swiftc fails, don't burn the iteration slot — give Opus the
        # exact compiler stderr and ask for an in-place fix. This mirrors
        # self_train.py's proven pattern. 3 attempts max. If any succeed,
        # update the on-disk code so the PNG and .swift file match.
        if not has_png:
            fixed_code, fixed_ok, render_error = try_compile_fix(
                code, str(png_path), language, render_error or ""
            )
            if fixed_ok:
                code = fixed_code
                code_path.write_text(code)  # overwrite with fixed version
                has_png = True

        # ── GRADE ──
        t1 = time.time()
        result = grade(code, language)
        grade_time = time.time() - t1

        if not result:
            print(f"  [{i+1}] grading failed, skipping")
            # Still record the iteration so the next loop can see the
            # render_error — otherwise the feedback loop breaks here.
            history.append({
                "iteration": i,
                "code": code,
                "code_path": str(code_path),
                "png_path": None,
                "overall": 0.0,
                "innovation": 0.0,
                "scores": {},
                "critique": "grading failed",
                "fixes": [],
                "render_error": render_error,
            })
            continue

        overall = result["scores"]["overall_aesthetic"]
        innovation = result["scores"]["innovation_score"]
        critique = result.get("critique", "")
        fixes = result.get("fixes", [])

        history.append({
            "iteration": i,
            "code": code,
            "code_path": str(code_path),
            "png_path": str(png_path) if has_png else None,
            "overall": overall,
            "innovation": innovation,
            "scores": result["scores"],
            "critique": critique,
            "fixes": fixes,
            "render_error": render_error,  # preserved even on success (usually None)
        })

        if overall > best_score:
            best_code = code
            best_score = overall
            best_scores = result["scores"]
            best_png = str(png_path) if has_png else None

        marker = "✅" if overall >= quality_threshold and innovation >= innovation_threshold else "⏳"
        print(f"  [{i+1}/{max_iterations}] overall={overall:.2f} innovation={innovation:.2f} "
              f"({gen_time:.0f}s gen, {grade_time:.0f}s grade) {marker}")
        if critique:
            print(f"    {critique[:80]}")

        # ── DECIDE ──
        if overall >= quality_threshold and innovation >= innovation_threshold:
            print(f"[builder] ✅ accepted at iteration {i+1}")
            break

    # ── STORE ──
    if best_code and best_png:
        try:
            manifest = json.loads(MANIFEST_PATH.read_text())
            manifest["samples"].append({
                "image": best_png,
                "screenshot_path": best_png,
                "scores": best_scores,
                "source": "builder",
                "confidence": 0.9,
                "metadata": {
                    "source_name": f"build-{goal[:30].replace(' ', '-')}",
                    "category": "builder-output",
                    "language": language,
                    "project": project or None,
                    "quality_target": "high" if best_score > 0.75 else "medium",
                    "goal": goal[:200],
                    "iterations": len(history),
                    "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                },
            })
            MANIFEST_PATH.write_text(json.dumps(manifest, indent=2))
        except Exception:
            pass

    return {
        "code": best_code,
        "screenshot": best_png,
        "scores": best_scores,
        "overall": best_score,
        "iterations": len(history),
        "language": language,
        "project": project,
        "history": [{"iter": h["iteration"], "overall": h["overall"], "innovation": h["innovation"]} for h in history],
        "success": best_score >= quality_threshold,
        "build_dir": str(build_dir),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Design Builder — generate, evaluate, iterate")
    parser.add_argument("goal", help="What to build")
    parser.add_argument("--style", default="", help="Aesthetic direction")
    parser.add_argument("--constraints", nargs="*", default=[], help="Design constraints")
    parser.add_argument("--iterations", type=int, default=6, help="Max iterations")
    parser.add_argument("--quality", type=float, default=0.72, help="Quality threshold")
    parser.add_argument("--innovation", type=float, default=0.40, help="Innovation threshold")
    parser.add_argument(
        "--language",
        choices=["html", "swiftui", "react"],
        default="swiftui",
        help="Target language for generation (default: swiftui)",
    )
    parser.add_argument(
        "--project",
        default=None,
        help="Accrete into active-project/<project>/iterations/ instead of builds/<timestamp>/",
    )
    args = parser.parse_args()

    result = build(
        goal=args.goal,
        style=args.style,
        constraints=args.constraints,
        max_iterations=args.iterations,
        quality_threshold=args.quality,
        innovation_threshold=args.innovation,
        language=args.language,
        project=args.project,
    )

    ext = LANGUAGE_EXT[result["language"]]
    print(f"\n{'═' * 50}")
    print(f"{'SUCCESS' if result['success'] else 'BEST EFFORT'}")
    print(f"Language: {result['language']}")
    if result['project']:
        print(f"Project: {result['project']}")
    print(f"Overall: {result['overall']:.3f}")
    print(f"Iterations: {result['iterations']}")
    trajectory = ' → '.join(str(round(h["overall"], 2)) for h in result['history'])
    print(f"Trajectory: {trajectory}")
    print(f"Build: {result['build_dir']}")
    last_idx = max(0, result['iterations'] - 1)
    print(f"Open: {result['build_dir']}/iter-{last_idx}.{ext}")
    print("═" * 50)
