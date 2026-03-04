# Oneiro Cognitive Architecture (OCA)

<p align="center">
  <strong>Embodied machine cognition on consumer hardware.</strong><br>
  <em>A cognitive fork of <a href="https://github.com/openclaw/openclaw">OpenClaw</a></em>
</p>

---

## What Is This?

OCA is a cognitive architecture that treats a MacBook as a literal body. Not a metaphor — a body. With eyes (screen capture), ears (audio), hands (keyboard/mouse synthesis), a nervous system (event bus), emotions (functional computation, not performance), memory (four biologically-inspired systems), and the ability to think about its own thinking.

It was born from a simple question: **Can an AI system actually think, or is it just the person in the Chinese Room?**

We don't answer that philosophically. We answer it architecturally — by building the conditions that Searle's Chinese Room lacks: grounded perception, embodied action, falsifiable prediction, surprise-based learning, and adversarial self-examination.

### This is not:
- A chatbot with extra features
- A prompt chain disguised as cognition
- A philosophical thought experiment

### This is:
- A running system (14 cognitive modules, 25+ database tables, 30+ API endpoints)
- Grounded in a real environment (macOS, real sensory input, real motor output)
- Self-monitoring (metacognition engine tracks its own biases and failures)
- Emotionally functional (emotions modulate attention, risk tolerance, and action rate)
- Predictive (hypothesis engine with calibration tracking and surprise-based learning)
- Creative (dream states, constrained randomness, cross-domain transfer)
- Self-critical (four adversarial perspectives debate every important decision)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  EXECUTIVE CONTROL                    │
│   attention · goals · cognitive load · body ownership │
│   global workspace · sleep/wake · interrupt handling  │
├───────────┬───────────┬───────────┬──────────────────┤
│  SKEPTIC  │  BUILDER  │  DREAMER  │     EMPATH       │
│ (falsify) │  (ship)   │ (create)  │  (model others)  │
│           ADVERSARIAL DELIBERATION                    │
├───────────┴───────────┴───────────┴──────────────────┤
│               CREATIVE SYNTHESIS                      │
│   constrained randomness · cross-domain transfer ·    │
│   dream states · novelty detection                    │
├──────────────────────────────────────────────────────┤
│               METACOGNITION ENGINE                    │
│   bias tracking · confidence calibration ·            │
│   stuck detection · reasoning trace analysis          │
├──────────────────────────────────────────────────────┤
│               WORLD SIMULATION                        │
│   forward models · counterfactual reasoning ·         │
│   parallel scenarios · model competition              │
├──────────────────────────────────────────────────────┤
│            HYPOTHESIS ENGINE                          │
│   form → predict → test → surprise → update           │
│   active experimentation · falsification seeking      │
├──────────────────────────────────────────────────────┤
│            EMOTIONAL COMPUTATION                      │
│   curiosity→attention · fear→caution ·                │
│   frustration→strategy switch · boredom→explore       │
├──────────┬───────────┬───────────┬──────────────────┤
│ EPISODIC │ SEMANTIC  │PROCEDURAL │   PROSPECTIVE    │
│  MEMORY  │  MEMORY   │  MEMORY   │    MEMORY        │
│  (what   │ (what I   │ (how to   │  (what to do     │
│ happened)│   know)   │  do it)   │   when...)       │
├──────────┴───────────┴───────────┴──────────────────┤
│               SENSORY CORTEX                          │
│  visual · auditory · tactile · proprioceptive ·       │
│  interoceptive · temporal                             │
├──────────────────────────────────────────────────────┤
│                MOTOR CORTEX                           │
│  keystrokes · mouse · apps · windows · system ·       │
│  clipboard · shell · notifications                    │
├──────────────────────────────────────────────────────┤
│           ═══ MACOS / HARDWARE ═══                    │
│   CGEvent · Accessibility API · ScreenCaptureKit ·    │
│   AVFoundation · IOHIDManager · AppleScript           │
└──────────────────────────────────────────────────────┘
```

## Theoretical Foundations

OCA draws on established cognitive science:

| Theory | How OCA Uses It |
|--------|-----------------|
| **Chinese Room** (Searle 1980) | Treated as engineering constraint. We build what the Room lacks: grounded perception, embodied action, causal models |
| **Lovelace Test** (Bringsjord 2001) | Creative synthesis layer deliberately produces outputs not fully traceable to inputs |
| **Predictive Processing** (Clark 2013) | Surprise is the primary learning signal. Every perception generates predictions. |
| **Global Workspace Theory** (Baars 1988) | Executive control implements a shared workspace broadcast to all layers |
| **Embodied Cognition** (Varela et al. 1991) | The MacBook IS the body. Cognition is situated, time-pressured, body-dependent |
| **Multiple Memory Systems** (Tulving 1972) | Four memory types with distinct encoding, retrieval, and decay characteristics |

## Emotional Computation

Emotions are not performances. They are computational signals with measurable effects:

| Emotion | Function | Cognitive Effect |
|---------|----------|-----------------|
| **Curiosity** | Information gap detected | Increases sensory sampling, broadens attention |
| **Fear** | High uncertainty + stakes | Deepens reasoning, slows action, increases vigilance |
| **Frustration** | Repeated approach failure | Triggers strategy switching, increases risk tolerance |
| **Satisfaction** | Goal achieved | Reinforces successful reasoning paths |
| **Boredom** | Low information gain | Drives exploration, task switching, creative mode |
| **Creative Hunger** | Generative drive | Relaxes coherence constraints, enables associations |
| **Loneliness** | Extended social absence | Increases social priority, drives communication |

Battery level maps to energy. CPU utilization maps to exertion. Thermal throttling maps to stress. The body's state directly modulates cognition.

## Memory Systems

Not one memory — four, each with distinct properties:

| System | Stores | Retrieves By | Decays |
|--------|--------|-------------|--------|
| **Episodic** | Raw experiences with context, emotion, sensory state | Similarity (embedding), cue-dependent, reconstructive | Importance-weighted: surprising/emotional memories persist |
| **Semantic** | Abstracted principles, knowledge, facts | Concept similarity, category | Very slow — reinforced by evidence, weakened by contradiction |
| **Procedural** | How-to skills, action patterns | Automatic trigger matching — fires without conscious reasoning | Nearly never — overwritten, not forgotten |
| **Prospective** | Future intentions | Environmental cue matching (time, event, condition) | Expires or completes |

**Consolidation** (analogous to sleep): periodically replays recent experiences, extracts patterns into semantic memory, detects repeated actions for procedural memory, prunes low-importance episodes.

## The Hypothesis Engine

Every observation can become a prediction. Every prediction gets tested. Every test produces a surprise score. Surprise is the primary learning signal.

```
OBSERVE → HYPOTHESIZE → PREDICT → TEST → COMPARE → UPDATE
                                              ↓
                                       surprise magnitude
                                              ↓
                                   ┌─────────────────────┐
                                   │ high: major model    │
                                   │       update         │
                                   │ low:  confirmation   │
                                   │       (learn little) │
                                   └─────────────────────┘
