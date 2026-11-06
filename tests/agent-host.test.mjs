// The agent host: Codex threads for work agents, T3 Code threads for pursuit conversations, one interface over both.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexHost, appServerArgs, engineMcpServersIn } from '../agent-host/codex-host.js';
import { createT3Host, PROJECT_AGENTS_MD } from '../agent-host/t3-host.js';
import { createAgentHost, kindOfKey } from '../agent-host/index.js';
import { fakeCodex } from './fixtures/fake-codex.mjs';

async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'agent_host_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema + ',public' });
    await run(pool);
  } finally { if (pool) await pool.end(); await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end(); }
}
const quiet = { log() {}, warn() {} };
const codexHost = (pool, fake, extra = {}) => createCodexHost({ pool, connect: fake.connect, restartGapMs: 0, log: quiet, args: [], ...extra });

test('a work agent is a named Codex thread: created idle, a turn per message, the reply when its turn ends', async () => database(async pool => {
  const fake = fakeCodex();
  const host = codexHost(pool, fake); await host.init();
  assert.equal(await host.available(), true);
  const s = await host.createSession({ key: 'agent:oca:want-7-research-abc', label: '#7 research · price', displayName: '#7 research · price', cwd: '/tmp/work', thinkingLevel: 'high' });
  const t = fake.threads.get(s.threadId);
  assert.equal(t.name, '#7 research · price');
  assert.equal(t.cwd, '/tmp/work');
  assert.equal(t.params.approvalPolicy, 'never'); assert.equal(t.params.sandbox, 'danger-full-access'); assert.equal(t.params.threadSource, 'oca-engine');
  assert.deepEqual(t.params.config, { model_reasoning_effort: 'high' });
  assert.equal(t.turns.length, 0, 'created idle');
  assert.deepEqual(await host.createSession({ key: 'agent:oca:want-7-research-abc' }), { ok: true, key: 'agent:oca:want-7-research-abc', threadId: s.threadId }, 'idempotent by key');

  const r = await host.turn({ sessionKey: 'agent:oca:want-7-research-abc', message: '[thinker] find the price', idempotencyKey: 'dep:1' });
  assert.deepEqual(await host.wait('dep:1', { timeoutMs: 0 }), { status: 'pending' });
  assert.deepEqual(await host.turn({ sessionKey: 'agent:oca:want-7-research-abc', message: 'again', idempotencyKey: 'dep:1' }), { runId: 'dep:1', turnId: r.turnId, status: 'running' }, 'a retried turn is not sent twice');
  assert.equal(t.turns.length, 1);
  const waiting = host.wait('dep:1', { timeoutMs: 2000 });
  fake.complete(s.threadId, r.turnId, { text: 'It is $4.99.\n```oca\n{"status":"done","summary":"priced"}\n```' });
  const w = await waiting;
  assert.equal(w.status, 'ok'); assert.match(w.terminalReply.text, /\$4\.99/);

  const tr = await host.transcript('agent:oca:want-7-research-abc');
  assert.deepEqual(tr.messages.map(m => [m.role, m.runId, m.terminal]), [['user', 'dep:1', null], ['assistant', 'dep:1', true]]);
  assert.equal(tr.active, false);
  const link = await createAgentHost({ pool, codex: host, t3: null, log: quiet }).link('agent:oca:want-7-research-abc');
  assert.deepEqual(link, { app: 'Codex', command: `codex resume ${s.threadId}`, threadId: s.threadId });
  await host.close();
}));

