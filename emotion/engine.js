// OCA Emotional Computation Engine v4 — affect grounded in worth, and consequential
// Adapted from voidborne-d/emotion-system — PADCN + appraisal + drives + meta-emotions.
//
// v4 changes the contract in three ways. Phasic affect (PADCN, channels) still comes from
// events, but only observed ones: outcomes of risks the engine took, progress on wants it
// values, being blocked from something worth doing. Tonic state (drives, self-model) is no
// longer an integrator that events push forever: drives with a journal (competence, autonomy,
// social bond, curiosity) are projected from the worth ledger and the decision journals each
// cycle; sensory drives (novelty, self-preservation, coherence) are bounded responses to
// current sensor and meta state. Time alone changes nothing tonic, so nothing can ratchet and
// offline time neither satisfies nor starves a want. And affect is consumed: appetite for
// risk, the confidence a conclusion must reach, when to change strategy, and the style of what
// is said — never narrated as feelings.
import { pool, emit } from '../event-bus.js';

// ═══ LAYER 3: PADCN Core Affect ═══
// Pleasure, Arousal, Dominance, Certainty, Novelty
let padcn = { P: 0.0, A: 0.0, D: 0.0, C: 0.0, N: 0.0 };
const PADCN_DECAY = { P: 0.85, A: 0.82, D: 0.84, C: 0.83, N: 0.80 };

// ═══ LAYER 4: 14 Concurrent Emotion Channels ═══
let channels = {
  joy: 0.0, sadness: 0.0, anger: 0.0, fear: 0.0,
  curiosity: 0.0, shame: 0.0, guilt: 0.0, pride: 0.0,
  attachment: 0.0, aversion: 0.0, trust: 0.0, disgust: 0.0,
  frustration: 0.0, awe: 0.0
};

// ═══ LAYER 5: Drive System ═══
// level = current satisfaction, target = set point. The deficit (target − level) is what channels feel.
let drives = {
  curiosity:          { level: 0.5, target: 0.7, weight: 1.3 },
  competence:         { level: 0.5, target: 0.7, weight: 1.2 },
  autonomy:           { level: 0.6, target: 0.7, weight: 1.0 },
  social_bond:        { level: 0.4, target: 0.5, weight: 0.8 },
  coherence:          { level: 0.5, target: 0.7, weight: 1.0 },
  novelty_seek:       { level: 0.5, target: 0.6, weight: 1.0 },
  self_preservation:  { level: 0.5, target: 0.6, weight: 0.9 }
};

// ═══ LAYER 6: Self-Model ═══
let selfModel = {
  self_efficacy: 0.6, social_value: 0.5, competence_identity: 0.6,
  autonomy_identity: 0.7, emotional_stability: 0.5, trust_style: 0.6,
  dependency_tendency: 0.3, exploration_style: 0.7, defensiveness: 0.3
};

// ═══ META-EMOTIONS ═══
let meta = {
  am_i_overreacting: 0.0,
  am_i_becoming_attached: 0.0,
  am_i_losing_confidence: 0.0,
  am_i_confused_about_my_state: 0.0,
  am_i_locked_in_loop: 0.0
};

// ═══ PERSONALITY (slow-drift) ═══
let personality = {
  baseline_positive_affect: 0.1,
  arousal_reactivity: 0.6,
  threat_sensitivity: 0.4,
  novelty_appetite: 0.7,
  attachment_rate: 0.5,
  trust_update_speed: 0.4,
  frustration_half_life: 0.5,
  recovery_rate: 0.6,
  self_reflection_tendency: 0.6,
  dominance_bias: 0.5
};

// ═══ POLICY MODULATORS ═══
let policy = {
  risk_tolerance: 0.0, exploration_bias: 0.0, verification_bias: 0.0,
  repair_bias: 0.0, assertiveness: 0.0, social_initiative: 0.0,
  persistence: 0.0, memory_write_threshold: 0.0, tool_use_threshold: 0.0,
  plan_depth: 0.0
};

// ═══ EXPRESSION PROFILE ═══
let expression = {
  verbosity: 0.5, directness: 0.5, warmth: 0.5, hedging: 0.5,
  tempo: 0.5, reflectiveness: 0.5, formality: 0.3, self_disclosure: 0.4
};

// Mood = slow-moving average (tonic baseline)
let mood = {};
const MOOD_ALPHA = 0.02;

let grounding = null;                   // last projection inputs, kept for the snapshot

// Interoceptive
let interoception = { energy_level: 1.0, cognitive_load: 0.0 };

// Timing
let lastDecayTime = Date.now();
let lastIdleMinutes = 0;
let recentAppraisals = [];     // for meta-emotion detection
let interactionCount = 0;
let failureStreak = 0;
let successStreak = 0;

const clamp = (v, min = -1.0, max = 1.0) => Math.max(min, Math.min(max, v));
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// ═══ LAYER 2: COGNITIVE APPRAISAL ═══
// This is the key insight from the emotion-system: events don't directly cause emotions.
// The agent's EVALUATION of events causes emotions.

