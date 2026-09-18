import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createSignal, projectWorth, priceWant, seedSignals, parseEntityKey } from '../motivation/worth.js';
import { createWorthLedger } from '../motivation/worth-ledger.js';

const DAY = 86400000;
const evidence = [{ id: 'obs-1', source: 'isolated regression fixture', observation: 'Quinn opened the draft and replied.' }];
const rated = (id, rating, at, entityKey = 'project:demo') => createSignal({ id, entityKey, kind: 'rated', at, rating, by: 'quinn' });
const observed = (id, outcome, at, extra = {}) => createSignal({ id, entityKey: 'project:demo', kind: 'observed', at, outcome, evidence, ...extra });

test('an entity with no signals is a neutral prior with zero confidence; a prior moves worth but earns no confidence', () => {
  const empty = projectWorth('project:demo', [], 1000);
  assert.deepEqual([empty.worth, empty.confidence, empty.provenance, empty.weighable], [0.5, 0, 'prior', true]);
  const prior = createSignal({ id: 'p', entityKey: 'project:demo', kind: 'prior', at: 0, worth: 0.9, weight: 4 });
  const s = projectWorth('project:demo', [prior], 1000);
  assert.ok(s.worth > 0.8 && s.confidence === 0 && s.provenance === 'prior');
});

test('ratings outweigh observed outcomes and both move worth with confidence', () => {
  const now = 10 * DAY;
  const up = projectWorth('project:demo', [rated('r1', 1, now), rated('r2', 1, now), rated('r3', 1, now)], now);
  assert.ok(up.worth > 0.8 && up.confidence > 0.6 && up.provenance === 'rated');
  const down = projectWorth('project:demo', [rated('r1', -1, now)], now);
  assert.ok(down.worth < 0.3);
  const oneRating = projectWorth('project:demo', [rated('r1', 1, now)], now).worth;
  const oneOutcome = projectWorth('project:demo', [observed('o1', 'success', now)], now).worth;
  assert.ok(oneRating > oneOutcome && oneOutcome > 0.5, 'a rating counts more than one observed success');
  const neutral = projectWorth('project:demo', [rated('r0', 0, now)], now);
  assert.equal(neutral.worth, 0.5); assert.ok(neutral.confidence > 0, 'a neutral rating adds confidence, not worth');
});

test('observed outcomes need grounded evidence; ignored/dismissed/failure lower worth; progress is proportional', () => {
  assert.throws(() => createSignal({ id: 'x', entityKey: 'project:demo', kind: 'observed', outcome: 'used', evidence: [] }), /needs evidence/);
  assert.throws(() => createSignal({ id: 'x', entityKey: 'project:demo', kind: 'observed', outcome: 'used',
    evidence: [{ id: 'g', source: 'model output from the thinker', observation: 'I feel this was useful.' }] }), /cannot ground worth/);
  assert.throws(() => createSignal({ id: 'x', entityKey: 'project:demo', kind: 'observed', outcome: 'used',
    evidence: [{ id: 'g', source: 'dream journal', observation: 'It mattered.' }] }), /cannot ground worth/);
  const now = DAY;
  const base = projectWorth('project:demo', [], now).worth;
  for (const [outcome, sign] of [['used', 1], ['success', 1], ['ignored', -1], ['dismissed', -1], ['failure', -1]]) {
    const w = projectWorth('project:demo', [observed('o', outcome, now)], now).worth;
    assert.ok(Math.sign(w - base) === sign, `${outcome} moves worth ${sign > 0 ? 'up' : 'down'}`);
  }
  const ignored = projectWorth('project:demo', [observed('o', 'ignored', now)], now).worth;
  const dismissed = projectWorth('project:demo', [observed('o', 'dismissed', now)], now).worth;
  assert.ok(dismissed < ignored, 'dismissal is stronger evidence than silence');
  assert.throws(() => observed('o', 'progress', now, { progress: 2 }), /progress must be/);
  const half = projectWorth('project:demo', [observed('o', 'progress', now, { progress: 0.5 })], now);
  assert.equal(half.worth, 0.5); assert.ok(half.confidence > 0);
});

