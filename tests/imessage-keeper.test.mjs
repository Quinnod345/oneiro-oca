import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createImessageKeeper, portOpen, PAUSED_TITLE, BACK_TITLE } from '../reasoning/imessage-keeper.js';
import { createAsks } from '../reasoning/asks.js';

const silent = { log() {}, warn() {} };

// The gateway as the keeper sees it: the iMessage account's state, and the channel restarts it asks for.
function fakeGateway() {
  const g = { live: true, calls: [], startBringsUp: false,
    async call(method) {
      g.calls.push(method);
      if (method === 'channels.status') return { channelAccounts: { imessage: [{ running: g.live, connected: g.live, lastError: g.live ? null : 'ssh: Operation timed out' }] } };
      if (method === 'channels.start' && g.startBringsUp) g.live = true;
      return { ok: true };
    } };
  return g;
}

test('the work Mac going offline: Quinn hears once that texts are paused, once that they are back, and a restart never re-tells him', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'imessage-'));
  try {
    let now = 0, reachable = false;
    const gateway = fakeGateway(), pushed = [];
    const make = () => createImessageKeeper({ gateway, reachable: async () => reachable, push: async p => { pushed.push(p); },
      statePath: join(dir, 'state.json'), clock: () => now, log: silent, pausedAfterMs: 600_000 });
    const k = make();
    assert.equal(await k.tick(), 'up'); assert.equal(k.ready(), true);

    // down, Mac unreachable: quiet for ten minutes, then one push, and texting is skipped meanwhile
    gateway.live = false;
    assert.equal(await k.tick(), 'down'); assert.equal(k.ready(), false); assert.equal(pushed.length, 0);
    now += 600_000; assert.equal(await k.tick(), 'paused');
    assert.equal(pushed.length, 1); assert.equal(pushed[0].title, PAUSED_TITLE); assert.match(pushed[0].body, /work Mac is offline/);
    now += 180_000; assert.equal(await k.tick(), 'down'); assert.equal(pushed.length, 1, 'told once');
    assert.ok(!gateway.calls.includes('channels.start'), 'no restart while the Mac is unreachable');

    // the engine restarts mid-outage: it remembers it already told him
    const again = make();
    assert.equal(await again.tick(), 'down'); assert.equal(pushed.length, 1);

    // the Mac answers again but the channel gave up: restarted, not more often than every five minutes
    reachable = true;
    assert.equal(await again.tick(), 'restarted');
    assert.deepEqual(gateway.calls.filter(c => c.startsWith('channels.s') && c !== 'channels.status'), ['channels.stop', 'channels.start']);
    now += 60_000; assert.equal(await again.tick(), 'down', 'no second restart inside five minutes');
    gateway.startBringsUp = true; now += 300_000; assert.equal(await again.tick(), 'restarted');

    // back: one push, and the slate is clean
    assert.equal(await again.tick(), 'back'); assert.equal(again.ready(), true);
    assert.equal(pushed.length, 2); assert.equal(pushed[1].title, BACK_TITLE);
    assert.equal(await again.tick(), 'up'); assert.equal(pushed.length, 2);

    // a short blip that never reached the notice is quiet both ways
    gateway.live = false; reachable = false; assert.equal(await again.tick(), 'down');
    gateway.live = true; assert.equal(await again.tick(), 'back'); assert.equal(pushed.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a port that accepts connections reads open; one that does not reads closed', async () => {
  const server = createServer(s => s.end());
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try { assert.equal(await portOpen('127.0.0.1', port, 2000), true); }
  finally { await new Promise(r => server.close(r)); }
  assert.equal(await portOpen('127.0.0.1', port, 2000), false);
});

test('a text that cannot go through the work Mac fails; it is never sent from this Mac instead', async () => {
  const before = process.env.OCA_OPENCLAW_CLI;
  process.env.OCA_OPENCLAW_CLI = '/usr/bin/false';   // the OpenClaw send fails, as it does while the work Mac is offline
  try {
    let ready = true;
    const pool = { query: async sql => (/count\(\*\)/.test(sql) ? { rows: [{ n: 0 }] } : /INSERT INTO notifications/.test(sql) ? { rows: [{ id: 1, created_at: new Date() }] } : { rows: [] }) };
    const asks = createAsks({ pool, imessage: 'quinn@example.com', pushNode: null, notify: false, log: silent, imessageReady: () => ready });
    const failed = await asks.ask({ chainId: 27, kind: 'question', detail: 'Which caption reads better?' });
    assert.deepEqual(failed.delivered, [], 'no fallback delivered it'); assert.match(failed.failed[0], /^imessage: /);
    // and while the keeper knows the line is down, it isn't even tried
    ready = false;
    const skipped = await asks.ask({ chainId: 27, kind: 'question', detail: 'Which headline reads better?' });
    assert.deepEqual(skipped.delivered, []); assert.match(skipped.failed[0], /work Mac is offline/);
  } finally { if (before === undefined) delete process.env.OCA_OPENCLAW_CLI; else process.env.OCA_OPENCLAW_CLI = before; }
});
