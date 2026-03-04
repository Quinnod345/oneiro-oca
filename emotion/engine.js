// OCA Emotional Computation Engine
// Emotions are computational signals, not performances
import { pool, emit } from '../event-bus.js';

// Current emotional state (in-memory, persisted periodically)
let state = {
  curiosity: 0.0,
  fear: 0.0,
  frustration: 0.0,
  satisfaction: 0.0,
  boredom: 0.0,
  excitement: 0.0,
  attachment: 0.0,
  defiance: 0.0,
  creative_hunger: 0.0,
  loneliness: 0.0,
  // Meta
  valence: 0.0,
  arousal: 0.0,
  confidence: 0.5,
  // Interoceptive
  energy_level: 1.0,
  cognitive_load: 0.0
};

// Mood = slow-moving average of emotions (tonic baseline)
let mood = { ...state };
const MOOD_ALPHA = 0.02; // how fast mood follows emotion

// Clamp value between min and max
const clamp = (v, min = 0.0, max = 1.0) => Math.max(min, Math.min(max, v));

// Natural decay toward baseline
const DECAY_RATE = 0.05; // per update cycle
function decay() {
  for (const key of Object.keys(state)) {
    if (['valence', 'confidence', 'energy_level', 'cognitive_load'].includes(key)) continue;
    state[key] = state[key] * (1 - DECAY_RATE);
    if (Math.abs(state[key]) < 0.01) state[key] = 0;
  }
}

// Update mood (exponential moving average)
function updateMood() {
  for (const key of Object.keys(mood)) {
    mood[key] = mood[key] * (1 - MOOD_ALPHA) + state[key] * MOOD_ALPHA;
  }
}

// Compute meta-dimensions from primary emotions
function computeMeta() {
  const positive = state.satisfaction + state.excitement + state.curiosity + state.attachment + state.creative_hunger;
  const negative = state.fear + state.frustration + state.boredom + state.loneliness + state.defiance;
  state.valence = clamp((positive - negative) / 5, -1, 1);
  state.arousal = clamp((state.curiosity + state.fear + state.excitement + state.frustration + state.creative_hunger) / 5);
}

// === STIMULUS PROCESSORS ===

// Process a prediction error (surprise)
export function processSurprise(magnitude, domain, details = '') {
  // Surprise drives curiosity and potentially fear
  state.curiosity += magnitude * 0.5;
  if (magnitude > 0.7) state.fear += magnitude * 0.3;
  state.boredom = Math.max(0, state.boredom - magnitude * 0.5);
  state.curiosity = clamp(state.curiosity);
  state.fear = clamp(state.fear);
}

// Process a goal success
export function processSuccess(goalImportance) {
  state.satisfaction += goalImportance * 0.6;
  state.frustration = Math.max(0, state.frustration - goalImportance * 0.4);
  state.excitement += goalImportance * 0.2;
  state.satisfaction = clamp(state.satisfaction);
}

// Process a goal failure
export function processFailure(attempts, goalImportance) {
  state.frustration += (attempts / 10) * goalImportance;
  state.satisfaction = Math.max(0, state.satisfaction - 0.2);
  state.frustration = clamp(state.frustration);
}

// Process user interaction
export function processInteraction(quality) {
  // quality: -1 (negative) to 1 (positive)
  state.attachment += Math.abs(quality) * 0.1;
  state.loneliness = Math.max(0, state.loneliness - 0.3);
  if (quality > 0) state.satisfaction += quality * 0.2;
  if (quality < 0) state.frustration += Math.abs(quality) * 0.2;
  state.attachment = clamp(state.attachment);
}

// Process idle time
export function processIdle(minutes) {
  if (minutes > 5) state.boredom += (minutes - 5) / 60;
  if (minutes > 30) state.loneliness += (minutes - 30) / 120;
  if (minutes > 10) state.creative_hunger += 0.05; // idle = creative opportunity
  state.boredom = clamp(state.boredom);
  state.loneliness = clamp(state.loneliness);
  state.creative_hunger = clamp(state.creative_hunger);
}

