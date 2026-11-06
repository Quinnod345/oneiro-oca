// What a pursuit does after it delivers. Its cards can be acted on, a verdict can be changed or taken back from anywhere,
// another agent waits while something waits on the person, a finish line is proposed but only the person calls it done,
// a payment's code tells the truth about reaching his phone and asks once more when its window closes, and a pursuit can
// be deleted softly and brought back.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile, mkdtemp, rm, writeFile, mkdir, utimes, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordOutcome, createWant } from '../motivation/hunger.js';
import { saveDeliverable, normalizeCard, deliveryHold, finishCandidate, liveVerdict, composeDeliverable, previewOf, splitFooter } from '../reasoning/deliverables.js';
import { createDeliverableCards, cardProblem } from '../reasoning/deliverable-cards.js';
import { createFinishWatch, finishedMemory, observeWitness, pathIn, testCommand } from '../reasoning/finish-watch.js';
import { createPursuitLife, DELETE_KEEP_MS } from '../reasoning/pursuit-life.js';
import { createAgents, parseReport, withoutReport } from '../reasoning/agents.js';
import { createAsks, composeAsk } from '../reasoning/asks.js';
import { createInbox } from '../reasoning/inbox.js';
import { createBoard } from '../reasoning/board.js';
import { createPonderQueue } from '../reasoning/ponder-queue.js';
import { createWorthLedger } from '../motivation/worth-ledger.js';
import { createRiskJournal } from '../motivation/risk-journal.js';
import { createPaymentApprovals, reissueAt, hashCode, APPROVAL_WINDOW_MS } from '../reasoning/payment-approvals.js';

const silent = { log() {}, warn() {} };
const blocked = async () => ({ status: 'needs_evidence', checkpoint: { version: 1, passes: [] }, missingEvidence: ['x'] });
const block = o => `\n\`\`\`oca\n${JSON.stringify(o)}\n\`\`\``;

async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'finish_test_' + randomBytes(6).toString('hex');
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

function fakeHost(reply) {
  const sessions = new Map(), runs = new Map();
  return { sessions, aborted: [],
    async available() { return true; },
    async createSession({ key }) { sessions.set(key, { messages: [] }); return { ok: true, key }; },
    async turn({ sessionKey, message, idempotencyKey }) { const s = sessions.get(sessionKey); s.messages.push({ role: 'user', text: message, at: Date.now() }); const r = reply(message); runs.set(idempotencyKey, { status: 'ok', terminalReply: { text: r } }); s.messages.push({ role: 'assistant', text: r, at: Date.now() }); return { runId: idempotencyKey }; },
    async wait(runId) { return runs.get(runId) || { status: 'pending' }; },
    async history(k) { return [...(sessions.get(k)?.messages || [])]; },
    async transcript(k) { return { messages: [...(sessions.get(k)?.messages || [])], pending: 0 }; },
    async abort(k) { this.aborted.push(k); return { ok: true }; },
  };
}

async function world(pool, { reply = () => `Working.${block({ status: 'working', summary: 'reading' })}`, channels = null, now = 30 * 86400000 } = {}) {
  const w = { now, texts: [] };
  const clock = () => w.now;
  w.workRoot = await mkdtemp(join(tmpdir(), 'oca-finish-'));
  const worth = createWorthLedger({ pool, clock }); await worth.seed();
  const controlsState = { autonomousActions: false, askOwner: true, agentSlots: 4 };
  const risk = createRiskJournal({ pool, worth, clock, controls: () => controlsState });
  w.queue = createPonderQueue({ pool, reason: blocked, clock, worth, risk });
  w.host = fakeHost(reply);
  w.agents = createAgents({ pool, host: w.host, queue: w.queue, risk, conversations: false, controls: { get: async () => controlsState }, clock, log: silent, continuityIntervalMs: 1000, staleTurnMs: 1e12,
    deliver: x => saveDeliverable({ pool, workRoot: w.workRoot, clock, ...x }) });
  await w.agents.init();
  w.asks = createAsks({ pool, clock, log: silent, deliverers: channels || { imessage: async m => { w.texts.push(m); }, notification: null } });
  await w.asks.init();
  w.inbox = createInbox({ pool, queue: w.queue, worth, workRoot: w.workRoot, clock, agents: w.agents, asks: w.asks, log: silent });
  w.finish = createFinishWatch({ pool, queue: w.queue, inbox: w.inbox, asks: w.asks, agents: w.agents, clock, log: silent });
  w.inbox.useFinish(w.finish);
  w.life = createPursuitLife({ pool, inbox: w.inbox, agents: w.agents, asks: w.asks, clock, log: silent });
  w.board = createBoard({ pool, agents: w.agents, asks: w.asks, clock, log: silent });
  w.pursuit = async (extra = {}, description = 'Find three piano books under $30') => {
    const c = await w.inbox.want({ description, doneWhen: 'A message compares three books.', continuous: true });
    await pool.query(`UPDATE thought_chains SET status = 'awaiting_evidence', ponder_state = ponder_state || $2::jsonb WHERE id = $1`, [c.chain_id, JSON.stringify({ finishLine: { witness: { kind: 'message', detail: 'the comparison Oneiro hands me' }, at: 0 }, ...extra })]);
    return c.chain_id;
  };
  w.state = async id => (await pool.query(`SELECT ponder_state AS s FROM thought_chains WHERE id = $1`, [id])).rows[0].s;
  w.done = async () => rm(w.workRoot, { recursive: true, force: true });
  return w;
}
const doneReport = o => block({ status: 'done', title: 'Three piano books', summary: 'Compared.', brief: 'Faber wins.', remaining: [], ...o });

// ── verdicts: changed and taken back ─────────────────────────────────────────────────────────────────────────────────

test('hunger: taking a verdict back returns the want to where it stood; on a finished want it leaves it finished', () => {
  const ev = [{ id: 'e', source: 's', observation: 'o' }];
  let w = createWant({ description: 'x', doneWhen: 'y' });
  w = recordOutcome(w, { receiptId: 'rated-artifact-a.md', progress: 0.25, evidence: ev, usefulness: 0.67 });
  const back = recordOutcome(w, { receiptId: 'rated-artifact-a.md~2', progress: 0, evidence: ev, supersedes: 'rated-artifact-a.md', reopened: true });
  assert.equal(back.progress, 0); assert.equal(back.status, 'active');
  assert.equal(liveVerdict(back, 'a.md'), null, 'no verdict stands');
  assert.equal(back.receipts[0].supersededBy, 'rated-artifact-a.md~2', 'the old one stays on record');
  const sated = recordOutcome(w, { receiptId: 'done', progress: 1, evidence: ev, criterionMet: true });
  const still = recordOutcome(sated, { receiptId: 'rated-artifact-a.md~2', progress: 0, evidence: ev, supersedes: 'rated-artifact-a.md', reopened: true });
  assert.equal(still.status, 'sated'); assert.equal(still.progress, 1);
});

