import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createWant, recordOutcome } from '../motivation/hunger.js';
import { interestEvents, interestKey, projectInterest, proposeInquiry } from '../motivation/interests.js';
import { createInterestEngine } from '../motivation/interest-engine.js';
import { createPonderQueue } from '../reasoning/ponder-queue.js';

const evidence = [{ id: 'measurement-1', source: 'isolated regression fixture', observation: 'The input has one observed mismatch.' }];
function fixture(overrides = {}) {
  return { chain_id: 1, seed: 'Resolve a measured mismatch', topic: 'fixture', status: 'budget',
    want: createWant({ description: 'Resolve a measured mismatch', doneWhen: 'The measurement agrees', now: 1 }),
    evidence, checkpoint: null, result: { missingEvidence: ['Which input differs?'] }, attempts: 1,
    ...overrides };
}
function receipt(progress, id = 'r1', extra = {}) {
  return { receiptId: id, progress, criterionMet: progress === 1, evidence, now: 100, ...extra };
}

test('interest identity is stable across whitespace and case', () => {
  assert.equal(interestKey('  Test  Results '), interestKey('test results'));
  assert.notEqual(interestKey('test result'), interestKey('test results'));
});
test('a reviewer returning an evidence ID cannot turn that label into the next question', () => {
  const c = fixture({ result: { missingEvidence: ['measurement-1'], stopReason: 'pass_limit' } });
  const q = proposeInquiry(c, projectInterest(interestEvents(c)));
  assert.ok(q.question.includes('recorded passes'));
  assert.ok(!q.question.includes('measurement-1'));
});
test('friction creates a question, never usefulness credit or satiation', () => {
  const c = fixture(), i = projectInterest(interestEvents(c));
  assert.equal(i.usefulness, 0.5); assert.equal(i.evaluatedPursuits, 0);
  assert.ok(proposeInquiry(c, i).seed.includes('Which input differs?'));
  assert.ok(!proposeInquiry(c, i).seed.includes(c.seed), 'the narrow question must not repeat the parent assignment');
  assert.equal(proposeInquiry(c, i).maxPasses, 3, 'allow a revision followed by two stable accepted passes');
  assert.equal(c.want.progress, 0);
  assert.equal(proposeInquiry({ ...c, status: 'ready' }, i), null);
  assert.equal(proposeInquiry({ ...c, learning: false }, i), null);
  assert.equal(proposeInquiry({ ...c, want: { ...c.want, value: 0 } }, i), null);
});
test('observed corrections replace prior value; receipt splitting cannot amplify reward', () => {
  const c = fixture();
  c.want = recordOutcome(c.want, receipt(0.3));
  c.want = recordOutcome(c.want, receipt(0.8, 'r2'));
  const interest = projectInterest(interestEvents(c));
  const one = fixture(); one.want = recordOutcome(one.want, receipt(0.8));
  assert.equal(interest.usefulness, projectInterest(interestEvents(one)).usefulness);
  assert.equal(interest.evaluatedPursuits, 1);
  c.want = recordOutcome(c.want, receipt(0.1, 'correction', { now: 50 }));
  assert.ok(projectInterest(interestEvents(c)).usefulness < interest.usefulness, 'receipt order beats a reversed supplied timestamp');
});
test('learned usefulness changes candidate ranking for equally valued wants', () => {
  const useful = fixture(), unhelpful = fixture({ chain_id: 2 });
  useful.want = recordOutcome(useful.want, receipt(0.9));
  unhelpful.want = recordOutcome(unhelpful.want, receipt(0));
  const a = projectInterest(interestEvents(useful)), b = projectInterest(interestEvents(unhelpful));
  const next = fixture({ chain_id: 3 });
  assert.ok(proposeInquiry(next, a).priority > proposeInquiry(next, b).priority);
});
test('inquiry completion without usefulness feedback earns no learned-value credit', () => {
  const c = fixture({ origin: { kind: 'interest', interestKey: interestKey('fixture'), parentChainId: 2 } });
  c.want = recordOutcome(c.want, receipt(1));
  assert.deepEqual(interestEvents(c), []);
  assert.equal(proposeInquiry(c, { usefulness: 0.5 }), null, 'inquiries cannot breed inquiries');
  c.want = recordOutcome(c.want, receipt(1, 'reviewed-benefit', { usefulness: 0 }));
  assert.ok(projectInterest(interestEvents(c)).usefulness < 0.5);
  assert.throws(() => recordOutcome(c.want, receipt(1, 'invalid', { usefulness: 2 })));
  const repeated = recordOutcome(c.want, receipt(1, 'reviewed-benefit', { usefulness: 0 }));
  assert.equal(repeated.receipts.length, 2);
});
test('question rephrasing and evidence ID churn are not novel experience', () => {
  const c = fixture(), i = projectInterest(interestEvents(c));
  const a = proposeInquiry(c, i);
  const b = proposeInquiry({ ...c, result: { missingEvidence: ['A differently worded question'] }, evidence: [{ ...evidence[0], id: 'renamed' }] }, i);
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(a.fingerprint, proposeInquiry({ ...c, evidence: [...c.evidence, { ...evidence[0], id: 'new-label', source: 'renamed source' }] }, i).fingerprint);
  assert.notEqual(a.fingerprint, proposeInquiry({ ...c, evidence: [{ ...evidence[0], observation: 'A newly measured value differs.' }] }, i).fingerprint);
});
test('telemetry provenance cannot collide with caller evidence IDs', () => {
  const c = fixture(), i = projectInterest(interestEvents(c));
  c.evidence = [{ ...evidence[0], id: interestEvents(c)[0].evidence[0].id }];
  const q = proposeInquiry(c, i);
  assert.equal(new Set(q.evidence.map(e => e.id)).size, q.evidence.length);
});
test('later observed corrections accompany an inquiry instead of leaving it with stale premises', () => {
  const c = fixture();
  c.want = recordOutcome(c.want, receipt(0.5, 'corrected', { evidence: [{ ...evidence[0], observation: 'The earlier mismatch is fixed; the second input remains unmeasured.' }] }));
  const q = proposeInquiry(c, projectInterest(interestEvents(c)));
  assert.ok(q.evidence.some(e => e.id.startsWith('outcome-') && e.observation.includes('mismatch is fixed')));
  assert.equal(new Set(q.evidence.map(e => e.id)).size, q.evidence.length);
});
test('new input can retire an older outcome receipt using its stable evidence ID', () => {
  const c = fixture();
  c.want = recordOutcome(c.want, receipt(0.3, 'old-receipt', { evidence: [{ id: 'obsolete-observation', source: 'earlier test', observation: 'Earlier result.' }] }));
  c.evidence = [...evidence, { id: 'later-observation', source: 'later test', observation: 'Corrected result.', supersedes: ['obsolete-observation'] }];
  const q = proposeInquiry(c, projectInterest(interestEvents(c)));
  assert.ok(q.evidence.some(e => e.id === 'later-observation'));
  assert.ok(!q.evidence.some(e => e.observation === 'Earlier result.'));
});

