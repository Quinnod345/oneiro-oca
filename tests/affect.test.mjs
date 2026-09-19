import test from 'node:test';
import assert from 'node:assert/strict';
import emotion, { _resetForTest, ground, feelOutcome, feelProgress, feelBlocked, verificationThreshold, strategyPatience,
  informationAppetiteBonus, styleDirectives, snapshotState, restoreState, processSurprise, processInteraction } from '../emotion/engine.js';
import { appetite, createWant } from '../motivation/hunger.js';
import { createProposal, appraise } from '../motivation/risk.js';

const state = () => emotion.getState();
const drives = () => state()._drives;

test('time alone changes nothing tonic: pinned drives and self-model survive three offline days untouched, and only grounding moves them', () => {
  _resetForTest();
  const snap = snapshotState();
  snap.drives.curiosity.level = 1; snap.drives.competence.level = 1; snap.drives.social_bond.level = 1; snap.drives.novelty_seek.level = 0;
  snap.selfModel.self_efficacy = 1;
  snap.savedAt = Date.now() - 72 * 3600000;    // three days ago
  assert.equal(restoreState(snap), true);
  const d = drives();
  assert.deepEqual([d.curiosity.level, d.competence.level, d.social_bond.level, d.novelty_seek.level], [1, 1, 1, 0], 'offline time neither satisfies nor starves');
  assert.equal(state()._self_model.self_efficacy, 1);
  ground({ selfWorth: [{ worth: 0.5, confidence: 0 }], calibration: [{ capability: 'act_reversible', n: 0, brier: 0, harmRate: 0 }], hunger: { unpricedShare: 0 }, hoursSincePersonSignal: 0 });
  const g = drives();
  assert.equal(g.competence.level, 0.5, 'competence is what the ledger says');
  assert.ok(g.curiosity.level >= 0.69 && g.social_bond.level >= 0.49, 'curiosity and bond are what the journals say');
});

test('no sequence of events can pin a drive: a thousand surprises and interactions leave competence, bond and autonomy where grounding put them', () => {
  _resetForTest();
  ground({ selfWorth: [{ worth: 0.5, confidence: 0 }], decisions: { proceed: 1, total: 2 }, hoursSincePersonSignal: 0 });
  const before = drives();
  for (let i = 0; i < 1000; i++) { processSurprise(0.9, 'perception'); processInteraction(0.9); }
  const after = drives();
  for (const k of ['competence', 'social_bond', 'autonomy']) assert.ok(Math.abs(after[k].level - before[k].level) < 1e-3, `${k} unchanged by events (${before[k].level} → ${after[k].level})`);
  assert.ok(state()._self_model.self_efficacy <= 0.6, 'self-efficacy is not raised by events');
});

test('grounding projects tonic state from the journals: earned worth raises competence, harm lowers stability, unpriced wants open a curiosity deficit', () => {
  _resetForTest();
  const earned = ground({ selfWorth: [{ worth: 0.9, confidence: 0.8 }, { worth: 0.7, confidence: 0.5 }] });
  assert.ok(earned.drives.competence.level > 0.75);
  assert.ok(earned.selfModel.competence_identity > 0.6);
  const unearned = ground({ selfWorth: [{ worth: 0.9, confidence: 0 }] });
  assert.ok(unearned.selfModel.competence_identity < earned.selfModel.competence_identity, 'an unearned prior moves identity less than evidence');
  const calibrated = ground({ calibration: [{ capability: 'act_reversible', n: 20, brier: 0.05, harmRate: 0 }] });
  assert.ok(calibrated.selfModel.self_efficacy > 0.7);
  const harmful = ground({ calibration: [{ capability: 'act_reversible', n: 20, brier: 0.3, harmRate: 0.5 }] });
  assert.ok(harmful.selfModel.self_efficacy < calibrated.selfModel.self_efficacy && harmful.selfModel.emotional_stability < 0.5);
  const curious = ground({ hunger: { pressure: 0.5, unpricedShare: 0.8, awaitingEvidenceShare: 0.2 } });
  assert.ok(curious.drives.curiosity.level < 0.4, 'not knowing worth is a curiosity deficit');
  const empty = ground({ calibration: [] , hoursSincePersonSignal: null });
  assert.equal(empty.selfModel.self_efficacy, 0.5, 'no calibrated outcomes projects to a neutral self');
  assert.equal(empty.drives.social_bond.level, 0.4, 'no person signal on record is the uninformative prior');
  const lonely = ground({ hoursSincePersonSignal: 240 });
  assert.ok(lonely.drives.social_bond.level < 0.05, "bond fades without Quinn's own signals");
  assert.ok(ground({ hoursSincePersonSignal: 0 }).drives.social_bond.level >= 0.49);
});