test('Judge lists what was judged; a deliverable\'s verdict can be taken back to Judge, and a note\'s verdict changed or taken back, superseding and never deleting', async () => database(async pool => {
  const w = await world(pool);
  try {
    const id = await w.pursuit();
    await saveDeliverable({ pool, workRoot: w.workRoot, chainId: id, agentId: 'aaaabbbb-1', task: 'compare', want: 'x', report: { title: 'Piano books', summary: 'y', remaining: ['more'] }, clock: () => w.now });
    const card = (await w.inbox.list()).toRate.find(i => i.kind === 'artifact');
    w.now += 1000;
    await w.inbox.rate({ kind: 'artifact', id: card.id, usefulness: 'useful' });
    let list = await w.inbox.list();
    assert.equal(list.toRate.length, 0);
    assert.deepEqual(list.judged.map(j => [j.id, j.verdict, j.changed]), [[card.id, 'useful', false]]);
    assert.equal((await w.queue.get(id)).want.progress, 0.25);
    // changed from Judge's list: the same route, a superseding receipt
    w.now += 1000;
    await w.inbox.rate({ kind: 'artifact', id: card.id, usefulness: 'great' });
    assert.deepEqual((await w.inbox.list()).judged.map(j => [j.verdict, j.changed]), [['great', true]]);
    // taken back: it returns to Judge and the want to where it stood
    w.now += 1000;
    const r = await w.inbox.reopen({ kind: 'artifact', id: card.id });
    assert.equal(r.reopened, true); assert.equal(r.want.want.progress, 0);
    list = await w.inbox.list();
    assert.deepEqual(list.toRate.map(i => i.id), [card.id]); assert.equal(list.judged.length, 0);
    assert.ok(r.want.want.receipts.length >= 3, 'every verdict stays on record');
    await assert.rejects(w.inbox.reopen({ kind: 'artifact', id: card.id }), /no verdict/);
    assert.equal((await w.inbox.deliverables(id))[0].verdict, null);

    // a note
    await mkdir(join(w.workRoot, 'thinker'), { recursive: true });
    await writeFile(join(w.workRoot, 'thinker', 'n1.md'), '# A held note\n\n_meta_\n\nThe note itself.');
    assert.ok((await w.inbox.list()).toRate.some(i => i.kind === 'note'));
    await w.inbox.rate({ kind: 'note', id: 'n1.md', usefulness: 'useless' });
    list = await w.inbox.list();
    assert.ok(!list.toRate.some(i => i.kind === 'note')); assert.equal(list.judged.find(j => j.kind === 'note').verdict, 'useless');
    await w.inbox.rate({ kind: 'note', id: 'n1.md', usefulness: 'great' });
    const judged = (await w.inbox.list()).judged.find(j => j.kind === 'note');
    assert.equal(judged.verdict, 'great'); assert.equal(judged.changed, true); assert.equal(judged.title, 'A held note');
    const { rows } = await pool.query(`SELECT id, payload FROM worth_signals WHERE id LIKE 'rate:note:%' ORDER BY id`);
    assert.equal(rows.length, 2, 'superseded, not deleted'); assert.equal(rows[1].payload.supersedes, 'rate:note:n1.md');
    await w.inbox.reopen({ kind: 'note', id: 'n1.md' });
    list = await w.inbox.list();
    assert.ok(list.toRate.some(i => i.kind === 'note'), 'back in Judge'); assert.ok(!list.judged.some(j => j.kind === 'note'));
    await w.inbox.rate({ kind: 'note', id: 'n1.md', usefulness: 'meh' });
    assert.equal((await w.inbox.list()).judged.find(j => j.kind === 'note').verdict, 'meh', 'and can be rated again');
  } finally { await w.done(); }
}));

// ── cards ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function fakeChannel({ events = [], answered = false, addOk = true } = {}) {
  const calls = [];
  return { calls,
    async threadStatus(a) { calls.push(['threadStatus', a]); return { answered }; },
    async readCalendar(a) { calls.push(['readCalendar', a]); return { events: [...events, ...(calls.some(c => c[0] === 'addEvent') && addOk ? [calls.find(c => c[0] === 'addEvent')[1]].map(e => ({ title: e.title, start: e.start, end: e.end, date: null })) : [])], unreadable: [] }; },
    async openReplyDraft(a) { calls.push(['openReplyDraft', a]); return { opened: true }; },
    async openNewDraft(a) { calls.push(['openNewDraft', a]); return { opened: true }; },
    async addEvent(a) { calls.push(['addEvent', a]); return { saved: true }; },
  };
}
const googleAccounts = async () => [{ account: 'me@gmail.com', label: 'personal' }];

test('an agent\'s report carries a card; it reaches Judge and the Work panel as a kind with its card, editable, and the file says what the card says', async () => database(async pool => {
  const w = await world(pool, { reply: () => `Here it is.${block({ status: 'done', title: 'Reply to Sam', summary: 'drafted', deliverable: { kind: 'mail_draft', to: 'sam@example.com', subject: 'Lessons', body: 'Hi Sam,\n\nYes please.' } })}` });
  try {
    const id = await w.pursuit();
    const d = await w.agents.deploy(id, { kind: 'research', task: 'draft a reply', firedBy: 'person' });
    await w.agents.poll();
    assert.equal((await w.agents.get(d.id)).status, 'done');
    const item = (await w.inbox.list()).toRate.find(i => i.kind === 'artifact');
    assert.equal(item.deliverableKind, 'mail_draft'); assert.deepEqual(item.card.to, ['sam@example.com']); assert.equal(item.card.subject, 'Lessons');
    const row = (await w.inbox.deliverables(id))[0];
    assert.equal(row.deliverableKind, 'mail_draft'); assert.equal(row.cardProblem, null);
    const cards = createDeliverableCards({ pool, channel: fakeChannel(), accounts: googleAccounts, clock: () => w.now, log: silent });
    const edited = await cards.edit(id, row.name, { subject: 'Piano lessons', body: 'Hi Sam,\n\nYes, Tuesday works.' });
    assert.equal(edited.card.subject, 'Piano lessons');
    const words = await w.inbox.deliverable(row.id);
    assert.match(words.markdown, /\*\*Subject:\*\* Piano lessons[\s\S]*Yes, Tuesday works/);
    assert.ok(!words.body.includes('Yes, Tuesday works'), 'the words around the card do not repeat it');
    await assert.rejects(cards.edit(id, row.name, { subject: '' }), /needs a subject/);
    // a report with no kind, or one that can't make a card, stays a brief
    assert.equal(parseReport(block({ status: 'done', summary: 's', deliverable: { kind: 'mail_draft', subject: '' } })).deliverable, undefined);
    assert.equal(normalizeCard({ kind: 'nonsense' }), null);
  } finally { await w.done(); }
}));

