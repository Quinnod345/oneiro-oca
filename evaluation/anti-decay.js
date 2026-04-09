// OCA Anti-Decay Evaluation (SPEC §2.8, §18.4)
// Measures whether the maintenance loop is producing refinement over operating time.
// Computes CRM trends on 3 horizons, per-component decomposition,
// failure conditions, and automatic remediation.
import { pool } from '../event-bus.js';
import crm from './chinese-room-meter.js';
import benchmarkHarness from './benchmark-harness.js';

const CRM_COMPONENTS = [
  'grounding', 'prediction', 'transfer', 'surprise',
  'creativity', 'metacognition', 'emotion', 'counterfactual', 'causal'
];

const HORIZONS = {
  short:  { label: 'short',  opHoursWindow: 24 },
  medium: { label: 'medium', opHoursWindow: 24 * 7 },
  long:   { label: 'long',   opHoursWindow: 24 * 30 },
};

// ═══════════════════════════════════════════════════
// OPERATING TIME
// ═══════════════════════════════════════════════════

export async function getTotalOperatingTimeMs() {
  try {
    const { rows: [r] } = await pool.query(
      `SELECT COALESCE(SUM(duration_ms), 0)::bigint AS total FROM operating_time_log WHERE duration_ms IS NOT NULL`
    );
    return Number(r.total) || 0;
  } catch {
    return 0;
  }
}

// ═══════════════════════════════════════════════════
// CRM TREND (§18.4.2)
// ═══════════════════════════════════════════════════

export async function computeTrend(horizon = 'medium') {
  const cfg = HORIZONS[horizon];
  if (!cfg) throw new Error(`Unknown horizon: ${horizon}`);

  const windowMs = cfg.opHoursWindow * 3600000;
  const currentOpTime = await getTotalOperatingTimeMs();

  // Get current CRM (latest benchmark or compute fresh)
  let currentSnapshot;
  try {
    const { rows } = await pool.query(
      `SELECT composite, components, operating_time_ms FROM benchmark_history
       ORDER BY created_at DESC LIMIT 1`
    );
    if (rows[0] && rows[0].composite != null) {
      currentSnapshot = rows[0];
    }
  } catch {}

  if (!currentSnapshot) {
    const fresh = await crm.compute();
    currentSnapshot = {
      composite: fresh.composite,
      components: JSON.stringify(fresh.components),
      operating_time_ms: currentOpTime
    };
  }

  // Get baseline: benchmark closest to (currentOpTime - windowMs)
  const baselineTarget = Math.max(0, currentOpTime - windowMs);
  let baselineSnapshot;
  try {
    const { rows } = await pool.query(
      `SELECT composite, components, operating_time_ms
       FROM benchmark_history
       WHERE operating_time_ms IS NOT NULL AND operating_time_ms <= $1
       ORDER BY operating_time_ms DESC LIMIT 1`,
      [baselineTarget + windowMs * 0.1] // allow 10% slack
    );
    if (rows[0]) baselineSnapshot = rows[0];
  } catch {}

  // If no baseline with operating_time, fall back to time-based
  if (!baselineSnapshot) {
    try {
      const days = cfg.opHoursWindow / 24;
      const { rows } = await pool.query(
        `SELECT composite, components, operating_time_ms
         FROM benchmark_history
         WHERE created_at <= NOW() - ($1 || ' days')::interval
         ORDER BY created_at DESC LIMIT 1`,
        [days]
      );
      if (rows[0]) baselineSnapshot = rows[0];
    } catch {}
  }

  const currentComposite = currentSnapshot.composite;
  const baselineComposite = baselineSnapshot?.composite;
  const currentComponents = typeof currentSnapshot.components === 'string'
    ? JSON.parse(currentSnapshot.components) : currentSnapshot.components;
  const baselineComponents = baselineSnapshot
    ? (typeof baselineSnapshot.components === 'string'
      ? JSON.parse(baselineSnapshot.components) : baselineSnapshot.components)
    : null;

  // Compute deltas
  const crmDelta = baselineComposite != null
    ? currentComposite - baselineComposite
    : null;

  // Per-component decomposition (§18.4.3)
  const componentDeltas = {};
  for (const comp of CRM_COMPONENTS) {
    const cur = currentComponents?.[comp]?.score ?? null;
    const base = baselineComponents?.[comp]?.score ?? null;
    componentDeltas[comp] = {
      current: cur,
      baseline: base,
      delta: (cur != null && base != null) ? cur - base : null
    };
  }

  return {
    horizon,
    operating_time_ms: currentOpTime,
    crm_current: currentComposite,
    crm_baseline: baselineComposite,
    crm_delta: crmDelta,
    component_deltas: componentDeltas,
    has_baseline: baselineSnapshot != null,
    window_hours: cfg.opHoursWindow
  };
}

