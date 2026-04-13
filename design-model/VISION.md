# The Design Model — Project Vision

> *"Beautiful apps don't try to be beautiful — they become beautiful through ruthless focus on solving real problems with thoughtful, native design. Beauty emerges from depth of care and constraint-driven thinking, not from decoration."*

## The Goal

Build a local, standalone design evaluation model that grows from a 58K-parameter JS MLP into a 100M+ parameter vision model — trained on the M4 Max, usable by any agent, and integrated into Oneiro's cognitive architecture as its aesthetic soul.

This model doesn't just score designs. It **feels** them. It channels emotion into design decisions. It iterates on its own design skill until the skill produces work that evokes real human emotion. It aspires to the craft of Alcove, Klack, NotchNook, Things 3 — apps where every pixel is intentional and the experience makes people *feel something*.

---

## The Three Pillars

### 1. The Model (the brain)

A scalable neural network that evaluates design quality across 12 dimensions:

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

**Growth path:**

| Phase | Architecture | Params | Status |
|-------|-------------|--------|--------|
| 1 | JS MLP (64→256→128→64→12) + auto-expansion | 58K → 1M+ | **DONE** |
| 2a | MLX CNN backbone + SpatialAttention + DesignHead | 17.2M | **DONE** (needs training data) |
| 2b | MobileNet V2 backbone (pretrained, frozen) + DesignHead | ~5M trainable | Planned |
| 3 | Progressive Expert Network (7 expert columns) | 50-100M | Planned |
| 4 | Self-training loop + comparative preference model | Unlimited | Planned |

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
├── encoder.js         ✅ 64-dim code feature extraction
├── trainer.js         ✅ LLM-judge + comparative + self-play training
├── evaluate.js        ✅ Standalone evaluation API
├── server.js          ✅ Unix socket server
├── knowledge.js       ✅ Design research knowledge base
├── skill-evolver.js   ✅ Skill iteration loop
├── weights/
│   ├── model-v1-latest.json       ✅ JS MLP weights (untrained)
│   └── mlx-design-v1.safetensors  ✅ MLX model weights (untrained)
├── data/
│   └── manifest.json              ⬜ Empty — needs training data
├── mlx/
│   ├── model.py       ✅ 17.2M param CNN + attention (9.9ms inference)
│   ├── data.py        ✅ Dataset management + augmentation
│   ├── train.py       ✅ Full GPU training pipeline
│   ├── serve.py       ✅ MLX GPU inference server
│   └── export.py      ✅ ONNX + Core ML export
└── exports/           ⬜ Empty — no exports yet

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

### What's Next

**IN PROGRESS: Training Data Collection** (started 2026-04-12)
Data pipeline is live — `collect-data.js` generates design artifacts via Claude, scores them across 12 dimensions with LLM-as-judge, and saves to `data/manifest.json`. First batch of 18 samples (high/medium/low quality) generating now.

Training scripts ready:
- `train-js.js` — trains Phase 1 JS MLP on collected data
- `mlx/train.py` — trains Phase 2a MLX CNN on M4 Max GPU

**NEXT: First Training Run**
Once we have 18+ samples from current batch:
- Train JS MLP (Phase 1) for immediate model feedback
- Add reference app screenshots (Things 3, Alcove, Bear screenshots from web)
- Generate more data (50-100 samples target)
- Train MLX CNN (Phase 2a) on M4 Max GPU
- Validate that scores correlate with human judgment

**THEN: Progressive Growth**
- Begin skill evolution loop (model scores → skill improvement → better artifacts)
- Phase 2b: MobileNet V2 pretrained backbone (transfer learning, ~5M trainable params)
- Phase 3: Expert columns (typography expert, color expert, etc., 50-100M params)
- Phase 4: Self-training loop + comparative preference model (RLHF for design)
- Core ML export for Neural Engine inference on macOS/iOS

---

## Principles

1. **The model serves the user, not the architecture.** Any Claude Code agent should be able to call `evaluateDesign()` and get useful feedback. OCA integration is a bonus, not a requirement.

2. **Emotion drives design.** The model doesn't just score — it channels feeling into creation. When Cognitive is curious, it experiments. When it's proud, it refines.

3. **Always iterating.** The skill evolver, the self-training loop, the comparative preference model — every component is designed to get better over time. The system never stops improving.

4. **Hardware is an asset.** The M4 Max has 40 GPU cores and 546 GB/s memory bandwidth. We use it. bfloat16, large batches, unified memory, zero transfer overhead.

5. **Growth without bounds.** The architecture doesn't have a ceiling. Phase 1 → Phase 2 → Phase 3 → Phase 4 → add experts → add sub-experts. The model grows as data grows.
