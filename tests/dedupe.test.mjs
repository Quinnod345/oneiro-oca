import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { words, overlap, sameThing, sameWriting, mergeTarget } from '../reasoning/dedupe.js';
import { createAgents } from '../reasoning/agents.js';
import { createAsks } from '../reasoning/asks.js';
import { createInbox } from '../reasoning/inbox.js';
import { createPonderQueue } from '../reasoning/ponder-queue.js';
import { createWorthLedger } from '../motivation/worth-ledger.js';
import { createRiskJournal } from '../motivation/risk-journal.js';
import { STRATEGIES } from '../reasoning/strategies.js';

const silent = { log() {}, warn() {} };
const blocked = async () => ({ status: 'needs_evidence', checkpoint: { version: 1, passes: [] }, missingEvidence: ['x'] });
async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'dedupe_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema + ',public' });
    await pool.query(`CREATE TABLE thought_chains (id SERIAL PRIMARY KEY, seed TEXT NOT NULL, priority FLOAT8 DEFAULT .5, status TEXT DEFAULT 'pondering', depth INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), ponder_state JSONB)`);
    await pool.query(`CREATE TABLE hypotheses (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(), domain TEXT, claim TEXT, confidence FLOAT8, prediction TEXT, prediction_deadline TIMESTAMPTZ, status TEXT, actual_outcome TEXT, tested_at TIMESTAMPTZ, source_type TEXT, source_data JSONB DEFAULT '{}'::jsonb)`);
    await pool.query(`CREATE TABLE pursuit_work (id UUID PRIMARY KEY, chain_id INT, status TEXT, request_id UUID, created_at TIMESTAMPTZ DEFAULT now())`);
    for (const m of ['057_worth_ledger', '058_risk_decisions', '062_agent_deployments', '064_pursuit_board']) await pool.query(await readFile(new URL(`../migrations/${m}.sql`, import.meta.url), 'utf8'));
    await run(pool);
  } finally { if (pool) await pool.end(); await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end(); }
}
function fakeGateway() {
  const sessions = new Map();
  return {
    async available() { return true; },
    async createSession({ key }) { sessions.set(key, []); return { ok: true, key }; },
    async turn({ idempotencyKey }) { return { runId: idempotencyKey, status: 'accepted' }; },
    async wait() { return { status: 'pending' }; },
    async history() { return []; },
    async transcript() { return { messages: [], pending: 0 }; },
    async call() { return { ok: true }; },
  };
}

test('the same thing in other words is the same thing; different work is not', () => {
  // real duplicates from 2026-09-30
  assert.ok(sameThing('Pricing Research: Top Journaling Apps', 'Pricing Research: iOS Journaling Apps'));
  assert.ok(sameThing('The Stalled Search on Want #28', 'The Stalled Search'));
  assert.ok(sameThing('InnerEcho pricing decision draft — US App Store', 'InnerEcho pricing decision and exact research plan'));
  // "distinct from #37 …" clauses don't make a copy distinct
  assert.equal(overlap('Fix spending-cap accounting at the committing-action boundary', 'Fix spending-cap accounting at the committing-action boundary, distinct from #49 operation-unspecific consent reuse'), 1);
  assert.ok(!words('distinct from #49 operation consent').has('operation'));
  // the four live #27 agents are genuinely different work
  const live = ['Improve InnerEcho’s App Store promotional text. Read the launch kit and current listing', 'Improve @getinnerecho’s Instagram profile for incoming October visitors',
    'Set up Apple Ads API access for InnerEcho so Apple Ads work can go through the Apple API', 'Get InnerEcho listed on AlternativeTo through its permitted product-submission process'];
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) assert.ok(!sameThing(live[i], live[j]), `${i} vs ${j}`);
  // writing: same title, or largely the same body
  const body = 'Day One charges $34.99 a year, Reflectly $59.99, Journey $29.99; most offer a free tier and a trial, and annual plans save about a third over monthly. '.repeat(3);
  assert.ok(sameWriting({ title: 'App Store Pricing Landscape', body }, { title: 'InnerEcho Pricing Benchmarks', body: body + ' Also: prices checked today.' }));
  assert.ok(!sameWriting({ title: 'Churn after day 7', body: 'Users who skip three prompts in a row rarely come back. '.repeat(6) }, { title: 'App Store Pricing Landscape', body }));
});

