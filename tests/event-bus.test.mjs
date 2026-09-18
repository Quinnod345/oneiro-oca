import test from 'node:test';
import assert from 'node:assert/strict';

import { fallbackEventForUnsupportedType } from '../event-bus.js';

test('unsupported thinker events are wrapped for durable workspace storage', () => {
  const payload = { text: 'the shelf wants a clock', tags: ['thinker-cycle'] };
  const fallback = fallbackEventForUnsupportedType('thinker.thought', payload);

  assert.equal(fallback.eventType, 'workspace_broadcast');
  assert.deepEqual(fallback.payload, {
    __event_type: 'thinker.thought',
    payload
  });
});
