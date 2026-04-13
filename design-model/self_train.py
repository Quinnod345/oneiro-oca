#!/usr/bin/env python3
"""
Self-Training Loop — the model builds itself.

Sonnet generates designs → Opus grades them → model trains → repeat.
Uses the Anthropic SDK directly (no CLI hanging issues).

Usage:
  python self_train.py                    # Run 10 cycles
  python self_train.py --cycles 50        # Run 50 cycles
  python self_train.py --forever          # Run until killed
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import subprocess
import anthropic
from dotenv import load_dotenv

# Load API key from .env
load_dotenv(Path(__file__).parent.parent.parent / ".env", override=True)

# Add parent for imports
sys.path.insert(0, str(Path(__file__).parent / "mlx"))

DATA_DIR = Path(__file__).parent / "data"
MANIFEST_PATH = DATA_DIR / "manifest.json"
SELF_TRAIN_DIR = DATA_DIR / "self-train"
STATE_PATH = DATA_DIR / "self-train-state.json"
SKILL_PATH = Path.home() / ".claude" / "skills" / "frontend-design" / "SKILL.md"

SELF_TRAIN_DIR.mkdir(parents=True, exist_ok=True)

client = anthropic.Anthropic()  # Uses ANTHROPIC_API_KEY from env

SCORE_NAMES = [
    "typography_quality", "color_harmony", "spatial_composition",
    "motion_elegance", "emotional_resonance", "craft_visibility",
    "minimalism_coherence", "native_integration",
    "visceral_score", "behavioral_score", "reflective_score",
    "overall_aesthetic",
    "innovation_score", "system_creativity", "design_distinctiveness",
    "problem_level",
]

BRIEFS = [
    "A macOS menu bar app showing focus state through color and subtle motion — not a timer, an ambient presence",
    "A file organizer as a spatial canvas — documents arranged by topic proximity, not lists or grids",
    "A bookmark manager where links grow into a knowledge map with visible connections between topics",
    "A meeting scheduler where time flows as a river — free slots are calm water, meetings are bridges",
    "A music discovery interface where genres are landscapes — your listening history is a trail through terrain",
    "A habit tracker as a garden — daily completion waters plants, streaks bloom, neglect wilts",
    "A note-taking app in 3D space — recent notes float near, old ones drift away, connections are threads",
    "A weather dashboard that makes you FEEL weather through texture and rhythm, not icons and numbers",
    "A spending tracker where categories are geological layers — deeper is necessity, surface is discretionary",
    "A code review tool where diff quality shows through visual density — clean is spacious, messy is compressed",
    "A recipe manager as a transformation timeline — ingredients flow through steps and combine into the dish",
    "A podcast player where episodes are constellations — listened ones glow, series form patterns",
    "A task manager where tasks have physical weight — heavy ones sink, quick ones float, done ones launch up",
    "A contacts app as a social constellation — closeness reflects relationship, interactions glow",
    "A reading list as physical magazines stacked on a table — see edges, peek at covers",
    "A system monitor where CPU/memory are organisms — healthy breathes steady, stressed pulses fast",
    "A color palette generator that works like a musical instrument — play colors, harmonies lock like chords",
    "A git branch visualizer as an actual tree — main is trunk, features branch out, merged ones are pruned",
    "A calendar showing energy levels — mornings are high ground, post-lunch dips are valleys",
    "A password manager where vaults are rooms — each has character, security shows through visual weight",
]


def call_sonnet(prompt: str) -> str:
    """Generate with Sonnet (fast, good at code)."""
    msg = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=16000,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text


def call_opus(prompt: str) -> str:
    """Grade with Opus (best judgment)."""
    msg = client.messages.create(
        model="claude-opus-4-20250514",
        max_tokens=4000,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text


def extract_html(text: str) -> str:
    """Extract HTML from LLM response."""
    # Try code fence first
    m = re.search(r"```html\n?([\s\S]*?)\n?```", text)
    if m:
        return m.group(1).strip()
    m = re.search(r"```\n?([\s\S]*?)\n?```", text)
    if m and "<" in m.group(1):
        return m.group(1).strip()
    # Try finding the HTML directly
    for marker in ["<!DOCTYPE", "<html", "<head"]:
        idx = text.find(marker)
        if idx >= 0:
            return text[idx:].strip()
    return text.strip()


def render_screenshot(html_path: str, png_path: str) -> bool:
    """Render HTML to PNG via Puppeteer."""
    try:
        import subprocess
        script = f"""
