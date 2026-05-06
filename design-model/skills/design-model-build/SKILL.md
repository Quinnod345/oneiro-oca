---
name: design-model-build
description: Use this skill whenever the user asks Claude Code to build, generate, or iterate a UI/UX design and explicitly invokes the local design model — phrases like "using the design model build...", "use the design model to design...", "with the design model make...", "iterate this design with the model", or "grade my design with the model". The skill orchestrates a generate→render→grade→improve loop on the user's M4 Max: writes HTML/SwiftUI/React code, renders to PNG via Puppeteer, calls the local design model server (Phase 10 — DINOv2 + MiniLM intent encoder + 16-dim head with uncertainty) for fast scalar scoring, optionally calls the distilled VLM (Qwen2.5-VL 3B + LoRA) for structured natural-language critique, then regenerates with targeted feedback until the design crosses a quality threshold or hits the iteration cap. The model is intent-aware — passing the brief makes "music player" and "settings panel" judged by different yardsticks. End deliverable is the final code + screenshot + score trajectory.
---

# Design Model Build Skill

Use the local design model on the user's M4 Max to grade and iterate UI generations. The model is intent-aware — feed it the brief and it judges differently for different design contexts.

## When to invoke

Trigger phrases:
- "using the design model build..."
- "use the design model to design..."
- "iterate this design with the model"
- "grade my [HTML/component/page] with the model"
- "improve this design via the model"
- "build me [X] and run it through the design model"

If the user asks for a UI build *without* mentioning the model, follow the `frontend-design` skill instead. This skill kicks in only when they want the local model in the loop.

## Workflow (5 steps)

### 1. Verify the server is running

The design model lives at `/tmp/design-model-v2.sock`. The grade.py helper auto-starts it if missing, but you can also pre-warm:

```bash
python3 ~/.claude/skills/design-model-build/scripts/grade.py --help > /dev/null
# Or explicit:
bash /Users/quinnodonnell/.openclaw/workspace/oneiro-core/cognitive/design-model/start-server.sh --warmup &
```

### 2. Generate v1 of the design

Apply the design philosophy from the `frontend-design` skill (visceral/behavioral/reflective, distinctive typography, no generic AI patterns, etc.). Write the code to a file in `/tmp/design-build-{timestamp}/v1.html` (or `.swift` / `.jsx` for those targets).

Required: think **Level 5+** problem framing. Don't execute the surface task; reframe what this kind of interface means. Constraint → feature. Avoid the genericism filter (centered hero + 3 cards, purple gradients, Inter on white).

### 3. Render to PNG

For HTML:
```bash
bash ~/.claude/skills/design-model-build/scripts/render.sh \
  /tmp/design-build-XX/v1.html \
  /tmp/design-build-XX/v1.png
```

For SwiftUI / React: tell the user the model needs a screenshot — either render it yourself if you have the toolchain, or ask them to screenshot the design and pass the path.

### 4. Grade

Always pass the brief — intent conditioning matters:

```bash
python3 ~/.claude/skills/design-model-build/scripts/grade.py \
  /tmp/design-build-XX/v1.png \
  --brief "<the user's design brief, verbatim or refined>"
```

Returns JSON with:
- `overall` — aggregate score (0..1)
- `should_iterate` — true if `overall < threshold` (default 0.70)
- `scores` — per-dim scores across all 16 dimensions
- `uncertainty` — model's per-dim σ (high = model isn't sure; treat with skepticism)
- `weakest_dims` — top 3 lowest scoring dims, ranked
- `fix_prompts` — concrete, actionable text per weak dim that you can paste into the next iteration

### 5. Iterate or deliver

If `should_iterate` is true:
- Read each `fix_prompts` entry — these are surgically targeted at the weakest dims
- Generate v2 addressing those specific weaknesses (don't rewrite from scratch — refine)
- Re-render and re-grade
- **Cap at 3 iterations.** Past 3 the model's uncertainty creeps in and you're chasing noise.

If you want a deeper structural read at any point — e.g., the fast model says 0.55 overall but you want a "WHY" before the next iteration — call the distilled VLM:

```bash
python3 ~/.claude/skills/design-model-build/scripts/explain.py \
  /tmp/design-build-XX/v1.png \
  --brief "<brief>"
```

Returns parsed `strengths`, `weaknesses`, `intent_fit`, `norman_balance`, and impact-ordered `fix_priorities`. ~17s warm — use it once or twice in a session, not on every iteration.

When delivering:
- Show the user the final code (the `.html`/`.swift`/`.jsx`)
- Show the final screenshot path
- Show the score trajectory (e.g., "v1 0.62 → v2 0.71 → v3 0.78")
- Note the model's confidence: if uncertainty on key dims is >0.12, mention it — that means the model isn't sure either and human review is warranted

## Output format

Final answer to user should include:
1. Path to final code file
2. Path to final screenshot
3. Score table (16 dims, marked with ↑/↓ vs prior iteration when applicable)
4. One-line summary of what changed across iterations
5. If applicable, the distilled VLM's `intent_fit` line — that's the most concise signal whether the design solves the brief

## Tips

- **Pass the brief verbatim** when grading — the model was trained to condition on intent, so "music player" and "settings panel" should produce different score distributions for the same image
- **Iterate on weakest dims first** — innovation/distinctiveness/system_creativity have higher MAE in the model so improvements there register more strongly than typography micro-tweaks
- **Trust the score trajectory more than a single number** — variance per run is small but absolute scores can drift; a 0.05+ jump v1→v2 on the same dim is real signal
- **Ignore overall_aesthetic if individual dims are good** — the coherence penalty in the loss can mask quality. If 12/16 dims are 0.75+, the design is good even if overall says 0.65
- **The model is fast: ~45-360ms per call** — running 3 iterations is ~1-2 sec of model time; the bottleneck is generation