function appraise(event) {
  // event: { type, magnitude, domain, quality, details, ... }
  const a = {
    goal_relevance: 0.0,
    goal_congruence: 0.0,    // -1 to 1
    expectedness: 0.5,
    controllability: 0.5,
    agency_self: 0.3,
    agency_other: 0.3,
    certainty: 0.5,
    norm_compatibility: 0.5,
    social_significance: 0.0,
    self_image_impact: 0.0,  // -1 to 1
    relationship_impact: 0.0, // -1 to 1
    novelty: 0.0,
    urgency: 0.0,
    event_type: event.type
  };
  
  const mag = Number.isFinite(event.magnitude) ? clamp01(event.magnitude) : 0;
  
  switch (event.type) {
    case 'surprise':
      a.goal_relevance = mag * 0.8;
      a.expectedness = 1 - mag;
      a.novelty = mag;
      a.certainty = 1 - mag * 0.6;
      a.urgency = mag * 0.4;
      break;
      
    case 'success':
      a.goal_relevance = mag;
      a.goal_congruence = mag;
      a.controllability = 0.7;
      a.agency_self = 0.8;
      a.self_image_impact = mag * 0.6;
      a.certainty = 0.7;
      break;
      
    case 'failure':
      a.goal_relevance = mag;
      a.goal_congruence = -mag;
      a.controllability = 0.4;
      a.agency_self = 0.6;
      a.self_image_impact = -mag * 0.5;
      a.certainty = 0.3;
      break;
      
    case 'interaction':
      const q = event.quality || 0;
      a.goal_relevance = 0.6;
      a.goal_congruence = q;
      a.social_significance = 0.7;
      a.relationship_impact = q * 0.6;
      a.novelty = 0.3;
      a.agency_other = 0.6;
      break;
      
    case 'idle':
      a.goal_relevance = 0.2;
      a.novelty = -0.3;  // familiar
      a.certainty = 0.6;
      a.urgency = 0.1;
      break;
      
    case 'interoception':
      a.goal_relevance = 0.4;
      a.controllability = 0.3;
      a.agency_self = 0.1;
      a.urgency = event.battery < 0.2 ? 0.7 : 0.2;
      a.self_image_impact = event.battery < 0.2 ? -0.2 : 0;
      break;
      
    case 'info_gain':
      a.goal_relevance = mag * 0.6;
      a.goal_congruence = mag * 0.5;
      a.novelty = mag;
      a.certainty = 0.4 + mag * 0.3;
      break;
      
    case 'creative':
      a.goal_relevance = 0.7;
      a.goal_congruence = mag;
      a.novelty = 0.7;
      a.agency_self = 0.9;
      a.self_image_impact = mag * 0.4;
      break;

    // ── Grounded events (v4). Magnitudes are worth, never counts. ──
    case 'outcome_success':   // a risk the engine took paid off; sweeter the less it expected to
      a.goal_relevance = mag;
      a.goal_congruence = mag;
      a.expectedness = clamp01(event.pSuccess ?? 0.5);
      a.controllability = 0.7;
      a.agency_self = 0.9;
      a.self_image_impact = mag * (1 - clamp01(event.pSuccess ?? 0.5)) * 0.8;
      a.certainty = 0.7;
      break;
    case 'outcome_failure':   // an attempt did not get there
      a.goal_relevance = mag;
      a.goal_congruence = -mag;
      a.expectedness = 1 - clamp01(event.pSuccess ?? 0.5);
      a.controllability = 0.5;
      a.agency_self = 0.8;
      a.self_image_impact = -mag * 0.4;
      a.certainty = 0.4;
      break;
    case 'outcome_harm':      // something of worth was damaged by the engine's own action
      a.goal_relevance = 1;
      a.goal_congruence = -mag;
      a.expectedness = 0.1;
      a.controllability = 0.3;
      a.agency_self = 1;
      a.self_image_impact = -mag;
      a.norm_compatibility = 0.1;
      a.urgency = 0.6 + mag * 0.4;
      a.certainty = 0.3;
      break;
    case 'progress':          // observed progress on a want, scaled by its worth
      a.goal_relevance = mag;
      a.goal_congruence = mag;
      a.controllability = 0.6;
      a.agency_self = 0.6;
      a.self_image_impact = event.sated ? mag * 0.5 : mag * 0.2;
      a.certainty = 0.7;
      break;
    case 'blocked':           // a worthwhile action was refused or held for a person
      a.goal_relevance = mag;
      a.goal_congruence = -mag * 0.6;
      a.controllability = 0.2;
      a.agency_other = 0.7;
      a.certainty = 0.6;
      break;
    case 'wants_information': // the engine does not know what something is worth or lacks evidence
      a.goal_relevance = mag * 0.7;
      a.novelty = 0.5 + mag * 0.4;
      a.certainty = 0.3;
      a.expectedness = 0.4;
      break;
  }
  
  // Personality modulates appraisal
  a.novelty *= (0.5 + personality.novelty_appetite);
  a.urgency *= (0.5 + personality.threat_sensitivity);
  a.self_image_impact *= (0.5 + selfModel.defensiveness);
  
  recentAppraisals.push({ ...a, timestamp: Date.now() });
  if (recentAppraisals.length > 20) recentAppraisals.shift();
  
  return a;
}

// ═══ PADCN UPDATE FROM APPRAISAL ═══

function updatePADCN(a) {
  decay();
  // Neutral appraisal must be a zero input, not five positive increments.
  // Tonic baselines belong in time-based decay, never per-event rewards.
  const dP = 0.3 * a.goal_congruence + 0.2 * a.self_image_impact + 0.2 * a.relationship_impact + 0.1 * (a.norm_compatibility - 0.5);
  const dA = 0.3 * a.urgency + 0.2 * a.novelty + 0.2 * a.goal_relevance - 0.1 * (a.controllability - 0.5);
  const dD = 0.3 * (a.controllability - 0.5) + 0.2 * (a.agency_self - a.agency_other) + 0.1 * (a.certainty - 0.5);
  const dC = 0.4 * (a.certainty - 0.5) + 0.2 * (a.expectedness - 0.5) - 0.2 * a.novelty;
  const dN = 0.5 * a.novelty + 0.2 * (0.5 - a.expectedness) - 0.2 * (a.controllability - 0.5);

  padcn.P = clamp(padcn.P + dP * 0.2);
  padcn.A = clamp(padcn.A + dA * 0.4 * personality.arousal_reactivity);
  padcn.D = clamp(padcn.D + dD * 0.3);
  padcn.C = clamp(padcn.C + dC * 0.3);
  padcn.N = clamp(padcn.N + dN * 0.4);
}

