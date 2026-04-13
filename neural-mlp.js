// OCA Neural MLP — trainable predictive model (SPEC §2.4 predictive processing, §22.2.8)
// A 2-layer MLP that predicts the *residual* (Δ = next_state − current_state) of the
// 208-dim neural-bus workspace.  Callers reconstruct the full predicted workspace as
// input + delta.  Per-layer weighted loss prevents high-variance slices from dominating.
// Pure JS, zero dependencies beyond neural-bus.  Weights persist to disk across restarts.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { TOTAL_DIM, OFFSETS, LAYERS } from './neural-bus.js';

const HIDDEN_DIM = 64;
const WEIGHTS_PATH = '/Users/quinnodonnell/.openclaw/workspace/oneiro-core/cognitive/private/mlp-weights.json';
const LEARNING_RATE = 0.001;
const GRADIENT_CLIP = 1.0;
const SCHEMA_VERSION = 2; // v2 = residual targets + per-layer weights

// Per-layer loss weights — bump layers whose prediction errors matter most
// for downstream behavior (metacognition, executive, hypothesis).
const LAYER_LOSS_WEIGHTS = {
  sensory:       1.0,
  emotion:       1.0,
  hypothesis:    1.5,
  memory:        1.0,
  executive:     1.5,
  creative:      1.0,
  metacognition: 1.5,
  motor:         1.0,
  design:        1.2,
};

// Build a flat per-dimension weight array once at startup
const dimWeights = new Float32Array(TOTAL_DIM);
let dimWeightSum = 0;
for (const [layer, info] of Object.entries(OFFSETS)) {
  const w = LAYER_LOSS_WEIGHTS[layer] ?? 1.0;
  for (let i = info.start; i < info.end; i++) dimWeights[i] = w;
  dimWeightSum += w * info.dim;
}

// ═══════════════════════════════════════════════════
// WEIGHT INITIALIZATION
// ═══════════════════════════════════════════════════

// Xavier initialization
function xavierInit(fanIn, fanOut) {
  const scale = Math.sqrt(2.0 / (fanIn + fanOut));
  const weights = new Float32Array(fanIn * fanOut);
  for (let i = 0; i < weights.length; i++) {
    weights[i] = (Math.random() * 2 - 1) * scale;
  }
  return weights;
}

// Weights: input->hidden (W1), hidden bias (b1), hidden->output (W2), output bias (b2)
let W1 = xavierInit(TOTAL_DIM, HIDDEN_DIM);     // [TOTAL_DIM x HIDDEN_DIM]
let b1 = new Float32Array(HIDDEN_DIM);
let W2 = xavierInit(HIDDEN_DIM, TOTAL_DIM);      // [HIDDEN_DIM x TOTAL_DIM]
let b2 = new Float32Array(TOTAL_DIM);

// Training stats
let totalUpdates = 0;
let runningLoss = 0;
let lossHistory = [];

// ═══════════════════════════════════════════════════
// FORWARD PASS
// ═══════════════════════════════════════════════════

function relu(x) { return x > 0 ? x : 0; }
function reluGrad(x) { return x > 0 ? 1 : 0; }

// Cache for backprop
let cachedInput = null;
let cachedHidden = null;
let cachedOutput = null;

// Last-step diagnostics (populated by learn())
let lastStep = null;

// predict() returns the predicted *delta* (Δ).  Callers reconstruct the full
// predicted workspace as:  predictedWorkspace = input + delta
export function predict(input) {
  if (!input || input.length !== TOTAL_DIM) return new Float32Array(TOTAL_DIM);

  cachedInput = new Float32Array(input);

  // Hidden = ReLU(input @ W1 + b1)
  const hidden = new Float32Array(HIDDEN_DIM);
  for (let j = 0; j < HIDDEN_DIM; j++) {
    let sum = b1[j];
    for (let i = 0; i < TOTAL_DIM; i++) {
      sum += input[i] * W1[i * HIDDEN_DIM + j];
    }
    hidden[j] = relu(sum);
  }
  cachedHidden = hidden;

  // Output (delta) = hidden @ W2 + b2
  const output = new Float32Array(TOTAL_DIM);
  for (let j = 0; j < TOTAL_DIM; j++) {
    let sum = b2[j];
    for (let i = 0; i < HIDDEN_DIM; i++) {
      sum += hidden[i] * W2[i * TOTAL_DIM + j];
    }
    output[j] = sum;
  }
  cachedOutput = output;

  return output;
}

// ═══════════════════════════════════════════════════
// BACKPROPAGATION (residual target, per-layer weighted MSE)
// ═══════════════════════════════════════════════════

