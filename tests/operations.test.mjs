import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { createOperations, weekOfRuns, selfCriterion, isoWeek, similarTask, WEEK, DAY, MIN_RUNS } from '../evaluation/operations.js';
import { recordOutcome } from '../motivation/hunger.js';
import { renderMeasured } from '../evaluation/readme-table.js';

async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'ops_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema + ',public' });
    await pool.query(`CREATE TABLE thought_chains (id SERIAL PRIMARY KEY, seed TEXT NOT NULL, status TEXT DEFAULT 'awaiting_evidence', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), ponder_state JSONB)`);
    await pool.query(`CREATE TABLE self_build_events (id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, chain_id INT, payload JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await pool.query(`CREATE TABLE worth_signals (id TEXT PRIMARY KEY, entity_key TEXT NOT NULL, kind TEXT NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    for (const m of ['062_agent_deployments', '064_pursuit_board']) await pool.query(await readFile(new URL(`../migrations/${m}.sql`, import.meta.url), 'utf8'));
    await run(pool);
  } finally { if (pool) await pool.end(); await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end(); }
}
const quiet = { log() {}, warn() {} };
let seq = 0;
const row = (o) => ({ id: o.id || `r${++seq}`, chain_id: o.chain ?? 27, kind: o.kind || 'research', task: o.task || `Task ${randomUUID().replace(/-/g, ' ')}`, status: o.status,
  error: o.error || null, report: o.report || null, created_at: new Date(o.start), ended_at: o.end == null ? null : new Date(o.end) });
async function insert(pool, r) {
  await pool.query(`INSERT INTO agent_deployments (id, chain_id, kind, task, brief, session_key, agent_id, display_name, status, error, report, created_at, updated_at, ended_at)
    VALUES ($1,$2,$3,$4,'b',$5,'main','d',$6,$7,$8,$9,$9,$10)`, [randomUUID(), r.chain_id, r.kind, r.task, `k-${randomUUID()}`, r.status, r.error, r.report ? JSON.stringify(r.report) : null, r.created_at, r.ended_at]);
}

test('a week of runs: a provider stop is not the engine\'s fault, a claimed done is not productive, and a repeat of a recent failure went wrong', () => {
  const to = Date.parse('2026-09-21T00:00:00Z'), from = to - WEEK;
  const task = 'Verify the subscription prices and billing intervals in the store listing';
  const runs = [
    row({ status: 'failed', task, error: 'turn budget of 12 spent without a result', start: from - DAY, end: from - DAY + 3600e3 }),     // last week: a stall
    row({ status: 'failed', task: task + ' again', error: 'no result', start: from + DAY, end: from + DAY + 600e3 }),                    // repeats it: failed and repeated
    row({ status: 'done', task: 'Verify the subscription prices and billing intervals in the listing now', report: { verified: [] }, start: from + 2 * DAY, end: from + 2 * DAY + 600e3 }),   // repeat, claimed done
    row({ status: 'done', report: { verified: [{ id: 'v' }] }, start: from + 3 * DAY, end: from + 3 * DAY + 60e3 }),                    // productive
    row({ status: 'done', report: { summary: 'All done.' }, start: from + 3 * DAY, end: from + 3 * DAY + 60e3 }),                       // a claim only
    row({ status: 'failed', error: "You're out of usage credits.", start: from + 4 * DAY, end: from + 4 * DAY + 60e3 }),               // provider
    row({ status: 'cancelled', start: from + 4 * DAY, end: from + 4 * DAY + 60e3 }),
    row({ status: 'running', start: from + 5 * DAY }),
    row({ kind: 'builder', chain: 34, status: 'done', report: {}, start: from + 5 * DAY, end: from + 5 * DAY + 60e3 }),                 // its fix merged afterwards
  ];
  const merges = [{ chain_id: 34, kind: 'merged', created_at: new Date(from + 5 * DAY + 120e3) }];
  const w = weekOfRuns(runs, runs, merges, from, to);
  assert.equal(w.finished, 6); assert.equal(w.providerStopped, 1); assert.equal(w.counted, 5); assert.equal(w.cancelled, 1);
  assert.equal(w.failed, 1); assert.equal(w.repeated, 2); assert.equal(w.wentWrong, 2, 'a failed repeat is one run gone wrong, not two');
  assert.equal(w.productive, 2, 'the verified run and the builder whose fix merged; a "done" with nothing confirmed does not count');
  assert.equal(w.measurable, false, `fewer than ${MIN_RUNS} runs: a rate, but not one to compare`);
  const last = weekOfRuns(runs, runs, merges, from - WEEK, from);
  assert.equal(last.stalled, 1); assert.equal(last.failed, 1);
  assert.ok(similarTask(task, task + ' again') && !similarTask(task, 'Publish the launch post on the social account today'));
});

