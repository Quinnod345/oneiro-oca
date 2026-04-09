// OCA Benchmark Harness
// Persists daily/adhoc Chinese Room benchmark snapshots
// Integrates CRM MLP for predictive surprise detection
import { pool } from '../event-bus.js';
import crm from './chinese-room-meter.js';
import crmMLP from './crm-mlp.js';

let crmMlpLoaded = false;
try { crmMlpLoaded = crmMLP.load(); } catch {}

function flattenComponentMetrics(components) {
  const out = {};
  for (const [key, value] of Object.entries(components || {})) {
    if (!value || typeof value !== 'object') continue;
    if (typeof value.score === 'number') out[`${key}_score`] = value.score;
    for (const [subKey, subValue] of Object.entries(value)) {
      if (typeof subValue === 'number') {
        out[`${key}_${subKey}`] = subValue;
      }
    }
  }
  return out;
}

export async function runBenchmark({
  runSource = 'manual',
  notes = null,
  force = false,
} = {}) {
  // CRM MLP: predict before computing actual CRM
  let mlpPrediction = null;
  let mlpFeatures = null;
  let lastCrmScores = {};
  try {
    const { rows: [prev] } = await pool.query(
      `SELECT components FROM benchmark_history ORDER BY created_at DESC LIMIT 1`
    );
    if (prev?.components) {
      const comps = typeof prev.components === 'string' ? JSON.parse(prev.components) : prev.components;
      for (const [k, v] of Object.entries(comps)) lastCrmScores[k] = v?.score || 0.5;
    }
  } catch {}

  let ocaState = {};
  try {
    const oca = (await import('../index.js')).default;
    const emo = oca.layers.emotion.getState();
    const { rows: [opRow] } = await pool.query(
      `SELECT COALESCE(SUM(duration_ms), 0)::bigint AS total FROM operating_time_log WHERE duration_ms IS NOT NULL`
    );
    ocaState = {
      operatingTimeHours: (Number(opRow?.total || 0)) / 3600000,
      valence: emo?.valence, arousal: emo?.arousal, confidence: emo?.confidence,
      cognitiveLoad: emo?.cognitive_load,
    };
  } catch {}

  try {
    mlpFeatures = crmMLP.encodeFeatures(lastCrmScores, ocaState);
    mlpPrediction = Array.from(crmMLP.predict(mlpFeatures));
  } catch {}

  const result = await crm.compute();
  const benchmarkDate = new Date().toISOString().slice(0, 10);

  // CRM MLP: learn from actual scores
  let mlpResult = null;
  try {
    const actualScores = new Float32Array(9);
    const comps = ['grounding', 'prediction', 'transfer', 'surprise', 'creativity', 'metacognition', 'emotion', 'counterfactual', 'causal'];
    for (let i = 0; i < 9; i++) actualScores[i] = result.components?.[comps[i]]?.score || 0.5;
    mlpResult = crmMLP.learn(actualScores);
    if (mlpResult?.surprisedComponents?.length > 0) {
      console.log(`[crm-mlp] surprised by: ${mlpResult.surprisedComponents.join(', ')}`);
    }
  } catch {}

  result.mlp_prediction = mlpPrediction;
  result.mlp_surprise = mlpResult?.componentErrors || null;
  result.mlp_status = crmMLP.getStatus();

  if (!force) {
    const { rows: [existing] } = await pool.query(
      `SELECT id, benchmark_date, run_source, composite, created_at
       FROM benchmark_history
       WHERE benchmark_date = $1 AND run_source = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [benchmarkDate, runSource]
    );
    if (existing) {
      return {
        stored: false,
        skipped: true,
        reason: 'already_exists_for_date_and_source',
        existing,
        result,
      };
    }
  }

  const rawMetrics = flattenComponentMetrics(result.components);
  const { rows: [row] } = await pool.query(
    `INSERT INTO benchmark_history
     (benchmark_date, composite, interpretation, components, raw_metrics, run_source, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (benchmark_date, run_source) DO UPDATE SET
       created_at = NOW(),
       composite = EXCLUDED.composite,
       interpretation = EXCLUDED.interpretation,
       components = EXCLUDED.components,
       raw_metrics = EXCLUDED.raw_metrics,
       notes = EXCLUDED.notes
     RETURNING *`,
    [
      benchmarkDate,
      result.composite,
      result.interpretation,
      JSON.stringify(result.components || {}),
      JSON.stringify(rawMetrics),
      runSource,
      notes,
    ]
  );

  return {
    stored: true,
    benchmark: row,
    result,
  };
}

export async function benchmarkHistory({ days = 30, limit = 90 } = {}) {
  const safeDays = Math.max(1, Math.min(365, Number(days) || 30));
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 90));
  const { rows } = await pool.query(
    `SELECT *
     FROM benchmark_history
     WHERE benchmark_date >= CURRENT_DATE - $1::int
     ORDER BY benchmark_date DESC, created_at DESC
     LIMIT $2`,
    [safeDays, safeLimit]
  );
  return rows;
}

export default { runBenchmark, benchmarkHistory };
