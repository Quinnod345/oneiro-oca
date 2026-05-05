// Design Evaluation API — Phase 6 (with Phase 5 fallback).
// The model is the MLX inference server at /tmp/design-model-v2.sock. It
// loads design-head-v6.safetensors when present (Phase 6 head with
// uncertainty + LoRA adapter + preference outputs) and falls back to
// design-head-v5.safetensors otherwise (uncertainty suppressed in fallback).
// Earlier phases were purged 2026-04-28 — if the server isn't running this
// throws so callers fail loudly instead of silently degrading.
//
// To start the server:
//   python3 mlx/inference_server.py --warmup &

import { encodeFromCode, analyzeDesignCode } from './encoder.js';
import { DESIGN_DIMENSIONS, ANTI_PATTERNS, REFERENCE_APPS, DESIGN_EMOTIONS, NORMAN_LEVELS } from './knowledge.js';

const SERVER_HINT =
  'Design model server (Phase 6) is not running. Start it with:\n' +
  '  cd /Users/quinnodonnell/.openclaw/workspace/oneiro-core/cognitive/design-model/mlx && \\\n' +
  '  python3 inference_server.py --warmup &';

/**
 * Evaluate a design artifact and return scores + suggestions + analysis.
 *
 * @param {object} input - { code: string, path: string, screenshot: string, context: object }
 *   - code: Raw HTML/CSS/JSX/Svelte code
 *   - path: Path to a code file (alternative to code)
 *   - screenshot: Path to a PNG/JPG of the rendered surface (preferred — vision head sees it)
 *   - context: Optional context signals for the encoder
 * @param {object} options - { detailed: boolean }
 * @returns {object} Evaluation result with scores, weakest/strongest, suggestions
 */
export async function evaluateDesign(input, options = {}) {
  const t0 = Date.now();
  const client = await import('./client.js');
  if (!client.isServerRunning()) {
    throw new Error(SERVER_HINT);
  }

  const serverInput = {};
  if (input.screenshot) serverInput.screenshot = input.screenshot;
  if (input.code || input.path) {
    const code = input.code || input.path || '';
    serverInput.codeFeatures = Array.from(encodeFromCode(code, input.context || {}));
  }
  if (!serverInput.screenshot && !serverInput.codeFeatures) {
    throw new Error('Provide at least one of: { screenshot, code, path }.');
  }

  const serverResult = await client.evaluate(serverInput);
  const elapsed = Date.now() - t0;

  const result = {
    scores: serverResult.scores,
    overall: serverResult.overall,
    norman: serverResult.norman,
    uncertainty: serverResult.uncertainty || null,
    leastConfident: serverResult.uncertainty
      ? findLeastConfident(serverResult.uncertainty, 3)
      : [],
    weakest: findWeakest(serverResult.scores, 3),
    strongest: findStrongest(serverResult.scores, 3),
    suggestions: generateSuggestions(serverResult.scores),
    modelVersion: serverResult.model_version || 'phase_6',
    paramCount: serverResult.param_count,
    inferenceMs: elapsed,
    backend: serverResult.model_version || 'phase_6',
  };

  if (options.detailed && (input.code || input.path)) {
    const code = input.code || input.path;
    result.analysis = analyzeDesignCode(code);
    result.antiPatterns = detectAntiPatternDetails(code);
    result.emotionalProfile = assessEmotionalProfile(result.scores);
    result.referenceComparison = compareToReferences(result.scores);
  }

  return result;
}

// ═══════════════════════════════════════════════════
// QUICK SCORE (returns just the overall number)
// ═══════════════════════════════════════════════════

export async function quickScore(code, context = {}) {
  // Try Phase 2b server
  const client = await import('./client.js');
  if (!client.isServerRunning()) throw new Error(SERVER_HINT);
  const codeFeatures = encodeFromCode(code, context);
  const result = await client.evaluate({ codeFeatures: Array.from(codeFeatures) });
  return result.overall;
}

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

function findLeastConfident(uncertainty, n) {
  // Highest predicted std → model is least sure → best candidate to re-grade
  return Object.entries(uncertainty)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([name, std]) => ({ name, std }));
}

function findWeakest(scores, n) {
  return Object.entries(scores)
    .filter(([name]) => name !== 'overall_aesthetic')
    .sort(([, a], [, b]) => a - b)
    .slice(0, n)
    .map(([name, score]) => ({
      name,
      score,
      dimension: DESIGN_DIMENSIONS.find(d => d.name === name),
    }));
}

