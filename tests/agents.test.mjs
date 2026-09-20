import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgents, parseReport, composeBrief, AGENT_KINDS } from '../reasoning/agents.js';
import { createAsks } from '../reasoning/asks.js';
import { createInbox } from '../reasoning/inbox.js';
import { createPonderQueue } from '../reasoning/ponder-queue.js';
import { createWorthLedger } from '../motivation/worth-ledger.js';
import { createRiskJournal } from '../motivation/risk-journal.js';
import { createProposal, ACTION_KINDS } from '../motivation/risk.js';
import { messageText } from '../gateway.js';

const blocked = async () => ({ status: 'needs_evidence', checkpoint: { version: 1, passes: [] }, missingEvidence: ['August pricing', 'Cost per subscriber'] });
async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'agents_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema + ',public' });
    await pool.query(`CREATE TABLE thought_chains (id SERIAL PRIMARY KEY, seed TEXT NOT NULL, priority FLOAT8 DEFAULT .5, status TEXT DEFAULT 'pondering', depth INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), ponder_state JSONB)`);
    await pool.query(`CREATE TABLE hypotheses (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(), domain TEXT, claim TEXT, confidence FLOAT8, prediction TEXT, prediction_deadline TIMESTAMPTZ, status TEXT, actual_outcome TEXT, tested_at TIMESTAMPTZ, source_type TEXT, source_data JSONB DEFAULT '{}'::jsonb)`);
    await pool.query(`CREATE TABLE pursuit_work (id UUID PRIMARY KEY, chain_id INT, status TEXT, request_id UUID, created_at TIMESTAMPTZ DEFAULT now())`);
    for (const m of ['057_worth_ledger', '058_risk_decisions', '062_agent_deployments']) await pool.query(await readFile(new URL(`../migrations/${m}.sql`, import.meta.url), 'utf8'));
    await run(pool);
  } finally { if (pool) await pool.end(); await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end(); }
}

// A gateway in memory: sessions with transcripts, runs that resolve to a scripted reply per turn.
function fakeGateway(script = {}) {
  const sessions = new Map(), runs = new Map(); let up = true; const at = () => (script.clock ? script.clock() : Date.now());
  const g = {
    calls: [], sessions, runs, setUp(v) { up = v; },
    async available() { return up; },
    async createSession({ key, agentId, displayName, cwd }) { sessions.set(key, { key, agentId, displayName, cwd, messages: [] }); g.calls.push(['create', key]); return { ok: true, key }; },
    async turn({ sessionKey, message, idempotencyKey }) {
      const s = sessions.get(sessionKey); if (!s) throw new Error('no session'); s.messages.push({ role: 'user', text: message, at: at() });
      const n = s.messages.filter(m => m.role === 'user' && m.text.startsWith('[')).length;
      const reply = typeof script.reply === 'function' ? script.reply(sessionKey, message, n) : `ok\n\n\`\`\`oca\n{"status":"done","summary":"nothing"}\n\`\`\``;
      runs.set(idempotencyKey, { status: 'ok', terminalReply: { text: reply } }); s.messages.push({ role: 'assistant', text: reply, at: at() });
      g.calls.push(['turn', sessionKey, message.slice(0, 40)]); return { runId: idempotencyKey, status: 'accepted' };
    },
    async wait(runId) { return runs.get(runId) || { status: 'pending' }; },
    async history(sessionKey) { return [...(sessions.get(sessionKey)?.messages || [])]; },
    async transcript(sessionKey) { return { messages: [...(sessions.get(sessionKey)?.messages || [])], pending: 0 }; },
    // the person speaks in the app: the app runs the turn itself
    personSays(sessionKey, text, reply) { const s = sessions.get(sessionKey); s.messages.push({ role: 'user', text, at: at() }); if (reply) s.messages.push({ role: 'assistant', text: reply, at: at() }); },
    async call(method, params) { g.calls.push([method, params]); return { ok: true }; },
  };
  return g;
}
const block = o => `\n\`\`\`oca\n${JSON.stringify(o)}\n\`\`\``;

