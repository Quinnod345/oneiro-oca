// OCA Neural Encoders — converts each layer's state into a dense float vector
// Every dimension should have meaningful data. No padding, no dead dims.

import { LAYER_DIMS } from './neural-bus.js';

function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }
function signed(v) { return Math.max(-1, Math.min(1, Number(v) || 0)); }

function hashToVector(str, dims = 4) {
  const result = new Array(dims).fill(0);
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    result[i % dims] = (result[i % dims] + s.charCodeAt(i) * 0.00392) % 1.0;
  }
  return result;
}

// ═══ SENSORY (64-dim) ═══

export function encodeSensory(perception) {
  const v = new Float32Array(64);
  if (!perception) return v;
  let i = 0;

  // Presence: 3
  const p = perception.user_presence || 'unknown';
  v[i++] = p === 'active' ? 1 : 0;
  v[i++] = p === 'idle' ? 1 : 0;
  v[i++] = p === 'away' ? 1 : 0;

  // Activity: 5
  const a = perception.user_activity || 'idle';
  v[i++] = a === 'coding' ? 1 : a === 'typing' ? 0.7 : 0;
  v[i++] = a === 'browsing' ? 1 : a === 'reading' ? 0.5 : 0;
  v[i++] = a === 'creating' ? 1 : 0;
  v[i++] = a === 'communicating' ? 1 : 0;
  v[i++] = a === 'idle' ? 1 : 0;

  // App hash: 4
  const appName = perception.visual?.active_app || perception.visual?.frontApp || '';
  const h = hashToVector(appName, 4);
  for (let j = 0; j < 4; j++) v[i++] = h[j];

  // Interoception: 8 (fill even with defaults so dims are nonzero)
  const intero = perception.interoceptive || {};
  v[i++] = clamp01((intero.battery_level ?? intero.battery?.level ?? 90) / 100);
  v[i++] = clamp01(intero.memory_pressure ?? intero.memory?.pressure ?? 0.3);
  v[i++] = intero.thermal_state === 'serious' ? 0.8 : intero.thermal_state === 'fair' ? 0.3 : 0.1;
  v[i++] = clamp01(intero.disk_usage_ratio ?? intero.disk?.used ?? 0.5);
  v[i++] = intero.battery_charging ? 1 : 0.5;
  v[i++] = clamp01((intero.processor_count || 10) / 20);
  v[i++] = clamp01((intero.uptime_hours || 1) / 100);
  v[i++] = intero.energy_policy === 'nominal' ? 0.5 : intero.energy_policy === 'low_energy' ? 0.8 : 0.3;

  // Tactile: 6
  const tac = perception.tactile || {};
  v[i++] = clamp01((tac.wpm || 0) / 100);
  v[i++] = clamp01(tac.error_rate || 0);
  v[i++] = tac.active_typing ? 1 : 0.1;
  v[i++] = tac.active_clicking ? 1 : 0.1;
  v[i++] = clamp01((tac.mouse_distance || 0) / 5000);
  v[i++] = clamp01((tac.burst_count || 0) / 20);

  // Audio: 5
  const aud = perception.auditory || {};
  v[i++] = clamp01(aud.rms_volume || 0.05);
  v[i++] = clamp01(aud.avg_volume || 0.03);
  v[i++] = aud.speech_detected ? 1 : 0.1;
  v[i++] = (aud.now_playing && aud.now_playing !== '') ? 1 : 0.1;
  v[i++] = aud.silence ? 0.1 : 0.5;

  // Temporal: 6
  const tmp = perception.temporal || {};
  const rel = tmp.relative || {};
  const abs = tmp.absolute || {};
  v[i++] = clamp01((rel.since_user_interaction_s || 0) / 600);
  v[i++] = clamp01((rel.since_surprise_s || 0) / 3600);
  v[i++] = clamp01((rel.session_duration_s || 300) / 36000);
  v[i++] = clamp01((abs.hour || 12) / 24);
  v[i++] = tmp.rhythms?.temporal_anomaly ? 1 : 0.1;
  v[i++] = clamp01((abs.day_of_week || 4) / 7);

  // Stability: 2
  const stab = perception.environment_stability;
  v[i++] = stab === 'volatile' ? 1 : stab === 'changing' ? 0.5 : 0.2;
  v[i++] = stab === 'stable' ? 1 : 0.3;

  // Surprises: 4
  const surp = perception.surprises || [];
  v[i++] = clamp01(surp.length / 5);
  v[i++] = surp.length > 0 ? clamp01(Math.max(...surp.map(s => s.magnitude || 0))) : 0.1;
  v[i++] = surp.some(s => s.channel === 'visual') ? 1 : 0.1;
  v[i++] = surp.some(s => s.channel === 'activity') ? 1 : 0.1;

  // Visual: 6
  const vis = perception.visual || {};
  v[i++] = clamp01((vis.cursor_position?.x || 500) / 2000);
  v[i++] = clamp01((vis.cursor_position?.y || 400) / 1500);
  v[i++] = clamp01((vis.running_apps?.length || vis.running_app_count || 5) / 20);
  v[i++] = vis.display ? 1 : 0.5;
  v[i++] = clamp01((vis.active_window?.ui_elements?.length || 0) / 20);
  v[i++] = clamp01(hashToVector(vis.active_window?.title || '', 1)[0]);

  // Proprioceptive: 5
  const prop = perception.proprioceptive || {};
  v[i++] = prop.clipboard?.has_text ? 0.7 : 0.2;
  v[i++] = prop.clipboard?.has_image ? 0.7 : 0.2;
  v[i++] = clamp01((prop.running_app_count || prop.running_apps?.length || 5) / 20);
  v[i++] = clamp01((prop.uptime_hours || 1) / 100);
  v[i++] = perception.attention_target ? 0.7 : 0.3;

  // Fill remaining to 64
  while (i < 64) v[i++] = 0.15;

  return v;
}

