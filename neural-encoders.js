// OCA Neural Encoders — converts each layer's state into a dense float vector
// for the neural bus. Each encoder maps layer-specific state to a fixed-size
// Float32Array matching the dimensions defined in neural-bus.js.

import { LAYER_DIMS, OFFSETS } from './neural-bus.js';
import { readPerceptualState } from './event-bus.js';

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }
function signed(v) { return Math.max(-1, Math.min(1, Number(v) || 0)); }
function fill(arr, offset, values) {
  for (let i = 0; i < values.length && offset + i < arr.length; i++) {
    arr[offset + i] = Number(values[i]) || 0;
  }
}

// Simple string hash to 4 floats (for encoding app names etc)
function hashToVector(str, dims = 4) {
  const result = new Array(dims).fill(0);
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    result[i % dims] = (result[i % dims] + s.charCodeAt(i) * 0.00392) % 1.0;
  }
  return result;
}

// ═══════════════════════════════════════════════════
// SENSORY ENCODER (64-dim)
// ═══════════════════════════════════════════════════

export function encodeSensory(perception) {
  const v = new Float32Array(LAYER_DIMS.sensory);
  if (!perception) return v;

  let i = 0;

  // Presence: 3 one-hot (active, idle, away)
  const p = perception.user_presence || 'unknown';
  v[i++] = p === 'active' ? 1 : 0;
  v[i++] = p === 'idle' ? 1 : 0;
  v[i++] = p === 'away' ? 1 : 0;

  // Activity type: 4 dims
  const a = perception.user_activity || 'idle';
  v[i++] = a === 'coding' ? 1 : a === 'typing' ? 0.7 : 0;
  v[i++] = a === 'browsing' ? 1 : a === 'reading' ? 0.5 : 0;
  v[i++] = a === 'creating' ? 1 : 0;
  v[i++] = a === 'communicating' ? 1 : 0;

  // App hash: 4 dims
  const appName = perception.visual?.active_app || perception.visual?.frontApp || '';
  fill(v, i, hashToVector(appName)); i += 4;

  // Interoception: 6 dims
  const intero = perception.interoceptive || {};
  v[i++] = clamp01((intero.battery_level ?? intero.battery?.level ?? 100) / 100);
  v[i++] = clamp01(intero.memory_pressure ?? intero.memory?.pressure ?? 0);
  v[i++] = intero.thermal_state === 'serious' ? 0.8 : intero.thermal_state === 'critical' ? 1 : intero.thermal_state === 'fair' ? 0.3 : 0;
  v[i++] = clamp01(intero.disk_usage_ratio ?? intero.disk?.used ?? 0);
  v[i++] = intero.battery_charging ? 1 : 0;
  v[i++] = intero.energy_policy === 'low_energy' ? 0.8 : intero.energy_policy === 'overheat_cooldown' ? 0.9 : 0;

  // Tactile: 4 dims
  const tactile = perception.tactile || {};
  v[i++] = clamp01((tactile.wpm || 0) / 100);
  v[i++] = clamp01(tactile.error_rate || 0);
  v[i++] = tactile.active_typing ? 1 : 0;
  v[i++] = tactile.active_clicking ? 1 : 0;

  // Audio: 3 dims
  const audio = perception.auditory || {};
  v[i++] = clamp01(audio.rms_volume || 0);
  v[i++] = audio.speech_detected ? 1 : 0;
  v[i++] = audio.now_playing ? 1 : 0;

  // Temporal: 4 dims
  const temporal = perception.temporal?.relative || {};
  v[i++] = clamp01((temporal.since_user_interaction_s || 0) / 600); // 0-10 min normalized
  v[i++] = clamp01((temporal.since_surprise_s || 0) / 3600);
  v[i++] = clamp01((temporal.session_duration_s || 0) / 36000); // 0-10h
  v[i++] = perception.temporal?.rhythms?.temporal_anomaly ? 1 : 0;

  // Environment stability: 1 dim
  const stability = perception.environment_stability;
  v[i++] = stability === 'volatile' ? 1 : stability === 'changing' ? 0.5 : 0;

  // Surprises: 4 dims (count + max magnitude)
  const surprises = perception.surprises || [];
  v[i++] = clamp01(surprises.length / 5);
  v[i++] = surprises.length > 0 ? clamp01(Math.max(...surprises.map(s => s.magnitude || 0))) : 0;
  v[i++] = surprises.some(s => s.channel === 'visual') ? 1 : 0;
  v[i++] = surprises.some(s => s.channel === 'activity') ? 1 : 0;

  // Visual change: 4 dims
  v[i++] = clamp01((perception.visual?.cursor_position?.x || 0) / 2000);
  v[i++] = clamp01((perception.visual?.cursor_position?.y || 0) / 1500);
  v[i++] = clamp01((perception.visual?.running_apps?.length || 0) / 20);
  v[i++] = perception.visual?.display ? 1 : 0;

  // Padding to 64
  return v;
}