test('a mail card only ever opens a draft, on the press, through the night\'s code; an automated address is refused; a press twice does it once', async () => database(async pool => {
  const w = await world(pool);
  try {
    const id = await w.pursuit();
    const save = (agentId, deliverable) => saveDeliverable({ pool, workRoot: w.workRoot, chainId: id, agentId, task: 't', want: 'x', report: { title: agentId, summary: 's', deliverable }, clock: () => w.now });
    const channel = fakeChannel();
    const cards = createDeliverableCards({ pool, channel, accounts: googleAccounts, clock: () => w.now, log: silent });
    const fresh = await save('11111111-a', { kind: 'mail_draft', to: 'sam@example.com', subject: 'Hello', body: 'Hi' });
    const robot = await save('22222222-a', { kind: 'mail_draft', to: 'notifications@github.com', subject: 'Re: issue', body: 'Thanks' });
    const reply = await save('33333333-a', { kind: 'mail_draft', to: 'sam@example.com', subject: 'Re: x', body: 'Yes', threadId: 'thread-9', account: 'me@gmail.com' });
    const name = c => c.path.split('/').pop();
    assert.deepEqual(channel.calls, [], 'nothing happens without a press');

    const opened = await cards.act(id, name(fresh));
    assert.equal(opened.ok, true); assert.match(opened.line, /It sends only when you press Send/);
    assert.deepEqual(channel.calls.map(c => c[0]), ['openNewDraft']);
    assert.deepEqual(channel.calls[0][1], { account: 'me@gmail.com', to: ['sam@example.com'], subject: 'Hello', body: 'Hi' });
    const again = await cards.act(id, name(fresh));
    assert.equal(again.ok, true); assert.equal(channel.calls.length, 1, 'a second press does nothing');
    await assert.rejects(cards.edit(id, name(fresh), { body: 'changed' }), /already done/);

    assert.match(cardProblem(robot.card), /automated address/);
    await assert.rejects(cards.act(id, name(robot)), /automated address/);
    assert.equal(channel.calls.length, 1, 'an automated address opens nothing');
    assert.match((await w.inbox.deliverables(id)).find(d => d.name === name(robot)).cardProblem, /automated/);
    // changing who it goes to clears the problem
    assert.equal((await cards.edit(id, name(robot), { to: 'sam@example.com' })).cardProblem, null);

    const answered = createDeliverableCards({ pool, channel: fakeChannel({ answered: true }), accounts: googleAccounts, clock: () => w.now, log: silent });
    const dup = await answered.act(id, name(reply));
    assert.equal(dup.ok, false); assert.match(dup.error, /already replied/); assert.equal(dup.cardState.status, 'done');
    const r2 = await save('44444444-a', { kind: 'mail_draft', to: 'sam@example.com', subject: 'Re: y', body: 'Yes', threadId: 'thread-10' });
    await cards.act(id, name(r2));
    assert.ok(channel.calls.some(c => c[0] === 'openReplyDraft' && c[1].threadId === 'thread-10'), 'a reply opens in its thread');

    const none = createDeliverableCards({ pool, channel, accounts: async () => [], clock: () => w.now, log: silent });
    const r3 = await save('55555555-a', { kind: 'mail_draft', to: 'sam@example.com', subject: 'Later', body: 'Hi' });
    await assert.rejects(none.act(id, name(r3)), /Connect one in Integrations/);
    const company = await save('66666666-a', { kind: 'mail_draft', to: 'sam@example.com', subject: 'Other', body: 'Hi', account: 'me@company.example' });
    await assert.rejects(cards.act(id, name(company)), /isn't a connected personal account/);
  } finally { await w.done(); }
}));

test('a calendar card adds its event only on the press, refuses a duplicate, and says so when the calendar did not take it', async () => database(async pool => {
  const start = '2026-11-20T15:00:00.000Z';
  const w = await world(pool, { now: Date.parse('2026-11-06T12:00:00Z') });
  try {
    const id = await w.pursuit();
    const save = (agentId, title) => saveDeliverable({ pool, workRoot: w.workRoot, chainId: id, agentId, task: 't', want: 'x', report: { title: agentId, summary: 's', deliverable: { kind: 'calendar_block', title, start, durationMinutes: 45, notes: 'Bring the book' } }, clock: () => w.now });
    const name = c => c.path.split('/').pop();
    const channel = fakeChannel();
    const cards = createDeliverableCards({ pool, channel, accounts: googleAccounts, clock: () => w.now, log: silent });
    const a = await save('11111111-b', 'Piano practice');
    assert.deepEqual(channel.calls, []);
    const done = await cards.act(id, name(a));
    assert.equal(done.ok, true); assert.match(done.line, /Added "Piano practice"/);
    const add = channel.calls.find(c => c[0] === 'addEvent')[1];
    assert.equal(add.start, start); assert.equal(add.end, '2026-11-20T15:45:00.000Z'); assert.equal(add.details, 'Bring the book');

    const d = new Date(start);
    const dupChannel = fakeChannel({ events: [{ title: 'Lesson', start, end: start, date: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() } }] });
    const b = await save('22222222-b', 'Lesson');
    const dup = await createDeliverableCards({ pool, channel: dupChannel, accounts: googleAccounts, clock: () => w.now, log: silent }).act(id, name(b));
    assert.equal(dup.ok, false); assert.match(dup.error, /already on your calendar/); assert.ok(!dupChannel.calls.some(c => c[0] === 'addEvent'));

    const flaky = fakeChannel({ addOk: false });
    const c = await save('33333333-b', 'Recital');
    const lost = await createDeliverableCards({ pool, channel: flaky, accounts: googleAccounts, clock: () => w.now, log: silent }).act(id, name(c));
    assert.equal(lost.ok, false); assert.match(lost.error, /isn't showing yet/); assert.equal(lost.cardState.status, 'ready', 'it can be pressed again');

    w.now = Date.parse('2026-12-01T12:00:00Z');
    const e = await save('44444444-b', 'Too late');
    await assert.rejects(cards.act(id, name(e)), /has passed/);
  } finally { await w.done(); }
}));

// ── the hold ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a pursuit with a finished deliverable sends no agent to redo it: an unrated brief holds the floor until the person answers, while a dated step and an open question still go', async () => database(async pool => {
  let reply = `Done.${doneReport({ remaining: [] })}`;
  const w = await world(pool, { reply: () => reply });
  try {
    const id = await w.pursuit();
    const first = await w.agents.plan();
    assert.equal(first.started.length, 1, 'the first run goes');
    await w.agents.poll();
    assert.equal((await w.agents.get(first.started[0])).status, 'done');
    const name = (await w.inbox.deliverables(id))[0].name;

    w.now += 3_600_000;
    assert.deepEqual((await w.agents.plan()).started, [], 'an unrated brief holds the floor');
    assert.equal((await w.board.detail(id)).held.why, 'unrated', 'and the pursuit says so');

    // the person can always send one
    reply = `Working.${block({ status: 'working', summary: 'x' })}`;
    const mine = await w.agents.deploy(id, { kind: 'research', task: 'a question of mine', firedBy: 'person' });
    assert.ok(mine.id); await w.agents.cancel(mine.id);

    // a dated step still fires
    await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{continuity}', ponder_state -> 'continuity' || $2::jsonb) WHERE id = $1`, [id, JSON.stringify({ resumeAt: new Date(w.now - 1000).toISOString(), resumeTask: 'Check the recital date', schedule: [{ at: new Date(w.now - 1000).toISOString(), task: 'Check the recital date' }] })]);
    const dated = await w.agents.plan();
    assert.equal(dated.started.length, 1); assert.match((await w.agents.get(dated.started[0])).task, /Check the recital date/);
    await w.agents.cancel(dated.started[0]);

    // an open question the last agent named is real next work: it goes, once, and is told not to redo the brief
    w.now += 3_600_000;
    await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{continuity,remaining}', $2::jsonb) WHERE id = $1`, [id, JSON.stringify(['Does the Alfred book ship to Canada?'])]);
    const open = await w.agents.plan();
    assert.equal(open.started.length, 1);
    const task = (await w.agents.get(open.started[0])).task;
    assert.match(task, /do not redo/); assert.match(task, /Alfred book ship to Canada/);
    await w.agents.cancel(open.started[0]);
    w.now += 3_600_000;
    assert.deepEqual((await w.agents.plan()).started, [], 'once: a question already sent does not go again');

    // a lower verdict is an answer, and the floor moves again
    w.now += 3_600_000;
    await w.inbox.rate({ kind: 'artifact', id: `${id}/${name}`, usefulness: 'meh' });
    await pool.query(`UPDATE thought_chains SET status = 'awaiting_evidence' WHERE id = $1`, [id]);
    const after = await w.agents.plan();
    assert.equal(after.started.length, 1, 'a verdict releases it');
    assert.equal((await w.board.detail(id)).held, null);
  } finally { await w.done(); }
}));