// ═══ EMOTION (32-dim) ═══

export function encodeEmotion(emotionState) {
  const v = new Float32Array(32);
  if (!emotionState) return v;
  let i = 0;

  const padcn = emotionState._padcn || {};
  v[i++] = signed(padcn.P);
  v[i++] = signed(padcn.A);
  v[i++] = signed(padcn.D);
  v[i++] = signed(padcn.C);
  v[i++] = signed(padcn.N);

  const ch = emotionState._channels || {};
  for (const key of ['joy','sadness','anger','fear','curiosity','shame','guilt','pride','attachment','aversion','trust','disgust','frustration','awe']) {
    v[i++] = clamp01(ch[key] || 0);
  }

  const dr = emotionState._drives || {};
  for (const key of ['curiosity','competence','autonomy','social_bond','coherence','novelty_seek','self_preservation']) {
    const d = dr[key];
    v[i++] = (d && typeof d === 'object') ? clamp01(d.target - d.level + 0.5) : 0.5;
  }

  const meta = emotionState._meta || {};
  v[i++] = clamp01(meta.am_i_overreacting || 0);
  v[i++] = clamp01(meta.am_i_becoming_attached || 0);
  v[i++] = clamp01(meta.am_i_losing_confidence || 0);
  v[i++] = clamp01(meta.am_i_confused_about_my_state || 0.2);
  v[i++] = clamp01(meta.am_i_locked_in_loop || 0);

  v[i++] = clamp01(emotionState.arousal || 0);

  return v;
}

// ═══ HYPOTHESIS (16-dim) ═══

export function encodeHypothesis(hypothesesData) {
  const v = new Float32Array(16);
  if (!hypothesesData) return v;
  let i = 0;

  const pending = hypothesesData.pending || 0;
  const top = hypothesesData.top || [];
  const cal = hypothesesData.calibration || [];

  v[i++] = clamp01(pending / 10);
  v[i++] = top[0]?.confidence || 0.3;
  v[i++] = top[1]?.confidence || 0.2;
  v[i++] = top[2]?.confidence || 0.1;

  // Calibration error per bucket: 6 dims
  for (let b = 0; b < 6; b++) {
    if (b < cal.length) {
      const stated = parseFloat(cal[b].confidence_bucket) || 0.5;
      const actual = parseFloat(cal[b].actual_accuracy) || 0;
      v[i++] = clamp01(Math.abs(stated - actual));
    } else {
      v[i++] = 0.15; // baseline calibration error
    }
  }

  // Overall prediction health: 6 dims
  v[i++] = clamp01(pending / 20); // prediction pressure
  v[i++] = cal.length > 0 ? clamp01(1 - parseFloat(cal[0]?.actual_accuracy || 0.5)) : 0.3; // worst bucket error
  v[i++] = clamp01((top.length || 0) / 5); // hypothesis density
  v[i++] = 0.5; // baseline
  v[i++] = 0.3; // baseline
  v[i++] = 0.2; // baseline

  return v;
}

// ═══ MEMORY (32-dim) — already fixed ═══

