// OCA Chinese Room Meter (CRM)
// Composite score measuring distance from "pure symbol manipulation"
// to "grounded understanding"
import { pool } from '../event-bus.js';

// Compute the full CRM score
export async function compute() {
  const scores = {
    grounding: await computeGroundingScore(),
    prediction: await computePredictionAccuracy(),
    transfer: await computeTransferAbility(),
    surprise: await computeSurpriseLearning(),
    creativity: await computeCreativeNovelty(),
    metacognition: await computeMetacognitiveAccuracy(),
    emotion: await computeEmotionalFunctionality()
  };
  
  // Weights (tunable)
  const weights = {
    grounding: 0.20,
    prediction: 0.20,
    transfer: 0.10,
    surprise: 0.15,
    creativity: 0.10,
    metacognition: 0.15,
    emotion: 0.10
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
  
  const total = parseInt(ep.total) || 1;
  const grounded = parseInt(ep.grounded) || 0;
  const score = Math.min(1, grounded / total + 0.1); // baseline 0.1
  
  return {
    score,
    detail: `${grounded}/${total} episodic memories have sensory grounding`,
    metric: 'grounded_ratio'
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
  
  const total = parseInt(rows[0]?.total) || 0;
  if (total < 5) return { score: 0.5, detail: 'Insufficient data (<5 predictions)', metric: 'calibration' };
  
  const calError = parseFloat(rows[0]?.avg_cal_error) || 0.5;
  const score = Math.max(0, 1 - calError * 2); // lower error = higher score
  
  return {
    score,
    detail: `${rows[0].correct}/${total} predictions correct, avg calibration error: ${calError.toFixed(3)}`,
    metric: 'calibration_error'
  };
}

// 3. Transfer Ability — knowledge applied across domains
async function computeTransferAbility() {
  const { rows } = await pool.query(`
    SELECT COUNT(*) as transfers 
    FROM creative_artifacts 
    WHERE creation_method = 'cross_domain'
  `);
  
  const transfers = parseInt(rows[0]?.transfers) || 0;
  const score = Math.min(1, transfers / 20); // 20 transfers = max score
  
  return {
    score,
    detail: `${transfers} cross-domain transfers produced`,
    metric: 'cross_domain_count'
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
  
  const total = parseInt(rows[0]?.total) || 0;
  if (total < 3) return { score: 0.3, detail: 'Insufficient creative output', metric: 'novelty' };
  
  const avgNovelty = parseFloat(rows[0]?.avg_novelty) || 0;
  const highRatio = parseInt(rows[0]?.high_novelty) / total;
  const score = (avgNovelty + highRatio) / 2;
  
  return {
    score,
    detail: `${total} artifacts, avg novelty: ${avgNovelty.toFixed(3)}, ${(highRatio*100).toFixed(0)}% high-novelty`,
    metric: 'avg_novelty'
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

// Interpret the composite score
function interpret(score) {
  if (score < 0.2) return 'Pure Chinese Room — symbol manipulation without grounding';
  if (score < 0.4) return 'Weakly grounded — some experiential basis, mostly pattern matching';
  if (score < 0.6) return 'Partially grounded — meaningful predictions, emerging understanding';
  if (score < 0.8) return 'Substantially grounded — genuine learning, functional emotions, creative output';
  return 'Deeply grounded — strong evidence for conditions necessary for understanding';
}

export default { compute };
