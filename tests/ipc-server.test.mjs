import test from 'node:test';
import assert from 'node:assert/strict';

import { creativeDreamIntentFromOutput, motorActionFromFeedback } from '../ipc-server.js';

test('motor feedback is normalized into repeat-pattern action records', () => {
  const action = motorActionFromFeedback({
    intention: { action: 'click', parameters: { app: 'Finder' } },
    result: { success: true }
  });

  assert.deepEqual(action, { action: 'click', app: 'Finder' });
});

test('motor feedback falls back to observed app when parameters omit app', () => {
  const action = motorActionFromFeedback({
    intention: { action: 'hotkey', parameters: {} },
    pre_state_app: 'Cursor'
  });

  assert.deepEqual(action, { action: 'hotkey', app: 'Cursor' });
});

test('creative dream output becomes a visible dream intent', () => {
  const intent = creativeDreamIntentFromOutput({
    type: 'dream',
    id: 42,
    hasNovel: true,
    connectionCount: 2,
    summary: 'The dream connects the shelf to a warmer toolbar rhythm.',
    excerpt: 'A clock blooms out of the shelf.',
    connections: ['time can become spatial', 'idle state can feel warm']
  });

  assert.equal(intent.kind, 'dream_created');
  assert.equal(intent.source, 'creative');
  assert.equal(intent.signature, 'creative-dream:42');
  assert.equal(intent.title, 'Dream summary');
  assert.match(intent.body, /warmer toolbar rhythm/);
  assert.match(intent.body, /Insight: time can become spatial/);
  assert.deepEqual(intent.actions, [{ id: 'dismiss', label: 'OK', primary: true }]);
});

test('non-dream creative output does not become a dream intent', () => {
  assert.equal(creativeDreamIntentFromOutput({ type: 'connection' }), null);
});
