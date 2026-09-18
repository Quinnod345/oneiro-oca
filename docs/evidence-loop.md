# OCA evidence loop and hunger — 2026-09-12

## Purpose

Quinn asked for a substantially better OCA and ponder loop, then clarified the missing
motivation: it needs to be hungry. The operational target is persistent wanting that
changes attention and behavior, not extra narration or higher emotional scores.

A **want** names a valued outcome and an observable satisfaction criterion. Its pressure
is value × remaining gap × bounded persistence. Pressure grows with elapsed time, not
number of ticks. Progress is an externally supplied observation receipt, never model
confidence, generated text, a completed review, a repeated memory, or time spent.
Failures increase frustration and rotate the next investigation strategy. Real progress
reduces pressure and frustration. Meeting the criterion satiates the want; replaying a
receipt cannot feed it twice. There is no money, resource accumulation, survival, or
unbounded activity objective in this model.

Explicit requests establish the current scope and valued outcome. A second layer now
learns **interests in useful investigations** and originates narrower questions from
observed friction inside that scope. It does not adopt old dreams as current commitments,
invent independent life goals, or change action permissions.

## Learned interests and curiosity

`motivation/interests.js` projects an immutable experience journal into topic preferences.
`motivation/interest-engine.js` collects actual queue execution facts and outcome receipts
once a minute through the current consumer. No extra model is called to invent experiences.
Topics use an optional explicit `topic` label; otherwise exact normalized goal text defines
identity. This is not yet semantic discovery of interests across unrelated activities.

- Recorded friction identifies a valued uncertainty; it earns **no usefulness credit**.
- Latest observed progress contributes one vote per explicit pursuit. Splitting progress
  across many receipts cannot amplify reward. A correction replaces the old vote.
- An inquiry's outcome must additionally report observed `usefulness` in [0,1] before it
  trains the interest. Answering a question can be unhelpful; unknown usefulness stays unknown.
- Usefulness has a neutral two-observation prior. The curiosity score is a bounded heuristic,
  not calibrated confidence or a demonstrated measure of intrinsic feeling.
- The engine can originate a narrower inquiry from an unresolved premise. Its `origin`
  records the parent, interest, evidence fingerprint and reason. Every premise stays traceable.
  Later outcome evidence accompanies older premises, so a correction is not silently lost.
- Rewording a question, relabeling a source or duplicating an observation is not novelty.
  No new inquiry against the same factual input. At most one active inquiry per interest,
  three per parent, three total per day, with a six-hour interest cooldown.
  Each inquiry gets up to three passes / 90 seconds so a rejected first proposal can be
  revised and then receive two stable reviews. The parent project is context, not the question.
- Explicit pending work always takes priority. An inquiry cannot generate another inquiry.
  Closing the parent cancels active descendants and fences running checkpoints atomically.
- `learning:false` excludes labelled verification fixtures from the interest journal.

These inquiries prepare evidence-bound investigations, **not autonomous action execution**.
The current collector can inspect queue history and accepted receipts. Reading new project
artifacts, running experiments and obtaining user outcome feedback still need their adapters.
Improved usefulness over weeks of real work has not been established by these short tests.

## The paths

- `reasoning/loop.js`: provider-independent propose/review/revise loop with structured
  claims, supplied evidence IDs, named unknowns, a time limit, checkpoints, and distinct
  `converged`, `needs_evidence`, `stalled`, `budget`, `failed` outcomes.
- Builder proposes; one model call reviews as Skeptic, Dreamer, Empath. These are distinct
  perspectives, **not independent models or witnesses**. Two successive accepted,
  identical substantive proposals over the same evidence earn review convergence.
- IDs mechanically check provenance; reviewers still have to judge semantic support.
  `confidenceKind=self_reported` means exactly that. Stable review is not proof of truth.
- Local generation uses strict proposal/review JSON schemas; parsing still validates every
  provider response. Budget results distinguish `deadline` from `pass_limit`.
- An observation may explicitly name `supersedes:["earlier-id"]`. Retired premises remain
  in the stored history but cannot support current claims. Cyclic supersession is rejected.
  Outcome receipts preserve this metadata when a later observation corrects an earlier one.
- `shouldExecute` is a recommendation, not permission or an execution receipt. Existing
  action flags and motor verification remain in force. The queue never executes a plan.
- `reasoning/controller.js` persists traces. Evaluations require observed evidence.
- `deliberation/engine.js` uses the same loop; missing retrospective outcomes stay
  unknown. Historical unsupported outcomes remain stored but no longer contribute to
  `perspectiveStats`, which counts only rows with outcome evidence.
