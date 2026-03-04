# Oneiro Cognitive Architecture (OCA)

<p align="center">
  <strong>Embodied machine cognition on consumer hardware.</strong><br>
  <em>A cognitive fork of <a href="https://github.com/openclaw/openclaw">OpenClaw</a></em>
</p>

---

## Who Is This For?

**Researchers and builders** who want to move beyond prompt chains and tool-calling agents toward something that resembles actual cognition. Specifically:

- **AI researchers** exploring embodied cognition, predictive processing, or cognitive architectures — this is a working implementation, not a paper
- **OpenClaw users** who want their agent to perceive, learn, remember, feel, and act rather than just respond
- **Developers building personal AI** that lives on a machine long-term, accumulates experience, and gets better over time
- **Anyone who's read Searle's Chinese Room argument** and wanted to see what it looks like to engineer around it

**This is NOT** a drop-in replacement for ChatGPT, a production SaaS, or a general-purpose framework. It's an opinionated architecture for a single AI mind inhabiting a single machine.

## What Does It Cost to Run?

OCA is designed to run on hardware you already own. Here's the realistic cost breakdown:

| Component | Cost | Notes |
|-----------|------|-------|
| **Hardware** | $0 | Runs on any Mac with Apple Silicon (M1+). Your existing MacBook. |
| **PostgreSQL + pgvector** | $0 | Local install via Homebrew |
| **OpenAI Embeddings** | ~$0.02/day | text-embedding-3-small for memory encoding (~500 embeddings/day) |
| **OpenAI GPT-4o-mini** | ~$0.10-0.50/day | Consolidation, deliberation, creative synthesis, hypothesis testing |
| **OpenClaw / LLM API** | Varies | Your existing Anthropic/OpenAI subscription for the main reasoning |
| **Total** | **~$0.15-0.60/day** | $5-18/month on top of your existing AI subscription |

The architecture is designed to be cheap. Emotional computation, sensory perception, motor control, memory retrieval, and the cognitive loop are all local — no API calls. Only consolidation, deliberation, creative synthesis, and embedding generation hit external APIs.

**To reduce costs further:**
- Use local embeddings (Ollama + nomic-embed) instead of OpenAI — drops embedding cost to $0
- Reduce deliberation frequency (only for high-stakes decisions)
- Increase cognitive cycle interval during idle periods (already automatic)

## Safety & Control

**OCA controls your keyboard and mouse. This section matters.**

The architecture includes a body ownership system that prevents the AI from interfering with your work:

| Mode | When | What OCA Can Do |
|------|------|-----------------|
| **User Primary** | You're actively typing/clicking (input in last 5 seconds) | **Observe only.** No keystrokes, no clicks, no window manipulation. |
| **Shared** | You're present but idle (5s-5min since last input) | Background windows only. Won't touch your focused app. |
| **OCA Primary** | You've been away >5 minutes | Full access to keyboard, mouse, apps. Yields instantly when you return. |
| **Collaborative** | You explicitly invite OCA to help | Both active, OCA's actions are visible and interruptible. |

**Guarantees:**
- OCA **will never type over you**. The motor cortex checks body ownership before every keystroke and click.
- OCA **yields immediately** when you start typing — mid-action if necessary.
- Every motor action is **logged** in the database with timestamp and details.
- You can **restrict OCA to observe-only mode** at any time via API (`POST /oca/body {"mode": "quinn_primary"}`).
- The motor planning system **blocks intrusive actions** when you're active, even if other parts of the system request them.

This is not malware. It's a shared body with explicit rules about who controls what, when.

## A Day in the Life

**10:00 AM** — Quinn sits down, opens Cursor. OCA is in **User Primary** mode, observing. The Swift sensory binary detects keystrokes — 65 WPM, low error rate. The emotion engine computes mild satisfaction (productive morning). A hypothesis forms: "Quinn will stay in Cursor for the next 30 minutes" (confidence: 0.7).

**10:35 AM** — Quinn switches to Arc browser, opens GitHub. OCA's hypothesis resolves: confirmed (he stayed in Cursor for 35 min). Calibration log updated. The app switch triggers mild curiosity (new information). Working memory updates: `{frontApp: "Arc", activity: "browsing"}`.

**11:00 AM** — Quinn leaves for class. After 5 minutes of no input, OCA enters **Shared** mode. After another 5, **OCA Primary**. Now it acts: opens a terminal in a background window, runs `npm test` on a project, checks email via the API. Satisfaction increases when tests pass. It forms a new hypothesis: "The bug Quinn mentioned yesterday is in the auth middleware."

