import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { createPonderQueue } from '../reasoning/ponder-queue.js';
const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
const evidence = [{ id: 'receipt-1', source: 'isolated fixture', observation: 'The requested check passed.' }];

test('durable queue: concurrent claims, checkpoints, restart, immutable evidence and outcome receipts', async () => {
  const schema = `oca_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ connectionString: dsn, options: `-c search_path=${schema},public` });
    await pool.query(`CREATE TABLE thought_chains (
      id SERIAL PRIMARY KEY, seed TEXT NOT NULL, priority FLOAT8 DEFAULT .5,
      status TEXT DEFAULT 'pondering', depth INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), ponder_state JSONB)`);
    let calls = 0;
    const reason = async (goal, options) => {
      calls++;
      const checkpoint = { version: 1, passes: [{ pass: 1 }] };
      await options.onCheckpoint(checkpoint);
      return { status: 'needs_evidence', conclusion: 'Inspect the observed outcome', missingEvidence: ['outcome receipt'], checkpoint };
    };
    const queue = createPonderQueue({ pool, reason, clock: () => 1000 });
    const a = await queue.enqueue({ seed: 'Prove the correction', doneWhen: 'Regression is demonstrated', priority: 0.9 });
    const b = await queue.enqueue({ seed: 'Read a lower value observation', priority: 0.2 });
    const runs = await Promise.all([queue.runNext(), queue.runNext()]);
    assert.equal(calls, 2); assert.equal(new Set(runs.map(r => r.chain_id)).size, 2);
    const saved = await queue.get(a.chain_id);
    assert.equal(saved.status, 'awaiting_evidence'); assert.equal(saved.checkpoint.passes.length, 1);
    assert.ok(saved.hunger.pressure > 0); assert.equal(saved.want.progress, 0);
    assert.equal(await queue.runNext(), null, 'blocked wants do not spin the model');
    await queue.addEvidence(a.chain_id, evidence);
    const replay = await queue.addEvidence(a.chain_id, evidence);
    assert.equal(replay.priorRuns.length, 1, 'replayed input does not reset the run again');
    await assert.rejects(queue.addEvidence(a.chain_id, [{ ...evidence[0], observation: 'rewritten' }]));
    const restored = createPonderQueue({ pool, reason, clock: () => 1000 });
    assert.equal((await restored.get(a.chain_id)).evidence.length, 1);
    await restored.runNext();
    await restored.outcome(a.chain_id, { receiptId: 'check-1', progress: 1, criterionMet: true, evidence });
    const sated = await restored.get(a.chain_id);
    const replayed = await restored.outcome(a.chain_id, { receiptId: 'check-1', progress: 1, criterionMet: true, evidence });
    assert.equal(replayed.want.receipts.length, 1, 'JSONB key ordering does not break receipt replay');
    assert.equal(sated.status, 'resolved'); assert.equal(sated.hunger.pressure, 0);
    await assert.rejects(restored.addEvidence(a.chain_id, [{ id: 'new', source: 'fixture', observation: 'new' }]));
    const corrected = await restored.outcome(a.chain_id, { receiptId: 'check-correction', progress: 0.5, criterionMet: false, evidence });
    assert.equal(corrected.status, 'ready');
    assert.ok(corrected.hunger.pressure > 0);
    await restored.cancel(a.chain_id);
    await restored.cancel(b.chain_id);
    assert.equal((await restored.hunger()).wants.length, 0);

    // A crashed worker's durable checkpoint is reclaimed after lease expiry.
    const crashed = await restored.enqueue({ seed: 'Resume interrupted review' });
    await pool.query(`UPDATE thought_chains SET status = 'running', ponder_state = ponder_state || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ lease: 'dead-worker', leaseUntil: 999, checkpoint: { version: 1, passes: [{ pass: 1 }] } }), crashed.chain_id]);
    let resumed = false;
    const recover = createPonderQueue({ pool, clock: () => 1000, reason: async (goal, options) => {
      resumed = options.checkpoint.passes.length === 1;
      return { status: 'budget', checkpoint: options.checkpoint };
    } });
    assert.equal((await recover.runNext()).status, 'budget'); assert.equal(resumed, true);

    // An unexpired lease cannot be stolen, and its input cannot change underneath it.
    const held = await restored.enqueue({ seed: 'Do not overlap a running pass' });
    await pool.query(`UPDATE thought_chains SET status = 'running', ponder_state = ponder_state || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ lease: 'live-worker', leaseUntil: 999999 }), held.chain_id]);
    assert.equal(await restored.runNext(), null);
    await assert.rejects(restored.addEvidence(held.chain_id, evidence));
    const cancelled = await restored.cancel(held.chain_id);
    assert.equal(cancelled.status, 'cancelled');
    assert.notEqual(cancelled.lease, 'live-worker');
    assert.equal(cancelled.hunger.pressure, 0);

    // Mid-pass work survives a worker replacement and can resume automatically,
    // but the existing three-attempt cap still stops repeated deadline failures.
    const draftCheckpoint = { version: 1, goal: 'Slow review', passes: [],
      draft: { pass: 1, evidenceKey: 'fixture', proposal: { action: 'Inspect the fixture.' } } };
    let resumedDraft = false;
    const slowReason = async (goal, opts) => {
      if (opts.checkpoint?.draft) resumedDraft = true;
      await opts.onCheckpoint(draftCheckpoint);
      return { status: 'budget', stopReason: 'deadline', checkpoint: draftCheckpoint };
    };
    const slow = createPonderQueue({ pool, reason: slowReason });
    const pending = await slow.enqueue({ seed: 'Slow review' });
    assert.equal((await slow.runNext(pending.chain_id)).attempts, 1);
    const replacement = createPonderQueue({ pool, reason: slowReason });
    assert.equal((await replacement.runNext(pending.chain_id)).attempts, 2);
    assert.equal(resumedDraft, true);
    assert.equal((await replacement.runNext(pending.chain_id)).attempts, 3);
    assert.equal(await replacement.runNext(pending.chain_id), null);
    assert.equal((await replacement.get(pending.chain_id)).want.progress, 0);
    await replacement.cancel(pending.chain_id);
    const empty = createPonderQueue({ pool, reason: async () => ({ status: 'budget', stopReason: 'deadline',
      checkpoint: { version: 1, passes: [] } }) });
    const emptyTask = await empty.enqueue({ seed: 'No output' });
    await empty.runNext(emptyTask.chain_id);
    assert.equal(await empty.runNext(emptyTask.chain_id), null, 'no-progress timeouts must not spin inference');
    await empty.cancel(emptyTask.chain_id);

  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