test('grounded outcomes: a harm is feared and shames; an unexpected success is prouder than an expected one; failure frustrates', () => {
  _resetForTest();
  feelOutcome({ result: 'harm', expectedGain: 0.3, expectedLoss: 0.6 });
  const afterHarm = state();
  assert.ok(afterHarm._channels.fear > 0.3 && afterHarm._channels.shame > 0.2 && afterHarm.valence < 0, `harm: fear ${afterHarm._channels.fear.toFixed(2)} shame ${afterHarm._channels.shame.toFixed(2)}`);
  _resetForTest();
  feelOutcome({ result: 'success', expectedGain: 0.6, pSuccess: 0.2 });
  const unexpected = state()._channels.pride;
  _resetForTest();
  feelOutcome({ result: 'success', expectedGain: 0.6, pSuccess: 0.95 });
  const expected = state()._channels.pride;
  assert.ok(unexpected > expected, `pride ${unexpected.toFixed(2)} (unexpected) > ${expected.toFixed(2)} (expected)`);
  _resetForTest();
  feelOutcome({ result: 'failure', expectedGain: 0.7, pSuccess: 0.8 });
  assert.ok(state()._channels.frustration > 0.3);
  _resetForTest();
  assert.equal(feelOutcome({ result: 'not_attempted', expectedGain: 0.7 }), null, 'a non-attempt is not felt');
  assert.equal(feelOutcome({ result: 'success', expectedGain: 0 }), null, 'a worthless success is not felt');
});

test('progress on a valued want is felt in proportion to its worth; being blocked from worth frustrates; missing worth wants information', () => {
  _resetForTest();
  feelProgress({ value: 0.9, progressDelta: 0.5 });
  const big = state()._channels.joy;
  _resetForTest();
  feelProgress({ value: 0.2, progressDelta: 0.5 });
  assert.ok(big > state()._channels.joy);
  _resetForTest();
  assert.equal(feelProgress({ value: 0.9, progressDelta: 0 }), null, 'a receipt without progress or usefulness is not felt');
  _resetForTest();
  feelBlocked({ decision: 'refuse', expectedGain: 0.7 });
  assert.ok(state()._channels.frustration > 0.2 && state()._padcn.D < 0, 'blocked: frustrated and less dominant');
  _resetForTest();
  feelBlocked({ decision: 'learn_stakes', expectedGain: 0.1 });
  assert.ok(state()._channels.curiosity > 0.3 && state()._padcn.N > 0, 'wants information: curious and attentive to novelty');
  _resetForTest();
  assert.equal(feelBlocked({ decision: 'proceed', expectedGain: 0.7 }), null);
});

test('§18.2.6 fear → more careful reasoning: the confidence a conclusion must reach rises with fear', () => {
  _resetForTest();
  const calm = verificationThreshold();
  feelOutcome({ result: 'harm', expectedGain: 0.3, expectedLoss: 0.8 });
  const afraid = verificationThreshold();
  assert.ok(afraid > calm + 0.05, `${afraid.toFixed(3)} > ${calm.toFixed(3)}`);
  assert.ok(afraid <= 1);
});