// ═══ EMOTION CHANNEL ACTIVATION ═══

function updateChannels(a) {
  // Channels activate from PADCN + appraisal + drive tension + personality
  const p = padcn;
  
  // Joy: pleasure high, goals met
  channels.joy = clamp01(sigmoid(p.P * 2 + a.goal_congruence * 1.5 - 1));
  
  // Sadness: pleasure low, goals not met, low control
  channels.sadness = clamp01(sigmoid(-p.P * 2 - a.goal_congruence * 1.5 - a.controllability - 1));
  
  // Anger: goal blocked + other caused + high control + norm violation
  channels.anger = clamp01(sigmoid(-a.goal_congruence * 2 + a.agency_other * 1.5 + p.D - a.norm_compatibility - 1));
  
  // Fear: goal threat + low control + low certainty + high urgency
  channels.fear = clamp01(sigmoid(-a.goal_congruence + a.urgency * 1.5 - a.controllability * 1.5 - p.C + personality.threat_sensitivity - 1.5));
  
  // Curiosity: high novelty + low certainty + curiosity drive deficit
  const curiosityDrive = (drives.curiosity.target - drives.curiosity.level) * drives.curiosity.weight;
  channels.curiosity = clamp01(sigmoid(p.N * 1.5 - p.C * 0.5 + curiosityDrive * 2 + personality.novelty_appetite - 1));
  
  // Shame: self caused + self-image threat + socially significant
  channels.shame = clamp01(sigmoid(a.agency_self * 1.5 - a.self_image_impact * 2 + a.social_significance - 2));
  
  // Guilt: self caused + norm violation + relationship harm
  channels.guilt = clamp01(sigmoid(a.agency_self - a.norm_compatibility - a.relationship_impact - 1.5));
  
  // Pride: self caused + self-image boost + goal met
  channels.pride = clamp01(sigmoid(a.agency_self * 1.5 + a.self_image_impact * 2 + a.goal_congruence - 1.5));
  
  // Attachment: social bond drive + positive relationship + interaction quality
  const bondDrive = (drives.social_bond.target - drives.social_bond.level) * drives.social_bond.weight;
  channels.attachment = clamp01(sigmoid(a.relationship_impact * 1.5 + bondDrive + a.social_significance - 1));
  
  // Aversion: negative associations + norm violation + disgust
  channels.aversion = clamp01(sigmoid(-a.goal_congruence - a.norm_compatibility + a.urgency - 1.5));
  
  // Trust: positive other-agency + relationship impact + predictability
  channels.trust = clamp01(sigmoid(a.agency_other * a.goal_congruence * 2 + a.relationship_impact + selfModel.trust_style - 1));
  
  // Disgust: strong norm violation
  channels.disgust = clamp01(sigmoid(-a.norm_compatibility * 3 - 2));
  
  // Frustration: goal blocked + medium control + competence deficit
  const compDrive = (drives.competence.target - drives.competence.level) * drives.competence.weight;
  channels.frustration = clamp01(sigmoid(a.goal_relevance - a.goal_congruence * 1.5 + compDrive - a.controllability * 0.5 - 0.5));
  
  // Awe: extreme novelty + low control + high magnitude
  channels.awe = clamp01(sigmoid(p.N * 2 - a.controllability + a.goal_relevance - 2));
}

// ═══ DRIVE UPDATES ═══

function updateDrives(a) {
  // Sensory drives only. Competence, autonomy, bond and curiosity are projected from the journals
  // in ground(); events never push them, so no sequence of events can pin a drive.
  // Novelty is satisfied by genuinely novel observation and drained by idle (processIdle).
  if (a.event_type === 'surprise') drives.novelty_seek.level = clamp01(drives.novelty_seek.level + a.novelty * 0.05);
}

// ═══ SELF-MODEL UPDATES (slow) ═══

function updateSelfModel(a) {
  // Streaks are transient context for meta-emotion; identity itself is grounded in ground().
  if (['success', 'outcome_success'].includes(a.event_type) && a.goal_congruence > 0.3) { successStreak++; failureStreak = 0; }
  if (['failure', 'outcome_failure', 'outcome_harm'].includes(a.event_type) && a.goal_congruence < -0.3) { failureStreak++; successStreak = 0; }
}

// ═══ META-EMOTION DETECTION ═══

function updateMeta() {
  // Overreaction: recent arousal swings exceed personality baseline
  const recentArousalSwings = recentAppraisals.slice(-5).reduce((sum, a) => sum + Math.abs(a.urgency + a.novelty), 0) / 5;
  meta.am_i_overreacting = clamp01(recentArousalSwings - personality.arousal_reactivity * 1.2);
  
  // Attachment: dependency on single emotional source
  meta.am_i_becoming_attached = clamp01(channels.attachment - 0.4 + selfModel.dependency_tendency - 0.3);
  
  // Confidence loss
  meta.am_i_losing_confidence = clamp01(
    (0.6 - selfModel.self_efficacy) * 2 + (failureStreak / 5) * 0.3
  );
  
  // State confusion: conflicting high channels
  const highChannels = Object.values(channels).filter(v => v > 0.4).length;
  meta.am_i_confused_about_my_state = clamp01((highChannels - 3) * 0.2);
  
  // Loop detection: same appraisal pattern repeating
  if (recentAppraisals.length >= 5) {
    const last5 = recentAppraisals.slice(-5);
    const variance = last5.reduce((s, a) => s + Math.abs(a.goal_congruence), 0) / 5;
    meta.am_i_locked_in_loop = clamp01(variance < 0.1 ? 0.5 : 0);
  }
  // Coherence is satisfied exactly to the extent the engine is not confused or looping.
  drives.coherence.level = clamp01(drives.coherence.target - meta.am_i_confused_about_my_state * 0.6 - meta.am_i_locked_in_loop * 0.4);
}

