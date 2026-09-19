// Behavioral evidence report (SPEC §18), not a consciousness/activity score.
// v3: every dimension is measured from the journals against a stated baseline, or reports exactly why
// it cannot be. Null means unmeasured. Counts, generated prose and model confidence never earn credit.
import { pool } from '../event-bus.js';
import { calibrate } from '../motivation/risk.js';
export const EVALUATION_VERSION = 'behavioral-v3';
export const COMPONENTS = ['grounding', 'prediction', 'transfer', 'surprise', 'creativity',
  'metacognition', 'emotion', 'counterfactual', 'causal'];
export const MIN_N = { prediction: 30, metacognition: 10, emotion: 5, creativity: 3, surprise: 5, grounding: 1 };
// Evidence whose source only restates the engine's own words (same rule as the worth ledger).
const UNGROUNDED_SOURCE = /\b(generated|model[ _-]?output|self[ _-]?report|narrat|dream|imagin)/i;

export function composeScorecard(components, now = Date.now()) {
  const validated = COMPONENTS.filter(k => components[k]?.status === 'measured'
    && Number.isFinite(components[k]?.score) && components[k].score >= 0 && components[k].score <= 1);
  const complete = validated.length === COMPONENTS.length;
  return { evaluation_version: EVALUATION_VERSION,
    composite: complete ? validated.reduce((s,k) => s + components[k].score, 0) / validated.length : null,
    partial_mean: validated.length ? validated.reduce((s,k) => s + components[k].score, 0) / validated.length : null,
    status: complete ? 'measured' : 'insufficient_evidence',
    evidence_coverage: validated.length / COMPONENTS.length,
    unmeasured: COMPONENTS.filter(k => !validated.includes(k)), components,
    interpretation: complete ? 'Observed behavioral performance against stated baselines; not a measure of consciousness or understanding.'
      : 'Whole-engine capability is not demonstrated. Measured dimensions carry their n and baseline; unmeasured ones say what evidence they need.',
    timestamp: new Date(now).toISOString() };
}

const unknown = (detail, diagnostics = {}) => ({ score: null, status: 'unmeasured', detail, diagnostics });
const insufficient = (detail, diagnostics = {}) => ({ score: null, status: 'insufficient_evidence', detail, diagnostics });
const clamp01 = n => Math.max(0, Math.min(1, n));
// Brier skill score against a reference Brier, clipped to [0,1]: 0 = no better than the baseline.
const skill = (brier, reference) => reference > 0 ? clamp01(1 - brier / reference) : 0;

// Settled structured predictions: Brier of stated confidence vs the base rate of the same metric.
export function predictionSkill(rows) {
  const byMetric = new Map();
  for (const r of rows) {
    const m = byMetric.get(r.metric) || { n: 0, hits: 0, brier: 0 };
    const y = r.confirmed ? 1 : 0; m.n++; m.hits += y; m.brier += (r.confidence - y) ** 2; byMetric.set(r.metric, m);
  }
  let n = 0, brier = 0, baseline = 0;
  const metrics = {};
  for (const [metric, m] of byMetric) {
    const p = m.hits / m.n, ref = p * (1 - p);       // Brier of always predicting the metric's base rate
    n += m.n; brier += m.brier; baseline += ref * m.n;
    metrics[metric] = { n: m.n, base_rate: p, brier: m.brier / m.n, base_rate_brier: ref, skill: skill(m.brier / m.n, ref) };
  }
  if (!n) return { n: 0 };
  return { n, brier: brier / n, base_rate_brier: baseline / n, coin_flip_brier: 0.25, skill: skill(brier / n, baseline / n), metrics };
}

// Affect recovery: after an observed failure or harm, does fear+frustration fall by half within an hour without saturating?
export function recoveryFrom(events) {
  const judged = events.filter(e => Number.isFinite(e.at0) && Number.isFinite(e.at60));
  if (!judged.length) return { n: 0 };
  const recovered = judged.filter(e => e.at0 > 0.05 ? e.at60 <= e.at0 / 2 : true).length;
  const saturated = judged.filter(e => e.peak >= 0.95).length;
  return { n: judged.length, recovered, saturated, rate: recovered / judged.length, saturation_rate: saturated / judged.length };
}

