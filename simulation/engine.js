// OCA World Simulation — forward models and counterfactual reasoning
import { pool, emit } from '../event-bus.js';
import OpenAI from '../local-openai-shim.js';
import llm from '../llm.js';
import { startPrediction, completePrediction } from '../prediction-ledger.js';
import { createForwardSimulator } from './forward.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Update or create a world model entity
export async function updateEntity(domain, entity, newState, { confidence = 0.5, transitionRule = null } = {}) {
  const stateJson = JSON.stringify(newState);
  
  const { rows } = await pool.query(
    `INSERT INTO world_model (domain, entity, state, state_confidence, transition_rules, state_history)
     VALUES ($1, $2, $3, $4, 
       CASE WHEN $5::jsonb IS NOT NULL THEN jsonb_build_array($5::jsonb) ELSE '[]'::jsonb END,
       jsonb_build_array(jsonb_build_object('state', $3, 'timestamp', NOW()::text, 'confidence', $4)))
     ON CONFLICT (domain, entity) DO UPDATE SET
       state = $3,
       state_confidence = $4,
       transition_rules = CASE WHEN $5::jsonb IS NOT NULL 
         THEN world_model.transition_rules || jsonb_build_array($5::jsonb)
         ELSE world_model.transition_rules END,
       state_history = (
         world_model.state_history || jsonb_build_array(
           jsonb_build_object('state', $3, 'timestamp', NOW()::text, 'confidence', $4)
         )
       ),
       updated_at = NOW()
     RETURNING id`,
    [domain, entity, stateJson, confidence, transitionRule ? JSON.stringify(transitionRule) : null]
  );
  
  return rows[0];
}

// Get current state of an entity
export async function getEntity(domain, entity) {
  const { rows } = await pool.query(
    'SELECT * FROM world_model WHERE domain = $1 AND entity = $2',
    [domain, entity]
  );
  return rows[0] || null;
}

