import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createActuator } from '../reasoning/actuator.js';
import { createAsks } from '../reasoning/asks.js';
import { createInbox } from '../reasoning/inbox.js';
import { createPaymentApprovals, APPROVE, DENY, APPROVAL_WINDOW_MS, parseDecision, hashCode, newCode } from '../reasoning/payment-approvals.js';
import { createImessageInbox, pickAsk } from '../reasoning/imessage-inbox.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPonderQueue } from '../reasoning/ponder-queue.js';
import { createWorthLedger } from '../motivation/worth-ledger.js';
import { createRiskJournal } from '../motivation/risk-journal.js';
import { normalizeCharter } from '../user-controls.js';

const silent = { log() {}, warn() {} };
const blocked = async () => ({ status: 'needs_evidence', checkpoint: { version: 1, passes: [] }, missingEvidence: ['x'] });
async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'pay_test_' + randomBytes(6).toString('hex');
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


async function world(pool, { perDay = 3 } = {}) {
  const w = { now: Date.parse('2026-09-29T12:00:00') };
  const worth = createWorthLedger({ pool, clock: () => w.now }); await worth.seed();
  const charter = normalizeCharter({ ramp: 0, spend: { granted: true, monthlyCap: 500 }, publish: { granted: true } });
  const controls = { get: async () => ({ askOwner: true, autonomousActions: false, charter }) };
  const risk = createRiskJournal({ pool, worth, clock: () => w.now, controls: () => controls.get() });
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => w.now, worth, risk });
  w.texted = []; w.decided = []; w.refused = [];
  w.asks = createAsks({ pool, risk, clock: () => w.now, perDay, log: silent, deliverers: { imessage: async m => { w.texted.push(m); } } }); await w.asks.init();
  w.approvals = createPaymentApprovals({ pool, clock: () => w.now, log: silent,
    onDecision: async d => { w.decided.push(d); await w.asks.answer(d.askId, d.approved ? `Approved in Messages with its code (ask #${d.askId}).` : `Denied in Messages (ask #${d.askId}). Don't make this payment.`); },
    onRefused: async d => { w.refused.push(d); } });
  w.asks.useApprovals(w.approvals);
  w.act = createActuator({ pool, risk, asks: w.asks, controls, queue, clock: () => w.now, log: silent }); await w.act.init();
  w.id = (await queue.enqueue({ seed: 'Grow InnerEcho', doneWhen: 'a profitable month', stakes: [{ entityKey: 'person:quinn', share: 1 }] }, { origin: { kind: 'explicit', by: 'quinn' } })).chain_id;
  w.approvalOf = async askId => (await pool.query('SELECT message, metadata FROM notifications WHERE id = $1', [askId])).rows[0];
  w.code = () => (w.texted.at(-1).match(/APPROVE ([A-Z0-9]{6})/) || [])[1];
  return w;
}

test('every payment asks with a one-time code; only that code, texted back by Quinn, decides it, and the first answer wins', async () => database(async pool => {
  const w = await world(pool);
  const pay = { chainId: w.id, class: 'spend', host: 'www.namecheap.com', description: 'buy the domain innerecho.app for a year', cost: 12.98 };
  // 1. the ask: the question and its code go out as a text; the record keeps the price and a hash, never the code
  const a = await w.act.authorize(pay);
  assert.equal(a.decision, 'ask');
  assert.match(w.texted[0], /buy the domain innerecho\.app for a year on www\.namecheap\.com \(cost \$12\.98\)\. Are you sure you want to go through with this\?/);
  const code = w.code();
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/, 'no 0/O or 1/I');
  assert.match(w.texted[0], new RegExp(`Reply APPROVE ${code} to pay, or DENY ${code}\\. \\(Expires in 10 minutes\\.\\)$`));
  const row = await w.approvalOf(a.askId);
  assert.ok(!row.message.includes(code), 'the stored ask has no code'); assert.ok(!JSON.stringify(row.metadata).includes(code), 'nor its record');
  assert.equal(row.metadata.approval.codeHash, hashCode(code)); assert.equal(row.metadata.approval.title, 'Approve $12.98 on www.namecheap.com?');
  assert.equal(row.metadata.approval.expiresAt - row.metadata.approval.requestedAt, APPROVAL_WINDOW_MS);

  // 2. waiting: nothing is decided, and the held step stays held
  await w.approvals.tick();
  assert.equal((await w.act.authorize({ ...pay, approval: a.askId })).decision, 'ask');

  // 3. a second payment's code cannot decide the first, and a wrong code decides nothing
  const b = await w.act.authorize({ ...pay, description: 'buy innerecho.dev too', cost: 9.5 });
  const codeB = w.code(); assert.notEqual(codeB, code);
  assert.deepEqual(await w.approvals.decide({ approved: true, code: 'ZZZZZZ', from: 'quinn' }), { ok: false, why: 'no payment is waiting on that code' });
  assert.equal((await w.act.authorize({ ...pay, approval: a.askId })).decision, 'ask', 'still waiting for its own code');

  // 4. his APPROVE with the code: that one payment proceeds, once
  assert.deepEqual(await w.approvals.decide({ approved: true, code, from: 'quinn@icloud.com' }), { ok: true, askId: a.askId, approved: true });
  assert.equal((await w.approvalOf(a.askId)).metadata.approval.settled, APPROVE);
  assert.deepEqual((await w.approvalOf(a.askId)).metadata.approval.resolver, { kind: 'imessage', id: 'quinn@icloud.com', via: 'Messages' });
  const go = await w.act.authorize({ ...pay, approval: a.askId });
  assert.equal(go.decision, 'proceed'); assert.equal(go.approvedBy, a.askId);
  await w.act.observe({ actionId: go.actionId, result: 'success', observation: 'domain bought' });
  assert.equal((await w.approvals.decide({ approved: false, code, from: 'quinn' })).ok, false, 'the first answer wins');
  assert.equal(w.decided.length, 1);

  // 5. DENY refuses
  assert.equal((await w.approvals.decide({ approved: false, code: codeB, from: 'quinn' })).ok, true);
  const no = await w.act.authorize({ ...pay, description: 'buy innerecho.dev too', cost: 9.5, approval: b.askId });
  assert.equal(no.decision, 'refuse'); assert.match(no.why, /declined/);
}));

