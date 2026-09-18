import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createFallbackReader, getUserActivity } from '../sensory/fallback-reader.js';

test('stalled perception stays unknown while actual HTTP requests remain responsive; one refresh serves concurrent reads', async () => {
  let complete, calls = 0;
  const reader = createFallbackReader({ read: () => { calls++; return new Promise(resolve => { complete = resolve; }); } });
  const server = http.createServer((req, res) => res.end(JSON.stringify({ visual: reader.get('visual'), auditory: reader.get('auditory'), activity: getUserActivity(null, reader) })));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const responses = await Promise.all(Array.from({ length: 4 }, () => fetch(base, { signal: AbortSignal.timeout(1000) }).then(r => r.json())));
    assert.deepEqual(responses, Array.from({ length: 4 }, () => ({ visual: null, auditory: null,
      activity: { idleSeconds: null, frontApp: 'unknown', presence: 'unknown' } })));
    assert.equal(calls, 1);
    complete({ visual: { frontApp: 'Finder' } }); await reader.settled();
    assert.equal(reader.get('visual').frontApp, 'Finder');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('activity derives presence only from fresh observations and never retains an expired app', async () => {
  let time = 100000;
  const reader = createFallbackReader({ now: () => time, read: async () => ({ visual: { frontApp: 'Finder' }, activity: { idleSeconds: 600 } }) });
  assert.equal(getUserActivity(null, reader).presence, 'unknown'); await reader.settled();
  assert.deepEqual(getUserActivity(null, reader), { idleSeconds: 600, frontApp: 'Finder', presence: 'away' });
  assert.equal(getUserActivity('Oneiro', reader).frontApp, 'Oneiro');
  time += 31000;
  assert.deepEqual(getUserActivity(null, reader), { idleSeconds: null, frontApp: 'unknown', presence: 'unknown' });
  for (const bad of [null, undefined, NaN, -1, '600']) {
    assert.equal(getUserActivity(null, { get: () => ({ idleSeconds: bad }) }).presence, 'unknown');
  }
});

test('failed or future/stale fallback samples never become fresh known observations', async () => {
  let time = 100000, fails = false, calls = 0;
  const reader = createFallbackReader({ now: () => time, read: async () => { calls++; if (fails) throw Error('OS query timeout'); return { visual: { frontApp: 'Finder' } }; } });
  assert.equal(reader.get('visual'), null); await reader.settled();
  const stamp = reader.get('visual').timestamp;
  time += 6000; fails = true; reader.get('visual'); await reader.settled();
  assert.equal(reader.get('visual').timestamp, stamp);
  time += 30000; assert.equal(reader.get('visual'), null); await reader.settled();
  time = 99999; assert.equal(reader.get('visual'), null);
  assert.equal(calls, 3);
});
