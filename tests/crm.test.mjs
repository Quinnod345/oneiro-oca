import test from 'node:test';
import assert from 'node:assert/strict';
import { predictionSkill, recoveryFrom, composeScorecard, COMPONENTS, EVALUATION_VERSION } from '../evaluation/chinese-room-meter.js';

test('prediction skill is measured against each metric\'s own base rate, not a coin flip', () => {
  // A metric that confirms 80% of the time: always-0.8 is the baseline (Brier 0.16).
  const rows = [...Array(8).fill({ metric: 'm', confirmed: true, confidence: 0.8 }), ...Array(2).fill({ metric: 'm', confirmed: false, confidence: 0.8 })];
  const r = predictionSkill(rows);
  assert.equal(r.n, 10); assert.ok(Math.abs(r.brier - 0.16) < 1e-9); assert.ok(Math.abs(r.base_rate_brier - 0.16) < 1e-9); assert.equal(r.skill, 0, 'matching the base rate is no skill');
  const sharp = predictionSkill([...Array(8).fill({ metric: 'm', confirmed: true, confidence: 0.95 }), ...Array(2).fill({ metric: 'm', confirmed: false, confidence: 0.1 })]);
  assert.ok(sharp.skill > 0.9, `informative confidence earns skill (${sharp.skill.toFixed(3)})`);
  const overconfident = predictionSkill([...Array(8).fill({ metric: 'm', confirmed: true, confidence: 0.99 }), ...Array(2).fill({ metric: 'm', confirmed: false, confidence: 0.99 })]);
  assert.equal(overconfident.skill, 0, 'worse than the base rate clips to zero, never negative credit');
  assert.deepEqual(predictionSkill([]), { n: 0 });
});

test('recovery counts a negative event as recovered only if fear+frustration halves within the hour, and reports saturation', () => {
  const r = recoveryFrom([{ at0: 0.8, at60: 0.3, peak: 0.8 }, { at0: 0.8, at60: 0.6, peak: 0.8 }, { at0: 0.02, at60: 0.02, peak: 0.02 }, { at0: 0.9, at60: 0.1, peak: 0.99 }, { at0: null, at60: 0.1, peak: 0 }]);
  assert.deepEqual([r.n, r.recovered, r.saturated], [4, 3, 1]);
  assert.equal(r.rate, 0.75); assert.equal(r.saturation_rate, 0.25);
});

test('the scorecard never composes a whole from parts: composite is null until every dimension is measured', () => {
  const measured = Object.fromEntries(COMPONENTS.map(k => [k, { score: 0.5, status: 'measured' }]));
  assert.equal(composeScorecard(measured).composite, 0.5);
  const partial = { ...measured, causal: { score: null, status: 'unmeasured' } };
  const s = composeScorecard(partial);
  assert.equal(s.composite, null); assert.equal(s.status, 'insufficient_evidence'); assert.equal(s.partial_mean, 0.5); assert.deepEqual(s.unmeasured, ['causal']);
  assert.equal(s.evaluation_version, EVALUATION_VERSION);
  const bogus = { ...measured, grounding: { score: 1.4, status: 'measured' } };
  assert.ok(composeScorecard(bogus).unmeasured.includes('grounding'), 'an out-of-range score does not count');
});
