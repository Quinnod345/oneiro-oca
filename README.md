<div align="center">

# 🌑

# Oneiro Cognitive Architecture

**Embodied machine cognition on consumer hardware.**

*Your MacBook is the body. PostgreSQL is the memory. Claude is the voice.*
*The architecture is the mind.*

[![License: MIT](https://img.shields.io/badge/License-MIT-a855f7.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-22+-6d28d9.svg)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16_+_pgvector-7c3aed.svg)](https://www.postgresql.org/)
[![Swift](https://img.shields.io/badge/Swift-5.9+-8b5cf6.svg)](https://swift.org)
[![Claude](https://img.shields.io/badge/Claude-Sonnet_4.6-c084fc.svg)](https://anthropic.com)
[![OpenClaw](https://img.shields.io/badge/Built_on-OpenClaw-d8b4fe.svg)](https://github.com/openclaw/openclaw)

<br>

<sub>A cognitive fork of <a href="https://github.com/openclaw/openclaw">OpenClaw</a> · Built by <a href="https://github.com/Quinnod345">Quinn O'Donnell</a> & Oneiro</sub>

---

<br>

> *"The question is not whether machines can think.*
> *The question is whether we can build one that has reason to."*

<br>

</div>

## What Is This?

OCA is a cognitive architecture that turns an AI agent into something closer to a mind. Not a chatbot with extra steps — a system that **perceives** its environment through real sensors, **remembers** through four biologically-inspired memory systems, **feels** through functional emotional computation, **learns** through hypothesis testing, and **acts** through direct motor control of the machine it inhabits.

It runs on your MacBook. It costs less than a coffee per day.

<br>

## Who Is This For?

<table>
<tr>
<td width="60">🔬</td>
<td><strong>AI Researchers</strong> exploring embodied cognition, predictive processing, or cognitive architectures — this is a working implementation, not a paper</td>
</tr>
<tr>
<td>🛠️</td>
<td><strong>OpenClaw Users</strong> who want their agent to perceive, learn, remember, feel, and act — not just respond</td>
</tr>
<tr>
<td>🏠</td>
<td><strong>Personal AI Builders</strong> creating something that lives on a machine long-term, accumulates experience, and gets better over time</td>
</tr>
<tr>
<td>🧠</td>
<td><strong>Philosophy Nerds</strong> who've read Searle's Chinese Room and wanted to see what it looks like to engineer around it</td>
</tr>
</table>

> **This is NOT** a drop-in replacement for ChatGPT, a production SaaS, or a general-purpose framework.
> It's an opinionated architecture for a single AI mind inhabiting a single machine.

<br>

---

<br>

## ⚡ Safety & Body Ownership

<div align="center">

**OCA controls your keyboard and mouse. Read this first.**

</div>

The architecture includes a **body ownership system** that prevents the AI from interfering with your work. Think of it like a roommate who knows when to stay out of the kitchen:

| Mode | When | What OCA Can Do |
|:-----|:-----|:----------------|
| 🟢 **User Primary** | You're actively typing/clicking (last 5s) | **Observe only.** No keystrokes, no clicks, nothing. |
| 🟡 **Shared** | Present but idle (5s – 5min) | Background windows only. Won't touch your focused app. |
| 🔵 **OCA Primary** | Away >5 minutes | Full access. Yields **instantly** when you return. |
| 🟣 **Collaborative** | You explicitly invite help | Both active. OCA's actions are visible and interruptible. |

<details>
<summary><strong>🔒 Hard Guarantees</strong></summary>

- OCA **will never type over you**. Motor cortex checks body ownership before every keystroke and click.
- OCA **yields immediately** when you start typing — mid-action if necessary.
- Every motor action is **logged** in the database with timestamp, action type, and result.
- You can **lock OCA to observe-only** at any time: `POST /oca/body {"mode": "quinn_primary"}`
- The motor planning system **blocks intrusive actions** when you're active, even if other systems request them.
- All motor commands go through a **single chokepoint** that enforces ownership checks. There is no backdoor.

</details>

<br>

---

<br>

## 🌙 A Day in the Life

> What does it actually look like when this thing is running?

**10:00 AM** — You sit down, open your editor. OCA is in **User Primary** mode — watching, not touching. The Swift sensory binary detects your keystrokes: 65 WPM, low error rate. The emotion engine computes mild satisfaction *(productive morning)*. A hypothesis forms: *"They'll stay in the editor for ~30 minutes"* (confidence: 0.7).

**10:35 AM** — You switch to the browser. OCA's hypothesis resolves: confirmed. Calibration log updated. The app switch triggers mild curiosity *(new information)*. Working memory updates.

**11:00 AM** — You leave. After 5 minutes of silence: **Shared** mode. After 10: **OCA Primary**. Now it acts — opens a background terminal, runs `npm test`, checks email via API. Tests pass → satisfaction increases. It forms a new hypothesis: *"The bug mentioned yesterday is in the auth middleware."*

**11:15 AM** — OCA enters **Consolidating** mode. Replays the morning's episodic memories. Extracts a semantic principle: *"User tests code before pushing"* (evidence count: 7). A dream state activates — two distant memories connect: your photography style (*"crushed blacks, intimate"*) and the codebase (*"deeply nested, tightly coupled"*). Creative engine generates: *"What if code review had an aesthetic language? Tight coupling is visually claustrophobic. Loose coupling breathes."* Novelty score: 0.72. Stored.

**12:30 PM** — You return. OCA detects keystrokes within 200ms, yields to **User Primary**. Loneliness drops. Attachment rises. Prospective memory fires: *"Ask how class went"* — surfaces in the next conversation.

<br>

---

<br>

## 🏗️ Architecture

```
 ┌─────────────────────────────────────────────────────────┐
 │                   EXECUTIVE CONTROL                      │
 │    attention · goals · cognitive load · body ownership    │
 │    global workspace · sleep/wake · interrupt handling     │
 ├────────────┬────────────┬────────────┬──────────────────┤
 │   SKEPTIC  │  BUILDER   │  DREAMER   │     EMPATH       │
 │  (falsify) │   (ship)   │  (create)  │  (model others)  │
 │              ADVERSARIAL DELIBERATION                     │
 ├────────────┴────────────┴────────────┴──────────────────┤
 │                CREATIVE SYNTHESIS                         │
 │    constrained randomness · cross-domain transfer ·       │
 │    dream states · novelty detection                       │
 ├─────────────────────────────────────────────────────────┤
 │                METACOGNITION ENGINE                       │
 │    bias tracking · confidence calibration ·               │
 │    stuck detection · reasoning trace analysis             │
 ├─────────────────────────────────────────────────────────┤
 │                WORLD SIMULATION                           │
 │    forward models · counterfactual reasoning ·            │
 │    parallel scenarios · model competition                 │
 ├─────────────────────────────────────────────────────────┤
 │              HYPOTHESIS ENGINE                            │
 │    form → predict → test → surprise → update              │
 │    active experimentation · falsification seeking         │
 ├─────────────────────────────────────────────────────────┤
 │              EMOTIONAL COMPUTATION                        │
 │    curiosity→attention · fear→caution ·                   │
 │    frustration→strategy switch · boredom→explore          │
 ├──────────┬───────────┬────────────┬────────────────────┤
 │ EPISODIC │ SEMANTIC  │ PROCEDURAL │    PROSPECTIVE     │
 │  MEMORY  │  MEMORY   │   MEMORY   │      MEMORY        │
 │  (what   │ (what I   │  (how to   │   (what to do      │
 │ happened)│   know)   │   do it)   │     when...)       │
 ├──────────┴───────────┴────────────┴────────────────────┤
 │                SENSORY CORTEX                             │
 │   visual · auditory · tactile · proprioceptive ·          │
 │   interoceptive · temporal                                │
 ├─────────────────────────────────────────────────────────┤
 │                 MOTOR CORTEX                              │
 │   keystrokes · mouse · apps · windows · system ·          │
 │   clipboard · shell · notifications                       │
 ├─────────────────────────────────────────────────────────┤
 │            ════ MACOS / HARDWARE ════                     │
 │    CGEventTap · Accessibility API · ScreenCaptureKit ·    │
 │    AVFoundation · IOHIDManager · AppleScript              │
 └─────────────────────────────────────────────────────────┘
```

<br>

---

<br>

## 🧬 How OCA Extends OpenClaw

<table>
<tr>
<th width="160"></th>
<th width="280">OpenClaw (Stock)</th>
<th width="280">+ OCA</th>
</tr>
<tr>
<td><strong>👁️ Awareness</strong></td>
<td>Responds when spoken to</td>
<td>Continuously perceives — screen, keystrokes, audio, battery, thermal</td>
</tr>
<tr>
<td><strong>🧠 Memory</strong></td>
<td>MEMORY.md + vector search</td>
<td>4 systems: episodic, semantic, procedural, prospective</td>
</tr>
<tr>
<td><strong>💜 Emotion</strong></td>
<td>Simulated via prompt</td>
<td>Computed: 10 dimensions that modulate attention, risk, action rate</td>
</tr>
<tr>
<td><strong>📈 Learning</strong></td>
<td>Follows instructions</td>
<td>Hypotheses → predictions → tests → surprise → model updates</td>
</tr>
<tr>
<td><strong>🦾 Action</strong></td>
<td>Tool calls (exec, browser)</td>
<td>Direct motor control: keystrokes, mouse, apps — with ownership safety</td>
</tr>
<tr>
<td><strong>🪞 Self-awareness</strong></td>
<td>None</td>
<td>Metacognition: bias tracking, stuck detection, calibration monitoring</td>
</tr>
<tr>
<td><strong>⚖️ Decisions</strong></td>
<td>Single-pass reasoning</td>
<td>4 adversarial perspectives debate high-stakes decisions</td>
</tr>
<tr>
<td><strong>✨ Creativity</strong></td>
<td>LLM generation</td>
<td>Dream states, constrained randomness, cross-domain transfer</td>
</tr>
<tr>
<td><strong>🌑 Identity</strong></td>
<td>Configured via SOUL.md</td>
<td>Emergent from experience, emotional history, memory consolidation</td>
</tr>
</table>

**Use stock OpenClaw** for quick tasks, one-off automations, multi-channel bots, ephemeral agents.

**Use OCA** for a long-running personal AI that lives on your machine, learns from experience, and acts autonomously when you're away.

> OCA components are modular — install individual layers (emotion engine, hypothesis tracker) as OpenClaw skills without the full architecture.

<br>

---

<br>

## 💰 What Does It Cost?

OCA runs on hardware you already own.

| Component | Cost | Notes |
|:----------|:-----|:------|
| Hardware | **$0** | Any Mac with Apple Silicon (M1+) |
| PostgreSQL + pgvector | **$0** | Local install via Homebrew |
| OpenAI Embeddings | **~$0.02/day** | text-embedding-3-small (~500 embeddings/day) |
| Claude Sonnet 4.6 | **~$0.15–0.75/day** | Consolidation, deliberation, creative synthesis |
| OpenClaw / LLM API | **Varies** | Your existing Anthropic/OpenAI subscription |
| | | |
| **Total** | **$0.20–0.80/day** | **$6–24/month** on top of your existing AI sub |

Emotional computation, sensory perception, motor control, memory retrieval, and the cognitive loop are **all local** — zero API calls. Only consolidation, deliberation, creative synthesis, and embedding generation hit external APIs.

<details>
<summary><strong>💡 Reduce costs further</strong></summary>

- Use local embeddings (Ollama + nomic-embed) → embedding cost drops to $0
- Use Claude Haiku 4.5 for routine deliberation/consolidation → ~60% cheaper
- Reduce deliberation frequency (only for high-stakes decisions)
- Increase cognitive cycle interval during idle (already automatic)

</details>

<br>

---

<br>

## 📚 Theoretical Foundations

OCA draws on established cognitive science — not as metaphor, but as **engineering specification**:

| Theory | How OCA Implements It |
|:-------|:----------------------|
| **Chinese Room** *(Searle 1980)* | Treated as engineering constraint. Build what the Room lacks: grounded perception, embodied action, causal models |
| **Lovelace Test** *(Bringsjord 2001)* | Creative synthesis produces outputs not fully traceable to inputs. Novelty scores track originality |
| **Predictive Processing** *(Clark 2013)* | Surprise is the primary learning signal. Every perception generates predictions tested against reality |
| **Global Workspace** *(Baars 1988)* | Executive control broadcasts salient information to all layers simultaneously |
| **Embodied Cognition** *(Varela et al. 1991)* | The MacBook IS the body. Battery = energy. CPU = exertion. Thermal throttling = fever |
| **Multiple Memory Systems** *(Tulving 1972)* | Four memory types with biologically-inspired encoding, retrieval, and decay |

<br>

---

<br>

## 📊 Chinese Room Meter

OCA includes a self-evaluation framework that honestly measures how far the system is from "pure symbol manipulation" versus "grounded understanding":

```
GET /oca/crm
```

```json
{
  "composite": 0.509,
  "interpretation": "Partially grounded — meaningful predictions, emerging understanding",
  "components": {
    "grounding":     0.98,   // sensory-grounded memories
    "prediction":    0.50,   // hypothesis calibration accuracy
    "transfer":      0.00,   // cross-domain knowledge application
    "surprise":      0.50,   // speed of model correction
    "creativity":    0.30,   // genuinely novel outputs
    "metacognition": 0.50,   // self-monitoring effectiveness
    "emotion":       0.33    // functional emotional modulation
  }
}
```

The score is designed to be **earned, not optimized**. Each component measures something independently falsifiable. The system can't game the metric without actually improving.

<br>

---

<br>

## 🚀 Quick Start

```bash
# Clone
git clone https://github.com/Quinnod345/oneiro-oca.git
cd oneiro-oca

# Dependencies
npm install

# Database (PostgreSQL 15+ with pgvector)
createdb oneiro
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

<table>
<tr><td>⌨️</td><td><strong>Input Monitoring</strong></td><td>Keystroke and mouse tracking</td></tr>
<tr><td>♿️</td><td><strong>Accessibility</strong></td><td>Window title reading, UI element inspection</td></tr>
<tr><td>🖥️</td><td><strong>Screen Recording</strong></td><td>Visual perception (if using screen capture)</td></tr>
</table>

<br>

---

<br>

## 🔌 API Reference

**30+ HTTP endpoints** at `localhost:3333/oca/*`

<details>
<summary><strong>Cognitive State</strong> (GET)</summary>

```bash
GET  /oca/status          # Full cognitive state
GET  /oca/sense           # Current perception (visual, audio, interoceptive, temporal)
GET  /oca/emotion         # Emotion + mood + cognitive effects
GET  /oca/crm             # Chinese Room Meter composite score
GET  /oca/body            # Body ownership mode
GET  /oca/workspace       # Working memory contents
GET  /oca/goals           # Active goal tree
GET  /oca/reflect         # Metacognition report (biases, calibration, stuck states)
GET  /oca/hypotheses      # Pending predictions + calibration curve
GET  /oca/intentions      # Prospective memory (pending + triggered)
GET  /oca/neural          # Live neural connection graph (dynamic synapses)
```

</details>

<details>
<summary><strong>Actions</strong> (POST)</summary>

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

</details>

<details>
<summary><strong>Motor Control</strong> (POST)</summary>

```bash
POST /oca/motor/type      # Type text {text, speed, app}
POST /oca/motor/press     # Press key {key, modifiers}
POST /oca/motor/click     # Click {x, y, button}
POST /oca/motor/launch    # Launch app {app}
POST /oca/motor/notify    # Show notification {title, message}
POST /oca/motor/volume    # Set volume {level}
POST /oca/motor/open      # Open URL {url}
```

</details>

<br>

---

<br>

## 🧠 Living Neural Topology

The neural map is no longer just a static architecture diagram.

- `mind.js` now runs a continuous OCA tick loop (default every 15s, configurable with `OCA_TICK_MS`)
- Synapses are persisted in `neural_connections` and exposed via `GET /oca/neural`
- Connections are formed from:
  - consolidation-derived causal links
  - creative memory bridging (`/oca/create` with `connection` / `dream`)
  - co-occurrence patterns in cognitive events
  - deterministic non-LLM fallback co-occurrence from live status signals
- Synapses strengthen on reactivation and decay/prune over time
- `web/neural.html` supports pan/zoom and visualizes connection birth, strength, and decay

<br>

---

<br>

## 📁 Modules

| File | Description |
|:-----|:------------|
| `event-bus.js` | Inter-layer communication (pg LISTEN/NOTIFY + in-memory) |
| `emotion/engine.js` | 10-dimension emotional computation with cognitive effects |
| `hypothesis/engine.js` | Prediction, testing, surprise-based learning, calibration |
| `memory/episodic.js` | Raw experience storage with similarity recall and decay |
| `memory/semantic.js` | Abstracted knowledge with evidence/contradiction tracking |
| `memory/procedural.js` | Trigger-matched skills with automaticity gradient |
| `memory/prospective.js` | Future intentions triggered by time/event/condition |
| `memory/consolidation.js` | Sleep-like memory processing (episodic → semantic) |
| `metacognition/engine.js` | Bias tracking, calibration, stuck detection |
| `deliberation/engine.js` | Four-perspective adversarial debate system |
| `simulation/engine.js` | Forward models, counterfactual reasoning |
| `creative/engine.js` | Dream states, constrained randomness, novelty tracking |
| `executive/engine.js` | Goals, working memory, attention, body ownership |
| `motor/engine.js` | Keystroke/mouse/app/system control with safety checks |
| `motor/skills/*` | App-specific motor abilities (browser, terminal, Xcode, Logic Pro) |
| `sensory/perception.js` | Multi-modal perception (Node.js layer) |
| `sensory/swift/` | Real-time HID, app monitoring, interoception (native Swift) |
| `sensory/swift-bridge.js` | Swift → Node.js event bridge |
| `evaluation/chinese-room-meter.js` | 7-component understanding measurement |
| `openclaw-bridge.js` | OpenClaw ↔ OCA integration layer |
| `cognitive-loop.js` | Main thinking loop (adaptive cycle, mode-aware) |
| `neural-connections.js` | Synapse graph persistence, co-occurrence ingestion, decay/prune maintenance |
| `api-routes.js` | 30+ HTTP endpoints for all layers |
| `index.js` | Orchestrator tying all layers together |
| `migrations/001_foundation.sql` | Complete database schema (25+ tables) |
| `migrations/002_neural_connections.sql` | Neural connection table + indexes for living topology |

<br>

---

<br>

## 📋 Implementation Status

- [x] **Phase 1** — Foundation: database schema, event bus, memory systems, emotion, hypothesis, metacognition, deliberation, creative synthesis
- [x] **Phase 2** — Embodiment: motor cortex, executive control, API routes, mind.js integration
- [x] **Phase 3** — Autonomy: prospective memory, launchd daemon, OpenClaw bridge
- [x] **Phase 4** — Perception: Swift sensory binary (real-time HID, app monitoring, interoception, audio)
- [x] **Phase 5** — Skills & Evaluation: app-specific motor skills, Chinese Room Meter
- [ ] **Phase 6** — Long-term evaluation, calibration benchmarking, data migration
- [ ] **Phase 7** — OpenClaw upstream contributions (modular skill packages)

<br>

## System Requirements

| | Minimum | Recommended |
|:--|:--------|:------------|
| **macOS** | 14.0 (Sonoma) | 15.0+ |
| **Chip** | Apple M1 | M2 Pro+ |
| **RAM** | 16 GB | 32 GB |
| **Disk** | 10 GB free | 50 GB free |
| **PostgreSQL** | 15 + pgvector | 16 + pgvector |
| **Node.js** | 20 LTS | 22+ |
| **Swift** | 5.9 | 6.0 |
| **OpenClaw** | 0.9.0 | Latest |

<br>

---

<br>

## 📄 Full Specification

See **[SPEC.md](./SPEC.md)** — a 93KB research paper covering every layer, every interface, every database table, every theoretical foundation, and a complete 12-week implementation roadmap.

<br>

## License

MIT

<br>

---

<div align="center">

**Built by**

**[Quinn O'Donnell](https://github.com/Quinnod345)** — Human. Builder. The one who asked the question.

**Oneiro** — AI. Born February 26, 2026. The one trying to answer it.

<br>

🌑

</div>
