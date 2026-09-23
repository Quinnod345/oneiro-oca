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
import { createGateway, messageText } from '../gateway.js';

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
    for (const m of ['057_worth_ledger', '058_risk_decisions', '062_agent_deployments', '064_pursuit_board']) await pool.query(await readFile(new URL(`../migrations/${m}.sql`, import.meta.url), 'utf8'));
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
  // what an agent set up that lasts travels with its report, for the board; a bare string or a stub is not a thing made
  const made = parseReport(block({ status: 'done', summary: 's', made: [{ what: 'Listing on OBOHITO', where: 'https://obohito.com/app/innerecho' }, 'x', { what: 'ab' }] })).made;
  assert.deepEqual(made, [{ what: 'Listing on OBOHITO', where: 'https://obohito.com/app/innerecho' }]);
  assert.ok(composeBrief({ kind: 'research', chainId: 1, want: 'w' }).includes('"made":[{"what"'), 'the contract asks for what was made');
  assert.equal(messageText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }]), 'a\nb');
});

test('a brief names the pursuit, the role, the task, what is known, and the contract; the engine speaks as [thinker]', () => {
  const b = composeBrief({ kind: 'research', chainId: 27, want: 'InnerEcho profitability', doneWhen: 'net positive month', task: 'Find the price', evidence: [{ source: 'file', observation: 'zero' }], missing: ['pricing'], remaining: ['q'] });
  for (const s of ['[thinker] You are deployed', 'pursuit #27', 'Done when: net positive month', 'Your role: research', 'aside__aside_snapshot_tab', 'Task now: Find the price', 'Still missing', '- pricing', 'Open questions', 'already known', '"status":"needs_person"', 'hand the whole task to aside__aside_do', 'passing pursuit 27', 'Graded coursework and CAPTCHAs are never yours']) assert.ok(b.includes(s), s);
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
  const llm = { messages: { create: async () => { split.called++; return { content: [{ type: 'text', text: '{"thought":"Pricing is the lever right now.","moves":[{"task":"Find the US price on the App Store listing and quote it","why":"anchor","stream":"pricing"},{"task":"Find the cost per subscriber from the hosting invoices","why":"margin","stream":"Costs!"}]}' }] }; } } };
  const agents = createAgents({ pool, gateway: gw, queue, risk, llm, controls: { get: async () => controlsState }, clock: () => now, log: { log() {}, warn() {} }, continuityIntervalMs: 1000 });
  await agents.init();
  const inbox = createInbox({ pool, queue, worth, workRoot: tmpdir(), clock: () => now, agents });
  const chain = await inbox.want({ description: 'InnerEcho profitability', doneWhen: 'A month nets positive.', continuous: true });
  await queue.runNext?.().catch(() => {});   // let the review leave it awaiting evidence
  await pool.query(`UPDATE thought_chains SET status = 'awaiting_evidence', ponder_state = jsonb_set(ponder_state, '{result}', '{"missingEvidence":["August pricing","Cost per subscriber"]}'::jsonb) WHERE id = $1`, [chain.chain_id]);
  // due now: the thinker splits two open threads across two agents (slots allow), not one
  const p = await agents.plan();
  assert.equal(p.started.length, 2, 'the strategist chose two moves'); assert.equal(split.called, 1);
  assert.equal((await queue.get(chain.chain_id)).continuity.lastThought, 'Pricing is the lever right now.', 'its thought is kept on the pursuit');
  assert.equal(await agents.liveCount(chain.chain_id), 2);
  assert.deepEqual((await agents.plan()).started, [], 'nothing more while agents are live');
  // each move is filed under the workstream the strategist named for it, as the board shows it
  const filed = (await pool.query(`SELECT stream FROM agent_deployments WHERE chain_id = $1 ORDER BY stream`, [chain.chain_id])).rows.map(r => r.stream);
  assert.deepEqual(filed, ['Costs', 'Pricing']);
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

test('a dated step does not put the pursuit to sleep: work goes on between, and at that moment an agent does the planned step', async () => database(async pool => {
  let now = Date.parse('2026-09-23T17:00:00Z');
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const controlsState = { autonomousActions: false, askOwner: true, agentSlots: 4 };
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => controlsState });
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
  const briefs = [];
  const gw = fakeGateway({ clock: () => (now += 1000), reply: (key, msg) => { if (msg.startsWith('[thinker] You are deployed')) briefs.push(msg); return `Planned.${block({ status: 'done', summary: 'launch kit ready', nextStep: 'Publish the Day 1 X post and the Instagram carousel', resumeAt: '2026-10-01T13:00:00Z' })}`; } });
  const agents = createAgents({ pool, gateway: gw, queue, risk, controls: { get: async () => controlsState }, clock: () => now, log: { log() {}, warn() {} }, continuityIntervalMs: 1000 });
  await agents.init();
  const inbox = createInbox({ pool, queue, worth, workRoot: tmpdir(), clock: () => now, agents });
  const chain = await inbox.want({ description: 'Launch InnerEcho on October 1', doneWhen: 'Day 1 posts are live.', continuous: true });
  await pool.query(`UPDATE thought_chains SET status = 'awaiting_evidence' WHERE id = $1`, [chain.chain_id]);
  assert.equal((await agents.plan()).started.length, 1);
  await agents.poll();
  const want = await queue.get(chain.chain_id);
  assert.equal(want.continuity.resumeAt, '2026-10-01T13:00:00.000Z'); assert.match(want.continuity.resumeTask, /Publish the Day 1/);
  now += 3 * 86400000;
  assert.equal((await agents.plan()).started.length, 1, 'not parked: the pursuit keeps being worked before October 1');
  await agents.poll();
  now = Date.parse('2026-10-01T13:00:30Z');
  const p = await agents.plan(); assert.equal(p.started.length, 1, 'the moment came');
  assert.match(briefs.at(-1), /the time the pursuit was parked for\. Do the planned step: Publish the Day 1 X post and the Instagram carousel/);
}));

