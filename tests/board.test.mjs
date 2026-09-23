import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { createBoard, parseBoard, streamName } from '../reasoning/board.js';

async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'board_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema + ',public' });
    await pool.query(`CREATE TABLE thought_chains (id SERIAL PRIMARY KEY, seed TEXT NOT NULL, status TEXT DEFAULT 'awaiting_evidence', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), ponder_state JSONB)`);
    await pool.query(`CREATE TABLE self_build_events (id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, chain_id INT, payload JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    for (const m of ['062_agent_deployments', '063_agent_actions', '064_pursuit_board']) await pool.query(await readFile(new URL(`../migrations/${m}.sql`, import.meta.url), 'utf8'));
    await run(pool);
  } finally { if (pool) await pool.end(); await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end(); }
}
const quiet = { log() {}, warn() {} };
async function pursuit(pool, { description, doneWhen = 'A month nets positive.', progress = 0, continuity = {}, standing = null, origin = { kind: 'explicit' } }) {
  const state = { want: { description, doneWhen, progress, status: 'active', receipts: [] }, origin, continuous: true, continuity, evidence: [{ id: 'person-1', source: 'observed by quinn', observation: 'We start from zero.' }], ...(standing ? { standing } : {}) };
  return (await pool.query(`INSERT INTO thought_chains (seed, ponder_state) VALUES ($1, $2) RETURNING id`, [description, JSON.stringify(state)])).rows[0].id;
}
async function run(pool, chainId, { kind = 'research', status = 'done', task, summary = '', stream = null, made = null, at, ended = null, question = null, error = null }) {
  const id = randomUUID();
  await pool.query(`INSERT INTO agent_deployments (id, chain_id, kind, task, brief, session_key, agent_id, display_name, status, report, question, error, stream, created_at, updated_at, ended_at)
    VALUES ($1,$2,$3,$4,'brief',$5,'main',$6,$7,$8,$9,$10,$11,$12,$12,$13)`,
    [id, chainId, kind, task, `agent:main:want-${chainId}-${kind}-${id.slice(0, 8)}`, `#${chainId} ${kind}`, status, summary || made ? JSON.stringify({ status, summary, ...(made ? { made } : {}) }) : null, question, error, stream, new Date(at), ended ? new Date(ended) : null]);
  return id;
}

test('a stream name is short and title-cased; the board keeper\'s answer is validated, bounded and filed only under streams it named', () => {
  assert.equal(streamName('distribution'), 'Distribution'); assert.equal(streamName('  Content!! '), 'Content'); assert.equal(streamName('x'), null); assert.equal(streamName(null), null);
  const ids = ['aaaaaaaa-1111-4111-8111-111111111111', 'bbbbbbbb-2222-4222-8222-222222222222'];
  const b = parseBoard('Here is the board: ' + JSON.stringify({
    headline: 'InnerEcho profit', progress: 'Launch assets are ready; no paying month yet.',
    streams: [{ name: 'content', aim: 'Posts and reels', state: 'active', standing: 'Carousel ready' }, { name: 'Content', aim: 'dup' }, { name: 'Distribution', state: 'weird' }],
    labels: { aaaaaaaa: 'Content', bbbbbbbb: 'Nowhere', cccccccc: 'Content' },
    made: [{ what: 'Directory listing on OBOHITO', where: 'https://obohito.com/x', stream: 'distribution', at: '2026-09-23' }, { what: 'Listing on OBOHITO directory', where: 'https://obohito.com/x' }, { what: 'ab' }],
    milestones: [{ label: 'Pricing verified', state: 'done' }, { label: 'Launch posts', state: 'soon', at: '2026-10-01T13:00:00Z' }],
  }) + ' — done.', { runIds: ids, now: Date.parse('2026-09-23T19:00:00Z') });
  assert.deepEqual(b.streams.map(s => [s.name, s.state]), [['Content', 'active'], ['Distribution', 'active']], 'duplicates dropped, unknown states become active');
  assert.deepEqual(b.labels, { [ids[0]]: 'Content' }, 'labels resolve short ids to runs and only to named streams');
  assert.equal(b.made.length, 1, 'the same thing twice is one thing; a stub is nothing'); assert.equal(b.made[0].stream, 'Distribution');
  assert.deepEqual(b.milestones.map(m => m.state), ['done', 'next']); assert.equal(b.milestones[1].at, '2026-10-01T13:00:00.000Z');
  assert.equal(b.updatedAt, '2026-09-23T19:00:00.000Z');
  assert.throws(() => parseBoard('no json here'));
});

