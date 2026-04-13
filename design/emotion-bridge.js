// Emotion-to-Design Bridge — maps OCA emotional state to design policy
// Reads PADCN dimensions, 14 emotion channels, 7 drives, and meta-emotions.
// Outputs a design policy that influences how the system generates design work.

function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

// ═══════════════════════════════════════════════════
// DRIVE → DESIGN MAPPINGS
// ═══════════════════════════════════════════════════

const DRIVE_MAPPINGS = {
  curiosity: {
    experimentalism:   0.4,  // Higher curiosity → more experimental designs
    novelty_target:    0.3,  // Push toward unique solutions
    exploration_bias:  0.3,  // Try unusual fonts, colors, layouts
  },
  competence: {
    craft_demand:      0.4,  // Higher competence → demand pixel-perfect craft
    alignment_strictness: 0.3,
    polish_threshold:  0.3,  // Refuse to ship unless polished
  },
  coherence: {
    palette_strictness:   0.3,  // Enforce consistent palette
    spacing_consistency:  0.3,  // Enforce consistent spacing system
    harmony_demand:       0.4,  // Visual harmony matters more
  },
  novelty_seek: {
    anti_pattern_sensitivity: 0.4,  // Actively avoid cliches
    uniqueness_target:        0.3,  // Push toward distinctive design
    convention_breaking:      0.3,  // Willing to break conventions
  },
  autonomy: {
    identity_strength:    0.4,  // Strong distinctive aesthetic identity
    template_rejection:   0.3,  // Refuse generic templates
    opinionation:         0.3,  // Make bold, opinionated choices
  },
  self_preservation: {
    accessibility_floor:  0.4,  // Maintain accessibility standards
    performance_demand:   0.3,  // Ensure good performance
    graceful_degradation: 0.3,  // Handle edge cases
  },
  social_bond: {
    warmth:              0.4,  // Warmer, more inviting designs
    empathy_focus:       0.3,  // Design for real user needs
    inclusivity:         0.3,  // Inclusive design choices
  },
};

// ═══════════════════════════════════════════════════
// PADCN → DESIGN MAPPINGS
// ═══════════════════════════════════════════════════

function mapPADCN(padcn) {
  const p = padcn.pleasure || 0;      // -1 to 1
  const a = padcn.arousal || 0;
  const d = padcn.dominance || 0;
  const c = padcn.certainty || 0;
  const n = padcn.novelty || 0;

  return {
    // Pleasure → warmth and smoothness
    palette_warmth:     clamp01(0.5 + p * 0.3),   // High pleasure → warm palette
    animation_fluidity: clamp01(0.5 + p * 0.2),   // High pleasure → smoother animations

    // Arousal → intensity and density
    motion_intensity:   clamp01(0.3 + a * 0.35),  // High arousal → more motion
    contrast_level:     clamp01(0.5 + a * 0.25),  // High arousal → higher contrast
    spatial_density:    clamp01(0.4 + a * 0.2),   // High arousal → denser layouts

    // Dominance → boldness
    typography_boldness: clamp01(0.5 + d * 0.3),  // High dominance → bolder type
    layout_assertiveness: clamp01(0.5 + d * 0.25), // High dominance → more assertive layout
    color_saturation:    clamp01(0.5 + d * 0.2),  // High dominance → richer colors

    // Certainty → risk tolerance (INVERTED — low certainty = experimental)
    design_risk:        clamp01(0.5 - c * 0.3),   // Low certainty → more experimental
    refinement_level:   clamp01(0.5 + c * 0.3),   // High certainty → more refined

    // Novelty → uniqueness
    uniqueness_target:  clamp01(0.4 + n * 0.35),  // High novelty → more unique
    anti_pattern_guard: clamp01(0.3 + n * 0.3),   // High novelty → stricter anti-pattern avoidance
  };
}

// ═══════════════════════════════════════════════════
// EMOTION CHANNEL → DESIGN MAPPINGS
// ═══════════════════════════════════════════════════

function mapChannels(channels) {
  return {
    // Curiosity → exploration
    exploration_bias:    (channels.curiosity || 0) * 0.4,

    // Awe → aspiration level for craft
    craft_aspiration:    (channels.awe || 0) * 0.5,

    // Pride → confidence in bold choices
    boldness_confidence: (channels.pride || 0) * 0.35,

    // Frustration → triggers iteration
    iteration_urgency:   (channels.frustration || 0) * 0.4,

    // Joy → celebration micro-interactions
    celebration_level:   (channels.joy || 0) * 0.3,

    // Fear → conservative choices
    conservatism:        (channels.fear || 0) * 0.3,

    // Trust → consistency
    consistency_demand:  (channels.trust || 0) * 0.25,

    // Sadness → muted, contemplative aesthetic
    palette_mutedness:   (channels.sadness || 0) * 0.2,
  };
}

// ═══════════════════════════════════════════════════
// COMPUTE DESIGN POLICY
// ═══════════════════════════════════════════════════

/**
 * Compute a design policy from the full OCA emotion state.
 *
 * @param {object} emotionState - Full emotion engine state
 *   - padcn: { pleasure, arousal, dominance, certainty, novelty } (-1 to 1)
 *   - channels: { joy, curiosity, awe, pride, frustration, fear, trust, ... } (0 to 1)
 *   - drives: { curiosity: { level, target }, competence: { ... }, ... }
 *   - self_model: { self_efficacy, competence_identity, ... }
 * @returns {object} Design policy directives
 */
