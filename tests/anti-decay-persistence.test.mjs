import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes } from 'node:crypto';

// Database writes run against a private schema, with no public-schema fallback.
const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
const schema = 'anti_decay_test_' + randomBytes(6).toString('hex');
const admin = new pg.Pool({ connectionString: dsn });
await admin.query('CREATE SCHEMA ' + schema);
const isolated = new URL(dsn);
isolated.searchParams.set('options', '-c search_path=' + schema);
process.env.DATABASE_URL = isolated.toString();
const { pool } = await import('../event-bus.js');
const { default: crm, COMPONENTS } = await import('../evaluation/chinese-room-meter.js');
const { computeTrend, runAntiDecayEvaluation } = await import('../evaluation/anti-decay.js');
const query = pool.query.bind(pool);
test.after(async () => {
  await pool.end();
  await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
  await admin.end();
});
await query(`CREATE TABLE anti_decay_trends (
  LIKE public.anti_decay_trends INCLUDING CONSTRAINTS
)`);
await query('ALTER TABLE anti_decay_trends ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY');
await query('ALTER TABLE anti_decay_trends ALTER COLUMN computed_at SET DEFAULT NOW()');
await query(`CREATE TABLE maintenance_audit (
  layer TEXT, last_maintained_at TIMESTAMPTZ, maintenance_type TEXT, details JSONB,
  UNIQUE (layer, maintenance_type)
)`);
const components = score => Object.fromEntries(COMPONENTS.map(k => [k, { score, status: 'measured' }]));
const snapshot = score => ({ composite: score, components: components(score), operating_time_ms: 100 });

async function setup(t, { current = null, baseline = null, fresh = snapshot(null), failWrite = false } = {}) {
  await query('TRUNCATE anti_decay_trends, maintenance_audit');
  const writes = [];
  t.mock.method(crm, 'compute', async () => fresh);
  t.mock.method(pool, 'query', async (sql, args) => {
    if (sql.includes('SUM(duration_ms)')) return { rows: [{ total: '100' }] };
    if (sql.includes('FROM benchmark_history')) {
      const row = sql.includes('ORDER BY created_at') ? current : baseline;
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('FROM consolidation_log')) return { rows: [{ last_run: new Date() }] };
    if (sql.includes('FROM prediction_ledger')) return { rows: [{ total: 0, pending: 0 }] };
    if (sql.includes('FROM metacognitive_observations')) return { rows: [{ evaluated: 0, effective: 0 }] };
    if (sql.includes('INSERT INTO anti_decay_trends')) {
      writes.push(args);
      if (failWrite) throw new Error('simulated database write failure');
      return query(sql, args);
    }
    if (sql.includes('INSERT INTO maintenance_audit')) return query(sql, args);
    throw new Error('Unexpected test query: ' + sql);
  });
  return writes;
}

test('unmeasured current scores skip all three required-score writes and retain an explicit audit', async t => {
  const writes = await setup(t);
  const result = await runAntiDecayEvaluation();
  assert.equal(writes.length, 0, 'missing evidence must never be sent to the NOT NULL column');
  assert.equal((await query('SELECT * FROM anti_decay_trends')).rowCount, 0);
  for (const horizon of ['short', 'medium', 'long']) {
    assert.equal(result.trends[horizon].crm_current, null);
    assert.equal(result.trends[horizon].status, 'insufficient_evidence');
    assert.deepEqual(result.persistence[horizon], { stored: false, reason: 'insufficient_evidence' });
  }
  const { rows: [audit] } = await query('SELECT details FROM maintenance_audit');
  assert.deepEqual(audit.details.persistence, result.persistence);
});

test('zero is a measured score and is stored without manufacturing a missing baseline', async t => {
  const writes = await setup(t, { current: snapshot(0) });
  const result = await runAntiDecayEvaluation();
  assert.equal(writes.length, 3);
  const { rows } = await query('SELECT * FROM anti_decay_trends ORDER BY horizon');
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.crm_current, 0);
    assert.equal(row.crm_baseline, null);
    assert.equal(row.crm_delta, null);
    assert.equal(result.trends[row.horizon].has_baseline, false);
    assert.deepEqual(result.persistence[row.horizon], { stored: true });
  }
});

test('valid scores and negative deltas still persist for every horizon', async t => {
  await setup(t, { current: snapshot(0.25), baseline: snapshot(0.75) });
  const result = await runAntiDecayEvaluation();
  const { rows } = await query('SELECT crm_current, crm_baseline, crm_delta FROM anti_decay_trends');
  assert.equal(rows.length, 3);
  for (const row of rows) assert.deepEqual(row, { crm_current: 0.25, crm_baseline: 0.75, crm_delta: -0.5 });
  assert.ok(result.failures.some(f => f.condition === 'aggregate_crm_negative_long'));
});

for (const value of [NaN, Infinity, -Infinity, -0.1, 1.1, undefined, '0.5']) {
  test(`invalid fresh score ${String(value)} cannot be persisted`, async t => {
    const writes = await setup(t, { fresh: snapshot(value) });
    const result = await runAntiDecayEvaluation();
    assert.equal(writes.length, 0);
    assert.equal(result.trends.long.crm_current, null);
    assert.equal(result.persistence.long.reason, 'insufficient_evidence');
  });
}

test('an invalid stored score is recomputed, while invalid baseline and components stay unknown', async t => {
  const fresh = snapshot(0.5);
  fresh.components.causal.score = NaN;
  const baseline = snapshot(Infinity);
  baseline.components.causal.score = Infinity;
  await setup(t, { current: snapshot(Infinity), baseline, fresh });
  const trend = await computeTrend();
  assert.equal(crm.compute.mock.calls.length, 1);
  assert.equal(trend.crm_current, 0.5);
  assert.equal(trend.crm_baseline, null);
  assert.equal(trend.crm_delta, null);
  assert.equal(trend.has_baseline, false);
  assert.deepEqual(trend.component_deltas.causal, { current: null, baseline: null, delta: null });
});

test('database failures remain explicit instead of being reported as stored', async t => {
  await setup(t, { current: snapshot(0.5), failWrite: true });
  const result = await runAntiDecayEvaluation();
  for (const status of Object.values(result.persistence)) {
    assert.equal(status.stored, false);
    assert.equal(status.reason, 'write_failed');
    assert.match(status.error, /simulated database write failure/);
  }
  const { rows: [audit] } = await query('SELECT details FROM maintenance_audit');
  assert.deepEqual(audit.details.persistence, result.persistence);
});
