// OCA Self-Build Outcome Logger
// Hook that fires after build-outcome-verifier; inserts a row into
// self_build_outcomes with skill_name, success, duration_ms, error_message,
// test_command, and timestamp.
import { pool, emit, on } from '../../event-bus.js';

let unsubBuildVerified = null;
let unsubBuildFailed = null;
let active = false;

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS self_build_outcomes (
      id SERIAL PRIMARY KEY,
      skill_name TEXT NOT NULL,
      success BOOLEAN NOT NULL,
      duration_ms INTEGER,
      error_message TEXT,
      test_command TEXT,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS self_build_outcomes_skill_name_idx
      ON self_build_outcomes (skill_name)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS self_build_outcomes_timestamp_idx
      ON self_build_outcomes (timestamp DESC)
  `);
}

async function insertOutcome({ skillName, success, durationMs, errorMessage, testCommand }) {
  const { rows } = await pool.query(
    `INSERT INTO self_build_outcomes
       (skill_name, success, duration_ms, error_message, test_command)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [skillName, success, durationMs ?? null, errorMessage ?? null, testCommand ?? null]
  );
  return rows[0].id;
}

async function handleBuildVerified(event) {
  const { payload } = event;
  if (!payload) return;

  const skillName = payload.skillName || payload.skill_name;
  if (!skillName) return;

  try {
    const id = await insertOutcome({
      skillName,
      success: true,
      durationMs: payload.durationMs || payload.duration_ms || null,
      errorMessage: null,
      testCommand: payload.testCommand || payload.test_command || null,
    });

    console.log(`[self-build-outcome-logger] Logged success for "${skillName}" (row #${id})`);

    await emit('self_build:outcome_logged', 'motor/self-build-outcome-logger', {
      outcomeId: id,
      skillName,
      success: true,
    }, { priority: 0.5 });
  } catch (err) {
    console.error(`[self-build-outcome-logger] Failed to log success for "${skillName}":`, err.message);
  }
}

async function handleBuildFailed(event) {
  const { payload } = event;
  if (!payload) return;

  const skillName = payload.skillName || payload.skill_name;
  if (!skillName) return;

  try {
    const id = await insertOutcome({
      skillName,
      success: false,
      durationMs: payload.durationMs || payload.duration_ms || null,
      errorMessage: payload.errorMessage || payload.error_message || payload.error || payload.reason || null,
      testCommand: payload.testCommand || payload.test_command || null,
    });

    console.log(`[self-build-outcome-logger] Logged failure for "${skillName}" (row #${id})`);

    await emit('self_build:outcome_logged', 'motor/self-build-outcome-logger', {
      outcomeId: id,
      skillName,
      success: false,
    }, { priority: 0.5 });
  } catch (err) {
    console.error(`[self-build-outcome-logger] Failed to log failure for "${skillName}":`, err.message);
  }
}

async function start() {
  if (active) return;
  active = true;

  await ensureSchema();

  unsubBuildVerified = on('build_verified', handleBuildVerified);
  unsubBuildFailed = on('build_failed', handleBuildFailed);

  // Also listen to the colon-namespaced variants emitted by some layers
  on('build:verified', handleBuildVerified);
  on('build:failed', handleBuildFailed);

  console.log('[self-build-outcome-logger] Active — listening for build_verified / build_failed events');
}

function stop() {
  if (!active) return;
  active = false;
  if (unsubBuildVerified) { unsubBuildVerified(); unsubBuildVerified = null; }
  if (unsubBuildFailed) { unsubBuildFailed(); unsubBuildFailed = null; }
  console.log('[self-build-outcome-logger] Stopped');
}

async function logOutcome({ skillName, success, durationMs, errorMessage, testCommand }) {
  if (!skillName) throw new Error('skillName is required');
  if (typeof success !== 'boolean') throw new Error('success must be a boolean');

  await ensureSchema();
  const id = await insertOutcome({ skillName, success, durationMs, errorMessage, testCommand });

  await emit('self_build:outcome_logged', 'motor/self-build-outcome-logger', {
    outcomeId: id,
    skillName,
    success,
  }, { priority: 0.5 });

  return id;
}

async function getOutcomes({ skillName, limit = 50, successOnly = null } = {}) {
  let query = 'SELECT * FROM self_build_outcomes';
  const params = [];
  const conditions = [];

  if (skillName) {
    params.push(skillName);
    conditions.push(`skill_name = $${params.length}`);
  }
  if (successOnly === true) {
    conditions.push('success = TRUE');
  } else if (successOnly === false) {
    conditions.push('success = FALSE');
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  params.push(limit);
  query += ` ORDER BY timestamp DESC LIMIT $${params.length}`;

  const { rows } = await pool.query(query, params);
  return rows;
}

async function getStats(skillName = null) {
  const params = skillName ? [skillName] : [];
  const where = skillName ? 'WHERE skill_name = $1' : '';

  const { rows } = await pool.query(
    `SELECT
       skill_name,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE success = TRUE) AS successes,
       COUNT(*) FILTER (WHERE success = FALSE) AS failures,
       ROUND(AVG(duration_ms)) AS avg_duration_ms,
       MAX(timestamp) AS last_outcome_at
     FROM self_build_outcomes
     ${where}
     GROUP BY skill_name
     ORDER BY last_outcome_at DESC`,
    params
  );
  return rows;
}

export default {
  start,
  stop,
  logOutcome,
  getOutcomes,
  getStats,
  ensureSchema,
  isActive: () => active,
};