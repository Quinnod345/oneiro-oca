// OCA — Oneiro Cognitive Architecture
// Main orchestrator: ties all layers together
import { pool, emit, on, cleanup } from './event-bus.js';
import emotion from './emotion/engine.js';
import hypothesis from './hypothesis/engine.js';
import episodic from './memory/episodic.js';
import semantic from './memory/semantic.js';
import procedural from './memory/procedural.js';
import entityGraph from './memory/entity-graph.js';
import consolidation from './memory/consolidation.js';
import metacognition from './metacognition/engine.js';
import deliberation from './deliberation/engine.js';
import reasoningController from './reasoning/controller.js';
import simulation from './simulation/engine.js';
import causal from './causal/engine.js';
import creative from './creative/engine.js';
import sensory from './sensory/perception.js';
import executive from './executive/engine.js';
import prospective from './memory/prospective.js';
import { ingestCoOccurrenceConnections, maintainSynapses } from './neural-connections.js';

export const layers = {
  emotion, hypothesis, episodic, semantic, procedural,
  consolidation, metacognition, deliberation, reasoningController, simulation,
  causal, entityGraph, creative, sensory, executive, prospective
};

// ============================================================
// COGNITIVE CYCLE — the main loop
// ============================================================

let cycleCount = 0;
let running = false;
let causalHooksReady = false;

export async function cycle() {
  cycleCount++;
  const t0 = Date.now();
  
  // 1. EMOTION: Update emotional state
  const emotionResult = await emotion.update();
  const effects = emotionResult.effects;
  
  // 2. METACOGNITION: Check for stuck states, biases (every 10 cycles)
  let metaResult = null;
  if (cycleCount % 10 === 0) {
    metaResult = await metacognition.runCycle();
    if (!metaResult.healthy) {
      console.log('[oca] metacognition alert:', JSON.stringify(metaResult));
    }
  }
  
  // 3. HYPOTHESIS: Check for expired, testable hypotheses
  await hypothesis.expireOverdue();

  // 3.5 SYNAPTIC DYNAMICS: form co-occurrence links, decay/prune old links
  let synapseResult = null;
  if (cycleCount % 10 === 0) {
    try {
      const co = await ingestCoOccurrenceConnections({ windowSeconds: 20, maxPairs: 40 });
      const maintenance = await maintainSynapses();
      synapseResult = { ...co, ...maintenance };
    } catch (e) {
      console.error('[oca] synapse maintenance error:', e.message);
    }
  }
  
  // 4. CONSOLIDATION: Run during low activity (every 100 cycles)
  if (cycleCount % 100 === 0 && effects.task_switch_pressure > 0.3) {
    await consolidation.consolidate();
  }

  // 4.5 SEMANTIC DECAY: confidence should decay with disuse
  if (cycleCount % 25 === 0) {
    await semantic.decayStaleConcepts(200).catch(() => null);
  }
  
  // 5. EVENT CLEANUP (every 50 cycles)
  if (cycleCount % 50 === 0) {
    await cleanup(24);
  }
  
  return {
    cycle: cycleCount,
    elapsed: Date.now() - t0,
    emotion: emotionResult.state,
    effects,
    meta: metaResult,
    synapses: synapseResult
  };
}

// ============================================================
// API — for integration with mind.js and OpenClaw
// ============================================================

// Experience something (creates episodic memory + updates emotion)
export async function experience(eventType, content, opts = {}) {
  // Store episodic memory
  const emotionState = emotion.getState();
  const episode = await episodic.store({
    eventType,
    content,
    emotionalState: emotionState,
    emotionalValence: emotionState.valence,
    emotionalArousal: emotionState.arousal,
    ...opts
  });
  
  // Process emotional impact
  if (opts.surpriseMagnitude > 0.3) {
    emotion.processSurprise(opts.surpriseMagnitude, opts.domain || 'general');
  }

  // Entity-level grounding from freeform experience text.
  await entityGraph.ingestText(content, {
    sourceType: 'episode',
    sourceId: episode.id,
    metadata: { eventType }
  }).catch(() => null);
  
  return episode;
}

// Learn something (shorthand for semantic memory)
export async function learn(concept, categoryOrOpts = null, confidence = 0.5) {
  if (categoryOrOpts && typeof categoryOrOpts === 'object' && !Array.isArray(categoryOrOpts)) {
    const opts = { ...categoryOrOpts };
    if (opts.confidence == null) opts.confidence = confidence;
    return await semantic.learn(concept, opts);
  }
  return await semantic.learn(concept, { category: categoryOrOpts, confidence });
}

// Predict something (creates hypothesis)
export async function predict(domain, claim, prediction, opts = {}) {
  return await hypothesis.form(domain, claim, prediction, opts);
}

// Remember something (episodic recall)
export async function remember(query, opts = {}) {
  return await episodic.recall(query, opts);
}

// Know something (semantic query)
export async function know(query, opts = {}) {
  const knowledge = await semantic.query(query, opts);
  if (!opts.includeEntities) return knowledge;

  const entities = await entityGraph.searchEntities(query, {
    type: opts.entityType || null,
    limit: opts.entityLimit || 8
  }).catch(() => []);
  const topEntity = entities?.[0]?.entity_key;
  const relations = topEntity
    ? await entityGraph.relationsForEntity(topEntity, { limit: opts.relationLimit || 10 }).catch(() => [])
    : [];
  return { knowledge, entities, relations };
}

