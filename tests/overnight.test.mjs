// The night: triage that fails closed, the power gate, bounded runs that carry over, the report, the schedule, and that
// nothing a person hasn't judged or approved reaches a note, a calendar or an outbox. The model, Aside and the
// accounts are faked here; nothing reaches a model or a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUDGETS, createOvernight, helperCommand, icloudLine, plainStoredProblems, isDataless, parsePower, parseWriteUp, powerGate, readHelper, validFolder, listFiles } from '../reasoning/overnight.js';
import { asideAwayLine, createAsideWaker, createIntegrations } from '../reasoning/integrations.js';
import { createGoogleChannel } from '../reasoning/overnight-google.js';
import { companyPattern } from '../reasoning/local-config.js';
import { COLD_LOAD_MS, clampItem, containsIdentifier, createNightModel, isPrivateBackend, judgeItem, parseVerdict } from '../reasoning/overnight-triage.js';
process.env.OCA_COMPANY_WORDS = 'acme';   // tests never read the person's own company list

const silent = { log() {}, warn() {} };
const AC = { onAC: true, lowPower: false };
async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'night_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  const dir = await mkdtemp(join(tmpdir(), 'oneiro-night-'));
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema });
    await run(pool, dir);
  } finally { if (pool) await pool.end(); await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end(); await rm(dir, { recursive: true, force: true }); }
}

// A model that keeps everything unless told otherwise. It records what it was asked.
function fakeModel(over = {}) {
  const calls = { triage: [], write: [], cards: [] };
  const model = { where: 'test-model on this Mac', calls,
    warm: async () => ({ ok: true, where: model.where, loaded: true }), check: async () => ({ ok: true, where: model.where, loaded: true }),
    judge: over.judge || (() => JSON.stringify({ summary: 'Ana asked to move the lease signing to Friday.', title: 'Lease signing moved', junk: false, sensitive: false, needs_reply: false })),
    write: over.write || (({ ids }) => JSON.stringify({ notes: [{ path: 'projects/lease.md', title: 'Lease', body: '- Lease signing moved to Friday.', uses: ids }] })),
    cardsReply: over.cards || (() => JSON.stringify({ cards: [] })),
    chat: async ({ system, user, timeoutMs }) => {
      if (system.includes('on-device judge')) { calls.triage.push({ user, timeoutMs }); return model.judge({ user }); }
      if (system.includes('knowledge base: a folder')) { calls.write.push({ user, timeoutMs }); const ids = [...user.matchAll(/^\[(\d+)\]/gm)].map(m => Number(m[1])); return model.write({ ids, user }); }
      calls.cards.push({ user, timeoutMs }); return model.cardsReply({ user });
    } };
  return Object.assign(model, over.model || {});
}
const noIntegrations = { list: async () => ({ integrations: [] }), mailRecent: async () => ({ accounts: [], messages: [] }) };
const noChannel = { readCalendar: async () => { throw new Error('no calendar in this test'); }, threadStatus: async () => { throw new Error('no thread in this test'); }, openReplyDraft: async () => { throw new Error('nothing may open'); }, addEvent: async () => { throw new Error('nothing may be added'); } };
async function night(pool, dir, over = {}) {
  const n = createOvernight({ pool, integrations: noIntegrations, model: fakeModel(), channel: noChannel, vault: join(dir, 'vault'), power: async () => AC, helper: async () => ({ state: 'on', why: 'on', command: null }), log: silent, ...over });
  await n.init();
  return n;
}
async function runOnce(n, trigger = 'manual') {
  const r = await n.start({ trigger });
  assert.equal(r.started, true, JSON.stringify(r));
  await n.waitFor();
  return (await n.history(1)).runs[0];
}
async function folderWith(dir, files) {
  const docs = join(dir, 'docs');
  await mkdir(docs, { recursive: true });
  for (const [name, body] of Object.entries(files)) await writeFile(join(docs, name), body);
  return docs;
}

// ---- triage fails closed --------------------------------------------------------------------------------------------
test('a reply only counts as a verdict when it says so: missing or wrong fields are never a keep', () => {
  assert.equal(parseVerdict('{"summary":"x","title":"y"}'), null, 'missing junk and sensitive was the old gap: they read as false, and the item was kept');
  assert.equal(parseVerdict('{"summary":"x","title":"y","junk":false}'), null);
  assert.equal(parseVerdict('{"summary":"x","title":"y","junk":"false","sensitive":"false"}'), null);
  assert.equal(parseVerdict('{"summary":"","title":"y","junk":false,"sensitive":false}'), null, 'a keep with nothing to keep');
  assert.equal(parseVerdict('not json at all'), null);
  assert.equal(parseVerdict(''), null);
  assert.deepEqual(parseVerdict('{"summary":"x","title":"y","junk":true,"sensitive":true}'), { verdict: 'private' }, 'private wins');
  assert.deepEqual(parseVerdict('{"summary":"x","title":"y","junk":true,"sensitive":false}'), { verdict: 'off_topic' });
  assert.equal(parseVerdict('Sure: ```json\n{"summary":"x","title":"y","junk":false,"sensitive":false}\n```').verdict, 'keep');
});

test('judgeItem: a timeout is failed and not retried, an unreadable reply gets one more try and then fails, nothing is kept', async () => {
  let n = 0;
  const timedOut = await judgeItem({ source: 'mail', text: 'hello' }, async () => { n++; throw new Error('Local inference timed out'); });
  assert.deepEqual([timedOut.verdict, timedOut.timedOut, n], ['failed', true, 1], 'the same prompt is never sent to the same model twice after a timeout');
  n = 0;
  const garbled = await judgeItem({ source: 'mail', text: 'hello' }, async () => { n++; return 'I think this one is fine!'; });
  assert.deepEqual([garbled.verdict, n], ['failed', 2]);
  const empty = await judgeItem({ source: 'files', load: async () => '' }, async () => { throw new Error('should not be asked'); });
  assert.equal(empty.verdict, 'nothing', 'an empty file is done with, not retried every night');
  const denied = await judgeItem({ source: 'files', load: async () => { throw Object.assign(new Error('nope'), { code: 'EPERM' }); } }, async () => { throw new Error('should not be asked'); });
  assert.equal(denied.verdict, 'failed');
  assert.match(denied.why, /macOS wouldn.t let Oneiro open it/, 'a refused read says so instead of looking empty');
});

