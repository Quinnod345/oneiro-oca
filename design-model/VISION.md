# The Design Model — Project Vision

> *"Beautiful apps don't try to be beautiful — they become beautiful through ruthless focus on solving real problems with thoughtful, native design. Beauty emerges from depth of care and constraint-driven thinking, not from decoration."*

## The Goal

Build a local, standalone design evaluation model that grows from a 58K-parameter JS MLP into a 100M+ parameter vision model — trained on the M4 Max, usable by any agent, and integrated into Oneiro's cognitive architecture as its aesthetic soul.

This model doesn't just score designs. It **feels** them. It channels emotion into design decisions. It iterates on its own design skill until the skill produces work that evokes real human emotion. It aspires to the craft of Alcove, Klack, NotchNook, Things 3 — apps where every pixel is intentional and the experience makes people *feel something*.

---

## The Three Pillars

### 1. The Model (the brain)

A scalable neural network that evaluates design quality across 16 dimensions:

| Dimension | What It Measures |
|-----------|-----------------|
| typography_quality | Font choices, pairing, scale, spacing |
| color_harmony | Palette cohesion, emotional resonance, contrast |
| spatial_composition | Layout, whitespace, grid, visual flow |
| motion_elegance | Animation quality and purposefulness |
| emotional_resonance | How effectively the design evokes intended emotions |
| craft_visibility | Painstaking care visible in every detail |
| minimalism_coherence | Appropriate restraint, progressive disclosure |
| native_integration | How naturally it fits the platform ecosystem |
| visceral_score | Norman L1: immediate aesthetic reaction |
| behavioral_score | Norman L2: usability and interaction quality |
| reflective_score | Norman L3: meaning, identity, emotional bond |
| overall_aesthetic | The gestalt — everything working together |
| **innovation_score** | Novel approach, unexpected solutions |
| **system_creativity** | Creative system connections (constraint→feature) |
| **design_distinctiveness** | Unique visual identity vs generic templates |
| **problem_level** | Seven Levels (1=execute → 7=paradigm shift) |

**Growth path:**

| Phase | Architecture | Params | Status |
|-------|-------------|--------|--------|
| 1 | JS MLP (64→256→128→64→16) + auto-expansion | 58K → 1M+ | **DONE** |
| 2a | MLX CNN backbone + SpatialAttention + DesignHead | 17.2M | **DONE** (overfits with small data) |
| 2b | MobileNet V2 backbone (pretrained, frozen) + DesignHead | 675K trainable | **DONE** — val loss 0.0095 |
| 3 | Progressive Expert Network (8 expert columns) | 7.55M | **DONE** — 8 experts including innovation |
| 4 | Self-training loop + comparative preference model | Unlimited | **IN PROGRESS** — flywheel built, preference training ready |
| 5 | v5 trunk + critique-embedding aux head | 2.40M | **ACTIVE** — backfilled 161 critique JSONs for older opus_self_train manifest entries via Opus image grading; 178/452 manifest samples now have matched critique embeddings (was 0). Aux head auto-enables at MIN_AUX_SAMPLES=20. Best aux_weight=0.02 (default 0.1 overweighted the 3072-dim aux loss vs 16-dim score regression). |
| 6 | Heteroscedastic uncertainty head (Gaussian NLL on per-dim mean+log_var) | +16K | **DONE** — val 0.0252 → 0.0234 |
| 7 | Real backbone fine-tune: MobileNet `features[18]` (BN-folded 1×1 conv 320→1280) trainable in MLX. Architecture is implemented and the module is always present in v7's saved checkpoint, but **fine-tuning is disabled by default** — ablation showed it overfits at our current 385-train-sample size and regresses visual-craft dims. Re-enable via `--enable-backbone` once train pool > ~1000 samples. | +414K (frozen) | **IMPLEMENTED, gated** |
| 8 | Per-dim Bradley-Terry preference head trained on **2023** pairs (23 real flywheel + 2000 synthesized from manifest score margins, leak-free w.r.t. val split) | +1K | **DONE** — drove val 0.0234 → 0.0206 alone, the actual win behind Phases 7+8 |

### 2. The Emotion Bridge (the heart)

The model doesn't operate in a vacuum. When integrated with Cognitive:

- **Curiosity** → experimental typography, unexpected layouts
- **Competence** → pixel-perfect craft, refined spacing
- **Awe** → aspiration level for craft quality
- **Frustration** → triggers design iteration
- **Joy** → celebration micro-interactions

Emotion flows into design policy → design policy guides generation → generation is scored → scores feed back into emotion. A closed loop where feeling drives creation.

### 3. The Skill Evolver (the hands)

