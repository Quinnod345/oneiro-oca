import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createActuator, isCoursework, YES, NO } from '../reasoning/actuator.js';
import { createAsks } from '../reasoning/asks.js';
import { createPonderQueue } from '../reasoning/ponder-queue.js';
import { createWorthLedger } from '../motivation/worth-ledger.js';
import { createRiskJournal } from '../motivation/risk-journal.js';
import { createProposal, appraise } from '../motivation/risk.js';
import { normalizeCharter, DEFAULT_CHARTER } from '../user-controls.js';

const blocked = async () => ({ status: 'needs_evidence', checkpoint: { version: 1, passes: [] }, missingEvidence: ['x'] });
async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'act_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema + ',public' });
    await pool.query(`CREATE TABLE thought_chains (id SERIAL PRIMARY KEY, seed TEXT NOT NULL, priority FLOAT8 DEFAULT .5, status TEXT DEFAULT 'pondering', depth INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), ponder_state JSONB)`);
    await pool.query(`CREATE TABLE hypotheses (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(), domain TEXT, claim TEXT, confidence FLOAT8, prediction TEXT, prediction_deadline TIMESTAMPTZ, status TEXT, actual_outcome TEXT, tested_at TIMESTAMPTZ, source_type TEXT, source_data JSONB DEFAULT '{}'::jsonb)`);
    for (const m of ['057_worth_ledger', '058_risk_decisions', '063_agent_actions']) await pool.query(await readFile(new URL(`../migrations/${m}.sql`, import.meta.url), 'utf8'));
    await run(pool);
  } finally { if (pool) await pool.end(); await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end(); }
}

test('the charter is normalized: known classes, a ramp, a spend cap; defaults grant acting on the person\'s own accounts and hold messaging and deleting', () => {
  assert.equal(DEFAULT_CHARTER.publish.granted, true); assert.equal(DEFAULT_CHARTER.message.granted, false); assert.equal(DEFAULT_CHARTER.spend.monthlyCap, 500);
  const c = normalizeCharter({ message: { granted: true }, ramp: 0, spend: { granted: true, monthlyCap: 200 } });
  assert.equal(c.message.granted, true); assert.equal(c.ramp, 0); assert.equal(c.spend.monthlyCap, 200); assert.equal(c.publish.granted, true);
  assert.throws(() => normalizeCharter({ launch_rockets: { granted: true } }), /class must be one of/); assert.throws(() => normalizeCharter({ ramp: -1 }));
  assert.ok(YES.test('yes') && YES.test('Yep, do it') && YES.test('ok') && !YES.test('not yet')); assert.ok(NO.test('no') && NO.test("don't") && !NO.test('yes'));
  assert.ok(isCoursework('psu.instructure.com') && isCoursework('yellowdig.app') && isCoursework('www.pearson.com')); assert.ok(!isCoursework('www.instagram.com') && !isCoursework('x.com'));
});

test('a standing permission is the person firing a class in advance: it proceeds without the master switch, and a constraint still refuses', () => {
  const lookup = k => (k === 'project:demo' ? { worth: 0.7, confidence: 0.5, provenance: 'rated', weighable: true } : null);
  const p = createProposal({ kind: 'app_action', description: 'post the carousel', reversibility: 'undo', serves: ['project:demo'], standing: 'publish' });
  assert.equal(appraise(p, { lookup, controls: { autonomousActions: false, charter: { publish: { granted: true } } } }).decision, 'proceed');
  assert.equal(appraise(p, { lookup, controls: { autonomousActions: false, charter: { publish: { granted: false } } } }).decision, 'prepare_artifact', 'ungranted: the master switch still holds it');
  const plain = createProposal({ kind: 'app_action', description: 'post the carousel', reversibility: 'undo', serves: ['project:demo'] });
  assert.equal(appraise(plain, { lookup, controls: { autonomousActions: false, charter: { publish: { granted: true } } } }).decision, 'prepare_artifact', 'no standing named: nothing changes');
});