export async function computeAllTrends() {
  const results = {};
  for (const h of Object.keys(HORIZONS)) {
    try {
      results[h] = await computeTrend(h);
    } catch (e) {
      results[h] = { horizon: h, error: e.message };
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════
// FAILURE CONDITIONS (§18.4.4)
// ═══════════════════════════════════════════════════

export async function checkFailureConditions(trends = null) {
  if (!trends) trends = await computeAllTrends();
  const failures = [];
  const remediations = [];

  // 1. Aggregate CRM negative over medium horizon
  if (trends.medium?.crm_delta != null && trends.medium.crm_delta < 0 && trends.medium.has_baseline) {
    failures.push({
      condition: 'aggregate_crm_negative_medium',
      severity: 'warning',
      detail: `CRM dropped ${Math.abs(trends.medium.crm_delta).toFixed(4)} over medium horizon`
    });
    remediations.push({
      action: 'metacognition_diagnostic',
      reason: 'Aggregate CRM negative over 7-day horizon'
    });
  }

  // 2. Aggregate CRM negative over long horizon
  if (trends.long?.crm_delta != null && trends.long.crm_delta < 0 && trends.long.has_baseline) {
    failures.push({
      condition: 'aggregate_crm_negative_long',
      severity: 'critical',
      detail: `CRM dropped ${Math.abs(trends.long.crm_delta).toFixed(4)} over long horizon`
    });
    remediations.push({
      action: 'user_alert_and_diagnostic',
      reason: 'Systemic maintenance failure: CRM negative over 30-day horizon'
    });
  }

  // 3. Single component negative over long horizon
  if (trends.long?.component_deltas) {
    for (const [comp, data] of Object.entries(trends.long.component_deltas)) {
      if (data.delta != null && data.delta < -0.01) {
        failures.push({
          condition: 'component_negative_long',
          severity: 'warning',
          component: comp,
          detail: `${comp} dropped ${Math.abs(data.delta).toFixed(4)} over long horizon`
        });
        remediations.push({
          action: 'flag_subsystem',
          component: comp,
          reason: `${comp} trending negative over 30 days`
        });
      }
    }
  }

  // 4. Stalled consolidation
  try {
    const { rows: [last] } = await pool.query(
      `SELECT MAX(started_at) AS last_run FROM consolidation_log`
    );
    if (last?.last_run) {
      const hoursSince = (Date.now() - new Date(last.last_run).getTime()) / 3600000;
      if (hoursSince > 24) {
        failures.push({
          condition: 'stalled_consolidation',
          severity: 'warning',
          detail: `Last consolidation ${hoursSince.toFixed(1)} hours ago`
        });
        remediations.push({
          action: 'force_consolidation',
          reason: `Consolidation stalled for ${hoursSince.toFixed(0)} hours`
        });
      }
    }
  } catch {}

  // 5. Prediction ledger unfilled ratio
  try {
    const { rows: [counts] } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending') AS pending,
         COUNT(*) AS total
       FROM prediction_ledger
       WHERE created_at > NOW() - INTERVAL '7 days'`
    );
    const total = Number(counts.total) || 0;
    const pending = Number(counts.pending) || 0;
    if (total > 5 && pending / total > 0.7) {
      failures.push({
        condition: 'prediction_ledger_unfilled',
        severity: 'warning',
        detail: `${pending}/${total} predictions still pending (${(pending/total*100).toFixed(0)}%)`
      });
      remediations.push({
        action: 'hypothesis_sla_sweep',
        reason: `${(pending/total*100).toFixed(0)}% of predictions unfilled over 7 days`
      });
    }
  } catch {}

  // 6. Metacognition decoupling: alerts not correlating with actual errors
  try {
    const { rows: [meta] } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE intervention_applied AND intervention_result IS NOT NULL) AS evaluated,
         COUNT(*) FILTER (WHERE intervention_applied AND intervention_result LIKE '%effective%') AS effective,
         COUNT(*) FILTER (WHERE intervention_applied) AS total_interventions
       FROM metacognitive_observations
       WHERE timestamp > NOW() - INTERVAL '30 days'`
    );
    const evaluated = Number(meta.evaluated) || 0;
    const effective = Number(meta.effective) || 0;
    if (evaluated > 5 && effective / evaluated < 0.3) {
      failures.push({
        condition: 'metacognition_decoupling',
        severity: 'critical',
        detail: `Only ${effective}/${evaluated} interventions effective (${(effective/evaluated*100).toFixed(0)}%)`
      });
      remediations.push({
        action: 'calibration_reset',
        reason: 'Metacognitive interventions not correlating with actual improvement'
      });
    }
  } catch {}

  return { failures, remediations, checked_at: new Date().toISOString() };
}

// ═══════════════════════════════════════════════════
// PERSIST + FULL EVALUATION RUN
// ═══════════════════════════════════════════════════

export async function runAntiDecayEvaluation() {
  const trends = await computeAllTrends();
  const { failures, remediations } = await checkFailureConditions(trends);
  const opTime = await getTotalOperatingTimeMs();

  // Persist each horizon's trend
  for (const [horizon, data] of Object.entries(trends)) {
    if (data.error) continue;
    try {
      await pool.query(
        `INSERT INTO anti_decay_trends
         (horizon, operating_time_ms, crm_current, crm_baseline, crm_delta, component_deltas, failure_conditions, remediation_actions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          horizon, opTime,
          data.crm_current, data.crm_baseline, data.crm_delta,
          JSON.stringify(data.component_deltas),
          JSON.stringify(failures.filter(f => f.condition.includes(horizon) || !f.condition.includes('medium') && !f.condition.includes('long'))),
          JSON.stringify(remediations)
        ]
      );
    } catch {}
  }

  // Log maintenance audit
  try {
    await pool.query(
      `INSERT INTO maintenance_audit (layer, last_maintained_at, maintenance_type, details)
       VALUES ('anti_decay', NOW(), 'evaluation', $1)
       ON CONFLICT (layer, maintenance_type) DO UPDATE SET last_maintained_at = NOW(), details = $1`,
      [JSON.stringify({ failures: failures.length, remediations: remediations.length })]
    );
  } catch {}

  return { trends, failures, remediations, operating_time_ms: opTime };
}

// ═══════════════════════════════════════════════════
// HISTORY
// ═══════════════════════════════════════════════════

export async function getAntiDecayHistory({ horizon = 'medium', days = 30, limit = 90 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM anti_decay_trends
     WHERE horizon = $1 AND computed_at >= NOW() - ($2 || ' days')::interval
     ORDER BY computed_at DESC LIMIT $3`,
    [horizon, days, limit]
  );
  return rows;
}

// Positive case check (§18.4.5)
export function isAntiDecaySatisfied(trends) {
  if (!trends?.long?.has_baseline) return { satisfied: false, reason: 'insufficient_data' };
  if (trends.long.crm_delta != null && trends.long.crm_delta < 0) {
    return { satisfied: false, reason: 'aggregate_negative_long_horizon' };
  }
  // Check no component has been negative for more than one evaluation window
  const negativeComponents = [];
  if (trends.long?.component_deltas) {
    for (const [comp, data] of Object.entries(trends.long.component_deltas)) {
      if (data.delta != null && data.delta < -0.01) {
        negativeComponents.push(comp);
      }
    }
  }
  if (negativeComponents.length > 0) {
    return { satisfied: false, reason: 'component_negative', components: negativeComponents };
  }
  return { satisfied: true, reason: 'non_negative_trend' };
}

export default {
  getTotalOperatingTimeMs,
  computeTrend, computeAllTrends,
  checkFailureConditions,
  runAntiDecayEvaluation,
  getAntiDecayHistory,
  isAntiDecaySatisfied
};
