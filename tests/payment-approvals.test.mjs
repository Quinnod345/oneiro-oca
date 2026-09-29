import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createActuator } from '../reasoning/actuator.js';
import { createAsks } from '../reasoning/asks.js';
import { createInbox } from '../reasoning/inbox.js';
import { createPaymentApprovals, APPROVE, DENY, APPROVAL_WINDOW_MS } from '../reasoning/payment-approvals.js';
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

// A gateway that records every call and answers approval.get from a table the test fills in, the way Quinn's tap would.
function fakeGateway() {
  const calls = [], snapshots = new Map();
  let n = 0, deliver = true;
  return {
    calls, snapshots,
    noRoute() { deliver = false; },
    decide(id, decision, resolver) { snapshots.set(id, { id, status: decision === DENY ? 'denied' : 'allowed', decision, resolvedAtMs: 1, resolver }); },
    async call(method, params) {
      calls.push({ method, params });
      if (method === 'plugin.approval.request') {
        const id = `plugin:${++n}`;
        if (!deliver) return { id, decision: null, createdAtMs: 0, expiresAtMs: 0 };   // expired at once: no route to a phone
        snapshots.set(id, { id, status: 'pending' });
        return { status: 'accepted', id, deliveryRoute: 'forwarder', createdAtMs: 0, expiresAtMs: 0 };
      }
      if (method === 'approval.get') return { approval: snapshots.get(params.id) ?? null };
      if (method === 'approval.resolve') { snapshots.set(params.id, { id: params.id, status: 'denied', decision: DENY, resolver: { kind: 'device', id: 'this-mac' } }); return { ok: true }; }
      throw new Error(`unexpected ${method}`);
    },
  };
}