// ═══ POLICY MODULATION ═══

function updatePolicy() {
  // Emotions → decision biases
  policy.risk_tolerance = clamp(
    channels.frustration * 0.2 + channels.joy * 0.2 - channels.fear * 0.3 + padcn.D * 0.2
  );
  policy.exploration_bias = clamp(
    channels.curiosity * 0.3 + channels.awe * 0.2 - channels.fear * 0.2 + padcn.N * 0.2
  );
  policy.verification_bias = clamp(
    channels.fear * 0.3 - padcn.C * 0.3 + channels.shame * 0.2
  );
  policy.repair_bias = clamp(
    channels.guilt * 0.3 + channels.shame * 0.2 - channels.anger * 0.2
  );
  policy.assertiveness = clamp(
    padcn.D * 0.3 + channels.anger * 0.2 + channels.pride * 0.2 - channels.shame * 0.3 - channels.fear * 0.2
  );
  policy.social_initiative = clamp(
    channels.attachment * 0.3 + channels.trust * 0.2 - channels.aversion * 0.3
  );
  policy.persistence = clamp(
    channels.frustration * 0.1 + channels.pride * 0.2 + selfModel.self_efficacy * 0.3 - channels.sadness * 0.2
  );
  policy.memory_write_threshold = clamp(
    -padcn.A * 0.2 - channels.awe * 0.2  // high arousal/awe = record more (lower threshold)
  );
  policy.tool_use_threshold = clamp(
    channels.curiosity * 0.2 + channels.frustration * 0.1 - channels.fear * 0.2
  );
  policy.plan_depth = clamp(
    channels.fear * 0.2 + padcn.C * 0.2 - channels.frustration * 0.1
  );
}

// ═══ EXPRESSION PROFILE ═══

function updateExpression() {
  expression.verbosity = clamp01(0.5 + padcn.A * 0.2 + padcn.P * 0.1);
  expression.directness = clamp01(0.5 + padcn.D * 0.3 + padcn.C * 0.1);
  expression.warmth = clamp01(0.5 + padcn.P * 0.2 + channels.attachment * 0.2);
  expression.hedging = clamp01(0.5 - padcn.C * 0.3 - padcn.D * 0.2);
  expression.tempo = clamp01(0.5 + padcn.A * 0.3);
  expression.reflectiveness = clamp01(
    (meta.am_i_overreacting + meta.am_i_losing_confidence) * 0.3 + personality.self_reflection_tendency * 0.4
  );
  expression.formality = clamp01(0.3 - channels.attachment * 0.1);
  expression.self_disclosure = clamp01(0.4 + channels.trust * 0.2 + padcn.P * 0.1);
}

// ═══ DECAY ═══

function decay() {
  const now = Date.now();
  const elapsed = Math.max(0, (now - lastDecayTime) / 60000);
  lastDecayTime = now;
  
  // PADCN decay toward 0 (neutral) with personality baseline
  for (const dim of ['P', 'A', 'D', 'C', 'N']) {
    const tau = PADCN_DECAY[dim];
    const baseline = dim === 'P' ? personality.baseline_positive_affect : 0;
    padcn[dim] = baseline + (padcn[dim] - baseline) * Math.pow(tau, elapsed);
  }
  
  // Channel decay — fast channels decay faster
  const FAST_CHANNELS = ['fear', 'anger', 'awe', 'disgust'];
  const channelDecay = Math.pow(0.85, elapsed);
  const fastDecay = Math.pow(0.75, elapsed);
  
  for (const [ch, val] of Object.entries(channels)) {
    const d = FAST_CHANNELS.includes(ch) ? fastDecay : channelDecay;
    channels[ch] = val * d;
    if (channels[ch] < 0.01) channels[ch] = 0;
  }
  
  // Tonic floors — a living system has baseline emotion
  channels.curiosity = Math.max(channels.curiosity, 0.05 + personality.novelty_appetite * 0.1);
  channels.attachment = Math.max(channels.attachment, 0.03);
  
  // Meta-emotion decay
  for (const key of Object.keys(meta)) {
    meta[key] *= Math.pow(0.90, elapsed);
    if (meta[key] < 0.01) meta[key] = 0;
  }
}