test('a useful verdict awaiting the finish confirm holds too; "not yet" releases it, and a dismissed brief or a missing file holds nothing', async () => database(async pool => {
  const w = await world(pool, { reply: () => `Done.${doneReport({ finishLineMet: true, finishEvidence: 'three books compared' })}` });
  try {
    const id = await w.pursuit();
    await w.agents.plan(); await w.agents.poll();
    const row = (await w.inbox.deliverables(id))[0];
    w.now += 3_600_000;
    const rated = await w.inbox.rate({ kind: 'artifact', id: row.id, usefulness: 'useful' });
    assert.match(rated.finishPrompt.evidence, /three books compared/);
    await pool.query(`UPDATE thought_chains SET status = 'awaiting_evidence' WHERE id = $1`, [id]);
    assert.deepEqual((await w.agents.plan()).started, [], 'held on the finish confirm');
    assert.equal((await w.board.detail(id)).held.why, 'finish');
    const ask = (await w.asks.open()).find(a => a.kind === 'finish');
    await w.inbox.answerAsk({ id: ask.id, reply: 'not yet, it needs prices', via: 'Messages' });
    assert.equal((await w.queue.get(id)).want.status, 'active', 'not yet leaves it open');
    assert.equal((await w.agents.plan()).started.length, 1, 'and its agents go on');
  } finally { await w.done(); }

  // pure: what a hold ignores
  const state = { chain_id: 9, want: { status: 'active', receipts: [] }, commitments: [{ kind: 'artifact', path: '/x/a.md', title: 'A' }] };
  assert.equal(deliveryHold(state).why, 'unrated');
  assert.equal(deliveryHold(state, { gone: new Set(['/x/a.md']) }), null);
  assert.equal(deliveryHold(state, { dismissed: new Set(['artifact:9/a.md']) }), null);
  assert.equal(deliveryHold({ ...state, standing: 'self' }), null);
  assert.equal(deliveryHold({ ...state, origin: { kind: 'self' } }), null);
}));

