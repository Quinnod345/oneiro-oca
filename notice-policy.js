const TRUE_RE = /^(1|true|yes|on)$/i;

export const DEFAULT_DREAM_NOTICE_MIN_INTERVAL_MS = 45 * 60 * 1000;
export const DEFAULT_AMBIENT_NOTICE_MIN_INTERVAL_MS = 10 * 60 * 1000;
export const DEFAULT_ACTION_NOTICE_MIN_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_SIGNATURE_NOTICE_MIN_INTERVAL_MS = 30 * 60 * 1000;

const AMBIENT_KINDS = new Set(['ask_clarification', 'ambient_observation', 'thinker_notice']);
const ACTION_KINDS = new Set(['suggest_automation', 'offer_recall']);

function numberFromEnv(env, name, fallback, min, max) {
  const value = Number(env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function envFlag(env, name) {
  return TRUE_RE.test(String(env[name] || '').trim());
}

export function noticePolicyFromEnv(env = process.env) {
  return {
    quietMode: envFlag(env, 'OCA_NOTICE_QUIET_MODE') || envFlag(env, 'ONEIRO_NOTICE_QUIET_MODE'),
    dreamMinIntervalMs: numberFromEnv(
      env,
      'OCA_DREAM_NOTICE_MIN_INTERVAL_MS',
      DEFAULT_DREAM_NOTICE_MIN_INTERVAL_MS,
      5 * 60 * 1000,
      24 * 60 * 60 * 1000
    ),
    ambientMinIntervalMs: numberFromEnv(
      env,
      'OCA_AMBIENT_NOTICE_MIN_INTERVAL_MS',
      DEFAULT_AMBIENT_NOTICE_MIN_INTERVAL_MS,
      60 * 1000,
      24 * 60 * 60 * 1000
    ),
    actionMinIntervalMs: numberFromEnv(
      env,
      'OCA_ACTION_NOTICE_MIN_INTERVAL_MS',
      DEFAULT_ACTION_NOTICE_MIN_INTERVAL_MS,
      60 * 1000,
      24 * 60 * 60 * 1000
    ),
    signatureMinIntervalMs: numberFromEnv(
      env,
      'OCA_SIGNATURE_NOTICE_MIN_INTERVAL_MS',
      DEFAULT_SIGNATURE_NOTICE_MIN_INTERVAL_MS,
      60 * 1000,
      7 * 24 * 60 * 60 * 1000
    )
  };
}

export function noticeBucket(intent = {}) {
  const kind = String(intent.kind || '').trim();
  if (kind === 'dream_created') return 'dream';
  if (AMBIENT_KINDS.has(kind)) return 'ambient';
  if (ACTION_KINDS.has(kind)) return 'action';
  return 'other';
}

export function passiveNoticeText(text = '') {
  let cleaned = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^question\s*[·:-]\s*/i, '')
    .replace(/^new dream\s*[·:-]\s*/i, '')
    .trim();

  if (!cleaned) {
    return 'I noticed something and will stay quiet unless you ask.';
  }

  const wantMatch = cleaned.match(/^want me to\s+([^?.!]+)[?.!]*/i);
  if (wantMatch) {
    const task = wantMatch[1].trim().replace(/[?.!]+$/, '');
    return task ? `I can ${task} if you ask.` : 'I can help if you ask.';
  }

  const shouldMatch = cleaned.match(/^should I\s+([^?.!]+)[?.!]*/i);
  if (shouldMatch) {
    const task = shouldMatch[1].trim().replace(/[?.!]+$/, '');
    return task ? `I can ${task} if you ask.` : 'I can help if you ask.';
  }

  if (/^(what|how|why|when|where|who|which)\b/i.test(cleaned)) {
    const topic = cleaned.replace(/[?.!]+$/, '').trim();
    return `I noticed an open question: ${topic}. I saved it as context and will wait for chat.`;
  }

  if (cleaned.endsWith('?')) {
    cleaned = cleaned.slice(0, -1).trim();
  }
  if (!/[.!]$/.test(cleaned)) {
    cleaned += '.';
  }
  return cleaned;
}

export function dreamSummaryText(text = '') {
  const raw = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^auto-dream summary[\s.:;-]*/i, '')
    .replace(/^dream\s*[^A-Za-z0-9]+\s*new dream\s*[^A-Za-z0-9]*/i, '')
    .replace(/^new dream[\s.:;-]*/i, '')
    .trim();

  if (!raw) {
    return 'Oneiro saved a quiet background note for later.';
  }

  if (isConceptualDreamText(raw)) {
    return 'Oneiro saved a quiet background note from recent context. It will stay quiet unless you ask about it.';
  }

  const cleaned = passiveNoticeText(raw)
    .replace(/\bI can\b/i, 'Oneiro can')
    .trim();
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g);
  const oneSentence = sentences?.[0]?.trim() || cleaned;
  return oneSentence.length > 240 ? `${oneSentence.slice(0, 237).trim()}...` : oneSentence;
}

