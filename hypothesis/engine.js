// OCA Hypothesis Engine
// Form predictions, test them, learn from surprise
import { pool, emit } from '../event-bus.js';
import { evaluateStructuredPrediction } from './evaluate.js';
import OpenAI from '../local-openai-shim.js';
import { readFileSync } from 'fs';
import { startPrediction, completePrediction, computeErrorFromEvaluation } from '../prediction-ledger.js';

const apiKey = process.env.OPENAI_API_KEY || (() => {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const envPaths = [
      `${home}/.env.local`,
      new URL('../../.env', import.meta.url),
    ];
    for (const p of envPaths) {
      try {
        const envFile = readFileSync(p, 'utf-8');
        const match = envFile.match(/OPENAI_API_KEY="?([^"\n]+)"?/)?.[1];
        if (match) return match;
      } catch {}
    }
  } catch { return undefined; }
})();
const openai = new OpenAI({ apiKey });

async function getEmbedding(text) {
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000)
  });
  return resp.data[0].embedding;
}

function normalizeOutcomePayload(actualOutcome) {
  if (typeof actualOutcome === 'string') {
    return { observedText: actualOutcome, observedStructured: null };
  }

  if (actualOutcome && typeof actualOutcome === 'object') {
    const observedText =
      actualOutcome.description
      || actualOutcome.text
      || actualOutcome.outcome
      || JSON.stringify(actualOutcome);
    const observedStructured = actualOutcome.observed || actualOutcome.structured || null;
    return { observedText, observedStructured };
  }

  return { observedText: String(actualOutcome ?? ''), observedStructured: null };
}

const DEFAULT_HYPOTHESIS_DEADLINE_MINUTES = 25;

async function archiveHypothesisVersion({
  hyp,
  status = null,
  evaluation,
  replacementHypothesisId = null,
  builderTaskDispatched = false,
  observedText = null,
  observedStructured = null
}) {
  const revisionDepth = Number(hyp?.source_data?.revision_depth || 0);
  const archiveReason = String(evaluation?.reason || 'refuted');
  const { rows: [grave] } = await pool.query(
    `INSERT INTO hypothesis_graveyard (
       hypothesis_id,
       replacement_hypothesis_id,
       domain,
       claim,
       prediction,
       confidence,
       status,
       actual_outcome,
       revision_depth,
       archived_reason,
       evaluation,
       source_data,
       builder_task_dispatched,
       metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
     ) RETURNING id`,
    [
      hyp.id,
      replacementHypothesisId,
      hyp.domain,
      hyp.claim,
      hyp.prediction,
      hyp.confidence,
      status || hyp.status,
      observedText || hyp.actual_outcome || null,
      revisionDepth,
      archiveReason,
      JSON.stringify(evaluation || {}),
      JSON.stringify(hyp.source_data || {}),
      builderTaskDispatched,
      JSON.stringify({
        observed_structured: observedStructured || null
      })
    ]
  );
  return grave?.id || null;
}