test('a new self-want joins the open one it repeats; past the cap it joins the closest', () => {
  const open = [{ id: 38, d: 'Fix stale, over-deadline retry authorization at the committing-action boundary' }, { id: 62, d: 'Fix OCA self-build publication so concurrent live-checkout work is preserved' }];
  const describe = w => w.d;
  assert.equal(mergeTarget(open, 'Fix stale retry authorization past its deadline at the committing-action boundary, distinct from #38', { describe }).target.id, 38);
  assert.equal(mergeTarget(open, 'Teach the thinker to summarize finished runs', { describe, max: 8 }), null, 'new and there is room');
  assert.equal(mergeTarget(open, 'Teach the thinker to summarize finished self-build runs', { describe, max: 2 }).why, 'full');
});

test('never two agents on the same work; different work still runs', async () => database(async pool => {
  const now = 30 * 86400000;
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const controlsState = { autonomousActions: false, askOwner: true, agentSlots: 5 };
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => controlsState });
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
  const agents = createAgents({ pool, gateway: fakeGateway(), queue, risk, controls: { get: async () => controlsState }, clock: () => now, log: silent });
  await agents.init();
  const chain = await queue.enqueue({ seed: 'Get InnerEcho more paying subscribers', doneWhen: 'a net positive month', stakes: [{ entityKey: 'person:quinn', share: 1 }] }, { origin: { kind: 'explicit', by: 'quinn' } });
  const first = await agents.deploy(chain.chain_id, { kind: 'research', task: 'Improve the App Store promotional text for the October launch', firedBy: 'engine' });
  assert.equal(first.decision, 'proceed');
  const again = await agents.deploy(chain.chain_id, { kind: 'research', task: 'Rewrite the October launch promotional text on the App Store listing', firedBy: 'engine' });
  assert.equal(again.decision, 'duplicate'); assert.equal(again.id, null); assert.match(again.why, /already doing this/);
  const other = await agents.deploy(chain.chain_id, { kind: 'research', task: 'Get InnerEcho listed on AlternativeTo through its submission process', firedBy: 'engine' });
  assert.equal(other.decision, 'proceed');
  assert.equal(await agents.liveCount(), 2);
}));

test('the same question in other words joins the open ask; a payment never does', async () => database(async pool => {
  const now = 30 * 86400000;
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => ({ autonomousActions: false, askOwner: true }) });
  const sent = [];
  const asks = createAsks({ pool, risk, clock: () => now, log: silent, deliverers: { push: async m => { sent.push(m); } } }); await asks.init();
  const a = await asks.ask({ chainId: 27, kind: 'question', detail: 'Which second Apple Account email should I invite as the Apple Ads API user?' });
  const b = await asks.ask({ chainId: 27, kind: 'question', detail: 'What Apple Account email should be invited as the Apple Ads API user for InnerEcho?' });
  assert.equal(b.asked, false); assert.equal(b.id, a.id); assert.equal(sent.length, 1, 'one ping, not two');
  const c = await asks.ask({ chainId: 28, kind: 'question', detail: 'What Apple Account email should be invited as the Apple Ads API user for InnerEcho?' });
  assert.equal(c.asked, true, 'another want asks for itself');
  const p1 = await asks.ask({ chainId: 27, kind: 'question', detail: 'Oneiro wants to buy the icon pack on gumroad.com (cost $19.00). Are you sure you want to go through with this? Reply yes or no.', payment: { title: 'Approve $19.00?', description: 'x' } });
  const p2 = await asks.ask({ chainId: 27, kind: 'question', detail: 'Oneiro wants to buy the icon set on gumroad.com (cost $29.00). Are you sure you want to go through with this? Reply yes or no.', payment: { title: 'Approve $29.00?', description: 'y' } });
  assert.notEqual(p2.id, p1.id, 'a yes to one purchase never stands in for another');
}));