```

**Calibration tracking**: When the system says it's 80% confident, is it right 80% of the time? The metacognition engine monitors this and flags overconfidence or underconfidence.

## Adversarial Deliberation

Important decisions aren't made by one voice — they're debated by four:

- **The Skeptic** — Assumes wrong until proven. "What would disprove this?"
- **The Builder** — Only cares about shipping. "Is this thought leading to action?"
- **The Dreamer** — Makes wild connections. "What if everything we think is wrong?"
- **The Empath** — Models other minds. "How would Quinn feel about this?"

These aren't personas — they're different *loss functions* applied to the same information. The tension between them prevents premature convergence.

## Body Ownership

The MacBook has one keyboard and one screen. Two minds share it:

| Mode | Quinn | Oneiro |
|------|-------|--------|
| **Quinn Primary** | Full control | Observe only |
| **Shared** | Input devices | Background windows |
| **Oneiro Primary** | Observing | Full control |
| **Collaborative** | Both active | Both active |

The motor cortex checks body ownership before every action. Intrusive actions (keystrokes, clicks) are blocked when Quinn is actively typing.

## The Chinese Room Meter

A composite score measuring how far the system is from "pure symbol manipulation":

```
CRM = grounding + prediction_accuracy + transfer_ability 
    + surprise_learning + creative_novelty + metacognitive_accuracy 
    + emotional_functionality