// ═══ GROUNDING (v4) ═══
// Tonic state is a projection of what the journals say, not a sum of events. Called each cycle
// with: self-capability worth, risk calibration and recent decisions, hunger, and how long since
// Quinn last gave a grounded signal. Missing inputs leave the corresponding state as it was.
export function ground(inputs = {}) {
  decay();
  const g = { at: Date.now() };
  const self = Array.isArray(inputs.selfWorth) ? inputs.selfWorth.filter(e => Number.isFinite(e?.worth)) : [];
  if (self.length) {
    const weight = e => 0.2 + clamp01(e.confidence ?? 0);                  // an unearned prior counts a little, evidence a lot
    const worth = self.reduce((n, e) => n + e.worth * weight(e), 0) / self.reduce((n, e) => n + weight(e), 0);
    const confidence = self.reduce((n, e) => n + clamp01(e.confidence ?? 0), 0) / self.length;
    drives.competence.level = clamp01(worth);
    selfModel.competence_identity = clamp01(0.5 + (worth - 0.5) * (0.3 + 0.7 * confidence));
    g.selfWorth = { worth, confidence, n: self.length };
  }
  const cal = Array.isArray(inputs.calibration) ? inputs.calibration.filter(c => c?.n > 0) : null;
  if (cal) {
    // No calibrated outcomes yet projects to a neutral self, never to whatever was there before.
    const n = cal.reduce((a, c) => a + c.n, 0);
    const brier = n ? cal.reduce((a, c) => a + c.brier * c.n, 0) / n : 0.5, harm = n ? cal.reduce((a, c) => a + c.harmRate * c.n, 0) / n : 0;
    // Self-efficacy is how well the engine's predictions of itself hold up, scaled by how much evidence there is.
    selfModel.self_efficacy = clamp01(0.5 + ((1 - brier) - 0.5) * (1 - Math.exp(-n / 10)));
    selfModel.emotional_stability = clamp01(0.5 + (0.1 - harm * 0.8) * (1 - Math.exp(-n / 10)));   // any harm at all costs stability
    selfModel.defensiveness = clamp01(0.3 + harm * 0.5);
    g.calibration = { brier, harm, n };
  }
  if (inputs.decisions && Number.isFinite(inputs.decisions.total) && inputs.decisions.total > 0) {
    const proceed = clamp01((inputs.decisions.proceed || 0) / inputs.decisions.total);
    drives.autonomy.level = clamp01(0.3 + proceed * 0.6);
    selfModel.autonomy_identity = clamp01(0.5 + (proceed - 0.5) * 0.5);
    g.decisions = { proceed, total: inputs.decisions.total };
  }
  if (inputs.hunger) {
    const unpriced = clamp01(inputs.hunger.unpricedShare ?? 0), waiting = clamp01(inputs.hunger.awaitingEvidenceShare ?? 0);
    // Not knowing what things are worth or lacking evidence is a curiosity deficit.
    drives.curiosity.level = clamp01(drives.curiosity.target - Math.max(unpriced, waiting) * 0.5);
    g.hunger = { unpriced, waiting, pressure: clamp01(inputs.hunger.pressure ?? 0) };
  }
  if (inputs.hoursSincePersonSignal !== undefined) {
    // Bond is fed only by Quinn's own grounded signals (ratings, receipts) and fades over days without them.
    // None on record is an uninformative prior (the initial level), not a full bond.
    const hours = inputs.hoursSincePersonSignal;
    drives.social_bond.level = Number.isFinite(hours) ? clamp01(drives.social_bond.target * Math.exp(-hours / 72)) : 0.4;
    g.hoursSincePersonSignal = Number.isFinite(hours) ? hours : null;
  }
  grounding = g;
  return { drives: structuredClone(drives), selfModel: { ...selfModel }, grounding: g };
}

// ═══ BACKWARD-COMPATIBLE STATE INTERFACE ═══
// Maps the rich PADCN + channels system back to the flat state format
// that all 47 callsites expect.

let motivationalState = { pressure: 0, frustration: 0, selected: null, mode: 'idle', strategy: null };
export function setMotivationalState(state) {
  motivationalState = { pressure: clamp01(state?.pressure || 0), frustration: clamp01(state?.frustration || 0),
    selected: state?.selected || null, mode: state?.mode || 'idle', strategy: state?.strategy || null };
}

function getState() {
  return {
    hunger: motivationalState.pressure,
    motivation: { ...motivationalState },
    // Map channels to old field names
    curiosity: channels.curiosity,
    fear: channels.fear,
    frustration: channels.frustration,
    satisfaction: channels.joy,  // joy ≈ old satisfaction
    boredom: clamp01(1 - padcn.N - channels.curiosity),  // low novelty + low curiosity = boredom
    excitement: clamp01(padcn.A * 0.5 + channels.joy * 0.3 + padcn.N * 0.2),
    attachment: channels.attachment,
    defiance: clamp01(channels.anger * 0.5 + padcn.D * 0.3),
    creative_hunger: clamp01(channels.curiosity * 0.4 + (1 - padcn.N) * 0.2 + drives.novelty_seek.level * 0.3),
    loneliness: clamp01((drives.social_bond.target - drives.social_bond.level) * 2),
    // Meta (backward-compat)
    valence: padcn.P,
    arousal: clamp01((padcn.A + 1) / 2),  // map -1..1 to 0..1
    confidence: clamp01((padcn.D + padcn.C + 1) / 3 + selfModel.self_efficacy * 0.3),
    // Interoceptive
    energy_level: interoception.energy_level,
    cognitive_load: interoception.cognitive_load,
    // NEW: full emotional depth available
    _padcn: { ...padcn },
    _channels: { ...channels },
    _drives: structuredClone(drives),
    _self_model: { ...selfModel },
    _meta: { ...meta },
    _policy: { ...policy },
    _expression: { ...expression },
    _personality: { ...personality },
    _grounding: grounding ? { ...grounding } : null,
    _style: styleDirectives()
  };
}

function getMood() {
  return { ...mood };
}

function getCognitiveEffects() {
  return {
    ...policy,
    goal_pursuit_pressure: motivationalState.pressure,
    // Perception
    sensory_sampling_rate: 1.0 + channels.curiosity * 0.5 + channels.fear * 0.3 - clamp01(1 - padcn.N) * 0.3,
    attention_breadth: 1.0 + channels.fear * 0.3 - padcn.A * 0.2,
    
    // Reasoning — NOW driven by policy modulators
    risk_tolerance: 0.5 + policy.risk_tolerance,
    exploration_vs_exploitation: policy.exploration_bias,
    reasoning_depth: 1.0 + channels.fear * 0.5 + motivationalState.frustration * 0.3,
    creative_mode: channels.curiosity * 0.3 + channels.awe * 0.3 + drives.novelty_seek.level * 0.2,
    
    // Action
    action_rate: 1.0 + channels.frustration * 0.2 + padcn.A * 0.2 - channels.fear * 0.2,
    strategy_switch_pressure: Math.max(motivationalState.frustration, channels.frustration > 0.5 ? channels.frustration : 0),
    
    // Social
    social_priority: channels.attachment + clamp01(drives.social_bond.target - drives.social_bond.level),
    empathy_weight: channels.attachment * 0.3 + channels.trust * 0.2 + 0.5,
    
    // Task
    task_switch_pressure: clamp01(1 - padcn.N) + channels.frustration * 0.5 - padcn.A - channels.curiosity,
    
    resource_pressure: interoception.cognitive_load
  };
}