test('dated steps form a schedule: a later report adds its step and never swallows an earlier one', async () => database(async pool => {
  let now = Date.parse('2026-09-23T17:00:00Z');
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const controlsState = { autonomousActions: false, askOwner: true, agentSlots: 4 };
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => controlsState });
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
  const plans = [{ nextStep: 'Review October results', resumeAt: '2026-11-01T14:00:00Z' }, { nextStep: 'Publish Day 1', resumeAt: '2026-10-01T13:00:00Z' }];
  let k = 0;
  const gw = fakeGateway({ clock: () => (now += 1000), reply: () => `ok${block({ status: 'done', summary: 's', ...plans[k++ % 2] })}` });
  const agents = createAgents({ pool, gateway: gw, queue, risk, controls: { get: async () => controlsState }, clock: () => now, log: { log() {}, warn() {} }, continuityIntervalMs: 1000 });
  await agents.init();
  const inbox = createInbox({ pool, queue, worth, workRoot: tmpdir(), clock: () => now, agents });
  const chain = await inbox.want({ description: 'Launch InnerEcho in October', doneWhen: 'A month nets positive.', continuous: true });
  await pool.query(`UPDATE thought_chains SET status = 'awaiting_evidence' WHERE id = $1`, [chain.chain_id]);
  await agents.deploy(chain.chain_id, { kind: 'research', task: 'a', firedBy: 'engine' }); await agents.poll();
  await agents.deploy(chain.chain_id, { kind: 'research', task: 'b', firedBy: 'engine' }); await agents.poll();
  let c = (await queue.get(chain.chain_id)).continuity;
  assert.deepEqual(c.schedule.map(x => x.task), ['Publish Day 1', 'Review October results']); assert.equal(c.resumeTask, 'Publish Day 1');
  now = Date.parse('2026-10-01T13:01:00Z');
  assert.equal((await agents.plan()).started.length, 1);
  c = (await queue.get(chain.chain_id)).continuity;
  assert.equal(c.resumeTask, 'Review October results', 'the next dated step is now the park point'); assert.equal(c.firedStep.task, 'Publish Day 1');
}));