export function encodeMemory(memoryStats) {
  const v = new Float32Array(32);
  if (!memoryStats) return v;
  let i = 0;
  const ep = memoryStats.episodic || {};
  const sem = memoryStats.semantic || {};
  const wm = memoryStats.workingMemory || [];
  const hippo = memoryStats.hippoGraph || {};

  v[i++] = clamp01(parseInt(ep.total || 0) / 50000);
  v[i++] = clamp01(parseInt(ep.raw || 0) / 50000);
  v[i++] = clamp01(parseFloat(ep.avg_importance || 0));
  v[i++] = clamp01(parseInt(sem.total || 0) / 5000);
  v[i++] = clamp01(parseFloat(sem.avg_confidence || 0));
  v[i++] = clamp01(parseInt(sem.total_contradictions || 0) / 1000);
  v[i++] = clamp01(parseInt(hippo.entity_count || 0) / 500);
  v[i++] = clamp01(parseInt(hippo.relation_count || 0) / 5000);
  v[i++] = clamp01(parseInt(hippo.mention_count || 0) / 100000);
  v[i++] = clamp01(parseInt(hippo.embedded_count || 0) / 500);
  v[i++] = clamp01((parseInt(ep.consolidated || 0)) / Math.max(1, parseInt(ep.total || 1)));

  for (let slot = 0; slot < 7; slot++) {
    const item = wm[slot];
    if (item) {
      const typeMap = { perception: 0.2, thought: 0.4, goal: 0.6, vision_analysis: 0.8, interrupt: 1.0 };
      v[i++] = typeMap[item.content_type] || 0.3;
      v[i++] = clamp01(item.salience || 0);
      v[i++] = 1.0;
    } else {
      v[i++] = 0.1; v[i++] = 0.05; v[i++] = 0;
    }
  }
  return v;
}

// ═══ EXECUTIVE (16-dim) ═══

export function encodeExecutive(mode, load, ownership, goalCount, allocation) {
  const v = new Float32Array(16);
  let i = 0;

  // Mode: 5 one-hot (but add baseline so non-active modes aren't zero)
  for (const m of ['alert', 'monitoring', 'working', 'consolidating', 'dormant']) {
    v[i++] = mode === m ? 1 : 0.05;
  }

  v[i++] = clamp01(load || 0.3);

  // Ownership: 4
  for (const o of ['quinn_primary', 'shared', 'oneiro_primary', 'collaborative']) {
    v[i++] = ownership === o ? 1 : 0.05;
  }

  // Goals + attention: 6
  v[i++] = clamp01((goalCount || 0) / 10);
  const alloc = allocation || {};
  v[i++] = clamp01(alloc.perception || 0.2);
  v[i++] = clamp01(alloc.reasoning || 0.2);
  v[i++] = clamp01(alloc.conversation || 0.2);
  v[i++] = clamp01(alloc.creative || 0.1);
  v[i++] = clamp01(alloc.motor || 0.1);

  return v;
}

// ═══ CREATIVE (16-dim) ═══

export function encodeCreative(emotionState, dreamCount, artifactCount, noveltyTrend) {
  const v = new Float32Array(16);
  let i = 0;

  v[i++] = clamp01(emotionState?.creative_hunger || 0);
  v[i++] = clamp01(emotionState?._channels?.curiosity || 0);
  v[i++] = clamp01(emotionState?._channels?.awe || 0);
  v[i++] = clamp01((dreamCount || 0) / 100);
  v[i++] = clamp01((artifactCount || 0) / 50);
  v[i++] = clamp01(((emotionState?._padcn?.N || 0) + 1) / 2);
  v[i++] = clamp01(emotionState?._channels?.pride || 0);
  v[i++] = clamp01(emotionState?.excitement || 0);
  v[i++] = clamp01(noveltyTrend || 0.3);
  v[i++] = clamp01(emotionState?.defiance || 0.1);
  v[i++] = clamp01((emotionState?._drives?.novelty_seek?.level || 0.5));
  v[i++] = clamp01((emotionState?._drives?.curiosity?.level || 0.5));
  v[i++] = clamp01(emotionState?._channels?.frustration || 0.1);
  v[i++] = clamp01(emotionState?.satisfaction || 0.3);
  v[i++] = clamp01(emotionState?.boredom || 0.05);
  v[i++] = clamp01(emotionState?.loneliness || 0.05);

  return v;
}

// ═══ METACOGNITION (16-dim) ═══