// Decide something (adversarial deliberation)
export async function decide(decision, opts = {}) {
  const stakes = opts.stakes || 'medium';
  const confidenceHint = Number(opts.confidence);
  const useStructuredReasoning = !!opts.forceReasoning
    || stakes === 'high'
    || stakes === 'critical'
    || (Number.isFinite(confidenceHint) && confidenceHint < 0.55);

  if (useStructuredReasoning) {
    const reasoning = await reasoningController.reason(decision, {
      context: opts.context || '',
      stakes,
      timeBudgetSeconds: opts.timeBudgetSeconds || 45,
      minConfidence: Number.isFinite(Number(opts.minConfidence)) ? Number(opts.minConfidence) : 0.55
    });
    const propose = reasoning.steps?.find(s => s.stage === 'propose')?.output || '';
    const critique = reasoning.steps?.find(s => s.stage === 'critique')?.output || '';
    const revise = reasoning.steps?.find(s => s.stage === 'revise')?.output || '';
    const verify = reasoning.steps?.find(s => s.stage === 'verify')?.output || '';
    return {
      resolutionMethod: 'reasoning_controller',
      resolution: reasoning.conclusion,
      confidence: reasoning.confidence,
      traceId: reasoning.traceId,
      shouldExecute: reasoning.shouldExecute,
      perspectives: {
        skeptic: { argument: critique || 'No critique generated' },
        builder: { argument: propose || 'No proposal generated' },
        dreamer: { argument: revise || 'No revision generated' },
        empath: { argument: verify || 'No verification generated' }
      },
      reasoning
    };
  }
  return await deliberation.deliberate(decision, opts);
}

export async function reason(goal, opts = {}) {
  return await reasoningController.reason(goal, opts);
}

// Imagine something (world simulation)
export async function imagine(description, state, actions, opts = {}) {
  const entityContext = await entityGraph.contextForText(
    `${description}\n${JSON.stringify(state || {})}`,
    { limit: 8 }
  ).catch(() => ({ entities: [], relations: [] }));
  const enrichedState = {
    ...(state || {}),
    entity_context: entityContext
  };
  return await simulation.simulate(description, enrichedState, actions, opts);
}

// Create something (creative synthesis)
export async function create(method = 'connection') {
  if (method === 'connection') return await creative.forceConnection();
  if (method === 'dream') return await creative.dream();
  if (method === 'transfer') return await creative.crossDomainTransfer('coding', 'social');
  return null;
}

// Sense the environment
export function sense() {
  return sensory.getFullPerception();
}

// Think about own thinking
export async function reflect() {
  return await metacognition.runCycle();
}

// Full status
export async function status() {
  const [emotionState, epStats, smStats, pending, calibration] = await Promise.all([
    Promise.resolve(emotion.getState()),
    episodic.stats(),
    semantic.stats(),
    hypothesis.getPendingTests(5),
    hypothesis.getCalibration()
  ]);
  
  return {
    emotion: emotionState,
    mood: emotion.getMood(),
    effects: emotion.getCognitiveEffects(),
    memory: {
      episodic: epStats,
      semantic: smStats
    },
    hypotheses: {
      pending: pending.length,
      top: pending.slice(0, 3).map(h => ({ id: h.id, claim: h.claim, confidence: h.confidence }))
    },
    calibration,
    cycle: cycleCount
  };
}

// Initialize (restore state, start cycle)
export async function init() {
  console.log('[oca] initializing cognitive architecture...');
  await emotion.restore();

  if (!causalHooksReady) {
    causalHooksReady = true;
    on('hypothesis_tested', async (ev) => {
      try {
        const surprise = Number(ev?.payload?.surprise || 0);
        const confirmed = ev?.payload?.confirmed === true;
        if (confirmed || surprise < 0.45) return;

        const hypothesisId = ev?.payload?.id;
        const { rows: [hyp] } = await pool.query(
          'SELECT id, claim, prediction FROM hypotheses WHERE id = $1',
          [hypothesisId]
        );
        if (!hyp) return;

        const { rows: [latestEpisode] } = await pool.query(
          'SELECT id, content FROM episodic_memory ORDER BY id DESC LIMIT 1'
        );
        if (latestEpisode?.id) {
          await simulation.counterfactual(
            latestEpisode.id,
            `Predicted: ${hyp.prediction}`,
            `Alternative explanation for: ${hyp.claim}`
          ).catch(() => null);
        }

        await causal.designExperiment({
          causeType: 'hypothesis',
          causeId: hyp.id,
          causeDescription: hyp.claim,
          intervention: 'Test an alternative mechanism after refutation',
          expectedEffect: hyp.prediction,
          confidence: Math.max(0.2, Math.min(0.9, 1 - surprise / 2)),
          hypothesisId: hyp.id,
          metadata: {
            trigger: 'hypothesis_tested',
            surprise,
            auto_generated: true
          }
        }).catch(() => null);
      } catch (e) {
        console.error('[oca] causal hook error:', e.message);
      }
    });
  }

  console.log('[oca] emotion restored');
  console.log('[oca] cognitive architecture online');
  return true;
}

export default { 
  layers, cycle, experience, learn, predict, remember, know, decide, 
  reason, imagine, create, sense, reflect, status, init 
};
