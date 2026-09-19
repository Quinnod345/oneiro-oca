import test from 'node:test';
import assert from 'node:assert/strict';
import { createReasoner, normalizeEvidence } from '../reasoning/loop.js';
import { createWant, appetite, recordAttempt, recordOutcome } from '../motivation/hunger.js';
import { ThoughtCadence, isSubstantiveThought } from '../thought-admission.js';
import { contextMentionsProject } from '../thinker-context-policy.js';

const evidence = [{ id: 'run-1', source: 'test receipt', observation: 'The fixture returns the expected result.' }];
const proposal = { action: 'Keep the verified fixture and review the result.', claims: [{ statement: 'The fixture passed.', evidenceIds: ['run-1'] }], unknowns: [], confidence: 0.8 };
const review = Object.fromEntries(['skeptic', 'dreamer', 'empath'].map(k => [k, { argument: `${k} checked the supplied fixture receipt.`, blockers: [], evidenceIds: ['run-1'], confidence: 0.8 }]));
function scripted(outputs) {
  let calls = 0;
  const reason = createReasoner({ generate: async () => JSON.stringify(outputs[calls++]) });
  return { reason, calls: () => calls };
}
test('two stable, evidence-reviewed passes prepare a result without authorizing execution', async () => {
  const s = scripted([proposal, review, review]);
  const r = await s.reason('Review fixture', { evidence });
  assert.equal(r.status, 'converged'); assert.equal(r.readyForReview, true);
  assert.equal(r.shouldExecute, true); assert.equal(r.executionVerified, false); assert.equal(r.confidenceKind, 'self_reported');
  assert.equal(s.calls(), 3);
});
test('confident prose and fabricated evidence IDs cannot manufacture grounding', async () => {
  for (const supplied of [[], [{ id: 'other', source: 'test', observation: 'Different result' }]]) {
    const s = scripted([{ ...proposal, action: 'Definitely, certainly proceed.', confidence: 1 }, review]);
    const r = await s.reason('Review fixture', { evidence: supplied });
    assert.equal(r.status, 'needs_evidence'); assert.equal(r.readyForReview, false); assert.equal(s.calls(), 2);
  }
});
test('unchanged blockers are stalled uncertainty, never convergence', async () => {
  const blocked = structuredClone(review); blocked.skeptic.blockers = ['The fixture misses a failure case'];
  const s = scripted([proposal, blocked, proposal, blocked]);
  assert.equal((await s.reason('Review', { evidence })).status, 'stalled');
});
test('a bare stage label cannot become a ready action even if the model reviewers accept it', async () => {
  const vague = { ...proposal, action: 'propose' };
  const s = scripted([vague, review, vague, review]);
  const result = await s.reason('Review', { evidence });
  assert.equal(result.status, 'stalled');
  assert.equal(result.readyForReview, false);
  assert.ok(result.missingEvidence.some(x => x.includes('stage label')));
});
test('a new blocker on re-review forces revision instead of accepting the retained proposal', async () => {
  const blocked = structuredClone(review); blocked.skeptic.blockers = ['Inspect the failure case before relying on the fixture.'];
  const revision = { ...proposal, action: 'Inspect the fixture failure case and retain the success receipt.' };
  const s = scripted([proposal, review, blocked, revision, review]);
  const result = await s.reason('Review fixture', { evidence, maxPasses: 3 });
  assert.equal(result.status, 'budget');
  assert.equal(result.readyForReview, false);
  assert.equal(s.calls(), 5);
  assert.equal(result.passes[1].accepted, false);
  assert.equal(result.passes[2].proposal.action, revision.action);
});
test('a deadline aborts the outstanding generation and cannot produce success', async () => {
  let aborted = false;
  const reason = createReasoner({ generate: ({ signal }) => new Promise(() => {
    signal.addEventListener('abort', () => { aborted = true; });
  }) });
  // The generation never resolves, so the budget alone decides; a quarter second keeps the race margin
  // wide enough that a loaded machine (the engine verifying its own change) cannot flip it.
  const r = await reason('Review', { timeBudgetSeconds: 0.25 });
  assert.equal(r.status, 'budget'); assert.equal(r.readyForReview, false); assert.equal(aborted, true);
});
test('provider and malformed-response failures remain explicit failures', async () => {
  for (const generate of [async () => { throw new Error('offline'); }, async () => 'Probably fine']) {
    const r = await createReasoner({ generate })('Review'); assert.equal(r.status, 'failed'); assert.ok(r.error);
  }
});
test('checkpoint resume uses prior review, without replaying the completed pass', async () => {
  const first = scripted([proposal, review, 'bad']);
  const checkpoint = (await first.reason('Review', { evidence })).checkpoint;
  assert.equal(checkpoint.passes.length, 1);
  const second = scripted([review]);
  const r = await second.reason('Review', { evidence, checkpoint });
  assert.equal(r.status, 'converged'); assert.equal(second.calls(), 1);
});
test('new evidence cannot borrow an old accepted pass as proof of convergence', async () => {
  const a = scripted([proposal, review, 'bad']);
  const checkpoint = (await a.reason('Review', { evidence })).checkpoint;
  const b = scripted([proposal, review]);
  const r = await b.reason('Review', { evidence: [...evidence, { id: 'new', source: 'test', observation: 'A new case passed.' }], checkpoint, maxPasses: 2 });
  assert.equal(r.status, 'budget');
});
test('an interrupted proposal is durable but not accepted; restart resumes its review', async () => {
  let now = 0, saved;
  const first = createReasoner({ clock: () => now, generate: async () => {
    now = 1001; return JSON.stringify(proposal);
  } });
  const interrupted = await first('Review', { evidence, timeBudgetSeconds: 1,
    onCheckpoint: async c => { saved = JSON.parse(JSON.stringify(c)); } });
  assert.equal(interrupted.status, 'budget');
  assert.equal(saved.passes.length, 0);
  assert.deepEqual(saved.draft.proposal, proposal);
  assert.equal(interrupted.readyForReview, false);
  const resumed = scripted([review, review]);
  const result = await resumed.reason('Review', { evidence, checkpoint: saved });
  assert.equal(result.status, 'converged');
  assert.equal(resumed.calls(), 2, 'completed proposal must not regenerate');
  assert.equal(result.checkpoint.draft, null);
  for (const changed of [
    { goal: 'A different assignment', evidence },
    { goal: 'Review', evidence: [...evidence, { id: 'new', source: 'observed', observation: 'Changed input' }] }
  ]) {
    const fresh = scripted([proposal, review, review]);
    await fresh.reason(changed.goal, { evidence: changed.evidence, checkpoint: saved });
    assert.equal(fresh.calls(), 3, 'changed evidence or goal invalidates the pending proposal');
  }
});
test('evidence has immutable, unique IDs and bounded, explicit provenance', () => {
  assert.throws(() => normalizeEvidence([...evidence, ...evidence]));
  assert.throws(() => normalizeEvidence([{ id: 'x', observation: 'no source' }]));
});
test('hunger persists across time, plans, and serialization; it is not fed by ticks', () => {
  const want = createWant({ description: 'Understand the fixture', doneWhen: 'Failure behavior is demonstrated', value: 0.8, now: 0 });
  const later = appetite(want, 8 * 3600000);
  assert.ok(later.pressure > appetite(want, 0).pressure);
  let after = structuredClone(want);
  for (let i = 0; i < 100; i++) after = recordAttempt(after, { result: 'converged', now: i });
  assert.equal(after.progress, 0); assert.equal(appetite(after, 8 * 3600000).pressure, later.pressure);
  assert.deepEqual(appetite(JSON.parse(JSON.stringify(after)), 100), appetite(after, 100));
});
test('frustration changes strategy, observed progress feeds hunger, and replay cannot feed it twice', () => {
  let want = createWant({ description: 'Prove the fix', doneWhen: 'Reproduction passes', now: 0 });
  const initial = appetite(want, 100);
  want = recordAttempt(want, { result: 'stalled', now: 10 });
  want = recordAttempt(want, { result: 'failed', now: 20 });
  assert.equal(appetite(want, 100).mode, 'change_strategy');
  assert.notEqual(appetite(want, 100).strategy, initial.strategy);
  const receipt = { receiptId: 'r1', progress: 0.5, evidence, now: 100 };
  want = recordOutcome(want, receipt);
  assert.ok(appetite(want, 100).pressure < initial.pressure);
  assert.deepEqual(recordOutcome(want, receipt), want);
  assert.throws(() => recordOutcome(want, { ...receipt, progress: 0.7 }));
  assert.throws(() => recordOutcome(want, { ...receipt, receiptId: 'r2', progress: 1 }));
  want = recordOutcome(want, { ...receipt, receiptId: 'r2', progress: 1, criterionMet: true });
  assert.equal(appetite(want, 200).pressure, 0);
});
test('quiet labels stay out of memory and unchanged observations get backoff', () => {
  for (const text of ['— (silent tick: nothing concrete to say)', 'Proposed dream: a menu', '[no JSON parsed]', '']) assert.equal(isSubstantiveThought(text), false);
  let now = 0; const cadence = new ThoughtCadence({ clock: () => now });
  assert.equal(cadence.due('app-a'), true); cadence.record(false);
  now = 60000; assert.equal(cadence.due('app-a'), false);
  assert.equal(cadence.due('app-b'), true);
  assert.equal(contextMentionsProject({ name: 'Sill' }, ['a silly observation']), false);
  assert.equal(contextMentionsProject({ name: 'Arc' }, ['search']), false);
  assert.equal(contextMentionsProject({ name: 'Sill' }, ['Sill — project']), true);
});