// Simulate forward: given current state + action, predict next state
export const simulate = createForwardSimulator({
  generate: (params, options) => llm.messages.create(params, options),
  save: async ({ description, initialState, actionSequence, purpose, result }) => {
    const { rows } = await pool.query(
      `INSERT INTO simulations (description, initial_state, action_sequence, predicted_states, branch_points, purpose)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [description, JSON.stringify(initialState), JSON.stringify(actionSequence),
       JSON.stringify(result.predicted_states), JSON.stringify(result.branch_points), purpose]);
    return rows[0].id;
  }
});

// Compare simulation prediction to actual outcome
export async function evaluateSimulation(simulationId, actualOutcome) {
  const { rows: [sim] } = await pool.query('SELECT * FROM simulations WHERE id = $1', [simulationId]);
  if (!sim) return null;
  
  // Simple accuracy: did the expected outcome match?
  const predicted = sim.predicted_states;
  const lastPredicted = predicted[predicted.length - 1]?.state || '';
  const predictionLedgerId = await startPrediction({
    actionSource: 'simulation',
    actionType: 'evaluate_simulation',
    actionDetails: { simulationId, purpose: sim.purpose || null },
    expectedOutcome: lastPredicted,
    expectedStructured: null,
    confidence: 0.5,
    simulationId,
  });
  
  // Use embedding similarity for accuracy
  const predEmb = await openai.embeddings.create({ model: 'text-embedding-3-small', input: String(lastPredicted).slice(0, 8000) });
  const actEmb = await openai.embeddings.create({ model: 'text-embedding-3-small', input: String(actualOutcome).slice(0, 8000) });
  
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < predEmb.data[0].embedding.length; i++) {
    dot += predEmb.data[0].embedding[i] * actEmb.data[0].embedding[i];
    nA += predEmb.data[0].embedding[i] ** 2;
    nB += actEmb.data[0].embedding[i] ** 2;
  }
  const accuracy = dot / (Math.sqrt(nA) * Math.sqrt(nB));
  
  await pool.query(
    'UPDATE simulations SET actual_outcome = $1, accuracy_score = $2 WHERE id = $3',
    [JSON.stringify(actualOutcome), accuracy, simulationId]
  );

  await completePrediction(predictionLedgerId, {
    observedOutcome: String(actualOutcome),
    success: accuracy >= 0.62,
    status: 'completed',
    evaluationMode: 'semantic',
    evaluationReason: `simulation_accuracy=${accuracy.toFixed(3)}`,
    verifiability: 'semantic',
    predictionError: Math.max(0, Math.min(1, 1 - accuracy)),
    metadata: { accuracy },
  });

  // B3: Update world_model.prediction_accuracy (SPEC §2.8 maintenance)
  // EMA so recent accuracy weighs more than historical
  if (sim.description) {
    try {
      await pool.query(
        `UPDATE world_model SET prediction_accuracy =
           COALESCE(prediction_accuracy * 0.9 + $1 * 0.1, $1)
         WHERE entity = $2 OR domain = $2`,
        [accuracy, sim.purpose || sim.description?.slice(0, 100)]
      );
    } catch {}
  }

  await emit('simulation_result', 'simulation', {
    simulationId,
    accuracy,
    predicted: lastPredicted,
    actual: actualOutcome
  }, { priority: 0.45 + (1 - Math.max(0, Math.min(1, accuracy))) * 0.4 });
  
  return { simulationId, accuracy, predicted: lastPredicted, actual: actualOutcome };
}

// Generate counterfactual for an episode
export async function counterfactual(episodeId, actualAction, alternativeAction) {
  // Simulate what would have happened
  const { rows: [ep] } = await pool.query('SELECT * FROM episodic_memory WHERE id = $1', [episodeId]);
  if (!ep) return null;
  
  const simResult = await simulate(
    `Counterfactual: instead of "${actualAction}", what if "${alternativeAction}"?`,
    { context: ep.content, emotional_state: ep.emotional_state },
    [alternativeAction],
    { purpose: 'counterfactual' }
  );
  
  const predictedOutcome = simResult.expected_outcome || simResult.predicted_states?.[0]?.state || 'unknown';
  
  // Was the alternative better? (positive valence = alternative was better)
  const outcomeValence = simResult.risks?.length > 0 ? -0.3 : 0.3; // rough heuristic
  
  const { rows } = await pool.query(
    `INSERT INTO counterfactuals (episode_id, actual_action, alternative_action, predicted_alternative_outcome, outcome_valence, insight)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [episodeId, actualAction, alternativeAction, predictedOutcome, outcomeValence, 
     `Alternative "${alternativeAction}" predicted: ${predictedOutcome}`]
  );
  
  return { id: rows[0].id, predictedOutcome, outcomeValence };
}

export async function evaluateCounterfactual(counterfactualId, actualOutcome) {
  const { rows: [cf] } = await pool.query(
    'SELECT * FROM counterfactuals WHERE id = $1',
    [counterfactualId]
  );
  if (!cf) return null;

  // Observing the original action cannot validate the unexecuted alternative.
  // Retain the proposal and history; do not convert embedding similarity into accuracy.
  return { counterfactualId, status: 'needs_intervention_evidence', accuracy: null,
    predicted: cf.predicted_alternative_outcome || null,
    reason: 'A comparable observed execution of the alternative is required; the original episode or outcome text is not that evidence.' };
}

// Get model accuracy by domain
export async function modelAccuracy() {
  const { rows } = await pool.query(
    `SELECT domain, AVG(prediction_accuracy) as avg_accuracy, COUNT(*) as entity_count
     FROM world_model GROUP BY domain`
  );
  return rows;
}

export default {
  updateEntity,
  getEntity,
  simulate,
  evaluateSimulation,
  counterfactual,
  evaluateCounterfactual,
  modelAccuracy
};
