// OCA Chinese Room Meter (CRM)
// Composite score measuring distance from "pure symbol manipulation"
// to "grounded understanding"
import { pool } from '../event-bus.js';

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

// Compute the full CRM score
export async function compute() {
  const scores = {
    grounding: await computeGroundingScore(),
    prediction: await computePredictionAccuracy(),
    transfer: await computeTransferAbility(),
    surprise: await computeSurpriseLearning(),
    creativity: await computeCreativeNovelty(),
    metacognition: await computeMetacognitiveAccuracy(),
    emotion: await computeEmotionalFunctionality(),
    counterfactual: await computeCounterfactualAccuracy(),
    causal: await computeCausalSupport()
  };
  
  // Weights (tunable)
  const weights = {
    grounding: 0.17,
    prediction: 0.16,
    transfer: 0.10,
    surprise: 0.12,
    creativity: 0.10,
    metacognition: 0.12,
    emotion: 0.08,
    counterfactual: 0.075,
    causal: 0.075
  };
  
  let composite = 0;
  for (const [key, weight] of Object.entries(weights)) {
    composite += (scores[key].score || 0) * weight;
  }
  
  return {
    composite: Math.round(composite * 1000) / 1000,
    components: scores,
    interpretation: interpret(composite),
    timestamp: new Date().toISOString()
  };
}

// 1. Grounding Score — how much cognition is grounded in experience
async function computeGroundingScore() {
  const { rows: [ep] } = await pool.query(`
    SELECT COUNT(*) as total,
           COUNT(*) FILTER (WHERE visual_hash IS NOT NULL OR audio_state != '{}' OR hid_metrics != '{}') as grounded
    FROM episodic_memory
  `);
  const { rows: [sm] } = await pool.query(`
    SELECT COUNT(*) as total,
           COUNT(*) FILTER (WHERE array_length(source_episodes, 1) > 0) as traceable
    FROM semantic_memory
  `);
  
  const total = parseInt(ep.total) || 1;
  const grounded = parseInt(ep.grounded) || 0;
  const semanticTotal = parseInt(sm?.total || 0);
  const semanticTraceable = parseInt(sm?.traceable || 0);
  const groundedRatio = grounded / total;
  const traceabilityRatio = semanticTotal > 0 ? semanticTraceable / semanticTotal : 0.5;
  const score = Math.min(1, groundedRatio * 0.7 + traceabilityRatio * 0.3 + 0.05);
  
  return {
    score,
    detail: `${grounded}/${total} episodic grounded, semantic traceability ${(traceabilityRatio * 100).toFixed(1)}%`,
    metric: 'grounded_traceable_ratio',
    grounding_ratio: groundedRatio,
    grounding_traceability: traceabilityRatio
  };
}