export function learn(actual) {
  if (!cachedInput || !cachedHidden || !cachedOutput) return { loss: 0 };
  if (!actual || actual.length !== TOTAL_DIM) return { loss: 0 };

  // Residual target: r = actual − input (the change that happened this cycle)
  const residual = new Float32Array(TOTAL_DIM);
  for (let j = 0; j < TOTAL_DIM; j++) residual[j] = actual[j] - cachedInput[j];

  // Per-layer weighted MSE loss + gradient
  let weightedLoss = 0;
  const perLayerSqErr = {};
  const dOutput = new Float32Array(TOTAL_DIM);

  for (const [layer, info] of Object.entries(OFFSETS)) {
    let layerSqErr = 0;
    for (let j = info.start; j < info.end; j++) {
      const err = cachedOutput[j] - residual[j];
      dOutput[j] = 2 * dimWeights[j] * err / dimWeightSum;
      const wErr = dimWeights[j] * err * err;
      weightedLoss += wErr;
      layerSqErr += err * err;
    }
    perLayerSqErr[layer] = layerSqErr;
  }
  weightedLoss /= dimWeightSum;

  // Gradient clipping
  let gradNorm = 0;
  for (let j = 0; j < TOTAL_DIM; j++) gradNorm += dOutput[j] * dOutput[j];
  gradNorm = Math.sqrt(gradNorm);
  if (gradNorm > GRADIENT_CLIP) {
    const scale = GRADIENT_CLIP / gradNorm;
    for (let j = 0; j < TOTAL_DIM; j++) dOutput[j] *= scale;
  }

  // Backprop through W2
  const dHidden = new Float32Array(HIDDEN_DIM);
  for (let i = 0; i < HIDDEN_DIM; i++) {
    let sum = 0;
    for (let j = 0; j < TOTAL_DIM; j++) {
      W2[i * TOTAL_DIM + j] -= LEARNING_RATE * cachedHidden[i] * dOutput[j];
      sum += dOutput[j] * W2[i * TOTAL_DIM + j];
    }
    dHidden[i] = sum * reluGrad(cachedHidden[i]);
  }
  for (let j = 0; j < TOTAL_DIM; j++) {
    b2[j] -= LEARNING_RATE * dOutput[j];
  }

  // Backprop through W1
  for (let i = 0; i < TOTAL_DIM; i++) {
    for (let j = 0; j < HIDDEN_DIM; j++) {
      W1[i * HIDDEN_DIM + j] -= LEARNING_RATE * cachedInput[i] * dHidden[j];
    }
  }
  for (let j = 0; j < HIDDEN_DIM; j++) {
    b1[j] -= LEARNING_RATE * dHidden[j];
  }

  totalUpdates++;
  runningLoss = runningLoss * 0.99 + weightedLoss * 0.01;
  if (totalUpdates % 100 === 0) {
    lossHistory.push({ update: totalUpdates, loss: runningLoss });
    if (lossHistory.length > 1000) lossHistory = lossHistory.slice(-500);
  }

  // Build per-layer RMSE digest for observability
  const perLayerRmse = {};
  let residualNorm = 0;
  for (const [layer, info] of Object.entries(OFFSETS)) {
    perLayerRmse[layer] = Math.sqrt((perLayerSqErr[layer] || 0) / info.dim);
  }
  for (let j = 0; j < TOTAL_DIM; j++) residualNorm += residual[j] * residual[j];
  residualNorm = Math.sqrt(residualNorm / TOTAL_DIM);

  lastStep = {
    per_layer_rmse: perLayerRmse,
    weighted_loss: weightedLoss,
    residual_magnitude: residualNorm,
    total_updates: totalUpdates,
    mode: 'residual',
  };

  return { loss: weightedLoss, running_loss: runningLoss, updates: totalUpdates };
}

// ═══════════════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════════════

export function save() {
  try {
    const dir = WEIGHTS_PATH.replace(/\/[^/]+$/, '');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data = {
      schemaVersion: SCHEMA_VERSION,
      target: 'residual',
      W1: Array.from(W1),
      b1: Array.from(b1),
      W2: Array.from(W2),
      b2: Array.from(b2),
      totalUpdates,
      runningLoss,
      savedAt: new Date().toISOString(),
      dims: { input: TOTAL_DIM, hidden: HIDDEN_DIM, output: TOTAL_DIM }
    };
    writeFileSync(WEIGHTS_PATH, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error('[mlp] save failed:', e.message);
    return false;
  }
}

export function load() {
  try {
    if (!existsSync(WEIGHTS_PATH)) return false;
    const data = JSON.parse(readFileSync(WEIGHTS_PATH, 'utf-8'));

    if (data.dims?.input !== TOTAL_DIM || data.dims?.hidden !== HIDDEN_DIM) {
      console.log('[mlp] dimension mismatch, reinitializing');
      return false;
    }
    if ((data.schemaVersion || 1) < SCHEMA_VERSION) {
      console.log(`[mlp] schema v${data.schemaVersion || 1} < v${SCHEMA_VERSION} (residual), reinitializing`);
      return false;
    }

    W1 = new Float32Array(data.W1);
    b1 = new Float32Array(data.b1);
    W2 = new Float32Array(data.W2);
    b2 = new Float32Array(data.b2);
    totalUpdates = data.totalUpdates || 0;
    runningLoss = data.runningLoss || 0;
    console.log(`[mlp] loaded weights v${SCHEMA_VERSION} (${totalUpdates} updates, loss ${runningLoss.toFixed(6)})`);
    return true;
  } catch (e) {
    console.error('[mlp] load failed:', e.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════

export function getStatus() {
  return {
    total_updates: totalUpdates,
    running_loss: runningLoss,
    dims: { input: TOTAL_DIM, hidden: HIDDEN_DIM, output: TOTAL_DIM },
    total_params: TOTAL_DIM * HIDDEN_DIM + HIDDEN_DIM + HIDDEN_DIM * TOTAL_DIM + TOTAL_DIM,
    recent_history: lossHistory.slice(-20),
    weights_path: WEIGHTS_PATH,
    schema_version: SCHEMA_VERSION,
    target: 'residual',
  };
}

export function getLastStep() {
  return lastStep;
}

export default { predict, learn, save, load, getStatus, getLastStep };