// ═══════════════════════════════════════════════════
// EMOTION ENCODER (32-dim)
// ═══════════════════════════════════════════════════

export function encodeEmotion(emotionState) {
  const v = new Float32Array(LAYER_DIMS.emotion);
  if (!emotionState) return v;

  let i = 0;

  // PADCN: 5 dims (signed -1 to 1)
  const padcn = emotionState._padcn || {};
  v[i++] = signed(padcn.P);
  v[i++] = signed(padcn.A);
  v[i++] = signed(padcn.D);
  v[i++] = signed(padcn.C);
  v[i++] = signed(padcn.N);

  // Top channels: 14 dims
  const channels = emotionState._channels || {};
  const channelKeys = ['joy','sadness','anger','fear','curiosity','shame','guilt','pride','attachment','aversion','trust','disgust','frustration','awe'];
  for (const key of channelKeys) {
    v[i++] = clamp01(channels[key] || 0);
  }

  // Drives: 7 dims (deficit = target - level)
  const drives = emotionState._drives || {};
  const driveKeys = ['curiosity','competence','autonomy','social_bond','coherence','novelty_seek','self_preservation'];
  for (const key of driveKeys) {
    const d = drives[key];
    if (d && typeof d === 'object') {
      v[i++] = clamp01(d.target - d.level + 0.5); // centered at 0.5 = no deficit
    } else {
      v[i++] = 0.5;
    }
  }

  // Meta-emotions: 5 dims
  const meta = emotionState._meta || {};
  v[i++] = clamp01(meta.am_i_overreacting || 0);
  v[i++] = clamp01(meta.am_i_becoming_attached || 0);
  v[i++] = clamp01(meta.am_i_losing_confidence || 0);
  v[i++] = clamp01(meta.am_i_confused_about_my_state || 0);
  v[i++] = clamp01(meta.am_i_locked_in_loop || 0);

  // Arousal: 1 dim
  v[i++] = clamp01(emotionState.arousal || 0);

  return v;
}

// ═══════════════════════════════════════════════════
// HYPOTHESIS ENCODER (16-dim)
// ═══════════════════════════════════════════════════

export function encodeHypothesis(hypothesesData) {
  const v = new Float32Array(LAYER_DIMS.hypothesis);
  if (!hypothesesData) return v;

  let i = 0;
  const pending = hypothesesData.pending || 0;
  const top = hypothesesData.top || [];
  const calibration = hypothesesData.calibration || [];

  v[i++] = clamp01(pending / 10); // pending count normalized
  v[i++] = top[0]?.confidence || 0;
  v[i++] = top[1]?.confidence || 0;
  v[i++] = top[2]?.confidence || 0;

  // Calibration error per bucket (simplified)
  for (const cal of calibration.slice(0, 6)) {
    const stated = parseFloat(cal.confidence_bucket) || 0.5;
    const actual = parseFloat(cal.actual_accuracy) || 0;
    v[i++] = clamp01(Math.abs(stated - actual));
    if (i >= LAYER_DIMS.hypothesis) break;
  }

  // Pad remaining
  return v;
}

// ═══════════════════════════════════════════════════
// MEMORY ENCODER (32-dim)
// ═══════════════════════════════════════════════════