// 2. Prediction Accuracy — calibration quality
async function computePredictionAccuracy() {
  const { rows } = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE was_correct = true) as correct,
      AVG(ABS(stated_confidence - CASE WHEN was_correct THEN 1.0 ELSE 0.0 END)) as avg_cal_error
    FROM calibration_log
    WHERE was_correct IS NOT NULL
  `);

  const { rows: coverageRows } = await pool.query(`
    SELECT
      COUNT(*) as total_created,
      COUNT(*) FILTER (WHERE status IN ('confirmed','refuted')) as total_evaluated,
      COUNT(*) FILTER (
        WHERE COALESCE((source_data->'last_evaluation'->>'verifiable')::boolean, false) = true
      ) as total_verifiable
    FROM hypotheses
  `);

  const total = parseInt(rows[0]?.total) || 0;
  const calError = parseFloat(rows[0]?.avg_cal_error) || 0.5;
  const accuracyOnVerifiable = total > 0 ? Math.max(0, 1 - calError * 2) : 0.5;

  const totalCreated = parseInt(coverageRows[0]?.total_created) || 0;
  const totalEvaluated = parseInt(coverageRows[0]?.total_evaluated) || 0;
  const totalVerifiable = parseInt(coverageRows[0]?.total_verifiable) || 0;
  const verifiabilityRate = totalEvaluated > 0 ? totalVerifiable / totalEvaluated : 0;
  const evaluationCoverage = totalCreated > 0 ? totalEvaluated / totalCreated : 0;
  const coverageScore = Math.min(1, evaluationCoverage / 0.8); // full score near 80%+ evaluated

  // Weighted blend:
  // - accuracy on verifiable predictions is primary
  // - coverage and verifiability prevent gaming with tiny sample sizes
  let score = (accuracyOnVerifiable * 0.7) + (coverageScore * 0.2) + (verifiabilityRate * 0.1);
  if (total < 5) score = Math.min(score, 0.55);

  return {
    score,
    detail: `${rows[0].correct || 0}/${total} verifiable predictions correct, cal_error=${calError.toFixed(3)}, verifiability=${(verifiabilityRate * 100).toFixed(1)}%, coverage=${(evaluationCoverage * 100).toFixed(1)}%`,
    metric: 'prediction_quality',
    accuracy_on_verifiable_predictions: accuracyOnVerifiable,
    verifiability_rate: verifiabilityRate,
    evaluation_coverage: evaluationCoverage
  };
}

// 3. Transfer Ability — knowledge applied across domains
async function computeTransferAbility() {
  // Count cross-domain transfers from creative artifacts
  const { rows: r1 } = await pool.query(`SELECT COUNT(*) as n FROM creative_artifacts WHERE creation_method = 'cross_domain'`);
  // Also count cross-domain connections (precursors to transfer)
  const { rows: r2 } = await pool.query(`SELECT COUNT(*) as n FROM creative_artifacts WHERE creation_method = 'constrained_randomness'`);
  // Count dream episodes with novel connections (dreams = associative transfer)
  const { rows: r3 } = await pool.query(`SELECT COUNT(*) as n FROM dream_episodes WHERE contains_novel_connections = true`);
  // Count semantic memories from consolidation (episodic→semantic = a form of transfer)
  const { rows: r4 } = await pool.query(`SELECT COUNT(*) as n FROM semantic_memory WHERE source_type = 'abstraction'`);
  const { rows: trendRows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as recent,
      COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '7 days' AND created_at > NOW() - INTERVAL '14 days') as previous
    FROM creative_artifacts
    WHERE creation_method IN ('cross_domain', 'constrained_randomness')
  `);
  
  const transfers = parseInt(r1[0]?.n) || 0;
  const connections = parseInt(r2[0]?.n) || 0;
  const dreams = parseInt(r3[0]?.n) || 0;
  const abstractions = parseInt(r4[0]?.n) || 0;
  const recent = parseInt(trendRows?.[0]?.recent || 0);
  const previous = parseInt(trendRows?.[0]?.previous || 0);
  const trendDelta = (recent - previous) / Math.max(1, previous || 1);
  
  // Weighted score: full transfers worth most, but connections/dreams/abstractions count too
  const effective = transfers * 1.0 + connections * 0.5 + dreams * 0.3 + abstractions * 0.2;
  const baseScore = Math.min(1, effective / 15);
  const trendBoost = clamp01((trendDelta + 1) / 2) * 0.1;
  const score = Math.min(1, baseScore + trendBoost);
  
  return {
    score,
    detail: `${transfers} transfers, ${connections} connections, ${dreams} dreams, ${abstractions} abstractions, trend_delta=${trendDelta.toFixed(2)}`,
    metric: 'cross_domain_count',
    trend_delta: trendDelta
  };
}