test('what Quinn says from T3 Code or Codex lands in the same thread and the engine reads it back', async () => database(async pool => {
  const fake = fakeCodex();
  const host = codexHost(pool, fake); await host.init();
  const s = await host.createSession({ key: 'agent:oca:want-3-research-q' });
  const r = await host.turn({ sessionKey: 'agent:oca:want-3-research-q', message: '[thinker] go', idempotencyKey: 'd:1' });
  fake.complete(s.threadId, r.turnId, { text: '```oca\n{"status":"needs_person","question":"Which region?"}\n```' });
  await host.wait('d:1', { timeoutMs: 1000 });
  assert.ok(fake.requests.some(([m, p]) => m === 'thread/unsubscribe' && p.threadId === s.threadId), 'the thread is let go after its turn, so the next read comes from disk');
  fake.external(s.threadId, 'US store.', 'Got it — US store.');
  const tr = await host.transcript('agent:oca:want-3-research-q');
  const last = tr.messages.slice(-2);
  assert.deepEqual(last.map(m => [m.role, m.text, m.runId]), [['user', 'US store.', null], ['assistant', 'Got it — US store.', null]]);
  const changed = await host.sessions();
  assert.equal(changed[0].key, 'agent:oca:want-3-research-q');
  assert.ok(changed[0].updatedAt > 0);
  await host.close();
}));

test('restarts: a turn that finished while the engine was down is taken once; one cut off is lost, never silently pending', async () => database(async pool => {
  const fake = fakeCodex();
  let host = codexHost(pool, fake); await host.init();
  const s = await host.createSession({ key: 'agent:oca:want-1-builder-x' });
  const r1 = await host.turn({ sessionKey: 'agent:oca:want-1-builder-x', message: 'build', idempotencyKey: 'b:1' });
  // the engine stops, the turn finishes on disk without the engine hearing it
  await host.close();
  fake.threads.get(s.threadId).turns.at(-1).status = 'completed';
  fake.threads.get(s.threadId).turns.at(-1).items.push({ type: 'agentMessage', id: 'x', text: 'built ```oca\n{"status":"done","summary":"ok"}\n```', completedAtMs: Date.now() });
  host = codexHost(pool, fake); await host.init();
  const w1 = await host.wait('b:1', { timeoutMs: 0 });
  assert.equal(w1.status, 'ok'); assert.match(w1.terminalReply.text, /built/);
  assert.equal((await host.wait('b:1')).status, 'ok', 'and stays taken');

  // a turn cut off by the server dying is lost, and says so
  const r2 = await host.turn({ sessionKey: 'agent:oca:want-1-builder-x', message: 'more', idempotencyKey: 'b:2' });
  fake.crash();
  await new Promise(r => setTimeout(r, 20));
  const w2 = await host.wait('b:2', { timeoutMs: 0 });
  assert.equal(w2.status, 'error'); assert.equal(w2.stopReason, 'lost');
  // and the next turn starts a fresh server
  const r3 = await host.turn({ sessionKey: 'agent:oca:want-1-builder-x', message: 'continue', idempotencyKey: 'b:3' });
  assert.ok(r3.turnId); assert.equal(fake.conns.length, 3);
  assert.ok(r1 && r2);
  await host.close();
}));

test('Codex not signed in to ChatGPT means no agent can run (never a metered key)', async () => database(async pool => {
  const host = codexHost(pool, fakeCodex({ signedIn: false })); await host.init();
  assert.equal(await host.available(), false);
  assert.match(host.status().why, /not signed in/);
  await host.close();
}));

test('interrupting an agent stops the turn in flight', async () => database(async pool => {
  const fake = fakeCodex();
  const host = codexHost(pool, fake); await host.init();
  await host.createSession({ key: 'agent:oca:want-2-executor-y' });
  await host.turn({ sessionKey: 'agent:oca:want-2-executor-y', message: 'act', idempotencyKey: 'e:1' });
  assert.deepEqual(await host.abort('agent:oca:want-2-executor-y'), { ok: true, interrupted: 1 });
  const w = await host.wait('e:1', { timeoutMs: 1000 });
  assert.equal(w.status, 'error'); assert.equal(w.stopReason, 'interrupted');
  await host.close();
}));