test('every payment asks on the phone with Approve and Deny; only a tap on Quinn\'s phone decides it, and the first answer wins', async () => database(async pool => {
  let now = Date.parse('2026-09-29T12:00:00');
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const charter = normalizeCharter({ ramp: 0, spend: { granted: true, monthlyCap: 500 }, publish: { granted: true } });
  const controls = { get: async () => ({ askOwner: true, autonomousActions: false, charter }) };
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => controls.get() });
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
  const pushed = [], texted = [];
  const asks = createAsks({ pool, risk, clock: () => now, perDay: 3, log: silent,
    deliverers: { push: async m => { pushed.push(m); }, imessage: async m => { texted.push(m); } } }); await asks.init();
  const gateway = fakeGateway(), decided = [], untrusted = [];
  const approvals = createPaymentApprovals({ pool, gateway, deciders: ['phone-1', 'phone-2'], clock: () => now, log: silent,
    onDecision: async d => { decided.push(d); await asks.answer(d.askId, d.approved ? `Approved on iPhone (ask #${d.askId}).` : `Denied on iPhone (ask #${d.askId}). Don't make this payment.`); },
    onUntrusted: async d => { untrusted.push(d); } });
  asks.useApprovals(approvals);
  const act = createActuator({ pool, risk, asks, controls, queue, clock: () => now, log: silent }); await act.init();
  const id = (await queue.enqueue({ seed: 'Grow InnerEcho', doneWhen: 'a profitable month', stakes: [{ entityKey: 'person:quinn', share: 1 }] }, { origin: { kind: 'explicit', by: 'quinn' } })).chain_id;
  const approvalOf = async askId => (await pool.query('SELECT metadata FROM notifications WHERE id = $1', [askId])).rows[0].metadata.approval;
  const requests = () => gateway.calls.filter(c => c.method === 'plugin.approval.request');

  // 1. a payment opens an approval: the price leads the title, "Are you sure" survives the phone's cut, and the push is
  //    the approval itself (Messages still gets the question)
  const pay = { chainId: id, class: 'spend', host: 'www.namecheap.com', description: 'buy the domain innerecho.app for a year', cost: 12.98 };
  const a = await act.authorize(pay);
  assert.equal(a.decision, 'ask');
  const [req] = requests();
  assert.equal(req.params.pluginId, 'oneiro.payments'); assert.equal(req.params.twoPhase, true); assert.deepEqual(req.params.allowedDecisions, [APPROVE, DENY]);
  assert.equal(req.params.timeoutMs, APPROVAL_WINDOW_MS);
  assert.equal(req.params.title, 'Approve $12.98 on www.namecheap.com?');
  assert.match(req.params.description, /^Oneiro wants to buy the domain innerecho\.app for a year on www\.namecheap\.com \(cost \$12\.98\)\. Are you sure you want to go through with this\?$/);
  assert.match(req.params.detail, /every payment waits for Quinn's yes/);
  assert.equal(pushed.length, 0, 'no second, plain push'); assert.equal(texted.length, 1);
  assert.equal((await approvalOf(a.askId)).id, 'plugin:1');
  // a long description gives way; the cost and the question don't
  const long = await act.authorize({ ...pay, description: `renew ${'the premium hosting plan with every add-on '.repeat(12)}`, cost: 240 });
  const longReq = requests().at(-1).params;
  assert.ok(longReq.description.length <= 256, `${longReq.description.length} characters`);
  assert.match(longReq.description, /…\s\(cost \$240\.00\)\. Are you sure you want to go through with this\?$/);
  // a daily budget says so in the title
  const budget = await act.authorize({ chainId: id, class: 'spend', host: 'ads.x.com', description: 'raise the promoted-post daily budget', dailyBudget: 20, previousDailyBudget: 10 });
  assert.equal(requests().at(-1).params.title, 'Approve a $20.00/day budget on ads.x.com?');

  // 2. waiting: nothing is decided, and the held step stays held
  await approvals.tick();
  assert.equal(decided.length, 0); assert.equal((await approvalOf(a.askId)).settled, undefined);
  assert.equal((await act.authorize({ ...pay, approval: a.askId })).decision, 'ask');

  // 3. a decision from anywhere but his phone is ignored and reported: here, a client on this Mac approving
  gateway.decide('plugin:1', APPROVE, { kind: 'device', id: 'mac-cli' });
  await approvals.tick();
  assert.equal(decided.length, 0); assert.equal(untrusted.length, 1); assert.equal(untrusted[0].askId, a.askId);
  assert.equal((await approvalOf(a.askId)).settled, 'untrusted');
  assert.equal((await act.authorize({ ...pay, approval: a.askId })).decision, 'ask', 'still waiting for Quinn');
  // …and so is one with no device identity at all
  gateway.decide('plugin:2', APPROVE, { kind: 'runtime', id: 'phone-1' });
  await approvals.tick();
  assert.equal(decided.length, 0); assert.equal((await approvalOf(long.askId)).settled, 'untrusted');

  // 4. Approve on his phone: the ask is answered yes, and that one payment proceeds
  gateway.decide('plugin:3', APPROVE, { kind: 'device', id: 'phone-2' });
  await approvals.tick();
  assert.deepEqual(decided, [{ askId: budget.askId, approved: true }]);
  assert.equal((await approvalOf(budget.askId)).settled, APPROVE);
  const go = await act.authorize({ chainId: id, class: 'spend', host: 'ads.x.com', description: 'raise the promoted-post daily budget', dailyBudget: 20, previousDailyBudget: 10, approval: budget.askId });
  assert.equal(go.decision, 'proceed'); assert.equal(go.approvedBy, budget.askId);
  await approvals.tick(); assert.equal(decided.length, 1, 'a settled approval is read once');

  // 5. Deny on his phone: the payment is refused
  const b = await act.authorize({ chainId: id, class: 'spend', host: 'www.canva.com', description: 'subscribe to Canva Pro for the carousel', cost: 15 });
  gateway.decide((await approvalOf(b.askId)).id, DENY, { kind: 'device', id: 'phone-1' });
  await approvals.tick();
  assert.deepEqual(decided.at(-1), { askId: b.askId, approved: false });
  const no = await act.authorize({ chainId: id, class: 'spend', host: 'www.canva.com', description: 'subscribe to Canva Pro for the carousel', cost: 15, approval: b.askId });
  assert.equal(no.decision, 'refuse'); assert.match(no.why, /Quinn declined/);

  // 6. answered in Messages first: that answer stands, a later tap changes nothing, and the phone's prompt is cleared
  const c = await act.authorize({ chainId: id, class: 'spend', host: 'www.fiverr.com', description: 'order the app-preview video edit', cost: 60 });
  const cApproval = (await approvalOf(c.askId)).id;
  await asks.answer(c.askId, 'yes');
  await approvals.tick();
  assert.equal((await approvalOf(c.askId)).settled, 'answered-elsewhere');
  assert.ok(gateway.calls.some(x => x.method === 'approval.resolve' && x.params.id === cApproval && x.params.decision === DENY && x.params.kind === 'plugin'));
  assert.equal(decided.length, 2, 'no decision relayed for it');
  assert.equal((await act.authorize({ chainId: id, class: 'spend', host: 'www.fiverr.com', description: 'order the app-preview video edit', cost: 60, approval: c.askId })).decision, 'proceed');

  // 7. no route to a phone: the ask goes out as a plain push instead, with no approval to wait on
  gateway.noRoute();
  const d = await act.authorize({ chainId: id, class: 'spend', host: 'www.etsy.com', description: 'purchase the journal mockup template', cost: 9 });
  assert.equal(pushed.length, 1); assert.equal(await approvalOf(d.askId), undefined);

  // 8. an approval nobody answered lapses after its window; the ask stays open for Messages and the app
  const e = await (async () => { const g2 = fakeGateway(); const ap2 = createPaymentApprovals({ pool, gateway: g2, deciders: ['phone-1'], clock: () => now, log: silent });
    asks.useApprovals(ap2); const r = await act.authorize({ chainId: id, class: 'spend', host: 'www.gumroad.com', description: 'purchase the icon pack for the site', cost: 19 });
    now += APPROVAL_WINDOW_MS + 61_000; await ap2.tick(); return r; })();
  assert.equal((await approvalOf(e.askId)).settled, 'expired');
  // and one the gateway no longer has can never be decided: settled at once
  const f = await (async () => { const g3 = fakeGateway(); const ap3 = createPaymentApprovals({ pool, gateway: g3, deciders: ['phone-1'], clock: () => now, log: silent });
    asks.useApprovals(ap3); const r = await act.authorize({ chainId: id, class: 'spend', host: 'www.gumroad.com', description: 'buy the font license for the site', cost: 29 });
    g3.snapshots.clear(); const get = g3.call; g3.call = async (m, p) => { if (m === 'approval.get') throw new Error('gateway approval.get: approval not found'); return get(m, p); };
    await ap3.tick(); return r; })();
  assert.equal((await approvalOf(f.askId)).settled, 'expired');
  assert.ok((await asks.open()).some(o => o.id === e.askId), 'still open');

  // 9. a payment is never held back by the daily cap (3 here, long since passed); an ordinary ask is
  assert.equal((await asks.ask({ chainId: id, kind: 'question', detail: 'Which caption reads better?' })).asked, false);
  const late = await act.authorize({ chainId: id, class: 'spend', host: 'www.gumroad.com', description: 'purchase the second icon pack', cost: 19 });
  assert.equal(late.decision, 'ask');
  assert.ok((await approvalOf(late.askId))?.id, 'the approval still went out');
}));