// 4. Surprise Learning — speed and quality of model correction
async function computeSurpriseLearning() {
  const { rows } = await pool.query(`
    SELECT 
      COUNT(*) as total,
      AVG(surprise_magnitude) as avg_surprise,
      COUNT(*) FILTER (WHERE model_update IS NOT NULL) as updates
    FROM hypotheses
    WHERE status IN ('confirmed', 'refuted')
  `);
  
  const total = parseInt(rows[0]?.total) || 0;
  if (total < 3) return { score: 0.5, detail: 'Insufficient data', metric: 'surprise_learning' };
  
  const updateRate = (parseInt(rows[0]?.updates) || 0) / total;
  const avgSurprise = parseFloat(rows[0]?.avg_surprise) || 0.5;
  
  // Good score = reasonable surprise (not too high, not too low) + high update rate
  const surpriseBalance = 1 - Math.abs(avgSurprise - 0.3) * 2; // optimal surprise ~0.3
  const score = (surpriseBalance + updateRate) / 2;
  
  return {
    score,
    detail: `${total} hypotheses resolved, avg surprise: ${avgSurprise.toFixed(3)}, update rate: ${(updateRate*100).toFixed(1)}%`,
    metric: 'surprise_update_rate'
  };
}

// 5. Creative Novelty — genuinely new outputs over time
async function computeCreativeNovelty() {
  const { rows } = await pool.query(`
    SELECT 
      COUNT(*) as total,
      AVG(novelty_score) as avg_novelty,
      COUNT(*) FILTER (WHERE novelty_score > 0.5) as high_novelty
    FROM creative_artifacts
    WHERE novelty_score IS NOT NULL
  `);
  const { rows: trendRows } = await pool.query(`
    SELECT
      AVG(novelty_score) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as recent_avg,
      AVG(novelty_score) FILTER (WHERE created_at <= NOW() - INTERVAL '7 days' AND created_at > NOW() - INTERVAL '14 days') as prev_avg
    FROM creative_artifacts
    WHERE novelty_score IS NOT NULL
  `);
  
  // Also count dream episodes as creative output
  const { rows: dreamRows } = await pool.query(`SELECT COUNT(*) as total FROM dream_episodes`);
  const dreamCount = parseInt(dreamRows[0]?.total) || 0;
  const artifactCount = parseInt(rows[0]?.total) || 0;
  const totalCreative = artifactCount + dreamCount;
  
  if (totalCreative < 2) return { score: 0.3, detail: `Insufficient creative output (${totalCreative} total)`, metric: 'novelty' };
  
  const avgNovelty = parseFloat(rows[0]?.avg_novelty) || 0.5;
  const highRatio = artifactCount > 0 ? parseInt(rows[0]?.high_novelty) / artifactCount : 0;
  const recentAvg = parseFloat(trendRows?.[0]?.recent_avg);
  const prevAvg = parseFloat(trendRows?.[0]?.prev_avg);
  const noveltyTrendDelta = Number.isFinite(recentAvg) && Number.isFinite(prevAvg)
    ? recentAvg - prevAvg
    : 0;
  const trendBoost = clamp01((noveltyTrendDelta + 1) / 2) * 0.08;
  const score = Math.min(1, (avgNovelty + highRatio) / 2 + dreamCount * 0.05 + trendBoost);
  
  return {
    score,
    detail: `${artifactCount} artifacts + ${dreamCount} dreams, avg novelty: ${avgNovelty.toFixed(3)}, trend_delta=${noveltyTrendDelta.toFixed(3)}`,
    metric: 'avg_novelty',
    trend_delta: noveltyTrendDelta
  };
}

// 6. Metacognitive Accuracy — does self-monitoring work?
async function computeMetacognitiveAccuracy() {
  const { rows: biases } = await pool.query(
    `SELECT COUNT(*) as tracked, AVG(current_severity) as avg_severity FROM cognitive_biases WHERE instance_count > 0`
  );
  
  const { rows: stuck } = await pool.query(
    `SELECT COUNT(*) as detections FROM metacognitive_observations WHERE observation_type = 'stuck_state'`
  );
  
  const tracked = parseInt(biases[0]?.tracked) || 0;
  const detections = parseInt(stuck[0]?.detections) || 0;
  
  // Having tracked biases AND detected stuck states = good metacognition
  const awarenessScore = Math.min(1, (tracked + detections) / 10);
  // Lower average severity = better at managing detected biases
  const managementScore = 1 - Math.min(1, parseFloat(biases[0]?.avg_severity) || 0);
  
  const score = (awarenessScore + managementScore) / 2;
  
  return {
    score,
    detail: `${tracked} biases tracked, ${detections} stuck states detected`,
    metric: 'metacognitive_awareness'
  };
}