test('the actuator: granted classes proceed after the ramp; ungranted classes and spend past the cap ask; a yes fires that one action, a no refuses; coursework is never submitted; outcomes are observed', async () => database(async pool => {
  let now = 40 * 86400000;
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  let charter = normalizeCharter({ ramp: 1, message: { granted: false } });
  const controls = { get: async () => ({ askOwner: true, autonomousActions: false, charter }) };
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => controls.get() });
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
  const sent = [];
  const asks = createAsks({ pool, risk, clock: () => now, log: { log() {}, warn() {} }, deliverers: { push: async m => { sent.push(m); } } }); await asks.init();
  const act = createActuator({ pool, risk, asks, controls, queue, clock: () => now, log: { log() {}, warn() {} } }); await act.init();
  const chain = await queue.enqueue({ seed: 'Launch InnerEcho on Instagram', doneWhen: 'the carousel is live', stakes: [{ entityKey: 'person:quinn', share: 1 }] }, { origin: { kind: 'explicit', by: 'quinn' } });
  const id = chain.chain_id;
  // 1. the first publish asks once (ramp); the ask is a real push with the exact question
  const a1 = await act.authorize({ chainId: id, class: 'publish', host: 'www.instagram.com', description: 'post the 5-slide carousel' });
  assert.equal(a1.decision, 'ask'); assert.ok(a1.askId); assert.match(a1.question, /^Oneiro wants to post the 5-slide carousel on www\.instagram\.com\. OK\? Reply yes or no\.$/); assert.equal(sent.length, 1);
  // not yet answered: still waiting
  assert.equal((await act.authorize({ chainId: id, class: 'publish', host: 'www.instagram.com', description: 'post the 5-slide carousel', approval: a1.askId })).decision, 'ask');
  // Quinn says yes → that action proceeds; its success completes the ramp
  await asks.answer(a1.askId, 'yes go ahead');
  const a2 = await act.authorize({ chainId: id, class: 'publish', host: 'www.instagram.com', description: 'post the 5-slide carousel', approval: a1.askId });
  assert.equal(a2.decision, 'proceed'); assert.equal(a2.approvedBy, a1.askId);
  await act.observe({ actionId: a2.actionId, result: 'success', observation: 'post live at instagram.com/p/abc' });
  // 2. the next publish needs nobody
  const a3 = await act.authorize({ chainId: id, class: 'publish', host: 'x.com', description: 'post the founder note' });
  assert.equal(a3.decision, 'proceed'); assert.equal(sent.length, 1, 'no second ask');
  const journal = (await risk.recent({ chainId: id })).find(x => x.id === `act:${a2.actionId}`);
  assert.equal(journal.decision, 'proceed'); assert.equal(journal.outcome.result, 'success');
  // 3. an ungranted class asks for each action; a no refuses
  const m1 = await act.authorize({ chainId: id, class: 'message', host: 'www.instagram.com', description: 'DM @someone about a collaboration' });
  assert.equal(m1.decision, 'ask'); await asks.answer(m1.askId, 'no');
  assert.equal((await act.authorize({ chainId: id, class: 'message', host: 'www.instagram.com', description: 'DM @someone about a collaboration', approval: m1.askId })).decision, 'refuse');
  // 4. spend: within the cap proceeds (after its own ramp), past the cap asks
  charter = normalizeCharter({ ramp: 0, spend: { granted: true, monthlyCap: 50 } });
  const s1 = await act.authorize({ chainId: id, class: 'spend', host: 'ads.x.com', description: 'boost the post for a day', cost: 30 });
  assert.equal(s1.decision, 'proceed'); await act.observe({ actionId: s1.actionId, result: 'success', observation: 'boost scheduled' });
  const s2 = await act.authorize({ chainId: id, class: 'spend', host: 'ads.x.com', description: 'boost it again', cost: 30 });
  assert.equal(s2.decision, 'ask'); assert.match((await act.recent()).find(r => r.id === s2.actionId).why, /past the \$50 cap/);
  assert.equal((await act.authorize({ chainId: id, class: 'spend', host: 'ads.x.com', description: 'no cost stated' })).decision, 'ask', 'a spend must state its cost');
  assert.equal(await act.monthSpend(), 30);
  // 5. coursework: never, whatever the charter says
  charter = normalizeCharter({ ramp: 0, submit: { granted: true }, publish: { granted: true } });
  const q = await act.authorize({ chainId: id, class: 'submit', host: 'psu.instructure.com', description: 'submit the quiz' });
  assert.equal(q.decision, 'refuse'); assert.match(q.why, /course or assessment site/);
  assert.equal((await act.authorize({ chainId: id, class: 'publish', host: 'yellowdig.app', description: 'post a discussion reply' })).decision, 'refuse');
  // 6. no pursuit, no action
  assert.equal((await act.authorize({ chainId: 9999, class: 'submit', host: 'example.com', description: 'save the settings' })).decision, 'refuse');
  // 7. an outcome is recorded once
  await assert.rejects(act.observe({ actionId: a2.actionId, result: 'success' }), /no proceeding action/);
}));