test('a want with a deliverable waiting for a verdict drafts no other', async () => {
  const propose = STRATEGIES.find(s => s.name === 'propose_an_artifact');
  let drafted = 0;
  const ctx = (commitments, receipts = []) => ({ chain: { chain_id: 28 }, state: { attempts: 3, commitments, want: { receipts } },
    deps: { llm: { call: async () => { drafted++; throw new Error('should not draft'); } }, writeArtifact: async () => ({ path: '/x' }) } });
  const waiting = [{ kind: 'artifact', path: '/w/28/artifacts/strategy-2-pricing-plan.md', title: 'Pricing plan', at: Date.now() - 3600_000 }];
  const r = await propose.run(ctx(waiting));
  assert.equal(r.status, 'needs_evidence'); assert.equal(r.stopReason, 'awaiting_verdict'); assert.match(r.conclusion, /Waiting for Quinn's verdict on "Pricing plan"/);
  assert.equal(drafted, 0);
  // rated, or a week old: it may draft again (the model is asked)
  const rated = await propose.run(ctx(waiting, [{ receiptId: 'rated-artifact-strategy-2-pricing-plan.md' }]));
  assert.notEqual(rated.stopReason, 'awaiting_verdict');
  const old = await propose.run(ctx([{ ...waiting[0], at: Date.now() - 8 * 86400_000 }]));
  assert.notEqual(old.stopReason, 'awaiting_verdict');
});

test('Judge shows one card per piece of work: near-copies collapse, leave with its verdict, and can be dismissed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'judge-dup-'));
  try {
    await mkdir(join(dir, 'thinker'), { recursive: true });
    const body = 'Day One charges $34.99 a year, Reflectly $59.99, Journey $29.99; most offer a free tier and a trial, and annual plans save about a third. '.repeat(3);
    const note = (name, title, text) => writeFile(join(dir, 'thinker', name), `# ${title}\n\n_Written by the thinker on 2026-09-30; held for a person, never sent._\n\n${text}\n`);
    await note('2026-09-28-pricing-research-top-journaling-apps.md', 'Pricing Research: Top Journaling Apps', body);
    await note('2026-09-29-pricing-research-ios-journaling-apps.md', 'Pricing Research: iOS Journaling Apps', body + ' Rechecked.');
    await note('2026-09-30-app-store-pricing-landscape.md', 'App Store Pricing Landscape', body + ' Landscape view.');
    await note('2026-09-30-churn-after-day-seven.md', 'Churn after day seven', 'Users who skip three prompts in a row rarely come back. '.repeat(6));
    const dismissed = [], signals = [];
    const pool = { async query(sql, params) {
      if (/CREATE TABLE IF NOT EXISTS inbox_dismissed/.test(sql)) return { rows: [] };
      if (/SELECT kind, id FROM inbox_dismissed/.test(sql)) return { rows: dismissed.map(([kind, id]) => ({ kind, id })) };
      if (/INSERT INTO inbox_dismissed/.test(sql)) { dismissed.push([params[0], params[1]]); return { rows: [] }; }
      if (/FROM worth_signals WHERE id LIKE 'rate:note:%'/.test(sql)) return { rows: signals.map(id => ({ id })) };
      return { rows: [] };
    } };
    const worth = { record: async ({ id }) => { signals.push(id); return { id }; } };
    const inbox = createInbox({ pool, queue: {}, worth, workRoot: dir, log: silent });
    let { toRate } = await inbox.list();
    assert.equal(toRate.length, 2, 'three pricing notes are one card; the churn note is its own');
    const pricing = toRate.find(i => /Pricing/.test(i.title));
    assert.equal(pricing.id, '2026-09-30-app-store-pricing-landscape.md', 'the newest version is the card');
    assert.equal(pricing.similar.length, 2);
    // a verdict on the card takes its near-copies with it, dismissed rather than rated
    await inbox.rate({ kind: 'note', id: pricing.id, usefulness: 0.1 });
    ({ toRate } = await inbox.list());
    assert.deepEqual(toRate.map(i => i.title), ['Churn after day seven']);
    assert.equal(dismissed.length, 2); assert.equal(signals.length, 1, 'one rating, for the card itself');
    // and anything can be set aside without a verdict
    await inbox.dismiss({ kind: 'note', id: '2026-09-30-churn-after-day-seven.md', reason: 'about a closed want' });
    assert.equal((await inbox.list()).toRate.length, 0);
    await assert.rejects(inbox.dismiss({ kind: 'entity', id: 'x' }), /artifact or a note/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