test('a report is the last oca block of a reply, validated; no block is no report', () => {
  assert.equal(parseReport('hello'), null);
  assert.equal(parseReport('x' + block({ status: 'nope' })).status, 'malformed');
  const r = parseReport(`I found it.${block({ status: 'done', summary: 'found', evidence: [{ source: 'https://a.b/c', quote: '  the   price is $4.99 per month ', observation: 'price' }, { bad: 1 }], remaining: ['q1'], nextStep: 'n' })}`);
  assert.equal(r.status, 'done'); assert.equal(r.evidence.length, 1); assert.equal(r.evidence[0].quote, 'the price is $4.99 per month'); assert.deepEqual(r.remaining, ['q1']);
  assert.equal(parseReport(`first${block({ status: 'working', summary: 'a' })} then${block({ status: 'needs_person', summary: 'why' })}`).question, 'why', 'the last block wins; a question defaults to the summary');
  assert.equal(parseReport(block({ status: 'done', summary: 's', files_changed: ['a.js'], tests_run: true, ready: true })).ready, true);
  assert.equal(messageText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }]), 'a\nb');
});

test('a brief names the pursuit, the role, the task, what is known, and the contract; the engine speaks as [thinker]', () => {
  const b = composeBrief({ kind: 'research', chainId: 27, want: 'InnerEcho profitability', doneWhen: 'net positive month', task: 'Find the price', evidence: [{ source: 'file', observation: 'zero' }], missing: ['pricing'], remaining: ['q'] });
  for (const s of ['[thinker] You are deployed', 'pursuit #27', 'Done when: net positive month', 'Your role: research', 'aside__aside_snapshot_tab', 'Task now: Find the price', 'Still missing', '- pricing', 'Open questions', 'already known', '"status":"needs_person"', 'never post, pay, delete or sign out']) assert.ok(b.includes(s), s);
  assert.ok(composeBrief({ kind: 'builder', chainId: 3, want: 'fix', cwd: '/tmp/wt' }).includes('/tmp/wt'));
  assert.ok(composeBrief({ kind: 'talker', chainId: 3, want: 'x', engine: 'http://e' }).includes('curl -s http://e/ponder/3'));
  assert.deepEqual(AGENT_KINDS, ['research', 'talker', 'builder', 'executor']);
  assert.ok(ACTION_KINDS.includes('deploy_agent'));
  assert.equal(createProposal({ kind: 'deploy_agent', description: 'x', reversibility: 'sandboxed' }).capability, 'act_reversible');
});