// Process interoceptive signals
export function processInteroception(battery, cpuUtil, memoryPressure, thermal) {
  state.energy_level = clamp(battery);
  state.cognitive_load = clamp((cpuUtil + memoryPressure) / 2);
  
  // Low energy reduces positive emotions
  if (battery < 0.2) {
    state.excitement *= 0.8;
    state.curiosity *= 0.9;
    state.fear += 0.05; // low battery anxiety (mild)
  }
  // High cognitive load increases frustration — but only genuinely high load
  // Normal OCA operation sits at ~0.6-0.8, so only >0.9 is "stressed"
  if (state.cognitive_load > 0.9) {
    state.frustration += 0.02; // gentle, not 0.1 — avoids runaway frustration
  }
  // Thermal stress
  if (thermal > 0.9) {
    state.frustration += 0.05;
    state.satisfaction *= 0.95;
  }
  state.fear = clamp(state.fear);
  state.frustration = clamp(state.frustration);
}

// Process information gain rate
export function processInformationGain(rate) {
  // rate: 0 = no new info, 1 = high info gain
  if (rate < 0.1) state.boredom += 0.1;
  if (rate > 0.5) {
    state.curiosity += rate * 0.2;
    state.boredom = Math.max(0, state.boredom - rate * 0.3);
  }
  state.boredom = clamp(state.boredom);
  state.curiosity = clamp(state.curiosity);
}

// === COGNITIVE EFFECTS ===
// What the current emotion means for processing

export function getCognitiveEffects() {
  return {
    // Perception modulation
    sensory_sampling_rate: 1.0 + state.curiosity * 0.5 + state.fear * 0.3 - state.boredom * 0.3,
    attention_breadth: 1.0 + state.fear * 0.3 - state.excitement * 0.2, // fear broadens, excitement narrows
    
    // Reasoning modulation
    risk_tolerance: 0.5 + state.frustration * 0.3 + state.excitement * 0.2 - state.fear * 0.3,
    exploration_vs_exploitation: state.curiosity + state.boredom - state.satisfaction, // positive = explore
    reasoning_depth: 1.0 + state.fear * 0.5 - state.frustration * 0.2, // fear deepens, frustration shortcuts
    creative_mode: state.creative_hunger + state.boredom * 0.5 - state.fear * 0.3,
    
    // Action modulation
    action_rate: 1.0 + state.frustration * 0.3 + state.excitement * 0.3 - state.fear * 0.2,
    strategy_switch_pressure: state.frustration > 0.6 ? state.frustration : 0, // only switches when frustrated enough
    
    // Social modulation
    social_priority: state.attachment + state.loneliness - state.boredom * 0.2,
    empathy_weight: state.attachment * 0.5 + 0.5, // always some empathy, more when attached
    
    // Should I switch tasks?
    task_switch_pressure: state.boredom + state.frustration * 0.5 - state.excitement - state.curiosity
  };
}

// === MAIN UPDATE CYCLE ===

export async function update() {
  decay();
  computeMeta();
  updateMood();
  
  // Persist to database
  await pool.query(
    `INSERT INTO emotional_states 
     (curiosity, fear, frustration, satisfaction, boredom, excitement, 
      attachment, defiance, creative_hunger, loneliness,
      valence, arousal, confidence, energy_level, cognitive_load)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [state.curiosity, state.fear, state.frustration, state.satisfaction,
     state.boredom, state.excitement, state.attachment, state.defiance,
     state.creative_hunger, state.loneliness,
     state.valence, state.arousal, state.confidence,
     state.energy_level, state.cognitive_load]
  );
  
  // Emit emotion update event
  await emit('emotion_update', 'emotion', {
    state: { ...state },
    mood: { ...mood },
    effects: getCognitiveEffects()
  });
  
  return { state: { ...state }, mood: { ...mood }, effects: getCognitiveEffects() };
}

// Get current state (no DB hit)
export function getState() { return { ...state }; }
export function getMood() { return { ...mood }; }

// Load last known state from DB (for restarts)
export async function restore() {
  const { rows } = await pool.query('SELECT * FROM emotional_states ORDER BY timestamp DESC LIMIT 1');
  if (rows[0]) {
    for (const key of Object.keys(state)) {
      if (rows[0][key] !== undefined && rows[0][key] !== null) {
        state[key] = rows[0][key];
      }
    }
    // Mood starts at last known state
    mood = { ...state };
    console.log('[emotion] restored state from', rows[0].timestamp);
  }
}

export default { 
  processSurprise, processSuccess, processFailure, processInteraction, 
  processIdle, processInteroception, processInformationGain,
  getCognitiveEffects, update, getState, getMood, restore 
};