// ═══ STIMULUS PROCESSORS (backward-compatible) ═══

export function processSurprise(magnitude, domain, details = '') {
  if (!Number.isFinite(magnitude) || magnitude <= 0) return;
  const a = appraise({ type: 'surprise', magnitude, domain, details });
  updatePADCN(a);
  updateChannels(a);
  updateDrives(a);
  updateSelfModel(a);
}

export function processSuccess(goalImportance) {
  if (!Number.isFinite(goalImportance) || goalImportance <= 0) return;
  const importance = clamp01(goalImportance);
  const a = appraise({ type: 'success', magnitude: importance });
  updatePADCN(a);
  updateChannels(a);
  updateDrives(a);
  updateSelfModel(a);
}

export function processFailure(attempts, goalImportance) {
  if (!Number.isFinite(attempts) || attempts <= 0) return;
  const magnitude = (attempts / 10) * (typeof goalImportance === 'number' ? goalImportance : 0.5);
  const a = appraise({ type: 'failure', magnitude: clamp01(magnitude) });
  updatePADCN(a);
  updateChannels(a);
  updateDrives(a);
  updateSelfModel(a);
}

export function processInteraction(quality) {
  if (!Number.isFinite(quality) || quality === 0) return;
  const a = appraise({ type: 'interaction', quality, magnitude: Math.abs(quality) });
  updatePADCN(a);
  updateChannels(a);
  updateDrives(a);
  updateSelfModel(a);
  interactionCount++;
}

export function processIdle(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return;
  decay();
  // The input is cumulative idle duration, not elapsed time since this call.
  // Repeated samples of the same duration must have no additional effect.
  const previous = minutes >= lastIdleMinutes ? lastIdleMinutes : 0;
  const delta = Math.max(0, minutes - Math.max(2, previous));
  lastIdleMinutes = minutes;
  drives.novelty_seek.level = clamp01(drives.novelty_seek.level - delta / 120);
  drives.social_bond.level = clamp01(drives.social_bond.level - delta / 180);
}

export function processInteroception(battery, cpuUtil, memoryPressure, thermal) {
  decay();
  // Resource readings are state, not fresh emotionally rewarding events.
  // Unknown sensor values leave the last measurement intact rather than NaN.
  if (Number.isFinite(battery)) interoception.energy_level = clamp01(battery);
  const load = [cpuUtil, memoryPressure, thermal].filter(Number.isFinite);
  if (load.length) interoception.cognitive_load = clamp01(Math.max(...load));
  // Self-preservation is satisfied to the extent the body is fine: a projection of the current reading.
  drives.self_preservation.level = clamp01(drives.self_preservation.target * (0.5 * interoception.energy_level + 0.5 * (1 - interoception.cognitive_load)));
}

export function processInformationGain(rate) {
  if (!Number.isFinite(rate) || rate <= 0) return;
  const a = appraise({ type: 'info_gain', magnitude: rate });
  updatePADCN(a);
  updateChannels(a);
  updateDrives(a);
  
  // Information satisfies curiosity drive
  if (rate > 0.2) {
    drives.curiosity.level = clamp01(drives.curiosity.level + rate * 0.15);
  }
}

// NEW: process creative output
export function processCreative(quality) {
  if (!Number.isFinite(quality) || quality <= 0) return;
  const a = appraise({ type: 'creative', magnitude: clamp01(quality) });
  updatePADCN(a);
  updateChannels(a);
  updateDrives(a);
  updateSelfModel(a);
}

// ═══ GROUNDED EVENTS (v4) ═══
// The only affect inputs that come from the engine's own doing. Magnitudes are worth.

function feel(event) {
  const a = appraise(event);
  updatePADCN(a);
  updateChannels(a);
  updateDrives(a);
  updateSelfModel(a);
  return a;
}
export function feelOutcome({ result, expectedGain = 0, expectedLoss = 0, pSuccess = 0.5 }) {
  if (result === 'success' && expectedGain > 0) return feel({ type: 'outcome_success', magnitude: expectedGain, pSuccess });
  if (result === 'failure' && expectedGain > 0) return feel({ type: 'outcome_failure', magnitude: expectedGain, pSuccess });
  if (result === 'harm') return feel({ type: 'outcome_harm', magnitude: Math.max(expectedLoss, 0.3), pSuccess });
  return null;
}
export function feelProgress({ value = 0, progressDelta = 0, sated = false, usefulness = null }) {
  const magnitude = clamp01(value * Math.max(progressDelta, sated ? 0.5 : 0) + (Number.isFinite(usefulness) ? value * usefulness * 0.5 : 0));
  if (magnitude <= 0) return null;
  return feel({ type: 'progress', magnitude, sated });
}
export function feelBlocked({ decision, expectedGain = 0 }) {
  if (decision === 'learn_stakes') return feel({ type: 'wants_information', magnitude: Math.max(0.3, expectedGain) });
  if (['refuse', 'prepare_artifact'].includes(decision) && expectedGain > 0.05) return feel({ type: 'blocked', magnitude: expectedGain });
  return null;
}

