import test from 'node:test';
import assert from 'node:assert/strict';
import { macNotify, noteAppListening, appIsListening, resetAppListening, appListenerMiddleware, APP_LISTEN_MS } from '../channels/mac-notify.js';

test('the engine leaves Mac notifications to the app while the app is listening, and takes them back when it stops', async () => {
  resetAppListening();
  const shown = [];
  const exec = async (cmd, args) => { shown.push([cmd, args[1]]); };
  const t0 = 1_800_000_000_000;

  // 1. no app: an AppleScript banner, as before
  assert.equal(await macNotify({ title: 'Oneiro needs you', body: 'Sign in to x.com in Aside' }, { exec, now: () => t0 }), 'banner');
  assert.equal(shown.length, 1); assert.match(shown[0][1], /Sign in to x\.com in Aside/);

  // 2. the app polls with the notifier header: the engine stays quiet, the app posts it (and it opens the ask)
  let nexted = 0;
  appListenerMiddleware({ headers: { 'x-oneiro-notifier': 'App' } }, {}, () => { nexted++; });
  assert.equal(nexted, 1, 'the middleware never blocks a request');
  assert.ok(appIsListening());
  noteAppListening(t0);
  assert.equal(await macNotify({ body: 'A deliverable is waiting' }, { exec, now: () => t0 + 1000 }), 'app');
  assert.equal(shown.length, 1, 'nothing shows twice');

  // 3. other requests don't count as the app listening
  resetAppListening();
  appListenerMiddleware({ headers: {} }, {}, () => {});
  assert.equal(appIsListening(), false);

  // 4. the app went quiet (quit, asleep): banners come back on their own
  noteAppListening(t0);
  assert.equal(await macNotify({ body: 'later' }, { exec, now: () => t0 + APP_LISTEN_MS + 1 }), 'banner');
  assert.equal(shown.length, 2);
  resetAppListening();
});