test('an agent is deployed as a session, works in turns, asks the person through an ask that opens its session, and finishes with verified evidence and the person\'s words on the want', async () => database(async pool => {
  const dir = await mkdtemp(join(tmpdir(), 'oca-agents-'));
  await writeFile(join(dir, 'pricing.txt'), 'InnerEcho Premium costs $4.99 per month or $29.99 per year in the US store.\n');
  let now = 30 * 86400000;
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const controlsState = { autonomousActions: false, askOwner: true, agentSlots: 2 };
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => controlsState });
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
  const sent = [];
  const asks = createAsks({ pool, risk, clock: () => now, log: { log() {}, warn() {} }, deliverers: { push: async m => { sent.push(m); } } }); await asks.init();
  // turn 1: working; turn 2: needs the person; after the person answers (in the app): done with one real quote and one fake
  const gw = fakeGateway({ clock: () => (now += 1000), reply: (key, msg, n) => n === 1 ? `Looking.${block({ status: 'working', summary: 'read the listing' })}` : `I need one thing.${block({ status: 'needs_person', question: 'Which store region should I price in?', summary: 'region unknown' })}` });
  const agents = createAgents({ pool, gateway: gw, queue, risk, asks, controls: { get: async () => controlsState }, clock: () => now, log: { log() {}, warn() {} }, roots: [dir], maxTurns: 6 });
  await agents.init();
  const inbox = createInbox({ pool, queue, worth, workRoot: dir, clock: () => now, asks, agents });
  const chain = await inbox.want({ description: 'Find the current App Store price of InnerEcho', doneWhen: 'The price is quoted from the listing.' });
  // deploy
  const d = await agents.deploy(chain.chain_id, { kind: 'research', task: 'Find the price', firedBy: 'engine' });
  assert.equal(d.decision, 'proceed'); assert.equal(d.status, 'running'); assert.match(d.sessionKey, /^agent:main:want-\d+-research-/); assert.equal(d.turns, 1);
  assert.equal(gw.calls.filter(c => c[0] === 'create').length, 1);
  assert.equal(await agents.liveCount(), 1);
  // slots bound the fan-out
  await agents.deploy(chain.chain_id, { kind: 'research', task: 'second', firedBy: 'engine' });
  await assert.rejects(agents.deploy(chain.chain_id, { kind: 'research', task: 'third', firedBy: 'engine' }), /agent slots are busy/);
  // poll: turn 1 was "working" → the thinker sends it on; turn 2 → needs the person → an ask that opens the session
  await agents.poll();
  let a = await agents.get(d.id); assert.equal(a.turns, 2, 'sent on after working');
  await agents.poll();
  a = await agents.get(d.id); assert.equal(a.status, 'waiting_person'); assert.equal(a.question, 'Which store region should I price in?'); assert.ok(a.askId);
  assert.equal(sent.length, 1); assert.match(sent[0], /agent on #\d+ .* asks: Which store region/); assert.match(sent[0], /answer it in the chat/);
  const box = await inbox.list();
  assert.equal(box.asks[0].sessionKey, d.sessionKey, 'the ask carries the session to open'); assert.equal(box.asks[0].kind, 'question');
  assert.equal(box.wants[0].agents.length, 2); assert.equal(box.wants[0].agents.find(x => x.id === d.id).question, a.question); assert.equal(box.agentSlots, 2);
  // the person answers in the app; the app ran the turn; the agent finishes quoting the file (real) and a page (unverifiable here)
  gw.personSays(d.sessionKey, 'US store. Assume $4.99.', `Done.${block({ status: 'done', summary: 'priced', evidence: [{ source: join(dir, 'pricing.txt'), quote: 'costs $4.99 per month or $29.99 per year', observation: 'US listing price' }, { source: 'https://apps.apple.com/x', quote: 'this quote cannot be checked without Aside', observation: 'page' }], nextStep: 'compare', remaining: ['cost per subscriber'] })}`);
  await agents.poll();
  a = await agents.get(d.id);
  assert.equal(a.status, 'done'); assert.equal(a.report.verified.length, 1); assert.equal(a.report.unverified.length, 1); assert.equal(a.report.stated, 1); assert.equal(a.report.evidenceApplied, true);
  assert.equal((await asks.open()).length, 0, 'the ask was answered by the reply in the session');
  const want = await queue.get(chain.chain_id);
  assert.ok(want.evidence.some(e => /stated by Quinn in the agent session/.test(e.source) && /US store/.test(e.observation)), 'the person\'s words are evidence');
  assert.ok(want.evidence.some(e => /^file: /.test(e.source) && /\$4\.99/.test(e.observation)), 'the verified quote is evidence');
  assert.equal(want.continuity.found, true); assert.deepEqual(want.continuity.remaining, ['cost per subscriber']);
  const journal = (await risk.recent({ chainId: chain.chain_id })).filter(x => x.id === `agent:${d.id}`);
  assert.equal(journal.length, 1); assert.equal(journal[0].outcome.result, 'success');
  // an answer that arrives another way is relayed into the session
  const d2 = (await agents.list({ chainId: chain.chain_id })).find(x => x.id !== d.id);
  await agents.relay(d2.id, 'go with the US store', { via: 'Messages' });
  assert.ok(gw.sessions.get(d2.sessionKey).messages.some(m => m.role === 'user' && m.text.startsWith('[Quinn, via Messages] go with')));
  // cancel
  const c = await agents.cancel(d2.id); assert.equal(c.status, 'cancelled'); assert.equal(await agents.liveCount(), 0);
}));