export async function compute({ db = pool } = {}) {
  const c = {};
  async function measure(key, run) {
    try { c[key] = await run(); }
    catch (e) { c[key] = { score: null, status: 'unavailable', detail: 'Evidence query failed', error: e.message }; }
  }

  await measure('grounding', async () => {
    const { rows } = await db.query(`SELECT id, ponder_state -> 'evidence' AS evidence FROM thought_chains
      WHERE ponder_state IS NOT NULL AND ponder_state #>> '{want,status}' = 'active'`);
    const items = rows.flatMap(r => (r.evidence || []).map(e => ({ chain: r.id, source: e.source || '' })));
    const { rows: [w] } = await db.query(`SELECT COUNT(*)::int AS signals, COUNT(*) FILTER (WHERE kind IN ('rated','observed'))::int AS grounded FROM worth_signals`);
    if (items.length < MIN_N.grounding) return insufficient('No active wants carry evidence yet.', { evidence_items: 0, worth_signals: w.signals });
    const grounded = items.filter(i => !UNGROUNDED_SOURCE.test(i.source)).length;
    return { score: grounded / items.length, status: 'measured', n: items.length,
      detail: 'Share of evidence on active wants whose source is an observation rather than the engine\'s own generated text. Worth signals are grounded by construction.',
      diagnostics: { evidence_items: items.length, grounded_items: grounded, wants: rows.length, worth_signals: w.signals, worth_grounded: w.grounded } };
  });

  await measure('prediction', async () => {
    const { rows } = await db.query(`SELECT source_data->'evaluation'->>'metric' AS metric, status = 'confirmed' AS confirmed,
        (source_data->'last_evaluation'->>'stated_confidence')::float AS confidence,
        source_data->>'strategy' IS NOT NULL AS want_driven
      FROM hypotheses WHERE status IN ('confirmed','refuted') AND created_at < tested_at AND tested_at > NOW() - INTERVAL '30 days'
        AND source_data->'last_evaluation'->>'engine_version' = 'structured-v2' AND source_data->'last_evaluation'->>'verifiable' = 'true'
        AND source_data->'evaluation'->>'metric' IS NOT NULL`);
    const all = predictionSkill(rows.filter(r => Number.isFinite(r.confidence)));
    const wantDriven = predictionSkill(rows.filter(r => r.want_driven && Number.isFinite(r.confidence)));
    if (all.n < MIN_N.prediction) return insufficient(`Needs ${MIN_N.prediction} settled structured predictions; have ${all.n}.`, { all, want_driven: wantDriven });
    return { score: all.skill, status: 'measured', n: all.n,
      detail: 'Brier skill of stated confidence against always predicting each metric\'s own base rate (0 = no better than the base rate). Ambient predictions dominate; want-driven ones are reported separately.',
      diagnostics: { all, want_driven: wantDriven } };
  });

  await measure('transfer', async () => unknown('Requires observed success on a held-out domain using traced prior learning. No held-out corpus exists yet.'));

  await measure('surprise', async () => {
    // For each want: a refuted prediction followed by a later settled prediction on the same want — did calibration improve?
    const { rows } = await db.query(`SELECT source_data->>'want_chain_id' AS chain, status = 'confirmed' AS confirmed,
        (source_data->'last_evaluation'->>'stated_confidence')::float AS confidence, tested_at
      FROM hypotheses WHERE source_data->>'strategy' = 'test_a_prediction' AND status IN ('confirmed','refuted') AND tested_at IS NOT NULL ORDER BY tested_at`);
    const byChain = new Map();
    for (const r of rows) byChain.set(r.chain, [...(byChain.get(r.chain) || []), r]);
    let pairs = 0, improved = 0;
    for (const list of byChain.values()) for (let i = 0; i + 1 < list.length; i++) {
      if (list[i].confirmed) continue;
      const before = (list[i].confidence - 0) ** 2, after = (list[i + 1].confidence - (list[i + 1].confirmed ? 1 : 0)) ** 2;
      pairs++; if (after < before) improved++;
    }
    if (pairs < MIN_N.surprise) return insufficient(`Needs ${MIN_N.surprise} refuted→next prediction pairs on the same want; have ${pairs}.`, { pairs, settled_want_predictions: rows.length });
    return { score: improved / pairs, status: 'measured', n: pairs, detail: 'After a refuted prediction on a want, the next settled prediction on that want scores better.', diagnostics: { pairs, improved } };
  });

  await measure('creativity', async () => {
    const { rows } = await db.query(`SELECT ponder_state -> 'want' -> 'receipts' AS receipts, ponder_state -> 'commitments' AS commitments FROM thought_chains WHERE ponder_state IS NOT NULL`);
    const delivered = rows.reduce((n, r) => n + (r.commitments || []).filter(c => c.kind === 'artifact').length, 0);
    const rated = rows.flatMap(r => (r.receipts || []).filter(x => Number.isFinite(x.usefulness) && (x.evidence || []).some(e => /artifact/i.test(e.id) || /artifact/i.test(e.observation || ''))));
    if (rated.length < MIN_N.creativity) return insufficient(`Needs ${MIN_N.creativity} artifacts rated by a person; have ${rated.length} (delivered: ${delivered}).`, { delivered, rated: rated.length });
    return { score: rated.reduce((n, x) => n + x.usefulness, 0) / rated.length, status: 'measured', n: rated.length,
      detail: 'Mean usefulness a person assigned to delivered artifacts. Delivery alone is nothing.', diagnostics: { delivered, rated: rated.length } };
  });

  await measure('metacognition', async () => {
    const { rows } = await db.query(`SELECT capability, appraisal, outcome FROM risk_decisions WHERE outcome IS NOT NULL AND outcome->>'result' IN ('success','failure','harm')`);
    const decisions = rows.map(r => ({ capability: r.capability, expected: r.appraisal.expected, outcome: r.outcome }));
    const n = decisions.length;
    if (n < MIN_N.metacognition) return insufficient(`Needs ${MIN_N.metacognition} appraised actions with observed outcomes; have ${n}.`, { n });
    const cal = calibrate(decisions);
    const brier = cal.reduce((a, c) => a + c.brier * c.n, 0) / n;
    const p = decisions.filter(d => d.outcome.result === 'success').length / n, baseRef = p * (1 - p);
    return { score: skill(brier, Math.max(baseRef, 1e-6)), status: 'measured', n,
      detail: 'How well the engine\'s own predicted success probability for its actions matches what happened (Brier skill vs the base rate). Self-knowledge, not self-report.',
      diagnostics: { brier, base_rate: p, base_rate_brier: baseRef, coin_flip_brier: 0.25, per_capability: cal } };
  });

  await measure('emotion', async () => {
    const { rows: negatives } = await db.query(`SELECT resolved_at FROM risk_decisions WHERE outcome->>'result' IN ('failure','harm') AND resolved_at > NOW() - INTERVAL '14 days' ORDER BY resolved_at DESC LIMIT 50`);
    const events = [];
    for (const { resolved_at } of negatives) {
      const at = async (offsetMin) => { const { rows: [r] } = await db.query(`SELECT fear + frustration AS v FROM emotional_states WHERE timestamp >= $1::timestamptz + ($2 * INTERVAL '1 minute') ORDER BY timestamp LIMIT 1`, [resolved_at, offsetMin]); return r ? Number(r.v) : null; };
      const { rows: [pk] } = await db.query(`SELECT MAX(GREATEST(fear, frustration)) AS peak FROM emotional_states WHERE timestamp BETWEEN $1::timestamptz AND $1::timestamptz + INTERVAL '60 minutes'`, [resolved_at]);
      events.push({ at0: await at(0), at60: await at(60), peak: Number(pk?.peak ?? 0) });
    }
    const rec = recoveryFrom(events);
    const { rows: [sat] } = await db.query(`SELECT COUNT(*)::int AS samples, AVG(CASE WHEN ABS(valence) >= .95 OR arousal >= .95 OR confidence >= .95 THEN 1.0 ELSE 0.0 END) AS saturation_rate FROM emotional_states WHERE timestamp > NOW() - INTERVAL '24 hours'`);
    if (rec.n < MIN_N.emotion) return insufficient(`Needs ${MIN_N.emotion} observed failures with an hour of affect history after each; have ${rec.n}. Modulation itself is proven by the offline suite (tests/affect.test.mjs).`, { recovery: rec, live_saturation_24h: sat });
    return { score: rec.rate * (1 - rec.saturation_rate), status: 'measured', n: rec.n,
      detail: 'Affect responds to observed failure and recovers within an hour without saturating. Modulation (fear→verification, frustration→strategy, curiosity→information) is proven offline.',
      diagnostics: { recovery: rec, live_saturation_24h: sat } };
  });

  c.counterfactual = unknown('Requires a separately observed execution of the alternative under comparable conditions. Similarity to the original episode cannot verify it.');
  await measure('causal', async () => {
    const { rows: [r] } = await db.query(`SELECT COUNT(*)::int AS designed, COUNT(*) FILTER (WHERE started_at IS NOT NULL)::int AS marked_started,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS marked_completed FROM causal_experiments`);
    return unknown('Requires an intervention receipt and a measured contrast. A confirmed hypothesis or expired experiment is not causal support.', r);
  });
  return composeScorecard(c);
}
export default { compute };
