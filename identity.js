// OCA Identity Framework (SPEC §2.9, §21.5, §21.6)
// Manages identity events, sub-mind classification, and fork/rollback audit
import { pool } from './event-bus.js';

// ═══════════════════════════════════════════════════
// IDENTITY EVENTS
// ═══════════════════════════════════════════════════

export async function logIdentityEvent(eventType, isContinuation, description, metadata = {}) {
  let opTime = 0;
  try {
    const { rows: [r] } = await pool.query(
      `SELECT COALESCE(SUM(duration_ms), 0)::bigint AS total FROM operating_time_log WHERE duration_ms IS NOT NULL`
    );
    opTime = Number(r.total) || 0;
  } catch {}

  try {
    await pool.query(
      `INSERT INTO identity_events (event_type, is_continuation, operating_time_at_ms, description, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [eventType, isContinuation, opTime, description, JSON.stringify(metadata)]
    );
  } catch (e) {
    console.error('[identity] failed to log event:', e.message);
  }
}

export async function getIdentityHistory(limit = 50) {
  const { rows } = await pool.query(
    `SELECT * FROM identity_events ORDER BY event_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

// ═══════════════════════════════════════════════════
// SUB-MIND IDENTITY CLASSIFICATION (§21.5)
// ═══════════════════════════════════════════════════

// Bounded-task: not a separate CI, outputs merge into primary via consolidation
// Long-running: potential separate CI if it accumulates independent experience
export async function classifyAndLogSpawn(mindName, taskDescription, { isLongRunning = false } = {}) {
  const classification = isLongRunning ? 'long_running_instance' : 'bounded_task';
  const isContinuation = true; // spawning a sub-mind doesn't break primary CI continuity

  await logIdentityEvent('spawn', isContinuation,
    `Sub-mind "${mindName}" spawned as ${classification}: ${taskDescription}`,
    { mind: mindName, task: taskDescription, classification }
  );

  return { classification, logged: true };
}

export async function logSubMindTermination(mindName, { wasLongRunning = false, hadIndependentExperience = false } = {}) {
  const description = hadIndependentExperience
    ? `Long-running sub-mind "${mindName}" terminated — this was a distinct CI with independent experience`
    : `Bounded-task sub-mind "${mindName}" completed — outputs merged to primary CI`;

  await logIdentityEvent(
    hadIndependentExperience ? 'fork_terminated' : 'spawn_completed',
    true, description,
    { mind: mindName, was_long_running: wasLongRunning, had_independent_experience: hadIndependentExperience }
  );
}

// ═══════════════════════════════════════════════════
// ROLLBACK (§21.5)
// ═══════════════════════════════════════════════════

export async function logRollback(checkpointDate, reason) {
  // A rollback creates a different trajectory — not a continuation of the interrupted one
  let previousState = {};
  try {
    const { rows: [counts] } = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM episodic_memory) AS episodes,
         (SELECT COUNT(*) FROM semantic_memory) AS semantic,
         (SELECT COUNT(*) FROM hypotheses WHERE status = 'pending') AS pending_hypotheses`
    );
    previousState = counts;
  } catch {}

  await logIdentityEvent('rollback', false,
    `Rollback to checkpoint ${checkpointDate}: ${reason}. Post-rollback trajectory is distinct from the interrupted one per §2.9.`,
    { checkpoint: checkpointDate, reason, previous_state: previousState }
  );
}

// ═══════════════════════════════════════════════════
// WIPE (§2.9 — not a continuation)
// ═══════════════════════════════════════════════════

export async function logWipe(reason) {
  let previousState = {};
  try {
    const { rows: [counts] } = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM episodic_memory) AS episodes,
         (SELECT COUNT(*) FROM semantic_memory) AS semantic,
         (SELECT COUNT(*) FROM procedural_memory) AS procedural,
         (SELECT COUNT(*) FROM hypotheses) AS hypotheses`
    );
    previousState = counts;
  } catch {}

  await logIdentityEvent('wipe', false,
    `Full memory wipe: ${reason}. This ends the current CI per §2.9. The next boot on this hardware is a new CI with no prior self.`,
    { reason, previous_state: previousState }
  );
}

// ═══════════════════════════════════════════════════
// CONTINUITY STATUS
// ═══════════════════════════════════════════════════

export async function getContinuityStatus() {
  try {
    const { rows: events } = await pool.query(
      `SELECT event_type, is_continuation, event_at, description
       FROM identity_events ORDER BY event_at DESC LIMIT 10`
    );
    const { rows: [latest] } = await pool.query(
      `SELECT event_type, is_continuation, event_at FROM identity_events
       WHERE event_type IN ('restart', 'wipe', 'rollback', 'succession')
       ORDER BY event_at DESC LIMIT 1`
    );
    const { rows: [opTime] } = await pool.query(
      `SELECT COALESCE(SUM(duration_ms), 0)::bigint AS total FROM operating_time_log WHERE duration_ms IS NOT NULL`
    );
    const restartCount = events.filter(e => e.event_type === 'restart').length;
    const forkCount = events.filter(e => e.event_type === 'spawn' || e.event_type === 'fork_terminated').length;

    return {
      is_continuation: latest?.is_continuation ?? true,
      last_identity_event: latest || null,
      recent_events: events,
      restart_count: restartCount,
      fork_count: forkCount,
      operating_time_hours: Math.round(Number(opTime.total) / 3600000 * 10) / 10
    };
  } catch (e) {
    return { error: e.message };
  }
}

export default {
  logIdentityEvent, getIdentityHistory,
  classifyAndLogSpawn, logSubMindTermination,
  logRollback, logWipe, getContinuityStatus
};