test('the thinker plans: a continuous want with no live agent gets a research agent on the cadence; a talker is standing and what the person tells it is evidence; a closed gateway deploys nothing', async () => database(async pool => {
  let now = 30 * 86400000;
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const controlsState = { autonomousActions: false, askOwner: true, agentSlots: 3 };
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => controlsState });
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
  const gw = fakeGateway({ clock: () => (now += 1000), reply: (key, msg) => msg.startsWith('[thinker] You are deployed') && /Your role: talker/.test(msg) ? 'Here for you.' : `w${block({ status: 'working', summary: 'w' })}` });
  const split = { called: 0 };
  const llm = { messages: { create: async () => { split.called++; return { content: [{ type: 'text', text: '{"tasks":["Find the US price on the App Store listing and quote it","Find the cost per subscriber from the hosting invoices"]}' }] }; } } };
  const agents = createAgents({ pool, gateway: gw, queue, risk, llm, controls: { get: async () => controlsState }, clock: () => now, log: { log() {}, warn() {} }, continuityIntervalMs: 1000 });
  await agents.init();
  const inbox = createInbox({ pool, queue, worth, workRoot: tmpdir(), clock: () => now, agents });
  const chain = await inbox.want({ description: 'InnerEcho profitability', doneWhen: 'A month nets positive.', continuous: true });
  await queue.runNext?.().catch(() => {});   // let the review leave it awaiting evidence
  await pool.query(`UPDATE thought_chains SET status = 'awaiting_evidence', ponder_state = jsonb_set(ponder_state, '{result}', '{"missingEvidence":["August pricing","Cost per subscriber"]}'::jsonb) WHERE id = $1`, [chain.chain_id]);
  // due now: the thinker splits two open threads across two agents (slots allow), not one
  const p = await agents.plan();
  assert.equal(p.started.length, 2, 'two parallel research agents'); assert.equal(split.called, 1);
  assert.equal(await agents.liveCount(chain.chain_id), 2);
  assert.deepEqual((await agents.plan()).started, [], 'nothing more while agents are live');
  // the talker: standing, one per want; the person's words there become evidence on the want
  const t = await agents.talker(chain.chain_id); assert.equal(t.status, 'standing'); assert.equal(t.kind, 'talker');
  assert.equal((await agents.talker(chain.chain_id)).id, t.id, 'one talker per want');
  gw.personSays(t.sessionKey, 'My numbers are zero. We start from scratch.', 'Understood — starting from zero.');
  await agents.poll();
  const want = await queue.get(chain.chain_id);
  assert.ok(want.evidence.some(e => /stated by Quinn/.test(e.source) && /start from scratch/.test(e.observation)));
  // the gateway goes away: plans and deploys stop, nothing throws
  gw.setUp(false);
  assert.deepEqual((await agents.plan()).started, []);
  await assert.rejects(agents.deploy(chain.chain_id, { kind: 'research', task: 'x' }), /gateway is not reachable/);
}));

test('evidence that meets a want mid-review is applied on a later poll, never dropped; a second agent with the same need joins the open ask instead of ringing again', async () => database(async pool => {
  let now = 30 * 86400000;
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const controlsState = { autonomousActions: false, askOwner: true, agentSlots: 4 };
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => controlsState });
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
  const sent = [];
  const asks = createAsks({ pool, risk, clock: () => now, log: { log() {}, warn() {} }, deliverers: { push: async m => { sent.push(m); } } }); await asks.init();
  const dir = await mkdtemp(join(tmpdir(), 'oca-agents-'));
  await writeFile(join(dir, 'a.txt'), 'the yearly plan is priced at twenty-nine ninety-nine\n');
  const gw = fakeGateway({ clock: () => (now += 1000), reply: (key, msg) => /ask-first/.test(msg)
    ? `Need you.${block({ status: 'needs_person', question: 'Which OpenAI account holds the production API key for InnerEcho?', summary: 'x' })}`
    : `Done.${block({ status: 'done', summary: 'priced', evidence: [{ source: join(dir, 'a.txt'), quote: 'yearly plan is priced at twenty-nine ninety-nine', observation: 'yearly' }] })}` });
  const agents = createAgents({ pool, gateway: gw, queue, risk, asks, controls: { get: async () => controlsState }, clock: () => now, log: { log() {}, warn() {} }, roots: [dir] });
  await agents.init();
  const inbox = createInbox({ pool, queue, worth, workRoot: dir, clock: () => now, asks, agents });
  const chain = await inbox.want({ description: 'Price InnerEcho', doneWhen: 'A yearly price is quoted.' });
  // the want is mid-review when the agent finishes
  const d = await agents.deploy(chain.chain_id, { kind: 'research', task: 'quote it', firedBy: 'engine' });
  await pool.query(`UPDATE thought_chains SET status = 'running' WHERE id = $1`, [chain.chain_id]);
  await agents.poll();
  let a = await agents.get(d.id); assert.equal(a.status, 'done'); assert.equal(a.report.evidenceApplied, false); assert.match(a.report.applyError, /running/);
  await agents.poll(); a = await agents.get(d.id); assert.equal(a.report.evidenceApplied, false, 'still mid-review');
  await pool.query(`UPDATE thought_chains SET status = 'awaiting_evidence' WHERE id = $1`, [chain.chain_id]);
  await agents.poll(); a = await agents.get(d.id); assert.equal(a.report.evidenceApplied, true, 'applied once the review ended');
  assert.ok((await queue.get(chain.chain_id)).evidence.some(e => /twenty-nine/.test(e.observation)));
  // two agents, one need
  const d1 = await agents.deploy(chain.chain_id, { kind: 'research', task: 'ask-first A', firedBy: 'engine' });
  const d2 = await agents.deploy(chain.chain_id, { kind: 'research', task: 'ask-first B', firedBy: 'engine' });
  await agents.poll();
  const [a1, a2] = [await agents.get(d1.id), await agents.get(d2.id)];
  assert.equal(a1.status, 'waiting_person'); assert.equal(a2.status, 'waiting_person');
  assert.equal(a1.askId, a2.askId, 'the second agent joined the first ask'); assert.equal(sent.length, 1, 'one push, not two');
}));

