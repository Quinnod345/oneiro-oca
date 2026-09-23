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

test('the gateway is available when anything answered lately; one failed probe is not an outage, two are', async () => {
  let mode = 'ok', probes = 0;
  const runner = async args => { if (args[2] === 'health') probes++; if (mode === 'down') throw new Error('timed out'); return '{"ok":true}'; };
  const g = createGateway({ runner, log: { warn() {} } });
  await g.call('chat.history', { sessionKey: 'x' });
  mode = 'down';
  assert.equal(await g.available(), true, 'a recent answer counts'); assert.equal(probes, 0, 'no probe needed');
  // two minutes of silence later: probe, fail once → still up; fail twice → down
  const realNow = Date.now; let t = realNow() + 121_000; Date.now = () => t;
  try {
    assert.equal(await g.available(), true, 'one strike'); assert.equal(probes, 1);
    t += 31_000; assert.equal(await g.available(), false, 'two strikes'); assert.equal(probes, 2);
    mode = 'ok'; t += 31_000; assert.equal(await g.available(), true, 'recovers on the next probe');
  } finally { Date.now = realNow; }
});