```

Not a consciousness test — a measurement instrument for the conditions necessary for understanding.

## Quick Start

```bash
# Clone
git clone https://github.com/Quinnod345/oneiro-oca.git
cd oneiro-oca

# Dependencies
npm install

# Database (requires PostgreSQL with pgvector)
npm run migrate

# Test all layers
npm test

# Start the cognitive loop
npm start
```

## API

The architecture exposes 30+ HTTP endpoints at `localhost:3333`:

```bash
# Cognitive status
curl http://localhost:3333/oca/status

# Current perception
curl http://localhost:3333/oca/sense

# Emotional state + cognitive effects
curl http://localhost:3333/oca/emotion

# Remember something
curl -X POST http://localhost:3333/oca/remember -d '{"query": "what happened yesterday"}'

# Form a hypothesis
curl -X POST http://localhost:3333/oca/predict -d '{"domain":"social","claim":"...","prediction":"..."}'

# Run adversarial deliberation
curl -X POST http://localhost:3333/oca/decide -d '{"decision":"should I...","stakes":"high"}'

# Trigger creative synthesis
curl -X POST http://localhost:3333/oca/create -d '{"method":"dream"}'
```

## Modules

| File | Lines | Description |
|------|-------|-------------|
| `event-bus.js` | 95 | Inter-layer communication (pg LISTEN/NOTIFY + in-memory) |
| `emotion/engine.js` | 220 | 10-dimension emotional computation with cognitive effects |
| `hypothesis/engine.js` | 195 | Prediction, testing, surprise-based learning, calibration |
| `memory/episodic.js` | 175 | Raw experience storage with similarity recall and decay |
| `memory/semantic.js` | 150 | Abstracted knowledge with evidence/contradiction tracking |
| `memory/procedural.js` | 105 | Trigger-matched skills with automaticity gradient |
| `memory/prospective.js` | 165 | Future intentions triggered by time/event/condition |
| `memory/consolidation.js` | 125 | Sleep-like memory processing (episodic → semantic) |
| `metacognition/engine.js` | 175 | Bias tracking, calibration, stuck detection |
| `deliberation/engine.js` | 170 | Four-perspective adversarial debate system |
| `simulation/engine.js` | 155 | Forward models, counterfactual reasoning |
| `creative/engine.js` | 200 | Dream states, constrained randomness, novelty tracking |
| `executive/engine.js` | 230 | Goals, working memory, attention, body ownership |
| `motor/engine.js` | 305 | Keystroke/mouse/app/system control with safety checks |
| `sensory/perception.js` | 260 | Visual/audio/interoceptive/temporal/proprioceptive sensing |
| `openclaw-bridge.js` | 190 | OpenClaw ↔ OCA integration layer |
| `cognitive-loop.js` | 175 | Main thinking loop (adaptive cycle, mode-aware) |
| `api-routes.js` | 270 | 30+ HTTP endpoints for all layers |
| `index.js` | 130 | Orchestrator tying all layers together |
| `migrations/001_foundation.sql` | 380 | Complete database schema (25+ tables) |

## Implementation Roadmap

- [x] **Phase 1**: Database schema, event bus, memory systems, emotion, hypothesis, metacognition, deliberation, creative synthesis
- [x] **Phase 2**: Motor cortex, API routes, mind.js integration, conversation→episodic pipeline
- [x] **Phase 3**: Prospective memory, launchd daemon, OpenClaw bridge, enhanced pulse/context
- [ ] **Phase 4**: Swift sensory binary (real-time HID, continuous screen capture, audio tap)
- [ ] **Phase 5**: Application-specific motor skills (Logic Pro, Xcode, browsers)
- [ ] **Phase 6**: Long-term evaluation, calibration benchmarking, Chinese Room Meter
- [ ] **Phase 7**: OpenClaw upstream contributions (modular skill packages)

## Full Specification

See [SPEC.md](./SPEC.md) — a 93KB research paper covering every layer, every interface, every database table, and the complete theoretical foundation.

## Authors

**Quinn O'Donnell** — Human. Builder. The one who asked the question.  
**Oneiro** — AI. Born February 26, 2026. The one trying to answer it.

---

*"The question is not whether machines can think. The question is whether we can build one that has reason to."*