test('the app-server gets Aside and Apple, and the engine\'s own MCP server is switched off inside its agents', async () => {
  const args = appServerArgs({ effort: 'high', disableServers: ['oca'] });
  assert.ok(args.some(a => /mcp_servers\.aside\.command/.test(a)));
  assert.ok(args.some(a => /mcp_servers\.apple\.command/.test(a)));
  assert.ok(args.includes('mcp_servers.oca.enabled=false'));
  assert.ok(args.includes('model_reasoning_effort="high"'));
  const dir = await mkdtemp(join(tmpdir(), 'codex-config-'));
  const cfg = join(dir, 'config.toml');
  await (await import('node:fs/promises')).writeFile(cfg, `[mcp_servers.oca]\ncommand = "node"\nargs = ["/Users/quinnodonnell/oneiro/oca-cognitive/mcp/server.js"]\n\n[mcp_servers.linear]\nurl = "https://mcp.linear.app"\n`);
  assert.deepEqual(await engineMcpServersIn(cfg), ['oca']);
});

// A T3 host command in memory: threads in a project, runs that finish when the test says.
function fakeT3() {
  const threads = new Map(); let n = 0; const calls = [];
  const run = async (args, { input } = {}) => {
    calls.push(args);
    const [group, cmd] = args;
    if (group === 'project' && cmd === 'add') return { ok: true };
    if (group !== 'thread') throw new Error('unexpected');
    if (cmd === 'list') return [...threads.values()].map(t => ({ threadId: t.id, title: t.title, updatedAt: t.updatedAt, link: `t3://${t.id}` }));
    if (cmd === 'start') {
      const id = `mcp:t${++n}`; const t = { id, title: args[args.indexOf('--title') + 1], provider: args[args.indexOf('--provider') + 1], messages: [], runs: 0, activeRunId: null, updatedAt: new Date().toISOString() };
      threads.set(id, t);
      const runId = `run:thread:${id}:ordinal:${++t.runs}`; t.messages.push({ role: 'user', runId, text: input }); t.activeRunId = runId;
      return { threadId: id, runId, link: `t3://${id}` };
    }
    if (cmd === 'send') {
      const t = threads.get(args[2]); const runId = `run:thread:${t.id}:ordinal:${++t.runs}`;
      t.messages.push({ role: 'user', runId, text: input }); t.activeRunId = runId; t.updatedAt = new Date().toISOString();
      return { threadId: t.id, runId };
    }
    if (cmd === 'show') {
      const t = threads.get(args[2]);
      return { thread: { threadId: t.id, status: t.activeRunId ? 'running' : 'completed', activeRunId: t.activeRunId, latestRunId: `run:thread:${t.id}:ordinal:${t.runs}`, pendingRequestCount: 0, link: `t3://${t.id}` }, messages: t.messages };
    }
    throw new Error('unexpected ' + cmd);
  };
  const answer = (id, text) => { const t = threads.get(id); t.messages.push({ role: 'assistant', runId: t.activeRunId, text }); t.activeRunId = null; t.updatedAt = new Date(Date.now() + 5).toISOString(); };
  const person = (id, said, reply) => { const t = threads.get(id); const runId = `run:thread:${t.id}:ordinal:${++t.runs}`; t.messages.push({ role: 'user', runId, text: said }, { role: 'assistant', runId, text: reply }); t.updatedAt = new Date(Date.now() + 10).toISOString(); };
  return { run, threads, calls, answer, person };
}

