// The engine's MCP server: what a coding agent can see and do, and what it can never do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { TOOLS, READ_TOOLS, createHandlers, handle, insideEngine } from '../mcp/server.js';

// The engine's HTTP API in memory: records every call, answers from a little state.
function fakeEngine(state = {}) {
  const calls = [];
  const s = { asks: [{ id: 5, kind: 'question', payment: false }, { id: 6, kind: 'question', payment: true }], wants: [{ id: 27, description: 'Grow InnerEcho', status: 'awaiting_evidence' }], ...state };
  const reply = (method, path, body) => {
    calls.push([method, path, body]);
    if (path === '/oca/inbox') return { wants: s.wants, asks: s.asks, artifacts: [] };
    if (path === '/oca/health') return { ok: true };
    if (path === '/oca/agent-host') return { codex: { up: true, signedIn: true }, t3: { up: true }, available: true };
    if (path.startsWith('/oca/inbox/draft/')) return { draftId: 'd1', status: 'ready', draft: { description: { value: 'Call my brother monthly' } } };
    if (path === '/oca/inbox/draft') return { accepted: true, draftId: 'd1', status: 'drafting' };
    if (path.startsWith('/oca/inbox/want/') && path.endsWith('/talker')) return { id: '11111111-1111-1111-1111-111111111111', status: 'standing' };
    if (/\/oca\/agents\/[^/]+\/link$/.test(path)) return { app: 'T3 Code', url: 't3://thread' };
    return { ok: true };
  };
  return { calls, get: async p => reply('GET', p), post: async (p, b = {}) => reply('POST', p, b) };
}
const call = async (h, name, args = {}, ctx = { engineThread: false }) => handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, h, ctx);

test('it speaks MCP: initialize, tools with schemas, unknown tools and methods are errors', async () => {
  const h = createHandlers(fakeEngine());
  const init = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, h);
  assert.equal(init.result.protocolVersion, '2025-06-18'); assert.equal(init.result.serverInfo.name, 'oca'); assert.ok(init.result.capabilities.tools);
  const list = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, h, { engineThread: false });
  assert.equal(list.result.tools.length, TOOLS.length);
  for (const t of list.result.tools) { assert.match(t.name, /^oca_[a-z_]+$/); assert.equal(t.inputSchema.type, 'object'); assert.ok(t.description.length > 20); }
  assert.ok(!TOOLS.some(t => /approve|payment_decide|pay/.test(t.name)), 'no tool decides a payment');
  assert.equal((await call(h, 'nope')).error.code, -32602);
  assert.equal((await handle({ jsonrpc: '2.0', id: 3, method: 'resources/list' }, h)).error.code, -32601);
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, h), null, 'notifications get no reply');
});

test('reading: status, inbox, pursuits, one pursuit with its trace, agents and an agent\'s thread', async () => {
  const e = fakeEngine(); const h = createHandlers(e);
  const st = await call(h, 'oca_status');
  assert.equal(st.result.structuredContent.agents.available, true); assert.equal(st.result.structuredContent.wants[0].id, 27);
  await call(h, 'oca_pursuit', { pursuit: 27, trace: true });
  assert.ok(e.calls.some(c => c[1] === '/oca/orchestra/27') && e.calls.some(c => c[1] === '/oca/trace/27'));
  await call(h, 'oca_agents', { pursuit: 27, live: true });
  assert.ok(e.calls.some(c => c[1] === '/oca/agents?chainId=27&live=1'));
  const a = await call(h, 'oca_agent', { agent: '11111111-1111-1111-1111-111111111111' });
  assert.deepEqual(a.result.structuredContent.open, { app: 'T3 Code', url: 't3://thread' });
  const bad = await call(h, 'oca_agent', { agent: '../../etc' });
  assert.equal(bad.result.isError, true); assert.match(bad.result.content[0].text, /uuid/);
});

test('speaking for Quinn is tagged as relayed through MCP; a payment ask can never be answered here', async () => {
  const e = fakeEngine(); const h = createHandlers(e);
  await call(h, 'oca_say', { agent: '11111111-1111-1111-1111-111111111111', words: 'Use the US store.' });
  const say = e.calls.find(c => c[1].endsWith('/say'));
  assert.equal(say[2].text, 'Use the US store.'); assert.match(say[2].via, /\(MCP\)$/);
  await call(h, 'oca_answer_ask', { ask: 5, words: 'the second caption' });
  assert.ok(e.calls.some(c => c[1] === '/oca/inbox/asks/5/answer' && /\(MCP\)$/.test(c[2].via)));
  const pay = await call(h, 'oca_answer_ask', { ask: 6, words: 'yes' });
  assert.equal(pay.result.isError, true); assert.match(pay.result.content[0].text, /code Quinn texts back from his phone/);
  assert.ok(!e.calls.some(c => c[1] === '/oca/inbox/asks/6/answer'), 'never sent to the engine');
  const done = await call(createHandlers(fakeEngine({ asks: [{ id: 7, kind: 'finish', payment: false }] })), 'oca_answer_ask', { ask: 7, words: 'yes' });
  assert.equal(done.result.isError, true); assert.match(done.result.content[0].text, /Only Quinn can say so/, 'a finish line is his to confirm');
  assert.equal((await call(h, 'oca_answer_ask', { ask: 99, words: 'x' })).result.isError, true);
  assert.equal((await call(h, 'oca_say', { agent: '11111111-1111-1111-1111-111111111111', words: '   ' })).result.isError, true, 'nothing to relay is refused');
  await call(h, 'oca_progress', { pursuit: 27, progress: 0.4, observation: 'first paying subscriber' });
  assert.match(e.calls.find(c => c[1] === '/oca/inbox/progress')[2].observation, /relayed via .* \(MCP\)/);
  assert.equal((await call(h, 'oca_rate', { kind: 'artifact', item: '27/brief.md', verdict: 'brilliant' })).result.isError, true);
});