async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'interest_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema + ',public' });
    await pool.query(`CREATE TABLE thought_chains (
      id SERIAL PRIMARY KEY, seed TEXT NOT NULL, priority FLOAT8 DEFAULT .5,
      status TEXT DEFAULT 'pondering', depth INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), ponder_state JSONB)`);
    await pool.query(await readFile(new URL('../migrations/052_learned_interests.sql', import.meta.url), 'utf8'));
    await run(pool);
  } finally {
    if (pool) await pool.end();
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await admin.end();
  }
}
const blocked = async () => ({ status: 'needs_evidence', checkpoint: { version: 1, passes: [] }, missingEvidence: ['Which input differs?'] });
async function blockedParent(queue, topic = 'fixture', options = {}) {
  const c = await queue.enqueue({ seed: 'Resolve ' + topic, topic, evidence, ...options });
  await queue.runNext(c.chain_id);
  return queue.get(c.chain_id);
}

test('SQL lifecycle: originate, prioritize explicit work, learn receipts, avoid repeats and revoke children', async () => database(async pool => {
  let now = Date.now();
  const clock = () => now, queue = createPonderQueue({ pool, reason: blocked, clock });
  const engine = createInterestEngine({ pool, queue, clock });
  const parent = await blockedParent(queue);
  const created = await engine.sync();
  assert.ok(created.originated);
  const child = await queue.get(created.originated.chain_id);
  assert.equal(child.origin.parentChainId, parent.chain_id);
  assert.notEqual(child.seed, parent.seed);
  assert.ok(child.hunger.pressure > 0);
  const replay = await engine.sync();
  assert.equal(replay.ingested, 0); assert.equal(replay.originated, null);

  const explicit = await queue.enqueue({ seed: 'Explicit low-priority work', priority: 0.01, learning: false });
  assert.equal((await queue.runNext()).chain_id, explicit.chain_id, 'intrinsic curiosity cannot jump explicit work');
  await queue.cancel(explicit.chain_id);
  await queue.runNext(child.chain_id);
  assert.equal((await engine.sync()).ingested, 0, 'generated inquiry results do not become new experiences');
  await queue.outcome(child.chain_id, receipt(1, 'resolved-question', { usefulness: 0 }));
  const learned = await engine.sync();
  assert.equal(learned.ingested, 1);
  assert.ok((await engine.list()).interests[0].usefulness < 0.5);
  assert.equal((await engine.sync()).ingested, 0);
  await queue.addEvidence(parent.chain_id, [{ id: 'new-input', source: 'fixture', observation: 'The second input is now measured.' }]);
  await queue.runNext(parent.chain_id);
  assert.equal((await engine.sync()).suppression, 'interest_cooldown');
  now += 6 * 3600000 + 1;
  const next = await engine.sync(); assert.ok(next.originated);
  await queue.cancel(parent.chain_id);
  const cancelled = await queue.get(next.originated.chain_id);
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.hunger.pressure, 0);
  assert.equal((await engine.sync()).originated, null);
  assert.equal((await engine.list()).interests[0].activeInquiries, 0);
}));