test('a "yes" that is not the code, from anywhere, pays nothing; a code past its window or after another answer is dead', async () => database(async pool => {
  const w = await world(pool);
  const pay = { chainId: w.id, class: 'spend', host: 'ads.x.com', description: 'boost the post for a day', cost: 20 };
  // posted to the engine (what any process on this Mac could do): closes the ask, pays nothing
  const a = await w.act.authorize(pay); const codeA = w.code();
  await w.asks.answer(a.askId, 'yes');
  const r = await w.act.authorize({ ...pay, approval: a.askId });
  assert.equal(r.decision, 'refuse'); assert.match(r.why, /without Quinn's approval code/);
  await w.approvals.tick();
  assert.equal((await w.approvalOf(a.askId)).metadata.approval.settled, 'answered-elsewhere');
  assert.match((await w.approvals.decide({ approved: true, code: codeA, from: 'quinn' })).why, /already/, 'and its code is dead');
  // past the window
  const b = await w.act.authorize({ ...pay, description: 'boost the other post', cost: 15 }); const codeB = w.code();
  w.now += APPROVAL_WINDOW_MS + 1;
  assert.match((await w.approvals.decide({ approved: true, code: codeB, from: 'quinn' })).why, /expired/);
  assert.equal((await w.act.authorize({ ...pay, description: 'boost the other post', cost: 15, approval: b.askId })).decision, 'refuse');
  assert.equal(w.refused.length, 2, 'every refusal is reported');
  // payments are never held back by the daily cap
  const many = [];
  for (let i = 0; i < 5; i++) many.push(await w.act.authorize({ ...pay, description: `boost post ${i}`, cost: 1 + i }));
  assert.ok(many.every(m => m.decision === 'ask'));
  assert.equal(w.texted.filter(t => /APPROVE [A-Z0-9]{6}/.test(t)).length, 7, 'each one texted with its code');
}));

test('nothing in Judge can approve a payment: its answer box, an agent\'s thread, the code typed into the app, and dismiss all leave it unpaid', async () => database(async pool => {
  const w = await world(pool);
  const inbox = createInbox({ pool, queue: null, worth: null, workRoot: tmpdir(), asks: w.asks, clock: () => w.now, log: silent });
  const pay = { chainId: w.id, class: 'spend', host: 'www.sweetwater.com', description: 'buy the piano book', cost: 24.99 };
  // the answer box (POST /oca/inbox/asks/:id/answer): a typed yes closes the ask and pays nothing
  const a = await w.act.authorize(pay);
  await inbox.answerAsk({ id: a.askId, reply: 'yes, approve it', via: 'Oneiro' });
  assert.equal((await w.act.authorize({ ...pay, approval: a.askId })).decision, 'refuse');
  // the agent's thread (POST /oca/agents/:id/say relays through the same answer): even the real code, typed into the app
  const b = await w.act.authorize({ ...pay, description: 'buy the second book', cost: 19.99 });
  await w.asks.answer(b.askId, `APPROVE ${w.code()}`);
  assert.equal((await w.act.authorize({ ...pay, description: 'buy the second book', cost: 19.99, approval: b.askId })).decision, 'refuse');
  await w.approvals.tick();
  assert.notEqual((await w.approvalOf(b.askId)).metadata.approval.settled, APPROVE, 'never settled as approved');
  // dismiss: refused outright for a payment, so it stays open for the phone or Deny
  const c = await w.act.authorize({ ...pay, description: 'buy the third book', cost: 14.99 });
  await assert.rejects(inbox.dismissAsk({ id: c.askId }), /can’t be dismissed/);
  assert.equal((await w.act.authorize({ ...pay, description: 'buy the third book', cost: 14.99, approval: c.askId })).decision, 'ask', 'still waiting on the phone');
  // and Judge's Deny is a real no
  await inbox.answerAsk({ id: c.askId, reply: 'no', via: 'the app' });
  assert.equal((await w.act.authorize({ ...pay, description: 'buy the third book', cost: 14.99, approval: c.askId })).decision, 'refuse');
}));

test('reading his replies: APPROVE/DENY codes, answers to asks, "status" — and a plain yes to a payment only gets the instructions', async () => database(async pool => {
  const w = await world(pool);
  const dir = await mkdtemp(join(tmpdir(), 'imsg-inbox-'));
  const inbox = createInbox({ pool, queue: { get: async () => null }, worth: null, workRoot: dir, asks: w.asks, agents: null });
  const incoming = [], replies = [];
  const line = { since: async after => incoming.filter(m => m.id > after), latestId: async () => 100, send: async m => { replies.push(m); } };
  const reader = createImessageInbox({ imessage: line, asks: w.asks, inbox, payments: w.approvals, statePath: join(dir, 'state.json'), log: silent,
    wants: async () => [{ id: w.id, description: 'Grow InnerEcho' }] });
  const say = async text => { incoming.push({ id: 100 + incoming.length + 1, text, sender: 'quinn@icloud.com', at: w.now }); await reader.tick(); return replies.at(-1); };

  // nothing open: a status line
  assert.match(await say('status'), /^Working on: #\d+ Grow InnerEcho\./);
  // a question: his reply answers it
  const q = await w.asks.ask({ chainId: w.id, kind: 'question', detail: 'Which caption reads better?' });
  assert.match(await say('the second one'), new RegExp(`passed to #${w.id} \\(ask #${q.id}\\)`));
  assert.equal((await pool.query('SELECT reply FROM notifications WHERE id = $1', [q.id])).rows[0].reply, 'the second one');
  // a payment: "yes" gets the instructions, never an approval; the code decides it
  const pay = await w.act.authorize({ chainId: w.id, class: 'spend', host: 'www.namecheap.com', description: 'buy innerecho.app', cost: 12 });
  const code = w.code();
  assert.match(await say('yes'), /reply with the APPROVE or DENY code/);
  assert.equal((await w.approvalOf(pay.askId)).metadata.approval.settled, undefined);
  assert.match(await say(`approve ${code.toLowerCase()}`), /^Approved\./);
  assert.equal((await w.act.authorize({ chainId: w.id, class: 'spend', host: 'www.namecheap.com', description: 'buy innerecho.app', cost: 12, approval: pay.askId })).decision, 'proceed');
  assert.match(await say(`DENY ${code}`), /^Not done: that payment was already approved/);
  // a reader that starts fresh skips what was sent before it
  const fresh = createImessageInbox({ imessage: { ...line, latestId: async () => 10_000 }, asks: w.asks, inbox, payments: w.approvals, statePath: join(dir, 'fresh.json'), log: silent });
  const before = replies.length; await fresh.tick(); assert.equal(replies.length, before);
}));

test('which ask a reply answers: "#n" names it, otherwise the newest one he was texted', () => {
  const open = [
    { id: 5, chainId: 27, kind: 'question', at: '2026-11-05T10:00:00Z', delivered: ['imessage'] },
    { id: 6, chainId: 31, kind: 'question', at: '2026-11-05T11:00:00Z', delivered: ['notification'] },
    { id: 7, chainId: 27, kind: 'notice', at: '2026-11-05T12:00:00Z', delivered: ['imessage'] },
  ];
  assert.equal(pickAsk(open, 'done').id, 5, 'the newest texted ask, never a notice');
  assert.equal(pickAsk(open, '#6 yes').id, 6);
  assert.equal(pickAsk(open, 'for #31: done').id, 6, 'a pursuit number works too');
  assert.equal(pickAsk(open, '#99 ok'), null);
  assert.equal(pickAsk([], 'hi'), null);
  assert.deepEqual(parseDecision('Approve k7q2mx.'), { approved: true, code: 'K7Q2MX' });
  assert.deepEqual(parseDecision('DENY K7Q2MX'), { approved: false, code: 'K7Q2MX' });
  assert.equal(parseDecision('yes approve it'), null);
  assert.equal(parseDecision('approve K7Q2MX and also the other one'), null, 'the verb and the code, nothing else');
  assert.match(newCode(), /^[A-HJ-NP-Z2-9]{6}$/);
});