// 7. Emotional Functionality — do emotions actually modulate behavior?
async function computeEmotionalFunctionality() {
  const { rows } = await pool.query(`
    SELECT 
      COUNT(*) as states,
      STDDEV(curiosity) as curiosity_var,
      STDDEV(frustration) as frustration_var,
      STDDEV(satisfaction) as satisfaction_var,
      STDDEV(valence) as valence_var
    FROM emotional_states
    WHERE timestamp > NOW() - INTERVAL '24 hours'
  `);
  
  const states = parseInt(rows[0]?.states) || 0;
  if (states < 10) return { score: 0.3, detail: 'Insufficient emotional data', metric: 'emotional_variance' };
  
  // Emotions that vary = functional. Flat emotions = decorative.
  const avgVariance = [
    parseFloat(rows[0]?.curiosity_var) || 0,
    parseFloat(rows[0]?.frustration_var) || 0,
    parseFloat(rows[0]?.satisfaction_var) || 0,
    parseFloat(rows[0]?.valence_var) || 0
  ].reduce((a, b) => a + b, 0) / 4;
  
  // Some variance is good, but not too much (that would be unstable)
  const score = Math.min(1, avgVariance * 5); // scale up small variances
  
  return {
    score,
    detail: `${states} emotional states in 24h, avg variance: ${avgVariance.toFixed(4)}`,
    metric: 'emotional_variance'
  };
}

async function computeCounterfactualAccuracy() {
  const { rows: [cf] } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE accuracy_score IS NOT NULL) as evaluated,
      AVG(accuracy_score) as avg_accuracy
    FROM counterfactuals
  `);

  const evaluated = parseInt(cf?.evaluated || 0);
  if (evaluated < 3) {
    return {
      score: 0.45,
      detail: `Insufficient evaluated counterfactuals (${evaluated})`,
      metric: 'counterfactual_accuracy',
      evaluated_counterfactuals: evaluated
    };
  }

  const avgAccuracy = clamp01(cf?.avg_accuracy || 0.5);
  return {
    score: avgAccuracy,
    detail: `${evaluated} counterfactuals evaluated, avg accuracy: ${avgAccuracy.toFixed(3)}`,
    metric: 'counterfactual_accuracy',
    evaluated_counterfactuals: evaluated
  };
}

async function computeCausalSupport() {
  const { rows: [ce] } = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      AVG(causal_support) FILTER (WHERE status = 'completed' AND causal_support IS NOT NULL) as avg_support
    FROM causal_experiments
  `);

  const total = parseInt(ce?.total || 0);
  const completed = parseInt(ce?.completed || 0);
  if (total < 2) {
    return {
      score: 0.45,
      detail: `Insufficient causal experiments (${total})`,
      metric: 'causal_support',
      completion_rate: total > 0 ? completed / total : 0
    };
  }

  const completionRate = completed / Math.max(1, total);
  const avgSupport = clamp01(ce?.avg_support || 0.5);
  const score = (avgSupport * 0.7) + (completionRate * 0.3);

  return {
    score,
    detail: `${completed}/${total} causal experiments completed, avg support=${avgSupport.toFixed(3)}`,
    metric: 'causal_support',
    completion_rate: completionRate,
    avg_support: avgSupport
  };
}

// Interpret the composite score
function interpret(score) {
  if (score < 0.2) return 'Pure Chinese Room — symbol manipulation without grounding';
  if (score < 0.4) return 'Weakly grounded — some experiential basis, mostly pattern matching';
  if (score < 0.6) return 'Partially grounded — meaningful predictions, emerging understanding';
  if (score < 0.8) return 'Substantially grounded — genuine learning, functional emotions, creative output';
  return 'Deeply grounded — strong evidence for conditions necessary for understanding';
}

export default { compute };