The `/frontend-design` skill is the system's design knowledge — its accumulated wisdom about how to create beautiful things. The evolver:

1. Reads the skill
2. Identifies its weakest dimensions (via model scores)
3. Researches techniques to improve those dimensions
4. Proposes amendments, tests them, keeps what works
5. The skill gets better with every iteration

The skill is the bridge between the model (which evaluates) and the agent (which creates). Better skill → better artifacts → better training data → better model → better evaluation → better skill. Flywheel.

---

## Design Philosophy (what the model learns to recognize)

### Norman's Three Levels
- **Visceral**: Does it look and feel beautiful at first glance? (35% weight)
- **Behavioral**: Does it work flawlessly? (30% weight)  
- **Reflective**: Does it mean something? Would you be proud to use it? (35% weight)

### The Seven Levels of Design
Most apps solve at Level 1-2 (direct solution, better execution). Beautiful apps solve at Level 5+ — they redefine the problem. NotchNook didn't fix the notch; it made the notch *useful*. Klack didn't improve typing; it made typing *joyful*.

### Mac Native Craft
The reference standard: constraint-embracing, minimalism with sophistication, micro-detail philosophy, performance as design, timeless aesthetics, craft as value. Apps like Things 3 won Apple Design Awards by treating every pixel as intentional.

### Anti-Patterns (what the model learns to reject)
- Generic AI aesthetics (centered hero + 3 cards + gradient)
- Convergent font choices (Inter, Roboto, Space Grotesk)
- Cliched colors (purple gradient on white)
- Framework defaults (unmodified Tailwind/Bootstrap)
- Decoration without purpose

---

## Reference Apps (the aspirations)

| App | Why It Matters |
|-----|---------------|
| **Things 3** | Two Apple Design Awards. Timeless minimalism. Every pixel deliberate. |
| **Alcove** | 100% Swift native. Whispers Apple quality. Dynamic Island on macOS. |
| **Klack** | Sound design as UX. Rebuilt from Electron to native for performance. |
| **NotchNook** | Constraint → feature. Hardware-software harmony. |
| **Bear** | Typography-first. Writing UX perfection. Theme system. |
| **Fantastical** | Liquid Glass. Visual hierarchy. Widget mastery. |
| **Craft** | Platform respect. Keyboard-first. Premium without excess. |
| **Linear** | Sharp minimalism. Modular components. Human warmth in UI. |

---

## Current State

### What Exists

```
design-model/
├── CORE LOOP (Python, uses Anthropic API directly)
│   ├── self_train.py     ✅ Sonnet generates → Opus grades → model trains (THE LOOP)
│   ├── builder.py        ✅ Build specific designs with iterative improvement
│   └── start-server.sh   ✅ Inference server process management
│
├── MODEL
│   ├── model.js          ✅ Phase 1 JS MLP (58K params)
│   ├── encoder.js        ✅ 64-dim code features + innovation signal detection
│   ├── knowledge.js      ✅ 16-dim design knowledge base (12 core + 4 innovation)
│   └── suggest.js        ✅ Generative design — proposes specific CSS changes
│
├── EVALUATION
│   ├── evaluate.js       ✅ Standalone API — routes through inference server with MLP fallback
│   ├── client.js         ✅ Node.js client for Python inference server
│   └── server.js         ✅ Unix socket server (MLP fallback)
│
├── TRAINING
│   ├── trainer.js        ✅ LLM-judge + comparative + self-play training
│   ├── skill-evolver.js  ✅ Skill iteration loop (uses Phase 2b scoring + screenshots)
│   ├── screenshot-capture.js ✅ Puppeteer HTML→PNG utility
│   └── flywheel.js       ✅ JS flywheel (superseded by self_train.py)
│
├── DATA COLLECTION
│   ├── scrape-designs.js  ✅ Site scraper (HTML/CSS/JS + screenshots, 74 sites)
│   ├── scrape-galleries.js ✅ Design gallery scraper (55 screenshots)
│   └── grading-server.js  ✅ Human grading interface (localhost:3456)
│
├── MLX (Python, M4 Max GPU)
│   ├── model_v3.py       ✅ Phase 3: 8 expert columns + lateral attention + aggregator (7.55M)
│   ├── train_v2.py       ✅ Phase 2b training (coherence loss, confidence weighting)
│   ├── train_v3.py       ✅ Phase 3 progressive training (4 stages)
│   ├── train_preference.py ✅ Bradley-Terry preference training
│   ├── inference_server.py ✅ Phase 2b/3 inference server (auto-detects best model)
│   ├── extract_features.py ✅ MobileNet V2 feature extraction
│   └── export_coreml.py  ✅ ONNX export (Core ML needs Python 3.12)
│
├── weights/              ✅ Phase 1 MLP, Phase 2b head, Phase 3 experts, MobileNet backbone
├── data/                 ✅ 245+ samples, comparisons, flywheel state, self-train state
└── exports/              ✅ ONNX model (7.6KB + 2.7MB weights)

design/
└── emotion-bridge.js     ✅ PADCN/drives → design policy (19-dim output)

OCA Integration:
├── neural-bus.js         ✅ Design layer (16-dim, TOTAL_DIM=224)
├── cognitive-loop.js     ✅ Core drive: "Build beautiful Mac applications" (weight 0.90)
├── thinker-bridge.js     ✅ Design philosophy + "build" action → calls builder.py
├── executive/engine.js   ✅ "designing" attention mode
├── index.js              ✅ design.{evaluate, suggest, build, computePolicy, evolveSkill, ...}
└── migrations/014        ✅ DB tables for evaluations, skill versions, training data
```