// Form a new hypothesis from an observation
export async function form(domain, claim, prediction, { testMethod = null, testType = 'passive_observation', confidence = 0.4, sourceData = {}, deadline = null } = {}) {
  const embedding = await getEmbedding(`${claim} | ${prediction}`);
  const effectiveDeadline = deadline || new Date(Date.now() + DEFAULT_HYPOTHESIS_DEADLINE_MINUTES * 60000).toISOString();
  const normalizedSourceData = {
    ...(sourceData || {}),
    lifecycle: {
      auto_sla_minutes: DEFAULT_HYPOTHESIS_DEADLINE_MINUTES,
      generated_at: new Date().toISOString(),
      ...(sourceData?.lifecycle || {})
    }
  };
  
  // Check for duplicate/similar hypotheses
  const { rows: similar } = await pool.query(
    `SELECT id, claim, status, confidence 
     FROM hypotheses 
     WHERE status = 'pending' 
       AND embedding <=> $1::vector < 0.15
     ORDER BY embedding <=> $1::vector 
     LIMIT 1`,
    [JSON.stringify(embedding)]
  );
  
  if (similar.length > 0) {
    // Repetition is not independent evidence. Return the existing belief unchanged.
    return { id: similar[0].id, action: 'duplicate', claim: similar[0].claim };
  }
  
  // Calibration adjustment — deflate confidence based on historical accuracy
  // If we've been overconfident at this level, reduce the stated confidence
  try {
    const calBucket = Math.round(confidence * 10) / 10;
    const { rows: calRows } = await pool.query(
      `SELECT actual_accuracy, total FROM calibration_curve WHERE confidence_bucket = $1`,
      [calBucket]
    );
    if (calRows.length > 0 && parseInt(calRows[0].total) >= 10) {
      const actualAccuracy = parseFloat(calRows[0].actual_accuracy);
      const deviation = confidence - actualAccuracy;
      if (deviation > 0.05) {
        // Overconfident: apply power-law correction toward actual accuracy
        // new_confidence = stated * (actual/stated)^0.3
        const ratio = Math.max(0.1, actualAccuracy / Math.max(0.1, confidence));
        const adjusted = confidence * Math.pow(ratio, 0.3);
        confidence = Math.max(0.2, Math.min(0.85, adjusted));
      }
    }
  } catch {}
  
  // Hard cap: never form a hypothesis above 0.85 — earn certainty through confirmation
  confidence = Math.min(0.85, confidence);
  
  const { rows } = await pool.query(
    `INSERT INTO hypotheses (domain, claim, confidence, prediction, prediction_deadline, test_method, test_type, source_data, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector) RETURNING id`,
    [domain, claim, confidence, prediction, effectiveDeadline, testMethod, testType, JSON.stringify(normalizedSourceData), JSON.stringify(embedding)]
  );
  
  await emit('hypothesis_formed', 'hypothesis', {
    id: rows[0].id, domain, claim, prediction, confidence
  });
  
  return { id: rows[0].id, action: 'created', claim };
}

