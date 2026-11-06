// Hunger is pressure from a valued, unsatisfied outcome — not a reward for generating text.
// Persistent inputs live with the want; all transitions are pure and time-based, never tick-based.
import { isDeepStrictEqual } from 'node:util';
import { normalizeEvidence } from '../reasoning/loop.js';
import { priceWant, parseEntityKey } from './worth.js';
const clamp = n => Math.max(0, Math.min(1, n));
// Rotation order of the strategies a want spends its budget on (reasoning/strategies.js owns the runners).
export const STRATEGY_NAMES = ['inspect_missing_evidence', 'test_a_prediction', 'imagine_before_acting', 'argue_the_premise', 'propose_an_artifact'];

// A want is for something. Its value is the worth of what it is for, priced from the ledger;
// `value` alone is the legacy explicit priority and stays the fallback when no ledger is wired.
export function createWant({ description, doneWhen, value = 0.7, stakes = null, outcomeKey = null, now = Date.now() }) {
  if (![description, doneWhen].every(s => typeof s === 'string' && s.trim())) throw new Error('a want needs a description and an observable satisfaction criterion');
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('want value must be in [0, 1]');
  const want = { version: 2, description, doneWhen, value, createdAt: now, lastProgressAt: now,
    progress: 0, attempts: 0, failedAttempts: 0, strategy: 0, receipts: [], status: 'active' };
  if (outcomeKey !== null) { parseEntityKey(outcomeKey); want.outcomeKey = outcomeKey; }
  if (stakes !== null) {
    if (!Array.isArray(stakes) || stakes.length > 16) throw new Error('stakes must be an array of at most 16 entries');
    want.stakes = stakes.map(s => {
      parseEntityKey(s?.entityKey);
      const share = s.share === undefined ? 1 : s.share;
      if (!Number.isFinite(share) || share <= 0) throw new Error('a stake share must be positive');
      return { entityKey: s.entityKey, share };
    });
    want.pricing = { value, provenance: 'priority', unpriced: true };
  }
  return want;
}
// Re-price a want from current worth. Pure: `lookup(entityKey)` returns ledger state or null.
export function repriceWant(want, lookup, now = Date.now()) {
  if (!want?.stakes) return want;
  const priced = priceWant(want.stakes, lookup);
  const pricing = { value: priced.value, confidence: priced.confidence, provenance: priced.provenance, unpriced: priced.unpriced,
    stakes: priced.stakes.map(s => ({ entityKey: s.entityKey, share: s.share, worth: s.worth, constraint: s.constraint })), pricedAt: now };
  return { ...want, value: priced.value, pricing };
}
// `patience` is how many failed attempts are tolerated before the strategy changes; affect lowers it.
// `strategies` is the rotation this want actually has (the queue knows which are eligible); the name
// reported here is the one that will run next.
export function appetite(want, now = Date.now(), { patience = 3, strategies = STRATEGY_NAMES } = {}) {
  if (!want || want.status === 'sated' || want.status === 'cancelled') {
    return { pressure: 0, frustration: 0, mode: want?.status || 'idle', strategy: null };
  }
  const gap = 1 - clamp(want.progress || 0);
  const ageHours = Math.max(0, now - want.lastProgressAt) / 3600000;
  const persistence = 1 - Math.exp(-ageHours / 8);
  const frustration = clamp((want.failedAttempts || 0) / Math.max(1, patience));
  return { pressure: clamp(want.value * gap * (0.65 + 0.35 * persistence)), gap,
    frustration, mode: frustration >= 2 / 3 ? 'change_strategy' : 'pursue',
    strategy: strategies.length ? strategies[(want.strategy || 0) % strategies.length] : null, strategyIndex: want.strategy || 0,
    // A want with no stakes at all has never been priced; a want with stakes reports what pricing found.
    value: want.value, valueProvenance: want.pricing?.provenance || 'priority', unpriced: want.stakes ? want.pricing?.unpriced === true : true,
    description: want.description, doneWhen: want.doneWhen };
}
export function recordAttempt(want, { result, now = Date.now() }) {
  // A plan, thought, successful model response, or quiet pass does NOT feed hunger.
  // A strategy the engine was not allowed to run rotates to the next one but is not a failure.
  if (result === 'blocked') return { ...want, strategy: want.strategy + 1, lastAttemptAt: now };
  // An attempt cut off by its deadline with resumable work counts as a failure but stays on its strategy.
  const stalled = ['stalled', 'failed', 'budget', 'interrupted'].includes(result);
  return { ...want, attempts: want.attempts + 1,
    failedAttempts: want.failedAttempts + (stalled ? 1 : 0),
    strategy: want.strategy + (stalled && result !== 'interrupted' ? 1 : 0), lastAttemptAt: now };
}
// A verdict of Useful or better (inbox RATINGS.useful) is progress on the want, even when the number cannot move:
// rated progress stops short of done, so a want near its cap would otherwise count a Great as a failed attempt.
export const USEFUL_AT = 0.67;
const isUseful = u => Number.isFinite(u) && u >= USEFUL_AT;
// What a receipt did to the want when it landed, for receipts saved before that was recorded.
const effectOf = r => r.effect || { progressBefore: r.progress, rotated: !isUseful(r.usefulness) };
// `supersedes` names an earlier receipt this one replaces (a person changing their verdict): the earlier one stays on
// record, marked replaced, and its effect on the strategy is undone before this one is applied.
// `reopened` takes a verdict back with nothing in its place: the want returns to where it stood before that verdict, and
// the item goes back to Judge. A verdict on a want already finished is on record and leaves it finished.
export function recordOutcome(want, { receiptId, progress, evidence, criterionMet = false, usefulness = null, supersedes = null, reopened = false, now = Date.now() }) {
  if (want.status === 'cancelled') throw new Error('cancelled wants do not accept outcomes');
  const observations = normalizeEvidence(evidence);
  if (typeof receiptId !== 'string' || !receiptId.trim() || receiptId.length > 200 || !observations.length) throw new Error('outcome requires a receipt ID and observed evidence');
  if (!Number.isFinite(progress) || progress < 0 || progress > 1 || typeof criterionMet !== 'boolean') throw new Error('invalid observed progress');
  if ((progress === 1) !== criterionMet) throw new Error('full satisfaction requires explicit criterionMet and progress 1');
  if (usefulness !== null && (!Number.isFinite(usefulness) || usefulness < 0 || usefulness > 1)) throw new Error('observed usefulness must be in [0, 1]');
  const receipt = { receiptId, progress, evidence: observations, criterionMet };
  if (usefulness !== null) receipt.usefulness = usefulness;
  if (supersedes !== null) receipt.supersedes = supersedes;
  if (reopened) receipt.reopened = true;
  const existing = want.receipts.find(r => r.receiptId === receiptId);
  if (existing) {
    const { at, effect, supersededBy, ...old } = existing;
    if (!isDeepStrictEqual(old, receipt)) throw new Error('receipt ID already names a different outcome');
    return want;
  }
  if (want.receipts.length >= 100) throw new Error('want receipt budget exhausted');
  let base = want, receipts = want.receipts, progressBefore = want.progress;
  if (supersedes !== null) {
    const prior = want.receipts.find(r => r.receiptId === supersedes);
    if (!prior) throw new Error('the verdict being replaced is not on this want');
    if (prior.supersededBy) throw new Error('that verdict was already replaced');
    const e = effectOf(prior);
    // Undo what the replaced verdict did to the strategy; its progress is replaced by this receipt's own.
    base = { ...want, strategy: e.rotated ? Math.max(0, want.strategy - 1) : want.strategy,
      failedAttempts: e.rotated ? Math.max(0, want.failedAttempts - 1) : want.failedAttempts };
    progressBefore = e.progressBefore;
    receipts = want.receipts.map(r => (r === prior ? { ...r, supersededBy: receiptId } : r));
  }
  // A correction (no usefulness, a lower reading of the world) still reopens a finished want. A verdict, or a verdict
  // taken back, doesn't: the finish line was the person's own call, and they can correct that separately.
  if (want.status === 'sated' && !criterionMet && (usefulness !== null || reopened)) {
    return { ...want, receipts: [...receipts, { ...receipt, progress: want.progress, at: now, effect: { progressBefore: want.progress, rotated: false } }] };
  }
  if (reopened) {
    return { ...base, progress, status: 'active', receipts: [...receipts, { ...receipt, at: now, effect: { progressBefore, rotated: false } }] };
  }
  const improved = progress > progressBefore || isUseful(usefulness);
  return { ...base, progress, status: criterionMet ? 'sated' : 'active',
    failedAttempts: improved ? 0 : base.failedAttempts + 1,
    strategy: improved ? base.strategy : base.strategy + 1,
    lastProgressAt: improved ? now : base.lastProgressAt,
    receipts: [...receipts, { ...receipt, at: now, effect: { progressBefore, rotated: !improved } }] };
}
