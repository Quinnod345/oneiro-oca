// OCA — Oneiro Cognitive Architecture
// Main orchestrator: ties all layers together
import { pool, emit, on, cleanup } from './event-bus.js';
import emotion from './emotion/engine.js';
import hypothesis from './hypothesis/engine.js';
import episodic from './memory/episodic.js';
import semantic from './memory/semantic.js';
import procedural from './memory/procedural.js';
import consolidation from './memory/consolidation.js';
import metacognition from './metacognition/engine.js';
import deliberation from './deliberation/engine.js';
import simulation from './simulation/engine.js';
import creative from './creative/engine.js';
import sensory from './sensory/perception.js';
import executive from './executive/engine.js';

export const layers = {
  emotion, hypothesis, episodic, semantic, procedural,
  consolidation, metacognition, deliberation, simulation,
  creative, sensory, executive
};

// ============================================================
// COGNITIVE CYCLE — the main loop
// ============================================================

let cycleCount = 0;
let running = false;

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
  
  // 4. CONSOLIDATION: Run during low activity (every 100 cycles)
  if (cycleCount % 100 === 0 && effects.task_switch_pressure > 0.3) {
    await consolidation.consolidate();
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
    meta: metaResult
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
  
  return episode;
}

// Learn something (shorthand for semantic memory)
export async function learn(concept, category = null, confidence = 0.5) {
  return await semantic.learn(concept, { category, confidence });
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
  return await semantic.query(query, opts);
}

// Decide something (adversarial deliberation)
export async function decide(decision, opts = {}) {
  return await deliberation.deliberate(decision, opts);
}

// Imagine something (world simulation)
export async function imagine(description, state, actions, opts = {}) {
  return await simulation.simulate(description, state, actions, opts);
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
  console.log('[oca] emotion restored');
  console.log('[oca] cognitive architecture online');
  return true;
}

export default { 
  layers, cycle, experience, learn, predict, remember, know, decide, 
  imagine, create, sense, reflect, status, init 
};
