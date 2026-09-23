import test from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from '../gateway.js';

test('CLI calls queue behind a concurrency limit instead of starving each other', async () => {
  let running = 0, peak = 0;
  const runner = async () => { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 20)); running--; return '{"ok":true}'; };
  const g = createGateway({ runner, concurrency: 2, log: { warn() {} } });
  await Promise.all(Array.from({ length: 7 }, (_, i) => g.call('sessions.list', { i })));
  assert.equal(peak, 2);
});

test('the gateway is available when anything answered lately; otherwise its own /startupz says so — one failed check is not an outage, two are', async () => {
  let mode = 'up', checks = 0;
  const fetchImpl = async url => { checks++; assert.match(url, /\/startupz$/); if (mode === 'down') throw new Error('ECONNREFUSED'); return { status: mode === 'draining' ? 503 : 200 }; };
  const g = createGateway({ runner: async () => '{"ok":true}', fetchImpl, log: { warn() {} } });
  await g.call('chat.history', { sessionKey: 'x' });
  mode = 'down';
  assert.equal(await g.available(), true, 'a recent answer counts'); assert.equal(checks, 0, 'no check needed');
  const realNow = Date.now; let t = realNow() + 121_000; Date.now = () => t;
  try {
    assert.equal(await g.available(), true, 'one strike'); assert.equal(checks, 1);
    t += 16_000; assert.equal(await g.available(), false, 'two strikes'); assert.equal(checks, 2);
    mode = 'draining'; t += 16_000; assert.equal(await g.available(), false, 'draining is not ready');
    mode = 'up'; t += 16_000; assert.equal(await g.available(), true, 'recovers on the next check');
  } finally { Date.now = realNow; }
});

test('transcript preserves active-run and reply identity metadata alongside current and legacy queues', async () => {
  let raw = { messages: [
    { role: 'assistant', content: [{ type: 'text', text: 'progress' }], timestamp: 123, openclawStreamFallback: true,
      stopReason: 'stop', idempotencyKey: 'deployment:6', __openclaw: { runId: 'restarted-run' }, channel: 'commentary' },
    { role: 'toolResult', content: 'not a reply', timestamp: 124 },
  ], inFlightRun: { runId: 'deployment:6' }, sessionInfo: { hasActiveRun: false, status: 'idle' } };
  const gateway = createGateway({ runner: async () => JSON.stringify(raw) });
  for (const [pendingInputs, expected] of [[{ items: [{ runId: 'deployment:7' }], total: 1 }, 1],
    [{ items: [], total: 3 }, 3], [{ items: [{}], total: 0 }, 1], [[{}], 1], [[], 0], [{ items: [], total: 0 }, 0], [undefined, 0]]) {
    raw.pendingInputs = pendingInputs;
    const t = await gateway.transcript('session');
    assert.equal(t.pending, expected); assert.equal(t.active, true); assert.equal(t.activeRunId, 'deployment:6');
    assert.deepEqual(t.messages, [{ role: 'assistant', text: 'progress', at: 123, runId: 'restarted-run',
      idempotencyKey: 'deployment:6', streamFallback: true, channel: 'commentary', terminal: null }]);
  }
  raw = { messages: [{ role: 'assistant', content: 'legacy final', timestamp: 125 }], pendingInputs: [] };
  const t = await gateway.transcript('session');
  assert.equal(t.active, false); assert.equal(t.activeRunId, null); assert.equal(t.pending, 0);
  assert.equal(t.messages[0].streamFallback, false);
  assert.deepEqual(await gateway.history('session'), t.messages);
});
