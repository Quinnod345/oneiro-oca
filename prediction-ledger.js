// Unified prediction ledger helpers
import { pool } from './event-bus.js';

function safeJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  return { value };
}

function cleanStatus(status, success) {
  if (status) return status;
  if (success === false) return 'failed';
  if (success === true) return 'completed';
  return 'completed';
}

export async function startPrediction({
  actionSource,
  actionType,
  actionDetails = {},
  expectedOutcome = null,
  expectedStructured = null,
  confidence = 0.5,
  hypothesisId = null,
  simulationId = null,
  procedureId = null,
  motorCommandId = null,
  metadata = {},
} = {}) {
  if (!actionSource || !actionType) return null;

  try {
    const { rows: [row] } = await pool.query(
      `INSERT INTO prediction_ledger
       (action_source, action_type, action_details, expected_outcome, expected_structured,
        confidence, hypothesis_id, simulation_id, procedure_id, motor_command_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        actionSource,
        actionType,
        JSON.stringify(safeJson(actionDetails)),
        expectedOutcome,
        expectedStructured ? JSON.stringify(expectedStructured) : null,
        Math.max(0, Math.min(1, Number(confidence) || 0.5)),
        hypothesisId,
        simulationId,
        procedureId,
        motorCommandId,
        JSON.stringify(safeJson(metadata)),
      ]
    );
    return row?.id || null;
  } catch {
    return null;
  }
}

export async function completePrediction(
  ledgerId,
  {
    observedOutcome = null,
    observedStructured = null,
    observedAt = null,
    success = null,
    status = null,
    evaluationMode = null,
    evaluationReason = null,
    verifiability = null,
    predictionError = null,
    metadata = {},
  } = {}
) {
  if (!ledgerId) return null;

  try {
    const mergedMeta = safeJson(metadata);
    await pool.query(
      `UPDATE prediction_ledger SET
         updated_at = NOW(),
         observed_outcome = $2,
         observed_structured = $3,
         observed_at = COALESCE($4, NOW()),
         success = $5,
         status = $6,
         evaluation_mode = $7,
         evaluation_reason = $8,
         verifiability = $9,
         prediction_error = $10,
         metadata = COALESCE(prediction_ledger.metadata, '{}'::jsonb) || $11::jsonb
       WHERE id = $1`,
      [
        ledgerId,
        observedOutcome,
        observedStructured ? JSON.stringify(observedStructured) : null,
        observedAt,
        success,
        cleanStatus(status, success),
        evaluationMode,
        evaluationReason,
        verifiability,
        Number.isFinite(Number(predictionError)) ? Number(predictionError) : null,
        JSON.stringify(mergedMeta),
      ]
    );
    return ledgerId;
  } catch {
    return null;
  }
}

export function computeErrorFromEvaluation({ confirmed, score, verifiable } = {}) {
  if (!verifiable) return null;
  if (typeof score === 'number' && Number.isFinite(score)) {
    return Math.max(0, Math.min(1, 1 - score));
  }
  return confirmed ? 0 : 1;
}

export default { startPrediction, completePrediction, computeErrorFromEvaluation };
