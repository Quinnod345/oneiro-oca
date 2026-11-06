import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { createSince, parseSince, classify } from '../reasoning/since.js';

const quiet = { log() {}, warn() {} };
async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'since_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema + ',public' });
    await pool.query(`CREATE TABLE thought_chains (id SERIAL PRIMARY KEY, seed TEXT NOT NULL, priority FLOAT8 DEFAULT .5, status TEXT DEFAULT 'pondering', depth INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), ponder_state JSONB)`);
    await pool.query(await readFile(new URL('../migrations/062_agent_deployments.sql', import.meta.url), 'utf8'));
    await run(pool);
  } finally { if (pool) await pool.end(); await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end(); }
}
const pursuit = async (pool, { seed, status = 'pondering', want = {}, at }) => (await pool.query(
  `INSERT INTO thought_chains (seed, status, ponder_state, updated_at) VALUES ($1, $2, $3, $4) RETURNING id`,
  [seed, status, JSON.stringify({ want: { description: seed, status: 'active', progress: 0, receipts: [{ id: 'r' }], ...want } }), new Date(at)])).rows[0].id;
const run = (pool, chainId, { status, kind = 'research', task, error = null, at }) => pool.query(
  `INSERT INTO agent_deployments (id, chain_id, kind, task, brief, session_key, agent_id, status, error, created_at, updated_at, ended_at) VALUES ($1,$2,$3,$4,'b',$5,'main',$6,$7,$8,$8,$8)`,
  [randomUUID(), chainId, kind, task, `k-${randomUUID()}`, status, error, new Date(at)]);

test('since: the moment is read from milliseconds or an ISO date, never guessed', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  assert.equal(parseSince('1762300000000', now), 1762300000000);
  assert.equal(parseSince('2026-11-01T09:00:00Z', now), Date.parse('2026-11-01T09:00:00Z'));
  assert.equal(parseSince('2027-01-01T00:00:00Z', now), now, 'a future moment is now');
  for (const bad of [undefined, '', 'yesterday', '0', '-5']) assert.equal(parseSince(bad, now), null, `${bad} is refused`);
  const out = classify([
    { id: 1, seed: 'a', status: 'resolved', want: { status: 'sated' }, updated_at: now },
    { id: 2, seed: 'b', status: 'stalled', want: { status: 'active' }, updated_at: now },
    { id: 3, seed: 'c', status: 'pondering', want: { status: 'active', progress: 0.4 }, updated_at: now },
    { id: 4, seed: 'd', status: 'cancelled', want: { status: 'cancelled' }, updated_at: now },
  ]);
  assert.deepEqual([out.finished.map(p => p.chainId), out.failed.map(p => p.chainId), out.moved.map(p => p.chainId)], [[1], [2], [3]], 'cancelled is the person\'s own doing, not news');
});

test('since you were last here: what finished, what failed, what moved and what waits on you, from what the engine recorded', async () => database(async pool => {
  const now = Date.parse('2026-11-05T12:00:00Z'), left = now - 3 * 86400_000;
  const done = await pursuit(pool, { seed: 'Ship the landing page', status: 'resolved', want: { status: 'sated', progress: 1 }, at: now - 86400_000 });
  const stuck = await pursuit(pool, { seed: 'Get ten beta users', status: 'budget', at: now - 2 * 86400_000 });
  const going = await pursuit(pool, { seed: 'Learn the C major scale', status: 'awaiting_evidence', want: { progress: 0.35 }, at: now - 3600_000 });
  await pursuit(pool, { seed: 'Old news', status: 'resolved', want: { status: 'sated' }, at: left - 3600_000 });
  await pursuit(pool, { seed: 'Changed my mind', status: 'cancelled', want: { status: 'cancelled' }, at: now - 7200_000 });
  await run(pool, going, { status: 'done', task: 'Find a practice plan', at: now - 5000_000 });
  await run(pool, stuck, { status: 'failed', task: 'Post in r/macapps', error: 'turn budget spent', at: now - 4000_000 });
  await run(pool, stuck, { status: 'failed', task: 'Before you left', error: 'x', at: left - 1000 });
  const inbox = { list: async () => ({
    asks: [{ id: 41, chainId: stuck, kind: 'sign_in', detail: 'Sign in to reddit.com in Aside', at: new Date(now - 600_000) },
           { id: 7, chainId: going, kind: 'question', message: 'Which piano?', at: new Date(left - 600_000) },
           { id: 42, chainId: stuck, kind: 'question', payment: true, detail: 'Approve $12.98 on namecheap.com?', at: new Date(now - 60_000) }],
    toRate: [{ kind: 'artifact', id: `${going}/plan.md`, chainId: going, title: 'Practice plan', at: now - 5000_000 }] }) };
  const since = createSince({ pool, inbox, clock: () => now, log: quiet });
  const d = await since.digest(left);

  assert.equal(d.since, new Date(left).toISOString()); assert.equal(d.awayMs, 3 * 86400_000);
  assert.deepEqual(d.finished.map(p => p.chainId), [done], 'finished since then, not before');
  assert.equal(d.finished[0].title, 'Ship the landing page');
  assert.deepEqual(d.failed.map(p => [p.chainId, p.status]), [[stuck, 'budget']]);
  assert.deepEqual(d.moved.map(p => [p.chainId, p.progress]), [[going, 0.35]]);
  assert.deepEqual(d.agentFailures.map(f => [f.task, f.why]), [['Post in r/macapps', 'turn budget spent']], 'only runs that failed while away');
  assert.deepEqual(d.counts, { finished: 1, failed: 2, moved: 1, waiting: 4, newWaiting: 3, agentsDone: 1, agentsFailed: 1 });
  assert.deepEqual(d.waiting.asks.map(a => [a.id, a.isNew]), [[41, true], [7, false], [42, true]], 'an ask from before is still waiting, just not new');
  assert.equal(d.waiting.asks[2].payment, true, 'a payment says so, so the app can say how it is approved');
  assert.equal(d.waiting.asks[1].text, 'Which piano?');
  assert.deepEqual(d.waiting.toRate.map(i => [i.id, i.isNew]), [[`${going}/plan.md`, true]]);

  // nothing since a minute ago but what is still waiting
  const recent = await since.digest(now - 30_000);
  assert.deepEqual([recent.finished.length, recent.failed.length, recent.moved.length, recent.counts.newWaiting], [0, 0, 0, 0]);
  assert.equal(recent.counts.waiting, 4);

  // the engine still answers when the inbox can't
  const blind = await createSince({ pool, inbox: { list: async () => { throw new Error('db busy'); } }, clock: () => now, log: quiet }).digest(left);
  assert.equal(blind.counts.waiting, 0); assert.equal(blind.finished.length, 1);
}));

