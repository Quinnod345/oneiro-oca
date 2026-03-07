// OCA World Simulation — forward models and counterfactual reasoning
import { pool, emit } from '../event-bus.js';
import OpenAI from 'openai';
import llm from '../llm.js';
import { startPrediction, completePrediction } from '../prediction-ledger.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function parseSimulationPayload(rawText) {
  const raw = String(rawText || '').trim();
  const attempts = [];
  const deFenced = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  attempts.push(raw, deFenced);

  for (const match of raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1]) attempts.push(match[1].trim());
  }

  const objStart = raw.indexOf('{');
  const objEnd = raw.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) {
    attempts.push(raw.slice(objStart, objEnd + 1));
  }

  const seen = new Set();
  for (const candidate of attempts) {
    if (!candidate) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const sanitized = candidate
      .replace(/^\uFEFF/, '')
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/,\s*([}\]])/g, '$1')
      .trim();
    const variants = candidate === sanitized ? [candidate] : [candidate, sanitized];

    for (const variant of variants) {
      try {
        const parsed = JSON.parse(variant);
        return {
          predicted_states: Array.isArray(parsed?.predicted_states) ? parsed.predicted_states : [],
          branch_points: Array.isArray(parsed?.branch_points) ? parsed.branch_points : [],
          risks: Array.isArray(parsed?.risks) ? parsed.risks : [],
          expected_outcome: parsed?.expected_outcome || ''
        };
      } catch {
        // continue
      }
    }
  }

  const condensed = raw.replace(/\s+/g, ' ').trim();
  return {
    predicted_states: [],
    branch_points: [],
    risks: ['simulation_output_parse_failure'],
    expected_outcome: condensed.slice(0, 280)
  };
}

function heuristicSimulation(description, initialState, actionSequence, reason = 'heuristic_fallback') {
  const actions = Array.isArray(actionSequence) ? actionSequence : [];
  const predicted_states = actions.slice(0, 5).map((action, idx) => ({
    step: idx + 1,
    state: `After "${String(action).slice(0, 120)}", the system is likely to move incrementally toward: ${String(description).slice(0, 180)}`,
    confidence: 0.28
  }));
  const joined = actions.map((action) => String(action).toLowerCase()).join(' ');
  const risks = [reason];
  if (/\bdelete|drop|reset|kill|rm\b/.test(joined)) risks.push('destructive_action_risk');
  if (/\bpost|publish|tweet|email|message\b/.test(joined)) risks.push('external_side_effect_risk');
  if (/\brestart|deploy|migrate|install\b/.test(joined)) risks.push('service_instability_risk');
  return {
    predicted_states,
    branch_points: [],
    risks,
    expected_outcome: `Heuristic simulation fallback: ${String(description).slice(0, 220)}`
  };
}

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
export async function simulate(description, initialState, actionSequence, { purpose = 'decision' } = {}) {
  try {
    let result;
    try {
      const response = await llm.messages.create({
        model: 'claude-sonnet-4-6',
        system: `You are a world simulation engine. Given an initial state and a sequence of actions, predict the resulting states. Be realistic and specific. Consider what could go wrong.

You MUST respond in valid JSON only, no other text:
{
  "predicted_states": [{"step": 1, "state": "...", "confidence": 0.0-1.0}],
  "branch_points": [{"step": N, "description": "where outcomes diverge", "alternatives": ["...", "..."]}],
  "risks": ["..."],
  "expected_outcome": "..."
}`,
      messages: [
        { role: 'user', content: `Initial state: ${JSON.stringify(initialState)}\n\nActions: ${JSON.stringify(actionSequence)}\n\nPurpose: ${purpose}\n\nDescription: ${description}` }
        ],
        temperature: 0.5,
        max_tokens: 500
      });

      result = parseSimulationPayload(response.content?.[0]?.text);
      if (
        (!result.expected_outcome || result.expected_outcome === '') &&
        (!Array.isArray(result.predicted_states) || result.predicted_states.length === 0)
      ) {
        result = heuristicSimulation(description, initialState, actionSequence, 'simulation_output_parse_failure');
      }
    } catch (llmErr) {
      console.warn('[simulation] falling back to heuristic simulation:', llmErr.message);
      result = heuristicSimulation(description, initialState, actionSequence, 'simulation_llm_unavailable');
    }
    
    // Store simulation
    const { rows } = await pool.query(
      `INSERT INTO simulations (description, initial_state, action_sequence, predicted_states, branch_points, purpose)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [description, JSON.stringify(initialState), JSON.stringify(actionSequence),
       JSON.stringify(result.predicted_states || []), JSON.stringify(result.branch_points || []), purpose]
    );
    
    return { id: rows[0].id, ...result };
  } catch (e) {
    console.error('[simulation] forward sim failed:', e.message);
    return heuristicSimulation(description, initialState, actionSequence, 'simulation_storage_failure');
  }
}

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

  const predicted = cf.predicted_alternative_outcome || '';
  if (!predicted || !actualOutcome) return null;

  const predEmb = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: String(predicted).slice(0, 8000)
  });
  const actEmb = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: String(actualOutcome).slice(0, 8000)
  });

  let dot = 0;
  let nA = 0;
  let nB = 0;
  for (let i = 0; i < predEmb.data[0].embedding.length; i++) {
    dot += predEmb.data[0].embedding[i] * actEmb.data[0].embedding[i];
    nA += predEmb.data[0].embedding[i] ** 2;
    nB += actEmb.data[0].embedding[i] ** 2;
  }
  const accuracy = dot / (Math.sqrt(nA) * Math.sqrt(nB));
  const modelUpdate = `Counterfactual predicted="${predicted}" | actual="${String(actualOutcome).slice(0, 240)}" | accuracy=${accuracy.toFixed(3)}`;

  await pool.query(
    `UPDATE counterfactuals SET
       actual_outcome = $1,
       accuracy_score = $2,
       evaluated_at = NOW(),
       model_update = COALESCE(model_update, $3)
     WHERE id = $4`,
    [String(actualOutcome), accuracy, modelUpdate, counterfactualId]
  );

  await emit('counterfactual_evaluated', 'simulation', {
    counterfactualId,
    accuracy,
    predicted,
    actual: actualOutcome
  }, { priority: 0.5 });

  return { counterfactualId, accuracy, predicted, actual: actualOutcome };
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