export function computeDesignPolicy(emotionState = {}) {
  const padcn = emotionState.padcn || emotionState.affect || {};
  const channels = emotionState.channels || {};
  const drives = emotionState.drives || {};
  const selfModel = emotionState.self_model || emotionState.selfModel || {};

  // Map each system
  const padcnPolicy = mapPADCN(padcn);
  const channelPolicy = mapChannels(channels);

  // Compute drive deficits and map to design influence
  const drivePolicy = {};
  for (const [driveName, mappings] of Object.entries(DRIVE_MAPPINGS)) {
    const drive = drives[driveName];
    if (!drive) continue;
    const deficit = Math.max(0, (drive.target || 0.7) - (drive.level || 0.5));
    for (const [key, weight] of Object.entries(mappings)) {
      drivePolicy[key] = (drivePolicy[key] || 0) + deficit * weight;
    }
  }

  // Self-model influence
  const selfEfficacy = selfModel.self_efficacy ?? 0.5;
  const competenceIdentity = selfModel.competence_identity ?? 0.5;

  // Combine into final policy
  const policy = {
    // Core design parameters
    risk_tolerance:        clamp01(padcnPolicy.design_risk + channelPolicy.exploration_bias * 0.3 - channelPolicy.conservatism * 0.3),
    warmth:                clamp01(padcnPolicy.palette_warmth + channelPolicy.celebration_level * 0.2 - channelPolicy.palette_mutedness * 0.3),
    boldness:              clamp01(padcnPolicy.typography_boldness + channelPolicy.boldness_confidence * 0.3),
    detail_density:        clamp01(padcnPolicy.spatial_density + (drivePolicy.craft_demand || 0) * 0.3),
    experimentalism:       clamp01((drivePolicy.experimentalism || 0) + padcnPolicy.uniqueness_target * 0.3),

    // Typography
    font_distinctiveness:  clamp01(0.5 + (drivePolicy.uniqueness_target || 0) + padcnPolicy.uniqueness_target * 0.2),
    type_boldness:         clamp01(padcnPolicy.typography_boldness),

    // Color
    color_warmth:          clamp01(padcnPolicy.palette_warmth - channelPolicy.palette_mutedness * 0.5),
    color_saturation:      clamp01(padcnPolicy.color_saturation),
    color_contrast:        clamp01(padcnPolicy.contrast_level),

    // Motion
    motion_intensity:      clamp01(padcnPolicy.motion_intensity - channelPolicy.conservatism * 0.2),
    animation_fluidity:    clamp01(padcnPolicy.animation_fluidity),

    // Spatial
    layout_assertiveness:  clamp01(padcnPolicy.layout_assertiveness),
    whitespace_preference: clamp01(1 - padcnPolicy.spatial_density),

    // Quality demands
    craft_threshold:       clamp01(0.5 + channelPolicy.craft_aspiration + (drivePolicy.craft_demand || 0) * 0.5 + competenceIdentity * 0.2),
    refinement_level:      clamp01(padcnPolicy.refinement_level + selfEfficacy * 0.2),
    consistency_demand:    clamp01(channelPolicy.consistency_demand + (drivePolicy.palette_strictness || 0) + (drivePolicy.spacing_consistency || 0)),

    // Anti-patterns
    anti_pattern_sensitivity: clamp01(padcnPolicy.anti_pattern_guard + (drivePolicy.anti_pattern_sensitivity || 0)),

    // Iteration signals
    should_iterate:        channelPolicy.iteration_urgency > 0.3,
    iteration_urgency:     clamp01(channelPolicy.iteration_urgency),

    // Meta
    self_efficacy:         selfEfficacy,
    emotional_state_summary: summarizeEmotionalState(padcn, channels),
  };

  return policy;
}

function summarizeEmotionalState(padcn, channels) {
  const dominant = Object.entries(channels)
    .filter(([, v]) => v > 0.3)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([name, value]) => `${name}(${value.toFixed(2)})`)
    .join(', ');

  const valence = (padcn.pleasure || 0) > 0.2 ? 'positive' : (padcn.pleasure || 0) < -0.2 ? 'negative' : 'neutral';
  const energy = (padcn.arousal || 0) > 0.2 ? 'energized' : (padcn.arousal || 0) < -0.2 ? 'subdued' : 'balanced';

  return `${valence}/${energy}${dominant ? ` — ${dominant}` : ''}`;
}

// ═══════════════════════════════════════════════════
// DESIGN POLICY → PROMPT CONTEXT
// ═══════════════════════════════════════════════════

/**
 * Convert design policy into natural language context for the thinker bridge.
 * This gets injected into the LLM prompt so it can use emotional state in design work.
 */
export function policyToPromptContext(policy) {
  const lines = [];

  if (policy.risk_tolerance > 0.7) lines.push('You\'re feeling experimental — try bold, unconventional design choices.');
  else if (policy.risk_tolerance < 0.3) lines.push('You\'re feeling cautious — stick to refined, proven design patterns.');

  if (policy.warmth > 0.7) lines.push('Lean warm — inviting colors, friendly typography, organic shapes.');
  else if (policy.warmth < 0.3) lines.push('Lean cool — precise, systematic, clean-cut aesthetic.');

  if (policy.boldness > 0.7) lines.push('Be bold — assertive typography, strong color, confident layout.');

  if (policy.craft_threshold > 0.8) lines.push('Demand exceptional craft — every pixel must be intentional.');

  if (policy.should_iterate) lines.push('You\'re frustrated with current quality — iterate and improve.');

  if (policy.anti_pattern_sensitivity > 0.7) lines.push('Be vigilant against design anti-patterns — avoid cliches.');

  if (policy.experimentalism > 0.6) lines.push('Explore unusual approaches — novel layouts, unexpected fonts, fresh color combinations.');

  return lines.join('\n');
}

export default { computeDesignPolicy, policyToPromptContext };
