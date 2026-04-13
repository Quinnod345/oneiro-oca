// Design Model Trainer — three training modes for the design-aesthetic MLP
// Mode 1: LLM-as-Judge (bootstraps with zero manual annotation)
// Mode 2: Comparative Preference (RLHF-style, richer signal)
// Mode 3: Self-Play Iteration (model identifies weakness, agent fixes it)

import { loadModel } from './model.js';
import { encodeFromCode } from './encoder.js';
import { SCORE_NAMES, DESIGN_DIMENSIONS, DIMENSION_WEIGHTS } from './knowledge.js';

// ═══════════════════════════════════════════════════
// LLM-AS-JUDGE EVALUATION PROMPT
// ═══════════════════════════════════════════════════

const EVALUATION_PROMPT = `You are an expert design critic evaluating a code artifact for aesthetic quality.
Score each dimension from 0.0 (worst) to 1.0 (best). Be critical — 0.5 is average, 0.7 is good, 0.9 is exceptional.

Reference standard: Things 3, Alcove, Klack, NotchNook, Bear, Linear — apps that won Apple Design Awards.

DIMENSIONS:
1. typography_quality — Font choices, pairing, scale, spacing. Distinctive fonts score high. Inter/Roboto score low.
2. color_harmony — Cohesion, emotional resonance, intentional palette. Dominant + accent system scores high.
3. spatial_composition — Layout quality, whitespace, grid, visual flow. Intentional breathing room scores high.
4. motion_elegance — Animation quality and purposefulness. Meaningful transitions score high. Gratuitous animation scores low.
5. emotional_resonance — How effectively the design evokes intended emotions. Micro-interactions that delight score high.
6. craft_visibility — Painstaking care visible in every detail. Pixel-perfect alignment scores high.
7. minimalism_coherence — Appropriate restraint. Progressive disclosure scores high. Feature dumps score low.
8. native_integration — How naturally it fits macOS/web ecosystem. System controls and keyboard shortcuts score high.
9. visceral_score — Norman Level 1: immediate aesthetic reaction. Visual "wow" scores high.
10. behavioral_score — Norman Level 2: usability quality. Effortless task completion scores high.
11. reflective_score — Norman Level 3: meaning and identity. Pride of use scores high.
12. overall_aesthetic — Holistic design quality. The gestalt of all dimensions.

Respond with ONLY a JSON object:
{"typography_quality":0.X,"color_harmony":0.X,"spatial_composition":0.X,"motion_elegance":0.X,"emotional_resonance":0.X,"craft_visibility":0.X,"minimalism_coherence":0.X,"native_integration":0.X,"visceral_score":0.X,"behavioral_score":0.X,"reflective_score":0.X,"overall_aesthetic":0.X}`;

// ═══════════════════════════════════════════════════
// COMPARATIVE PROMPT
// ═══════════════════════════════════════════════════

const COMPARATIVE_PROMPT = `You are an expert design critic comparing two design artifacts.
For each dimension, indicate which is BETTER: "A" or "B" or "tie".
Also estimate the MARGIN (0.0 = almost equal, 1.0 = vastly different).

Respond with ONLY a JSON object:
{"typography_quality":{"winner":"A","margin":0.X},...}`;

// ═══════════════════════════════════════════════════
// MODE 1: LLM-AS-JUDGE TRAINING
// ═══════════════════════════════════════════════════

/**
 * Train the model using LLM evaluation as ground truth.
 * @param {string} code - The design artifact code (HTML/CSS/JSX)
 * @param {Function} llmCall - Async function(prompt, systemPrompt) → string response
 * @param {object} context - Optional context for the encoder
 * @returns {object} Training result with scores, loss, etc.
 */