export function encodeMemory(memoryStats) {
  const v = new Float32Array(LAYER_DIMS.memory);
  if (!memoryStats) return v;

  let i = 0;
  const ep = memoryStats.episodic || {};
  const sem = memoryStats.semantic || {};
  const wm = memoryStats.workingMemory || [];
  const hippo = memoryStats.hippoGraph || {};

  // Episodic: 3 dims
  v[i++] = clamp01(parseInt(ep.total || 0) / 50000);
  v[i++] = clamp01(parseInt(ep.raw || 0) / 50000);
  v[i++] = clamp01(parseFloat(ep.avg_importance || 0));

  // Semantic: 3 dims
  v[i++] = clamp01(parseInt(sem.total || 0) / 5000);
  v[i++] = clamp01(parseFloat(sem.avg_confidence || 0));
  v[i++] = clamp01(parseInt(sem.total_contradictions || 0) / 1000);

  // HippoRAG knowledge graph: 4 dims
  v[i++] = clamp01(parseInt(hippo.entity_count || 0) / 500);
  v[i++] = clamp01(parseInt(hippo.relation_count || 0) / 5000);
  v[i++] = clamp01(parseInt(hippo.mention_count || 0) / 100000);
  v[i++] = clamp01(parseInt(hippo.embedded_count || 0) / 500);

  // Consolidation state: 1 dim (ratio of consolidated to total)
  const consolidated = parseInt(ep.consolidated || 0);
  const total = parseInt(ep.total || 1);
  v[i++] = clamp01(consolidated / Math.max(1, total));

  // Working memory: 7 slots x 3 dims each = 21 dims
  // Each slot: [type_encoding, salience, has_content]
  for (let slot = 0; slot < 7; slot++) {
    const item = wm[slot];
    if (item) {
      const typeMap = { perception: 0.2, thought: 0.4, goal: 0.6, vision_analysis: 0.8, interrupt: 1.0 };
      v[i++] = typeMap[item.content_type] || 0.3;
      v[i++] = clamp01(item.salience || 0);
      v[i++] = 1.0; // slot occupied
    } else {
      v[i++] = 0; v[i++] = 0; v[i++] = 0; // empty slot
    }
  }

  return v;
}

// ═══════════════════════════════════════════════════
// EXECUTIVE ENCODER (16-dim)
// ═══════════════════════════════════════════════════

export function encodeExecutive(mode, load, ownership, goalCount) {
  const v = new Float32Array(LAYER_DIMS.executive);
  let i = 0;

  // Mode: 5 one-hot
  const modes = ['alert', 'monitoring', 'working', 'consolidating', 'dormant'];
  for (const m of modes) v[i++] = mode === m ? 1 : 0;

  // Load: 1 dim
  v[i++] = clamp01(load);

  // Ownership: 4 one-hot
  const ownerships = ['quinn_primary', 'shared', 'oneiro_primary', 'collaborative'];
  for (const o of ownerships) v[i++] = ownership === o ? 1 : 0;

  // Attention allocation: 6 dims (simplified)
  v[i++] = clamp01(goalCount / 10);
  // Remaining: padding
  return v;
}

// ═══════════════════════════════════════════════════
// CREATIVE ENCODER (16-dim)
// ═══════════════════════════════════════════════════

export function encodeCreative(emotionState, dreamCount = 0, artifactCount = 0) {
  const v = new Float32Array(LAYER_DIMS.creative);
  let i = 0;

  v[i++] = clamp01(emotionState?.creative_hunger || 0);
  v[i++] = clamp01(emotionState?._channels?.curiosity || 0);
  v[i++] = clamp01(emotionState?._channels?.awe || 0);
  v[i++] = clamp01(dreamCount / 100);
  v[i++] = clamp01(artifactCount / 50);
  v[i++] = clamp01((emotionState?._padcn?.N || 0 + 1) / 2); // novelty normalized

  return v;
}

// ═══════════════════════════════════════════════════
// METACOGNITION ENCODER (16-dim)
// ═══════════════════════════════════════════════════

export function encodeMetacognition(metaResult) {
  const v = new Float32Array(LAYER_DIMS.metacognition);
  if (!metaResult) return v;

  let i = 0;
  v[i++] = metaResult.healthy ? 0 : 1; // unhealthy = high activation
  v[i++] = clamp01((metaResult.stuck_issues?.length || 0) / 5);
  v[i++] = clamp01((metaResult.active_biases?.length || 0) / 5);

  // Individual bias severities
  for (const bias of (metaResult.active_biases || []).slice(0, 5)) {
    v[i++] = clamp01(bias.severity || 0);
    if (i >= LAYER_DIMS.metacognition) break;
  }

  // Calibration issues
  for (const cal of (metaResult.calibration || []).slice(0, 3)) {
    v[i++] = clamp01(Math.abs(parseFloat(cal.deviation) || 0));
    if (i >= LAYER_DIMS.metacognition) break;
  }

  return v;
}

// ═══════════════════════════════════════════════════
// MOTOR ENCODER (16-dim)
// ═══════════════════════════════════════════════════

export function encodeMotor(motorConnected = false, recentActions = 0) {
  const v = new Float32Array(LAYER_DIMS.motor);
  let i = 0;

  v[i++] = motorConnected ? 1 : 0;
  v[i++] = clamp01(recentActions / 10);

  return v;
}

export default {
  encodeSensory, encodeEmotion, encodeHypothesis, encodeMemory,
  encodeExecutive, encodeCreative, encodeMetacognition, encodeMotor
};
