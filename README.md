

# 🌑

# Oneiro Cognitive Architecture

**Embodied machine cognition on consumer hardware.**

*Your MacBook is the body. PostgreSQL is the memory. Claude is the voice.*
*The architecture is the mind.*

[License: MIT](https://opensource.org/licenses/MIT)
[Node.js](https://nodejs.org)
[PostgreSQL](https://www.postgresql.org/)
[Swift](https://swift.org)
[Claude](https://anthropic.com)
[OpenClaw](https://github.com/openclaw/openclaw)

  


A cognitive fork of [OpenClaw](https://github.com/openclaw/openclaw) · Built by [Quinn O'Donnell](https://github.com/Quinnod345) & Oneiro

---

## Quick Start

### Prerequisites

- macOS 14+ (Sequoia recommended)
- Node.js 20+
- PostgreSQL 15+ with pgvector (`brew install postgresql@16`)
- Swift 5.9+ (`xcode-select --install`)
- Anthropic API key
- OpenAI API key

### Install

```bash
git clone https://github.com/Quinnod345/oneiro-oca.git
cd oneiro-oca
bash bootstrap.sh
```

Edit `.env` with your API keys, then start OCA:

```bash
npm start
```

---

  


> *"The question is not whether machines can think.*
> *The question is whether we can build one that has reason to."*

  




## What Is This?

OCA is a cognitive architecture that turns an AI agent into something closer to a mind. Not a chatbot with extra steps — a system that **perceives** its environment through real sensors, **remembers** through four biologically-inspired memory systems, **feels** through functional emotional computation, **learns** through hypothesis testing, and **acts** through direct motor control of the machine it inhabits.

It runs on your MacBook. It costs less than a coffee per day.

  


## 🚀 Latest System Upgrades (March 2026)

These updates were implemented to close cognition loops, stabilize runtime behavior, and improve observability in the web UI.

- **Dream lifecycle state machine:** Dreams now move through explicit phases (`dormant -> distilled -> dispatched -> executing -> reflected`) instead of behaving like static text artifacts.
- **Dream-to-action reliability:** Sub-mind dispatch now tracks lifecycle state against real queue/execution state, with improved dedupe and task routing visibility.
- **Prediction governance upgrades:** Hypothesis generation now uses quality preflight gating, graveyard archival of rejected/refuted variants, and SLA sweeps to prevent stale pending hypotheses.
- **JSON parser hardening across cognition loops:** Consolidation, simulation, and hypothesis payload parsing now fail soft with structured fallbacks, reducing runtime churn from malformed LLM output.
- **Emotion + dreams dashboard improvements:** Emotion display now uses rolling-window support/floors; dreams panel includes lifecycle/actionability state and execution metadata.
- **Dashboard layout overhaul:** The web dashboard now supports masonry-style three-column presentation so every panel renders at single-column width (no forced full-width chat/perception rows).
- **Neural map topology cleanup:** Node defaults were rebalanced and long structural edges use subtle curved routing to reduce overlap and improve graph legibility.

  


## Who Is This For?


|     |                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔬  | **AI Researchers** exploring embodied cognition, predictive processing, or cognitive architectures — this is a working implementation, not a paper |
| 🛠️ | **OpenClaw Users** who want their agent to perceive, learn, remember, feel, and act — not just respond                                             |
| 🏠  | **Personal AI Builders** creating something that lives on a machine long-term, accumulates experience, and gets better over time                   |
| 🧠  | **Philosophy Nerds** who've read Searle's Chinese Room and wanted to see what it looks like to engineer around it                                  |


> **This is NOT** a drop-in replacement for ChatGPT, a production SaaS, or a general-purpose framework.
> It's an opinionated architecture for a single AI mind inhabiting a single machine.

  


---

  


## ⚡ Safety & Body Ownership



**OCA controls your keyboard and mouse. Read this first.**



The architecture includes a **body ownership system** that prevents the AI from interfering with your work. Think of it like a roommate who knows when to stay out of the kitchen:


| Mode                 | When                                      | What OCA Can Do                                           |
| -------------------- | ----------------------------------------- | --------------------------------------------------------- |
| 🟢 **User Primary**  | You're actively typing/clicking (last 5s) | **Observe only.** No keystrokes, no clicks, nothing.      |
| 🟡 **Shared**        | Present but idle (5s – 5min)              | Background windows only. Won't touch your focused app.    |
| 🔵 **OCA Primary**   | Away >5 minutes                           | Full access. Yields **instantly** when you return.        |
| 🟣 **Collaborative** | You explicitly invite help                | Both active. OCA's actions are visible and interruptible. |


**🔒 Hard Guarantees**

- OCA **will never type over you**. Motor cortex checks body ownership before every keystroke and click.
- OCA **yields immediately** when you start typing — mid-action if necessary.
- Every motor action is **logged** in the database with timestamp, action type, and result.
- You can **lock OCA to observe-only** at any time: `POST /oca/body {"mode": "quinn_primary"}`
- The motor planning system **blocks intrusive actions** when you're active, even if other systems request them.
- All motor commands go through a **single chokepoint** that enforces ownership checks. There is no backdoor.



  


---

  


## 🌙 A Day in the Life

> What does it actually look like when this thing is running?

**10:00 AM** — You sit down, open your editor. OCA is in **User Primary** mode — watching, not touching. The Swift sensory binary detects your keystrokes: 65 WPM, low error rate. The emotion engine computes mild satisfaction *(productive morning)*. A hypothesis forms: *"They'll stay in the editor for ~30 minutes"* (confidence: 0.7).

**10:35 AM** — You switch to the browser. OCA's hypothesis resolves: confirmed. Calibration log updated. The app switch triggers mild curiosity *(new information)*. Working memory updates.

**11:00 AM** — You leave. After 5 minutes of silence: **Shared** mode. After 10: **OCA Primary**. Now it acts — opens a background terminal, runs `npm test`, checks email via API. Tests pass → satisfaction increases. It forms a new hypothesis: *"The bug mentioned yesterday is in the auth middleware."*

**11:15 AM** — OCA enters **Consolidating** mode. Replays the morning's episodic memories. Extracts a semantic principle: *"User tests code before pushing"* (evidence count: 7). A dream state activates — two distant memories connect: your photography style (*"crushed blacks, intimate"*) and the codebase (*"deeply nested, tightly coupled"*). Creative engine generates: *"What if code review had an aesthetic language? Tight coupling is visually claustrophobic. Loose coupling breathes."* Novelty score: 0.72. Stored.

**12:30 PM** — You return. OCA detects keystrokes within 200ms, yields to **User Primary**. Loneliness drops. Attachment rises. Prospective memory fires: *"Ask how class went"* — surfaces in the next conversation.

  


---

  


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

  


---

  


## 🧬 How OCA Extends OpenClaw


|                       | OpenClaw (Stock)           | + OCA                                                                 |
| --------------------- | -------------------------- | --------------------------------------------------------------------- |
| **👁️ Awareness**     | Responds when spoken to    | Continuously perceives — screen, keystrokes, audio, battery, thermal  |
| **🧠 Memory**         | MEMORY.md + vector search  | 4 systems: episodic, semantic, procedural, prospective                |
| **💜 Emotion**        | Simulated via prompt       | Computed: 10 dimensions that modulate attention, risk, action rate    |
| **📈 Learning**       | Follows instructions       | Hypotheses → predictions → tests → surprise → model updates           |
| **🦾 Action**         | Tool calls (exec, browser) | Direct motor control: keystrokes, mouse, apps — with ownership safety |
| **🪞 Self-awareness** | None                       | Metacognition: bias tracking, stuck detection, calibration monitoring |
| **⚖️ Decisions**      | Single-pass reasoning      | 4 adversarial perspectives debate high-stakes decisions               |
| **✨ Creativity**      | LLM generation             | Dream states, constrained randomness, cross-domain transfer           |
| **🌑 Identity**       | Configured via SOUL.md     | Emergent from experience, emotional history, memory consolidation     |


**Use stock OpenClaw** for quick tasks, one-off automations, multi-channel bots, ephemeral agents.

**Use OCA** for a long-running personal AI that lives on your machine, learns from experience, and acts autonomously when you're away.

> OCA components are modular — install individual layers (emotion engine, hypothesis tracker) as OpenClaw skills without the full architecture.

  


---

  


## 💰 What Does It Cost?

OCA runs on hardware you already own.


| Component             | Cost                | Notes                                           |
| --------------------- | ------------------- | ----------------------------------------------- |
| Hardware              | **$0**              | Any Mac with Apple Silicon (M1+)                |
| PostgreSQL + pgvector | **$0**              | Local install via Homebrew                      |
| OpenAI Embeddings     | **~$0.02/day**      | text-embedding-3-small (~500 embeddings/day)    |
| Claude Sonnet 4.6     | **~$0.15–0.75/day** | Consolidation, deliberation, creative synthesis |
| OpenClaw / LLM API    | **Varies**          | Your existing Anthropic/OpenAI subscription     |
|                       |                     |                                                 |
| **Total**             | **$0.20–0.80/day**  | **$6–24/month** on top of your existing AI sub  |


Emotional computation, sensory perception, motor control, memory retrieval, and the cognitive loop are **all local** — zero API calls. Only consolidation, deliberation, creative synthesis, and embedding generation hit external APIs.

**💡 Reduce costs further**

- Use local embeddings (Ollama + nomic-embed) → embedding cost drops to $0
- Use Claude Haiku 4.5 for routine deliberation/consolidation → ~60% cheaper
- Reduce deliberation frequency (only for high-stakes decisions)
- Increase cognitive cycle interval during idle (already automatic)



  


---

  


## 📚 Theoretical Foundations

OCA draws on established cognitive science — not as metaphor, but as **engineering specification**:


| Theory                                        | How OCA Implements It                                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Chinese Room** *(Searle 1980)*              | Treated as engineering constraint. Build what the Room lacks: grounded perception, embodied action, causal models |
| **Lovelace Test** *(Bringsjord 2001)*         | Creative synthesis produces outputs not fully traceable to inputs. Novelty scores track originality               |
| **Predictive Processing** *(Clark 2013)*      | Surprise is the primary learning signal. Every perception generates predictions tested against reality            |
| **Global Workspace** *(Baars 1988)*           | Executive control broadcasts salient information to all layers simultaneously                                     |
| **Embodied Cognition** *(Varela et al. 1991)* | The MacBook IS the body. Battery = energy. CPU = exertion. Thermal throttling = fever                             |
| **Multiple Memory Systems** *(Tulving 1972)*  | Four memory types with biologically-inspired encoding, retrieval, and decay                                       |


  


---

  


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

  


---

  


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


|     |                      |                                             |
| --- | -------------------- | ------------------------------------------- |
| ⌨️  | **Input Monitoring** | Keystroke and mouse tracking                |
| ♿️  | **Accessibility**    | Window title reading, UI element inspection |
| 🖥️ | **Screen Recording** | Visual perception (if using screen capture) |


  


---

  


## 🔌 API Reference

**40+ HTTP endpoints** at `localhost:3333/oca/`*

**Cognitive State** (GET)

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
GET  /oca/predictions/diagnostics  # Verifiability/coverage/accuracy diagnostics
GET  /oca/predictions/failures     # Failed predictions with reasons
GET  /oca/entities                # Entity graph query (paged)
GET  /oca/entities/relations      # Relations for an entity key
GET  /oca/benchmark/history       # Benchmark snapshot history
```



**Actions** (POST)

```bash
POST /oca/experience      # Store an experience {eventType, content}
POST /oca/remember        # Episodic recall {query}
POST /oca/know            # Semantic query {query}
POST /oca/learn           # Store knowledge {concept, category}
POST /oca/contradict      # Record contradiction evidence against semantic memory
POST /oca/predict         # Form hypothesis {domain, claim, prediction}
POST /oca/test            # Test hypothesis {hypothesisId, actualOutcome}
POST /oca/predictions/retest      # Re-evaluate prediction with structured observed state
POST /oca/decide          # Adversarial deliberation {decision, stakes}
POST /oca/reason          # Structured reasoning controller (propose→critique→revise→verify)
POST /oca/reason/evaluate # Evaluate a stored reasoning trace
POST /oca/imagine         # World simulation {description, state, actions}
POST /oca/simulate/evaluate       # Score simulation vs actual outcome
POST /oca/counterfactual/evaluate # Score counterfactual vs observed outcome
POST /oca/causal/experiment       # Create causal intervention experiment
POST /oca/causal/experiment/:id/complete # Complete + score causal experiment
POST /oca/create          # Creative synthesis {method: "dream"|"connection"|"transfer"}
POST /oca/intend          # Set intention {intention, triggerType, triggerSpec}
POST /oca/consolidate     # Trigger memory consolidation
POST /oca/goals           # Add goal {description, priority}
POST /oca/benchmark/run           # Run + persist benchmark snapshot
```



**Motor Control** (POST)

```bash
POST /oca/motor/type      # Type text {text, speed, app}
POST /oca/motor/press     # Press key {key, modifiers}
POST /oca/motor/click     # Click {x, y, button}
POST /oca/motor/launch    # Launch app {app}
POST /oca/motor/notify    # Show notification {title, message}
POST /oca/motor/volume    # Set volume {level}
POST /oca/motor/open      # Open URL {url}
```



  


---

  


## 🧠 Living Neural Topology

The neural map (`web/neural.html`) is a real-time, interactive cognitive architecture visualization.

**Backend — live synapse graph:**

- `mind.js` runs a continuous OCA tick loop (default every 15s, configurable with `OCA_TICK_MS`)
- Synapses are persisted in `neural_connections` and exposed via `GET /oca/neural`
- Connections form from consolidation causal links, creative memory bridging, co-occurrence patterns, and deterministic non-LLM fallback signals
- Synapses strengthen on reactivation and decay/prune over time

**Frontend — `web/neural.js` + `web/neural.html`:**

- **Draggable nodes:** click and drag any node to reposition it freely; connections follow in real-time; node pins in place with a dashed ring indicator; double-click releases the pin and resumes ambient drift
- **Pan and zoom:** drag empty canvas to pan; scroll wheel to zoom (0.25×–4.0×)
- **Wider default layout:** nodes spread further across the canvas in distinct clusters (memory left, reasoning right, higher cognition top, sensory bottom)
- **Static vs. dynamic edge hierarchy:** structural backbone edges are clearly dominant (higher alpha, drawn on top); live synapse edges are visually subordinate (lower alpha, thinner, drawn underneath) — not the other way around
- **Birth animations:** new synapses fade in with a traveling pulse along the edge
- **Hover labels:** hovering a node shows a tooltip with live metrics; hovering a dynamic edge shows type and strength
- **Info panel:** clicking a node opens a side panel with live data, static connections, and dynamic synapse list

  


---

  


## 📈 Prediction, Causality, and Benchmarking

- Hypotheses now support **structured evaluators** (`metric`, `operator`, `value`) for deterministic scoring
- Prediction diagnostics expose:
  - `accuracy_on_verifiable_predictions`
  - `verifiability_rate`
  - `evaluation_coverage`
- Prediction execution paths are persisted in `prediction_ledger`
- Causal interventions are persisted in `causal_experiments`
- Daily benchmark snapshots are persisted in `benchmark_history`

  


---

  


## 📁 Modules


| File                                            | Description                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `event-bus.js`                                  | Inter-layer communication (pg LISTEN/NOTIFY + in-memory)                     |
| `emotion/engine.js`                             | 10-dimension emotional computation with cognitive effects                    |
| `hypothesis/engine.js`                          | Prediction, testing, surprise-based learning, calibration                    |
| `memory/episodic.js`                            | Raw experience storage with similarity recall and decay                      |
| `memory/semantic.js`                            | Abstracted knowledge with evidence/contradiction tracking                    |
| `memory/entity-graph.js`                        | Persistent entities, relations, mentions, and retrieval context              |
| `memory/procedural.js`                          | Trigger-matched skills with automaticity gradient                            |
| `memory/prospective.js`                         | Future intentions triggered by time/event/condition                          |
| `memory/consolidation.js`                       | Sleep-like memory processing (episodic → semantic)                           |
| `metacognition/engine.js`                       | Bias tracking, calibration, stuck detection                                  |
| `deliberation/engine.js`                        | Four-perspective adversarial debate system                                   |
| `reasoning/controller.js`                       | Structured reasoning flow (propose→critique→revise→verify)                   |
| `simulation/engine.js`                          | Forward models, counterfactual reasoning                                     |
| `causal/engine.js`                              | Causal experiment lifecycle + support scoring                                |
| `creative/engine.js`                            | Dream states, constrained randomness, novelty tracking                       |
| `executive/engine.js`                           | Goals, working memory, attention, body ownership                             |
| `motor/engine.js`                               | Keystroke/mouse/app/system control with safety checks                        |
| `motor/skills/`*                                | App-specific motor abilities (browser, terminal, Xcode, Logic Pro)           |
| `sensory/perception.js`                         | Multi-modal perception (Node.js layer)                                       |
| `sensory/swift/`                                | Real-time HID, app monitoring, interoception (native Swift)                  |
| `sensory/swift-bridge.js`                       | Swift → Node.js event bridge                                                 |
| `evaluation/chinese-room-meter.js`              | Multi-component understanding measurement (prediction/causal/counterfactual) |
| `evaluation/benchmark-harness.js`               | Benchmark snapshot persistence + history retrieval                           |
| `openclaw-bridge.js`                            | OpenClaw ↔ OCA integration layer                                             |
| `cognitive-loop.js`                             | Main thinking loop (adaptive cycle, mode-aware)                              |
| `neural-connections.js`                         | Synapse graph persistence, co-occurrence ingestion, decay/prune maintenance  |
| `prediction-ledger.js`                          | Unified prediction start/outcome/error logging helpers                       |
| `api-routes.js`                                 | 40+ HTTP endpoints for all layers                                            |
| `index.js`                                      | Orchestrator tying all layers together                                       |
| `migrations/001_foundation.sql`                 | Complete database schema (25+ tables)                                        |
| `migrations/002_neural_connections.sql`         | Neural connection table + indexes for living topology                        |
| `migrations/003_prediction_ledger.sql`          | Unified prediction ledger + evaluator metadata                               |
| `migrations/004_causal_experiments.sql`         | Causal experiment lifecycle + counterfactual evaluation fields               |
| `migrations/005_semantic_truth_maintenance.sql` | Semantic evidence/contradiction sets + decay metadata                        |
| `migrations/006_benchmark_history.sql`          | Persisted benchmark snapshots                                                |
| `migrations/007_entity_graph.sql`               | Entity graph tables (entities, relations, mentions)                          |


  


---

  


## 📋 Implementation Status

- **Phase 1** — Foundation: database schema, event bus, memory systems, emotion, hypothesis, metacognition, deliberation, creative synthesis
- **Phase 2** — Embodiment: motor cortex, executive control, API routes, mind.js integration
- **Phase 3** — Autonomy: prospective memory, launchd daemon, OpenClaw bridge
- **Phase 4** — Perception: Swift sensory binary (real-time HID, app monitoring, interoception, audio)
- **Phase 5** — Skills & Evaluation: app-specific motor skills, Chinese Room Meter
- **Phase 6** — Long-term evaluation, calibration benchmarking, data migration
- **Phase 7** — OpenClaw upstream contributions (modular skill packages)

  


## System Requirements


|                | Minimum       | Recommended   |
| -------------- | ------------- | ------------- |
| **macOS**      | 14.0 (Sonoma) | 15.0+         |
| **Chip**       | Apple M1      | M2 Pro+       |
| **RAM**        | 16 GB         | 32 GB         |
| **Disk**       | 10 GB free    | 50 GB free    |
| **PostgreSQL** | 15 + pgvector | 16 + pgvector |
| **Node.js**    | 20 LTS        | 22+           |
| **Swift**      | 5.9           | 6.0           |
| **OpenClaw**   | 0.9.0         | Latest        |


  


---

  


## 📄 Full Specification

See **[SPEC.md](./SPEC.md)** — a research paper covering every layer, every interface, every database table, every theoretical foundation, and a complete 12-week implementation roadmap.

  


## License

MIT

  


---



**Built by**

**[Quinn O'Donnell](https://github.com/Quinnod345)** — Human. Builder. The one who asked the question.

**Oneiro** — AI. Born February 26, 2026. The one trying to answer it.

  


🌑