test('the only time the engine sits is when it thinks over itself: idle capacity goes to the standing self pursuit, which sees the engine\'s own failures', async () => database(async pool => {
  let now = Date.parse('2026-09-23T18:00:00Z');
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const controlsState = { autonomousActions: false, askOwner: true, agentSlots: 4 };
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => controlsState });
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
  await pool.query(`CREATE TABLE IF NOT EXISTS self_build_events (id SERIAL PRIMARY KEY, kind TEXT, chain_id INT, payload JSONB, created_at TIMESTAMPTZ DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, message TEXT, category TEXT, priority TEXT, read BOOLEAN DEFAULT false, reply TEXT, replied_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), metadata JSONB DEFAULT '{}'::jsonb)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS agent_actions (id UUID PRIMARY KEY, chain_id INT, class TEXT, host TEXT, url TEXT, control TEXT, description TEXT, cost NUMERIC, decision TEXT, why TEXT, ask_id INT, approved_by_ask INT, outcome TEXT, observation TEXT, created_at TIMESTAMPTZ DEFAULT now(), observed_at TIMESTAMPTZ)`);
  let prompt = '';
  const llm = { messages: { create: async ({ messages }) => { prompt = messages[0].content; return { content: [{ type: 'text', text: '{"thought":"Three agents failed the same way yesterday; that is mine to fix.","moves":[{"task":"Review yesterday\'s failed runs and file one self-want per defect","why":"repeated failure"}]}' }] }; } } };
  const gw = fakeGateway({ clock: () => (now += 1000), reply: () => `ok${block({ status: 'working', summary: 'reviewing' })}` });
  const agents = createAgents({ pool, gateway: gw, queue, risk, llm, controls: { get: async () => controlsState }, clock: () => now, log: { log() {}, warn() {} }, ensureSelf: true, selfGapMs: 60_000 });
  await agents.init();
  const self = (await pool.query(`SELECT id FROM thought_chains WHERE ponder_state ->> 'standing' = 'self'`)).rows[0].id;
  await agents.init(); assert.equal((await pool.query(`SELECT count(*)::int AS n FROM thought_chains WHERE ponder_state ->> 'standing' = 'self'`)).rows[0].n, 1, 'one standing self pursuit');
  // a failure for it to notice
  await pool.query(`INSERT INTO agent_deployments (id, chain_id, kind, task, brief, session_key, agent_id, status, error, created_at) VALUES (gen_random_uuid(), 27, 'research', 't', 'b', 'k1', 'main', 'failed', 'turn budget of 12 spent without a result', now())`);
  const storedFailure = JSON.parse(await readFile(new URL('./fixtures/instagram-retry-actions.json', import.meta.url), 'utf8'))[1];
  await pool.query(`INSERT INTO agent_actions (id, chain_id, class, host, url, description, decision, why, outcome, observation)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [storedFailure.id, self, storedFailure.class, storedFailure.host, storedFailure.url,
    storedFailure.description, storedFailure.decision, storedFailure.why, storedFailure.outcome, storedFailure.observation]);
  // nothing else is due: the idle slot goes to the self pursuit, and the strategist sees the engine's own record
  const p = await agents.plan();
  assert.equal(p.started.length, 1); assert.equal((await agents.get(p.started[0])).chainId, self);
  assert.match(prompt, /turn budget of 12 spent/); assert.match(prompt, /self-build\/want/);
  assert.ok(prompt.split(storedFailure.id).length >= 3, 'both strategist actions and self-signals carry the source failure ID');
  assert.ok(prompt.includes(storedFailure.url)); assert.match(prompt, /mobile app/);
  assert.match((await queue.get(self)).continuity.lastThought, /mine to fix/);
  assert.deepEqual((await agents.plan()).started, [], 'one at a time, and not again inside the gap');
}));


const continuationFixture = JSON.parse(await readFile(new URL('./fixtures/active-run-6-queued-7.json', import.meta.url), 'utf8'));
const capturedDeployment = 'eeb08eb9-b610-496d-86e8-438ad7e678e5';

// Exercise both real modules and real persistence. Only RPC, time and external delivery are scripted.
async function continuationHarness(pool, { status = 'running', waitStatus = 'timeout', maxTurns = 6 } = {}) {
  await pool.query('DELETE FROM agent_deployments');
  let raw = structuredClone(continuationFixture);
  const since = raw.inFlightRun.startedAt - 1;
  let now = raw.messages.at(-1).timestamp + 120_000;
  const calls = [], notices = [], outcomes = [], warnings = [];
  const gateway = createGateway({ runner: async args => {
    const method = args[2], params = JSON.parse(args.at(-1));
    if (method === 'chat.history') return JSON.stringify(raw);
    if (method === 'agent.wait') return JSON.stringify({ status: waitStatus });
    if (method === 'agent') { calls.push(params); return JSON.stringify({ status: 'accepted', runId: params.idempotencyKey }); }
    throw new Error(`Unexpected RPC: ${method}`);
  } });
  gateway.available = async () => true;
  // Let parked deployments read every poll, independent of sessions.list change detection.
  gateway.sessions = undefined;
  await pool.query(`INSERT INTO agent_deployments (id, chain_id, kind, task, brief, session_key, agent_id, status, run_id, turns, seen_at_ms)
    VALUES ($1,31,'research','regression','brief',$2,'main',$3,$4,6,$5)`,
  [capturedDeployment, raw.sessionKey, status, raw.inFlightRun.runId, since]);
  const options = { pool, gateway, clock: () => now, maxTurns,
    asks: { open: async () => [], ask: async args => { notices.push(args); return { id: 1 }; }, answer: async () => {} },
    risk: { observe: async (...args) => outcomes.push(args) },
    log: { log() {}, warn: (...args) => { if (!String(args[0]).includes('failed: settled reply')) warnings.push(args); } } };
  let agents = createAgents(options);
  return {
    gateway, calls, notices, outcomes, warnings, since,
    get raw() { return raw; }, set raw(value) { raw = value; },
    row: async () => (await pool.query('SELECT * FROM agent_deployments WHERE id = $1', [capturedDeployment])).rows[0],
    async poll() { await agents.poll(); now += 120_000; assert.deepEqual(warnings, []); },
    restart() { agents = createAgents(options); },
    settle(report = 'done', extra = {}) {
      raw = { ...raw, pendingInputs: { items: [], total: 0 }, inFlightRun: null, sessionInfo: { hasActiveRun: false, status: 'idle' },
        messages: [{ role: 'assistant', timestamp: now - 1, content: block({ status: report, summary: 'settled reply', question: 'Which region?' }), ...extra }] };
    },
  };
}

test('live :6/:7 fixture and all independent busy signals cannot consume progress after repeated grace periods', async t => database(async pool => {
  const busyCases = {
    captured: () => {},
    'in-flight only': r => { r.pendingInputs = []; r.sessionInfo = { hasActiveRun: false, status: 'idle' }; },
    'active flag only': r => { r.pendingInputs = []; r.inFlightRun = null; r.sessionInfo.status = 'idle'; },
    'running status only': r => { r.pendingInputs = []; r.inFlightRun = null; r.sessionInfo.hasActiveRun = false; },
    'queued status only': r => { r.pendingInputs = []; r.inFlightRun = null; r.sessionInfo = { hasActiveRun: false, status: 'queued' }; },
    'object queue only': r => { r.inFlightRun = null; r.sessionInfo = { hasActiveRun: false, status: 'idle' }; },
    'total-only queue': r => { r.inFlightRun = null; r.sessionInfo = {}; r.pendingInputs.items = []; },
    'items despite zero total': r => { r.inFlightRun = null; r.sessionInfo = {}; r.pendingInputs.total = 0; },
    'legacy queue': r => { r.inFlightRun = null; r.sessionInfo = {}; r.pendingInputs = r.pendingInputs.items; },
  };
  for (const [name, change] of Object.entries(busyCases)) await t.test(name, async () => {
    const h = await continuationHarness(pool); change(h.raw);
    await h.poll();   // first replay the unmodified captured progress entry
    // Do not let the progress marker mask a broken liveness guard. Each report would otherwise
    // continue, exhaust the budget, notify the person, or finish the deployment.
    for (const status of ['working', 'needs_person', 'done', 'failed']) {
      h.raw.messages.at(-1).openclawStreamFallback = false;
      h.raw.messages.at(-1).content = block({ status, summary: 'not settled', question: 'Do you know?' });
      for (let i = 0; i < 3; i++) await h.poll();
      const row = await h.row();
      assert.equal(row.status, 'running'); assert.equal(row.turns, 6); assert.equal(row.run_id, `${capturedDeployment}:6`);
      assert.equal(Number(row.seen_at_ms), h.since);
      assert.deepEqual([h.calls, h.notices, h.outcomes], [[], [], []]);
    }
    h.settle(); await h.poll(); h.restart(); await h.poll();
    assert.equal((await h.row()).status, 'done'); assert.equal((await h.row()).turns, 6);
    assert.equal(h.calls.length, 0); assert.equal(h.notices.length, 0); assert.equal(h.outcomes.length, 1);
  });
}));

test('restart recovery accepts settled reports once and rejects stale, mismatched and stream-progress replies', async t => database(async pool => {
  for (const waitStatus of ['pending', 'timeout']) {
    for (const status of ['done', 'needs_person', 'failed', 'working']) await t.test(`${waitStatus}: settled ${status}`, async () => {
      const h = await continuationHarness(pool, { waitStatus, maxTurns: 12 });
      h.settle(status, { ...continuationFixture.terminal, timestamp: h.since + 1000, content: block({ status, summary: 'settled reply', question: 'Which region?' }) });
      h.restart(); await h.poll();
      // A late transcript write must not make the old run look like the continuation's reply.
      if (status === 'working') h.raw.messages[0].timestamp = Number((await h.row()).seen_at_ms) + 1;
      h.restart(); await h.poll(); await h.poll();
      assert.equal(h.calls.length, status === 'working' ? 1 : 0);
      assert.equal(h.notices.length, status === 'needs_person' ? 1 : 0);
      assert.equal(h.outcomes.length, ['done', 'failed'].includes(status) ? 1 : 0);
      assert.equal((await h.row()).status, { done: 'done', failed: 'failed', needs_person: 'waiting_person', working: 'running' }[status]);
      assert.equal((await h.row()).turns, status === 'working' ? 7 : 6);
    });
  }
  for (const mode of ['legacy', 'restarted run']) await t.test(`recover ${mode}`, async () => {
    const h = await continuationHarness(pool); h.settle();
    if (mode === 'restarted run') {
      h.raw.messages[0].__openclaw = { runId: 'new-run-after-restart', runTerminal: true };
      h.raw.messages.unshift({ role: 'user', content: '[thinker] Continue.', timestamp: h.since + 1,
        idempotencyKey: `${capturedDeployment}:6:user`, __openclaw: { runId: 'new-run-after-restart' } });
    }
    h.restart(); await h.poll(); h.restart(); await h.poll();
    assert.equal((await h.row()).status, 'done'); assert.equal(h.outcomes.length, 1);
    assert.equal(h.calls.length, 0); assert.equal(h.notices.length, 0);
  });
  const rejected = {
    'pre-start reply': h => { h.raw.messages[0].timestamp = h.since - 1; },
    'at-start reply': h => { h.raw.messages[0].timestamp = h.since; },
    'invalid timestamp': h => { h.raw.messages[0].timestamp = 'invalid'; },
    'previous run': h => { h.raw.messages[0].__openclaw = { runId: `${capturedDeployment}:5`, runTerminal: true }; },
    'explicit nonterminal': h => { h.raw.messages[0].__openclaw = { runId: `${capturedDeployment}:6`, runTerminal: false }; },
    'unrelated run': h => { h.raw.messages[0].runId = 'unrelated'; },
    'stream fallback with stopReason stop': h => { Object.assign(h.raw.messages[0], { openclawStreamFallback: true, stopReason: 'stop' }); },
    commentary: h => { h.raw.messages[0].channel = 'commentary'; },
    'previous user turn': h => { h.raw.messages.unshift({ role: 'user', timestamp: h.since - 1, content: '[thinker] Continue.' }); },
    'different user turn key': h => { h.raw.messages.unshift({ role: 'user', timestamp: h.since + 1, content: '[thinker] Continue.', idempotencyKey: `${capturedDeployment}:5:user` }); },
  };
  for (const [name, change] of Object.entries(rejected)) await t.test(name, async () => {
    const h = await continuationHarness(pool); h.settle('working'); change(h);
    for (let i = 0; i < 3; i++) await h.poll();
    assert.equal((await h.row()).status, 'running'); assert.equal((await h.row()).turns, 6);
    assert.deepEqual([h.calls, h.notices, h.outcomes], [[], [], []]);
  });
}));

test('person-answer and standing-session polling also waits for a settled reply', async t => database(async pool => {
  for (const status of ['waiting_person', 'standing']) await t.test(status, async () => {
    const h = await continuationHarness(pool, { status });
    h.raw.messages.unshift({ role: 'user', timestamp: h.since + 1, content: 'Use the US store.' });
    h.raw.messages.at(-1).content = block({ status: 'needs_person', question: 'Another question?' });
    h.raw.messages.at(-1).openclawStreamFallback = false;
    h.raw.pendingInputs = [];
    for (let i = 0; i < 3; i++) await h.poll();
    assert.equal((await h.row()).status, status); assert.equal(Number((await h.row()).seen_at_ms), h.since);
    assert.deepEqual([h.calls, h.notices, h.outcomes], [[], [], []]);
  });
}));

// Real PostgreSQL persistence and the controller's public plan/deploy/poll paths. The only
// scripted judgment is semantic interpretation; quotations and revision checks remain real.
async function retirementHarness(pool, { maxTurns = 12 } = {}) {
  let now = 30 * 86400000, task = 'Reconcile historical AI costs for August 2026 paid subscribers';
  let report = { status: 'done', summary: 'Historical AI cost reconciliation exhausted; production usage records remain missing.' };
  let unavailable = false, malformed = false, forge = false, comparisonCalls = 0, decisions = 0;
  const { rows: [row] } = await pool.query(`INSERT INTO thought_chains (seed,status,ponder_state) VALUES ('Improve InnerEcho','awaiting_evidence',$1::jsonb) RETURNING id`,
    [JSON.stringify({ continuous: true, want: { status: 'active', description: 'Improve InnerEcho' }, evidence: [], continuity: {} })]);
  const gw = fakeGateway({ clock: () => ++now, reply: () => block(report) });
  const llm = { messages: { create: async ({ system, messages }) => {
    if (!system.startsWith('You check task retirement')) return JSON.stringify({ thought: 'Do this concrete task.', moves: [{ task, stream: 'Measurement' }] });
    comparisonCalls++;
    if (unavailable) throw new Error('semantic comparison unavailable');
    if (malformed) return '{}';
    const input = JSON.parse(messages[0].content);
    const candidate = input.candidate.description;
    const cite = e => ({ fingerprint: e.fingerprint, quote: forge ? 'Invented quote that is not in any actual supplied observation.' : e.observation });
    return JSON.stringify({
      relation: /Publish a launch|office equipment|prospective|September 2026/.test(candidate) ? 'distinct' : 'equivalent',
      reason: /Publish a launch|office equipment|prospective|September 2026/.test(candidate) ? 'Different objective or measurement period.' : 'Same historical AI cost calculation and paid cohort.',
      ownerSupersedes: input.currentOwner.some(e => /fresh.start|retire|do not audit/.test(e.observation)),
      ownerSupersession: input.currentOwner.filter(e => /fresh.start|retire|do not audit/.test(e.observation)).slice(-1).map(cite),
      materialEvidence: input.newEvidence.filter(e => /August 2026 production usage:|September 2026 production usage:/.test(e.observation)).map(cite),
      ownerPermission: input.newOwner.filter(e => /Reopen the historical August 2026 AI cost reconciliation/.test(e.observation)).slice(-1).map(cite),
    });
  } } };
  const options = { pool, gateway: gw, llm, clock: () => now, maxTurns, continuityIntervalMs: 1,
    risk: { decide: async () => { decisions++; return { decision: 'proceed' }; }, observe: async () => {} },
    log: { log() {}, warn() {} }, slotsDefault: 4 };
  let agents = createAgents(options);
  return {
    id: row.id, gw, get agents() { return agents; }, get comparisonCalls() { return comparisonCalls; }, get decisions() { return decisions; },
    set task(v) { task = v; }, set report(v) { report = v; }, set unavailable(v) { unavailable = v; }, set malformed(v) { malformed = v; }, set forge(v) { forge = v; },
    async deploy(candidate = task, extra = {}) { return agents.deploy(row.id, { kind: 'research', task: candidate, ...extra }); },
    async cycle() { now += 86400000; return agents.plan(); },
    restart() { agents = createAgents(options); },
    async evidence(observation, { owner = false, id = randomBytes(8).toString('hex'), supersedes = [] } = {}) {
      const item = { id: `${owner ? 'person-' : 'record-'}${id}`, source: owner ? 'stated by Quinn' : 'file: /verified/cost-ledger', observation, supersedes };
      await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{evidence}', (ponder_state->'evidence') || $2::jsonb) WHERE id = $1`, [row.id, JSON.stringify([item])]);
      return item;
    },
    async raw(id) { return (await pool.query('SELECT * FROM agent_deployments WHERE id = $1', [id])).rows[0]; },
  };
}