// Test a hypothesis against an observed outcome
export async function test(hypothesisId, actualOutcome) {
  const { rows: [hyp] } = await pool.query('SELECT * FROM hypotheses WHERE id = $1', [hypothesisId]);
  if (!hyp) throw new Error(`hypothesis ${hypothesisId} not found`);

  const { observedText, observedStructured } = normalizeOutcomePayload(actualOutcome);
  const expectedStructured = hyp.source_data?.evaluation || hyp.source_data?.expected_structured || null;


  const evaluation = evaluateStructuredPrediction(expectedStructured, observedStructured || {});
  // An absent metric stays unknown; wording cannot replace the observation.

  const confirmed = evaluation.verifiable ? evaluation.confirmed === true : null;
  const status = evaluation.verifiable ? (confirmed ? 'confirmed' : 'refuted') : 'expired';
  const surprise = evaluation.verifiable ? Math.abs((confirmed ? 1 : 0) - hyp.confidence) : null;
  const confidenceDelta = evaluation.verifiable
    ? (confirmed
      ? Math.min(0.2, (1 - hyp.confidence) * 0.3)
      : -Math.min(0.3, hyp.confidence * 0.4))
    : 0;

  const modelUpdate = [
    `mode=${evaluation.mode}`,
    `verifiable=${evaluation.verifiable}`,
    `reason=${evaluation.reason}`,
    `prediction="${hyp.prediction}"`,
    `observed="${String(observedText).slice(0, 280)}"`
  ].join(' | ');

  const lastEvaluation = {
    at: new Date().toISOString(),
    engine_version: 'structured-v2',
    stated_confidence: hyp.confidence,
    predicted_at: hyp.created_at,
    mode: evaluation.mode,
    verifiable: !!evaluation.verifiable,
    verifiability: evaluation.verifiability || 'none',
    reason: evaluation.reason,
    score: evaluation.score,
    expected_structured: expectedStructured,
    observed_structured: observedStructured || null,
  };

  const persisted = await pool.query(
    `WITH settled AS (UPDATE hypotheses SET 
       status = $1, actual_outcome = $2, tested_at = NOW(),
       surprise_magnitude = $3, model_update = $4, confidence_delta = $5,
       source_data = jsonb_set(COALESCE(source_data, '{}'::jsonb), '{last_evaluation}', $6::jsonb, true)
     WHERE id = $7 AND status IN ('pending', 'testing') AND tested_at IS NULL
     RETURNING id, domain, confidence, prediction),
     calibrated AS (INSERT INTO calibration_log (domain, stated_confidence, prediction, was_correct, evaluated_at)
       SELECT domain, confidence, prediction, $8::boolean, NOW() FROM settled WHERE $8::boolean IS NOT NULL RETURNING id)
     SELECT id FROM settled`,
    [status, observedText, surprise, modelUpdate, confidenceDelta, JSON.stringify(lastEvaluation), hypothesisId, confirmed]
  );

  if (!persisted.rowCount) return { id: hypothesisId, status: 'already_evaluated', confirmed: null, evaluation, duplicate: true };

  const predictionLedgerId = await startPrediction({
    actionSource: 'hypothesis',
    actionType: 'test',
    actionDetails: { hypothesisId, domain: hyp.domain, claim: hyp.claim },
    expectedOutcome: hyp.prediction,
    expectedStructured,
    confidence: hyp.confidence,
    hypothesisId,
    metadata: { test_type: hyp.test_type, test_method: hyp.test_method },
  });

  // Emit result
  await emit('hypothesis_tested', 'hypothesis', {
    id: hypothesisId, status, surprise, confirmed, confidenceDelta, modelUpdate, evaluation
  }, { priority: 0.5 + (surprise ?? 0) * 0.5 });

  await completePrediction(predictionLedgerId, {
    observedOutcome: observedText,
    observedStructured: observedStructured || null,
    success: evaluation.verifiable ? confirmed : null,
    status: evaluation.verifiable ? 'completed' : 'unverifiable',
    evaluationMode: evaluation.mode,
    evaluationReason: evaluation.reason,
    verifiability: evaluation.verifiability || 'none',
    predictionError: computeErrorFromEvaluation(evaluation),
    metadata: { hypothesis_status: status, surprise },
  });

  let revision = null;
  if (status === 'refuted') {
    try {
      // Retain the failed prediction. Retrying the same predicate with different
      // wording is not a revised model; new attempts require new evidence.
      const graveyardId = await archiveHypothesisVersion({
        hyp,
        status,
        evaluation,
        replacementHypothesisId: null,
        builderTaskDispatched: false,
        observedText,
        observedStructured
      });

      revision = {
        graveyardId,
        replacementHypothesisId: null,
        replacementAction: null,
        builderTaskDispatched: false
      };
    } catch (e) {
      revision = { error: e.message };
    }
  }

  return { id: hypothesisId, status, surprise, confirmed, confidenceDelta, modelUpdate, evaluation, revision };
}

