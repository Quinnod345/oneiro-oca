import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createFallbackReader, getUserActivity } from '../sensory/fallback-reader.js';

test('the real default activity reader checks idle time without launching AppleScript or reading the clipboard', async (t) => {
  const commands = [];
  const mocked = t.mock.method(childProcess, 'execFile', (file, args, options, done) => {
    commands.push(file);
    queueMicrotask(() => done(null, file === '/usr/sbin/ioreg' ? '"HIDIdleTime" = 12000000000' : ''));
    return {};
  });
  syncBuiltinESMExports();
  try {
    getUserActivity('Finder');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(getUserActivity('Finder'), { idleSeconds: 12, frontApp: 'Finder', presence: 'present' });
    assert.deepEqual(commands, ['/usr/sbin/ioreg']);
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
});

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