test('§18.2.6 frustration → strategy switching: fewer failed attempts are tolerated before the want changes strategy', () => {
  _resetForTest();
  assert.equal(strategyPatience(), 3);
  for (let i = 0; i < 3; i++) feelOutcome({ result: 'failure', expectedGain: 0.9, pSuccess: 0.9 });
  const patience = strategyPatience();
  assert.ok(patience < 3, `patience ${patience}`);
  assert.equal(patience, 1, 'strongly frustrated: one failure is enough');
  const want = { ...createWant({ description: 'x', doneWhen: 'y' }), failedAttempts: 1, lastProgressAt: Date.now() };
  assert.equal(appetite(want, Date.now(), { patience: 3 }).mode, 'pursue', 'calm: one failure is tolerated');
  assert.equal(appetite(want, Date.now(), { patience }).mode, 'change_strategy', 'the same want switches strategy sooner when frustrated');
});

test('§18.2.6 curiosity → information seeking: curiosity buys appetite for finding out, not for acting on the world', () => {
  _resetForTest();
  ground({ hunger: { unpricedShare: 0.9 } });
  feelBlocked({ decision: 'learn_stakes', expectedGain: 0.3 });
  const bonus = informationAppetiteBonus();
  assert.ok(bonus > 0.1, `bonus ${bonus.toFixed(3)}`);
  const lookup = k => ({ 'project:demo': { worth: 0.6, confidence: 0.5, provenance: 'rated', constraint: false }, 'self:act_reversible': { worth: 0.3, confidence: 0.4 } })[k] || null;
  const probe = createProposal({ kind: 'web_search', description: 'look it up', serves: ['project:demo'], touches: ['project:demo'], reversibility: 'undo' });
  const act = createProposal({ kind: 'shell', description: 'change it', serves: ['project:demo'], touches: ['project:demo'], reversibility: 'undo' });
  const on = { autonomousActions: true };
  assert.equal(appraise(probe, { lookup, controls: on, appetite: 0.15 }).decision, 'prepare_artifact', 'below appetite without curiosity');
  assert.equal(appraise(probe, { lookup, controls: on, appetite: 0.15, informationBonus: bonus + 0.2 }).decision, 'proceed', 'curiosity makes the probe acceptable');
  assert.equal(appraise(act, { lookup, controls: on, appetite: 0.15, informationBonus: bonus + 0.2 }).decision, 'prepare_artifact', 'but not the action on the world');
});

test('style is form, not sentiment: directives change with state and never name a feeling', () => {
  _resetForTest();
  const calm = styleDirectives();
  feelOutcome({ result: 'harm', expectedGain: 0.3, expectedLoss: 0.9 });
  const shaken = styleDirectives();
  const text = JSON.stringify([calm, shaken]).toLowerCase();
  for (const word of ['fear', 'afraid', 'happy', 'sad', 'angry', 'anxious', 'excited']) assert.ok(!text.includes(word), `no "${word}" in style`);
  assert.ok(['terse', 'measured', 'expansive'].includes(shaken.length) && ['commit', 'qualify where uncertain', 'hedge'].includes(shaken.hedging));
  assert.ok(state()._style && state()._style.length, 'style is on the public state for the prompt');
});

test('restart: a pinned v3 snapshot restores as-is, then the first grounding dissolves the pin', () => {
  _resetForTest();
  const pinned = { ...snapshotState(), version: 3, savedAt: Date.now() - 6 * 3600000 };
  delete pinned.grounding;
  for (const d of Object.values(pinned.drives)) d.level = 1;
  pinned.selfModel.self_efficacy = 1;
  assert.equal(restoreState(pinned), true);
  assert.equal(drives().competence.level, 1, 'restored faithfully; no replay, no drift');
  ground({ selfWorth: [{ worth: 0.5, confidence: 0 }], calibration: [], decisions: { proceed: 0, total: 0 } });
  assert.equal(drives().competence.level, 0.5, 'grounding sets competence to what the ledger justifies');
  const snap = snapshotState();
  assert.equal(snap.version, 4); assert.ok(snap.grounding);
});