// Design an experiment for a hypothesis
export async function designExperiment(hypothesisId, description, steps, expectedObservations = null) {
  const { rows } = await pool.query(
    `INSERT INTO experiments (hypothesis_id, description, steps, expected_observations)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [hypothesisId, description, JSON.stringify(steps), expectedObservations ? JSON.stringify(expectedObservations) : null]
  );
  
  // Update hypothesis status
  await pool.query('UPDATE hypotheses SET status = $1 WHERE id = $2', ['testing', hypothesisId]);
  
  return { experimentId: rows[0].id };
}

// Complete an experiment
export async function completeExperiment(experimentId, observations, conclusion, worthIt = true) {
  await pool.query(
    `UPDATE experiments SET 
       status = 'completed', completed_at = NOW(),
       observations = $1, conclusion = $2, worth_it = $3
     WHERE id = $4`,
    [JSON.stringify(observations), conclusion, worthIt, experimentId]
  );
  
  // Get associated hypothesis
  const { rows: [exp] } = await pool.query('SELECT hypothesis_id FROM experiments WHERE id = $1', [experimentId]);
  if (exp?.hypothesis_id) {
    return await test(exp.hypothesis_id, conclusion);
  }
}

// Get pending hypotheses that are ready to test
export async function getPendingTests(limit = 10) {
  const { rows } = await pool.query(
    `SELECT * FROM hypotheses 
     WHERE status = 'pending' 
       AND (prediction_deadline IS NULL OR prediction_deadline > NOW())
     ORDER BY confidence DESC, created_at ASC 
     LIMIT $1`,
    [limit]
  );
  return rows;
}

// Expire overdue hypotheses
export async function expireOverdue() {
  const { rows } = await pool.query(
    `UPDATE hypotheses SET status = 'expired',
       model_update = COALESCE(model_update, 'Expired: prediction deadline passed without observable outcome'),
       surprise_magnitude = COALESCE(surprise_magnitude, 0.2)
     WHERE status = 'pending' AND prediction_deadline < NOW()
     RETURNING id, claim`
  );
  return rows;
}

// Get calibration stats
export async function getCalibration() {
  const { rows } = await pool.query(`SELECT * FROM calibration_curve`);
  return rows;
}

// Get surprise history
export async function getSurpriseHistory(days = 7) {
  const { rows } = await pool.query(
    `SELECT domain, AVG(surprise_magnitude) as avg_surprise, COUNT(*) as count
     FROM hypotheses 
     WHERE tested_at > NOW() - $1::interval AND surprise_magnitude IS NOT NULL
     GROUP BY domain`,
    [`${days} days`]
  );
  return rows;
}

export async function diagnostics({ days = 7 } = {}) {
  const { rows: [summary] } = await pool.query(
    `SELECT 
       COUNT(*) as total_created,
       COUNT(*) FILTER (WHERE status IN ('confirmed','refuted')) as total_evaluated,
       COUNT(*) FILTER (WHERE status = 'confirmed') as total_confirmed,
       COUNT(*) FILTER (
         WHERE COALESCE((source_data->'last_evaluation'->>'verifiable')::boolean, false) = true
       ) as total_verifiable
     FROM hypotheses
     WHERE created_at > NOW() - $1::interval`,
    [`${days} days`]
  );

  const { rows: reasons } = await pool.query(
    `SELECT 
       COALESCE(source_data->'last_evaluation'->>'reason', 'unknown') as reason,
       COUNT(*) as count
     FROM hypotheses
     WHERE created_at > NOW() - $1::interval
       AND status = 'refuted'
     GROUP BY reason
     ORDER BY count DESC
     LIMIT 10`,
    [`${days} days`]
  );

  const totalCreated = parseInt(summary?.total_created || 0);
  const totalEvaluated = parseInt(summary?.total_evaluated || 0);
  const totalConfirmed = parseInt(summary?.total_confirmed || 0);
  const totalVerifiable = parseInt(summary?.total_verifiable || 0);
  const accuracyOnVerifiable = totalVerifiable > 0 ? totalConfirmed / totalVerifiable : null;
  const verifiabilityRate = totalEvaluated > 0 ? totalVerifiable / totalEvaluated : null;
  const evaluationCoverage = totalCreated > 0 ? totalEvaluated / totalCreated : null;

  return {
    windowDays: days,
    totalCreated,
    totalEvaluated,
    totalConfirmed,
    totalVerifiable,
    accuracy_on_verifiable_predictions: accuracyOnVerifiable,
    verifiability_rate: verifiabilityRate,
    evaluation_coverage: evaluationCoverage,
    top_failure_reasons: reasons.map(r => ({ reason: r.reason, count: parseInt(r.count || 0) }))
  };
}

export async function failures({ days = 7, limit = 25 } = {}) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 25));
  const { rows } = await pool.query(
    `SELECT id, created_at, tested_at, claim, prediction, confidence, status,
            source_data->'last_evaluation' as evaluation
     FROM hypotheses
     WHERE created_at > NOW() - $1::interval
       AND status = 'refuted'
     ORDER BY tested_at DESC NULLS LAST, id DESC
     LIMIT $2`,
    [`${days} days`, safeLimit]
  );
  return rows;
}

export default {
  form, test, designExperiment, completeExperiment, getPendingTests,
  expireOverdue, getCalibration, getSurpriseHistory, diagnostics, failures
};
