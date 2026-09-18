const TRUE_RE = /^(1|true|yes|on)$/i;

export const DEFAULT_DREAM_MIN_INTERVAL_MS = 45 * 60 * 1000;
export const DEFAULT_DREAM_PRESENT_MIN_IDLE_SECONDS = 300;
export const DEFAULT_DREAM_MIN_CREATIVE_HUNGER = 0.18;

function numberFromEnv(env, name, fallback, min, max) {
  const value = Number(env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function flagFromEnv(env, ...names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(env, name)) {
      return TRUE_RE.test(String(env[name] || '').trim());
    }
  }
  return false;
}

export function dreamPolicyFromEnv(env = process.env) {
  return {
    autoDreamEnabled: flagFromEnv(env, 'OCA_AUTO_DREAM_ENABLED', 'ONEIRO_AUTO_DREAM_ENABLED'),
    minIntervalMs: numberFromEnv(
      env,
      'OCA_DREAM_MIN_INTERVAL_MS',
      DEFAULT_DREAM_MIN_INTERVAL_MS,
      5 * 60 * 1000,
      24 * 60 * 60 * 1000
    ),
    presentMinIdleSeconds: numberFromEnv(
      env,
      'OCA_DREAM_PRESENT_MIN_IDLE_SECONDS',
      DEFAULT_DREAM_PRESENT_MIN_IDLE_SECONDS,
      30,
      60 * 60
    ),
    minCreativeHunger: numberFromEnv(
      env,
      'OCA_DREAM_MIN_CREATIVE_HUNGER',
      DEFAULT_DREAM_MIN_CREATIVE_HUNGER,
      0,
      1
    )
  };
}

export function shouldRunDream({
  policy,
  now = Date.now(),
  lastDreamAt = 0,
  activity = {},
  mode = 'monitoring',
  creativeHunger = 0,
  dreamCooldown = 0,
  isConsolidating = false
} = {}) {
  const p = policy || dreamPolicyFromEnv();
  if (!p.autoDreamEnabled) return { allow: false, reason: 'auto_dream_off' };
  if (isConsolidating) return { allow: false, reason: 'consolidating' };
  if (dreamCooldown > 0) return { allow: false, reason: 'cycle_cooldown' };
  if (lastDreamAt > 0 && now - lastDreamAt < p.minIntervalMs) {
    return { allow: false, reason: 'wall_clock_cooldown' };
  }
  if (!['consolidating', 'working', 'dormant'].includes(mode)) {
    return { allow: false, reason: 'mode' };
  }
  if (Number(creativeHunger || 0) < p.minCreativeHunger) {
    return { allow: false, reason: 'low_creative_hunger' };
  }
  const presence = activity.presence || 'present';
  const idleSeconds = Number(activity.idleSeconds || 0);
  if (presence === 'present' && idleSeconds < p.presentMinIdleSeconds) {
    return { allow: false, reason: 'user_active' };
  }
  return { allow: true, reason: 'ready' };
}
