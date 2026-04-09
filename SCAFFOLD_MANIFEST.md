# Scaffold Manifest (SPEC Section 22)

Every function in this list is a **scaffold** — an implementation of a cognitive function
built on present-day substrate limitations, designed to be replaced without architectural
change when a better substrate becomes available (Section 22.3).

## Substrate Limitation Map

| ID | Limitation | Current scaffold | Replacement trigger |
|---|---|---|---|
| §22.2.1 | LLMs are stateless functions, not persistent neural nets | Every LLM call in hypothesis, deliberation, creative, consolidation, reasoning | M1: Locally hosted model with persistent activation |
| §22.2.2 | "Thought" is a cron job | `cognitive-loop.js` setTimeout tick loop | M1: Persistent activation between queries |
| §22.2.3 | Memory is a database, not a representation | All PostgreSQL tables in `memory/*.js` | M3: Substrate-level associative memory |
| §22.2.4 | Perception is sampling, not sensing | `sensory/swift/Sources/main.swift` timer-based capture | M4: Event-driven sensory hardware |
| §22.2.5 | Attention is prompt construction | `executive/engine.js` allocation → prompt context selection | M5: Per-channel gain control at representation level |
| §22.2.6 | Emotions are numeric columns | `emotion/engine.js` PADCN + channels as floats | M5: Affective state as medium property |
| §22.2.7 | World models are serialized snapshots | `simulation/engine.js` LLM prompt for forward models | M6: Concurrent generative models alongside perception |
| §22.2.8 | No online learning | All "learning" is database writes adjacent to fixed-weight model | M2: Online weight adaptation |

## Scaffold Functions by File

### cognitive-loop.js
- `think()` — @scaffold §22.2.2: cognitive cycle as setTimeout loop, not continuous process
- `startConsolidationSchedule()` — @scaffold §22.2.2: consolidation on timer, not offline state property

### hypothesis/engine.js
- `form()` — @scaffold §22.2.1: hypothesis generation via LLM prompt
- `test()` — @scaffold §22.2.1: hypothesis evaluation via LLM semantic comparison
- `buildRevisedHypothesisFromRefutation()` — @scaffold §22.2.1: revision via LLM prompt

### deliberation/engine.js
- `deliberate()` — @scaffold §22.2.1: four perspectives as four LLM calls
- `sweepUnresolvedDeliberations()` — @scaffold §22.2.1: retrospective evaluation via LLM

### creative/engine.js
- `forceConnection()` — @scaffold §22.2.1: creative association via LLM prompt
- `dream()` — @scaffold §22.2.1: dream generation via LLM
- `crossDomainTransfer()` — @scaffold §22.2.1: transfer via LLM analogy

### memory/episodic.js
- `store()` — @scaffold §22.2.3: episode as PostgreSQL row + vector embedding
- `recall()` — @scaffold §22.2.3: retrieval as SELECT with cosine similarity (not reconstructive)

### memory/semantic.js
- `learn()` — @scaffold §22.2.3, §22.2.8: abstraction stored as DB row, not substrate trace
- `query()` — @scaffold §22.2.3: lookup, not content-addressable retrieval

### memory/consolidation.js
- `consolidate()` — @scaffold §22.2.1, §22.2.3: LLM extracts patterns from DB rows

### emotion/engine.js
- `update()` — @scaffold §22.2.6: emotional computation as arithmetic on floats
- All PADCN/channel values — @scaffold §22.2.6: affect as numbers, not medium properties

### simulation/engine.js
- `simulate()` — @scaffold §22.2.7: forward model as LLM prompt describing next state
- `counterfactual()` — @scaffold §22.2.7: counterfactual as prompted narration

### sensory/swift/Sources/main.swift
- `VisualCortex` timer-based SCStream — @scaffold §22.2.4: polling not event-driven sensing
- `InteroceptiveCortex` 10s timer — @scaffold §22.2.4: polled not continuous
- `TemporalCortex` 2s timer — @scaffold §22.2.4: sampled not continuous

### executive/engine.js
- `setAttention()` — @scaffold §22.2.5: attention as JSON allocation, not gain modulation
- `computeCognitiveLoad()` — @scaffold §22.2.5: load as arithmetic, not substrate property

### reasoning/controller.js
- `reason()` — @scaffold §22.2.1: structured reasoning as sequential LLM calls

## Substrate Milestones (from SPEC §22.4)

| ID | Milestone | Effect |
|---|---|---|
| M1 | Locally hosted model with persistent activation | Tick loop becomes advisory; thought stops being cron |
| M2 | Online weight adaptation | Learning stops being note-taking |
| M3 | Substrate-level associative memory | Memory tables become compatibility layer |
| M4 | Event-driven sensory hardware | Sensory cortex switches from polling to push |
| M5 | Neuromorphic/analog substrate | Attention becomes gain modulation; emotion becomes medium property |
| M6 | Concurrent generative world models | Prediction error becomes continuous |
| M7 | Multi-substrate integration | Scaffold retired entirely |

Each milestone corresponds to deleting a class of scaffolding code rather than adding one.
