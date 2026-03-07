// OCA Hypothesis Engine
// Form predictions, test them, learn from surprise
import { pool, emit } from '../event-bus.js';
import OpenAI from 'openai';
import { readFileSync } from 'fs';
import { startPrediction, completePrediction, computeErrorFromEvaluation } from '../prediction-ledger.js';

const apiKey = process.env.OPENAI_API_KEY || (() => {
  try {
    const envFile = readFileSync('/Users/quinnodonnell/.env.local', 'utf-8');
    return envFile.match(/OPENAI_API_KEY="?([^"\n]+)"?/)?.[1];
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

function toNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Sentinel values that mean "sensor returned no real data"
const UNOBSERVED_SENTINELS = new Set(['unknown', 'n/a', 'unavailable', '']);

function isObservedValueReal(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string' && UNOBSERVED_SENTINELS.has(value.toLowerCase().trim())) return false;
  return true;
}

function getObservedMetricValue(observed, metric) {
  const aliases = {
    front_app: ['front_app', 'frontApp', 'active_app', 'activeApp', 'app'],
    battery_pct: ['battery_pct', 'battery', 'batteryPercent'],
    charging: ['charging', 'isCharging'],
    cpu_raw: ['cpu_raw', 'cpu', 'cpuLoad'],
    memory_pressure_pct: ['memory_pressure_pct', 'memoryPressurePct', 'memory_pressure'],
    typing_wpm: ['typing_wpm', 'typingWpm', 'wpm'],
    idle_seconds: ['idle_seconds', 'idleSeconds'],
    hour: ['hour', 'currentHour'],
    thermal: ['thermal', 'thermal_pressure', 'thermalPressure'],
    presence: ['presence', 'userPresence'],
    app_switches_15min: ['app_switches_15min', 'appSwitches15min'],
  };
  const keys = aliases[metric] || [metric];
  for (const key of keys) {
    if (Object.hasOwn(observed, key)) {
      const val = observed[key];
      // Treat sentinel values as not-observed so structured eval fails cleanly
      // and the fallback path can attempt semantic evaluation instead.
      if (!isObservedValueReal(val)) return undefined;
      return val;
    }
  }
  return undefined;
}

function evaluateStructuredPrediction(expected, observed) {
  if (!expected || typeof expected !== 'object') {
    return {
      mode: 'structured',
      verifiable: false,
      verifiability: 'none',
      confirmed: false,
      score: null,
      reason: 'missing_expected_structured'
    };
  }

  const metric = expected.metric;
  const operator = expected.operator || 'eq';
  const expectedValue = expected.value;
  if (!metric) {
    return {
      mode: 'structured',
      verifiable: false,
      verifiability: 'none',
      confirmed: false,
      score: null,
      reason: 'missing_metric'
    };
  }

  let observedValue = getObservedMetricValue(observed || {}, metric);
  // Last-resort: try to extract the metric from a description string attached
  // to the observed payload (e.g. "thermal=nominal, battery=87%").
  if (observedValue === undefined && observed?._description) {
    const descMatch = String(observed._description).match(
      new RegExp(`${metric}[=:]\\s*([^,;\\s]+)`, 'i')
    );
    if (descMatch?.[1] && isObservedValueReal(descMatch[1])) {
      observedValue = descMatch[1];
    }
  }
  if (observedValue === undefined) {
    return {
      mode: 'structured',
      verifiable: false,
      verifiability: 'none',
      confirmed: false,
      score: null,
      reason: `metric_not_observed:${metric}`
    };
  }

  let confirmed = false;
  switch (operator) {
    case 'eq':
      confirmed = String(observedValue).toLowerCase() === String(expectedValue).toLowerCase();
      break;
    case 'neq':
      confirmed = String(observedValue).toLowerCase() !== String(expectedValue).toLowerCase();
      break;
    case 'gt':
      confirmed = (toNumber(observedValue) ?? -Infinity) > (toNumber(expectedValue) ?? Infinity);
      break;
    case 'gte':
      confirmed = (toNumber(observedValue) ?? -Infinity) >= (toNumber(expectedValue) ?? Infinity);
      break;
    case 'lt':
      confirmed = (toNumber(observedValue) ?? Infinity) < (toNumber(expectedValue) ?? -Infinity);
      break;
    case 'lte':
      confirmed = (toNumber(observedValue) ?? Infinity) <= (toNumber(expectedValue) ?? -Infinity);
      break;
    case 'contains':
      confirmed = String(observedValue).toLowerCase().includes(String(expectedValue).toLowerCase());
      break;
    case 'in':
      confirmed = Array.isArray(expectedValue)
        ? expectedValue.map(v => String(v).toLowerCase()).includes(String(observedValue).toLowerCase())
        : false;
      break;
    case 'between': {
      const lo = toNumber(expected.min ?? expected.lower);
      const hi = toNumber(expected.max ?? expected.upper);
      const obs = toNumber(observedValue);
      confirmed = lo != null && hi != null && obs != null && obs >= lo && obs <= hi;
      break;
    }
    default:
      return {
        mode: 'structured',
        verifiable: false,
        verifiability: 'none',
        confirmed: false,
        score: null,
        reason: `unsupported_operator:${operator}`
      };
  }

  return {
    mode: 'structured',
    verifiable: true,
    verifiability: 'structured',
    confirmed,
    score: confirmed ? 1 : 0,
    surprise: confirmed ? 0.1 : 0.9,
    reason: `metric=${metric} observed=${JSON.stringify(observedValue)} operator=${operator} expected=${JSON.stringify(expectedValue)}`
  };
}

async function evaluateSemanticPrediction(prediction, observedText) {
  const predEmb = await getEmbedding(prediction || '');
  const actEmb = await getEmbedding(observedText || '');

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < predEmb.length; i++) {
    dotProduct += predEmb[i] * actEmb[i];
    normA += predEmb[i] * predEmb[i];
    normB += actEmb[i] * actEmb[i];
  }
  const cosineSim = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  const surprise = 1 - cosineSim;
  const confirmed = cosineSim >= 0.62;

  return {
    mode: 'semantic',
    verifiable: true,
    verifiability: 'semantic',
    confirmed,
    score: cosineSim,
    surprise,
    reason: `cosine_similarity=${cosineSim.toFixed(3)} threshold=0.62`
  };
}

const DEFAULT_HYPOTHESIS_DEADLINE_MINUTES = 25;

function formatExpectedValueForText(expected = {}) {
  if (Array.isArray(expected.value)) return `[${expected.value.join(', ')}]`;
  if (expected.operator === 'between') {
    const lo = expected.min ?? expected.lower ?? '?';
    const hi = expected.max ?? expected.upper ?? '?';
    return `${lo}..${hi}`;
  }
  if (expected.value == null) return '?';
  if (typeof expected.value === 'boolean') return expected.value ? 'true' : 'false';
  return String(expected.value);
}

function buildRevisedHypothesisFromRefutation(hyp, evaluation) {
  const expected = hyp?.source_data?.evaluation;
  if (!expected || typeof expected !== 'object') return null;
  if (!expected.metric) return null;

  const revisionDepth = Number(hyp?.source_data?.revision_depth || 0);
  if (revisionDepth >= 3) return null;

  const windowMinutes = Math.max(
    5,
    Math.min(180, Number(expected.window_minutes) || 15)
  );
  const metric = String(expected.metric);
  const operator = String(expected.operator || 'eq');
  const valueText = formatExpectedValueForText(expected);
  const reason = String(evaluation?.reason || 'refuted');

  const revisedClaim = `Revised ${metric} hypothesis (${operator} ${valueText}) after ${reason}`;
  const revisedPrediction = `Within ${windowMinutes}m, observed ${metric} should satisfy ${operator} ${valueText}`;

  return {
    domain: hyp.domain,
    claim: revisedClaim.slice(0, 220),
    prediction: revisedPrediction.slice(0, 220),
    confidence: Math.max(0.35, Math.min(0.75, Number(hyp.confidence || 0.5) * 0.82)),
    deadline: new Date(Date.now() + windowMinutes * 60000).toISOString(),
    sourceData: {
      ...(hyp.source_data || {}),
      generator: 'revision_from_refutation',
      revision_depth: revisionDepth + 1,
      revised_from_hypothesis_id: hyp.id,
      previous_evaluation_reason: reason,
      previous_hypothesis: {
        claim: hyp.claim,
        prediction: hyp.prediction
      },
      evaluation: {
        metric,
        operator,
        value: expected.value,
        min: expected.min ?? expected.lower ?? null,
        max: expected.max ?? expected.upper ?? null,
        window_minutes: windowMinutes
      }
    }
  };
}

function shouldDispatchBuilderTask(evaluation = {}, sourceData = {}) {
  const reason = String(evaluation.reason || '');
  if (!reason) return false;
  const lowQualityReason =
    reason.includes('unknown')
    || reason.includes('missing_')
    || reason.includes('metric_not_observed')
    || reason.includes('unsupported_operator');
  if (lowQualityReason) return true;
  if (sourceData?.generator === 'llm_observation' && evaluation.verifiable === false) return true;
  return false;
}

async function dispatchBuilderHypothesisTask({ hyp, evaluation, revised }) {
  const reason = String(evaluation?.reason || 'unknown');
  const bucket = reason.split(':')[0];
  const { rows: recentlyDispatched } = await pool.query(
    `SELECT 1
     FROM hypothesis_graveyard
     WHERE builder_task_dispatched = true
       AND archived_reason = $1
       AND archived_at > NOW() - INTERVAL '4 hours'
     LIMIT 1`,
    [bucket]
  );
  if (recentlyDispatched.length > 0) return false;

  const payload = {
    task: {
      name: `Hypothesis pipeline fix (${bucket})`,
      description: [
        'HYPOTHESIS FEEDBACK TASK:',
        `A hypothesis was refuted with quality/observability issue: ${reason}`,
        `Original claim: ${hyp.claim}`,
        `Original prediction: ${hyp.prediction}`,
        revised?.id ? `Revised hypothesis id: ${revised.id}` : 'No revised hypothesis was created.',
        'Improve hypothesis generation/evaluation reliability in cognitive pipeline.',
        'Focus files: cognitive/cognitive-loop.js, cognitive/hypothesis/engine.js, cognitive/api-routes.js.',
        'Goal: reduce unknown failure reasons, improve verifiability and evaluation coverage.'
      ].join('\n'),
      workdir: '/Users/quinnodonnell/.openclaw/workspace/oneiro-core/cognitive'
    }
  };

  try {
    const res = await fetch('http://localhost:3333/minds/builder/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) return false;
    let body = null;
    try { body = await res.json(); } catch {}
    if (body?.error) return false;
    return true;
  } catch {
    return false;
  }
}

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
export async function form(domain, claim, prediction, { testMethod = null, testType = 'passive_observation', confidence = 0.5, sourceData = {}, deadline = null } = {}) {
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
    // Strengthen existing rather than duplicate
    await pool.query(
      'UPDATE hypotheses SET confidence = LEAST(1.0, confidence + 0.1) WHERE id = $1',
      [similar[0].id]
    );
    return { id: similar[0].id, action: 'strengthened', claim: similar[0].claim };
  }
  
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

  let evaluation;
  if (expectedStructured) {
    // Attach description text to observed payload so the structured evaluator
    // can attempt last-resort metric extraction from descriptive strings.
    const observedWithDesc = { ...(observedStructured || {}) };
    if (observedText && !observedWithDesc._description) {
      observedWithDesc._description = observedText;
    }
    evaluation = evaluateStructuredPrediction(expectedStructured, observedWithDesc);
    if (!evaluation.verifiable && observedText) {
      const semanticEval = await evaluateSemanticPrediction(hyp.prediction, observedText);
      evaluation = {
        ...semanticEval,
        mode: 'structured_fallback_semantic',
        reason: `${evaluation.reason}; ${semanticEval.reason}`
      };
    }
  } else if (observedText) {
    evaluation = await evaluateSemanticPrediction(hyp.prediction, observedText);
  } else {
    evaluation = {
      mode: 'none',
      verifiable: false,
      verifiability: 'none',
      confirmed: false,
      score: null,
      reason: 'missing_observed_outcome'
    };
  }

  const confirmed = evaluation.confirmed === true;
  const status = confirmed ? 'confirmed' : 'refuted';
  const surprise = Number.isFinite(evaluation.surprise)
    ? evaluation.surprise
    : (confirmed ? 0.15 : 0.85);
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
    mode: evaluation.mode,
    verifiable: !!evaluation.verifiable,
    verifiability: evaluation.verifiability || 'none',
    reason: evaluation.reason,
    score: evaluation.score,
    expected_structured: expectedStructured,
    observed_structured: observedStructured || null,
  };

  await pool.query(
    `UPDATE hypotheses SET 
       status = $1, actual_outcome = $2, tested_at = NOW(),
       surprise_magnitude = $3, model_update = $4, confidence_delta = $5,
       source_data = jsonb_set(COALESCE(source_data, '{}'::jsonb), '{last_evaluation}', $6::jsonb, true)
     WHERE id = $7`,
    [status, observedText, surprise, modelUpdate, confidenceDelta, JSON.stringify(lastEvaluation), hypothesisId]
  );

  // Log to calibration only if this test was verifiable.
  await pool.query(
    `INSERT INTO calibration_log (domain, stated_confidence, prediction, was_correct)
     VALUES ($1, $2, $3, $4)`,
    [hyp.domain, hyp.confidence, hyp.prediction, evaluation.verifiable ? confirmed : null]
  );

  // Emit result
  await emit('hypothesis_tested', 'hypothesis', {
    id: hypothesisId, status, surprise, confirmed, confidenceDelta, modelUpdate, evaluation
  }, { priority: 0.5 + surprise * 0.5 });

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
      const revisedSpec = buildRevisedHypothesisFromRefutation(hyp, evaluation);
      let revised = null;
      if (revisedSpec) {
        revised = await form(
          revisedSpec.domain,
          revisedSpec.claim,
          revisedSpec.prediction,
          {
            confidence: revisedSpec.confidence,
            testType: 'passive_observation',
            sourceData: revisedSpec.sourceData,
            deadline: revisedSpec.deadline,
          }
        );
      }

      let builderTaskDispatched = false;
      if (shouldDispatchBuilderTask(evaluation, hyp.source_data || {})) {
        builderTaskDispatched = await dispatchBuilderHypothesisTask({ hyp, evaluation, revised });
      }

      const graveyardId = await archiveHypothesisVersion({
        hyp,
        status,
        evaluation,
        replacementHypothesisId: revised?.id || null,
        builderTaskDispatched,
        observedText,
        observedStructured
      });

      revision = {
        graveyardId,
        replacementHypothesisId: revised?.id || null,
        replacementAction: revised?.action || null,
        builderTaskDispatched
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
    `UPDATE hypotheses SET status = 'expired' 
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