export async function trainWithLLMJudge(code, llmCall, context = {}) {
  const model = loadModel();
  const features = encodeFromCode(code, context);

  // Get model's current prediction
  const predicted = model.predict(features, true); // training=true for dropout

  // Get LLM evaluation
  const codeSnippet = typeof code === 'string' && code.length > 5000 ? code.slice(0, 5000) + '\n... (truncated)' : code;
  const prompt = `Evaluate this design artifact:\n\n\`\`\`\n${codeSnippet}\n\`\`\``;

  let scores;
  try {
    const response = await llmCall(prompt, EVALUATION_PROMPT);
    scores = parseScores(response);
    if (!scores) throw new Error('Failed to parse scores');
  } catch (err) {
    console.error('[design-trainer] LLM evaluation failed:', err.message);
    return { success: false, error: err.message };
  }

  // Convert to target array
  const target = new Float32Array(SCORE_NAMES.length);
  for (let i = 0; i < SCORE_NAMES.length; i++) {
    target[i] = Math.max(0, Math.min(1, scores[SCORE_NAMES[i]] ?? 0.5));
  }

  // Train
  const result = model.learn(target);

  // Save periodically
  if (model.totalUpdates % 10 === 0) {
    model.save();
  }

  return {
    success: true,
    scores,
    predicted: Object.fromEntries(SCORE_NAMES.map((n, i) => [n, predicted[i]])),
    loss: result.loss,
    runningLoss: result.runningLoss,
    componentErrors: result.componentErrors,
    updates: result.updates,
    architecture: model.getArchitectureSummary(),
  };
}

// ═══════════════════════════════════════════════════
// MODE 2: COMPARATIVE PREFERENCE TRAINING
// ═══════════════════════════════════════════════════

/**
 * Train using comparative preference (Bradley-Terry style).
 * Given two designs, learn which is better on each dimension.
 * @param {string} codeA - First design artifact
 * @param {string} codeB - Second design artifact
 * @param {Function} llmCall - Async function for LLM evaluation
 * @param {object} context - Optional context
 * @returns {object} Training result
 */
export async function trainComparative(codeA, codeB, llmCall, context = {}) {
  const model = loadModel();
  const featuresA = encodeFromCode(codeA, context);
  const featuresB = encodeFromCode(codeB, context);

  // Get model predictions for both
  const scoresA = model.predict(featuresA);
  const scoresB = model.predict(featuresB);

  // Get LLM comparison
  const snippetA = typeof codeA === 'string' && codeA.length > 3000 ? codeA.slice(0, 3000) + '\n...' : codeA;
  const snippetB = typeof codeB === 'string' && codeB.length > 3000 ? codeB.slice(0, 3000) + '\n...' : codeB;
  const prompt = `Compare these two design artifacts:\n\nDESIGN A:\n\`\`\`\n${snippetA}\n\`\`\`\n\nDESIGN B:\n\`\`\`\n${snippetB}\n\`\`\``;

  let comparison;
  try {
    const response = await llmCall(prompt, COMPARATIVE_PROMPT);
    comparison = parseComparison(response);
    if (!comparison) throw new Error('Failed to parse comparison');
  } catch (err) {
    console.error('[design-trainer] LLM comparison failed:', err.message);
    return { success: false, error: err.message };
  }

  // Convert comparison to training signal
  // If A wins, A's score should be higher → push A up, B down
  // Bradley-Terry: P(A > B) = sigmoid(score_A - score_B)
  const MARGIN_SCALE = 0.2; // How much to adjust per comparison
  const targetA = new Float32Array(SCORE_NAMES.length);
  const targetB = new Float32Array(SCORE_NAMES.length);

  for (let i = 0; i < SCORE_NAMES.length; i++) {
    const dim = SCORE_NAMES[i];
    const comp = comparison[dim];
    const currentA = scoresA[i];
    const currentB = scoresB[i];

    if (!comp || comp.winner === 'tie') {
      // Tie: both move toward average
      const avg = (currentA + currentB) / 2;
      targetA[i] = avg;
      targetB[i] = avg;
    } else {
      const margin = (comp.margin || 0.5) * MARGIN_SCALE;
      if (comp.winner === 'A') {
        targetA[i] = Math.min(1, currentA + margin);
        targetB[i] = Math.max(0, currentB - margin);
      } else {
        targetA[i] = Math.max(0, currentA - margin);
        targetB[i] = Math.min(1, currentB + margin);
      }
    }
  }

  // Train on both
  model.predict(featuresA, true);
  const resultA = model.learn(targetA);
  model.predict(featuresB, true);
  const resultB = model.learn(targetB);

  if (model.totalUpdates % 10 === 0) model.save();

  return {
    success: true,
    comparison,
    lossA: resultA.loss,
    lossB: resultB.loss,
    updates: model.totalUpdates,
  };
}