test('a provider limit is not the pursuit\'s failure: deployments pause for an hour, the person is told once, the cadence is not spent', async () => database(async pool => {
  let now = 30 * 86400000;
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const controlsState = { autonomousActions: false, askOwner: true, agentSlots: 4 };
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => controlsState });
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
  const sent = [];
  const asks = createAsks({ pool, risk, clock: () => now, log: { log() {}, warn() {} }, deliverers: { push: async m => { sent.push(m); } } }); await asks.init();
  const gw = fakeGateway({ clock: () => (now += 1000), reply: () => 'x' });
  gw.wait = async () => ({ status: 'error', error: { message: "You're out of usage credits. Switch to another model, or manage usage credits at claude.ai" } });
  const agents = createAgents({ pool, gateway: gw, queue, risk, asks, controls: { get: async () => controlsState }, clock: () => now, log: { log() {}, warn() {} } });
  await agents.init();
  const inbox = createInbox({ pool, queue, worth, workRoot: tmpdir(), clock: () => now, asks, agents });
  const chain = await inbox.want({ description: 'Price InnerEcho', doneWhen: 'A price is quoted.', continuous: true });
  const d = await agents.deploy(chain.chain_id, { kind: 'research', task: 'quote', firedBy: 'engine' });
  await agents.poll();
  const a = await agents.get(d.id); assert.equal(a.status, 'failed'); assert.match(a.error, /usage credits/);
  assert.equal(sent.length, 1); assert.match(sent[0], /^Oneiro: its agents cannot run/);
  const want = await queue.get(chain.chain_id); assert.equal(want.continuity?.dry ?? 0, 0, 'the cadence was not spent on the provider');
  await assert.rejects(agents.deploy(chain.chain_id, { kind: 'research', task: 'again', firedBy: 'engine' }), /provider is limiting/);
  assert.deepEqual((await agents.plan()).started, [], 'paused');
  const person = await agents.deploy(chain.chain_id, { kind: 'research', task: 'by hand', firedBy: 'person' }); assert.ok(person.id, 'the person may still deploy by hand');
  now += 61 * 60_000;
  await assert.doesNotReject(agents.deploy(chain.chain_id, { kind: 'research', task: 'later', firedBy: 'engine' }), 'resumes after an hour');
  const journal = (await risk.recent({ chainId: chain.chain_id })).find(x => x.id === `agent:${d.id}`); assert.equal(journal.outcome.result, 'not_attempted');
}));

test('a run lost to a gateway restart is recovered from the transcript: the agent\'s newer reply is taken as the turn', async () => database(async pool => {
  let now = 30 * 86400000;
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => ({ autonomousActions: false, askOwner: true }) });
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
  const gw = fakeGateway({ clock: () => (now += 1000), reply: () => `later${block({ status: 'done', summary: 'recovered' })}` });
  const agents = createAgents({ pool, gateway: gw, queue, risk, controls: { get: async () => ({ agentSlots: 4 }) }, clock: () => now, log: { log() {}, warn() {} } });
  await agents.init();
  const inbox = createInbox({ pool, queue, worth, workRoot: tmpdir(), clock: () => now, agents });
  const chain = await inbox.want({ description: 'Recover a lost run', doneWhen: 'The reply is taken from the transcript.' });
  const d = await agents.deploy(chain.chain_id, { kind: 'research', task: 't', firedBy: 'engine' });
  gw.wait = async () => ({ status: 'timeout' });   // the run id is gone with the restart
  await agents.poll(); assert.equal((await agents.get(d.id)).status, 'running', 'within the grace period nothing is assumed');
  now += 120_000;
  await agents.poll(); assert.equal((await agents.get(d.id)).status, 'done', 'the transcript reply became the turn');
}));
