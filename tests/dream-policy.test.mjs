import test from 'node:test';
import assert from 'node:assert/strict';

import { dreamPolicyFromEnv, shouldRunDream } from '../dream-policy.js';

test('auto dream defaults to off unless the app enables it', () => {
  const policy = dreamPolicyFromEnv({});

  assert.equal(policy.autoDreamEnabled, false);
  assert.equal(policy.minIntervalMs, 45 * 60 * 1000);
  assert.equal(policy.presentMinIdleSeconds, 300);
});

test('dream scheduling refuses active-user five-second loops', () => {
  const policy = dreamPolicyFromEnv({
    OCA_AUTO_DREAM_ENABLED: '1',
    OCA_DREAM_MIN_INTERVAL_MS: String(45 * 60 * 1000),
    OCA_DREAM_PRESENT_MIN_IDLE_SECONDS: '300'
  });
  const base = {
    policy,
    now: 1_000_000,
    lastDreamAt: 0,
    mode: 'working',
    creativeHunger: 0.8,
    dreamCooldown: 0,
    isConsolidating: false
  };

  assert.deepEqual(
    shouldRunDream({ ...base, activity: { presence: 'present', idleSeconds: 12 } }),
    { allow: false, reason: 'user_active' }
  );
  assert.deepEqual(
    shouldRunDream({
      ...base,
      activity: { presence: 'idle', idleSeconds: 240 },
      lastDreamAt: base.now - 5000
    }),
    { allow: false, reason: 'wall_clock_cooldown' }
  );
  assert.deepEqual(
    shouldRunDream({ ...base, activity: { presence: 'idle', idleSeconds: 360 } }),
    { allow: true, reason: 'ready' }
  );
});
