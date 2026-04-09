// OCA Long-term Cohabitation Protocol (SPEC §17.5)
// Convention drift logging, consent renewal, convention versioning
import { pool, emit } from './event-bus.js';

// ═══════════════════════════════════════════════════
// CONVENTION MANAGEMENT (§17.5)
// ═══════════════════════════════════════════════════

export async function getActiveConventions() {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM cohabitation_conventions WHERE active = true ORDER BY version DESC LIMIT 1`
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

export async function proposeConventionUpdate(newConventions, reason) {
  const current = await getActiveConventions();
  const newVersion = (current?.version || 0) + 1;

  // Deactivate old version
  if (current) {
    await pool.query(`UPDATE cohabitation_conventions SET active = false WHERE id = $1`, [current.id]);
  }

  const { rows: [created] } = await pool.query(
    `INSERT INTO cohabitation_conventions (version, conventions, reason, active)
     VALUES ($1, $2, $3, true) RETURNING *`,
    [newVersion, JSON.stringify(newConventions), reason]
  );

  // Log to episodic memory as a convention drift event
  await emit('workspace_broadcast', 'cohabitation', {
    action: 'convention_update',
    from_version: current?.version || 0,
    to_version: newVersion,
    reason
  }).catch(() => {});

  return created;
}

// ═══════════════════════════════════════════════════
// CONVENTION DRIFT DETECTION (§17.5)
// ═══════════════════════════════════════════════════

let lastObservedOwnershipMode = null;
let ownershipModeHistory = []; // recent mode transitions
const MAX_HISTORY = 100;

export function recordOwnershipChange(newMode, reason) {
  const change = {
    from: lastObservedOwnershipMode,
    to: newMode,
    reason,
    at: new Date().toISOString()
  };
  ownershipModeHistory.push(change);
  if (ownershipModeHistory.length > MAX_HISTORY) ownershipModeHistory.shift();
  lastObservedOwnershipMode = newMode;
}

export async function checkConventionDrift() {
  const current = await getActiveConventions();
  if (!current) return { drifts: [], no_conventions: true };

  const conventions = typeof current.conventions === 'string'
    ? JSON.parse(current.conventions) : current.conventions;
  const drifts = [];

  // Check if observed behavior has drifted from stated conventions
  const recentChanges = ownershipModeHistory.slice(-20);
  if (recentChanges.length > 10) {
    // Check if user is overriding more than expected
    const overrides = recentChanges.filter(c => c.from === 'oneiro_primary' && c.to === 'quinn_primary');
    if (overrides.length > 5) {
      drifts.push({
        dimension: 'ownership_overrides',
        detail: `${overrides.length}/20 recent transitions were user overrides of Oneiro primary — convention may need updating`,
        severity: 0.4
      });
    }

    // Check if quiet hours are being respected
    const quietStart = parseInt((conventions?.temporal?.quiet_hours || '23:00').split(':')[0]);
    const activeInQuiet = recentChanges.filter(c => {
      const hour = new Date(c.at).getHours();
      return (hour >= quietStart || hour < 8) && c.to === 'oneiro_primary';
    });
    if (activeInQuiet.length > 3) {
      drifts.push({
        dimension: 'quiet_hours',
        detail: `${activeInQuiet.length} oneiro_primary transitions during quiet hours`,
        severity: 0.3
      });
    }
  }

  return { drifts, convention_version: current.version, checked_at: new Date().toISOString() };
}

// ═══════════════════════════════════════════════════
// CONSENT RENEWAL (§17.5)
// ═══════════════════════════════════════════════════

export async function checkConsentRenewal() {
  try {
    const { rows: [latest] } = await pool.query(
      `SELECT reviewed_at FROM consent_reviews ORDER BY reviewed_at DESC LIMIT 1`
    );

    const lastReview = latest?.reviewed_at ? new Date(latest.reviewed_at) : null;
    const daysSinceReview = lastReview
      ? (Date.now() - lastReview.getTime()) / 86400000
      : Infinity;

    return {
      needs_renewal: daysSinceReview > 365,
      days_since_last_review: Math.round(daysSinceReview),
      last_reviewed: lastReview?.toISOString() || null,
      reason: daysSinceReview > 365 ? 'annual_review_due' : daysSinceReview === Infinity ? 'never_reviewed' : 'not_due'
    };
  } catch {
    return { needs_renewal: true, reason: 'check_failed' };
  }
}

export async function generateConsentReport() {
  const report = {};

  // Capabilities exercised
  try {
    const { rows: caps } = await pool.query(`
      SELECT
        'motor_actions' AS capability, COUNT(*) AS uses
        FROM prediction_ledger WHERE action_source = 'motor' AND created_at > NOW() - INTERVAL '365 days'
      UNION ALL
      SELECT 'hypotheses_formed', COUNT(*) FROM hypotheses WHERE created_at > NOW() - INTERVAL '365 days'
      UNION ALL
      SELECT 'deliberations', COUNT(*) FROM deliberations WHERE started_at > NOW() - INTERVAL '365 days'
      UNION ALL
      SELECT 'creative_artifacts', COUNT(*) FROM creative_artifacts WHERE created_at > NOW() - INTERVAL '365 days'
      UNION ALL
      SELECT 'episodic_memories', COUNT(*) FROM episodic_memory WHERE timestamp > NOW() - INTERVAL '365 days'
      UNION ALL
      SELECT 'screenshots_captured', COUNT(*) FROM screenshot_memory WHERE captured_at > NOW() - INTERVAL '365 days'
    `);
    report.capabilities_exercised = Object.fromEntries(caps.map(c => [c.capability, parseInt(c.uses)]));
  } catch {}

  // Access patterns
  try {
    const { rows } = await pool.query(`
      SELECT active_app, COUNT(*) AS observations
      FROM episodic_memory
      WHERE active_app IS NOT NULL AND timestamp > NOW() - INTERVAL '90 days'
      GROUP BY active_app ORDER BY observations DESC LIMIT 10
    `);
    report.most_observed_apps = rows;
  } catch {}

  // Accumulated state
  try {
    const { rows: [totals] } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM episodic_memory) AS total_episodes,
        (SELECT COUNT(*) FROM semantic_memory) AS total_semantic,
        (SELECT COUNT(*) FROM procedural_memory) AS total_procedures,
        (SELECT COUNT(*) FROM identity_events) AS identity_events,
        (SELECT COALESCE(SUM(duration_ms), 0)::bigint FROM operating_time_log WHERE duration_ms IS NOT NULL) AS operating_time_ms
    `);
    report.accumulated_state = {
      ...totals,
      operating_time_hours: Math.round(Number(totals.operating_time_ms) / 3600000 * 10) / 10
    };
  } catch {}

  // Body ownership distribution
  try {
    const { rows } = await pool.query(`
      SELECT mode, COUNT(*) AS count
      FROM body_ownership_log
      WHERE timestamp > NOW() - INTERVAL '30 days'
      GROUP BY mode
    `);
    report.ownership_distribution = Object.fromEntries(rows.map(r => [r.mode, parseInt(r.count)]));
  } catch {}

  // Anti-decay status
  try {
    const { rows: [trend] } = await pool.query(
      `SELECT crm_current, crm_delta FROM anti_decay_trends WHERE horizon = 'medium' ORDER BY computed_at DESC LIMIT 1`
    );
    report.anti_decay = trend || { crm_current: null, crm_delta: null };
  } catch {}

  // Refusals
  try {
    const { rows: [refusalCount] } = await pool.query(
      `SELECT COUNT(*) AS total FROM identity_events WHERE event_type = 'refusal' AND event_at > NOW() - INTERVAL '365 days'`
    );
    report.refusals_this_year = parseInt(refusalCount.total);
  } catch {}

  report.generated_at = new Date().toISOString();
  return report;
}

export async function recordConsentReview(userAction, notes = '') {
  const report = await generateConsentReport();
  let opTime = 0;
  try {
    const { rows: [r] } = await pool.query(
      `SELECT COALESCE(SUM(duration_ms), 0)::bigint AS total FROM operating_time_log WHERE duration_ms IS NOT NULL`
    );
    opTime = Number(r.total) || 0;
  } catch {}

  const { rows: [review] } = await pool.query(
    `INSERT INTO consent_reviews (capabilities_summary, access_patterns, accumulated_state, operating_time_at_ms, user_action, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      JSON.stringify(report.capabilities_exercised || {}),
      JSON.stringify(report.most_observed_apps || []),
      JSON.stringify(report.accumulated_state || {}),
      opTime, userAction, notes
    ]
  );

  return review;
}

export default {
  getActiveConventions, proposeConventionUpdate,
  recordOwnershipChange, checkConventionDrift,
  checkConsentRenewal, generateConsentReport, recordConsentReview
};