// ═══════════════════════════════════════════════════
// MODE 3: SELF-PLAY ITERATION TRAINING
// ═══════════════════════════════════════════════════

/**
 * Identify the weakest dimension and return training guidance.
 * The agent generates a component targeting that weakness,
 * then calls trainWithLLMJudge on the result.
 */
export function getTrainingFocus() {
  const model = loadModel();
  const weakest = model.getWeakestDimensions(3);
  const status = model.getStatus();
  const dim = DESIGN_DIMENSIONS.find(d => d.name === weakest[0]?.name);

  return {
    weakestDimensions: weakest,
    targetDimension: weakest[0]?.name,
    targetDescription: dim?.description || 'Unknown dimension',
    highSignals: dim?.highSignals || [],
    lowSignals: dim?.lowSignals || [],
    currentError: weakest[0]?.error,
    suggestion: `Generate a design component that maximizes ${weakest[0]?.name}. Focus on: ${(dim?.highSignals || []).join(', ')}`,
    modelStatus: status,
  };
}

/**
 * Train on an improvement trajectory: (before, after) pair.
 * The "after" version should score higher.
 */
export async function trainOnImprovement(codeBefore, codeAfter, llmCall, context = {}) {
  // Train comparative where "after" should win
  const result = await trainComparative(codeBefore, codeAfter, llmCall, {
    ...context,
    expectedWinner: 'B', // "after" is always B
  });

  return {
    ...result,
    type: 'improvement_trajectory',
  };
}

// ═══════════════════════════════════════════════════
// BATCH TRAINING
// ═══════════════════════════════════════════════════

/**
 * Train on a batch of pre-scored examples.
 * Each example: { code, scores: { typography_quality: 0.X, ... } }
 */
export function trainBatch(examples) {
  const model = loadModel();
  const results = [];

  for (const example of examples) {
    const features = encodeFromCode(example.code, example.context || {});
    model.predict(features, true);

    const target = new Float32Array(SCORE_NAMES.length);
    for (let i = 0; i < SCORE_NAMES.length; i++) {
      target[i] = Math.max(0, Math.min(1, example.scores[SCORE_NAMES[i]] ?? 0.5));
    }

    const result = model.learn(target);
    results.push({ loss: result.loss });
  }

  model.save();

  return {
    batchSize: examples.length,
    avgLoss: results.reduce((s, r) => s + r.loss, 0) / results.length,
    totalUpdates: model.totalUpdates,
    architecture: model.getArchitectureSummary(),
  };
}

// ═══════════════════════════════════════════════════
// PARSING HELPERS
// ═══════════════════════════════════════════════════

function parseScores(response) {
  try {
    // Extract JSON from response (may have markdown or text around it)
    const jsonMatch = response.match(/\{[^}]+\}/s);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);

    // Validate all dimensions present
    const scores = {};
    for (const name of SCORE_NAMES) {
      const val = parsed[name];
      if (val === undefined || val === null) scores[name] = 0.5;
      else scores[name] = Math.max(0, Math.min(1, Number(val)));
    }
    return scores;
  } catch {
    return null;
  }
}

function parseComparison(response) {
  try {
    const jsonMatch = response.match(/\{[\s\S]+\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);

    const comparison = {};
    for (const name of SCORE_NAMES) {
      const entry = parsed[name];
      if (entry && typeof entry === 'object') {
        comparison[name] = {
          winner: (entry.winner || 'tie').toUpperCase() === 'A' ? 'A' : (entry.winner || 'tie').toUpperCase() === 'B' ? 'B' : 'tie',
          margin: Math.max(0, Math.min(1, Number(entry.margin) || 0.5)),
        };
      } else {
        comparison[name] = { winner: 'tie', margin: 0 };
      }
    }
    return comparison;
  } catch {
    return null;
  }
}

export default {
  trainWithLLMJudge,
  trainComparative,
  trainOnImprovement,
  trainBatch,
  getTrainingFocus,
};
