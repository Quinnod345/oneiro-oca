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
├── model.js           ✅ Phase 1 JS MLP (58K params, auto-expanding)
├── encoder.js         ✅ 64-dim code features + innovation signal detection
├── evaluate.js        ✅ Standalone API — routes through Phase 2b/3 server with fallback
├── client.js          ✅ Node.js Unix socket client for Python server
├── server.js          ✅ Unix socket server (JS MLP fallback)
├── knowledge.js       ✅ 16-dim design knowledge base (12 core + 4 innovation)
├── trainer.js         ✅ LLM-judge + comparative + self-play training
├── skill-evolver.js   ✅ Skill iteration loop
├── flywheel.js        ✅ Self-improvement orchestrator (build→score→iterate→retrain)
├── run-flywheel.js    ✅ CLI flywheel runner
├── grading-server.js  ✅ Human grading web interface (localhost:3456)
├── screenshot-capture.js ✅ Puppeteer HTML→PNG utility
├── scrape-designs.js  ✅ Real-world site scraper (HTML/CSS/JS + screenshots)
├── scrape-galleries.js ✅ Design gallery scraper (30+ sites)
├── generate-human-quality.js ✅ Innovative AI design generator
├── backfill-innovation.js ✅ Innovation score back-filler
├── start-server.sh    ✅ Inference server process management
├── grading-ui/        ✅ Quick/detailed grading, compare, stats views
├── weights/
│   ├── model-v1-latest.json        ✅ JS MLP weights
│   ├── design-head-v2.safetensors  ✅ Phase 2b head (675K, val loss 0.0095)
│   ├── design-expert-v3.safetensors ✅ Phase 3 experts (7.55M, 8 experts)
│   └── mobilenet_v2_imagenet.safetensors ✅ Frozen backbone (2.26M)
├── data/
│   ├── manifest.json              ✅ 193 samples (ALL human-graded)
│   ├── comparisons.json           ✅ 8 human preference pairs
│   ├── flywheel-state.json        ✅ Flywheel state tracking
│   ├── screenshots/               ✅ 18 HTML artifacts
│   ├── pngs/                      ✅ 18 rendered PNGs
│   ├── real-world/                ✅ 25 real-world screenshots
│   ├── scraped/                   ✅ 74 scraped (full HTML/CSS/JS)
│   ├── galleries/                 ✅ 55 gallery screenshots
│   └── human-quality/             ✅ 6 innovative AI designs
├── mlx/
│   ├── model.py       ✅ Phase 2a CNN (17.2M)
│   ├── model_v2.py    ✅ Phase 2b MobileNet + head
│   ├── model_v3.py    ✅ Phase 3: 8 expert columns + lateral attention + aggregator
│   ├── data.py        ✅ Dataset (16-dim, confidence weighting)
│   ├── train.py       ✅ Phase 2a training
│   ├── train_v2.py    ✅ Phase 2b training (coherence loss)
│   ├── train_v3.py    ✅ Phase 3 progressive training (4 stages)
│   ├── train_preference.py ✅ Bradley-Terry preference training
│   ├── inference_server.py ✅ Phase 2b/3 inference server (auto-detects best model)
│   ├── extract_features.py ✅ MobileNet feature extraction
│   └── export.py      ⬜ ONNX + Core ML (untested)
└── design/
    └── emotion-bridge.js  ✅ PADCN/drives → design policy

design/
└── emotion-bridge.js  ✅ PADCN/drives → design policy