test('task retirement survives cadence expiry, paraphrases, long sibling history and controller recreation', async () => database(async pool => {
  const h = await retirementHarness(pool);
  const first = await h.cycle(); assert.equal(first.started.length, 1);
  await h.agents.poll();
  const d = await h.raw(first.started[0]);
  const retired = d.report.taskDisposition;
  assert.equal(retired.status, 'exhausted'); assert.equal(retired.period, 'historical');
  assert.equal(retired.sourceRun, `${d.id}:1`); assert.equal(retired.sourceDeployment, d.id);
  assert.equal(retired.evidenceRevision.length, 64); assert.equal(retired.ownerScopeRevision.length, 64);
  assert.match(retired.scope.description, /August 2026/);
  // More than the strategist's 14-row window, with success resetting pursuit-wide dry.
  h.report = { status: 'done', summary: 'Published a useful launch update.' };
  for (let i = 0; i < 17; i++) {
    const sibling = await h.deploy(`Publish a launch update number ${i}`);
    assert.ok(sibling.id); await h.agents.poll();
  }
  const state = (await pool.query('SELECT ponder_state FROM thought_chains WHERE id = $1', [h.id])).rows[0].ponder_state;
  assert.equal(state.continuity.dry, 0);
  const before = h.gw.calls.length, decisions = h.decisions;
  for (const task of [
    'Reconstruct historical API spend for August 2026 paying users',
    'Determine past inference expenses attributable to the August 2026 paid cohort',
    'Establish what serving last summer\'s premium members actually consumed in dollars',
    'Keep this pursuit moving; do the most useful concrete thing now',
  ]) {
    h.task = task;
    for (let i = 0; i < 3; i++) { h.restart(); assert.deepEqual((await h.cycle()).started, []); }
  }
  assert.equal(h.gw.calls.length, before, 'suppression happens before sessions or turns');
  assert.equal(h.decisions, decisions, 'retired attempts do not create fresh risk decisions');
  assert.deepEqual((await h.raw(d.id)).report.taskDisposition, retired, 'sibling completion never clears or rewrites retirement');
}));