test('the scan stops identifiers on both sides of the model', async () => {
  for (const bad of ['SSN 078-05-1120', 'card 4111 1111 1111 1111 please', 'my passport is X1234567', 'password: hunter2', 'token ghp_abcdefghijklmnopqrstuv', 'Your verification code is 482913']) assert.equal(containsIdentifier(bad), true, bad);
  for (const fine of ['Meet Ana at 3pm on 2026-11-06', 'Order 1234567 shipped', 'The passport renewal is due in March']) assert.equal(containsIdentifier(fine), false, fine);
  let asked = 0;
  const input = await judgeItem({ source: 'mail', text: 'Your card 4111 1111 1111 1111 was charged' }, async () => { asked++; return '{}'; });
  assert.deepEqual([input.verdict, asked], ['private', 0], 'an identifier in the item never reaches the model or a note');
  const output = await judgeItem({ source: 'mail', text: 'Hi' }, async () => '{"summary":"Her SSN is 078-05-1120","title":"t","junk":false,"sensitive":false,"needs_reply":false}');
  assert.equal(output.verdict, 'private', "a model that copies one out is overruled");
  assert.ok(clampItem('x'.repeat(50_000)).length < 13_000, 'a huge item is clamped so it cannot time the model out every night');
});

test('a whole night on a broken model keeps nothing and says so, per source; items wait for the next night', () => database(async (pool, dir) => {
  const docs = await folderWith(dir, { 'a.md': 'alpha plan', 'b.md': 'beta plan', 'c.md': 'gamma plan' });
  const model = fakeModel({ judge: () => { throw new Error('Local inference HTTP 500: broken'); } });
  const n = await night(pool, dir, { model });
  await n.updateSettings({ files: true, folders: [docs] });
  const run = await runOnce(n);
  const files = run.report.sources.find(s => s.source === 'files');
  assert.equal(files.kept, 0);
  assert.equal(files.failed, 3);
  assert.ok(run.report.problems.some(p => /Files: 3 items couldn't be judged/.test(p)), JSON.stringify(run.report.problems));
  assert.ok(run.report.problems.some(p => /failed three times in a row/.test(p)));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM night_notes')).rows[0].n, 0);
  assert.deepEqual((await pool.query(`SELECT DISTINCT verdict FROM night_seen`)).rows.map(r => r.verdict), ['failed'], 'still to be judged, not settled');

  // The model comes back: the same items are judged the next night and nothing was lost.
  const back = fakeModel();
  const n2 = await night(pool, dir, { model: back });
  const later = await runOnce(n2);
  assert.equal(later.report.sources.find(s => s.source === 'files').kept, 3);
}));

test('three strikes and a poison item stops being retried, and the report says so', () => database(async (pool, dir) => {
  const docs = await folderWith(dir, { 'poison.md': 'an item the model chokes on' });
  const model = fakeModel({ judge: () => 'not a verdict' });
  const n = await night(pool, dir, { model });
  await n.updateSettings({ files: true, folders: [docs] });
  await runOnce(n); await runOnce(n);
  const third = await runOnce(n);
  assert.equal(third.report.sources[0].gaveUp, 1);
  const fourth = await runOnce(n);
  assert.equal(fourth.report.sources[0].read, 0, 'given up on');
}));

test('a private item leaves no words anywhere: not in the database, the report or the vault', () => database(async (pool, dir) => {
  const docs = await folderWith(dir, { 'clinic.md': 'Biopsy results for the zebra appointment' });
  const model = fakeModel({ judge: () => JSON.stringify({ summary: 'medical', title: 'zebra', junk: false, sensitive: true, needs_reply: false }) });
  const n = await night(pool, dir, { model });
  await n.updateSettings({ files: true, folders: [docs] });
  const run = await runOnce(n);
  assert.equal(run.report.sources[0].private, 1);
  const everything = JSON.stringify([(await pool.query('SELECT * FROM night_notes')).rows, (await pool.query('SELECT * FROM night_seen')).rows, run.report]);
  assert.doesNotMatch(everything, /zebra|Biopsy|clinic\.md/);
}));

// ---- the model stays local --------------------------------------------------------------------------------------------
test('item content can only go to a private address, and the night never touches the path that crosses over to Codex', () => {
  for (const ok of ['http://127.0.0.1:11434', 'http://localhost:11434', 'http://100.71.205.97:11434', 'http://work-mac.example-tailnet.ts.net:11434', 'http://192.168.1.4:11434']) assert.equal(isPrivateBackend(ok), true, ok);
  for (const no of ['https://api.openai.com', 'http://8.8.8.8:11434', 'https://ollama.example.com', 'not a url']) assert.equal(isPrivateBackend(no), false, no);
  for (const f of ['overnight.js', 'overnight-triage.js', 'overnight-cards.js', 'overnight-notes.js', 'overnight-google.js']) {
    const src = readFileSync(new URL(`../reasoning/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /from ['"]\.\.\/llm\.js['"]|from ['"]\.\.\/codex-cli\.js['"]|from ['"]openai['"]|@anthropic-ai/, f);
  }
});

test('a model on a public address is refused before a byte is sent', async () => {
  const model = createNightModel({ url: 'https://api.openai.com', model: 'gpt', log: silent });
  const state = await model.check();
  assert.equal(state.ok, false);
  assert.match(state.why, /isn't a private address/);
  await assert.rejects(() => model.chat({ system: 's', user: 'private words' }), /not on a private address/);
});

// A fake Ollama: it answers the health calls at once and takes as long as it's told on a generation.
async function fakeOllama({ models = ['qwen-agent:latest'], loaded = [], chatDelayMs = 0 } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    let body = ''; req.on('data', d => { body += d; });
    req.on('end', () => {
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: models.map(name => ({ name })) }));
      if (req.url === '/api/ps') return res.end(JSON.stringify({ models: loaded.map(name => ({ name })) }));
      setTimeout(() => { if (!res.destroyed) res.end(JSON.stringify({ created_at: 'now', model: 'qwen-agent', done: true, message: { role: 'assistant', content: 'OK' } })); }, chatDelayMs);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}

test('a model loading from cold is not "down": the check asks for no generation, and the first call gets minutes', async () => {
  const o = await fakeOllama({ chatDelayMs: 150 });
  try {
    const model = createNightModel({ url: o.url, model: 'qwen-agent', log: silent });
    const state = await model.check();
    assert.deepEqual([state.ok, state.loaded], [true, false]);
    assert.equal(o.seen.includes('/api/chat'), false, 'being there is not the same as answering a prompt');
    assert.ok(COLD_LOAD_MS >= 5 * 60_000, 'a large model takes minutes to load');
    const warmed = await model.warm();
    assert.deepEqual([warmed.ok, warmed.coldLoaded], [true, true]);
  } finally { await o.close(); }
});

test('a model still loading after its allowance says that, and a stopped Ollama says something different', async () => {
  const o = await fakeOllama({ chatDelayMs: 2000 });
  try {
    const model = createNightModel({ url: o.url, model: 'qwen-agent', log: silent, coldLoadMs: 100 });
    const warmed = await model.warm();
    assert.deepEqual([warmed.ok, warmed.stillLoading], [false, true]);
    assert.match(warmed.why, /still loading/);
    assert.match(warmed.why, /Ollama is up/);
  } finally { await o.close(); }
  const gone = createNightModel({ url: 'http://127.0.0.1:9', model: 'qwen-agent', log: silent, probeMs: 500 });
  const stopped = await gone.warm();
  assert.match(stopped.why, /isn't running on this Mac/); assert.equal(stopped.down, true, 'only a stopped local model offers Start');
  const o2 = await fakeOllama({ models: ['something-else:latest'] });
  try { assert.match((await createNightModel({ url: o2.url, model: 'qwen-agent', log: silent }).check()).why, /isn't installed/); } finally { await o2.close(); }
});

test('a model that never comes up fails the night plainly, reads nothing into notes, and carries everything', () => database(async (pool, dir) => {
  const docs = await folderWith(dir, { 'a.md': 'alpha', 'b.md': 'beta' });
  const model = fakeModel({ model: { warm: async () => ({ ok: false, why: 'Ollama is off. Start it.' }) } });
  const n = await night(pool, dir, { model });
  await n.updateSettings({ files: true, folders: [docs] });
  const run = await runOnce(n);
  assert.equal(run.status, 'failed');
  assert.deepEqual(run.report.problems.slice(0, 1), ['Ollama is off. Start it.']);
  assert.equal(run.report.sources[0].carried, 2);
  assert.equal(model.calls.triage.length, 0);
}));

test('two timeouts in a row end the judging with a sentence; the run still finishes and a timed-out write-up is not sent again', () => database(async (pool, dir) => {
  const docs = await folderWith(dir, { 'a.md': 'one', 'b.md': 'two', 'c.md': 'three', 'd.md': 'four' });
  const model = fakeModel({ judge: () => { throw new Error('Local inference timed out'); } });
  const n = await night(pool, dir, { model });
  await n.updateSettings({ files: true, folders: [docs] });
  const run = await runOnce(n);
  assert.equal(run.status, 'finished', 'a manual run visibly finishes');
  assert.equal(model.calls.triage.length, 2);
  assert.equal(run.report.sources[0].carried, 2);
  assert.ok(run.report.problems.some(p => /timed out twice in a row/.test(p)));

  // Now judging works and the write-up times out: one try, the notes stay queued, the report says so.
  const writer = fakeModel({ write: () => { throw new Error('Local inference timed out'); } });
  const n2 = await night(pool, dir, { model: writer });
  const second = await runOnce(n2);
  assert.equal(writer.calls.write.length, 1, 'a timed-out large prompt is never retried on the same model');
  assert.ok(second.report.problems.some(p => /Writing notes timed out/.test(p)));
  assert.ok(second.report.notes.queued > 0);
  assert.ok(writer.calls.write[0].timeoutMs >= 60_000, 'batch work gets real time, not a 60-second cap');
}));

// ---- the power gate ----------------------------------------------------------------------------------------------------
test('the power gate: AC required, Low Power Mode blocks, a manual run skips the battery check only', () => {
  assert.deepEqual(powerGate({ onAC: true, lowPower: false }, 'scheduled'), { go: true });
  assert.equal(powerGate({ onAC: false, lowPower: false }, 'scheduled').go, false);
  assert.equal(powerGate({ onAC: false, lowPower: false }, 'wake').go, false);
  assert.match(powerGate({ onAC: false, lowPower: false }, 'scheduled').why, /on battery/);
  assert.deepEqual(powerGate({ onAC: false, lowPower: false }, 'manual'), { go: true }, 'a person asked for it');
  assert.equal(powerGate({ onAC: true, lowPower: true }, 'scheduled').go, false);
  assert.equal(powerGate({ onAC: false, lowPower: true }, 'manual').go, false, 'a manual run skips the battery gate only');
  assert.match(powerGate({ onAC: true, lowPower: true }, 'manual').why, /Low Power Mode/);
  assert.equal(powerGate({ onAC: null, lowPower: null }, 'scheduled').go, false, 'an unattended run does not guess');
  assert.deepEqual(powerGate({ onAC: null, lowPower: null }, 'manual'), { go: true });
});

test('pmset output parses both ways macOS writes Low Power Mode', () => {
  const batt = `Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t49%; discharging; 0:41 remaining present: true\n`;
  const ac = `Now drawing from 'AC Power'\n`;
  assert.deepEqual(parsePower(batt, ' powermode            0\n'), { onAC: false, lowPower: false, charge: 49 });
  assert.equal(parsePower(ac, ' powermode            1\n').lowPower, true, 'this Mac says powermode, and the old check for lowpowermode never fired on it');
  assert.equal(parsePower(ac, ' lowpowermode         1\n').lowPower, true);
  assert.equal(parsePower(ac, ' powermode            2\n').lowPower, false, '2 is High Power');
  assert.equal(parsePower(ac, '').lowPower, null);
  assert.equal(parsePower('', '').onAC, null);
});

test('a blocked scheduled night is recorded once with its reason and told once; a blocked manual press just says why', () => database(async (pool, dir) => {
  const told = [];
  const n = await night(pool, dir, { power: async () => ({ onAC: false, lowPower: false }), notify: async m => { told.push(m); } });
  const first = await n.start({ trigger: 'scheduled' });
  assert.match(first.blocked, /on battery/);
  await n.start({ trigger: 'scheduled' });
  const { rows } = await pool.query(`SELECT * FROM night_runs`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'skipped');
  assert.match(rows[0].report.problems[0], /on battery/);
  assert.equal(told.length, 1);

  const low = await night(pool, dir, { power: async () => ({ onAC: false, lowPower: true }) });
  const pressed = await low.start({ trigger: 'manual' });
  assert.equal(pressed.started, false);
  assert.match(pressed.blocked, /Low Power Mode/);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM night_runs WHERE trigger = 'manual'`)).rows[0].n, 0);
}));

test('a manual run on battery goes ahead', () => database(async (pool, dir) => {
  const n = await night(pool, dir, { power: async () => ({ onAC: false, lowPower: false }) });
  assert.equal((await runOnce(n)).status, 'finished');
}));

// ---- bounded, and carried over -----------------------------------------------------------------------------------------
test('a run takes a bounded bite of a backlog, newest first, and the rest comes in later runs with nothing judged twice', () => database(async (pool, dir) => {
  const files = {};
  for (let i = 0; i < 15; i++) files[`note-${String(i).padStart(2, '0')}.md`] = `Plan number ${i}`;
  const docs = await folderWith(dir, files);
  const model = fakeModel();
  const n = await night(pool, dir, { model, budgets: { manual: { itemsPerSource: 6, notes: 4, runMs: 10 * 60_000 }, scheduled: BUDGETS.scheduled } });
  await n.updateSettings({ files: true, folders: [docs] });
  const first = await runOnce(n);
  const r = first.report.sources[0];
  assert.deepEqual([r.read, r.kept, r.carried, r.listed], [6, 6, 9, 15]);
  assert.equal(model.calls.triage.length, 6);
  // The write-up takes its own bound: 4 of the 6 kept notes, the other 2 stay queued.
  assert.equal(first.report.notes.writtenCount, 4);
  assert.equal(first.report.notes.queued, 2);
  assert.ok(model.calls.write.every(c => [...c.user.matchAll(/^\[\d+\]/gm)].length <= 8), 'each bite to the writer is small');

  const second = await runOnce(n);
  assert.deepEqual([second.report.sources[0].read, second.report.sources[0].carried], [6, 3]);
  const third = await runOnce(n);
  assert.deepEqual([third.report.sources[0].read, third.report.sources[0].carried], [3, 0]);
  const fourth = await runOnce(n);
  assert.equal(fourth.report.sources[0].read, 0, 'everything has been judged');
  assert.equal(model.calls.triage.length, 15, 'nothing judged twice');
  const unique = new Set(model.calls.triage.map(c => c.user));
  assert.equal(unique.size, 15);
}));

test('a calendar gives up what is coming soonest first, with what has passed last', () => database(async (pool, dir) => {
  const inDays = n => new Date(Date.now() + n * 86_400_000).toISOString();
  const event = (id, n) => ({ id, title: id, raw: `Event ${id}`, start: inDays(n), end: inDays(n), date: null });
  const integrations = { list: async () => ({ integrations: [{ provider: 'google', account: 'me@gmail.com', label: 'personal', uid: 0, enabled: true, status: 'connected' }] }), mailRecent: async () => ({ accounts: [], messages: [] }) };
  const channel = { ...noChannel, readCalendar: async () => ({ events: [event('far', 12), event('past', -1), event('soon', 1), event('mid', 5)], unreadable: [] }) };
  const model = fakeModel();
  const n = await night(pool, dir, { model, integrations, channel, budgets: { manual: { itemsPerSource: 2, notes: 8, runMs: 10 * 60_000 }, scheduled: BUDGETS.scheduled } });
  await n.updateSettings({ calendar: true });
  await runOnce(n);
  assert.deepEqual(model.calls.triage.map(c => c.user.match(/Event (\w+)/)[1]), ['soon', 'mid']);
}));

test('a source that could not be read is not reported as nothing new', () => database(async (pool, dir) => {
  const integrations = { list: async () => ({ integrations: [{ provider: 'google', account: 'me@gmail.com', label: 'personal', uid: 0, enabled: true, status: 'connected' }] }), mailRecent: async () => { throw new Error('Aside gave no answer'); } };
  const n = await night(pool, dir, { integrations });
  await n.updateSettings({ mail: true });
  const run = await runOnce(n);
  assert.match(run.report.headline, /Some sources couldn't be read/);
}));

test('a changed file is judged again; an unchanged one is not', () => database(async (pool, dir) => {
  const docs = await folderWith(dir, { 'plan.md': 'version one' });
  const model = fakeModel();
  const n = await night(pool, dir, { model });
  await n.updateSettings({ files: true, folders: [docs] });
  await runOnce(n);
  await runOnce(n);
  assert.equal(model.calls.triage.length, 1);
  await writeFile(join(docs, 'plan.md'), 'version two, longer now');
  await runOnce(n);
  assert.equal(model.calls.triage.length, 2);
}));

test('the writer: a usable reply lands in a note, a bad one writes nothing, and a note it keeps leaving out lands in Unsorted', () => database(async (pool, dir) => {
  assert.equal(parseWriteUp('{"notes":[{"path":"a.md","title":"A","body":"- fine","uses":[9]}]}', [1]), null, 'it cites nothing it was given');
  assert.equal(parseWriteUp('{"notes":[{"path":"a.md","title":"A","body":"SSN 078-05-1120","uses":[1]}]}', [1]), null);
  assert.equal(parseWriteUp('nope', [1]), null);

  const docs = await folderWith(dir, { 'one.md': 'one thing' });
  const escape = fakeModel({ write: ({ ids }) => JSON.stringify({ notes: [{ path: '../../outside.md', title: 'x', body: '- y', uses: ids }] }) });
  const n = await night(pool, dir, { model: escape });
  await n.updateSettings({ files: true, folders: [docs] });
  const run = await runOnce(n);
  assert.ok(run.report.problems.some(p => /isn't a safe place/.test(p)), JSON.stringify(run.report.problems));
  await assert.rejects(readFile(join(dir, 'outside.md')));
  assert.equal(run.report.notes.queued, 1, 'its words stay queued');

  const ignoring = fakeModel({ write: () => JSON.stringify({ notes: [] }) });
  const n2 = await night(pool, dir, { model: ignoring });
  for (let i = 0; i < 3; i++) await runOnce(n2);
  assert.match(await readFile(join(dir, 'vault', 'Unsorted.md'), 'utf8'), /Lease signing moved/);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM night_notes WHERE state = 'queued'`)).rows[0].n, 0);
}));

test('the vault is never read as a source, even if it sits inside a chosen folder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oneiro-night-'));
  try {
    await mkdir(join(dir, 'vault'), { recursive: true });
    await writeFile(join(dir, 'vault', 'note.md'), 'from the vault');
    await writeFile(join(dir, 'mine.md'), 'mine');
    const { items } = await listFiles([dir], { exclude: [join(dir, 'vault')] });
    assert.deepEqual(items.map(i => i.title), ['mine.md']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ---- no silent failures ---------------------------------------------------------------------------------------------
test('every source reports what it read, kept, dropped and failed, and an unreadable one is named with its fix', () => database(async (pool, dir) => {
  const docs = await folderWith(dir, { 'keep.md': 'KEEP this', 'private.md': 'PRIVATE this', 'junk.md': 'JUNK this', 'weird.md': 'WEIRD this', 'scan.pdf': 'x' });
  const model = fakeModel({ judge: ({ user }) => {
    if (user.includes('PRIVATE')) return JSON.stringify({ summary: 's', title: 't', junk: false, sensitive: true, needs_reply: false });
    if (user.includes('JUNK')) return JSON.stringify({ summary: 's', title: 't', junk: true, sensitive: false, needs_reply: false });
    if (user.includes('WEIRD')) return 'no idea';
    return JSON.stringify({ summary: 'A real plan.', title: 'Plan', junk: false, sensitive: false, needs_reply: false });
  } });
  const integrations = { list: async () => ({ integrations: [{ provider: 'google', account: 'me@gmail.com', label: 'personal', uid: 0, enabled: true, status: 'connected' }] }),
    mailRecent: async () => { throw new Error('Reading mail through Aside failed: the server said 500'); } };
  const channel = { ...noChannel, readCalendar: async () => { throw new Error('The week page changed shape. Pick another with --account.'); } };
  const n = await night(pool, dir, { model, integrations, channel });
  await n.updateSettings({ mail: true, calendar: true, files: true, folders: [docs, join(dir, 'gone')] });
  const run = await runOnce(n);
  const by = Object.fromEntries(run.report.sources.map(s => [s.source, s]));
  assert.deepEqual([by.files.read, by.files.kept, by.files.private, by.files.offTopic, by.files.failed], [4, 1, 1, 1, 1]);
  assert.ok(run.report.problems.some(p => /^Mail: Couldn't read it just now: Reading mail through Aside failed: the server said 500\. It tries again next night\.$/.test(p)), JSON.stringify(run.report.problems));
  assert.ok(run.report.problems.some(p => /^Calendar: Couldn't read me@gmail\.com's calendar just now: The week page changed shape\. It tries again next night\.$/.test(p)), JSON.stringify(run.report.problems));
  assert.doesNotMatch(JSON.stringify(run.report.problems), /--account/);
  assert.ok(run.report.problems.some(p => /gone isn't there any more/.test(p)));
  assert.ok(run.report.problems.some(p => /1 PDF left unread/.test(p)));
  assert.ok(run.report.headline.includes('Read 4, kept 1'));
}));

test('a folder macOS refuses reads as refused, not empty', async () => {
  const { items, problems } = await listFiles(['/private/var/root']);
  assert.equal(items.length, 0);
  assert.match(problems.join(' '), /macOS won't let Oneiro read|Couldn't read/);
});

test('every source off says so; company accounts never reach the mail read', () => database(async (pool, dir) => {
  const n = await night(pool, dir);
  const off = await runOnce(n);
  assert.match(off.report.problems[0], /Every source is switched off/);

  const asked = [];
  const integrations = { list: async () => ({ integrations: [
    { provider: 'google', account: 'me@gmail.com', label: 'personal', uid: 0, enabled: true, status: 'connected' },
    { provider: 'google', account: 'qodonnell@acmecorp.com', label: 'acmecorp', uid: 1, enabled: true, status: 'connected' },
    { provider: 'google', account: 'off@gmail.com', label: 'other', uid: 2, enabled: false, status: 'connected' },
    { provider: 'slack', account: 'acmecorp', label: 'Acme Corp', enabled: true, status: 'connected' } ] }),
    mailRecent: async ({ accounts }) => { asked.push(accounts); return { accounts: [], messages: [] }; } };
  const n2 = await night(pool, dir, { integrations });
  await n2.updateSettings({ mail: true });
  await runOnce(n2);
  assert.deepEqual(asked, [['me@gmail.com']]);
  assert.match('Acme', companyPattern());
  assert.deepEqual((await n2.status()).accounts, [{ account: 'me@gmail.com', label: 'personal' }]);
}));

test('a run the engine restarted through is marked failed with a reason, so the lid can go and the panel can say so', () => database(async (pool, dir) => {
  const n = await night(pool, dir);
  await pool.query(`INSERT INTO night_runs (trigger) VALUES ('wake')`);
  await n.init();
  const { rows } = await pool.query('SELECT * FROM night_runs');
  assert.equal(rows[0].status, 'failed');
  assert.match(rows[0].report.problems[0], /engine restarted/);
  assert.equal((await n.alive()).done, true);
}));

test('only one night runs at a time, and a second ask says so', () => database(async (pool, dir) => {
  let release;
  const held = new Promise(r => { release = r; });
  const docs = await folderWith(dir, { 'a.md': 'a' });
  const model = fakeModel({ model: { warm: async () => { await held; return { ok: true, where: 'm' }; } } });
  const n = await night(pool, dir, { model });
  await n.updateSettings({ files: true, folders: [docs] });
  assert.equal((await n.start()).started, true);
  const second = await n.start();
  assert.deepEqual([second.started, second.already], [false, true]);
  assert.equal((await n.alive()).alive, true);
  release();
  await n.waitFor();
}));

// ---- the schedule -------------------------------------------------------------------------------------------------------
test('the catch-up runs once between 3:10 and 6 am, and not after a helper or scheduled night already ran', () => database(async (pool, dir) => {
  let t = new Date(2026, 10, 6, 2, 59).getTime();
  const n = await night(pool, dir, { clock: () => t });
  assert.equal(await n.tick(t), null, 'before the window');
  t = new Date(2026, 10, 6, 3, 5).getTime();
  assert.equal(await n.tick(t), null, 'the helper gets first go at 3:02');
  t = new Date(2026, 10, 6, 3, 10).getTime();
  assert.equal((await n.tick(t)).started, true);
  await n.waitFor();
  t = new Date(2026, 10, 6, 3, 40).getTime();
  assert.deepEqual([(await n.tick(t)).started, (await n.tick(t)).done], [false, true]);
  t = new Date(2026, 10, 6, 6, 0).getTime();
  assert.equal(await n.tick(t), null, 'after the window');
  t = new Date(2026, 10, 7, 3, 30).getTime();
  assert.equal((await n.tick(t)).started, true, 'the next night');
  await n.waitFor();
}));

test('a night blocked on battery runs once the Mac is plugged in, inside the window', () => database(async (pool, dir) => {
  let t = new Date(2026, 10, 6, 3, 15).getTime(), plugged = false;
  const n = await night(pool, dir, { clock: () => t, power: async () => ({ onAC: plugged, lowPower: false }) });
  assert.match((await n.tick(t)).blocked, /on battery/);
  t += 60 * 60_000; plugged = true;
  assert.equal((await n.tick(t)).started, true);
  await n.waitFor();
}));

test('the wake helper asking after a manual run still gets a night; a repeat ask after a wake run is told it is done', () => database(async (pool, dir) => {
  let t = new Date(2026, 10, 6, 1, 0).getTime();
  const n = await night(pool, dir, { clock: () => t });
  await runOnce(n, 'manual');
  t = new Date(2026, 10, 6, 3, 2).getTime();
  assert.equal((await n.start({ trigger: 'wake' })).started, true);
  await n.waitFor();
  const again = await n.start({ trigger: 'wake' });
  assert.deepEqual([again.started, again.done], [false, true]);
  assert.equal((await n.alive()).done, true);
}));

// ---- the helper state and the routes ------------------------------------------------------------------------------------
test('the helper state says what is wrong with the exact command', async () => {
  const none = await readHelper({ read: async () => { throw new Error('ENOENT'); }, exec: async () => '' });
  assert.equal(none.state, 'off');
  assert.equal(none.command, helperCommand());
  assert.match(none.command, /^sudo .*install-overnight-helper\.sh$/);
  const old = await readHelper({ read: async () => '# oneiro-helper-version: 2', exec: async () => '' });
  assert.equal(old.state, 'outdated');
  const good = { read: async () => '# oneiro-helper-version: 3', exec: async cmd => (cmd === 'pmset' ? 'wakepoweron at 3:00AM every day' : '') };
  assert.deepEqual([(await readHelper(good)).state, (await readHelper(good)).command], ['on', null]);
  const disabled = await readHelper({ ...good, exec: async cmd => (cmd === 'launchctl' ? '"com.oneiro.overnight" => disabled' : 'wakepoweron at 3:00AM every day') });
  assert.equal(disabled.state, 'off');
  const noWake = await readHelper({ ...good, exec: async () => '' });
  assert.match(noWake.why, /isn't scheduled/);
});

test('the routes: settings, run now, status, alive, and plain errors', () => database(async (pool, dir) => {
  const n = await night(pool, dir);
  const app = express(); app.use(express.json()); app.use(n.router);
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, method = 'GET', body) => { const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, json: await res.json() }; };
  try {
    const docs = await folderWith(dir, { 'a.md': 'alpha' });
    assert.equal((await call('/oca/night')).json.warning.startsWith('No night has run yet'), true);
    assert.equal((await call('/oca/night')).json.settings.mail, false, 'nothing is on until the person turns it on');
    assert.equal((await call('/oca/night/settings', 'PATCH', { folders: ['relative/path'] })).status, 400);
    assert.match((await call('/oca/night/settings', 'PATCH', { folders: ['/'] })).json.error, /whole disk/);
    const saved = await call('/oca/night/settings', 'PATCH', { files: true, folders: [docs] });
    assert.deepEqual(saved.json.folders, [docs]);
    const started = await call('/oca/night/run', 'POST', {});
    assert.equal(started.json.started, true);
    await n.waitFor();
    const status = (await call('/oca/night')).json;
    assert.equal(status.running, null);
    assert.equal(status.last.status, 'finished');
    assert.equal(status.last.report.sources[0].kept, 1);
    assert.equal(status.warning, null);
    assert.deepEqual((await call('/oca/night/alive')).json.done, true);
    assert.equal((await call('/oca/night/runs?limit=5')).json.runs.length, 1);
    assert.equal((await call('/oca/night/cards/9999/approve', 'POST', {})).status, 404);
    assert.throws(() => validFolder('nope'));
  } finally { await new Promise(r => server.close(r)); }
}));

test('a night worth telling reaches the digest and a notification, with the home route; a quiet night says nothing', () => database(async (pool, dir) => {
  const told = [];
  const n = await night(pool, dir, { notify: async m => { told.push(m); } });
  const before = Date.now() - 1000;
  await n.updateSettings({ files: true, folders: [await folderWith(dir, { 'a.md': 'alpha' })] });
  await runOnce(n);
  assert.equal(told.length, 0, 'a clean night with no cards stays quiet');
  assert.equal(await n.notice(before), null);

  const broken = await night(pool, dir, { notify: async m => { told.push(m); }, model: fakeModel({ model: { warm: async () => ({ ok: false, why: 'Ollama is off. Start it.' }) } }) });
  await writeFile(join(dir, 'docs', 'b.md'), 'beta');
  await runOnce(broken);
  assert.equal(told.length, 1);
  assert.match(told[0].title, /didn't finish/);
  const notice = await broken.notice(before);
  assert.equal(notice.route, 'oneiro://night');
  assert.match(notice.body, /Ollama is off/);
  assert.match(notice.key, /^night:\d+$/);
}));

test('files: documents only, and a repository is skipped whole', async () => {
  const { listFiles } = await import('../reasoning/overnight.js');
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'night-list-'));
  try {
    await writeFile(join(dir, 'plan.md'), 'my plan');
    await writeFile(join(dir, 'app.swift'), 'let x = 1');
    await mkdir(join(dir, 'repo', '.git'), { recursive: true });
    await writeFile(join(dir, 'repo', 'design.md'), 'a repo doc');
    const { items } = await listFiles([dir]);
    assert.deepEqual(items.map(i => i.title), ['plan.md']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the night\'s model: the app can start it, a scheduled night tries first and reports it, and it never goes anywhere but this Mac', () => database(async (pool, dir) => {
  const { startOllama } = await import('../reasoning/overnight-triage.js');
  // The app if it's installed, otherwise the launch agent.
  const calls = [];
  const exec = async (c, a) => { calls.push([c, ...a]); };
  assert.equal((await startOllama({ exec, exists: () => true, uid: 501 })).how, 'the Ollama app');
  assert.equal((await startOllama({ exec, exists: () => false, uid: 501 })).how, "Ollama's launch agent");
  assert.deepEqual(calls, [['open', '-g', '-a', 'Ollama'], ['launchctl', 'kickstart', 'gui/501/com.ollama.ollama']]);

  let up = false, launched = 0;
  const base = fakeModel();
  const model = { ...base, check: async () => (up ? { ok: true, where: base.where, loaded: true } : { ok: false, where: base.where, down: true, why: "The night's model isn't running on this Mac" }),
    warm: async () => (up ? { ok: true, where: base.where, loaded: true } : { ok: false, where: base.where, why: "The night's model isn't running on this Mac" }) };
  const n = await night(pool, dir, { model, launchModel: async () => { launched++; up = true; return { how: 'the Ollama app' }; }, sleep: async () => {} });
  const shown = await n.status();
  assert.equal(shown.model.canStart, true, 'the panel offers the button only while it is down');
  const r = await n.startModel();
  assert.deepEqual([r.tried, r.ok, launched], [true, true, 1]); assert.match(r.line, /started the Ollama app/);
  assert.equal((await n.status()).model.canStart, false);
  const again = await n.startModel();
  assert.deepEqual([again.tried, again.ok, launched], [false, true, 1], 'already running: nothing is started');

  // A model that's on another machine, or missing, is never started from here.
  const far = await night(pool, dir, { model: { ...base, check: async () => ({ ok: false, where: 'm on work', why: 'isn\'t answering' }) }, launchModel: async () => { throw new Error('should not start'); }, sleep: async () => {} });
  assert.deepEqual([(await far.startModel()).tried, (await far.status()).model.canStart], [false, false]);

  // It won't start: says so with the fix, and doesn't pretend.
  up = false;
  const stuck = await night(pool, dir, { model, launchModel: async () => ({ how: 'the Ollama app' }), sleep: async () => {}, modelStartWaitMs: 0 });
  const s = await stuck.startModel();
  assert.deepEqual([s.tried, s.ok], [true, false]); assert.match(s.line, /still isn't answering/);
}));

// ---- Aside's browser being closed -----------------------------------------------------------------------------------
// Aside itself is a stub throughout: nothing here quits, opens or reads the real app.
const NOT_CONNECTED = 'Aside Browser profile for account u0 — someone***@icloud.com ("Profile 0") is not connected to the daemon. Make sure that profile is running, or pick another account with --account.';
// A connected Google account, as the real integrations read it through a stub of Aside's CLI.
function asideStub({ connected = () => false } = {}) {
  const calls = [];
  const run = async (args, options) => {
    calls.push({ args, options });
    if (args[0] !== 'repl') return { stdout: '', stderr: '' };
    const code = args[1];
    if (!connected()) throw new Error(NOT_CONNECTED);
    if (code.includes('aside:alive')) return { stdout: '{"alive":true}\n', stderr: '' };
    if (code.includes('mail:recent')) return { stdout: JSON.stringify({ accounts: [{ account: 'me@gmail.com', uid: 0, total: 1, results: [{ threadId: 't1', subject: 'Lease', snippet: 'Friday?', date: 1_800_000_000_000, from: 'Ana <ana@x.com>' }] }] }) + '\n', stderr: '' };
    if (code.includes('cal:read')) return { stdout: JSON.stringify({ uid: 0, pages: [[]] }) + '\n', stderr: '' };
    return { stdout: '{"accounts":[{"uid":0,"account":"me@gmail.com","name":"Me"}]}\n', stderr: '' };
  };
  return { run, calls };
}
function steppedClock(start = 1_800_000_000_000) {
  let now = start;
  return { clock: () => now, sleep: async ms => { now += ms; }, advance: ms => { now += ms; } };
}
async function realReads(pool, stub, { clock, sleep, open }) {
  const aside = createAsideWaker({ run: stub.run, open, clock, sleep, log: silent });
  const run = aside.wrap();
  const integrations = createIntegrations({ pool, run, log: silent, clock });
  await integrations.init();
  await pool.query(`INSERT INTO integrations (provider, account, label, uid, capabilities, enabled, status, detail) VALUES ('google', 'me@gmail.com', 'personal', 0, '{mail,calendar}', true, 'connected', 'Signed in.')`);
  return { aside, integrations, channel: createGoogleChannel({ run, clock }) };
}

test('a night with Aside closed opens it, waits a bounded time, tries once more, and says so once, plainly', () => database(async (pool, dir) => {
  const stub = asideStub(), t = steppedClock();
  let opened = 0;
  const parts = await realReads(pool, stub, { ...t, open: async () => { opened++; } });
  const n = await night(pool, dir, { ...parts, clock: t.clock });
  await n.updateSettings({ mail: true, calendar: true });
  const started = t.clock();
  const run = await runOnce(n);

  assert.equal(opened, 1, 'one open, however many reads failed');
  assert.ok(t.clock() - started <= 75_000, `about a minute, not one per read: ${t.clock() - started}`);
  const aloud = run.report.problems.filter(p => /Aside/.test(p));
  assert.deepEqual(aloud, ["Aside's browser wasn't open, so mail and calendar couldn't be read. It tried to open it. Open Aside, then press Run now."]);
  assert.equal(run.report.problems[0], aloud[0], 'and it leads');
  assert.equal(run.report.headline.startsWith("Some sources couldn't be read"), true, run.report.headline);
  assert.deepEqual(run.report.aside, { opened: true, answering: false });
  const everything = JSON.stringify(run.report);
  assert.doesNotMatch(everything, /--account|daemon|icloud|Profile 0|Check Aside/, 'nothing of what Aside said on the command line, and no account detail');
  const said = await n.notice(t.clock() - 3_600_000);
  assert.equal(said.title, 'The night had problems'); assert.equal(said.body, aloud[0]); assert.equal(said.trouble, true);
  // The app's own read of the same line.
  const shown = { json(v) { this.value = v; }, status() { return this; } };
  await n.router.stack.find(l => l.route?.path === '/oca/night/notice').route.stack[0].handle({ query: {}, params: {} }, shown);
  assert.equal(shown.value.notice.key, said.key);
}));

test('a night that finds Aside closed reads normally once a profile answers', () => database(async (pool, dir) => {
  let up = false;
  const stub = asideStub({ connected: () => up }), t = steppedClock();
  const open = async () => { up = true; };
  const parts = await realReads(pool, stub, { ...t, open });
  const model = fakeModel();
  const n = await night(pool, dir, { ...parts, model, clock: t.clock });
  await n.updateSettings({ mail: true, calendar: false });
  const run = await runOnce(n);
  assert.equal(up, true);
  assert.deepEqual(run.report.aside, { opened: true, answering: true });
  assert.equal(run.report.sources[0].read, 1, 'the mail was read');
  assert.doesNotMatch(JSON.stringify(run.report.problems), /Aside/);
}));

test('a night that only reads files, or has no account, never touches Aside', () => database(async (pool, dir) => {
  const stub = asideStub(), t = steppedClock();
  let opened = 0;
  const aside = createAsideWaker({ run: stub.run, open: async () => { opened++; }, ...t, log: silent });
  const docs = await folderWith(dir, { 'plan.md': 'A real plan.' });
  const n = await night(pool, dir, { aside, clock: t.clock });
  await n.updateSettings({ mail: true, calendar: true, files: true, folders: [docs] });
  await runOnce(n);
  assert.equal(opened, 0); assert.equal(stub.calls.length, 0);
}));

test('the once-a-night line names only what was stopped, and says what actually happened with the opening', () => {
  assert.equal(asideAwayLine(['mail'], { openFailed: false }), "Aside's browser wasn't open, so mail couldn't be read. It tried to open it. Open Aside, then press Run now.");
  assert.equal(asideAwayLine(['mail', 'calendar'], { openFailed: true }), "Aside's browser wasn't open, so mail and calendar couldn't be read. Oneiro couldn't open it. Open Aside, then press Run now.");
  assert.equal(asideAwayLine(['calendar']), "Aside's browser wasn't open, so calendar couldn't be read. Open Aside, then press Run now.");
});

// ---- files that live only in iCloud ----------------------------------------------------------------------------------
test('only the dataless flag makes a file cloud-only: a local file with no blocks is read, and the folder is named', async () => {
  const { mkdtemp, writeFile, rm, stat } = await import('node:fs/promises');
  const here = await mkdtemp(join(tmpdir(), 'night-cloud-'));
  try {
    await writeFile(join(here, 'tiny.txt'), 'hi');
    await writeFile(join(here, 'cloud.txt'), 'in the cloud');
    await writeFile(join(here, 'cloud2.txt'), 'in the cloud too');
    // A real local file has blocks here, so the no-blocks case is told to the walker through a stand-in stat.
    const noBlocks = p => stat(p).then(s => ({ ...s, size: s.size, mtimeMs: s.mtimeMs, blocks: 0 }));
    const { items, problems } = await listFiles([here], { dataless: async p => /cloud2?\.txt$/.test(p), statFile: noBlocks });
    assert.deepEqual(items.map(i => i.title), ['tiny.txt'], 'tiny and on this Mac: it stays');
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^2 files in .*night-cloud-.* are kept only in iCloud, so they were left unread\. Pick a folder that's kept on this Mac, or right-click this one in Finder and choose Keep Downloaded\.$/);
    // A file with blocks never needs asking.
    let asked = 0;
    await listFiles([here], { dataless: async () => { asked++; return true; } });
    assert.equal(asked, 0);
  } finally { await rm(here, { recursive: true, force: true }); }
});

test('a folder with nothing on this Mac says exactly that', () => {
  assert.equal(icloudLine('~/Documents', 496), "Nothing in ~/Documents could be read: all 496 of its documents are kept only in iCloud. Pick a folder that's kept on this Mac, or right-click this one in Finder and choose Keep Downloaded.");
  assert.match(icloudLine('~/Documents', 1), /its one document is kept/);
  assert.match(icloudLine('~/Desktop', 1, 4), /^1 file in ~\/Desktop is kept only in iCloud, so it was left unread\./);
});

test('the dataless test reads the flag macOS reports, and a failed read of it is not called cloud-only', async () => {
  assert.equal(await isDataless('/x', async () => '40000000\n'), true);
  assert.equal(await isDataless('/x', async () => '40000020\n'), true);
  assert.equal(await isDataless('/x', async () => '20\n'), false, 'compressed is not dataless');
  assert.equal(await isDataless('/x', async () => '0\n'), false);
  assert.equal(await isDataless('/x', async () => { throw new Error('gone'); }), false);
  assert.equal(await isDataless(import.meta.filename), false, 'and on a real file on this Mac');
});

test('a night recorded before this build reads the new way: once, plainly, and with nothing of what Aside said', () => database(async (pool, dir) => {
  const raw = [`Mail: Mail couldn't be read: ${NOT_CONNECTED.slice(0, 160)}.. Check Aside is running. It retries next night.`,
    `Calendar: someone@icloud.com: Aside didn't answer while reading someone@icloud.com's calendar: ${NOT_CONNECTED.slice(0, 120)}. Check Aside is running. It retries next night.`,
    'Files: 2 PDFs left unread.'];
  assert.deepEqual(plainStoredProblems(raw), ["Aside's browser wasn't open, so mail and calendar couldn't be read. Open Aside, then press Run now.", 'Files: 2 PDFs left unread.']);
  const fresh = ["Aside's browser wasn't open, so mail couldn't be read. It tried to open it. Open Aside, then press Run now."];
  assert.equal(plainStoredProblems(fresh), fresh, 'a new report is left alone');
  assert.equal(plainStoredProblems(undefined), undefined);
  const n = await night(pool, dir);
  const at = new Date(Date.now() - 3_600_000);
  await pool.query(`INSERT INTO night_runs (trigger, status, stage, started_at, heartbeat_at, finished_at, report) VALUES ('scheduled', 'finished', 'done', $1, $1, $1, $2)`, [at, { problems: raw, headline: "Some sources couldn't be read", sources: [], notes: { written: [], writtenCount: 0, queued: 0, carried: 0 }, cards: { ready: 0, dropped: [] } }]);
  const shown = JSON.stringify([(await n.history(1)).runs[0].report.problems, await n.notice(at.getTime() - 1000), (await n.status()).last.report.problems]);
  assert.doesNotMatch(shown, /--account|daemon|icloud|Profile 0|Check Aside/);
  assert.equal((await n.notice(at.getTime() - 1000)).trouble, true);
}));

test('company data stays out by content, not only by account: a personal inbox still gets company mail', async () => {
  let asked = 0;
  const said = await judgeItem({ source: 'mail', title: 'Code review request', text: 'Ely requested a review on acme-v2 #242' }, async () => { asked++; return '{}'; });
  assert.deepEqual([said.verdict, said.by, asked], ['private', 'company', 0], 'never reaches the model or a note');
  const out = await judgeItem({ source: 'mail', text: 'Standup notes' }, async () => '{"summary":"Standup for Acme Corp","title":"t","junk":false,"sensitive":false,"needs_reply":false}');
  assert.equal(out.verdict, 'private');
  const fine = await judgeItem({ source: 'mail', text: 'Your space heater shipped' }, async () => '{"summary":"A heater shipped","title":"t","junk":false,"sensitive":false,"needs_reply":false}');
  assert.equal(fine.verdict, 'keep');
});

test('a machine with no company configured filters nothing by accident, and a broken pattern fails open to the same', async () => {
  const { companyPattern } = await import('../reasoning/local-config.js');
  const saved = process.env.OCA_COMPANY_WORDS, savedPath = process.env.OCA_LOCAL_CONFIG;
  try {
    process.env.OCA_LOCAL_CONFIG = '/nonexistent/local.json';
    delete process.env.OCA_COMPANY_WORDS;
    assert.equal(companyPattern().test('anything at all'), false);
    process.env.OCA_COMPANY_WORDS = '([';
    assert.equal(companyPattern().test('anything at all'), false);
  } finally {
    process.env.OCA_COMPANY_WORDS = saved;
    if (savedPath === undefined) delete process.env.OCA_LOCAL_CONFIG; else process.env.OCA_LOCAL_CONFIG = savedPath;
  }
});