test('SQL concurrency and restart keep one durable origin and journal', async () => database(async pool => {
  const queue = createPonderQueue({ pool, reason: blocked });
  await blockedParent(queue);
  const a = createInterestEngine({ pool, queue }), b = createInterestEngine({ pool, queue });
  const results = await Promise.all([a.sync(), b.sync()]);
  assert.equal(results.filter(r => r.originated).length, 1);
  const restored = createInterestEngine({ pool, queue });
  assert.equal((await restored.sync()).ingested, 0);
  assert.equal((await restored.list()).interests.length, 1);
  const { rows: [count] } = await pool.query('SELECT COUNT(*)::int AS n FROM interest_pursuits');
  assert.equal(count.n, 1);
}));

test('SQL origin failure rolls back learning and queue insertion together', async () => database(async pool => {
  const queue = createPonderQueue({ pool, reason: blocked });
  await blockedParent(queue);
  const engine = createInterestEngine({ pool, queue: { enqueue: async (...args) => { await queue.enqueue(...args); throw new Error('injected commit interruption'); } } });
  await assert.rejects(engine.sync(), /injected/);
  const { rows: [count] } = await pool.query('SELECT COUNT(*)::int AS n FROM thought_chains');
  assert.equal(count.n, 1);
  assert.equal((await engine.list()).interests.length, 0);
  assert.ok((await createInterestEngine({ pool, queue }).sync()).originated);
}));

test('SQL exploratory work respects the shared daily budget across distinct interests', async () => database(async pool => {
  let now = Date.now(); const clock = () => now;
  const queue = createPonderQueue({ pool, reason: blocked, clock });
  const engine = createInterestEngine({ pool, queue, clock });
  for (let n = 0; n < 4; n++) await blockedParent(queue, 'fixture-' + n);
  for (let n = 0; n < 3; n++) assert.ok((await engine.sync()).originated);
  const stopped = await engine.sync();
  assert.equal(stopped.originated, null); assert.equal(stopped.suppression, 'daily_budget');
  now += 86400001;
  assert.ok((await engine.sync()).originated);
}));

test('SQL closing a parent during a child pass fences the stale completion', async () => database(async pool => {
  const queue = createPonderQueue({ pool, reason: blocked });
  const parent = await blockedParent(queue);
  const created = await createInterestEngine({ pool, queue }).sync();
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  const worker = createPonderQueue({ pool, reason: async () => { started(); await gate; return blocked(); } });
  const running = worker.runNext(created.originated.chain_id);
  await ready;
  await queue.outcome(parent.chain_id, receipt(1));
  release();
  const result = await running;
  assert.equal(result.status, 'cancelled'); assert.equal(result.hunger.pressure, 0);
}));

test('SQL long user context and motivation remain inside the reasoner input contract', async () => database(async pool => {
  let seen;
  const queue = createPonderQueue({ pool, reason: async (goal, options) => { seen = options.context; return blocked(); } });
  const c = await queue.enqueue({ seed: 'G'.repeat(12000), context: '\n'.repeat(20000), doneWhen: '\n'.repeat(12000) + 'Observed criterion' });
  await queue.runNext(c.chain_id);
  assert.ok(seen.length <= 24000); assert.ok(seen.includes('Motivation:'));
}));
test('SQL JSON escaping cannot push motivational context over its budget, and truncation is visible', async () => database(async pool => {
  const seen = [];
  const queue = createPonderQueue({ pool, reason: async (goal, options) => {
    seen.push(options.context);
    return { status: 'failed', conclusion: '\u0001'.repeat(2000), missingEvidence: Array(6).fill('\u0001'.repeat(500)), checkpoint: null };
  } });
  const c = await queue.enqueue({ seed: 'Inspect an unusual observation', context: 'x'.repeat(20000), doneWhen: '\u0001'.repeat(2000) });
  await queue.runNext(c.chain_id);
  await queue.retry(c.chain_id);
  const result = await queue.runNext(c.chain_id);
  assert.ok(seen.every(context => context.length <= 24000));
  assert.equal(result.result.contextTruncated, true);
}));