function findStrongest(scores, n) {
  return Object.entries(scores)
    .filter(([name]) => name !== 'overall_aesthetic')
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([name, score]) => ({
      name,
      score,
      dimension: DESIGN_DIMENSIONS.find(d => d.name === name),
    }));
}

function generateSuggestions(scores) {
  const suggestions = [];

  for (const [dimName, score] of Object.entries(scores)) {
    if (dimName === 'overall_aesthetic') continue;
    if (score >= 0.7) continue; // Only suggest for dimensions below good

    const dim = DESIGN_DIMENSIONS.find(d => d.name === dimName);
    if (!dim) continue;

    const suggestion = {
      dimension: dimName,
      currentScore: score,
      priority: score < 0.4 ? 'critical' : score < 0.55 ? 'high' : 'medium',
      whatToImprove: dim.description,
      highSignals: dim.highSignals,
      lowSignals: dim.lowSignals,
    };

    // Add specific advice per dimension
    switch (dimName) {
      case 'typography_quality':
        suggestion.advice = 'Choose distinctive fonts — avoid Inter, Roboto, Arial. Pair a display font with a body font. Use a consistent type scale (minor third or perfect fourth). Add letter-spacing to headings.';
        break;
      case 'color_harmony':
        suggestion.advice = 'Build a dominant color + sharp accent system. Use CSS custom properties for palette. Avoid purple-gradient-on-white. Ensure WCAG AA contrast ratios.';
        break;
      case 'spatial_composition':
        suggestion.advice = 'Add generous whitespace. Use CSS Grid for layout structure. Create visual flow with asymmetry and overlap. Let elements breathe.';
        break;
      case 'motion_elegance':
        suggestion.advice = 'Add page-load reveal animations with stagger. Use spring physics for interactive elements. Include hover states. Always support prefers-reduced-motion.';
        break;
      case 'emotional_resonance':
        suggestion.advice = 'Add micro-interactions that delight (button feedback, success celebrations). Choose colors that evoke target emotions. Create moments of surprise.';
        break;
      case 'craft_visibility':
        suggestion.advice = 'Align every element to a grid. Polish icons and imagery. Refine copy. Ensure consistent spacing multipliers (4px or 8px base).';
        break;
      case 'minimalism_coherence':
        suggestion.advice = 'Remove elements that don\'t earn their place. Use progressive disclosure. Hide complexity until needed. Every visible element should serve a purpose.';
        break;
      case 'native_integration':
        suggestion.advice = 'Respect system font (SF Pro), colors, and dark mode. Add keyboard shortcuts. Support system preferences. Use platform-standard controls.';
        break;
      case 'visceral_score':
        suggestion.advice = 'Focus on first-impression beauty. Bold typography, rich colors, polished surfaces. The user should feel "wow" within 1 second.';
        break;
      case 'behavioral_score':
        suggestion.advice = 'Make every action feel effortless. Clear feedback for all interactions. Prevent errors through smart defaults. Reduce cognitive load.';
        break;
      case 'reflective_score':
        suggestion.advice = 'Create something users are proud to use. Build emotional connection through personality. Make it story-worthy — something users tell others about.';
        break;
    }

    // Add reference apps that excel at this dimension
    suggestion.referenceApps = getReferencesForDim(dimName);

    suggestions.push(suggestion);
  }

  return suggestions.sort((a, b) => a.currentScore - b.currentScore);
}

function getReferencesForDim(dimName) {
  const refs = [];
  for (const [appName, app] of Object.entries(REFERENCE_APPS)) {
    const normanMap = {
      visceral_score: 'visceral',
      behavioral_score: 'behavioral',
      reflective_score: 'reflective',
    };

    if (normanMap[dimName]) {
      if (app.normanStrengths[normanMap[dimName]] >= 0.85) {
        refs.push({ app: appName, score: app.normanStrengths[normanMap[dimName]], strengths: app.strengths });
      }
    } else {
      // Map other dimensions to app strengths heuristically
      const strengthKeywords = {
        typography_quality: ['typography', 'font', 'writing'],
        color_harmony: ['color', 'palette', 'visual'],
        spatial_composition: ['layout', 'spatial', 'whitespace', 'minimal'],
        motion_elegance: ['animation', 'fluid', 'motion', 'transition'],
        emotional_resonance: ['emotion', 'delight', 'joy', 'warmth'],
        craft_visibility: ['detail', 'pixel', 'craft', 'polish'],
        minimalism_coherence: ['minimal', 'clean', 'restraint', 'simple'],
        native_integration: ['native', 'system', 'macOS', 'Swift'],
      };
      const keywords = strengthKeywords[dimName] || [];
      const hasStrength = app.strengths.some(s => keywords.some(k => s.toLowerCase().includes(k)));
      if (hasStrength) {
        refs.push({ app: appName, strengths: app.strengths.filter(s => keywords.some(k => s.toLowerCase().includes(k))) });
      }
    }
  }
  return refs.slice(0, 3);
}