OCA Integration:
├── neural-bus.js      ✅ Design layer (16-dim, TOTAL_DIM=224)
├── neural-mlp.js      ✅ Design loss weight 1.2
├── neural-encoders.js ✅ encodeDesign() function
├── cognitive-loop.js  ✅ Core drive (weight 0.90)
├── thinker-bridge.js  ✅ Design philosophy in system prompt
├── executive/engine.js ✅ Designing attention mode
├── index.js           ✅ Design subsystem exported
└── migrations/014     ✅ DB tables defined
```

### Training Results (2026-04-13)

**Phase 1: JS MLP (58K params)**
- 2,881 total weight updates across 50+ epochs
- Running loss: 0.039
- Per-dimension error: 0.12-0.18 (code features only, no vision)
- Sample predictions: 9/12 dimensions within 0.1 of target

**Phase 2a: MLX CNN (17.2M params)**
- Trained from scratch on M4 Max GPU
- 58 samples, val loss 0.020
- Overfits with small data — needs pretrained backbone for discrimination

**Phase 2b: Pretrained MobileNet V2 + Design Head (675K trainable) — WORKING**
- MobileNet V2 backbone: frozen ImageNet features (pre-extracted, 1280-dim)
- Trainable design head: 675K params (384→256→128→64→12)
- **132 samples** (33 synthetic + 25 old real-world + 74 scraped), 113 train / 19 val
- **Best validation loss: 0.0035** (epoch 109 of 169)
- Training time: **~7 seconds total** (~40ms/epoch)
- **Tiered quality discrimination:**
  - Exceptional (Apple, Stripe, Linear): predicts 0.91+ 
  - Excellent (Supabase, Raycast, Framer): predicts 0.86-0.91
  - Good (Notion, Todoist, Cal.com): predicts 0.80-0.85
  - High synthetic: predicts 0.69-0.80
  - Medium synthetic: predicts 0.63-0.76
  - Low synthetic: predicts 0.06-0.07
- Per-dimension MAE at best:
  - typography: 0.038 | color: 0.036 | spatial: 0.045
  - motion: 0.056 | emotion: 0.042 | craft: 0.051
  - minimal: 0.039 | native: 0.076 | visceral: 0.042
  - behavioral: 0.031 | reflective: 0.044 | overall: 0.035

**Data Sources (46 real-world sites scraped with full HTML/CSS/JS):**
Apple (Home, iPhone, Watch, AirPods, Developer), Stripe, Stripe Press,
Linear, Vercel, Supabase, Resend, Clerk, Railway, PlanetScale, Neon,
Arc, Browser Company, Things 3, Bear, Craft, Raycast, Screen Studio,
Pixelmator, Fantastical, Klack, CleanShot, Spark Mail,
Figma, Framer, Spline, Rive, LottieFiles,
Notion, Todoist, Height, Amie, Cron,
Awwwards, Lusion, Basement Studio,
Pitch, Cal.com, Dub, Mintlify, Airbnb, Spotify Design

### What's Done

- ✅ Skill evolution loop — activated, v1 applied (innovation +0.166, overall 0.748→0.777)
- ✅ OCA cognitive loop — index.js wired with `initServer()`, evaluate.js routes through Phase 2b/3
- ✅ Overnight autonomous loop — 25 flywheel cycles, 50 samples, 3 retrains (val loss 0.0108)
- ✅ Human grading UI — 193 designs graded with notes and coherence scores
- ✅ 243 total training samples across 5 sources

### What's Next

**IMMEDIATE: Core ML Export**
- Export Phase 2b DesignHead to Core ML format for Neural Engine inference
- Target: <1ms inference on macOS/iOS Neural Engine
- This makes the model usable inside real Swift/SwiftUI apps
- Export ONNX as intermediate format, then convert to Core ML via coremltools

**NEXT: Scheduled Self-Training**
- Create a scheduled task that runs the flywheel + retrain periodically
- Target: 5 flywheel cycles daily, retrain weekly
- Human grades from the grading UI flow in continuously
- Scale to 1000+ samples over time

**THEN: Multi-Modal Input**
- Evaluate RUNNING apps, not just static screenshots
- Screen recording → frame extraction → temporal design evaluation
- Evaluate motion/animation quality from video (currently scored from static image)
- Evaluate interaction flows, not just single screens

**FUTURE: Generative Design**
- The model doesn't just evaluate — it PROPOSES specific design changes
- "This sidebar would benefit from 8px more padding and a softer border-radius"
- "The color temperature clashes — shift the accent 15deg warmer in oklch"
- Gradient from evaluation → suggestion → specific CSS diff
- Target: 1000+ human-graded samples, sub-0.05 MAE on all 16 dimensions

---

## Principles

1. **The model serves the user, not the architecture.** Any Claude Code agent should be able to call `evaluateDesign()` and get useful feedback. OCA integration is a bonus, not a requirement.

2. **Emotion drives design.** The model doesn't just score — it channels feeling into creation. When Cognitive is curious, it experiments. When it's proud, it refines.

3. **Always iterating.** The skill evolver, the self-training loop, the comparative preference model — every component is designed to get better over time. The system never stops improving.

4. **Hardware is an asset.** The M4 Max has 40 GPU cores and 546 GB/s memory bandwidth. We use it. bfloat16, large batches, unified memory, zero transfer overhead.

5. **Growth without bounds.** The architecture doesn't have a ceiling. Phase 1 → Phase 2 → Phase 3 → Phase 4 → add experts → add sub-experts. The model grows as data grows.