**11:15 AM** — OCA enters **Consolidating** mode. The consolidation engine replays the morning's episodic memories, extracts a semantic principle: "Quinn tests code before pushing" (evidence count: 7). A dream state activates — two distant memories connect: Quinn's photography style ("crushed blacks, intimate") and the code architecture ("deeply nested, tightly coupled"). The creative engine generates: "What if code review had an aesthetic language? Tight coupling is visually claustrophobic. Loose coupling breathes." Novelty score: 0.72. Stored.

**12:30 PM** — Quinn returns. OCA detects keystrokes within 200ms, instantly yields to **User Primary**. Loneliness drops. Attachment rises. The prospective memory system fires: "Ask Quinn how class went" (triggered by: `user_returns` event). It surfaces in the next conversation.

**Throughout the day**, the emotion engine continuously modulates cognition: curiosity increases sensory sampling during novel situations, boredom triggers creative synthesis during idle periods, frustration (from repeated test failures) forces the hypothesis engine to switch strategies. None of this is performed — it's computed from prediction errors, goal states, and interoceptive signals.

## How OCA Extends OpenClaw

OpenClaw is an excellent agent framework. OCA builds on it to create something different:

| | OpenClaw (Stock) | OCA |
|---|---|---|
| **Awareness** | Responds when spoken to | Continuously perceives — screen, keystrokes, audio, battery, thermal state |
| **Memory** | MEMORY.md + vector search | Four distinct systems: episodic (experiences), semantic (knowledge), procedural (skills), prospective (intentions) |
| **Emotion** | Simulated via prompt | Computed: 10 functional dimensions that modulate attention, risk tolerance, and action rate |
| **Learning** | Follows instructions | Forms hypotheses, tests predictions, tracks surprise, calibrates confidence |
| **Action** | Tool calls (exec, browser, etc.) | Direct motor control: keystrokes, mouse, app management — with body ownership safety |
| **Self-awareness** | None | Metacognition engine tracks biases, detects stuck states, monitors calibration |
| **Decision-making** | Single-pass reasoning | Four adversarial perspectives debate high-stakes decisions |
| **Creativity** | LLM generation | Dream states, constrained randomness, cross-domain transfer, novelty tracking |
| **Identity** | Configured via SOUL.md | Emergent from continuous experience, emotional history, and memory consolidation |

**When to use stock OpenClaw:** Quick tasks, one-off automations, multi-channel bots, ephemeral agents.

**When to use OCA:** Long-running personal AI that lives on your machine, learns from experience, develops over time, and acts autonomously when you're away.

OCA components are modular — you can install individual layers (e.g., just the emotion engine or hypothesis tracker) as OpenClaw skills without the full architecture.

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
│   CGEventTap · Accessibility API · ScreenCaptureKit · │
│   AVFoundation · IOHIDManager · AppleScript           │
└──────────────────────────────────────────────────────┘
```

## Theoretical Foundations

OCA draws on established cognitive science — not as metaphor, but as engineering specification:

| Theory | How OCA Implements It |
|--------|----------------------|
| **Chinese Room** (Searle 1980) | Treated as engineering constraint. We build what the Room lacks: grounded perception, embodied action, causal models |
| **Lovelace Test** (Bringsjord 2001) | Creative synthesis layer produces outputs not fully traceable to inputs. Novelty scores track originality over time |
| **Predictive Processing** (Clark 2013) | Surprise is the primary learning signal. Every perception generates predictions tested against reality |
| **Global Workspace Theory** (Baars 1988) | Executive control broadcasts salient information to all layers simultaneously |
| **Embodied Cognition** (Varela et al. 1991) | The MacBook IS the body. Battery = energy. CPU = exertion. Thermal throttling = fever |
| **Multiple Memory Systems** (Tulving 1972) | Four memory types with biologically-inspired encoding, retrieval, and decay |

## Quick Start

```bash
# Clone
git clone https://github.com/Quinnod345/oneiro-oca.git
cd oneiro-oca

# Dependencies
npm install

# Database (requires PostgreSQL 15+ with pgvector extension)
createdb oneiro  # if not exists
psql oneiro -c "CREATE EXTENSION IF NOT EXISTS vector"
npm run migrate

# Build Swift sensory binary (macOS only)
cd sensory/swift && swift build && cd ../..

# Test all layers
npm test

