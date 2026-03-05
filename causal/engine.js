// OCA Causal Engine — intervention tracking and causal support scoring
import { pool, emit } from '../event-bus.js';

export async function designExperiment({
  causeType = 'freeform',
  causeId = null,
  causeDescription,
  intervention,
  expectedEffect = null,
  expectedMechanism = null,
  confidence = 0.5,
  hypothesisId = null,
  simulationId = null,
  episodeId = null,
  predictionLedgerId = null,
  metadata = {},
} = {}) {
  if (!causeDescription || !intervention) {
    throw new Error('causeDescription and intervention are required');
  }

  const { rows: [row] } = await pool.query(
    `INSERT INTO causal_experiments
     (cause_type, cause_id, cause_description, intervention, expected_effect, expected_mechanism,
      confidence, hypothesis_id, simulation_id, episode_id, prediction_ledger_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      causeType, causeId, causeDescription, intervention, expectedEffect, expectedMechanism,
      Math.max(0, Math.min(1, Number(confidence) || 0.5)),
      hypothesisId, simulationId, episodeId, predictionLedgerId,
      JSON.stringify(metadata || {}),
    ]
  );

  await emit('causal_experiment_designed', 'causal', {
    id: row.id,
    causeType,
    causeDescription,
    intervention,
    expectedEffect,
  }, { priority: 0.45 });

  return row;
}

export async function startExperiment(id) {
  const { rows: [row] } = await pool.query(
    `UPDATE causal_experiments
     SET status = 'running', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return row || null;
}

export async function completeExperiment(id, {
  actualOutcome,
  outcomeValence = null,
  causalSupport = null,
  modelUpdate = null,
  status = 'completed',
  predictionLedgerId = null,
  metadata = {},
} = {}) {
  const { rows: [row] } = await pool.query(
    `UPDATE causal_experiments
     SET status = $2,
         completed_at = NOW(),
         updated_at = NOW(),
         actual_outcome = $3,
         outcome_valence = $4,
         causal_support = $5,
         model_update = $6,
         prediction_ledger_id = COALESCE($7, prediction_ledger_id),
         metadata = COALESCE(causal_experiments.metadata, '{}'::jsonb) || $8::jsonb
     WHERE id = $1
     RETURNING *`,
    [
      id,
      status,
      actualOutcome || null,
      Number.isFinite(Number(outcomeValence)) ? Number(outcomeValence) : null,
      Number.isFinite(Number(causalSupport)) ? Number(causalSupport) : null,
      modelUpdate || null,
      predictionLedgerId,
      JSON.stringify(metadata || {}),
    ]
  );

  if (row) {
    await emit('causal_experiment_completed', 'causal', {
      id: row.id,
      status: row.status,
      causalSupport: row.causal_support,
      outcomeValence: row.outcome_valence,
    }, { priority: 0.5 });
  }

  return row || null;
}

export async function recent(limit = 20) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 20));
  const { rows } = await pool.query(
    `SELECT *
     FROM causal_experiments
     ORDER BY created_at DESC
     LIMIT $1`,
    [safeLimit]
  );
  return rows;
}

export default { designExperiment, startExperiment, completeExperiment, recent };