function detectAntiPatternDetails(code) {
  const detected = [];
  const codeStr = String(code);

  for (const [name, pattern] of Object.entries(ANTI_PATTERNS)) {
    let found = false;
    if (name === 'overused_fonts') {
      const usesOverused = pattern.fonts.some(f => codeStr.toLowerCase().includes(f.toLowerCase()));
      if (usesOverused) {
        found = true;
        detected.push({ name, severity: pattern.severity, description: pattern.description, tells: pattern.fonts.filter(f => codeStr.toLowerCase().includes(f.toLowerCase())) });
      }
    } else if (pattern.tells) {
      const tells = pattern.tells.filter(t => codeStr.toLowerCase().includes(t.toLowerCase()));
      if (tells.length > 0) {
        found = true;
        detected.push({ name, severity: pattern.severity, description: pattern.description, tells });
      }
    } else if (pattern.patterns) {
      const matches = pattern.patterns.filter(p => codeStr.toLowerCase().includes(p.toLowerCase()));
      if (matches.length > 0) {
        found = true;
        detected.push({ name, severity: pattern.severity, description: pattern.description, tells: matches });
      }
    }
  }

  return {
    count: detected.length,
    totalSeverity: detected.reduce((s, d) => s + d.severity, 0),
    patterns: detected,
  };
}

function assessEmotionalProfile(scores) {
  const profile = {};

  // Map scores to emotional targets
  if (scores.emotional_resonance > 0.7 && scores.visceral_score > 0.7) {
    profile.dominant = 'delight';
  } else if (scores.minimalism_coherence > 0.7 && scores.spatial_composition > 0.7) {
    profile.dominant = 'calm';
  } else if (scores.craft_visibility > 0.7 && scores.reflective_score > 0.7) {
    profile.dominant = 'pride';
  } else if (scores.behavioral_score > 0.7) {
    profile.dominant = 'satisfaction';
  } else {
    profile.dominant = 'neutral';
  }

  // Check for negative emotions
  const risks = [];
  if (scores.spatial_composition < 0.4) risks.push('overwhelm');
  if (scores.behavioral_score < 0.4) risks.push('frustration');
  if (scores.emotional_resonance < 0.3) risks.push('indifference');
  if (scores.typography_quality < 0.3 && scores.color_harmony < 0.3) risks.push('boredom');

  profile.risks = risks;
  profile.normanBalance = {
    visceral: scores.visceral_score,
    behavioral: scores.behavioral_score,
    reflective: scores.reflective_score,
    balanced: Math.abs(scores.visceral_score - scores.behavioral_score) < 0.2 && Math.abs(scores.behavioral_score - scores.reflective_score) < 0.2,
  };

  return profile;
}

function compareToReferences(scores) {
  const comparisons = {};
  for (const [appName, app] of Object.entries(REFERENCE_APPS)) {
    if (!app.normanStrengths) continue;
    const similarity =
      (1 - Math.abs(scores.visceral_score - app.normanStrengths.visceral)) * 0.33 +
      (1 - Math.abs(scores.behavioral_score - app.normanStrengths.behavioral)) * 0.33 +
      (1 - Math.abs(scores.reflective_score - app.normanStrengths.reflective)) * 0.34;
    comparisons[appName] = {
      similarity: Math.round(similarity * 100) / 100,
      strengths: app.strengths,
      emotionalTarget: app.emotionalTarget,
    };
  }

  // Sort by similarity
  const sorted = Object.entries(comparisons).sort(([, a], [, b]) => b.similarity - a.similarity);
  return {
    mostSimilar: sorted[0] ? { app: sorted[0][0], ...sorted[0][1] } : null,
    allComparisons: Object.fromEntries(sorted),
  };
}

export default { evaluateDesign, quickScore };