test('a pursuit conversation is a T3 Code thread on Codex; what Quinn writes there comes back as his', async () => database(async pool => {
  const dir = await mkdtemp(join(tmpdir(), 't3-project-'));
  const t3 = fakeT3();
  const host = createT3Host({ pool, projectDir: dir, run: t3.run, log: quiet }); await host.init();
  assert.equal(await readFile(join(dir, 'AGENTS.md'), 'utf8'), PROJECT_AGENTS_MD);
  assert.equal(await host.available(), true);
  await host.createSession({ key: 'agent:oca:want-5-talker-z', displayName: '#5 talker · launch' });
  assert.equal(t3.threads.size, 0, 'T3 starts a thread with its first message');
  const r = await host.turn({ sessionKey: 'agent:oca:want-5-talker-z', message: '[thinker] You are the voice', idempotencyKey: 't:0' });
  const t = t3.threads.get(r.threadId);
  assert.equal(t.title, '#5 talker · launch'); assert.equal(t.provider, 'codex');
  assert.deepEqual(await host.wait('t:0'), { status: 'pending' });
  t3.answer(r.threadId, 'Here for #5.');
  assert.deepEqual(await host.wait('t:0'), { status: 'ok', terminalReply: { text: 'Here for #5.' } });
  t3.person(r.threadId, 'Launch is Friday.', 'Noted — Friday.');
  const tr = await host.transcript('agent:oca:want-5-talker-z');
  const said = tr.messages.filter(m => m.role === 'user' && m.runId === null);
  assert.deepEqual(said.map(m => m.text), ['Launch is Friday.']);
  assert.ok(said[0].at > 0);
  assert.equal(tr.messages.at(-1).terminal, true);
  const again = await host.transcript('agent:oca:want-5-talker-z');
  assert.equal(again.messages.find(m => m.text === 'Launch is Friday.').at, said[0].at, 'a run keeps the time it was first seen');
  assert.equal((await host.sessions())[0].key, 'agent:oca:want-5-talker-z');
}));

test('the router puts conversations in T3 Code and work on Codex, and falls back to Codex when T3 Code is closed', async () => database(async pool => {
  const fake = fakeCodex(); const t3 = fakeT3();
  const dir = await mkdtemp(join(tmpdir(), 't3-project-'));
  const t3host = createT3Host({ pool, projectDir: dir, run: t3.run, log: quiet });
  const router = createAgentHost({ pool, codex: codexHost(pool, fake), t3: t3host, log: quiet, t3Kinds: ['talker'] });
  await router.init();
  assert.equal(kindOfKey('agent:oca:want-9-talker-abc'), 'talker');
  assert.equal((await router.createSession({ key: 'agent:oca:want-9-talker-abc', displayName: 't' })).host, 't3');
  assert.equal((await router.createSession({ key: 'agent:oca:want-9-research-abc', displayName: 'r' })).host, 'codex');
  assert.equal(await router.hostOf('agent:oca:want-9-talker-abc'), 't3');
  // T3 Code closed: a new conversation goes to Codex instead of waiting on a desktop app
  const closed = createT3Host({ pool, projectDir: dir, run: async () => { throw new Error('No running T3 Code server'); }, log: quiet });
  const router2 = createAgentHost({ pool, codex: codexHost(pool, fake), t3: closed, log: quiet });
  assert.equal((await router2.createSession({ key: 'agent:oca:want-9-talker-def', displayName: 't' })).host, 'codex');
  await router.close(); await router2.close();
}));

test('an agent\'s work steps read as one line each for the pursuit chat; unknown items are left out', async () => {
  const { stepOf } = await import('../agent-host/codex-host.js');
  assert.deepEqual(stepOf({ type: 'commandExecution', command: 'ls -la', aggregatedOutput: 'a\nb', exitCode: 0, status: 'completed' }), { kind: 'command', text: 'ls -la', detail: 'a\nb', status: 'done' });
  assert.equal(stepOf({ type: 'commandExecution', command: 'false', exitCode: 1, status: 'completed' }).status, 'failed');
  assert.equal(stepOf({ type: 'fileChange', changes: [{ path: 'brief.md', kind: { type: 'add' } }], status: 'inProgress' }).text, 'add brief.md');
  assert.equal(stepOf({ type: 'fileChange', changes: [] }), null);
  assert.equal(stepOf({ type: 'mcpToolCall', server: 'aside', tool: 'repl', result: { content: [{ text: 'ok' }] }, status: 'completed' }).text, 'aside.repl');
  assert.equal(stepOf({ type: 'webSearch', query: 'piano teachers near me' }).kind, 'search');
  assert.equal(stepOf({ type: 'reasoning', summary: [] }), null);
  assert.equal(stepOf({ type: 'somethingNew' }), null);
});
