// A pursuit has to do something and leave something: a finished agent leaves a brief the person can read, rate and
// keep; a Useful or Great verdict is progress even at the cap; a verdict can be changed; a pursuit can be paused,
// archived and restored, and exported as a folder of markdown; a question can be dismissed without anyone speaking
// for the person.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordOutcome, createWant, USEFUL_AT } from '../motivation/hunger.js';
import { composeDeliverable, saveDeliverable, briefTitle } from '../reasoning/deliverables.js';
import { createPursuitLife, exportPursuit } from '../reasoning/pursuit-life.js';
import { createAgents, parseReport, agentModel } from '../reasoning/agents.js';
import { createAsks } from '../reasoning/asks.js';
import { createInbox, RATINGS } from '../reasoning/inbox.js';
import { createBoard } from '../reasoning/board.js';
import { createPonderQueue } from '../reasoning/ponder-queue.js';
import { createWorthLedger } from '../motivation/worth-ledger.js';
import { createRiskJournal } from '../motivation/risk-journal.js';

const silent = { log() {}, warn() {} };
const blocked = async () => ({ status: 'needs_evidence', checkpoint: { version: 1, passes: [] }, missingEvidence: ['x'] });
const ev = [{ id: 'e1', source: 'a person\'s rating', observation: 'rated it' }];

async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'output_test_' + randomBytes(6).toString('hex');
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
const block = o => `\n\`\`\`oca\n${JSON.stringify(o)}\n\`\`\``;

// ── ratings ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a Useful or Great verdict is progress even when progress is capped: it never counts as a failed attempt or rotates the strategy', () => {
  const capped = { ...createWant({ description: 'learn piano', doneWhen: 'my teacher hears a full piece', now: 0 }), progress: 0.9, strategy: 2, failedAttempts: 1 };
  const great = recordOutcome(capped, { receiptId: 'rated-artifact-a.md', progress: 0.9, usefulness: RATINGS.great, evidence: ev, now: 5 });
  assert.equal(great.strategy, 2, 'Great at the cap keeps the strategy');
  assert.equal(great.failedAttempts, 0, 'and is not a failed attempt');
  assert.equal(great.lastProgressAt, 5, 'it is progress');
  const useful = recordOutcome(capped, { receiptId: 'rated-artifact-b.md', progress: 0.9, usefulness: RATINGS.useful, evidence: ev, now: 5 });
  assert.equal(useful.strategy, 2); assert.equal(useful.failedAttempts, 0);
  assert.equal(USEFUL_AT, RATINGS.useful, 'one threshold, shared with the inbox');
  // lower verdicts still rotate
  const meh = recordOutcome(capped, { receiptId: 'rated-artifact-c.md', progress: 0.9, usefulness: RATINGS.meh, evidence: ev, now: 5 });
  assert.equal(meh.strategy, 3); assert.equal(meh.failedAttempts, 2);
});

test('a verdict can be replaced: the old receipt stays on record, marked replaced, and its effect on the strategy is undone', () => {
  const w0 = { ...createWant({ description: 'x', doneWhen: 'y', now: 0 }), progress: 0.4, strategy: 1 };
  const useless = recordOutcome(w0, { receiptId: 'rated-artifact-a.md', progress: 0.4, usefulness: 0, evidence: ev, now: 1 });
  assert.equal(useless.strategy, 2);
  const great = recordOutcome(useless, { receiptId: 'rated-artifact-a.md~2', progress: 0.65, usefulness: 1, supersedes: 'rated-artifact-a.md', evidence: [{ ...ev[0], id: 'e2' }], now: 2 });
  assert.equal(great.strategy, 1, 'the useless verdict\'s rotation is undone and the great one does not rotate');
  assert.equal(great.progress, 0.65);
  assert.equal(great.receipts[0].supersededBy, 'rated-artifact-a.md~2');
  assert.throws(() => recordOutcome(great, { receiptId: 'rated-artifact-a.md~3', progress: 0.4, usefulness: 0, supersedes: 'rated-artifact-a.md', evidence: ev, now: 3 }), /already replaced/);
  // the same receipt again is idempotent even though the stored copy carries its effect
  assert.equal(recordOutcome(great, { receiptId: 'rated-artifact-a.md~2', progress: 0.65, usefulness: 1, supersedes: 'rated-artifact-a.md', evidence: [{ ...ev[0], id: 'e2' }], now: 9 }), great);
});