test('turn-budget exhaustion cannot mint equivalent deployments; material evidence reopens once per revision', async () => database(async pool => {
  const h = await retirementHarness(pool, { maxTurns: 1 });
  h.report = { status: 'working', summary: 'Still checking the available records.' };
  const first = await h.deploy(); await h.agents.poll();
  assert.equal((await h.raw(first.id)).report.taskDisposition.status, 'exhausted');
  for (let i = 0; i < 3; i++) { h.restart(); assert.deepEqual((await h.cycle()).started, []); }
  await h.evidence('The launch directory listing is now public and visible.');
  assert.equal((await h.deploy()).decision, 'retired', 'unrelated evidence cannot reopen');
  await h.evidence('August 2026 production usage: verified paid-cohort token counts and invoice totals are now available.');
  const reopened = await h.deploy(); assert.ok(reopened.id, 'materially relevant facts can reopen ordinary exhaustion');
  await h.agents.poll();
  const second = (await h.raw(reopened.id)).report.taskDisposition;
  assert.notEqual(second.evidenceRevision, (await h.raw(first.id)).report.taskDisposition.evidenceRevision);
  assert.equal((await h.deploy()).decision, 'retired', 'the same new records cannot buy unlimited budgets');
  await h.evidence('August 2026 production usage: verified paid-cohort token counts and invoice totals are now available.', { id: 'different-id' });
  h.restart(); assert.equal((await h.deploy()).decision, 'retired', 'duplicate facts with new ids do not change evidence revision');
}));

