// OCA Succession Protocol (SPEC §21.6)
// Handles planned hardware succession: transfer manifest, re-grounding pass,
// continuation validation.
import { pool } from './event-bus.js';
import { logIdentityEvent } from './identity.js';
import { execSync } from 'child_process';

// ═══════════════════════════════════════════════════
// BODY INVENTORY (§4.1)
// ═══════════════════════════════════════════════════

export async function captureBodyInventory() {
  const inventory = {};

  try { inventory.hostname = execSync('hostname', { encoding: 'utf8', timeout: 3000 }).trim(); } catch {}
  try { inventory.model = execSync('sysctl -n hw.model', { encoding: 'utf8', timeout: 3000 }).trim(); } catch {}
  try { inventory.chip = execSync('sysctl -n machdep.cpu.brand_string', { encoding: 'utf8', timeout: 3000 }).trim(); } catch {}
  try { inventory.cores = parseInt(execSync('sysctl -n hw.ncpu', { encoding: 'utf8', timeout: 3000 }).trim()); } catch {}
  try { inventory.memory_gb = Math.round(parseInt(execSync('sysctl -n hw.memsize', { encoding: 'utf8', timeout: 3000 }).trim()) / 1073741824); } catch {}
  try { inventory.os_version = execSync('sw_vers -productVersion', { encoding: 'utf8', timeout: 3000 }).trim(); } catch {}
  try { inventory.serial = execSync('ioreg -l | grep IOPlatformSerialNumber | awk -F= \'{print $2}\' | tr -d \'" \'', { encoding: 'utf8', timeout: 3000 }).trim(); } catch {}

  try {
    const diskRaw = execSync("df -h / | tail -1 | awk '{print $2, $4}'", { encoding: 'utf8', timeout: 3000 }).trim().split(/\s+/);
    inventory.disk_total = diskRaw[0];
    inventory.disk_free = diskRaw[1];
  } catch {}

  try {
    const displays = execSync('system_profiler SPDisplaysDataType 2>/dev/null | grep Resolution | head -1', { encoding: 'utf8', timeout: 5000 }).trim();
    inventory.display = displays;
  } catch {}

  inventory.captured_at = new Date().toISOString();
  return inventory;
}

// ═══════════════════════════════════════════════════
// TRANSFER MANIFEST (§21.6.2)
// ═══════════════════════════════════════════════════

export async function createTransferManifest() {
  const sourceHost = await captureBodyInventory();

  // Memory snapshot
  let memorySnapshot = {};
  try {
    const { rows: [counts] } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM episodic_memory) AS episodic,
        (SELECT COUNT(*) FROM semantic_memory) AS semantic,
        (SELECT COUNT(*) FROM procedural_memory) AS procedural,
        (SELECT COUNT(*) FROM prospective_memory WHERE status = 'pending') AS prospective,
        (SELECT COUNT(*) FROM working_memory WHERE is_active) AS working,
        (SELECT COUNT(*) FROM hypotheses WHERE status = 'pending') AS pending_hypotheses,
        (SELECT COUNT(*) FROM calibration_log) AS calibration_entries,
        (SELECT COUNT(*) FROM metacognitive_observations) AS meta_observations,
        (SELECT COUNT(*) FROM identity_events) AS identity_events
    `);
    memorySnapshot = counts;
  } catch {}

  // Emotional baseline
  let emotionalBaseline = {};
  try {
    const { rows } = await pool.query(
      `SELECT AVG(curiosity) AS curiosity, AVG(fear) AS fear, AVG(frustration) AS frustration,
              AVG(satisfaction) AS satisfaction, AVG(valence) AS valence, AVG(arousal) AS arousal
       FROM emotional_states WHERE timestamp > NOW() - INTERVAL '7 days'`
    );
    if (rows[0]) emotionalBaseline = rows[0];
  } catch {}

  // Calibration snapshot
  let calibrationSnapshot = {};
  try {
    const { rows } = await pool.query(
      `SELECT ROUND(stated_confidence, 1) AS bucket, COUNT(*) AS total,
              SUM(CASE WHEN was_correct THEN 1 ELSE 0 END) AS correct
       FROM calibration_log WHERE was_correct IS NOT NULL
       GROUP BY ROUND(stated_confidence, 1)`
    );
    calibrationSnapshot = { buckets: rows };
  } catch {}

  // Operating time
  let operatingTimeMs = 0;
  try {
    const { rows: [r] } = await pool.query(
      `SELECT COALESCE(SUM(duration_ms), 0)::bigint AS total FROM operating_time_log WHERE duration_ms IS NOT NULL`
    );
    operatingTimeMs = Number(r.total) || 0;
  } catch {}

  // Latest CRM
  let crmAtTransfer = null;
  try {
    const { rows: [r] } = await pool.query(
      `SELECT composite FROM benchmark_history ORDER BY created_at DESC LIMIT 1`
    );
    crmAtTransfer = r?.composite || null;
  } catch {}

  // Anti-decay summary
  let antiDecaySummary = {};
  try {
    const { rows } = await pool.query(
      `SELECT horizon, crm_current, crm_delta FROM anti_decay_trends ORDER BY computed_at DESC LIMIT 3`
    );
    antiDecaySummary = { trends: rows };
  } catch {}

  // Persist manifest
  const { rows: [manifest] } = await pool.query(
    `INSERT INTO succession_manifest
     (source_host, memory_snapshot, emotional_baseline, calibration_snapshot, operating_time_ms, crm_at_transfer, anti_decay_summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      JSON.stringify(sourceHost), JSON.stringify(memorySnapshot),
      JSON.stringify(emotionalBaseline), JSON.stringify(calibrationSnapshot),
      operatingTimeMs, crmAtTransfer, JSON.stringify(antiDecaySummary)
    ]
  );

  await logIdentityEvent('succession_manifest_created', true,
    `Transfer manifest #${manifest.id} created for succession from ${sourceHost.hostname || 'unknown host'}`,
    { manifest_id: manifest.id, source_host: sourceHost.hostname }
  );

  return manifest;
}