### The Self-Training Loop (the real engine)

`self_train.py` — Sonnet generates → Opus grades → MLP trains. No human needed.
- Uses Anthropic API directly (from .env key). No CLI hangs.
- 20 creative briefs (knowledge gardens, crystal calendars, sound landscapes, etc.)
- Opus is HARSH — scores 0.4-0.6 for mediocre work, 0.2 for generic slop
- Retrains the Phase 2b head every 10 cycles (~7 seconds)
- Each cycle: ~60s generation + ~12s grading = ~72s per sample

`builder.py` — Build a specific design with iterative improvement.
- Sonnet generates → Opus grades + suggests fixes → iterate → deliver
- Trajectory climbs: 0.45 → 0.50 → 0.60 (each iteration improves)
- OCA thinker bridge calls this when it decides to build something

### What's Done

- ✅ All 4 phases of model architecture (MLP → CNN → MobileNet → Expert Columns)
- ✅ Self-training loop running via API (Sonnet generates, Opus grades)
- ✅ Builder with iterative improvement (generate → grade → fix → repeat)
- ✅ OCA integration — thinker can invoke builds, design layer in neural bus
- ✅ Skill evolution — /frontend-design SKILL.md evolves based on model scores
- ✅ 16-dimension scoring including 4 innovation dimensions
- ✅ Coherence loss — penalizes parts that don't work together
- ✅ 245+ training samples (scraped sites, galleries, flywheel, self-train)
- ✅ ONNX export for portability
- ✅ Scheduled flywheel task (weekdays 9am)
- ✅ Generative design — suggest.js proposes specific CSS changes

### What's Next

**SCALE THE SELF-TRAINING LOOP**
- Run `python3 self_train.py --cycles 500` to build a large Opus-graded dataset
- The model gets better as it sees more Opus judgments
- Target: 1000+ Opus-graded samples, sub-0.05 MAE on all 16 dimensions
- Opus's coherence-aware grading teaches dimension RELATIONSHIPS, not just individual scores

**NATIVE SWIFT APPS**
- Complete the swift-renderer.js stub → real SwiftUI compilation + screenshot
- builder.py generates SwiftUI code instead of HTML
- Evaluate actual native Mac apps, not just web previews
- Target: Cognitive builds and ships a real Mac app from scratch

**DEEPER MODEL ARCHITECTURE**
- Phase 5: Train on Opus's critiques as text, not just scores
- The critique "great typography but clashes with the palette" teaches more than scores alone
- NLP embedding of critique → additional training signal
- Model learns WHY things work or don't, not just WHAT scores to give

**THE REAL GOAL**
- Cognitive sees a design problem
- Emotion state shapes creative direction (curious → experimental, proud → refined)
- Builder generates code, evaluates, iterates autonomously
- Model judges quality with Opus-calibrated taste
- Skill evolves based on what works
- The whole system gets better every day without anyone touching it

---

## Principles

1. **The model serves the user, not the architecture.** Any Claude Code agent should be able to call `evaluateDesign()` and get useful feedback. OCA integration is a bonus, not a requirement.

2. **Emotion drives design.** The model doesn't just score — it channels feeling into creation. When Cognitive is curious, it experiments. When it's proud, it refines.

3. **Always iterating.** The skill evolver, the self-training loop, the comparative preference model — every component is designed to get better over time. The system never stops improving.

4. **Hardware is an asset.** The M4 Max has 40 GPU cores and 546 GB/s memory bandwidth. We use it. bfloat16, large batches, unified memory, zero transfer overhead.

5. **Growth without bounds.** The architecture doesn't have a ceiling. Phase 1 → Phase 2 → Phase 3 → Phase 4 → add experts → add sub-experts. The model grows as data grows.
