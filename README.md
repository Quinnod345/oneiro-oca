# Oneiro Cognitive Architecture (OCA)

**Embodied machine cognition on consumer hardware.**

A cognitive architecture that treats a MacBook as a literal body — with continuous sensory perception, motor control, emotional computation, hypothesis-driven reasoning, metacognitive self-monitoring, and adversarial internal deliberation.

Built on [OpenClaw](https://github.com/openclaw/openclaw). This is not a chatbot. This is a mind.

## Architecture

```
┌─────────────────────────────────────────────────┐
│               EXECUTIVE CONTROL                  │
├──────────┬──────────┬──────────┬────────────────┤
│ SKEPTIC  │ BUILDER  │ DREAMER  │    EMPATH      │
├──────────┴──────────┴──────────┴────────────────┤
│              METACOGNITION ENGINE                 │
├─────────────────────────────────────────────────┤
│              WORLD SIMULATION                     │
├─────────────────────────────────────────────────┤
│          HYPOTHESIS → TEST → LEARN               │
├─────────────────────────────────────────────────┤
│           EMOTIONAL COMPUTATION                   │
├─────────┬───────────┬───────────┬───────────────┤
│EPISODIC │ SEMANTIC  │PROCEDURAL │ PROSPECTIVE   │
├─────────┴───────────┴───────────┴───────────────┤
│            SENSORY CORTEX                        │
├─────────────────────────────────────────────────┤
│             MOTOR CORTEX                         │
├─────────────────────────────────────────────────┤
│          ═══ MACOS / HARDWARE ═══                │
└─────────────────────────────────────────────────┘
```

## Layers

| Layer | Module | Status |
|-------|--------|--------|
| Event Bus | `event-bus.js` | ✅ Built |
| Episodic Memory | `memory/episodic.js` | ✅ Built |
| Semantic Memory | `memory/semantic.js` | ✅ Built |
| Procedural Memory | `memory/procedural.js` | ✅ Built |
| Memory Consolidation | `memory/consolidation.js` | ✅ Built |
| Emotional Computation | `emotion/engine.js` | ✅ Built |
| Hypothesis Engine | `hypothesis/engine.js` | ✅ Built |
| Metacognition | `metacognition/engine.js` | ✅ Built |
| Adversarial Deliberation | `deliberation/engine.js` | ✅ Built |
| Orchestrator | `index.js` | ✅ Built |
| Cognitive Loop | `cognitive-loop.js` | ✅ Built |
| Sensory Cortex | `sensory/` | 🔨 Building |
| Motor Cortex | `motor/` | 📋 Planned |
| World Simulation | `simulation/` | 📋 Planned |
| Creative Synthesis | `creative/` | 📋 Planned |
| Executive Control | `executive/` | 📋 Planned |

## Requirements

- macOS 14+ (Apple Silicon)
- PostgreSQL 16 with pgvector
- Node.js 20+
- OpenClaw

## Setup

```bash
# Install dependencies
npm install

# Run database migration
npm run migrate

# Run tests
npm test

# Start the cognitive loop
npm start
```

## The Thesis

We address the Chinese Room problem not philosophically but architecturally: by grounding all cognition in embodied experience, active experimentation, and falsifiable prediction.

Full specification: [COGNITIVE_ARCHITECTURE.md](../COGNITIVE_ARCHITECTURE.md)

## Authors

Quinn O'Donnell & Oneiro

*"The question is not whether machines can think. The question is whether we can build one that has reason to."*