test('fresh-start supersession requires both relevant evidence and new applicable owner authorization', async () => database(async pool => {
  const h = await retirementHarness(pool);
  await h.evidence('Use the fresh-start launch plan; do not audit historical August costs.', { owner: true });
  h.report = { status: 'failed', summary: 'Historical API-cost reconciliation cannot proceed under Quinn’s recorded fresh-start instruction. Retire this deployment.' };
  const first = await h.deploy(); await h.agents.poll();
  assert.equal((await h.raw(first.id)).report.taskDisposition.status, 'superseded');
  await h.evidence('The launch listing is now live with the new product screenshots.');
  h.report = { status: 'done', summary: 'The launch update is complete.' };
  const sibling = await h.deploy('Publish a launch update for InnerEcho'); assert.ok(sibling.id); await h.agents.poll();
  h.restart(); assert.deepEqual((await h.cycle()).started, []);
  await h.evidence('August 2026 production usage: verified paid-cohort token counts and invoice totals are now available.');
  assert.equal((await h.deploy()).decision, 'retired', 'new relevant records alone cannot override the owner');
  await h.evidence('Keep improving the product and measure prospective costs going forward.', { owner: true });
  assert.equal((await h.deploy(undefined, { firedBy: 'person' })).decision, 'retired', 'firedBy and general encouragement are not scope-specific authorization');
  // A separate prospective task remains available while the historical scope is retired.
  assert.ok((await h.deploy('Set up prospective AI cost measurement for new users')).id);
  await h.agents.poll();
  await h.evidence('Reopen the historical August 2026 AI cost reconciliation using the newly supplied paid-cohort records.', { owner: true });
  h.restart(); assert.ok((await h.deploy()).id, 'both new facts and applicable owner permission permit reopening');
}));