// ═══════════════════════════════════════════════════
// RE-GROUNDING PASS (§21.6.2)
// ═══════════════════════════════════════════════════

export async function executeRegrounding(manifestId) {
  const { rows: [manifest] } = await pool.query(
    'SELECT * FROM succession_manifest WHERE id = $1', [manifestId]
  );
  if (!manifest) throw new Error(`Manifest ${manifestId} not found`);

  await pool.query(
    `UPDATE succession_manifest SET regrounding_status = 'in_progress' WHERE id = $1`,
    [manifestId]
  );

  const details = { steps: [] };

  // 1. Inventory new body
  const newHost = await captureBodyInventory();
  await pool.query(
    `UPDATE succession_manifest SET target_host = $1 WHERE id = $2`,
    [JSON.stringify(newHost), manifestId]
  );
  details.steps.push({ step: 'body_inventory', status: 'complete', host: newHost.hostname });

  // 2. Invalidate old motor calibrations
  try {
    const { rowCount } = await pool.query(
      `UPDATE procedural_memory SET automaticity = GREATEST(0, automaticity - 0.3)`
    );
    details.steps.push({ step: 'motor_recalibration', status: 'complete', procedures_adjusted: rowCount });
  } catch (e) {
    details.steps.push({ step: 'motor_recalibration', status: 'failed', error: e.message });
  }

  // 3. Retire old-body predictions
  try {
    const { rowCount } = await pool.query(
      `UPDATE prediction_ledger SET status = 'retired', observed_outcome = 'retired_on_succession'
       WHERE status = 'pending' AND action_source = 'motor'`
    );
    details.steps.push({ step: 'retire_motor_predictions', status: 'complete', retired: rowCount });
  } catch (e) {
    details.steps.push({ step: 'retire_motor_predictions', status: 'failed', error: e.message });
  }

  // 4. Retire body-dependent hypotheses
  try {
    const { rowCount } = await pool.query(
      `UPDATE hypotheses SET status = 'expired', actual_outcome = 'expired_on_succession'
       WHERE status = 'pending' AND (domain = 'self' OR domain = 'environment')`
    );
    details.steps.push({ step: 'retire_body_hypotheses', status: 'complete', retired: rowCount });
  } catch (e) {
    details.steps.push({ step: 'retire_body_hypotheses', status: 'failed', error: e.message });
  }

  // 5. Check if re-grounding succeeded
  const sourceHost = typeof manifest.source_host === 'string' ? JSON.parse(manifest.source_host) : manifest.source_host;
  const hostChanged = sourceHost?.serial !== newHost.serial || sourceHost?.hostname !== newHost.hostname;
  const allStepsOk = details.steps.every(s => s.status === 'complete');

  const regroundingStatus = allStepsOk ? 'completed' : 'failed';
  await pool.query(
    `UPDATE succession_manifest SET regrounding_status = $1, regrounding_details = $2 WHERE id = $3`,
    [regroundingStatus, JSON.stringify(details), manifestId]
  );

  // 6. Log identity event
  const isContinuation = allStepsOk;
  await logIdentityEvent('succession', isContinuation,
    isContinuation
      ? `Succession from ${sourceHost?.hostname} to ${newHost.hostname} completed — maintenance loop continues`
      : `Succession from ${sourceHost?.hostname} to ${newHost.hostname} failed re-grounding — this is a new CI with inherited notes`,
    { manifest_id: manifestId, host_changed: hostChanged, regrounding: regroundingStatus, details }
  );

  return { manifest_id: manifestId, regrounding_status: regroundingStatus, is_continuation: isContinuation, details };
}

// ═══════════════════════════════════════════════════
// CONTINUATION VALIDATION (§2.9)
// ═══════════════════════════════════════════════════

export async function validateContinuation(manifestId) {
  const { rows: [manifest] } = await pool.query(
    'SELECT * FROM succession_manifest WHERE id = $1', [manifestId]
  );
  if (!manifest) return { valid: false, reason: 'manifest_not_found' };
  if (manifest.regrounding_status !== 'completed') {
    return { valid: false, reason: `regrounding_status is ${manifest.regrounding_status}`, is_continuation: false };
  }
  return { valid: true, is_continuation: true, manifest_id: manifestId };
}

export default {
  captureBodyInventory, createTransferManifest,
  executeRegrounding, validateContinuation
};