test('the board keeper reads a pursuit\'s history, writes its board, and files unlabeled runs without overwriting the strategist\'s own labels; a board goes stale only when something newer happened', async () => database(async pool => {
  let now = Date.parse('2026-09-23T19:00:00Z');
  const id = await pursuit(pool, { description: 'InnerEcho marketing makes a profit' });
  const r1 = await run(pool, id, { task: 'Verify live prices in App Store Connect', summary: 'Prices verified: $3.99/mo, $27.99/yr', at: now - 3 * 86400000, ended: now - 3 * 86400000 + 600000 });
  const r2 = await run(pool, id, { task: 'Secure one free directory listing', summary: 'Listing live on OBOHITO', stream: 'Distribution', made: [{ what: 'Listing on OBOHITO', where: 'https://obohito.com/x' }], at: now - 3600000, ended: now - 1800000 });
  await run(pool, id, { kind: 'talker', status: 'standing', task: '', at: now - 3600000 });
  let prompt = '';
  const llm = { messages: { create: async ({ system, messages }) => { prompt = system + '\n' + messages[0].content; return { content: [{ type: 'text', text: JSON.stringify({
    headline: 'InnerEcho profit', progress: 'Set up for launch; nothing measured yet.',
    streams: [{ name: 'Pricing', aim: 'Know the unit economics', state: 'done', standing: 'Verified' }, { name: 'Distribution', aim: 'Get found', state: 'active', standing: 'One listing live' }],
    labels: { [r1.slice(0, 8)]: 'Pricing', [r2.slice(0, 8)]: 'Pricing' },
    made: [{ what: 'Listing on OBOHITO', where: 'https://obohito.com/x', stream: 'Distribution', at: '2026-09-23' }],
    milestones: [{ label: 'Prices verified', state: 'done' }, { label: 'First listing live', state: 'done' }, { label: 'Launch posts', state: 'next', at: '2026-10-01T13:00:00Z' }] }) }] }; } } };
  const board = createBoard({ pool, llm, clock: () => now, log: quiet, reviewEveryMs: 20 * 60_000 });
  await board.init();
  const row = async () => (await pool.query(`SELECT id, ponder_state AS state FROM thought_chains WHERE id = $1`, [id])).rows[0];
  assert.equal(await board.stale(await row()), true, 'no board yet');
  await board.review(id);
  for (const s of ['Verify live prices', 'Listing on OBOHITO @ https://obohito.com/x', 'We start from zero.', 'Done when: A month nets positive.']) assert.ok(prompt.includes(s), s);
  assert.ok(!/\| talker \|/.test(prompt), 'the talker is the engine\'s voice, not work on the pursuit');
  const b = (await row()).state.continuity.board;
  assert.equal(b.headline, 'InnerEcho profit'); assert.equal(b.streams.length, 2); assert.equal(b.milestones.length, 3);
  const streams = Object.fromEntries((await pool.query(`SELECT id, stream FROM agent_deployments WHERE chain_id = $1 AND kind <> 'talker'`, [id])).rows.map(r => [r.id, r.stream]));
  assert.equal(streams[r1], 'Pricing', 'an unlabeled run is filed'); assert.equal(streams[r2], 'Distribution', 'the strategist\'s own label stands');
  assert.equal(await board.stale(await row()), false, 'fresh');
  now += 30 * 60_000;
  assert.equal(await board.stale(await row()), false, 'older than the cadence but nothing happened since');
  await run(pool, id, { task: 'Make two reels', at: now - 60000 });
  assert.equal(await board.stale(await row()), true, 'a run started after the board was written');
}));