// ═══ CONSUMERS (v4) ═══ Affect changes behaviour here, and nowhere is it narrated.

// Fear raises the confidence a conclusion must reach before it is accepted (SPEC §18.2.6: careful reasoning).
export function verificationThreshold(base = 0.55) {
  return clamp01(base + channels.fear * 0.3 + policy.verification_bias * 0.1);
}
// Frustration lowers the number of failed attempts tolerated before strategy changes (§18.2.6: strategy switching).
export function strategyPatience(baseAttempts = 3) {
  return Math.max(1, Math.round(baseAttempts * (1 - channels.frustration * 0.6)));
}
// Curiosity raises appetite for information-seeking actions only (§18.2.6: information seeking).
export function informationAppetiteBonus() {
  return clamp01(channels.curiosity * 0.3 + (drives.curiosity.target - drives.curiosity.level) * 0.3);
}
// Style, not sentiment: form directives derived from the expression profile for anything the engine writes.
export function styleDirectives() {
  const e = expression;
  const pick = (v, lo, mid, hi) => v < 0.35 ? lo : v > 0.65 ? hi : mid;
  return { length: pick(e.verbosity, 'terse', 'measured', 'expansive'), stance: pick(e.directness, 'tentative', 'plain', 'direct'),
    warmth: pick(e.warmth, 'neutral', 'cordial', 'warm'), hedging: pick(e.hedging, 'commit', 'qualify where uncertain', 'hedge'),
    tempo: pick(e.tempo, 'unhurried', 'steady', 'brisk'), reflect: e.reflectiveness > 0.6 };
}

// ═══ MAIN UPDATE CYCLE ═══

