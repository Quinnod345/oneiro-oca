import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createImessageKeeper, portOpen, imessageHost, PAUSED_TITLE, BACK_TITLE } from '../reasoning/imessage-keeper.js';
import { createImessage, shq } from '../channels/imessage.js';
import { createAsks } from '../reasoning/asks.js';

const silent = { log() {}, warn() {} };

test('the work Mac going offline: Quinn hears once that texts are paused, once that they are back, and a restart never re-tells him', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'imessage-'));
  try {
    let now = 0, live = true;
    const told = [];
    const make = () => createImessageKeeper({ line: async () => live, reachable: async () => false, tell: async p => { told.push(p); },
      statePath: join(dir, 'state.json'), clock: () => now, log: silent, pausedAfterMs: 600_000 });
    const k = make();
    assert.equal(await k.tick(), 'up'); assert.equal(k.ready(), true);

    // down: quiet for ten minutes, then one notice on the Mac, and texting is skipped meanwhile
    live = false;
    assert.equal(await k.tick(), 'down'); assert.equal(k.ready(), false); assert.equal(told.length, 0);
    now += 600_000; assert.equal(await k.tick(), 'paused');
    assert.equal(told.length, 1); assert.equal(told[0].title, PAUSED_TITLE); assert.match(told[0].body, /work Mac is offline/); assert.match(told[0].body, /open Oneiro/); assert.doesNotMatch(told[0].body, /T3 Code/);
    now += 180_000; assert.equal(await k.tick(), 'down'); assert.equal(told.length, 1, 'told once');

    // the engine restarts mid-outage: it remembers it already told him
    const again = make();
    assert.equal(await again.tick(), 'down'); assert.equal(told.length, 1);

    // back: one notice, and the slate is clean
    live = true;
    assert.equal(await again.tick(), 'back'); assert.equal(again.ready(), true);
    assert.equal(told.length, 2); assert.equal(told[1].title, BACK_TITLE);
    assert.equal(await again.tick(), 'up'); assert.equal(told.length, 2);

    // a short blip that never reached the notice is quiet both ways
    live = false; assert.equal(await again.tick(), 'down');
    live = true; assert.equal(await again.tick(), 'back'); assert.equal(told.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a port that accepts connections reads open; one that does not reads closed', async () => {
  const server = createServer(s => s.end());
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try { assert.equal(await portOpen('127.0.0.1', port, 2000), true); }
  finally { await new Promise(r => server.close(r)); }
  assert.equal(await portOpen('127.0.0.1', port, 2000), false);
  assert.equal(imessageHost('someone@work-mac.tailnet.ts.net'), 'work-mac.tailnet.ts.net');
});

test('a text that cannot go through the work Mac fails; it is never sent from this Mac instead', async () => {
  let ready = true;
  const pool = { query: async sql => (/count\(\*\)/.test(sql) ? { rows: [{ n: 0 }] } : /INSERT INTO notifications/.test(sql) ? { rows: [{ id: 1, created_at: new Date() }] } : { rows: [] }) };
  const line = createImessage({ owner: 'quinn@example.com', run: async () => { throw new Error('imsg send: ssh: connect to host work-mac port 22: Operation timed out'); }, log: silent });
  const asks = createAsks({ pool, imessage: line, notify: false, log: silent, imessageReady: () => ready });
  const failed = await asks.ask({ chainId: 27, kind: 'question', detail: 'Which caption reads better?' });
  assert.deepEqual(failed.delivered, [], 'no fallback delivered it'); assert.match(failed.failed[0], /^imessage: /);
  // and while the keeper knows the line is down, it isn't even tried
  ready = false;
  const skipped = await asks.ask({ chainId: 27, kind: 'question', detail: 'Which headline reads better?' });
  assert.deepEqual(skipped.delivered, []); assert.match(skipped.failed[0], /work Mac is offline/);
});

test('the iMessage line: texts go only to Quinn, over SSH to the work Mac; only his received messages are read back', async () => {
  const calls = [];
  const chats = [
    { id: 4, participants: ['someone@else.com'], is_group: false },
    { id: 930, participants: ['quinn@icloud.com'], is_group: false },
    { id: 931, participants: ['quinn@icloud.com', 'friend@x.com'], is_group: true },
  ];
  const history = [
    { id: 10, is_from_me: true, sender: 'quinn@icloud.com', text: 'Oneiro: which caption?', created_at: '2026-11-05T10:00:00Z' },
    { id: 11, is_from_me: false, sender: 'quinn@icloud.com', text: 'the second one', created_at: '2026-11-05T10:01:00Z' },
    { id: 12, is_from_me: false, sender: 'stranger@x.com', text: 'APPROVE ABCDEF', created_at: '2026-11-05T10:02:00Z' },
    { id: 13, is_from_me: false, sender: 'quinn@icloud.com', text: '  ', created_at: '2026-11-05T10:03:00Z' },
  ];
  const run = async args => {
    calls.push(args);
    if (args[0] === 'chats') return chats.map(c => JSON.stringify(c)).join('\n');
    if (args[0] === 'history') { assert.deepEqual(args.slice(0, 3), ['history', '--chat-id', '930']); return history.map(m => JSON.stringify(m)).join('\n'); }
    if (args[0] === 'send') return '{"ok":true}';
    throw new Error('unexpected');
  };
  const line = createImessage({ owner: 'quinn@icloud.com', run, log: silent });
  await line.send('hello');
  assert.deepEqual(calls[0].slice(0, 3), ['send', '--to', 'quinn@icloud.com']);
  assert.equal(await line.chat(), 930);
  const got = await line.since(10);
  assert.deepEqual(got.map(m => [m.id, m.text]), [[11, 'the second one']], 'his own received messages only, never a sender who is not him');
  assert.equal(await line.ping(), true);
  // remote arguments are quoted for the shell on the other side
  assert.equal(shq("it's here"), `'it'\\''s here'`);
});