test('recent evidence outweighs old evidence of the same kind', () => {
  const now = 120 * DAY;
  const oldNegativeRecentPositive = projectWorth('project:demo', [observed('a', 'failure', now - 100 * DAY), observed('b', 'success', now)], now);
  assert.ok(oldNegativeRecentPositive.worth > 0.5);
  const sameDay = projectWorth('project:demo', [observed('a', 'failure', now), observed('b', 'success', now)], now);
  assert.equal(sameDay.worth, 0.5);
});

test('a constraint is never weighed: it marks the entity unweighable regardless of later ratings', () => {
  const now = DAY;
  const signals = [
    createSignal({ id: 'c', entityKey: 'data:quinn', kind: 'constraint', at: 0, rule: 'never_lose_data' }),
    rated('r', -1, now, 'data:quinn'), rated('r2', -1, now, 'data:quinn'),
  ];
  const s = projectWorth('data:quinn', signals, now);
  assert.equal(s.constraint, true); assert.equal(s.weighable, false); assert.equal(s.provenance, 'constraint');
  assert.deepEqual(s.constraints.map(c => c.rule), ['never_lose_data']);
  assert.throws(() => createSignal({ id: 'c2', entityKey: 'data:quinn', kind: 'constraint', rule: '' }), /needs a rule/);
});

test('signal validation rejects unknown kinds, malformed keys and out-of-range values', () => {
  assert.throws(() => createSignal({ id: 'x', entityKey: 'project:demo', kind: 'activity_count' }), /signal kind/);
  assert.throws(() => createSignal({ id: 'x', entityKey: 'project:demo', kind: 'generated' }), /signal kind/);
  assert.throws(() => parseEntityKey('demo'), /entity key/);
  assert.throws(() => parseEntityKey('robot:x'), /entity key/);
  assert.throws(() => createSignal({ id: 'x', entityKey: 'project:demo', kind: 'rated', rating: 2, by: 'quinn' }), /rating is/);
  assert.throws(() => createSignal({ id: 'x', entityKey: 'project:demo', kind: 'rated', rating: 1 }), /who rated/);
  assert.throws(() => createSignal({ id: 'x', entityKey: 'project:demo', kind: 'prior', worth: 1.5 }), /prior worth/);
  assert.throws(() => createSignal({ id: '', entityKey: 'project:demo', kind: 'prior', worth: 0.5 }), /needs an id/);
});

test('pricing a want is the share-weighted worth of its stakes; no stakes is an explicit unpriced prior', () => {
  const ledger = { 'project:demo': { worth: 0.9, confidence: 0.8, provenance: 'rated', constraint: false },
    'person:alex': { worth: 0.3, confidence: 0.2, provenance: 'observed', constraint: false } };
  const lookup = key => ledger[key] || null;
  const priced = priceWant([{ entityKey: 'project:demo', share: 3 }, { entityKey: 'person:alex', share: 1 }], lookup);
  assert.equal(priced.unpriced, false); assert.equal(priced.provenance, 'rated');
  assert.ok(Math.abs(priced.value - (0.75 * 0.9 + 0.25 * 0.3)) < 1e-9);
  assert.equal(priced.confidence, 0.2, 'confidence is the weakest stake');
  const unknown = priceWant([{ entityKey: 'project:unknown' }], lookup);
  assert.deepEqual([unknown.value, unknown.confidence, unknown.provenance], [0.5, 0, 'prior']);
  const none = priceWant([], lookup);
  assert.deepEqual([none.value, none.unpriced, none.provenance], [0.5, true, 'prior']);
  assert.throws(() => priceWant([{ entityKey: 'project:demo', share: 0 }], lookup), /positive/);
  assert.throws(() => priceWant([{ entityKey: 'nope' }], lookup), /entity key/);
});