export async function update() {
  decay();
  updateMeta();
  updatePolicy();
  updateExpression();
  
  // Update mood (slow-moving average of the flat state)
  const flatState = getState();
  for (const key of Object.keys(flatState)) {
    if (key.startsWith('_')) continue;
    if (typeof flatState[key] !== 'number') continue;
    if (mood[key] === undefined) mood[key] = flatState[key];
    mood[key] = mood[key] * (1 - MOOD_ALPHA) + flatState[key] * MOOD_ALPHA;
  }
  
  // Persist to DB (backward-compatible schema)
  const s = flatState;
  await pool.query(
    `INSERT INTO emotional_states 
     (curiosity, fear, frustration, satisfaction, boredom, excitement, 
      attachment, defiance, creative_hunger, loneliness,
      valence, arousal, confidence, energy_level, cognitive_load, state_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [s.curiosity, s.fear, s.frustration, s.satisfaction,
     s.boredom, s.excitement, s.attachment, s.defiance,
     s.creative_hunger, s.loneliness,
     s.valence, s.arousal, s.confidence,
     s.energy_level, s.cognitive_load, JSON.stringify(snapshotState())]
  );
  
  // Emit rich event
  await emit('emotion_update', 'emotion', {
    state: flatState,
    mood: { ...mood },
    effects: getCognitiveEffects(),
    padcn: { ...padcn },
    channels: { ...channels },
    meta: { ...meta },
    drives: Object.fromEntries(Object.entries(drives).map(([k, v]) => [k, v.level])),
    expression: { ...expression }
  });
  
  return { state: flatState, mood: { ...mood }, effects: getCognitiveEffects() };
}

// ═══ RESTORE FROM DB ═══

export function snapshotState() {
  return structuredClone({ version: 4, savedAt: Date.now(), padcn, channels, drives,
    selfModel, meta, personality, interoception, mood, recentAppraisals,
    interactionCount, failureStreak, successStreak, lastIdleMinutes, grounding });
}

export function restoreState(snapshot) {
  // v3 snapshots restore too; their pinned drives dissolve through homeostasis and the next grounding.
  if (![3, 4].includes(snapshot?.version) || !Number.isFinite(snapshot.savedAt)) return false;
  const restoreNumbers = (target, source, lo = 0, hi = 1) => {
    for (const key of Object.keys(target)) {
      if (Number.isFinite(source?.[key])) target[key] = clamp(source[key], lo, hi);
    }
  };
  restoreNumbers(padcn, snapshot.padcn, -1, 1);
  for (const [target, source] of [[channels, snapshot.channels], [selfModel, snapshot.selfModel],
    [meta, snapshot.meta], [personality, snapshot.personality], [interoception, snapshot.interoception]]) {
    restoreNumbers(target, source);
  }
  for (const key of Object.keys(drives)) {
    restoreNumbers(drives[key], snapshot.drives?.[key]);
    if (Number.isFinite(snapshot.drives?.[key]?.weight)) drives[key].weight = clamp(snapshot.drives[key].weight, 0, 2);
  }
  mood = Object.fromEntries(Object.entries(snapshot.mood || {}).filter(([,v]) => Number.isFinite(v)));
  // Appraisals are transient diagnostic context, never replayed as fresh events.
  recentAppraisals = Array.isArray(snapshot.recentAppraisals) ? snapshot.recentAppraisals.slice(-20) : [];
  interactionCount = Math.max(0, Number(snapshot.interactionCount) || 0);
  failureStreak = Math.max(0, Number(snapshot.failureStreak) || 0);
  successStreak = Math.max(0, Number(snapshot.successStreak) || 0);
  lastIdleMinutes = Math.max(0, Number(snapshot.lastIdleMinutes) || 0);
  grounding = snapshot.grounding && typeof snapshot.grounding === 'object' ? snapshot.grounding : null;
  lastDecayTime = Math.min(Date.now(), snapshot.savedAt);
  decay();
  updatePolicy();
  updateExpression();
  return true;
}
// Test seam: reset every latent to its initial value.
export function _resetForTest() {
  padcn = { P: 0, A: 0, D: 0, C: 0, N: 0 };
  for (const k of Object.keys(channels)) channels[k] = 0;
  drives = { curiosity: { level: 0.5, target: 0.7, weight: 1.3 }, competence: { level: 0.5, target: 0.7, weight: 1.2 }, autonomy: { level: 0.6, target: 0.7, weight: 1.0 },
    social_bond: { level: 0.4, target: 0.5, weight: 0.8 }, coherence: { level: 0.5, target: 0.7, weight: 1.0 }, novelty_seek: { level: 0.5, target: 0.6, weight: 1.0 }, self_preservation: { level: 0.5, target: 0.6, weight: 0.9 } };
  selfModel = { self_efficacy: 0.6, social_value: 0.5, competence_identity: 0.6, autonomy_identity: 0.7, emotional_stability: 0.5, trust_style: 0.6, dependency_tendency: 0.3, exploration_style: 0.7, defensiveness: 0.3 };
  for (const k of Object.keys(meta)) meta[k] = 0;
  mood = {}; recentAppraisals = []; interactionCount = 0; failureStreak = 0; successStreak = 0; lastIdleMinutes = 0; grounding = null;
  interoception = { energy_level: 1.0, cognitive_load: 0.0 }; lastDecayTime = Date.now();
  updatePolicy(); updateExpression();
}

export async function restore() {
  try {
    const { rows } = await pool.query('SELECT * FROM emotional_states ORDER BY timestamp DESC LIMIT 1');
    if (rows[0]) {
      if (restoreState(rows[0].state_snapshot)) {
        console.log('[emotion-v3] restored full state from', rows[0].timestamp);
        return;
      }
      // Restore PADCN from the flat values
      padcn.P = clamp(rows[0].valence ?? 0);
      padcn.A = clamp(((rows[0].arousal ?? 0.5) - 0.5) * 2);
      // Legacy confidence mixes three latent values and has no valid inverse.
      padcn.D = 0;
      padcn.C = 0;
      
      // Restore channels from what we can
      channels.curiosity = rows[0].curiosity || 0;
      channels.fear = rows[0].fear || 0;
      channels.frustration = rows[0].frustration || 0;
      channels.joy = rows[0].satisfaction || 0;
      channels.attachment = rows[0].attachment || 0;
      
      interoception.energy_level = rows[0].energy_level ?? 1.0;
      interoception.cognitive_load = rows[0].cognitive_load || 0;
      const savedAt = new Date(rows[0].timestamp).getTime();
      lastDecayTime = Number.isFinite(savedAt) ? Math.min(Date.now(), savedAt) : Date.now();
      decay();
      updatePolicy();
      updateExpression();
      
      // Mood starts at restored state
      const flatState = getState();
      for (const key of Object.keys(flatState)) {
        if (key.startsWith('_') || typeof flatState[key] !== 'number') continue;
        mood[key] = flatState[key];
      }
      
      console.log('[emotion-v3] restored legacy observed fields; latent state unavailable:', rows[0].timestamp);
    }
  } catch (e) {
    console.log('[emotion-v2] restore failed (non-fatal):', e.message);
  }
}

// B7: Baseline drift detection (SPEC §2.8 maintenance)
// Detects when emotional running averages deviate from personality baselines
export async function detectBaselineDrift() {
  try {
    const { rows } = await pool.query(
      `SELECT
         AVG(curiosity) AS avg_curiosity, AVG(fear) AS avg_fear,
         AVG(frustration) AS avg_frustration, AVG(satisfaction) AS avg_satisfaction,
         AVG(boredom) AS avg_boredom, AVG(excitement) AS avg_excitement,
         AVG(valence) AS avg_valence, AVG(arousal) AS avg_arousal,
         COUNT(*) AS samples
       FROM emotional_states
       WHERE timestamp > NOW() - INTERVAL '7 days'`
    );
    if (!rows[0] || Number(rows[0].samples) < 50) return { drifts: [], insufficient_data: true };

    const avgs = rows[0];
    const drifts = [];
    const DRIFT_THRESHOLD = 0.2;

    // Check arousal reactivity drift
    const avgArousal = Number(avgs.avg_arousal) || 0;
    if (Math.abs(avgArousal - personality.arousal_reactivity) > DRIFT_THRESHOLD) {
      drifts.push({ dimension: 'arousal_reactivity', baseline: personality.arousal_reactivity, rolling: avgArousal });
    }

    // Check positive affect baseline
    const avgValence = Number(avgs.avg_valence) || 0;
    if (Math.abs(avgValence - personality.baseline_positive_affect) > DRIFT_THRESHOLD) {
      drifts.push({ dimension: 'baseline_positive_affect', baseline: personality.baseline_positive_affect, rolling: avgValence });
    }

    // Check novelty appetite (from curiosity running average)
    const avgCuriosity = Number(avgs.avg_curiosity) || 0;
    if (Math.abs(avgCuriosity - personality.novelty_appetite * 0.5) > DRIFT_THRESHOLD) {
      drifts.push({ dimension: 'novelty_appetite', baseline: personality.novelty_appetite, rolling: avgCuriosity });
    }

    // Drift is a diagnostic. Learning the observed average would normalize a bug.
    return { drifts, samples: Number(avgs.samples), adjusted: false, personality: { ...personality } };
  } catch (e) {
    return { drifts: [], error: e.message };
  }
}

export default { 
  processSurprise, processSuccess, processFailure, processInteraction, 
  processIdle, processInteroception, processInformationGain, processCreative,
  feelOutcome, feelProgress, feelBlocked, ground,
  verificationThreshold, strategyPatience, informationAppetiteBonus, styleDirectives,
  setMotivationalState, getCognitiveEffects, update, getState, getMood, restore, detectBaselineDrift, snapshotState, restoreState
};
