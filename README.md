# Oneiro Cognitive Architecture (OCA)

**An engine that wants things, prices risk against what they are worth, thinks in bounded strategies, feels in consequence of what it did, and measures itself against stated baselines.**

This repository is the engine — not an assistant, not an app. Its purpose, set out in [`SPEC.md`](SPEC.md), is to build something that beats the Chinese Room: cognition that is grounded in experience, that predicts and gets scored, that changes its mind for reasons, and whose emotions do work instead of decorating output. The spec is the vision. This README is what runs.

## The chain

```
worth ──► hunger ──► risk ──► strategies ──► receipts ──► affect ──► (appetite, verification, strategy, style)
```

1. **Worth** (`motivation/worth.js`) — a ledger of what things are worth: the engine's own capabilities, the person it serves, their data and attention, projects, outcomes. Only four things can move it: a declared constraint (never weighed), a declared prior (must be earned past), a rating by a person, or an observed outcome with evidence. Evidence sourced from the engine's own generated text is rejected at validation. Activity counts and model confidence have no way in.
2. **Hunger** (`motivation/hunger.js`) — a want is *for* something; its value is the worth of its stakes, re-priced every time the engine chooses what to pursue. Pressure grows with elapsed time. Only an observed receipt satiates a want; plans, conclusions and model confidence never do.
3. **Risk** (`motivation/risk.js`) — every action is appraised as expected worth gained against expected worth lost, bounded by how reversible it is. Irreversible → a person fires it. The two declared constraints are boundaries, not costs. *Appetite* — how much loss it accepts per unit of gain — is the first thing affect modulates. Each decision is journaled with its prediction and later its outcome, so the engine's self-knowledge is a calibration curve, not a self-report.
4. **Strategies** (`reasoning/strategies.js`) — a want spends its budget on one bounded attempt at a time: inspect the evidence, commit to a falsifiable prediction the world will settle, simulate the next step so reality can score it, argue against the premise, or draft a deliverable a person will rate. A stall or failure rotates the strategy; a different strategy is a different attempt, not repetition.
5. **Receipts** — observed progress on a want, a settled prediction, a rated artifact, a risk outcome. These are the only inputs to worth and the only satiation of hunger.
6. **Affect** (`emotion/engine.js`) — phasic feeling comes only from what the engine did and observed (an unexpected success, a failure with stakes, harm, being held back, not knowing what something is worth). Tonic state is a *projection* of the journals, never an integrator of events — time alone changes nothing, so nothing can ratchet. Affect is consumed, never narrated: fear raises the confidence a conclusion must reach, frustration shortens the patience before a strategy change, curiosity buys appetite for finding things out (never for acting on the world), and the expression profile becomes style directives.

Everything a person needs to understand a want is one call away: `GET /oca/trace/:id` assembles the story from the journals — attempts, appraisals, commitments, settlements, receipts, worth signals, and affect at each step.

## What the engine will not do

- Credit itself for running, for switching apps, for generating text, for a plan, or for a self-modification.
- Treat its own account of its feelings as an event.
- Accept a prediction the world cannot evaluate.
- Reach a person with unverified content, or write to their data without a way back — these are constraints, not weights, and the risk gate refuses them outright.
- Act on the world on its own while the master switch is off. Thinking is not acting: read-only steps that touch nothing proceed; anything with a reversibility cost is recorded as a proposal for a person.

## Measured

`npm run benchmark` runs the isolated mechanism suite (every behavioral contract as a test) and the Chinese Room Meter, and writes [`evaluation/results/latest.json`](evaluation/results/latest.json). Each dimension is measured against a stated baseline with its n, or says what evidence it still needs. The composite stays null until every dimension is measured.

| dimension | score | n | status |
|---|---|---|---|
| grounding | 1.000 | 23 | measured |
| prediction | 0.000 | 4879 | measured |
| metacognition | — | — | insufficient evidence |
| emotion | — | — | insufficient evidence |
| surprise | — | — | insufficient evidence |
| creativity | — | — | insufficient evidence |
| transfer | — | — | unmeasured |
| counterfactual | — | — | unmeasured |
| causal | — | — | unmeasured |

