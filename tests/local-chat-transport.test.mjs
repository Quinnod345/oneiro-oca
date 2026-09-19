import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createLocalChatTransport } from '../local-chat-transport.js';

async function server(t, handler) {
  const instance = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    handler(req, res, JSON.parse(raw));
  });
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => { instance.closeAllConnections(); instance.close(); });
  return `http://127.0.0.1:${instance.address().port}`;
}

test('native route preserves system/user boundaries, schema, residency and bounded context', async t => {
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
  let captured;
  const url = await server(t, (req, res, body) => {
    captured = { path: req.url, body };
    res.end(JSON.stringify({ done: true, done_reason: 'stop', model: 'candidate',
      message: { content: '{"ok":true}', thinking: 'not final output' },
      prompt_eval_count: 20, eval_count: 5, load_duration: 12 }));
  });
  const generate = createLocalChatTransport({ url, model: 'candidate', transport: 'ollama', keepAlive: '-1', contextSize: 8192 });
  const messages = [{ role: 'system', content: 'Respect evidence' }, { role: 'user', content: 'Dry run only' }];
  const result = await generate({ messages, max_tokens: 250, temperature: 0,
    response_format: { type: 'json_schema', json_schema: { schema } } });
  assert.equal(captured.path, '/api/chat');
  assert.deepEqual(captured.body.messages, messages);
  assert.deepEqual(captured.body.format, schema);
  assert.equal(captured.body.keep_alive, -1);
  assert.equal(captured.body.options.num_ctx, 8192);
  assert.equal(captured.body.options.num_predict, 250);
  assert.equal(captured.body.think, false);
  assert.equal(captured.body.truncate, false);
  assert.equal(captured.body.shift, false);
  assert.equal(result.choices[0].message.content, '{"ok":true}');
  assert.equal(result.usage.total_tokens, 25);
  assert.equal(result.timings.load_ns, 12);
});

test('native truncation remains visible and missing final output fails closed', async t => {
  let count = 0;
  const url = await server(t, (req, res) => res.end(JSON.stringify(++count === 1
    ? { done: true, done_reason: 'length', message: { content: '{"ok":' } }
    : { done: true, message: { content: '', thinking: 'only internal text' } })));
  const generate = createLocalChatTransport({ url, model: 'candidate', transport: 'ollama' });
  assert.equal((await generate({ messages: [] })).choices[0].finish_reason, 'length');
  await assert.rejects(generate({ messages: [] }), /Incomplete native inference/);
});

test('request cancellation aborts inference without a hidden retry', async t => {
  let count = 0, received;
  const incoming = new Promise(resolve => { received = resolve; });
  const url = await server(t, () => { count++; received(); });
  const generate = createLocalChatTransport({ url, model: 'candidate', transport: 'ollama' });
  const controller = new AbortController();
  const pending = generate({ messages: [] }, { signal: controller.signal });
  await incoming;
  controller.abort(new Error('pursuit cancelled'));
  await assert.rejects(pending, /pursuit cancelled/);
  assert.equal(count, 1);
});

test('HTTP failure retains the loader diagnosis; OpenAI route remains compatible', async t => {
  let calls = 0;
  const url = await server(t, (req, res, body) => {
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(body.model, 'candidate');
    if (++calls === 1) { res.writeHead(500); res.end('unknown architecture'); }
    else res.end(JSON.stringify({ choices: [{ message: { content: 'READY' } }] }));
  });
  const generate = createLocalChatTransport({ url, model: 'candidate' });
  await assert.rejects(generate({ messages: [] }), /500: unknown architecture/);
  assert.equal((await generate({ messages: [] })).choices[0].message.content, 'READY');
});

test('circuit breaker: three transport failures open the circuit, callers fail fast, a probe reopens it on success', async () => {
  const log = { warned: [] , warn: m => log.warned.push(m) };
  const dead = createLocalChatTransport({ url: 'http://127.0.0.1:1', model: 'm', transport: 'ollama', timeoutMs: 2000, openAfter: 3, openMs: 60_000, log });
  const msgs = { messages: [{ role: 'user', content: 'hi' }] };
  for (let i = 0; i < 3; i++) await assert.rejects(dead(msgs), /fetch failed|ECONN|timed out/i);
  assert.equal(dead.health().state, 'open'); assert.equal(dead.health().consecutiveFailures, 3);
  const t0 = Date.now();
  await assert.rejects(dead(msgs), e => e.code === 'CIRCUIT_OPEN');
  assert.ok(Date.now() - t0 < 500, 'fails fast while open');
  assert.equal(log.warned.filter(m => /circuit open/.test(m)).length, 1, 'opening is logged once');
  // A backend that answers: the half-open probe closes the circuit.
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ model: 'm', created_at: 'x', done: true, done_reason: 'stop', message: { role: 'assistant', content: 'ok' } })); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const live = createLocalChatTransport({ url: `http://127.0.0.1:${port}`, model: 'm', transport: 'ollama', openAfter: 1, openMs: 10, log });
  await assert.rejects(createLocalChatTransport({ url: 'http://127.0.0.1:1', model: 'm', transport: 'ollama', timeoutMs: 1000, openAfter: 1, log })(msgs));
  assert.equal((await live(msgs)).choices[0].message.content, 'ok');
  assert.equal(live.health().state, 'closed');
  server.close();
});

test('a per-call timeout overrides the transport default', async () => {
  const { createServer } = await import('node:http');
  const server = createServer(() => {});   // never answers
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const slow = createLocalChatTransport({ url: `http://127.0.0.1:${server.address().port}`, model: 'm', transport: 'ollama', timeoutMs: 60_000 });
  const t0 = Date.now();
  await assert.rejects(slow({ messages: [{ role: 'user', content: 'hi' }] }, { timeoutMs: 300 }), /timed out/);
  assert.ok(Date.now() - t0 < 2000);
  server.close();
});