test('no approving device configured: payments still ask, as a plain push', async () => {
  const warned = [];
  const approvals = createPaymentApprovals({ pool: null, gateway: { call: async () => { throw new Error('not called'); } }, deciders: [], log: { warn: m => warned.push(m) } });
  assert.equal(await approvals.request({ title: 'Approve $5.00?', description: 'x' }), null);
  assert.match(warned[0], /no approving device/);
});

test('an answer reaches every agent waiting on the ask, even one that joined an ask the engine raised with no session', async () => {
  const relayed = [], answered = [];
  const pool = { query: async (sql, params) => (/FROM agent_deployments WHERE ask_id/.test(sql) && params[0] === 41 ? { rows: [{ id: 'dep-a' }, { id: 'dep-b' }] } : { rows: [] }) };
  const asks = { answer: async (id, reply) => { answered.push([id, reply]); return { id, metadata: { chainId: 27 } }; } };
  const agents = { relay: async (id, reply, { via }) => { relayed.push([id, reply, via]); } };
  const inbox = createInbox({ pool, queue: {}, worth: {}, workRoot: '/tmp', asks, agents, log: silent });
  await inbox.answerAsk({ id: 41, reply: 'Approved on iPhone (ask #41).', via: 'iPhone' });
  assert.deepEqual(answered, [[41, 'Approved on iPhone (ask #41).']]);
  assert.deepEqual(relayed, [['dep-a', 'Approved on iPhone (ask #41).', 'iPhone'], ['dep-b', 'Approved on iPhone (ask #41).', 'iPhone']]);
});