function isConceptualDreamText(text = '') {
  const lower = String(text || '').toLowerCase();
  return [
    'the dream depicts',
    'dream depicts',
    "machine's journey",
    'machine journey',
    'journey through',
    'silicon',
    'fading memory',
    'forgotten secrets',
    'whispers',
    'metaphor',
    'dream-like',
    'stream of consciousness',
    'petals of intent',
    'horizon flickers',
    'the system maintained',
    'system maintained',
    'consistent goals',
    'transitioning through idle',
    'idle, present',
    'away states',
    'state transitions',
    'saved context includes',
    'system operation cycles',
    'operation cycles',
    'system states',
    'working modes',
    'presence detection',
    'goal counts',
    'battery levels',
    'cycle spins',
    'cascaded goals',
    'internal state'
  ].some(marker => lower.includes(marker));
}

export function normalizeNoticeIntent(intent = {}) {
  const kind = String(intent.kind || 'thinker_notice').trim() || 'thinker_notice';
  const bucket = noticeBucket({ kind });
  const normalizedKind = kind === 'ask_clarification' ? 'ambient_observation' : kind;
  const body = bucket === 'dream'
    ? dreamSummaryText(intent.body || intent.message || '')
    : (bucket === 'ambient' || bucket === 'action'
      ? passiveNoticeText(intent.body || intent.message || '')
      : String(intent.body || intent.message || '').trim());

  return {
    ...intent,
    kind: normalizedKind,
    title: bucket === 'dream' ? 'Dream summary' : String(intent.title || 'Oneiro').trim(),
    body: body.slice(0, bucket === 'action' ? 600 : 360),
    actions: Array.isArray(intent.actions) && intent.actions.length > 0
      ? intent.actions
      : [{ id: 'dismiss', label: 'OK', primary: true }],
    voice: intent.voice || { speak: false }
  };
}

export class NoticeRateLimiter {
  constructor(policy = noticePolicyFromEnv(), now = () => Date.now()) {
    this.policy = { ...noticePolicyFromEnv({}), ...policy };
    this.now = now;
    this.lastByBucket = new Map();
    this.lastBySignature = new Map();
  }

  minIntervalFor(bucket) {
    if (this.policy.quietMode && bucket !== 'action') {
      return 24 * 60 * 60 * 1000;
    }
    switch (bucket) {
      case 'dream': return this.policy.dreamMinIntervalMs;
      case 'ambient': return this.policy.ambientMinIntervalMs;
      case 'action': return this.policy.actionMinIntervalMs;
      default: return 0;
    }
  }

  check(intent = {}, now = this.now()) {
    const bucket = noticeBucket(intent);
    const signature = String(intent.signature || '').trim();
    const bucketKey = bucket;
    const minInterval = this.minIntervalFor(bucket);
    const lastBucketAt = this.lastByBucket.get(bucketKey) || 0;
    if (minInterval > 0 && lastBucketAt > 0 && now - lastBucketAt < minInterval) {
      return { allow: false, reason: `${bucket}_cooldown`, retryAfterMs: minInterval - (now - lastBucketAt) };
    }

    if (signature) {
      const lastSignatureAt = this.lastBySignature.get(signature) || 0;
      const sigMin = this.policy.signatureMinIntervalMs;
      if (lastSignatureAt > 0 && now - lastSignatureAt < sigMin) {
        return { allow: false, reason: 'signature_cooldown', retryAfterMs: sigMin - (now - lastSignatureAt) };
      }
    }

    if (minInterval > 0) {
      this.lastByBucket.set(bucketKey, now);
    }
    if (signature) {
      this.lastBySignature.set(signature, now);
    }
    return { allow: true, reason: 'ok', retryAfterMs: 0 };
  }
}