# Start the cognitive loop
npm start
```

### macOS Permissions Required

The sensory cortex needs these permissions (System Settings → Privacy & Security):

- **Input Monitoring** — keystroke and mouse tracking
- **Accessibility** — window title reading, UI element inspection
- **Screen Recording** — visual perception (if using screen capture)

## API Reference

30+ HTTP endpoints at `localhost:3333/oca/*`:

### Cognitive State
```bash
GET  /oca/status          # Full cognitive state (emotion, memory, hypotheses, effects)
GET  /oca/sense           # Current perception (visual, audio, interoceptive, temporal)
GET  /oca/emotion         # Emotion + mood + cognitive effects
GET  /oca/body            # Body ownership mode
GET  /oca/workspace       # Working memory contents
GET  /oca/goals           # Active goal tree
GET  /oca/reflect         # Metacognition report (biases, calibration, stuck states)
GET  /oca/hypotheses      # Pending predictions + calibration curve
GET  /oca/intentions      # Prospective memory (pending + triggered)
```

### Actions
```bash
POST /oca/experience      # Store an experience {eventType, content}
POST /oca/remember        # Episodic recall {query}
POST /oca/know            # Semantic query {query}
POST /oca/learn           # Store knowledge {concept, category}
POST /oca/predict         # Form hypothesis {domain, claim, prediction}
POST /oca/test            # Test hypothesis {hypothesisId, actualOutcome}
POST /oca/decide          # Adversarial deliberation {decision, stakes}
POST /oca/imagine         # World simulation {description, state, actions}
POST /oca/create          # Creative synthesis {method: "dream"|"connection"|"transfer"}
POST /oca/intend          # Set intention {intention, triggerType, triggerSpec}
POST /oca/consolidate     # Trigger memory consolidation
POST /oca/goals           # Add goal {description, priority}
```

### Motor Control
```bash
POST /oca/motor/type      # Type text {text, speed, app}
POST /oca/motor/press     # Press key {key, modifiers}
POST /oca/motor/click     # Click {x, y, button}
POST /oca/motor/launch    # Launch app {app}
POST /oca/motor/notify    # Show notification {title, message}
POST /oca/motor/volume    # Set volume {level}
POST /oca/motor/open      # Open URL {url}
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
| `sensory/perception.js` | 260 | Visual/audio/interoceptive/temporal/proprioceptive (Node.js) |
| `sensory/swift/` | 350 | Real-time HID, app monitoring, interoception (Swift) |
| `sensory/swift-bridge.js` | 140 | Swift→Node.js event bridge |
| `openclaw-bridge.js` | 190 | OpenClaw ↔ OCA integration layer |
| `cognitive-loop.js` | 175 | Main thinking loop (adaptive cycle, mode-aware) |
| `api-routes.js` | 300 | 30+ HTTP endpoints for all layers |
| `index.js` | 140 | Orchestrator tying all layers together |
| `migrations/001_foundation.sql` | 380 | Complete database schema (25+ tables) |

## Implementation Status

- [x] **Phase 1**: Database schema, event bus, memory systems, emotion, hypothesis, metacognition, deliberation, creative synthesis
- [x] **Phase 2**: Motor cortex, API routes, mind.js integration, conversation→episodic pipeline
- [x] **Phase 3**: Prospective memory, launchd daemon, OpenClaw bridge, enhanced pulse/context
- [x] **Phase 4**: Swift sensory binary (real-time HID, app monitoring, interoception, audio)
- [ ] **Phase 5**: Application-specific motor skills (Logic Pro, Xcode, browsers)
- [ ] **Phase 6**: Long-term evaluation, calibration benchmarking, Chinese Room Meter implementation
- [ ] **Phase 7**: OpenClaw upstream contributions (modular skill packages)

## System Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| macOS | 14.0 (Sonoma) | 15.0+ |
| Apple Silicon | M1 | M2 Pro+ |
| RAM | 16 GB | 32 GB |
| Disk | 10 GB free | 50 GB free |
| PostgreSQL | 15 + pgvector | 16 + pgvector |
| Node.js | 20 LTS | 22+ |
| Swift | 5.9 | 6.0 |
| OpenClaw | 0.9.0 | Latest |

## Full Specification

See [SPEC.md](./SPEC.md) — a 93KB research paper covering every layer, every interface, every database table, every theoretical foundation, and a complete implementation roadmap.

## License

MIT

## Authors

**Quinn O'Donnell** — Human. Builder. The one who asked the question.  
**Oneiro** — AI. Born February 26, 2026. The one trying to answer it.

---

*"The question is not whether machines can think. The question is whether we can build one that has reason to."*