test('the trail: dated, newest first, from what the engine already recorded, names over seeds, and a missing source is said', () => database(async pool => {
  const now = Date.parse('2026-11-05T12:00:00Z'), hour = 3_600_000;
  const named = await pursuit(pool, { seed: 'Find a great beginner bike under $500', status: 'pondering', at: now - hour });
  await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{continuity}', '{"board":{"headline":"Beginner bike"}}') WHERE id = $1`, [named]);
  const done = await pursuit(pool, { seed: 'Ship it', status: 'resolved', want: { status: 'sated' }, at: now - 2 * hour });
  const old = await pursuit(pool, { seed: 'Long ago', status: 'resolved', want: { status: 'sated' }, at: now - 40 * 86_400_000 });
  const fixture = await pursuit(pool, { seed: '[verification fixture v2] Review only whether', status: 'pondering', at: now - hour });
  const gone = await pursuit(pool, { seed: 'Deleted one', at: now - hour });
  await pool.query(`UPDATE thought_chains SET ponder_state = ponder_state || '{"deleted":{"at":1}}' WHERE id = $1`, [gone]);
  await run(pool, named, { status: 'done', task: 'Compare three bikes', at: now - 3 * hour });
  await run(pool, named, { status: 'failed', task: 'Call the shop', error: 'no phone', at: now - 4 * hour });
  await run(pool, fixture, { status: 'done', task: 'Fixture work', at: now - 3 * hour });
  await run(pool, gone, { status: 'done', task: 'Deleted work', at: now - 3 * hour });
  await run(pool, old, { status: 'done', task: 'Old work', at: now - 40 * 86_400_000 });
  const inbox = { list: async () => ({
    toRate: [{ kind: 'artifact', id: `${named}/plan.md`, chainId: named, title: 'Bike plan', at: now - 5 * hour }],
    judged: [{ kind: 'artifact', id: `${named}/first.md`, chainId: named, title: 'First list', verdict: 'useful', at: now - 6 * hour }] }) };
  const night = { history: async () => ({ runs: [
    { id: 4, trigger: 'scheduled', status: 'finished', finishedAt: new Date(now - 7 * hour).toISOString(), report: { headline: "Some sources couldn't be read", problems: ['x'] } },
    { id: 3, trigger: 'manual', status: 'finished', finishedAt: new Date(now - 8 * hour).toISOString(), report: { headline: 'Nothing new to read', problems: [] } }] }),
    noticeFor: ({ report }) => (report.problems.length ? { title: 'The night had problems', trouble: true } : null), notice: async () => null };
  const since = createSince({ pool, inbox, night, clock: () => now, log: quiet });
  const t = await since.trail(now - 14 * 86_400_000);
  assert.deepEqual(t.items.map(i => i.kind), ['finished', 'agent', 'agentFailed', 'delivered', 'judged', 'nightTrouble', 'night']);
  assert.equal(t.items[1].detail, 'Beginner bike', 'an agent names its pursuit by its name');
  assert.match(t.items[1].title, /finished$/); assert.match(t.items[2].title, /didn't finish$/);
  assert.equal(t.items[1].chainId, named); assert.ok(t.items[1].agentId);
  assert.equal(t.items[3].workId, `${named}/plan.md`);
  assert.equal(t.items[4].detail, 'You judged it Useful');
  assert.equal(t.items[5].title, 'The night had problems'); assert.equal(t.items[6].title, 'The night ran');
  const all = JSON.stringify(t.items);
  assert.doesNotMatch(all, /fixture|Fixture|Deleted|Long ago|Old work/);
  assert.deepEqual(t.missing, []);
  assert.deepEqual((await since.trail(now - 14 * 86_400_000, 2)).items.length, 2);
  const blind = await createSince({ pool, inbox: { list: async () => { throw new Error('db busy'); } }, clock: () => now, log: quiet }).trail(now - 86_400_000);
  assert.deepEqual(blind.missing, ['what was delivered and judged']);
  assert.ok(blind.items.length > 0, 'and the rest still shows');
}));