// ── deliverables ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('a finished agent\'s brief reads as a document: the write-up, every source with its quote, what is next, and what is still open', () => {
  const report = parseReport(`Done.${block({ status: 'done', title: 'Three beginner piano books', summary: 'Compared three books.',
    brief: '## The short answer\n\nAlfred\'s Basic Adult is the best start.\n\n| Book | Price |\n|---|---|\n| Alfred | $12 |',
    evidence: [{ source: 'https://example.com/alfred', quote: 'Alfred\'s Basic Adult Piano Course, Level 1 costs $12.99', observation: 'price' }],
    nextStep: 'Order Alfred.', remaining: ['Is a teacher needed?'] })}`);
  assert.match(report.brief, /\| Book \| Price \|\n\|---\|---\|/, 'markdown keeps its lines');
  const { title, markdown } = composeDeliverable({ chainId: 7, want: 'Learn piano', doneWhen: 'Three books compared', agentId: 'abcdef12-0000', task: 'Compare books', report,
    verified: [{ observation: 'price — quoted: "Alfred\'s Basic Adult Piano Course"' }], at: Date.parse('2026-11-05T10:00:00Z') });
  assert.equal(title, 'Three beginner piano books');
  assert.match(markdown, /^# Three beginner piano books\n\n_For:_ Learn piano\n\n_Judge by:_ Does this get you closer to: Three books compared\n\n## The short answer/);
  assert.match(markdown, /## Sources\n\n1\. <https:\/\/example\.com\/alfred> \(re-read and confirmed by Oneiro\)\n   price\n   > Alfred's Basic Adult/);
  assert.match(markdown, /## Next step\n\nOrder Alfred\./); assert.match(markdown, /## Still open\n\n- Is a teacher needed\?/);
  // without a brief or sources it says so, plainly
  const bare = composeDeliverable({ chainId: 7, want: 'w', task: 'Find the price of the cheapest flight to Lisbon. Then compare.', report: { summary: 'It is $410.' }, agentId: 'x' });
  assert.equal(bare.title, 'Find the price of the cheapest flight to Lisbon');
  assert.match(bare.markdown, /## What it found\n\nIt is \$410\./); assert.match(bare.markdown, /cited no sources/);
  assert.equal(briefTitle({ task: '', summary: '' }), 'What the agent found');
});

test('every finished agent leaves a brief on its pursuit: it lands in Judge, a Great at the cap keeps the strategy, the verdict can change, and the pursuit lists it with its verdict', async () => database(async pool => {
  const workRoot = await mkdtemp(join(tmpdir(), 'oca-output-'));
  try {
    let now = 30 * 86400000;
    const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
    const controlsState = { autonomousActions: false, askOwner: true, agentSlots: 4 };
    const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => controlsState });
    const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
    const host = fakeHost(() => `Here it is.${block({ status: 'done', title: 'Beginner piano books', summary: 'Three books compared.', brief: '## Answer\n\nStart with Alfred.', evidence: [{ source: 'https://example.com/a', quote: 'a quote long enough to count here', observation: 'the price' }] })}`);
    const agents = createAgents({ pool, host, queue, risk, conversations: false, controls: { get: async () => controlsState }, clock: () => now, log: silent,
      deliver: x => saveDeliverable({ pool, workRoot, clock: () => now, ...x }) });
    await agents.init();
    const inbox = createInbox({ pool, queue, worth, workRoot, clock: () => now, agents });
    const chain = await inbox.want({ description: 'Find three well-reviewed beginner piano method books under $30 and compare them', doneWhen: 'A comparison of three books, each under $30, with review sources.' });
    const d = await agents.deploy(chain.chain_id, { kind: 'research', task: 'Compare beginner piano books', firedBy: 'person' });
    await agents.poll();
    assert.equal((await agents.get(d.id)).status, 'done');
    const card = (await inbox.list()).toRate.find(i => i.kind === 'artifact');
    assert.ok(card, 'the brief is in Judge');
    assert.equal(card.title, 'Beginner piano books'); assert.match(card.body, /Start with Alfred/); assert.match(card.path, new RegExp(`${chain.chain_id}/artifacts/agent-`));
    let list = await inbox.deliverables(chain.chain_id);
    assert.equal(list.length, 1); assert.equal(list[0].verdict, null); assert.equal(list[0].agentId, d.id); assert.equal(list[0].exists, true);
    const words = await inbox.deliverable(list[0].id);
    assert.match(words.markdown, /## Sources/); assert.equal(words.forWhat, 'Find three well-reviewed beginner piano method books under $30 and compare them');

    // at the cap, a Great is progress: no rotation, no failed attempt, and the person is told what it did
    await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(jsonb_set(ponder_state, '{want,progress}', '0.9'), '{want,strategy}', '2') WHERE id = $1`, [chain.chain_id]);
    let r = await inbox.rate({ kind: 'artifact', id: card.id, usefulness: 'great' });
    assert.equal(r.want.want.strategy, 2); assert.equal(r.want.want.failedAttempts, 0);
    assert.equal(r.effect.rotated, false); assert.equal(r.effect.progressBefore, 0.9); assert.equal(r.effect.progressAfter, 0.9);
    assert.equal((await inbox.list()).toRate.length, 0, 'rated, it leaves Judge');
    list = await inbox.deliverables(chain.chain_id);
    assert.equal(list[0].verdict, 'great', 'and stays on the pursuit with its verdict');
    // changed to Meh: the strategy rotates now, and the receipt is replaced, not stuck
    r = await inbox.rate({ kind: 'artifact', id: card.id, usefulness: 'meh' });
    assert.equal(r.effect.rotated, true); assert.equal(r.want.want.strategy, 3);
    list = await inbox.deliverables(chain.chain_id);
    assert.equal(list[0].verdict, 'meh'); assert.equal(list[0].changed, true);
    // the same verdict twice changes nothing
    const same = await inbox.rate({ kind: 'artifact', id: card.id, usefulness: 'meh' });
    assert.equal(same.want.want.strategy, 3);
  } finally { await rm(workRoot, { recursive: true, force: true }); }
}));

// ── pause, archive, export ───────────────────────────────────────────────────────────────────────────────────────────

test('a verdict that lands during a pass waits for it, and if the pass runs long it says so in plain words', async () => database(async pool => {
  // Found on the real Mac: rating a second brief right after the first failed with "ponder chain is running", and the
  // error took the brief off the screen.
  const workRoot = await mkdtemp(join(tmpdir(), 'oca-busy-'));
  try {
    let now = 30 * 86400000;
    const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
    const controlsState = { autonomousActions: false, askOwner: true, agentSlots: 4 };
    const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => controlsState });
    const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
    const host = fakeHost(() => `Here it is.${block({ status: 'done', title: 'A brief', summary: 'Done.', brief: 'Words.', evidence: [] })}`);
    const agents = createAgents({ pool, host, queue, risk, conversations: false, controls: { get: async () => controlsState }, clock: () => now, log: silent,
      deliver: x => saveDeliverable({ pool, workRoot, clock: () => now, ...x }) });
    await agents.init();
    const inbox = createInbox({ pool, queue, worth, workRoot, clock: () => now, agents, passWaitMs: 2_000, passPollMs: 20 });
    const chain = await inbox.want({ description: 'Compare two things for me', doneWhen: 'A comparison of the two things.' });
    await agents.deploy(chain.chain_id, { kind: 'research', task: 'Compare them', firedBy: 'person' });
    await agents.poll();
    const { id } = (await inbox.deliverables(chain.chain_id))[0];
    const hold = status => pool.query('UPDATE thought_chains SET status = $2 WHERE id = $1', [chain.chain_id, status]);
    const { rows: [{ status: idle }] } = await pool.query('SELECT status FROM thought_chains WHERE id = $1', [chain.chain_id]);

    await hold('running');
    setTimeout(() => hold(idle), 120);
    const rated = await inbox.rate({ kind: 'artifact', id, usefulness: 'useful' });
    assert.equal(rated.kind, 'artifact', 'the press waited for the pass and landed');
    assert.equal((await inbox.deliverables(chain.chain_id))[0].verdict, 'useful');

    await hold('running');
    setTimeout(() => hold(idle), 120);
    await inbox.progress({ chainId: chain.chain_id, progress: 0.5, observation: 'the finish press waits too' });

    await hold('running');
    const impatient = createInbox({ pool, queue, worth, workRoot, clock: () => now, agents, passWaitMs: 0, passPollMs: 1 });
    await assert.rejects(() => impatient.rate({ kind: 'artifact', id, usefulness: 'great' }), e => {
      assert.match(e.message, /thinking about this pursuit right now/); assert.doesNotMatch(e.message, /ponder|chain/i); return true;
    });
    await hold(idle);
  } finally { await rm(workRoot, { recursive: true, force: true }); }
}));

test('a pursuit can be paused (its agents stop, their work kept, the engine starts nothing new), resumed, archived out of sight, restored, and exported as markdown', async () => database(async pool => {
  const workRoot = await mkdtemp(join(tmpdir(), 'oca-life-'));
  try {
    let now = 30 * 86400000;
    const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
    const controlsState = { autonomousActions: false, askOwner: true, agentSlots: 4 };
    const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => controlsState });
    const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
    const host = fakeHost(() => `Working.${block({ status: 'working', summary: 'reading' })}`);
    const agents = createAgents({ pool, host, queue, risk, conversations: false, controls: { get: async () => controlsState }, clock: () => now, log: silent, continuityIntervalMs: 1000 });
    await agents.init();
    const inbox = createInbox({ pool, queue, worth, workRoot, clock: () => now, agents });
    const life = createPursuitLife({ pool, inbox, agents, clock: () => now, log: silent });
    const board = createBoard({ pool, agents, clock: () => now, log: silent });
    const chain = await inbox.want({ description: 'Find a good beginner piano method book', doneWhen: 'Three books compared with sources.', continuous: true });
    await pool.query(`UPDATE thought_chains SET status = 'awaiting_evidence', ponder_state = ponder_state || '{"finishLine":{"witness":{"kind":"file","detail":"a comparison file"},"check":"count","target":3,"firstStep":"List the five best-reviewed method books"}}'::jsonb WHERE id = $1`, [chain.chain_id]);

    // the first run is the first step the person confirmed
    const planned = await agents.plan();
    assert.equal(planned.started.length, 1);
    const first = await agents.get(planned.started[0]);
    assert.match(first.task, /^Start with the first step confirmed when this pursuit was made: List the five best-reviewed method books/);

    // pause: the live agent is stopped (kept), the engine deploys nothing, the person still can
    const paused = await life.pause(chain.chain_id);
    assert.deepEqual(paused.stopped, [first.id]); assert.ok(paused.paused);
    assert.equal((await agents.get(first.id)).status, 'cancelled', 'stopped, its thread and report kept');
    now += 60 * 60_000;
    assert.deepEqual((await agents.plan()).started, [], 'the planner skips a paused pursuit');
    await assert.rejects(agents.deploy(chain.chain_id, { kind: 'research', task: 'more', firedBy: 'engine' }), /paused/);
    const mine = await agents.deploy(chain.chain_id, { kind: 'research', task: 'what I asked for', firedBy: 'person' });
    assert.ok(mine.id, 'the person can still send one');
    await agents.cancel(mine.id);
    const resumed = await life.resume(chain.chain_id);
    assert.equal(resumed.paused, null);
    assert.equal((await agents.plan()).started.length, 1, 'resumed, the engine works on it again');
    await assert.rejects(life.pause(999), /not found/);

    // archive: hidden from the map and the inbox, paused while hidden, and restore brings it back as it was
    assert.ok((await board.overview()).pursuits.some(p => p.chainId === chain.chain_id));
    const archived = await life.archive(chain.chain_id);
    assert.ok(archived.archived); assert.equal(archived.paused.why, 'archived');
    assert.ok(!(await board.overview()).pursuits.some(p => p.chainId === chain.chain_id), 'gone from the galaxy');
    assert.equal((await inbox.list()).wants.length, 0, 'and from Judge');
    const restored = await life.restore(chain.chain_id);
    assert.equal(restored.archived, null); assert.equal(restored.paused, null, 'the pause that came with the archive goes with it');
    const back = (await board.overview()).pursuits.find(p => p.chainId === chain.chain_id);
    assert.ok(back); assert.equal(back.finishLine.target, 3); assert.equal(back.finishLine.firstStep, 'List the five best-reviewed method books');

    // export: a folder of markdown — the goal and finish line, each deliverable, every agent
    await saveDeliverable({ pool, workRoot, chainId: chain.chain_id, agentId: 'feedbeef-1', task: 'compare', want: 'Find a good beginner piano method book', report: { title: 'Piano books', summary: 'Alfred wins.' }, clock: () => now });
    await inbox.rate({ kind: 'artifact', id: `${chain.chain_id}/agent-feedbeef-piano-books.md`, usefulness: 'useful' });
    const out = await life.export(chain.chain_id);
    assert.match(out.folder, new RegExp(`^pursuit-${chain.chain_id}-find-a-good-beginner-piano`));
    const files = Object.fromEntries(out.files.map(f => [f.path, f.content]));
    assert.match(files['README.md'], /^# Find a good beginner piano method book/);
    assert.match(files['README.md'], /\*\*Done when:\*\* Three books compared with sources\./);
    assert.match(files['README.md'], /\*\*Who or what shows it:\*\* a comparison file \(a file\)/); assert.match(files['README.md'], /\*\*Target:\*\* 3/);
    assert.match(files['README.md'], /\[Piano books\]\(deliverables\/agent-feedbeef-piano-books\.md\) — Useful/);
    assert.match(files['deliverables/agent-feedbeef-piano-books.md'], /Alfred wins/);
    assert.match(files['agents.md'], /Start with the first step/);
    assert.ok(files['evidence.md']);
  } finally { await rm(workRoot, { recursive: true, force: true }); }
}));

test('export is pure: a pursuit with nothing yet still exports, and says so', () => {
  const out = exportPursuit({ row: { id: 3, seed: 'Plan a trip', state: { want: { description: 'Plan a trip to Lisbon', doneWhen: 'Flights booked', progress: 0, receipts: [] } } }, now: Date.parse('2026-11-05T00:00:00Z') });
  assert.equal(out.folder, 'pursuit-3-plan-a-trip-to-lisbon');
  // Found exporting a renamed pursuit on the real Mac: the file kept its first sentence instead of the name in the app.
  const named = exportPursuit({ row: { id: 3, seed: 'Plan a trip', state: { continuity: { board: { headline: 'Lisbon in May' } }, want: { description: 'Plan a trip to Lisbon', doneWhen: 'Flights booked', progress: 0, receipts: [] } } }, now: 0 });
  assert.equal(named.folder, 'pursuit-3-lisbon-in-may');
  const readme = named.files.find(f => f.path === 'README.md').content;
  assert.match(readme, /^# Lisbon in May/); assert.match(readme, /Asked for: Plan a trip to Lisbon/);
  assert.match(out.files[0].content, /Nothing delivered yet\./); assert.match(out.files[0].content, /No agent has worked on it yet\./);
});

// ── questions ────────────────────────────────────────────────────────────────────────────────────────────────────────

test('dismissing a question says nothing for the person: no agent hears "done", the agent stays parked; an answer must be words; a payment cannot be dismissed', async () => database(async pool => {
  let now = 30 * 86400000;
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const controlsState = { autonomousActions: false, askOwner: true, agentSlots: 4 };
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => controlsState });
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
  const asks = createAsks({ pool, risk, clock: () => now, log: silent, deliverers: { push: async () => {} } }); await asks.init();
  const host = fakeHost(() => `One question.${block({ status: 'needs_person', question: 'Which budget, $20 or $30?', summary: 'budget' })}`);
  const agents = createAgents({ pool, host, queue, risk, asks, conversations: false, controls: { get: async () => controlsState }, clock: () => now, log: silent });
  await agents.init();
  const inbox = createInbox({ pool, queue, worth, workRoot: tmpdir(), clock: () => now, asks, agents });
  const life = createPursuitLife({ pool, inbox, agents, clock: () => now, log: silent });
  const chain = await inbox.want({ description: 'Find a beginner piano book', doneWhen: 'Three compared.' });
  const d = await agents.deploy(chain.chain_id, { kind: 'research', task: 'Compare', firedBy: 'person' });
  await agents.poll();
  const a = await agents.get(d.id); assert.equal(a.status, 'waiting_person');
  const box = await inbox.list();
  assert.deepEqual(box.asks[0].agentIds, [d.id], 'the question names the agent parked on it');
  const before = host.sessions.get(d.sessionKey).messages.length;
  await assert.rejects(inbox.answerAsk({ id: a.askId }), /Say what your answer is/);
  await assert.rejects(inbox.answerAsk({ id: a.askId, reply: '   ' }), /Say what your answer is/);
  const r = await inbox.dismissAsk({ id: a.askId });
  assert.equal(r.dismissed, true); assert.deepEqual(r.agentsStillWaiting, [d.id]);
  assert.equal(host.sessions.get(d.sessionKey).messages.length, before, 'nothing was said in the agent\'s thread');
  assert.ok(!host.sessions.get(d.sessionKey).messages.some(m => /\bdone\b/i.test(m.text) && m.role === 'user' && m.text.startsWith('[Quinn')));
  assert.equal((await asks.open()).length, 0, 'it left Judge');
  assert.equal((await agents.get(d.id)).status, 'waiting_person', 'the agent stays parked until answered or stopped');
  // the person's real words reach it through its own thread
  await agents.relay(d.id, 'Keep it under $30.', { via: 'Oneiro' });
  assert.ok(host.sessions.get(d.sessionKey).messages.some(m => m.text === '[Quinn, via Oneiro] Keep it under $30.'));
  // a payment ask cannot be dismissed
  const { rows: [pay] } = await pool.query(`INSERT INTO notifications (category, message, metadata) VALUES ('ask', 'Approve $12?', '{"payment": true, "chainId": 1}'::jsonb) RETURNING id`);
  await assert.rejects(inbox.dismissAsk({ id: pay.id }), /can’t be dismissed/);
  assert.ok(life.router, 'the dismiss route is mounted with the pursuit routes');
}));

test('an agent model with a provider prefix is passed to Codex bare, so agents can run at all', () => {
  assert.equal(agentModel('openai/gpt-5.6-sol'), 'gpt-5.6-sol');
  assert.equal(agentModel('gpt-6-astra'), 'gpt-6-astra');
  assert.equal(agentModel(''), null); assert.equal(agentModel(null), null);
});

test('a turn interrupted under an agent nobody stopped (an engine or app restart) carries on in the same thread instead of failing', async () => database(async pool => {
  let now = 30 * 86400000;
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const controlsState = { autonomousActions: false, askOwner: true, agentSlots: 4 };
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => controlsState });
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
  const host = fakeHost(() => `Done.${block({ status: 'done', summary: 'finished after the restart' })}`);
  let first = true;
  const wait = host.wait.bind(host);
  host.wait = async runId => { if (first) { first = false; return { status: 'error', stopReason: 'interrupted', error: { message: 'interrupted' } }; } return wait(runId); };
  const agents = createAgents({ pool, host, queue, risk, conversations: false, controls: { get: async () => controlsState }, clock: () => now, log: silent });
  await agents.init();
  const inbox = createInbox({ pool, queue, worth, workRoot: tmpdir(), clock: () => now, agents });
  const chain = await inbox.want({ description: 'Find a beginner piano book', doneWhen: 'Three compared.' });
  const d = await agents.deploy(chain.chain_id, { kind: 'research', task: 'Compare', firedBy: 'person' });
  await agents.poll();
  const a = await agents.get(d.id);
  assert.equal(a.status, 'running', 'not failed'); assert.equal(a.turns, 2, 'told to carry on, in the same thread');
  await agents.poll();
  assert.equal((await agents.get(d.id)).status, 'done');
}));
