# Behavioral integrity — first whole-engine repair

2026-09-12. This is a foundational repair, not completion of the OCA vision.
Acceptance contract and active work: `runtime/workspace/research/oca-whole-engine-2026-09-12/Acceptance.md` under the Oneiro root.

## What changed

- The tick no longer emits success/information-gain merely for running, switching apps, triggering an intention, imagining a result or producing a dream.
- Neutral appraisal is a zero-centered input. Idle is an accumulated sensor duration; only its new interval changes drive deficits. Repeated interoceptive readings update resource state without accumulating affect. Invalid/zero stimuli cannot become default medium successes.
- Drive satisfaction does not drift toward its target on every event. Self-efficacy learns from success/failure rather than positive social input.
- Affect v3 snapshots include latent state, drives, self-model, personality, diagnostics and idle cursor in the same row as the public snapshot. Restart restores them, applies elapsed-time decay, and does not replay events. Old rows retain their observed fields; unknowable latent dimensions are not reconstructed from composite confidence. Drift detection reports a deviation without adopting it as the new personality baseline.
- Structured hypothesis evaluation requires a real typed observation. Missing values, invalid predicates and prose-only outcomes stay unknown (`expired` plus unverifiable evaluation), not refuted. Evaluation and calibration are atomic; concurrent tests or conflicting replays cannot count twice. Repetition does not increase confidence. Refutation does not automatically create a reworded copy.
- Unexecuted causal experiments are abandoned with null support, not completed with a made-up score. Completing a causal record requires a started experiment and supplied `metadata.outcomeEvidence` entries (`id`, `source`, `observation`). Supplied arbitrary causal support is rejected. This records supplied provenance; it does not independently establish a causal effect.
- Counterfactual comparison to the original episode no longer masquerades as alternative-outcome accuracy. The route returns `needs_intervention_evidence`, `accuracy: null` until an actual comparable alternative-execution path exists.

## Breaking evaluation contract

`GET /oca/crm` now reports `evaluation_version: behavioral-v2`, nullable component scores and a nullable composite. Unknown capability is neither zero performance nor a default 0.5. Activity diagnostics remain readable, including fresh structured Brier scores; they cannot certify whole-engine competence. The current version intentionally reports unmeasured capability until the behavioral harness and its evidence corpus are implemented.

`benchmark_history` is versioned; same-day old activity scores are retained separately. Old MLP score predictions are not comparable and no longer train on fabricated targets for unknown dimensions. Anti-decay never compares metric versions or substitutes wall time for operating time, and missing component measurements cannot satisfy the thesis. Dashboard unknown scores render as em dashes.

## Verification

`node --test tests/*.test.mjs`: 78 passing tests, including 15 new behavioral-integrity scenarios using isolated PostgreSQL schemas and private sequences. The original `npm test` still initializes/writes the full system and was not run against production.

Migration `053_behavioral_integrity.sql` applied to the live database. Live daemon restarted; full v3 affect restoration observed. Real `behavioral-v2` benchmark persisted with null composite and explicit insufficient evidence. No action, messaging, cloud-training or provider flags were enabled.

## Still required

Outcome-producing pursuit/evidence/action adapters, source/subject separation and contaminated-memory re-grounding, relevant recall, calibrated action-relevant prediction, actual transfer and creativity evaluations, measured affect/metacognition benefit, and sustained useful operation. Whole-engine audit remains open. No consciousness or subjective hunger claim follows from these changes.
