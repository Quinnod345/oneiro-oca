// OCA Hypothesis Engine
// Form predictions, test them, learn from surprise
import { pool, emit } from '../event-bus.js';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getEmbedding(text) {
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000)
  });
  return resp.data[0].embedding;
}

// Form a new hypothesis from an observation
export async function form(domain, claim, prediction, { testMethod = null, testType = 'passive_observation', confidence = 0.5, sourceData = {}, deadline = null } = {}) {
  const embedding = await getEmbedding(`${claim} | ${prediction}`);
  
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
    [domain, claim, confidence, prediction, deadline, testMethod, testType, JSON.stringify(sourceData), JSON.stringify(embedding)]
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
  
  // Compute surprise via embedding distance
  const predEmb = await getEmbedding(hyp.prediction);
  const actEmb = await getEmbedding(actualOutcome);
  
  // Cosine distance as surprise proxy
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < predEmb.length; i++) {
    dotProduct += predEmb[i] * actEmb[i];
    normA += predEmb[i] * predEmb[i];
    normB += actEmb[i] * actEmb[i];
  }
  const cosineSim = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  const surprise = 1 - cosineSim;
  
  // Determine if confirmed or refuted (threshold-based + semantic)
  const confirmed = cosineSim > 0.7;
  const status = confirmed ? 'confirmed' : 'refuted';
  
  // Compute confidence delta
  const confidenceDelta = confirmed 
    ? Math.min(0.2, (1 - hyp.confidence) * 0.3)  // confirmed → confidence up
    : -Math.min(0.3, hyp.confidence * 0.4);        // refuted → confidence down
  
  // Generate model update using the surprise
  let modelUpdate = null;
  if (surprise > 0.3) {
    modelUpdate = `Prediction: "${hyp.prediction}" | Actual: "${actualOutcome}" | Surprise: ${surprise.toFixed(3)}`;
  }
  
  await pool.query(
    `UPDATE hypotheses SET 
       status = $1, actual_outcome = $2, tested_at = NOW(),
       surprise_magnitude = $3, model_update = $4, confidence_delta = $5
     WHERE id = $6`,
    [status, actualOutcome, surprise, modelUpdate, confidenceDelta, hypothesisId]
  );
  
  // Log to calibration
  await pool.query(
    `INSERT INTO calibration_log (domain, stated_confidence, prediction, was_correct)
     VALUES ($1, $2, $3, $4)`,
    [hyp.domain, hyp.confidence, hyp.prediction, confirmed]
  );
  
  // Emit result
  await emit('hypothesis_tested', 'hypothesis', {
    id: hypothesisId, status, surprise, confirmed, confidenceDelta, modelUpdate
  }, { priority: 0.5 + surprise * 0.5 }); // higher surprise = higher priority
  
  return { id: hypothesisId, status, surprise, confirmed, confidenceDelta, modelUpdate };
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

export default { form, test, designExperiment, completeExperiment, getPendingTests, expireOverdue, getCalibration, getSurpriseHistory };