test('background observation cannot reactivate archived tasks or its own generated thoughts', async () => {
  const { currentTaskRows, observedWorkspaceRows } = await import('../thinker-context-policy.js');
  assert.deepEqual(currentTaskRows([{ description: 'Old menu bar project' }], { contextParts: ['Dia'] }), []);
  assert.deepEqual(observedWorkspaceRows([{ content_type: 'thought', content: 'old generated belief' }, { content_type: 'observation', content: 'real input' }]), [{ content_type: 'observation', content: 'real input' }]);
  assert.equal(isSubstantiveThought('The previous thought about the menubar still feels relevant.'), false);
});

test('crash after the last checkpoint reconstructs convergence without another model call', async () => {
  const s = scripted([proposal, review, review]);
  const first = await s.reason('Review', { evidence, maxPasses: 2, onCheckpoint: async c => {
    if (c.passes.length === 2) throw new Error('simulated crash after commit');
  } });
  assert.equal(first.status, 'failed'); assert.equal(first.checkpoint.passes.length, 2);
  let called = false;
  const resumed = await createReasoner({ generate: async () => { called = true; throw new Error('must not run'); } })('Review', { evidence, maxPasses: 2, checkpoint: first.checkpoint });
  assert.equal(resumed.status, 'converged'); assert.equal(called, false);
});

test('explicit deliberation wins scarce inference time and cancelled waiters never run', async () => {
  const { LocalInferenceQueue } = await import('../local-inference-queue.js');
  const q = new LocalInferenceQueue(); let release; const order = [];
  const first = q.run(() => new Promise(r => { release = r; }));
  const low = q.run(async () => { order.push('background'); });
  const high = q.run(async () => { order.push('deliberation'); }, { priority: 10 });
  const ctl = new AbortController();
  const cancelled = q.run(async () => { order.push('cancelled'); }, { signal: ctl.signal, priority: 20 });
  const rejected = assert.rejects(cancelled);
  ctl.abort(); release();
  await Promise.all([first, low, high, rejected]);
  assert.deepEqual(order, ['deliberation', 'background']);
});