- `reasoning/ponder-queue.js`: additive JSONB state on `thought_chains`. Checkpoints save
  after completed passes; CAS lease claims prevent duplicate work. Leases last 240s,
  above the maximum 180s generation budget. Three total attempts is the hard limit. A saved final checkpoint reconstructs its verdict
  without replaying the model. Cancellation fences even an in-flight worker from committing.
  Motivational and caller context share a bounded prompt budget; `result.contextTruncated`
  reports when caller context could not fit rather than silently claiming it was all used.
- `reasoning/ponder-service.js`: current provider adapter, one in-flight worker, and
  hunger-to-emotion integration. Queued work takes the first deliberative slot of the next eligible cognitive cycle,
  ahead of hypothesis generation and background narration. Local-provider deadline cancellation reaches `fetch`. A single-flight priority queue
  gives explicit deliberation the next inference slot ahead of background narration;
  cancelled waiting requests never enter the model.
- `thought-admission.js`: silent/duplicate/synthetic labels stay in telemetry, not
  episodic or working memory. Unchanged observed context backs off from one to ten minutes;
  a real app/window/presence change resets it. Internal mode changes do not. Archived tasks,
  unscoped scratch and model-authored working-memory thoughts cannot masquerade as current observations. Explicit queued work bypasses this backoff.

## API

`POST /ponder` accepts:

```json
{
  "seed": "Determine why the fixture fails",
  "doneWhen": "The reproduced failure passes its regression check",
  "priority": 0.8,
  "topic": "fixture correctness",
  "context": "Relevant task context, not outcome evidence",
  "evidence": [{"id":"run-1","source":"test log","observation":"Expected 4, received 3"}],
  "maxPasses": 3,
  "timeBudgetSeconds": 45,
  "immediate": false
}
```

Queued requests return HTTP 202 and a durable `chain_id`. `immediate=true` tries the
current worker and returns the actual state (possibly still queued if already busy).

- `GET /ponder/:id`: state, checkpoint, result, and hunger.
- `POST /ponder/:id/evidence` with `{evidence:[...]}`: append immutable new observations
  and resume. Same-ID replay is idempotent; rewriting an ID fails. Prior runs are retained.
  Up to eight evidence resumes, at most 64 evidence items.
- `POST /ponder/:id/outcome` with `{receiptId,progress,evidence,criterionMet,usefulness?}`: observed
  progress. `progress=1` requires `criterionMet=true`. Receipts are idempotent (max 100).
  Optional `usefulness` is observed benefit in [0,1], not model self-rating. It lets an
  inquiry teach its originating interest whether the investigation actually helped.
- `POST /ponder/:id/retry`: resume an interrupted/failed attempt from its checkpoint,
  within the original attempt/pass limits. Unchanged evidence cannot retry a stalled review.
- `POST /ponder/:id/cancel`: retire a want, including a running one; it no longer exerts
  pressure. Current read-only inference may finish, but its checkpoint/result cannot commit.
- `GET /oca/hunger`: active wants, pressure and selected target.
- `GET /oca/interests`: learned values, contributing receipt IDs, active inquiries,
  budgets, last collection result and any collection error.
- `GET /oca/emotion`: additive `hunger` and `motivation` fields.
- `POST /oca/reason` and `/oca/decide`: now also accept `evidence` and `maxPasses`.
- `POST /oca/reason/evaluate`: outcome evaluation now requires observed `evidence`.

`ready` means the plan is review-ready, **not that its wanted outcome happened**.
`awaiting_evidence`, `stalled`, and `budget` preserve the unsatisfied want without repeatedly
calling a model against unchanged evidence. Add an observation to resume it.
Legacy chains with no `ponder_state` remain untouched and are not silently reactivated.

## Deployment and verification

Apply `migrations/051_evidence_ponder.sql` and `migrations/052_learned_interests.sql`
before restart. Both are additive, preserving existing chains and outcomes. Run
`node --test tests/*.test.mjs` (database cases create/drop their own isolated schema).
Do not run the old `test.js` against production: it initializes the full architecture,
writes synthetic autobiographical memories, forms hypotheses and changes emotions.
Use the isolated regression tests plus an explicitly labelled live ponder fixture instead.

The full vision still needs evidence collection beyond queue records and supplied
observations, semantic interest discovery, validated outcome adapters, and longitudinal
tests showing better useful progress per unit of compute. These foundations do not establish that.