*As of 2026-09-19.* The prediction score is the honest starting point: across 4,879 ambient predictions made before wants existed, the engine's stated confidence was no better than always guessing each metric's base rate (Brier 0.209 vs 0.194). Want-driven predictions are reported separately and have to beat that.

A blind-judge protocol (`scripts/judge-pack.mjs`, `scripts/judge.mjs`) renders a want's journal into a first-person account with the same local model that also, separately, reasons the want through with no engine; a judge scores both blind on a five-point rubric. Packs contain the person's own want text and are written outside the repository.

## Running it

Requirements: Node 22+, PostgreSQL 16 with pgvector, an Ollama endpoint for local inference (this deployment runs it on a second machine over Tailscale), and a BGE-large embedding server on `:7801` (`ONEIRO_EMBED_URL`). Optional: the Codex CLI for hard reasoning steps; the engine falls back to the local model when it is unavailable.

```bash
npm install
npm run migrate            # DATABASE_URL, default postgres://localhost/oneiro
npm run test:engine        # isolated tests; each clones the tables it needs into a private schema
npm start                  # the daemon: loop + HTTP API on :3333
npm run benchmark          # mechanism suite + scorecard → evaluation/results/latest.json
```

Useful endpoints: `/oca/health`, `/oca/hunger`, `/oca/worth`, `/oca/risk`, `/oca/emotion`, `/oca/crm`, `/oca/trace/:id`, `POST /ponder` (create a want), `POST /ponder/:id/outcome` (record observed progress), `POST /oca/worth/rate` (rate an entity).

Environment: `ONEIRO_LOCAL_REASONER_URL`, `ONEIRO_LOCAL_REASONER_TRANSPORT=ollama`, `ONEIRO_OCA_THINKER_MODEL`, `OCA_STRATEGY_PROVIDER`/`OCA_STRATEGY_MODEL`, `OCA_ENABLE_AUTONOMOUS_ACTIONS` (the master switch, off by default), `ONEIRO_EMBED_ALLOW_HASH_FALLBACK` (off: a blip in the embedder stores no vector rather than a wrong one).

## Layout

```
motivation/    worth.js, worth-ledger.js, hunger.js, risk.js, risk-journal.js, interests.js
reasoning/     strategies.js, ponder-queue.js, ponder-service.js, loop.js (the evidence-bound reasoner), trace.js
emotion/       engine.js (affect v4)
hypothesis/    typed, falsifiable predictions and their evaluation against observed metrics
simulation/    forward simulation scored by later outcomes
metacognition/ calibration, stuck detection, bias tracking
memory/        episodic, semantic, consolidation candidates
evaluation/    chinese-room-meter.js, benchmark-harness.js, anti-decay.js, results/
cognitive-loop.js   the tick: sense, feel, run the pursuit queue, settle predictions, consolidate, remember
thinker-bridge.js   the ambient thinker; its actions go through the risk gate
tests/         the mechanism suite (node --test)
docs/          behavioral-integrity.md, evidence-loop.md, the archived v1.2 README
```

## Retired, and why

The 2026-09-18/19 rebuild removed the parts of the earlier architecture that paid the engine for activity or acted outside the risk gate: the dream executor (self-build machinery that wrote files, installed packages, committed, pushed and posted on the strength of a generated dream), the design-model build loop and self-training pool, count-credited goals, autonomic self-modification, the ambient hypothesis generator, and the per-tick creative and simulation sections. Their capabilities survive as strategies or were dead by construction. Dreams remain as a read-only archive (`/oca/dreams/state`). History holds everything.

## Status

Phases 1–6 of the rebuild are in: worth, hunger, risk, affect, the loop as spine, and measurement. Open: a held-out corpus for transfer, counterfactual and causal; more settled want-driven predictions than the meter's thresholds; artifacts rated by a person; and the surface that delivers three to five worthwhile outputs a day to the person's phone. The engine runs continuously; the journals accumulate.

## License

MIT
