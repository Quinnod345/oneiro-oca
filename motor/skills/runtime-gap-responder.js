// OCA Runtime Gap Responder
// Subscribes to task:failed events, classifies failure reasons,
// triggers autonomous-builder, and retries the original task on success.
import { pool, emit, on } from '../../event-bus.js';
import autonomousBuilder from './autonomous-builder.js';

const GAP_PATTERNS = [
  { regex: /no skill found[:\s]+([a-z0-9-]+)/i, type: 'missing_skill', extractName: m => m[1] },
  { regex: /unknown task type[:\s]+([a-z0-9-]+)/i, type: 'unknown_task', extractName: m => m[1] },
  { regex: /missing tool[:\s]+([a-z0-9-]+)/i, type: 'missing_tool', extractName: m => m[1] },
  { regex: /ENOENT[^'"\n]*['"]([^'"]+\.js)['"]/i, type: 'missing_capability_file', extractName: m => {
    const parts = m[1].split('/');
    const fname = parts[parts.length - 1];
    return fname.replace(/\.js$/, '');
  }},
  { regex: /cannot find module[^'"\n]*['"]([^'"]+)['"]/i, type: 'missing_module', extractName: m => {
    const parts = m[1].split('/');
    const fname = parts[parts.length - 1];
    return fname.replace(/\.js$/, '');
  }},
  { regex: /skill\s+['"]([a-z0-9-]+)['"]\s+not registered/i, type: 'unregistered_skill', extractName: m => m[1] },
  { regex: /no handler for[:\s]+['"]?([a-z0-9:_-]+)['"]?/i, type: 'no_handler', extractName: m => m[1].replace(/:/g, '-') },
];

const pendingRetries = new Map();

let unsubTaskFailed = null;
let unsubCapBuilt = null;
let active = false;

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS capability_build_log (
      id SERIAL PRIMARY KEY,
      detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      gap_type TEXT NOT NULL,
      skill_name TEXT NOT NULL,
      error_message TEXT,
      original_task_type TEXT,
      original_task_payload JSONB,
      build_status TEXT NOT NULL DEFAULT 'queued',
      build_completed_at TIMESTAMPTZ,
      retry_emitted BOOLEAN NOT NULL DEFAULT FALSE,
      notes TEXT
    )
  `);
}

async function logGapDetected(gapType, skillName, errorMessage, originalTaskType, originalPayload) {
  const { rows } = await pool.query(
    `INSERT INTO capability_build_log
       (gap_type, skill_name, error_message, original_task_type, original_task_payload)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [gapType, skillName, errorMessage, originalTaskType, JSON.stringify(originalPayload)]
  );
  return rows[0].id;
}

async function updateBuildLog(logId, buildStatus, notes = null) {
  await pool.query(
    `UPDATE capability_build_log
     SET build_status = $1,
         build_completed_at = CASE WHEN $1 IN ('resolved', 'failed') THEN NOW() ELSE build_completed_at END,
         retry_emitted = CASE WHEN $1 = 'retried' THEN TRUE ELSE retry_emitted END,
         notes = COALESCE($2, notes)
     WHERE id = $3`,
    [buildStatus, notes, logId]
  );
}

function classifyFailure(errorMessage) {
  if (!errorMessage || typeof errorMessage !== 'string') return null;

  for (const pattern of GAP_PATTERNS) {
    const match = errorMessage.match(pattern.regex);
    if (match) {
      const rawName = pattern.extractName(match);
      const skillName = rawName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      return { type: pattern.type, skillName, rawMatch: match[0] };
    }
  }
  return null;
}

function gapKey(skillName) {
  return `gap:${skillName}`;
}

async function handleTaskFailed(event) {
  const { payload } = event;
  if (!payload) return;

  const errorMessage = payload.error || payload.message || payload.reason || '';
  const originalTaskType = payload.taskType || payload.task_type || payload.type || 'unknown';
  const originalPayload = payload.originalPayload || payload.task || payload;

  const gap = classifyFailure(errorMessage);
  if (!gap) return;

  const key = gapKey(gap.skillName);

  await emit('capability:gap:detected', 'motor/runtime-gap-responder', {
    gapType: gap.type,
    skillName: gap.skillName,
    errorMessage,
    originalTaskType,
    originalPayload,
    rawMatch: gap.rawMatch,
  }, { priority: 0.8 });

  console.log(`[runtime-gap-responder] Gap detected: ${gap.type} → skill "${gap.skillName}"`);

  if (!pendingRetries.has(key)) {
    pendingRetries.set(key, { retryCount: 0, pendingTasks: [] });
  }
  const entry = pendingRetries.get(key);
  entry.pendingTasks.push({ originalTaskType, originalPayload });

  const logId = await logGapDetected(
    gap.type,
    gap.skillName,
    errorMessage,
    originalTaskType,
    originalPayload
  );

  try {
    const description = buildGapDescription(gap, errorMessage, originalTaskType);
    await autonomousBuilder.queueGap(gap.skillName, description);
    console.log(`[runtime-gap-responder] Queued build for "${gap.skillName}" (log #${logId})`);
    await updateBuildLog(logId, 'building');
  } catch (err) {
    console.error(`[runtime-gap-responder] Failed to queue build for "${gap.skillName}":`, err.message);
    await updateBuildLog(logId, 'queue_failed', err.message);
  }
}

function buildGapDescription(gap, errorMessage, originalTaskType) {
  return [
    `Gap type: ${gap.type}`,
    `Skill needed: ${gap.skillName}`,
    `Triggered by task: ${originalTaskType}`,
    `Error: ${errorMessage.slice(0, 300)}`,
    ``,
    `This skill was required at runtime but not found.`,
    `Build a motor skill that handles "${gap.skillName}" operations.`,
    `The skill should export a default object with appropriate methods for this capability.`,
  ].join('\n');
}

async function handleCapabilityBuilt(event) {
  const { payload } = event;
  if (!payload) return;

  const skillName = payload.skillName || payload.skill_name;
  if (!skillName) return;

  const key = gapKey(skillName);
  const entry = pendingRetries.get(key);
  if (!entry || entry.pendingTasks.length === 0) return;

  const tasksToRetry = [...entry.pendingTasks];
  entry.pendingTasks = [];
  entry.retryCount += tasksToRetry.length;

  console.log(`[runtime-gap-responder] Skill "${skillName}" built — retrying ${tasksToRetry.length} task(s)`);

  for (const task of tasksToRetry) {
    try {
      await emit(task.originalTaskType, 'motor/runtime-gap-responder', {
        ...task.originalPayload,
        _retryAfterGapFill: skillName,
        _retryAttempt: entry.retryCount,
      }, { priority: 0.7 });

      await pool.query(
        `UPDATE capability_build_log
         SET build_status = 'retried', retry_emitted = TRUE, build_completed_at = NOW()
         WHERE skill_name = $1 AND build_status = 'building' AND retry_emitted = FALSE`,
        [skillName]
      );

      console.log(`[runtime-gap-responder] Re-emitted task "${task.originalTaskType}" after building "${skillName}"`);
    } catch (err) {
      console.error(`[runtime-gap-responder] Failed to re-emit task "${task.originalTaskType}":`, err.message);
      await pool.query(
        `UPDATE capability_build_log
         SET build_status = 'retry_failed', notes = $1
         WHERE skill_name = $2 AND build_status = 'building' AND retry_emitted = FALSE`,
        [err.message, skillName]
      );
    }
  }
}

async function start() {
  if (active) return;
  active = true;

  await ensureSchema();

  unsubTaskFailed = on('task:failed', handleTaskFailed);
  unsubCapBuilt = on('capability_built', handleCapabilityBuilt);

  console.log('[runtime-gap-responder] Active — listening for task:failed events');
}

function stop() {
  if (!active) return;
  active = false;
  if (unsubTaskFailed) { unsubTaskFailed(); unsubTaskFailed = null; }
  if (unsubCapBuilt) { unsubCapBuilt(); unsubCapBuilt = null; }
  pendingRetries.clear();
  console.log('[runtime-gap-responder] Stopped');
}

async function getPendingRetries() {
  return Object.fromEntries(
    [...pendingRetries.entries()].map(([k, v]) => [k, {
      pendingCount: v.pendingTasks.length,
      totalRetried: v.retryCount,
    }])
  );
}

async function getRecentLogs(limit = 20) {
  const { rows } = await pool.query(
    `SELECT * FROM capability_build_log ORDER BY detected_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

async function getStats() {
  const { rows } = await pool.query(`
    SELECT
      build_status,
      COUNT(*) AS count,
      COUNT(DISTINCT skill_name) AS unique_skills
    FROM capability_build_log
    GROUP BY build_status
  `);
  return rows;
}

export default {
  start,
  stop,
  classifyFailure,
  getPendingRetries,
  getRecentLogs,
  getStats,
  ensureSchema,
};