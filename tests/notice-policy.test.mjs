import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NoticeRateLimiter,
  dreamSummaryText,
  normalizeNoticeIntent,
  noticeBucket,
  noticePolicyFromEnv,
  passiveNoticeText
} from '../notice-policy.js';

test('ask clarification notices become passive ambient observations', () => {
  const intent = normalizeNoticeIntent({
    kind: 'ask_clarification',
    title: 'Oneiro',
    body: 'Want me to pull the notes?',
    signature: 'share:notes'
  });

  assert.equal(intent.kind, 'ambient_observation');
  assert.equal(intent.body, 'I can pull the notes if you ask.');
  assert.deepEqual(intent.actions, [{ id: 'dismiss', label: 'OK', primary: true }]);
  assert.equal(noticeBucket(intent), 'ambient');
});

test('dream notices are one-sentence summaries, not questions', () => {
  const intent = normalizeNoticeIntent({
    kind: 'dream_created',
    title: 'New dream',
    body: 'Should I build a chrome panel? It spirals into five actions.',
    signature: 'dream:panel'
  });

  assert.equal(intent.title, 'Dream summary');
  assert.equal(intent.body, 'Oneiro can build a chrome panel if you ask.');
});

test('dream summaries replace conceptual machine-journey copy with useful context', () => {
  assert.equal(
    dreamSummaryText("Auto-dream summary. The dream depicts a machine's journey through cached voltage and forgotten secrets."),
    'Oneiro saved a quiet background note from recent context. It will stay quiet unless you ask about it.'
  );
});

test('dream summaries replace internal state telemetry with useful context', () => {
  assert.equal(
    dreamSummaryText('The system maintained nine consistent goals while transitioning through idle, present, and away states.'),
    'Oneiro saved a quiet background note from recent context. It will stay quiet unless you ask about it.'
  );
});

test('dream summaries replace system operation telemetry with useful context', () => {
  assert.equal(
    dreamSummaryText('The saved context includes multiple system operation cycles characterized by changes in system states (alert and working modes), presence detection status, goal counts, and battery levels.'),
    'Oneiro saved a quiet background note from recent context. It will stay quiet unless you ask about it.'
  );
});

test('notice limiter suppresses dream loops and repeated signatures', () => {
  let now = 1_000;
  const limiter = new NoticeRateLimiter({
    dreamMinIntervalMs: 45 * 60 * 1000,
    ambientMinIntervalMs: 10 * 60 * 1000,
    actionMinIntervalMs: 5 * 60 * 1000,
    signatureMinIntervalMs: 60 * 60 * 1000
  }, () => now);

  const dream = { kind: 'dream_created', signature: 'dream:a' };
  assert.equal(limiter.check(dream).allow, true);
  now += 5_000;
  assert.deepEqual(
    limiter.check({ kind: 'dream_created', signature: 'dream:b' }),
    { allow: false, reason: 'dream_cooldown', retryAfterMs: (45 * 60 * 1000) - 5_000 }
  );

  now += 45 * 60 * 1000;
  assert.equal(limiter.check(dream).reason, 'signature_cooldown');
});

test('dream notice cadence follows app-provided environment policy', () => {
  const policy = noticePolicyFromEnv({
    OCA_DREAM_NOTICE_MIN_INTERVAL_MS: String(2 * 60 * 60 * 1000),
    OCA_AMBIENT_NOTICE_MIN_INTERVAL_MS: String(15 * 60 * 1000),
    OCA_ACTION_NOTICE_MIN_INTERVAL_MS: String(7 * 60 * 1000),
    OCA_SIGNATURE_NOTICE_MIN_INTERVAL_MS: String(90 * 60 * 1000)
  });

  assert.equal(policy.dreamMinIntervalMs, 2 * 60 * 60 * 1000);
  assert.equal(policy.ambientMinIntervalMs, 15 * 60 * 1000);
  assert.equal(policy.actionMinIntervalMs, 7 * 60 * 1000);
  assert.equal(policy.signatureMinIntervalMs, 90 * 60 * 1000);

  let now = 100_000;
  const limiter = new NoticeRateLimiter(policy, () => now);
  assert.equal(limiter.check({ kind: 'dream_created', signature: 'dream:one' }).allow, true);
  now += 45 * 60 * 1000;
  assert.deepEqual(
    limiter.check({ kind: 'dream_created', signature: 'dream:two' }),
    { allow: false, reason: 'dream_cooldown', retryAfterMs: (2 * 60 * 60 * 1000) - (45 * 60 * 1000) }
  );
});

test('quiet notice mode keeps ambient and dream notices daily without muting action notices', () => {
  let now = 1_000;
  const limiter = new NoticeRateLimiter({
    quietMode: true,
    dreamMinIntervalMs: 5 * 60 * 1000,
    ambientMinIntervalMs: 60 * 1000,
    actionMinIntervalMs: 60 * 1000,
    signatureMinIntervalMs: 60 * 1000
  }, () => now);

  assert.equal(limiter.check({ kind: 'ambient_observation', signature: 'ambient:one' }).allow, true);
  now += 10 * 60 * 1000;
  assert.equal(limiter.check({ kind: 'ambient_observation', signature: 'ambient:two' }).reason, 'ambient_cooldown');

  assert.equal(limiter.check({ kind: 'suggest_automation', signature: 'action:one' }).allow, true);
  now += 2 * 60 * 1000;
  assert.equal(limiter.check({ kind: 'suggest_automation', signature: 'action:two' }).allow, true);
});

test('passive notice text removes open-ended question framing', () => {
  assert.equal(
    passiveNoticeText('Should I create an automation?'),
    'I can create an automation if you ask.'
  );
  assert.equal(
    passiveNoticeText('What should I do about the dream popup loop?'),
    'I noticed an open question: What should I do about the dream popup loop. I saved it as context and will wait for chat.'
  );
});

test('action notices keep actions but make body passive', () => {
  const intent = normalizeNoticeIntent({
    kind: 'suggest_automation',
    title: 'Create automation',
    body: 'Want me to create a morning brief?',
    signature: 'automation:brief',
    actions: [{ id: 'accept', label: 'Create', primary: true }]
  });

  assert.equal(intent.kind, 'suggest_automation');
  assert.equal(intent.body, 'I can create a morning brief if you ask.');
  assert.deepEqual(intent.actions, [{ id: 'accept', label: 'Create', primary: true }]);
  assert.equal(noticeBucket(intent), 'action');
});