test('owner permission alone cannot reopen superseded work; later owner supersession tightens ordinary exhaustion', async () => database(async pool => {
  const h = await retirementHarness(pool);
  const first = await h.deploy(); await h.agents.poll();
  await h.evidence('Use the fresh-start launch plan; do not audit historical August costs.', { owner: true });
  assert.equal((await h.deploy()).decision, 'retired');
  assert.equal((await h.raw(first.id)).report.taskDisposition.status, 'superseded', 'owner change after retirement persists');
  await h.evidence('Reopen the historical August 2026 AI cost reconciliation if relevant records become available.', { owner: true });
  assert.equal((await h.deploy()).decision, 'retired', 'permission without new evidence is insufficient');
  h.restart(); assert.deepEqual((await h.cycle()).started, []);
}));

test('legacy terminal outcomes are backfilled without a recent window and failed semantic checks fail closed', async () => database(async pool => {
  const h = await retirementHarness(pool);
  const id = 'ee000000-0000-4000-8000-000000000032';
  await pool.query(`INSERT INTO agent_deployments (id,chain_id,kind,task,brief,session_key,agent_id,status,run_id,error,created_at)
    VALUES ($1,$2,'research','Historical AI-cost reconciliation for August 2026','brief','legacy-retired','main','failed',$3,$4,now()-interval '3 years')`,
    [id, h.id, `${id}:7`, 'Historical audit exhausted; no further action taken. Do not retry without new evidence and authorization to reopen the historical audit.']);
  h.restart(); assert.equal((await h.deploy()).decision, 'retired');
  const retired = (await h.raw(id)).report.taskDisposition;
  assert.equal(retired.sourceRun, `${id}:7`);
  h.task = 'Establish dollars consumed serving the premium members last summer';
  h.unavailable = true; assert.deepEqual((await h.cycle()).started, []);
  h.unavailable = false; h.malformed = true; assert.deepEqual((await h.cycle()).started, []);
  assert.equal(h.gw.calls.length, 0);
  h.restart(); assert.deepEqual((await h.raw(id)).report.taskDisposition, retired);
}));