// ── finishing ────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a machine witness is looked at and proposed, in plain words; only the allowed test runners ever run, and no shell', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oca-witness-'));
  try {
    const file = join(dir, 'recital.pdf');
    const look = o => observeWitness({ since: 5000, now: Date.now(), ...o });
    assert.equal(pathIn('the PDF at ~/Docs/a.pdf, saved', '/h'), '/h/Docs/a.pdf'); assert.equal(pathIn('nothing here'), null);
    assert.match((await look({ kind: 'file', detail: 'a file with no path' })).why, /no file path/);
    assert.match((await look({ kind: 'file', detail: `the program at ${file}` })).why, /isn't there/);
    await writeFile(file, 'x');
    const seen = await look({ kind: 'file', detail: `the program at ${file}` });
    assert.equal(seen.met, true); assert.match(seen.evidence, /recital\.pdf is there/);
    await utimes(file, 1, 1);
    assert.match((await look({ kind: 'file', detail: `the program at ${file}` })).why, /hasn't changed since/);

    execFileSync('git', ['-C', dir, 'init', '-q']);
    execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'Ship the recital page']);
    const repo = await look({ kind: 'repo', detail: `the repository at ${dir} has "recital page"` });
    assert.equal(repo.met, true); assert.match(repo.evidence, /new commit.*Ship the recital page/);
    assert.equal((await look({ kind: 'repo', detail: `the repository at ${dir} has "no such thing"` })).met, false);
    assert.match((await look({ kind: 'repo', detail: `the repository at ${join(dir, 'gone')}` })).why, /couldn't be read/);

    assert.deepEqual(testCommand('run `npm test` in ~/x'), ['npm', 'test']); assert.deepEqual(testCommand('`node --test tests/`'), ['node', '--test', 'tests/']);
    for (const bad of ['`rm -rf /`', '`npm test; rm x`', '`npm test && curl x`', '`npm run deploy`', 'no command']) assert.equal(testCommand(bad), null, bad);
    const ran = [];
    const run = async (c, a, o) => { ran.push([c, a, o.cwd]); return { ok: true, stdout: '' }; };
    assert.equal((await observeWitness({ kind: 'test', detail: '`rm -rf /` in /tmp', since: 0 }, { run })).met, false);
    assert.deepEqual(ran, [], 'an unknown command is never run');
    assert.match((await observeWitness({ kind: 'test', detail: `\`npm test\` in ${dir}`, since: 0 }, { run })).evidence, /passes/);
    assert.deepEqual(ran, [['npm', ['test'], dir]]);
    assert.equal((await observeWitness({ kind: 'test', detail: `\`npm test\` in ${dir}`, since: 0 }, { run: async () => ({ ok: false }) })).met, false);

    const calendar = async () => [{ title: 'Piano recital', start: '2026-11-20T15:00:00Z' }];
    const cal = await observeWitness({ kind: 'calendar', detail: 'an event called "Piano recital"', since: 0 }, { calendar });
    assert.match(cal.evidence, /"Piano recital" is on your calendar on 2026-11-20/);
    assert.equal((await observeWitness({ kind: 'calendar', detail: 'an event called "Tax meeting"', since: 0 }, { calendar })).met, false);
    assert.equal((await observeWitness({ kind: 'person', detail: 'the teacher', since: 0 })).met, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the engine proposes a met finish line as a question and never marks it done; only the person\'s yes does, and that stops what is running', async () => database(async pool => {
  const w = await world(pool);
  const dir = await mkdtemp(join(tmpdir(), 'oca-witness-'));
  try {
    const file = join(dir, 'program.pdf'); await writeFile(file, 'x');
    const id = await w.pursuit({ finishLine: { witness: { kind: 'file', detail: `the program at ${file}` }, at: 1 } });
    const before = (await w.queue.get(id)).want;
    assert.equal((await w.finish.tick()).looked, 1);
    const ask = (await w.asks.open()).find(a => a.kind === 'finish');
    assert.match(ask.detail, /^Looks done: .*program\.pdf is there.*Confirm\?$/);
    assert.match(w.texts.at(-1), /Reply yes to finish it/);
    const seen = (await w.queue.get(id)).want;
    assert.equal(seen.status, 'active', 'the engine never marks it done alone'); assert.equal(seen.progress, before.progress); assert.equal(seen.receipts.length, before.receipts.length);
    assert.equal((await w.finish.tick()).looked, 0, 'it asks once');
    assert.equal((await w.asks.open()).filter(a => a.kind === 'finish').length, 1);

    const running = await w.agents.deploy(id, { kind: 'research', task: 'more', firedBy: 'person' });
    const r = await w.inbox.answerAsk({ id: ask.id, reply: 'yes', via: 'Messages' });
    assert.equal(r.finish.finished, true);
    const after = await w.queue.get(id);
    assert.equal(after.want.status, 'sated'); assert.equal(after.status, 'resolved'); assert.equal(after.want.progress, 1);
    assert.match(after.want.receipts.at(-1).evidence[0].observation, /quinn confirmed the finish line is met, in Messages: .*program\.pdf/);
    assert.equal((await w.agents.get(running.id)).status, 'cancelled', 'what was running stops');
    const detail = await w.board.detail(id);
    assert.ok(detail.finished.at); assert.match(detail.finished.evidence, /program\.pdf is there/, 'what showed it, in plain words');
    assert.ok(!/confirmed the finish line/.test(detail.finished.evidence));
    assert.equal((await w.asks.open()).filter(a => a.kind === 'finish').length, 0);
    assert.equal((await w.finish.confirm(id)).already, true);
  } finally { await w.done(); await rm(dir, { recursive: true, force: true }); }
}));

test('for a message witness a Useful on a report that says it is met prompts the same confirm; a run that left nothing open asks once and "not yet" sticks; a lesser verdict asks nothing', async () => database(async pool => {
  const w = await world(pool);
  try {
    const save = (id, agentId, report) => saveDeliverable({ pool, workRoot: w.workRoot, chainId: id, agentId, task: 't', want: 'x', report: { title: `Brief ${agentId}`, summary: 's', ...report }, clock: () => w.now });
    const a = await w.pursuit();
    await save(a, '11111111-c', { finishLineMet: true, finishEvidence: 'all three compared' });
    const meh = await w.inbox.rate({ kind: 'artifact', id: `${a}/agent-11111111-brief-11111111-c.md`, usefulness: 'meh' });
    assert.equal(meh.finishPrompt, undefined, 'Meh asks nothing');
    const useful = await w.inbox.rate({ kind: 'artifact', id: `${a}/agent-11111111-brief-11111111-c.md`, usefulness: 'useful' });
    assert.match(useful.finishPrompt.evidence, /rated Useful: all three compared/);
    assert.equal((await w.queue.get(a)).want.status, 'active');

    // a pursuit like #65: rated before any of this ran, its report left nothing open. The sweep catches it, once.
    const b = await w.pursuit({}, 'Compare beginner methods');
    await pool.query(`INSERT INTO agent_deployments (id, chain_id, kind, task, brief, session_key, agent_id, display_name, status, fired_by, report) VALUES ('22222222-2222-4222-8222-222222222222', $1, 'research', 't', 'b', 'k', 'main', 'd', 'done', 'engine', '{"remaining":[]}')`, [b]);
    await save(b, '22222222-2222-4222-8222-222222222222', {});
    const name = (await w.inbox.deliverables(b))[0].id;
    await w.inbox.rate({ kind: 'artifact', id: name, usefulness: 'great' });
    await w.finish.decline(a);
    const ask = (await w.asks.open()).find(x => x.kind === 'finish' && x.chainId === b);
    assert.ok(ask); assert.match(ask.detail, /Looks done: you rated .* Great, and its agent left nothing open/);
    await w.inbox.dismissAsk({ id: ask.id });
    assert.equal((await w.state(b)).finishWatch.status, 'declined', 'dismissing is a not-yet');
    await w.finish.tick();
    assert.equal((await w.asks.open()).filter(x => x.kind === 'finish' && x.chainId === b).length, 0, 'it does not ask again for the same thing');
    assert.equal((await w.queue.get(b)).want.status, 'active');
    // an agent's explicit word about something new does ask again
    await save(b, '33333333-c', { finishLineMet: true, finishEvidence: 'the teacher replied' });
    await w.inbox.rate({ kind: 'artifact', id: `${b}/agent-33333333-brief-33333333-c.md`, usefulness: 'useful' });
    assert.ok((await w.asks.open()).some(x => x.kind === 'finish' && x.chainId === b));
    assert.equal(finishCandidate({ want: { status: 'active' }, standing: 'self' }), null);
  } finally { await w.done(); }
}));

// ── payments ─────────────────────────────────────────────────────────────────────────────────────────────────────────

async function paymentAsk(w, pool) {
  const id = await w.pursuit();
  const a = await w.asks.ask({ chainId: id, kind: 'question', detail: 'Oneiro wants to buy a book ($20). Are you sure?', payment: { title: 'Approve $20?', description: 'buy a book' } });
  return { id, askId: a.id };
}

test('a payment says when its code never reached the phone, and a resend texts a fresh one: it never returns the code, and it approves nothing', async () => database(async pool => {
  let line = false;
  const texts = [];
  const w = await world(pool, { channels: { imessage: async m => { if (!line) throw new Error('the work Mac is offline, so texts are paused'); texts.push(m); }, notification: async () => {} } });
  const approvals = createPaymentApprovals({ pool, clock: () => w.now, log: silent });
  w.asks.useApprovals(approvals);
  try {
    const { askId } = await paymentAsk(w, pool);
    let open = (await w.asks.open()).find(a => a.id === askId);
    assert.equal(open.payment, true); assert.equal(open.codeSent, false);
    assert.ok(open.failed.some(f => /could not be texted/.test(f)), 'the app can see why');
    assert.deepEqual(open.delivered, ['notification']);
    const hashBefore = (await pool.query(`SELECT metadata FROM notifications WHERE id = $1`, [askId])).rows[0].metadata.approval.codeHash;

    // still down: it says so plainly, and no new code goes on record
    const down = await w.asks.resendCode(askId);
    assert.equal(down.sent, false); assert.match(down.why, /work Mac is offline.*can't be approved until the text goes out/);
    assert.equal((await pool.query(`SELECT metadata FROM notifications WHERE id = $1`, [askId])).rows[0].metadata.approval.codeHash, hashBefore);
    // nothing went out, so it never says one did, and trying again costs no wait
    const stillDown = await w.asks.resendCode(askId);
    assert.equal(stillDown.sent, false); assert.match(stillDown.why, /work Mac is offline/);
    assert.equal((await pool.query(`SELECT metadata FROM notifications WHERE id = $1`, [askId])).rows[0].metadata.lastResendAt, undefined, 'a failed text starts no wait');

    // back up, at once
    line = true;
    const back = await w.asks.resendCode(askId);
    assert.equal(back.sent, true);
    await assert.rejects(w.asks.resendCode(askId), /A code just went out/, 'a code that did go out starts the wait, so a stuck button can\'t flood his phone');
    assert.deepEqual(Object.keys(back).sort(), ['expiresAt', 'id', 'sent'], 'the code is never in the answer');
    const code = /APPROVE ([A-Z0-9]{6})/.exec(texts.at(-1))[1];
    const meta = (await pool.query(`SELECT message, metadata FROM notifications WHERE id = $1`, [askId])).rows[0];
    assert.notEqual(meta.metadata.approval.codeHash, hashBefore); assert.equal(meta.metadata.approval.codeHash, hashCode(code));
    assert.ok(!JSON.stringify(meta).includes(code), 'the code is stored only as a hash');
    assert.equal(meta.metadata.approval.settled, undefined, 'a resend approves nothing');
    open = (await w.asks.open()).find(a => a.id === askId);
    assert.equal(open.codeSent, true); assert.ok(!open.failed.some(f => /could not be texted/.test(f)));
    assert.equal(open.approval.settled, null);

    // the old code is dead; the new one needs his text
    assert.equal((await approvals.decide({ approved: true, code: 'ABCDEF', from: 'quinn' })).ok, false);
    assert.equal((await approvals.decide({ approved: true, code, from: 'quinn' })).ok, true);
    w.now += 60_000;
    await assert.rejects(w.asks.resendCode(askId), /already decided/);
    const q = await w.asks.ask({ chainId: 1, kind: 'question', detail: 'not a payment' });
    await assert.rejects(w.asks.resendCode(q.id), /Only a payment/);
  } finally { await w.done(); }
}));

test('an expired approval asks once more while the want is active, in the morning if it closed overnight; never twice, never on a closed pursuit, and it never approves', async () => database(async pool => {
  const w = await world(pool, { now: Date.parse('2026-11-06T12:00:00') });
  const approvals = createPaymentApprovals({ pool, clock: () => w.now, log: silent, onExpired: ({ askId }) => w.asks.reissueExpired(askId) });
  w.asks.useApprovals(approvals);
  const meta = async id => (await pool.query(`SELECT metadata FROM notifications WHERE id = $1`, [id])).rows[0].metadata;
  try {
    // by day: at once
    const { id: chain, askId } = await paymentAsk(w, pool);
    const first = /APPROVE ([A-Z0-9]{6})/.exec(w.texts.at(-1))[1];
    w.now += APPROVAL_WINDOW_MS + 1000;
    await approvals.tick();
    let m = await meta(askId);
    assert.equal(m.approval.settled, undefined, 'it is open again'); assert.equal(m.approval.reissues, 1);
    assert.match(w.texts.at(-1), /the last code for this payment expired/);
    const second = /APPROVE ([A-Z0-9]{6})/.exec(w.texts.at(-1))[1];
    assert.notEqual(second, first);
    assert.equal((await approvals.decide({ approved: true, code: first, from: 'q' })).ok, false, 'the old code is dead');
    assert.equal((await meta(askId)).approval.settled, undefined, 'and refusing it approved nothing');
    // once only
    const sent = w.texts.length;
    w.now += APPROVAL_WINDOW_MS + 1000;
    await approvals.tick();
    m = await meta(askId);
    assert.equal(m.approval.settled, 'expired'); assert.equal(w.texts.length, sent, 'it asks once');
    assert.equal((await w.asks.open()).find(a => a.id === askId).approval.reissues, 1);
    // he can still ask for one himself
    assert.equal((await w.asks.resendCode(askId)).sent, true);

    // overnight: it waits for 8 am
    assert.equal(new Date(reissueAt(Date.parse('2026-11-06T03:10:00'))).getHours(), 8);
    assert.equal(reissueAt(Date.parse('2026-11-06T12:00:00')), Date.parse('2026-11-06T12:00:00'));
    assert.equal(new Date(reissueAt(Date.parse('2026-11-06T23:00:00'))).getDate(), 7);
    w.now = Date.parse('2026-11-07T03:00:00');
    const night = await paymentAsk(w, pool);
    const before = w.texts.length;
    w.now += APPROVAL_WINDOW_MS + 1000;
    await approvals.tick();
    m = await meta(night.askId);
    assert.equal(m.approval.settled, 'expired'); assert.equal(m.approval.reissueAt, Date.parse('2026-11-07T08:00:00'));
    assert.equal(w.texts.length, before, 'nothing goes out at 3 am');
    assert.equal((await w.asks.open()).find(a => a.id === night.askId).approval.reissueAt, m.approval.reissueAt, 'and the app can say when');
    w.now = Date.parse('2026-11-07T08:00:30');
    await approvals.tick();
    m = await meta(night.askId);
    assert.equal(m.approval.settled, undefined); assert.equal(m.approval.reissues, 1); assert.equal(w.texts.length, before + 1);

    // a pursuit no longer active gets no re-ask
    w.now = Date.parse('2026-11-07T12:00:00');
    const closed = await paymentAsk(w, pool);
    await w.life.pause(closed.id);
    const held = w.texts.length;
    w.now += APPROVAL_WINDOW_MS + 1000;
    await approvals.tick();
    assert.equal(w.texts.length, held); assert.equal((await meta(closed.askId)).approval.settled, 'expired');
  } finally { await w.done(); }
}));

// ── delete ───────────────────────────────────────────────────────────────────────────────────────────────────────────

test('deleting a pursuit is soft: its work stops, it leaves every list, nothing is erased, and it comes back as it was', async () => database(async pool => {
  const w = await world(pool);
  w.asks.useApprovals(createPaymentApprovals({ pool, clock: () => w.now, log: silent }));
  try {
    const id = await w.pursuit();
    await saveDeliverable({ pool, workRoot: w.workRoot, chainId: id, agentId: 'aaaabbbb-d', task: 't', want: 'x', report: { title: 'Kept brief', summary: 's' }, clock: () => w.now });
    const running = await w.agents.deploy(id, { kind: 'research', task: 'more', firedBy: 'person' });
    await w.asks.ask({ chainId: id, kind: 'question', detail: 'Which book?' });
    await w.asks.ask({ chainId: id, kind: 'question', detail: 'Buy it ($5)?', payment: { title: 'Approve $5?', description: 'buy' } });
    const { rowCount: before } = await pool.query('SELECT 1 FROM thought_chains');
    assert.equal(createdList(await w.inbox.list(), id), true);

    const gone = await w.life.remove(id);
    assert.ok(gone.deleted.at); assert.equal(gone.recoverUntil, w.now + DELETE_KEEP_MS);
    assert.deepEqual(gone.stopped, [running.id]);
    assert.equal((await pool.query('SELECT 1 FROM thought_chains')).rowCount, before, 'the row stays');
    await access((await w.state(id)).commitments[0].path);
    assert.equal(createdList(await w.inbox.list(), id), false, 'not in Judge');
    assert.ok(!(await w.board.overview()).pursuits.some(p => p.chainId === id), 'not in the galaxy');
    await assert.rejects(w.board.detail(id), /not found/);
    assert.equal((await w.asks.open()).filter(a => a.chainId === id).length, 0, 'its questions are closed, a payment as denied');
    assert.deepEqual((await w.agents.plan()).started, [], 'nothing starts on it');
    await assert.rejects(w.agents.deploy(id, { kind: 'research', task: 'x', firedBy: 'person' }), /closed/);
    assert.ok(!(await w.life.exportable()).includes(id));
    assert.deepEqual((await w.life.deleted()).map(d => d.chainId), [id]);
    assert.equal((await w.finish.tick()).looked, 0);
    // Listed by its name, the same word the notice and Archived use, once it has one.
    assert.equal((await w.life.deleted())[0].title, (await w.state(id)).want.description, 'its first sentence only until it is named');
    await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{continuity}', COALESCE(ponder_state -> 'continuity', '{}'::jsonb) || '{"board":{"headline":"Named by review"}}') WHERE id = $1`, [id]);
    assert.equal((await w.life.deleted())[0].title, 'Named by review');

    // 31 days on it leaves the list too, and the row still stays
    w.now += DELETE_KEEP_MS + 1000;
    assert.deepEqual(await w.life.deleted(), []);
    assert.equal((await pool.query('SELECT 1 FROM thought_chains')).rowCount, before);
    w.now -= DELETE_KEEP_MS + 1000;

    const back = await w.life.undelete(id);
    assert.equal(back.deleted, null); assert.equal(back.paused, null, 'the pause that came with the delete goes with it');
    assert.ok((await w.board.overview()).pursuits.some(p => p.chainId === id));
    assert.equal(createdList(await w.inbox.list(), id), true);
    assert.ok((await w.life.exportable()).includes(id));
    // a pause the person set stays
    await w.life.pause(id, { why: 'mine' }); await w.life.remove(id);
    assert.equal((await w.life.undelete(id)).paused.why, 'mine');
    const self = await w.pursuit({ standing: 'self' }, 'Keep getting better at it');
    await assert.rejects(w.life.remove(self), /can't be deleted/);
  } finally { await w.done(); }
}));
const createdList = (list, id) => list.wants.some(x => x.chainId === id);

// ── what a thread shows ──────────────────────────────────────────────────────────────────────────────────────────────

test('the engine takes its report blocks out of what a person reads, even one a length limit cut off', async () => database(async pool => {
  assert.equal(withoutReport('Here it is.\n```oca\n{"status":"done"}\n```'), 'Here it is.');
  assert.equal(withoutReport('Here it is.\n```oca\n{"status":"do'), 'Here it is.');
  assert.equal(withoutReport('```oca\n{}\n```'), '');
  assert.equal(withoutReport('No block, and ```js\ncode\n``` stays'), 'No block, and ```js\ncode\n``` stays');
  const w = await world(pool, { reply: () => `${'Plenty of words. '.repeat(30)}${block({ status: 'working', summary: 'still going', nextStep: 'y'.repeat(400) })}` });
  try {
    const id = await w.pursuit();
    const d = await w.agents.deploy(id, { kind: 'research', task: 'read', firedBy: 'person' });
    const thread = (await w.agents.threads(id)).agents.find(a => a.id === d.id);
    assert.ok(thread.last.text.length <= 280); assert.ok(!/oca|still going/.test(thread.last.text));
    const said = await w.agents.messages(d.id);
    assert.ok(said.messages.filter(m => m.role === 'assistant').every(m => !m.text.includes('```oca')));
    assert.ok(said.messages.some(m => m.role === 'assistant' && /Plenty of words/.test(m.text)));
  } finally { await w.done(); }
}));

// ── exporting everything ─────────────────────────────────────────────────────────────────────────────────────────────

test('export everything walks every pursuit, archived ones too, each through the single-pursuit export', async () => database(async pool => {
  const w = await world(pool);
  try {
    const a = await w.pursuit({}, 'First pursuit about books'), b = await w.pursuit({}, 'Second pursuit about scales');
    await w.life.archive(b);
    const ids = await w.life.exportable();
    assert.deepEqual(ids, [a, b]);
    const folders = await Promise.all(ids.map(id => w.life.export(id)));
    assert.match(folders[0].folder, /^pursuit-\d+-first-pursuit/); assert.match(folders[1].folder, /^pursuit-\d+-second-pursuit/);
    assert.ok(folders[1].files.some(f => f.path === 'README.md' && /archived/.test(f.content)));
  } finally { await w.done(); }
}));

// ── what the words say beside what it does (Ponder pass 3) ───────────────────────────────────────────────────────────

test('held is worked out on read: true while an open question is worked, gone the moment the deliverable is judged, and never said while paused', async () => database(async pool => {
  const w = await world(pool, { reply: () => `Done.${doneReport({ title: 'Three piano teachers compared', remaining: ['Do any teach online?'] })}` });
  try {
    const id = await w.pursuit();
    await w.agents.plan(); await w.agents.poll();
    const name = (await w.inbox.deliverables(id))[0].name;
    assert.equal((await w.board.detail(id)).held.title, 'Three piano teachers compared', 'held as soon as the brief lands, with no planning pass');
    assert.equal((await w.board.overview()).pursuits.find(p => p.chainId === id).held.why, 'unrated', 'and the map says the same');

    // the engine still works the open question it left, and the pursuit still says it's held
    w.now += 3_600_000;
    assert.equal((await w.agents.plan()).started.length, 1, 'the open question goes');
    assert.equal((await w.board.detail(id)).held.why, 'unrated');
    assert.equal((await w.state(id)).continuity.held, undefined, 'nothing stored that could go stale');

    // paused: nothing starts anyway, so it says that and only that
    await w.life.pause(id, { by: 'quinn' });
    assert.equal((await w.board.detail(id)).held, null);
    await w.life.resume(id);
    assert.equal((await w.board.detail(id)).held.why, 'unrated');

    // judged, and no planning pass in between
    await w.inbox.rate({ kind: 'artifact', id: `${id}/${name}`, usefulness: 'meh' });
    assert.equal((await w.board.detail(id)).held, null, 'the line goes with the verdict');
    assert.equal((await w.board.overview()).pursuits.find(p => p.chainId === id).held, null);
  } finally { await w.done(); }
}));

test('a payment has one instruction: its text has no "reply yes", and a plain yes still approves nothing', async () => database(async pool => {
  const w = await world(pool);
  const approvals = createPaymentApprovals({ pool, clock: () => w.now, log: silent });
  w.asks.useApprovals(approvals);
  try {
    const { askId } = await paymentAsk(w, pool);
    const text = w.texts.at(-1);
    assert.doesNotMatch(text, /reply yes|yes or no|reply here|open Oneiro/i);
    assert.match(text, /\nReply APPROVE [A-Z0-9]{6} to pay, or DENY [A-Z0-9]{6}\. \(Expires in 10 minutes\.\)$/);
    assert.equal(text.match(/Reply /g).length, 1, 'one instruction');
    const open = (await w.asks.open()).find(a => a.id === askId);
    assert.doesNotMatch(open.message + open.detail, /reply yes|yes or no|reply here|open Oneiro/i, 'and the card says the same');

    // the rule: nothing but the texted code approves it
    await w.inbox.answerAsk({ id: askId, reply: 'yes', via: 'Messages', fromPhone: true });
    const { rows: [row] } = await pool.query(`SELECT metadata FROM notifications WHERE id = $1`, [askId]);
    assert.notEqual(row.metadata.approval.settled, 'allow-once', 'a plain yes approves nothing');

    // a question that isn't a payment keeps its way to answer
    assert.match(composeAsk({ kind: 'question', chainId: 2, detail: 'Which store?' }), /reply here, or open Oneiro/);
  } finally { await w.done(); }
}));

test('a deliverable keeps its footer in the file; the panel gets a credit, and a preview from the summary with no heading run into it', async () => database(async pool => {
  const summary = 'Found the two that matter:\n- Faber wins on price\n- Alfred ships to Canada';
  const w = await world(pool, { reply: () => `Done.${doneReport({ title: 'Three piano books', summary, brief: '## Compared\n\nFaber wins.\n\n## More\n\nDetails.' })}` });
  try {
    const id = await w.pursuit();
    await w.agents.plan(); await w.agents.poll();
    const [row] = await w.inbox.deliverables(id);
    assert.equal(row.excerpt, 'Found the two that matter: Faber wins on price · Alfred ships to Canada');
    assert.ok(row.from.agent.length > 3); assert.doesNotMatch(row.from.agent, /[0-9a-f]{8}/, 'a name, not an id');
    assert.equal(row.from.at, new Date(w.now).toISOString());

    const full = await w.inbox.deliverable(row.id);
    assert.doesNotMatch(full.body, /on pursuit #|Asked to:|UTC/, 'none of the machine footer on screen');
    assert.match(full.markdown, /on pursuit #\d+, finished .* UTC\. Asked to:/, 'all of it in the file');
    assert.match(await readFile(row.path, 'utf8'), /Asked to:/);
    const { toRate } = await w.inbox.list();
    const judging = toRate.find(x => x.id === row.id);
    assert.equal(judging.excerpt, row.excerpt); assert.doesNotMatch(judging.body, /Asked to:/);
  } finally { await w.done(); }
}));

test('previews and footers, on their own', () => {
  assert.equal(previewOf('## What it found\n\nHold this time for the lesson.\n\n## Sources\n\nThe agent cited no sources.'), 'Hold this time for the lesson.', 'a heading never runs in, and the next section never follows');
  assert.equal(previewOf('found:\n- 2.2.1\n- PostHog'), 'found: 2.2.1 · PostHog');
  assert.equal(previewOf('found: - 2.2.1 - PostHog'), 'found: 2.2.1 · PostHog', 'and a list already flattened onto one line');
  assert.equal(previewOf('A ten-minute walk - no car needed.'), 'A ten-minute walk - no car needed.', 'a dash in a sentence is left alone');
  assert.equal(previewOf('1. one\n2. two'), 'one · two');
  assert.equal(previewOf('---\n\nAfter a rule.'), 'After a rule.');
  assert.equal(previewOf(''), '');
  const long = previewOf(`${'word '.repeat(100)}`, 40);
  assert.ok(long.length <= 41 && long.endsWith('…') && !long.includes('wor…'), 'cut on a word');
  const { markdown } = composeDeliverable({ chainId: 2, want: 'x', agentId: '8cff7718-aaaa', kind: 'research', task: 'Compare the options', report: { summary: 's' }, at: Date.parse('2026-11-06T07:03:00Z') });
  const { body, footer } = splitFooter(markdown);
  assert.doesNotMatch(body, /Asked to:/);
  assert.deepEqual(footer, { kind: 'research', agent: '8cff7718', at: '2026-11-06T07:03:00.000Z' });
  assert.deepEqual(splitFooter('# Just words\n\n---\n\nNo footer here.'), { body: '# Just words\n\n---\n\nNo footer here.', footer: null }, 'a rule on its own is left alone');
});

test('a person can rename a pursuit; a blank name is refused in words', async () => database(async pool => {
  const w = await world(pool);
  try {
    const id = await w.pursuit();
    await w.life.rename(id, '  Sourdough   by Sunday ');
    const { rows: [r] } = await pool.query(`SELECT ponder_state #> '{continuity,board}' AS b FROM thought_chains WHERE id = $1`, [id]);
    assert.equal(r.b.headline, 'Sourdough by Sunday');
    assert.equal(r.b.namedBy, 'person');
    await assert.rejects(w.life.rename(id, '   '), /Give it a name/);
  } finally { await w.stop?.(); }
}));

test('what a person finished is written in plain words for Memory, by its short name', () => {
  const line = finishedMemory({ seed: 'raw seed', state: { continuity: { board: { headline: 'Sourdough' } }, want: { description: 'Find a recipe', doneWhen: 'I have baked it.' } } }, 'the brief was rated useful.');
  assert.equal(line, 'Finished "Sourdough". The finish line was: I have baked it. What showed it: the brief was rated useful.');
  assert.equal(finishedMemory({ seed: 'raw seed', state: {} }), 'Finished "raw seed".');
});
