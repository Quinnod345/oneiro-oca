#!/usr/bin/env python3
"""
grade.py — wrap the local design model server with a clean JSON CLI.

Talks to /tmp/design-model-v2.sock (Phase 10 server: DINOv2 + MiniLM
text-intent encoder + 64-dim trunk).  Returns scores, per-dim
uncertainty, weakest dimensions, and a list of targeted improvement
prompts the LLM can use to regenerate.

Usage
  python3 grade.py path/to/screenshot.png \
      --brief "A minimal task list inspired by Things 3"

Returns JSON to stdout (one line) — easy for an LLM to parse.
"""

import argparse
import json
import os
import socket
import sys
import time
from pathlib import Path

SOCKET_PATH = "/tmp/design-model-v2.sock"
START_SCRIPT = Path(
    "/Users/quinnodonnell/.openclaw/workspace/oneiro-core/cognitive/"
    "design-model/start-server.sh"
)


# Per-dim improvement hints — used to nudge the LLM toward fixing the
# specific weakness rather than rewriting from scratch.  Mirrors the
# tone of evaluate.js's generateSuggestions but trimmed for inline use.
DIM_HINTS = {
    "typography_quality": (
        "Choose distinctive fonts (avoid Inter/Roboto/Arial). Pair a display "
        "font with a body font, use a consistent type scale, add letter-spacing "
        "to headings."
    ),
    "color_harmony": (
        "Build a dominant color + sharp accent system via CSS custom "
        "properties. Avoid purple-gradient-on-white. Hit WCAG AA contrast."
    ),
    "spatial_composition": (
        "Add generous whitespace. Use CSS Grid for layout structure. Create "
        "visual flow with intentional asymmetry. Let elements breathe."
    ),
    "motion_elegance": (
        "Add page-load reveals with stagger. Use spring physics for "
        "interactives. Ensure prefers-reduced-motion is respected."
    ),
    "emotional_resonance": (
        "Add micro-interactions that delight (button feedback, success "
        "celebrations). Choose colors that evoke target emotions."
    ),
    "craft_visibility": (
        "Align every element to a grid. Polish icons. Ensure consistent "
        "spacing multipliers (4px or 8px base)."
    ),
    "minimalism_coherence": (
        "Remove elements that don't earn their place. Use progressive "
        "disclosure. Hide complexity until needed."
    ),
    "native_integration": (
        "Use SF Pro or Inter system stack. Match macOS dark mode. Add "
        "keyboard shortcuts. Use platform-standard controls."
    ),
    "visceral_score": (
        "Focus on first-impression beauty. Bold typography, rich colors, "
        "polished surfaces. The user should feel 'wow' within 1 second."
    ),
    "behavioral_score": (
        "Make every action feel effortless. Clear feedback for all "
        "interactions. Prevent errors through smart defaults."
    ),
    "reflective_score": (
        "Create something users are proud to use. Build emotional connection "
        "through personality. Make it story-worthy."
    ),
    "innovation_score": (
        "Solve at Level 5+ — don't execute, REDEFINE what this interface "
        "means. Find an unexpected metaphor that fits the brief."
    ),
    "system_creativity": (
        "Connect constraints to features. Find the unique system property "
        "that makes this design impossible to replicate generically."
    ),
    "design_distinctiveness": (
        "Avoid generic patterns (centered hero + 3 cards, framework defaults). "
        "Find a visual identity that's unmistakable in a screenshot."
    ),
    "problem_level": (
        "Check whether you're executing or reframing.  A Level 1 design solves "
        "the surface task; a Level 5+ design finds the deeper job and changes "
        "the rules."
    ),
    "overall_aesthetic": (
        "If overall is low while individual dims are okay, the parts aren't "
        "cohering — typography/color/spacing must work as a system, not "
        "isolated decisions."
    ),
}


def ensure_server_running(timeout: int = 30) -> bool:
    """Return True if the design model server socket is responsive.
    Tries to start it via start-server.sh if missing."""
    if os.path.exists(SOCKET_PATH):
        return True
    if not START_SCRIPT.exists():
        return False
    print(f"[grade] starting design model server...", file=sys.stderr)
    os.system(f"bash {START_SCRIPT} --warmup &")
    for _ in range(timeout):
        if os.path.exists(SOCKET_PATH):
            return True
        time.sleep(1)
    return False


def query_server(request: dict) -> dict:
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(60.0)
    sock.connect(SOCKET_PATH)
    sock.sendall(json.dumps(request).encode("utf-8"))
    sock.shutdown(socket.SHUT_WR)
    chunks = []
    while True:
        chunk = sock.recv(65536)
        if not chunk:
            break
        chunks.append(chunk)
    sock.close()
    return json.loads(b"".join(chunks).decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Grade a design via the local design model")
    parser.add_argument("screenshot", help="Path to screenshot PNG")
    parser.add_argument("--brief", default="",
                        help="Design intent / brief — same text the model "
                             "would condition on at training time")
    parser.add_argument("--threshold", type=float, default=0.70,
                        help="Overall score threshold below which to "
                             "recommend iteration (default 0.70)")
    parser.add_argument("--top-k-weak", type=int, default=3,
                        help="How many weakest dims to surface for fix prompts")
    args = parser.parse_args()

    screenshot = Path(args.screenshot).expanduser().resolve()
    if not screenshot.exists():
        print(json.dumps({"error": f"screenshot not found: {screenshot}"}))
        return 1

    if not ensure_server_running():
        print(json.dumps({"error": "design model server unavailable; "
                                    "start with start-server.sh"}))
        return 1

    try:
        result = query_server({
            "action": "evaluate",
            "input": {
                "screenshot": str(screenshot),
                "brief": args.brief or None,
            },
        })
    except Exception as e:
        print(json.dumps({"error": f"server query failed: {e}"}))
        return 1

    if "error" in result:
        print(json.dumps({"error": result["error"]}))
        return 1

    scores = result.get("scores", {})
    uncertainty = result.get("uncertainty") or {}
    overall = result.get("overall", 0.0)

    # Identify weakest dims (lowest score, excluding overall_aesthetic)
    ranked = sorted(
        ((n, s) for n, s in scores.items() if n != "overall_aesthetic"),
        key=lambda kv: kv[1],
    )[: args.top_k_weak]

    fix_prompts = []
    for name, score in ranked:
        sigma = uncertainty.get(name)
        unc_str = f" (model σ={sigma:.2f})" if isinstance(sigma, (int, float)) else ""
        hint = DIM_HINTS.get(name, "Improve this dimension.")
        fix_prompts.append(
            f"{name}={score:.2f}{unc_str}: {hint}"
        )

    output = {
        "overall": overall,
        "should_iterate": overall < args.threshold,
        "threshold": args.threshold,
        "scores": scores,
        "uncertainty": uncertainty,
        "norman": result.get("norman"),
        "weakest_dims": [{"name": n, "score": s} for n, s in ranked],
        "fix_prompts": fix_prompts,
        "model_version": result.get("model_version"),
        "inference_ms": result.get("inference_ms"),
        "brief_used": result.get("brief_used"),
    }
    print(json.dumps(output, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