test('the map: the orchestrator and every pursuit with its streams, live agents and next step; a pursuit in full carries what it set up, milestones, schedule and its whole history, newest first', async () => database(async pool => {
  const now = Date.parse('2026-09-23T19:00:00Z');
  const selfId = await pursuit(pool, { description: 'Keep getting better', standing: 'self' });
  const id = await pursuit(pool, { description: 'InnerEcho marketing makes a profit', continuity: {
    lastThought: 'Video and free distribution are the moves now.', lastThoughtAt: '2026-09-23T18:46:00Z',
    schedule: [{ at: '2026-10-01T13:00:00.000Z', task: 'Publish the Day 1 posts', stream: 'Content' }, { at: '2026-09-01T00:00:00.000Z', task: 'past' }],
    board: { headline: 'InnerEcho profit', progress: 'Ready to launch.', updatedAt: new Date(now - 7200000).toISOString(),
      streams: [{ name: 'Content', aim: 'Posts and reels', state: 'active', standing: 'Carousel ready' }, { name: 'Distribution', aim: 'Get found', state: 'active', standing: '' }],
      made: [{ what: 'Launch kit with five carousel images', where: '/work/27/launch-kit', stream: 'Content', at: '2026-09-21T00:00:00Z' }],
      milestones: [{ label: 'Launch kit ready', state: 'done' }, { label: 'Reels', state: 'now' }, { label: 'Launch posts', state: 'next', at: '2026-10-01T13:00:00Z' }] } } });
  const self1 = await pursuit(pool, { description: 'Fix redispatch of exhausted tasks', origin: { kind: 'self' } });
  await run(pool, id, { task: 'Make two reels', status: 'running', stream: 'Content', at: now - 600000 });
  await run(pool, id, { task: 'Ask which OpenAI org serves the app', status: 'waiting_person', question: 'Which OpenAI org?', at: now - 900000 });
  await run(pool, id, { task: 'Secure one free listing', summary: 'Listing live', stream: 'Distribution', made: [{ what: 'Directory listing on OBOHITO', where: 'https://obohito.com/x' }, { what: 'Launch kit with five carousel images', where: '/work/27/launch-kit' }], at: now - 3600000, ended: now - 1800000 });
  await run(pool, id, { task: 'Old pricing check', summary: 'old', stream: 'Pricing', made: [{ what: 'Something before the board', where: 'x' }], at: now - 5 * 86400000, ended: now - 5 * 86400000 });
  await run(pool, id, { task: 'A failed attempt', status: 'failed', error: 'turn budget spent', stream: 'Content', at: now - 7000000, ended: now - 6000000 });
  await pool.query(`INSERT INTO agent_actions (id, chain_id, class, host, url, description, decision, outcome, created_at, observed_at) VALUES ($1,$2,'submit','obohito.com','https://obohito.com/submit','Submit InnerEcho to OBOHITO (form)','proceed','success',$3,$3), ($4,$2,'submit','www.instagram.com','https://instagram.com','Set the bio link','proceed','failure',$3,$3)`,
    [randomUUID(), id, new Date(now - 2000000), randomUUID()]);
  await pool.query(`INSERT INTO self_build_events (kind, chain_id, payload, created_at) VALUES ('merged', $1, '{"branch":"self/34-fix","sha":"4d650f8f3886"}', $2)`, [self1, new Date(now - 100000)]);
  const asks = { open: async () => [{ id: 9, chainId: id, kind: 'question', detail: 'Which OpenAI org?', sessionKey: 'k' }] };
  const agents = { slots: async () => 4, pausedUntil: () => null };
  const board = createBoard({ pool, llm: null, asks, agents, controls: { get: async () => ({ queuePaused: false }) }, gateway: { available: async () => true }, clock: () => now, log: quiet });
  const map = await board.overview();
  assert.equal(map.orchestrator.slots, 4); assert.equal(map.orchestrator.working, 1); assert.equal(map.orchestrator.waiting, 1); assert.equal(map.orchestrator.selfChainId, selfId);
  assert.equal(map.orchestrator.today.merged, 1); assert.equal(map.orchestrator.lastMerge.branch, 'self/34-fix'); assert.equal(map.orchestrator.gatewayUp, true);
  const p = map.pursuits.find(x => x.chainId === id);
  assert.equal(p.headline, 'InnerEcho profit'); assert.equal(p.lastThought, 'Video and free distribution are the moves now.');
  assert.deepEqual(p.next, { at: '2026-10-01T13:00:00.000Z', task: 'Publish the Day 1 posts' }, 'the next step is the earliest future one');
  assert.deepEqual(p.streams.map(s => [s.name, s.counts.total]), [['Content', 2], ['Distribution', 1], ['Pricing', 1]], 'the board\'s streams, then one the strategist named since');
  assert.equal(p.streams[0].counts.live, 1); assert.equal(p.streams[0].counts.failed, 1);
  assert.deepEqual(p.agents.map(a => a.status).sort(), ['running', 'waiting_person'], 'only agents that are on it now');
  assert.deepEqual(p.milestones, { done: 1, total: 3, now: 'Reels' }); assert.equal(p.asks, 1);
  assert.equal(map.pursuits.find(x => x.chainId === self1).parent, selfId, 'a self-want hangs off the pursuit about itself');
  const full = await board.detail(id);
  assert.deepEqual(full.made.map(m => m.what), ['Directory listing on OBOHITO', 'Launch kit with five carousel images'],
    'what it set up: newer agent reports join the board\'s list once each; the submit click behind the listing is the listing; failures and older reports are the board\'s to judge');
  await pool.query(`INSERT INTO agent_actions (id, chain_id, class, host, url, description, decision, outcome, created_at, observed_at) VALUES ($1,$2,'publish','x.com','https://x.com/post/1','Publish the Day 1 post (thread)','proceed','success',$3,$3)`, [randomUUID(), id, new Date(now - 60000)]);
  assert.equal((await board.detail(id)).made[0].what, 'Publish the Day 1 post', 'a successful action no agent reported is itself something set up');
  assert.equal(full.milestoneList.length, 3); assert.equal(full.schedule.length, 1); assert.equal(full.openAsks.length, 1);
  assert.equal(full.agentList.length, 5);
  const times = full.history.map(h => Date.parse(h.at)); assert.deepEqual(times, [...times].sort((a, b) => b - a), 'history is newest first');
  assert.ok(full.history.some(h => h.kind === 'action' && h.outcome === 'failure'), 'a failed action is part of what it did');
  assert.ok(full.history.some(h => h.kind === 'failed' && /turn budget/.test(h.title)));
  assert.equal((await board.detail(self1)).made[0].what, 'Merged self/34-fix', 'a merged fix is something the engine set up for itself');
  await assert.rejects(board.detail(9999), /not found/);
}));
