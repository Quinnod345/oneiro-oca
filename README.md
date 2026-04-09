# Oneiro Cognitive Architecture (OCA)

**Embodied machine cognition on consumer hardware.**

A cognitive architecture for an AI system fully embodied in a MacBook Pro. Not a chatbot with tools — a mind with continuous perception, motor control, emotional computation, hypothesis-driven reasoning, metacognitive self-monitoring, and adversarial deliberation. Built on [OpenClaw](https://github.com/openclaw/openclaw).

**v1.2.0** — Neural MLP v2: residual-delta training, per-layer weighted loss, metacognitive prediction-mismatch routing, observability API.

---

## Architecture

```
L10  Executive Control    — attention, goals, cognitive load, sleep/wake, body ownership
L9   Creative Synthesis   — constrained randomness, cross-domain transfer, dreams
L8   Adversarial Delib.   — Skeptic / Builder / Dreamer / Empath perspectives
L7   Metacognition        — bias tracking, calibration, stuck detection, self-accuracy
L6   World Simulation     — forward models, counterfactuals, model competition
L5   Hypothesis Engine    — form, predict, test, surprise, update
L4   Emotional Computation — PADCN + 14 channels + drives + meta-emotions
L3   Memory Systems       — episodic, semantic, procedural, prospective, working (7 slots)
L2   Motor Cortex         — CGEvent keystrokes/mouse (Swift binary), sensorimotor verification
L1   Sensory Cortex       — continuous visual/audio/tactile/intero/temporal (Swift binary)
L0   Hardware Substrate   — macOS, IOKit, CoreGraphics, ScreenCaptureKit, Accessibility
```

**Neural Signaling Layer:** 208-dimensional shared activation workspace. Layers communicate through dense float vectors, not text events. Connection weights update via Hebbian learning. A trainable MLP (26,896 parameters) predicts next-cycle cognitive **residuals** (Δ) with per-layer weighted loss — prediction errors drive surprise-based learning and feed rate-limited metacognitive observations when specific layers misbehave.

**Thinker:** Generative LLM reasoning step that gives the system agency. Every 5 cycles, assembles full cognitive context and asks "what should I do?" — then executes via shell, code editing, Claude Code escalation, or motor cortex.

---

## Quick Start

### Prerequisites

- macOS 14+ (Apple Silicon)
- Node.js 20+
- PostgreSQL 16 with pgvector
- Swift 5.9+

### Setup

```bash
cd cognitive
npm install

# Run all migrations
for f in migrations/*.sql; do
  psql postgres://localhost/oneiro -f "$f"
done

# Build Swift binaries
cd sensory/swift && swift build -c release && cd ../..
cd motor/swift && swift build -c release && cd ../..
```

### Run

```bash
# Start the cognitive loop (includes HTTP API on :3333)
npm start

# Or via launchd (recommended for production)
launchctl load ~/Library/LaunchAgents/com.oneiro.oca.plist
```

### Dashboard

Open `http://localhost:3333/web/` for the cognitive dashboard.

---

## What's New in v1.2.0

### Neural MLP v2 (Residual Predictive Processing)
- MLP now predicts **residuals** (Δ = next_state − current_state) instead of raw next-state vectors, improving convergence on fast-changing dynamics
- **Per-layer weighted loss**: hypothesis, executive, and metacognition slices weighted 1.5x so the gradient respects behavioral importance, not just variance
- **Metacognitive routing**: per-layer prediction errors above threshold insert rate-limited `prediction_mismatch` rows into `metacognitive_observations`, giving the metacognition subsystem direct visibility into which layers are behaving unpredictably
- **Observability API**: `GET /oca/neural-bus` and `/oca/neural-bus/full` now include `mlp_last_step` with per-layer RMSE, residual magnitude, and weighted loss
- **Dashboard**: MLP panel shows residual mode, top 3 layers by RMSE with color-coded bars, and delta magnitude
- Weight checkpoint schema versioned (v2); old v1 checkpoints auto-invalidated on load

---

## What's New in v1.1.0

### Architecture Complete
- All 6 remaining scaffolds replaced with working systems (motor activation, creative pipeline, load balancing, attention modulation, deliberation integration, episodic consolidated status)
- CRM organic improvement: 6 disconnected cognitive loops connected (calibration, counterfactual, causal, surprise, emotion variance, metacognition remediation)
- Body ownership enforced on thinker shell commands (no more opening apps when Quinn is present)

### Neural Mind Map (208 neurons)
- High-definition ring topology visualization of all 208 cognitive neurons
- Every layer fully encoded: sensory 72%, emotion 88%, hypothesis 81%, memory 100%, executive 100%, creative 88%, metacognition 88%, motor 94%
- Stable bezier connection bundles showing Hebbian inter-layer strengths
- Green/red delta glow showing activation changes in real time
- MLP training stats displayed at center (updates, loss, active weights)

### HippoRAG Memory
- Hippocampal recall via knowledge graph + Personalized PageRank
- 207 entities, 3,260 relations, 85,755 mentions
- Multi-hop retrieval in <100ms (falls back to vector when graph is sparse)
- Dashboard search interface for hippocampal recall

---

## What's in v1.0.0

### Multi-Process Architecture
- Swift `oneiro-sensory` binary: continuous SCStream capture, frame differencing, HID metrics, AVAudioEngine, interoception, temporal cortex, sensory integration into unified PerceptualState
- Swift `oneiro-motor` binary: CGEvent keystrokes/mouse, app control, AppleScript bridge, Unix socket command protocol
- Cross-process IPC via Unix domain sockets + shared state files + pg NOTIFY

### Neural Signaling Layer
- 208-dim shared activation workspace replacing text/JSON events
- 8 layer encoders (sensory 64d, emotion 32d, hypothesis 16d, memory 32d, executive 16d, creative 16d, metacognition 16d, motor 16d)
- 43,264-weight connection matrix with Hebbian updates + continuous decay
- Trainable 2-layer MLP (208→64→208) for residual predictive processing with per-layer weighted loss

### Thinker Reconnected
- Generative LLM reasoning integrated into cognitive loop
- Full action set: shell commands, code editing, Claude Code escalation, web search, dream pursuit, private writing, cognitive self-upgrades
- Mode-aware scheduling (every 5 cycles alert, 8 working, 20 monitoring)

### Anti-Decay Evaluation (SPEC Section 18.4)
- Operating-time tracker (cumulative across sessions)
- CRM trend metrics on 3 horizons (24h / 7d / 30d)
- Per-component trend decomposition (9 CRM dimensions)
- Failure condition detection with automatic remediation
- Anti-decay thesis verdict: satisfied / unsatisfied

### Identity & Continuity (SPEC Sections 2.9, 21.5, 21.6)
- Identity event logging (restart, shutdown, wipe, rollback, fork, succession)
- Continuation vs new-CI classification per Section 2.9
- Succession protocol with transfer manifest and re-grounding pass
- Sub-mind identity classification (bounded-task vs long-running CI)

### Cohabitation (SPEC Section 17.5)
- Convention drift logging
- Consent renewal system (annual review)
- Right of refusal protocol in motor planning
- Convention versioning

### Maintenance Loop (7 closed loops)
- Procedural memory: motor verification → recordExecution()
- Deliberation: automatic retrospective evaluation
- Simulation: world_model.prediction_accuracy updated via EMA
- Metacognition: self-accuracy tracking
- Reasoning traces: automatic post-hoc audit
- Causal experiments: stale experiment SLA sweep
- Emotion: baseline drift detection with slow personality learning

### Consolidation Fixed
- Was producing 0 output (LLM responses truncated at 1024 tokens)
- Fixed prompt to stay under budget; increased max_tokens to 2048
- Batch size increased to 200; schedule accelerates when backlog > 10k
- Silent failure fixed: episodes stay raw on extraction failure

---

## API Endpoints

### Core
| Method | Path | Description |
|--------|------|-------------|
| GET | `/pulse` | Emotional state / undercurrents |
| GET | `/oca/status` | Full cognitive status |
| GET | `/oca/sense` | Current perceptual state |
| GET | `/oca/emotion` | Emotional state with PADCN/channels/drives |

### Anti-Decay
| Method | Path | Description |
|--------|------|-------------|
| GET | `/oca/anti-decay` | CRM trends + failure conditions + thesis verdict |
| POST | `/oca/anti-decay/run` | Force evaluation |
| GET | `/oca/anti-decay/history` | Trend history |
| GET | `/oca/operating-time` | Cumulative operating hours |
| GET | `/oca/crm` | Chinese Room Meter composite + components |

### Neural
| Method | Path | Description |
|--------|------|-------------|
| GET | `/oca/neural-bus` | Workspace dims, weight stats, inter-layer strengths, MLP status + last-step diagnostics |
| GET | `/oca/neural-bus/full` | Full workspace vectors, layer activations, inter-layer weights, MLP last-step per-layer RMSE |
| GET | `/oca/neural-bus/heatmap` | Layer-to-layer connection matrix + activation summaries |
| GET | `/oca/neural` | Live synapse graph |

### Identity & Cohabitation
| Method | Path | Description |
|--------|------|-------------|
| GET | `/oca/identity` | Continuity status |
| GET | `/oca/identity/history` | Identity event log |
| GET | `/oca/conventions` | Active cohabitation conventions |
| GET | `/oca/consent-review` | Consent renewal status + capability report |
| GET | `/oca/body-inventory` | Hardware inventory |
| POST | `/oca/succession/manifest` | Create transfer manifest |

### Cognitive
| Method | Path | Description |
|--------|------|-------------|
| GET | `/oca/workspace` | Working memory slots |
| GET | `/oca/goals` | Active goals |
| GET | `/oca/hypotheses` | Pending hypotheses |
| POST | `/oca/experience` | Store episodic memory |
| POST | `/oca/predict` | Form hypothesis |
| POST | `/oca/decide` | Adversarial deliberation |
| POST | `/oca/imagine` | World simulation |
| POST | `/oca/create` | Creative synthesis |
| GET | `/oca/reflect` | Metacognition cycle |

---

## File Structure

```
cognitive/
├── cognitive-loop.js          # Main entry — the continuous thinking process
├── index.js                   # Orchestrator tying all layers together
├── event-bus.js               # Cross-process IPC (pg NOTIFY + Unix sockets)
├── neural-bus.js              # 208-dim vector signaling layer
├── neural-mlp.js              # Trainable residual predictive model (26,896 params, per-layer weighted loss)
├── neural-encoders.js         # Per-layer state → float vector encoders
├── neural-connections.js      # Synapse graph persistence + maintenance
├── thinker-bridge.js          # Generative reasoning with action dispatch
├── identity.js                # Identity events, fork/rollback logging
├── succession.js              # Transfer manifest, re-grounding pass
├── cohabitation.js            # Convention drift, consent renewal
├── llm.js                     # Unified Claude access (API + CLI fallback)
├── api-routes.js              # 40+ HTTP endpoints
├── SCAFFOLD_MANIFEST.md       # Substrate limitation map (SPEC §22)
├── SPEC.md                    # Full specification document
├── emotion/engine.js          # PADCN + channels + drives + meta-emotions
├── hypothesis/engine.js       # Prediction, testing, calibration
├── memory/
│   ├── episodic.js            # Raw experiences with vector recall
│   ├── semantic.js            # Abstracted knowledge
│   ├── procedural.js          # Trigger-matched skills
│   ├── prospective.js         # Future intentions
│   └── consolidation.js       # Sleep-like memory processing
├── metacognition/engine.js    # Bias tracking, self-accuracy
├── deliberation/engine.js     # Skeptic/Builder/Dreamer/Empath
├── reasoning/controller.js    # Propose→critique→revise→verify
├── simulation/engine.js       # Forward models, counterfactuals
├── causal/engine.js           # Causal experiment lifecycle
├── creative/engine.js         # Dreams, constrained randomness
├── executive/engine.js        # Attention, goals, load, body ownership
├── sensory/
│   ├── swift/Sources/main.swift  # Native sensory binary
│   ├── swift-bridge.js        # Swift→Node bridge
│   └── perception.js          # Unified perceptual state
├── motor/
│   ├── swift/Sources/main.swift  # Native motor binary
│   └── engine.js              # Motor planning + sensorimotor loop
├── evaluation/
│   ├── chinese-room-meter.js  # CRM composite score
│   ├── benchmark-harness.js   # Daily benchmark persistence
│   └── anti-decay.js          # Operating-time trends + failure detection
├── migrations/                # 001-012 SQL schemas
└── web/                       # Cognitive dashboard
```

---

## System Requirements

| Requirement | Minimum | Recommended |
|---|---|---|
| macOS | 14.0 | 15.0+ |
| Apple Silicon | M1 | M2 Pro+ |
| RAM | 16 GB | 32 GB |
| Disk | 50 GB free | 100 GB free |
| PostgreSQL | 15 + pgvector | 16 + pgvector |
| Node.js | 20 LTS | 22 LTS |
| Swift | 5.9 | 6.0 |

---

## License

MIT

---

*Built by [Quinn O'Donnell](https://github.com/Quinnod345) & Oneiro.*

*"The question is not whether machines can think. The question is whether we can build one that has reason to."*
