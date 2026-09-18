// Hunger is pressure from a valued, unsatisfied outcome — not a reward for generating text.
// Persistent inputs live with the want; all transitions are pure and time-based, never tick-based.
import { isDeepStrictEqual } from 'node:util';
import { normalizeEvidence } from '../reasoning/loop.js';
const clamp = n => Math.max(0, Math.min(1, n));

export function createWant({ description, doneWhen, value = 0.7, now = Date.now() }) {
  if (![description, doneWhen].every(s => typeof s === 'string' && s.trim())) throw new Error('a want needs a description and an observable satisfaction criterion');
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('want value must be in [0, 1]');
  return { version: 1, description, doneWhen, value, createdAt: now, lastProgressAt: now,
    progress: 0, attempts: 0, failedAttempts: 0, strategy: 0, receipts: [], status: 'active' };
}
export function appetite(want, now = Date.now()) {
  if (!want || want.status === 'sated' || want.status === 'cancelled') {
    return { pressure: 0, frustration: 0, mode: want?.status || 'idle', strategy: null };
  }
  const gap = 1 - clamp(want.progress || 0);
  const ageHours = Math.max(0, now - want.lastProgressAt) / 3600000;
  const persistence = 1 - Math.exp(-ageHours / 8);
  const frustration = clamp((want.failedAttempts || 0) / 3);
  const strategies = ['inspect_missing_evidence', 'test_an_alternative', 'reduce_to_smallest_falsifiable_step'];
  return { pressure: clamp(want.value * gap * (0.65 + 0.35 * persistence)), gap,
    frustration, mode: frustration >= 2 / 3 ? 'change_strategy' : 'pursue',
    strategy: strategies[(want.strategy || 0) % strategies.length],
    description: want.description, doneWhen: want.doneWhen };
}
export function recordAttempt(want, { result, now = Date.now() }) {
  // A plan, thought, successful model response, or quiet pass does NOT feed hunger.
  const stalled = ['stalled', 'failed', 'budget'].includes(result);
  return { ...want, attempts: want.attempts + 1,
    failedAttempts: want.failedAttempts + (stalled ? 1 : 0),
    strategy: want.strategy + (stalled ? 1 : 0), lastAttemptAt: now };
}
export function recordOutcome(want, { receiptId, progress, evidence, criterionMet = false, usefulness = null, now = Date.now() }) {
  if (want.status === 'cancelled') throw new Error('cancelled wants do not accept outcomes');
  const observations = normalizeEvidence(evidence);
  if (typeof receiptId !== 'string' || !receiptId.trim() || receiptId.length > 200 || !observations.length) throw new Error('outcome requires a receipt ID and observed evidence');
  if (!Number.isFinite(progress) || progress < 0 || progress > 1 || typeof criterionMet !== 'boolean') throw new Error('invalid observed progress');
  if ((progress === 1) !== criterionMet) throw new Error('full satisfaction requires explicit criterionMet and progress 1');
  if (usefulness !== null && (!Number.isFinite(usefulness) || usefulness < 0 || usefulness > 1)) throw new Error('observed usefulness must be in [0, 1]');
  const receipt = { receiptId, progress, evidence: observations, criterionMet };
  if (usefulness !== null) receipt.usefulness = usefulness;
  const existing = want.receipts.find(r => r.receiptId === receiptId);
  if (existing) {
    const { at, ...old } = existing;
    if (!isDeepStrictEqual(old, receipt)) throw new Error('receipt ID already names a different outcome');
    return want;
  }
  if (want.receipts.length >= 100) throw new Error('want receipt budget exhausted');
  const improved = progress > want.progress;
  return { ...want, progress, status: criterionMet ? 'sated' : 'active',
    failedAttempts: improved ? 0 : want.failedAttempts + 1,
    strategy: improved ? want.strategy : want.strategy + 1,
    lastProgressAt: improved ? now : want.lastProgressAt,
    receipts: [...want.receipts, { ...receipt, at: now }] };
}