test('the seed encodes the decisions of record and is deterministic', () => {
  const a = seedSignals(1), b = seedSignals(2);
  assert.deepEqual(a.map(s => s.id), b.map(s => s.id));
  const keys = new Set(a.map(s => s.entityKey));
  assert.ok(keys.has('person:quinn') && keys.has('data:quinn') && keys.has('attention:quinn') && keys.has('self:act_irreversible'));
  const quinn = projectWorth('person:quinn', a, DAY);
  assert.equal(quinn.constraint, true); assert.ok(quinn.worth > 0.9);
  for (const cap of ['hypothesize', 'ponder', 'act_reversible', 'act_irreversible', 'message']) {
    const s = projectWorth(`self:${cap}`, a, DAY);
    assert.equal(s.worth, 0.5); assert.equal(s.confidence, 0);
  }
});

async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'worth_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema + ',public' });
    await pool.query(await readFile(new URL('../migrations/057_worth_ledger.sql', import.meta.url), 'utf8'));
    await run(pool);
  } finally {
    if (pool) await pool.end();
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await admin.end();
  }
}

test('SQL lifecycle: idempotent seed, journal-projected state, replay safety, pricing and time refresh', async () => database(async pool => {
  let now = 10 * DAY;
  const events = [];
  const ledger = createWorthLedger({ pool, clock: () => now, emit: async (type, layer, payload) => { events.push({ type, layer, payload }); } });
  assert.deepEqual(await ledger.seed(), { inserted: 10, total: 10 });
  assert.deepEqual(await ledger.seed(), { inserted: 0, total: 10 });
  const quinn = await ledger.get('person:quinn');
  assert.equal(quinn.constraint, true); assert.equal(quinn.provenance, 'constraint');
  assert.equal(events.length, 10, 'each seed signal is announced once; the replayed seed announced nothing');
  events.length = 0;

  const first = await ledger.record({ id: 'rate-1', entityKey: 'project:demo', kind: 'rated', rating: 1, by: 'quinn', about: 'output:42' });
  assert.equal(first.duplicate, false); assert.ok(first.state.worth > 0.5);
  assert.equal(events.filter(e => e.type === 'worth_update').length, 1);
  const replay = await ledger.record({ id: 'rate-1', entityKey: 'project:demo', kind: 'rated', rating: 1, by: 'quinn', about: 'output:42' });
  assert.equal(replay.duplicate, true);
  assert.equal(events.filter(e => e.type === 'worth_update').length, 1, 'a replayed signal emits nothing');
  const { rows: [{ n }] } = await pool.query("SELECT COUNT(*)::int AS n FROM worth_signals WHERE entity_key = 'project:demo'");
  assert.equal(n, 1, 'a replayed id is not counted twice');
  await assert.rejects(ledger.record({ id: 'rate-1', entityKey: 'project:demo', kind: 'rated', rating: -1, by: 'quinn' }), /different signal/);
  await assert.rejects(ledger.record({ id: 'obs-bad', entityKey: 'project:demo', kind: 'observed', outcome: 'used',
    evidence: [{ id: 'g', source: 'generated summary', observation: 'x' }] }), /cannot ground/);
  const { rows: [{ total }] } = await pool.query('SELECT COUNT(*)::int AS total FROM worth_signals');
  assert.equal(total, 11, 'rejected signals leave no journal rows');

  const priced = await ledger.price([{ entityKey: 'project:demo', share: 1 }, { entityKey: 'person:quinn', share: 1 }]);
  assert.equal(priced.provenance, 'rated'); assert.ok(priced.value > 0.6);
  assert.equal(priced.stakes.find(s => s.entityKey === 'person:quinn').constraint, true);

  const listed = await ledger.list();
  assert.equal(listed.entities.length, 9);
  assert.equal(listed.entities[0].constraint, true, 'constraints list first');
  assert.equal((await ledger.list({ kind: 'self' })).entities.length, 5);

  const before = (await ledger.get('project:demo')).worth;
  now += 400 * DAY;
  await ledger.refresh();
  const after = await ledger.get('project:demo');
  assert.ok(after.worth < before && after.worth > 0.5, 'worth decays toward the prior with time, not below it');
  assert.equal(after.projectedAt, now);
}));
