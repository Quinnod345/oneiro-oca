// OCA Benchmark Harness
// Persists daily/adhoc Chinese Room benchmark snapshots
// Integrates CRM MLP for predictive surprise detection
import { pool } from '../event-bus.js';
import crm, { EVALUATION_VERSION } from './chinese-room-meter.js';

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
  const result = await crm.compute();
  const benchmarkDate = new Date().toISOString().slice(0, 10);

  // The old predictor was trained on activity proxies. It is not comparable
  // to this version and must not turn unknown targets into synthetic 0.5 labels.
  result.mlp_status = { available: false, reason: 'legacy_activity_predictor_not_comparable' };

  if (!force) {
    const { rows: [existing] } = await pool.query(
      `SELECT id, benchmark_date, run_source, composite, created_at
       FROM benchmark_history
       WHERE benchmark_date = $1 AND run_source = $2 AND evaluation_version = $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [benchmarkDate, runSource, EVALUATION_VERSION]
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
     (benchmark_date, composite, interpretation, components, raw_metrics, run_source, notes, evaluation_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (benchmark_date, run_source, evaluation_version) DO UPDATE SET
       created_at = NOW(),
       composite = EXCLUDED.composite,
       interpretation = EXCLUDED.interpretation,
       components = EXCLUDED.components,
       raw_metrics = EXCLUDED.raw_metrics,
       evaluation_version = EXCLUDED.evaluation_version,
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
      EVALUATION_VERSION,
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