test('a new want: a loose request is drafted, then confirmed; agents are sent and stopped on his say-so; a conversation opens', async () => {
  const e = fakeEngine(); const h = createHandlers(e);
  const d = await call(h, 'oca_draft_want', { request: 'help me stay in touch with my brother' });
  assert.equal(d.result.structuredContent.status, 'ready');
  assert.match(e.calls.find(c => c[1] === '/oca/inbox/draft')[2].clientRequestId, /^[0-9a-f-]{36}$/);
  await call(h, 'oca_confirm_want', { draft: 'd1', stakes: [{ entityKey: 'person:brother' }] });
  assert.deepEqual(e.calls.find(c => c[1] === '/oca/inbox/want')[2], { draftId: 'd1', stakes: [{ entityKey: 'person:brother' }], by: 'quinn' });
  await call(h, 'oca_send_agent', { pursuit: 27, kind: 'research', task: 'Find three ways to keep a monthly call' });
  assert.ok(e.calls.some(c => c[1] === '/oca/inbox/want/27/deploy' && c[2].kind === 'research'));
  assert.equal((await call(h, 'oca_send_agent', { pursuit: 27, kind: 'builder', task: 'x' })).result.isError, true, 'builders are the engine\'s own');
  const conv = await call(h, 'oca_conversation', { pursuit: 27 });
  assert.equal(conv.result.structuredContent.open.app, 'T3 Code');
  await call(h, 'oca_stop_agent', { agent: '11111111-1111-1111-1111-111111111111' });
  assert.ok(e.calls.some(c => c[1].endsWith('/cancel')));
});

test('end to end over stdio against an engine on HTTP; an engine that is down is said plainly', async () => {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/oca/inbox') return res.end(JSON.stringify({ wants: [{ id: 3, description: 'Ship the site' }], asks: [] }));
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = async (engineUrl, msgs) => {
    const child = spawn(process.execPath, [new URL('../mcp/server.js', import.meta.url).pathname], { env: { ...process.env, OCA_ENGINE_URL: engineUrl }, stdio: ['pipe', 'pipe', 'inherit'] });
    const out = []; const rl = createInterface({ input: child.stdout });
    const got = new Promise(resolve => rl.on('line', l => { out.push(JSON.parse(l)); if (out.length === msgs.filter(m => m.id !== undefined).length) resolve(); }));
    for (const m of msgs) child.stdin.write(JSON.stringify(m) + '\n');
    await got; child.kill();
    return out;
  };
  try {
    const [init, list, inbox] = await run(base, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'oca_inbox', arguments: {} } }]);
    assert.equal(init.result.serverInfo.name, 'oca');
    assert.ok(list.result.tools.some(t => t.name === 'oca_pursuits'));
    assert.equal(inbox.result.structuredContent.wants[0].description, 'Ship the site');
    const [down] = await run('http://127.0.0.1:9', [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'oca_inbox', arguments: {} } }]);
    assert.equal(down.result.isError, true); assert.match(down.result.content[0].text, /not reachable .* Is it running\?/);
  } finally { await new Promise(r => server.close(r)); }
});

test('inside one of the engine\'s own threads (a folder under its workspace) it only reads; it never speaks for Quinn', async () => {
  assert.equal(insideEngine('/Users/quinnodonnell/oneiro/runtime/workspace/oneiro-engine', ['/Users/quinnodonnell/oneiro/runtime/workspace']), true, 'a T3 Code conversation');
  assert.equal(insideEngine('/Users/quinnodonnell/oneiro/runtime/workspace', ['/Users/quinnodonnell/oneiro/runtime/workspace']), true, 'a work agent');
  assert.equal(insideEngine('/Users/quinnodonnell/oneiro/runtime/workspace-other', ['/Users/quinnodonnell/oneiro/runtime/workspace']), false);
  assert.equal(insideEngine('/Users/quinnodonnell/oneiro/oca-cognitive', ['/Users/quinnodonnell/oneiro/runtime/workspace']), false, 'Quinn coding on the engine');
  const e = fakeEngine(); const h = createHandlers(e);
  const list = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, h, { engineThread: true });
  assert.deepEqual(list.result.tools.map(t => t.name).sort(), [...READ_TOOLS].sort());
  for (const name of ['oca_say', 'oca_answer_ask', 'oca_rate', 'oca_progress', 'oca_confirm_want', 'oca_send_agent', 'oca_stop_agent', 'oca_draft_want', 'oca_conversation']) {
    const r = await call(h, name, { agent: '11111111-1111-1111-1111-111111111111', ask: 5, words: 'yes', pursuit: 27 }, { engineThread: true });
    assert.equal(r.result.isError, true, name); assert.match(r.result.content[0].text, /can't speak or act for Quinn/);
  }
  assert.ok(!e.calls.some(c => c[0] === 'POST'), 'nothing was sent to the engine');
  assert.equal((await call(h, 'oca_inbox', {}, { engineThread: true })).result.isError, undefined, 'reading still works');
});