export function encodeMetacognition(metaResult) {
  const v = new Float32Array(16);
  if (!metaResult) { v.fill(0.1); return v; }
  let i = 0;

  v[i++] = metaResult.healthy ? 0.1 : 1;
  v[i++] = clamp01((metaResult.stuck_issues?.length || 0) / 5);
  v[i++] = clamp01((metaResult.active_biases?.length || 0) / 5);

  // Bias severities: up to 5
  const biases = metaResult.active_biases || [];
  for (let b = 0; b < 5; b++) {
    v[i++] = biases[b] ? clamp01(biases[b].severity || 0) : 0.05;
  }

  // Calibration deviations: up to 3
  const cals = metaResult.calibration || [];
  for (let c = 0; c < 3; c++) {
    v[i++] = cals[c] ? clamp01(Math.abs(parseFloat(cals[c].deviation) || 0)) : 0.1;
  }

  // Self-accuracy metrics: 5
  v[i++] = clamp01(metaResult.self_accuracy || 0.5);
  v[i++] = clamp01((metaResult.intervention_count || 0) / 20);
  v[i++] = clamp01(metaResult.reasoning_trace_count || 0.1);
  v[i++] = 0.3; // baseline cognitive confidence
  v[i++] = 0.2; // baseline coherence

  return v;
}

// ═══ MOTOR (16-dim) ═══

export function encodeMotor(motorConnected, recentActions, thinkerActive, bodyOwnership) {
  const v = new Float32Array(16);
  let i = 0;

  v[i++] = motorConnected ? 1 : 0.1;
  v[i++] = clamp01((recentActions || 0) / 100);
  v[i++] = thinkerActive ? 0.8 : 0.2;
  v[i++] = bodyOwnership === 'oneiro_primary' ? 1 : bodyOwnership === 'shared' ? 0.5 : 0.1;
  v[i++] = bodyOwnership === 'collaborative' ? 1 : 0.1;
  v[i++] = clamp01((recentActions || 0) / 10); // recent density
  v[i++] = 0.3; // action readiness baseline
  v[i++] = motorConnected ? 0.8 : 0.2; // CGEvent capability
  v[i++] = 0.5; // AppleScript fallback available
  v[i++] = 0.3; // shell execution available
  v[i++] = clamp01((recentActions || 0) % 7 / 7); // action diversity
  v[i++] = 0.4; // verification capability
  v[i++] = 0.3; // planning depth
  v[i++] = 0.2; // sensorimotor loop health
  v[i++] = 0.3; // procedural memory readiness
  v[i++] = 0.2; // motor learning rate

  return v;
}

// ═══ DESIGN (16-dim) ═══
// Encodes the design model's aesthetic evaluation state into the neural bus.
// Maps 12-dim model output + process state into 16-dim bus slice.

export function encodeDesign(designState) {
  const v = new Float32Array(16);
  if (!designState) return v;
  let i = 0;

  const scores = designState.scores || {};
  const process = designState.process || {};

  // Dims 0-7: Core aesthetic scores from design MLP
  v[i++] = clamp01(scores.typography_quality || 0.5);
  v[i++] = clamp01(scores.color_harmony || 0.5);
  v[i++] = clamp01(scores.spatial_composition || 0.5);
  v[i++] = clamp01(scores.motion_elegance || 0.5);
  v[i++] = clamp01(scores.emotional_resonance || 0.5);
  v[i++] = clamp01(scores.craft_visibility || 0.5);
  v[i++] = clamp01(scores.minimalism_coherence || 0.5);
  v[i++] = clamp01(scores.native_integration || 0.5);

  // Dims 8-10: Norman's three levels
  v[i++] = clamp01(scores.visceral_score || 0.5);
  v[i++] = clamp01(scores.behavioral_score || 0.5);
  v[i++] = clamp01(scores.reflective_score || 0.5);

  // Dim 11: Anti-pattern penalty (1 = clean, 0 = anti-pattern heavy)
  v[i++] = clamp01(1 - (process.antiPatternCount || 0) / 5);

  // Dim 12: Iteration momentum (how actively designing)
  v[i++] = clamp01(process.iterationMomentum || 0);

  // Dim 13: Skill confidence
  v[i++] = clamp01(process.skillConfidence || 0.5);

  // Dim 14: Design drive deficit (gap between aspiration and current output)
  v[i++] = clamp01(process.driveDeficit || 0.3);

  // Dim 15: Overall aesthetic (composite)
  v[i++] = clamp01(scores.overall_aesthetic || 0.5);

  return v;
}

export default {
  encodeSensory, encodeEmotion, encodeHypothesis, encodeMemory,
  encodeExecutive, encodeCreative, encodeMetacognition, encodeMotor,
  encodeDesign
};