import puppeteer from 'puppeteer';
const b = await puppeteer.launch({{headless:true,args:['--no-sandbox']}});
const p = await b.newPage();
await p.setViewport({{width:1440,height:900,deviceScaleFactor:2}});
await p.goto('file://{html_path}',{{waitUntil:'networkidle0',timeout:15000}});
await new Promise(r=>setTimeout(r,500));
await p.screenshot({{path:'{png_path}',type:'png'}});
await b.close();
"""
        subprocess.run(
            ["node", "-e", script],
            cwd=str(Path(__file__).parent.parent),
            capture_output=True, timeout=30,
        )
        return os.path.exists(png_path)
    except Exception:
        return False


def load_state():
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text())
    return {"totalCycles": 0, "totalSamples": 0, "retrains": 0, "scores": []}


def save_state(state):
    STATE_PATH.write_text(json.dumps(state, indent=2))


def retrain():
    """Extract features and retrain the model."""
    import subprocess
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


def run_cycle(cycle_num: int) -> dict | None:
    brief = BRIEFS[cycle_num % len(BRIEFS)]
    print(f"\n[cycle {cycle_num}] {brief[:55]}...")

    # 1. SONNET GENERATES
    t0 = time.time()
    try:
        raw = call_sonnet(
            f"Create a complete HTML page (1440x900) with inline CSS:\n\n{brief}\n\n"
            f"Rules: system fonts, CSS vars, no Inter, no generic gradients, Level 5+ design, ship quality.\n"
            f"Return ONLY the HTML."
        )
        html = extract_html(raw)
        if "<" not in html or len(html) < 200:
            print(f"  [FAIL] invalid HTML ({len(html)} chars)")
            return None
    except Exception as e:
        print(f"  [FAIL] generate: {e}")
        return None

    gen_time = time.time() - t0

    # 2. SAVE + RENDER
    html_path = str(SELF_TRAIN_DIR / f"cycle-{cycle_num}.html")
    png_path = str(SELF_TRAIN_DIR / f"cycle-{cycle_num}.png")
    Path(html_path).write_text(html)
    has_screenshot = render_screenshot(html_path, png_path)

    # 3. OPUS GRADES
    t1 = time.time()
    try:
        grade_raw = call_opus(
            f"Grade this UI design 0-1 per dimension. Be HARSH. Dimensions must be COHERENT — "
            f"great typography that clashes with the palette means BOTH drop.\n\n"
            f"Score: {', '.join(SCORE_NAMES)}\n\n"
            f"2-sentence critique. Return ONLY JSON: "
            f'{{"scores":{{...all 16...}},"critique":"..."}}\n\n'
            f"HTML:\n{html[:8000]}"
        )
        json_match = re.search(r"\{[\s\S]*\}", grade_raw)
        if not json_match:
            raise ValueError("No JSON in response")
        grade = json.loads(json_match.group())
    except Exception as e:
        print(f"  [FAIL] grade: {e}")
        return None

    grade_time = time.time() - t1

    # Validate scores
    scores = grade.get("scores", {})
    for name in SCORE_NAMES:
        scores[name] = max(0.0, min(1.0, float(scores.get(name, 0.5))))

    overall = scores["overall_aesthetic"]
    innovation = scores["innovation_score"]
    critique = grade.get("critique", "")

    print(f"  overall={overall:.2f} innovation={innovation:.2f} "
          f"({gen_time:.0f}s gen, {grade_time:.0f}s grade) | {critique[:70]}")

    # 4. STORE IN MANIFEST
    manifest = json.loads(MANIFEST_PATH.read_text())

    # Extract code features
    code_features = None
    try:
        import subprocess
        result = subprocess.run(
            ["node", "-e", f"""
import {{ encodeFromCode }} from './design-model/encoder.js';
const f = encodeFromCode(require('fs').readFileSync('{html_path}','utf-8'), {{platform:'web'}});
console.log(JSON.stringify(Array.from(f)));
"""],
            cwd=str(Path(__file__).parent.parent),
            capture_output=True, text=True, timeout=10,
        )
        if result.stdout.strip():
            code_features = json.loads(result.stdout.strip())
    except Exception:
        pass

    manifest["samples"].append({
        "image": png_path if has_screenshot else html_path,
        "screenshot_path": png_path if has_screenshot else None,
        "scores": scores,
        "source": "opus_self_train",
        "confidence": 0.9,
        "code_features": code_features,
        "metadata": {
            "source_name": f"self-train-{cycle_num}",
            "category": "self-train",
            "quality_target": "high" if overall > 0.75 else "medium" if overall > 0.5 else "low",
            "brief": brief[:200],
            "critique": critique,
            "code_path": html_path,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        },
    })
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2))

    return {"overall": overall, "innovation": innovation, "critique": critique}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cycles", type=int, default=10)
    parser.add_argument("--forever", action="store_true")
    args = parser.parse_args()

    total = float("inf") if args.forever else args.cycles

    print(f"\n{'═' * 50}")
    print("SELF-TRAINING LOOP")
    print("Sonnet generates → Opus grades → model trains")
    print(f"Cycles: {'forever' if args.forever else args.cycles}")
    print("═" * 50)

    state = load_state()
    cycle_scores = []
    i = 0

    while i < total:
        cycle_num = state["totalCycles"] + i + 1

        result = run_cycle(cycle_num)
        if result:
            cycle_scores.append(result["overall"])
            state["totalSamples"] += 1

        # Retrain every 10 successful cycles
        if len(cycle_scores) > 0 and len(cycle_scores) % 10 == 0:
            retrain()
            state["retrains"] += 1

        state["totalCycles"] = cycle_num
        if cycle_scores:
            state["scores"] = cycle_scores[-20:]  # Keep last 20
        save_state(state)
        i += 1

    # Summary
    print(f"\n{'═' * 50}")
    print("COMPLETE")
    print(f"Cycles: {state['totalCycles']}")
    print(f"Samples: {state['totalSamples']}")
    print(f"Retrains: {state['retrains']}")
    if cycle_scores:
        print(f"Avg: {sum(cycle_scores)/len(cycle_scores):.3f}")
        print(f"Best: {max(cycle_scores):.3f}")
        print(f"Worst: {min(cycle_scores):.3f}")
    print("═" * 50)


if __name__ == "__main__":
    main()
