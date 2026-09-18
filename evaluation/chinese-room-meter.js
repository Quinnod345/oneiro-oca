// Behavioral evidence report (SPEC §18), not a consciousness/activity score.
// Null means unmeasured. Counts and prose similarity never establish capability.
import { pool } from '../event-bus.js';
export const EVALUATION_VERSION = 'behavioral-v2';
export const COMPONENTS = ['grounding', 'prediction', 'transfer', 'surprise', 'creativity',
  'metacognition', 'emotion', 'counterfactual', 'causal'];

export function composeScorecard(components, now = Date.now()) {
  const validated = COMPONENTS.filter(k => components[k]?.status === 'measured'
    && Number.isFinite(components[k]?.score) && components[k].score >= 0 && components[k].score <= 1);
  const complete = validated.length === COMPONENTS.length;
  return { evaluation_version: EVALUATION_VERSION,
    composite: complete ? validated.reduce((s,k) => s + components[k].score, 0) / validated.length : null,
    status: complete ? 'measured' : 'insufficient_evidence',
    evidence_coverage: validated.length / COMPONENTS.length,
    unmeasured: COMPONENTS.filter(k => !validated.includes(k)), components,
    interpretation: complete ? 'Observed behavioral performance; not a measure of consciousness or understanding.'
      : 'Whole-engine capability is not demonstrated. Activity, generated prose, and missing outcomes receive no credit.',
    timestamp: new Date(now).toISOString() };
}

const unknown = (detail, diagnostics = {}) => ({ score: null, status: 'unmeasured', detail, diagnostics });

export async function compute({ db = pool } = {}) {
  const c = {};
  async function measure(key, run) {
    try { c[key] = await run(); }
    catch (e) { c[key] = { score: null, status: 'unavailable', detail: 'Evidence query failed', error: e.message }; }
  }
  // Queries are bounded rolling diagnostics. Retain old rows; do not relabel them
  // as observations after replacing their invalid measurement method.
  await measure('grounding', async () => {
    const { rows: [r] } = await db.query(`SELECT COUNT(*)::int AS episodes,
      COUNT(*) FILTER (WHERE visual_hash IS NOT NULL)::int AS with_visual_reference
      FROM episodic_memory WHERE timestamp > NOW() - INTERVAL '30 days'`);
    return unknown('A sensory attachment does not establish that the claim follows from it; source-checked recall and grounding evaluations are required.', r);
  });
  await measure('prediction', async () => {
    const { rows: [r] } = await db.query(`SELECT COUNT(*)::int AS evaluated,
      AVG(POWER((source_data->'last_evaluation'->>'stated_confidence')::float
        - CASE WHEN status = 'confirmed' THEN 1.0 ELSE 0.0 END, 2)) AS brier_score,
      AVG(CASE WHEN status = 'confirmed' THEN 1.0 ELSE 0.0 END) AS confirmation_rate
      FROM hypotheses WHERE status IN ('confirmed','refuted') AND created_at < tested_at
        AND tested_at > NOW() - INTERVAL '30 days'
        AND source_data->'last_evaluation'->>'engine_version' = 'structured-v2'
        AND source_data->'last_evaluation'->>'verifiable' = 'true'`);
    return unknown('Fresh structured outcomes supply calibration evidence. Task relevance and improvement over a matched baseline remain unverified.',
      { ...r, coin_flip_brier: 0.25, beats_coin_flip: r.evaluated > 0 ? Number(r.brier_score) < 0.25 : null });
  });
  await measure('transfer', async () => {
    const { rows: [r] } = await db.query(`SELECT COUNT(*)::int AS generated_transfers FROM creative_artifacts WHERE creation_method = 'cross_domain'`);
    return unknown('Requires observed success on a held-out domain using traced prior learning. Abstraction counts are not transfer.', r);
  });
  c.surprise = unknown('Requires a surprising observation followed by a corrected model and a better subsequent prediction. Writing model_update text is not recovery.');
  await measure('creativity', async () => {
    const { rows: [r] } = await db.query('SELECT COUNT(*)::int AS generated_artifacts FROM creative_artifacts');
    return unknown('Requires inspected artifacts with novelty and usefulness evaluation. Producing an artifact is not proof of either.', r);
  });
  c.metacognition = unknown('Requires independently labeled errors and measured detection/repair accuracy. Repeated stuck alerts earn no credit.');
  await measure('emotion', async () => {
    const { rows: [r] } = await db.query(`SELECT COUNT(*)::int AS samples,
      AVG(CASE WHEN ABS(valence) >= .95 OR arousal >= .95 OR confidence >= .95 THEN 1.0 ELSE 0.0 END) AS saturation_rate
      FROM emotional_states WHERE timestamp > NOW() - INTERVAL '1 hour'`);
    return unknown('Requires measured behavioral modulation and recovery. Variation alone is not functionality.', r);
  });
  c.counterfactual = unknown('Requires a separately observed execution of the alternative under comparable conditions. Similarity to the original episode cannot verify it.');
  await measure('causal', async () => {
    const { rows: [r] } = await db.query(`SELECT COUNT(*)::int AS designed,
      COUNT(*) FILTER (WHERE started_at IS NOT NULL)::int AS marked_started,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS marked_completed
      FROM causal_experiments`);
    return unknown('Requires an intervention receipt and a measured contrast. A confirmed hypothesis or expired experiment is not causal support.', r);
  });
  return composeScorecard(c);
}
export default { compute };