test('the self criterion needs a merged fix and fewer runs gone wrong than the week before, measured on enough runs', () => {
  const week = (counted, wentWrong) => ({ counted, measurable: counted >= MIN_RUNS, rates: { wentWrong: counted ? wentWrong / counted : null } });
  const both = selfCriterion(week(20, 4), week(30, 12), { merged: 2 });
  assert.equal(both.met, true); assert.equal(both.progress, 0.9); assert.match(both.why, /2 of its own fixes merged; 20% of runs went wrong against 40% the week before \(fewer\)/);
  const worse = selfCriterion(week(20, 10), week(30, 12), { merged: 1 });
  assert.equal(worse.met, false); assert.equal(worse.progress, 0.45);
  const thin = selfCriterion(week(4, 0), week(30, 12), { merged: 0 });
  assert.equal(thin.comparable, false); assert.equal(thin.progress, 0); assert.match(thin.why, /not measurable \(4 and 30 runs; needs 10/);
  assert.deepEqual(isoWeek(Date.parse('2026-09-24T12:00:00Z')), { label: '2026-W39', from: Date.parse('2026-09-21T00:00:00Z'), to: Date.parse('2026-09-28T00:00:00Z') });
});

test('measured from the journals, and at each week\'s end recorded on the self pursuit once, as a receipt that can never close it', async () => database(async pool => {
  const now = Date.parse('2026-09-24T12:00:00Z');
  const judged = isoWeek(now - WEEK);   // 2026-W38: Sep 14–21
  const selfState = { standing: 'self', want: { description: 'Keep getting better', status: 'active', progress: 0, receipts: [], failedAttempts: 0, strategy: 0, lastProgressAt: 0 } };
  const { rows: [self] } = await pool.query(`INSERT INTO thought_chains (seed, ponder_state) VALUES ('self', $1) RETURNING id`, [JSON.stringify(selfState)]);
  // W37: 12 runs, 6 wrong; W38: 12 runs, 2 wrong, one fix merged
  for (let i = 0; i < 12; i++) await insert(pool, row({ status: i < 6 ? 'failed' : 'done', error: i < 6 ? 'no result' : null, start: judged.from - WEEK + i * 3600e3, end: judged.from - WEEK + i * 3600e3 + 60e3 }));
  for (let i = 0; i < 12; i++) await insert(pool, row({ status: i < 2 ? 'failed' : 'done', error: i < 2 ? 'no result' : null, report: i >= 2 ? { verified: [{ id: 'x' }] } : null, start: judged.from + i * 3600e3, end: judged.from + i * 3600e3 + 60e3 }));
  await pool.query(`INSERT INTO self_build_events (kind, chain_id, created_at) VALUES ('merged', 34, $1), ('merged', 35, $2), ('recurred', 35, $3)`,
    [new Date(judged.from + 2 * DAY), new Date(judged.from - 3 * DAY), new Date(judged.from - DAY)]);
  await pool.query(`INSERT INTO worth_signals (id, entity_key, kind, payload, created_at) VALUES ('rate:note:a.md', 'self:message', 'rated', '{"rating": 1}', $1)`, [new Date(now - DAY)]);
  const recorded = [];
  const queue = { async outcome(id, receipt, opts) {
    recorded.push({ id, receipt, opts });
    const want = recordOutcome(selfState.want, { ...receipt, now });   // the real rule the queue applies
    assert.equal(want.status, 'active', 'a weekly receipt never sates the standing pursuit');
    selfState.want = want;
    await pool.query(`UPDATE thought_chains SET ponder_state = $2 WHERE id = $1`, [id, JSON.stringify(selfState)]);
  } };
  const ops = createOperations({ pool, queue, clock: () => now, log: quiet });
  const m = await ops.measure({ end: judged.to });
  assert.equal(m.thisWeek.counted, 12); assert.equal(m.thisWeek.wentWrong, 2); assert.equal(m.lastWeek.wentWrong, 6);
  assert.equal(m.thisWeek.productive, 10); assert.equal(m.fixes.merged, 1);
  assert.equal(m.fixes.matured, 2); assert.equal(m.fixes.recurred, 1); assert.equal(m.fixes.holding, 1);
  assert.equal(m.selfCriterion.met, true);
  const live = await ops.measure();
  assert.equal(live.verdicts.rated, 1); assert.equal(live.verdicts.useful, 1);
  const s = await ops.settleWeek();
  assert.equal(s.receiptId, 'operations-2026-W38'); assert.equal(s.progress, 0.9);
  assert.equal(recorded.length, 1); assert.equal(recorded[0].id, self.id); assert.deepEqual(recorded[0].opts, { park: true });
  const r = recorded[0].receipt;
  assert.equal(r.criterionMet, false); assert.match(r.evidence[0].source, /runtime journals/); assert.match(r.evidence[0].observation, /Week 2026-W38: 1 of its own fix merged; 17% of runs went wrong against 50%/);
  assert.equal(await ops.settleWeek(), null, 'once a week, not once a tick');
  assert.equal(recorded.length, 1);
  // and the README block shows the same measurement
  const block = renderMeasured({ ran_at: new Date(now).toISOString(), mechanism: null, scorecard: { error: 'n/a' }, operations: m });
  for (const x of ['**Operations**', '| went wrong (failed, or repeated a recent failure) | 2 (17%) | 6 (50%) |', '| its own fixes merged | 1 |', '1 of 2 holding, 1 recurred']) assert.ok(block.includes(x), x);
}));