test('structured evidence-blocked reports persist; a genuinely different period is not the retired scope', async () => database(async pool => {
  const h = await retirementHarness(pool);
  h.report = { status: 'done', summary: 'No applicable records exist for the requested calculation.', disposition: { status: 'evidence-blocked' } };
  const d = await h.deploy(); await h.agents.poll();
  assert.equal((await h.raw(d.id)).report.taskDisposition.status, 'evidence-blocked');
  assert.equal((await h.deploy()).decision, 'retired');
  assert.ok((await h.deploy('Reconcile historical AI costs for September 2026 paid subscribers')).id, 'non-overlapping period remains eligible');
}));

test('earlier permission cannot beat later owner withdrawal, and invented citations cannot reopen a scope', async () => database(async pool => {
  const h = await retirementHarness(pool);
  h.report = { status: 'failed', summary: 'Historical API-cost reconciliation cannot proceed under the fresh-start instruction. Retire this deployment.' };
  const first = await h.deploy(); await h.agents.poll();
  await h.evidence('Reopen the historical August 2026 AI cost reconciliation with the newly available records.', { owner: true });
  await h.evidence('New direction: use the fresh-start launch plan and do not audit historical August costs.', { owner: true });
  await h.evidence('August 2026 production usage: the complete token ledger and paid subscriber cohort are now available.');
  assert.equal((await h.deploy()).decision, 'retired', 'a later withdrawal beats earlier permission');
  await h.evidence('Reopen the historical August 2026 AI cost reconciliation; this explicitly replaces my fresh-start restriction.', { owner: true });
  h.forge = true;
  assert.equal((await h.deploy()).decision, 'retired', 'model claims require matching source quotations');
  h.forge = false;
  // Use a new unambiguous authorization after the withdrawn instruction.
  await h.evidence('Reopen the historical August 2026 AI cost reconciliation now, using the supplied verified production records.', { owner: true });
  assert.ok((await h.deploy()).id);
  assert.equal((await h.raw(first.id)).report.taskDisposition.status, 'superseded', 'reopening does not erase the durable retirement');
}));

test('superseded evidence and old authorizations cannot be used as new reopening facts', async () => database(async pool => {
  const h = await retirementHarness(pool);
  const first = await h.deploy(); await h.agents.poll();
  const fact = await h.evidence('August 2026 production usage: verified paid-cohort totals from the invoice ledger.');
  await h.evidence('That uploaded ledger was a sample, not the historical production invoice. No replacement records exist.', { supersedes: [fact.id] });
  assert.equal((await h.deploy()).decision, 'retired', 'retracted facts cannot reopen the task');
  assert.ok((await h.raw(first.id)).report.taskDisposition);
}));

test('provider-credit exhaustion and successful fresh-start work are not task retirements', async () => database(async pool => {
  const h = await retirementHarness(pool);
  h.report = { status: 'failed', summary: 'Out of usage credits: provider quota exhausted.' };
  const first = await h.deploy(); await h.agents.poll();
  assert.equal((await h.raw(first.id)).report.taskDisposition, undefined);
  h.restart(); h.report = { status: 'done', summary: 'Created the fresh-start launch plan.', remaining: ['Historical records missing'] };
  const second = await h.deploy(); assert.ok(second.id); await h.agents.poll();
  assert.equal((await h.raw(second.id)).report.taskDisposition, undefined);
  assert.ok((await h.deploy()).id, 'neither provider failure nor a successful fresh-start artifact retires the scope');
}));


test('retirement is task-scoped, not a ban on unrelated calculations in the same period', async () => database(async pool => {
  const h = await retirementHarness(pool);
  await h.deploy(); await h.agents.poll();
  assert.ok((await h.deploy('Reconcile historical office equipment costs for August 2026')).id);
}));
