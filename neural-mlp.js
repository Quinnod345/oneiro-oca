// OCA Neural MLP — trainable predictive model (SPEC §2.4 predictive processing, §22.2.8)
// A 2-layer MLP that learns to predict next-cycle cognitive activation from current state.
// Prediction errors become the surprise signal that drives learning.
// Pure JS, zero dependencies. Weights persist to disk across restarts.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { TOTAL_DIM } from './neural-bus.js';

const HIDDEN_DIM = 64;
const WEIGHTS_PATH = '/Users/quinnodonnell/.openclaw/workspace/oneiro-core/cognitive/private/mlp-weights.json';
const LEARNING_RATE = 0.001;
const GRADIENT_CLIP = 1.0;

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

  // Output = hidden @ W2 + b2
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
// BACKPROPAGATION
// ═══════════════════════════════════════════════════

export function learn(actual) {
  if (!cachedInput || !cachedHidden || !cachedOutput) return { loss: 0 };
  if (!actual || actual.length !== TOTAL_DIM) return { loss: 0 };

  // Compute loss: MSE
  let loss = 0;
  const dOutput = new Float32Array(TOTAL_DIM);
  for (let j = 0; j < TOTAL_DIM; j++) {
    const err = cachedOutput[j] - actual[j];
    dOutput[j] = 2 * err / TOTAL_DIM;
    loss += err * err;
  }
  loss /= TOTAL_DIM;

  // Gradient clipping on output gradient
  let gradNorm = 0;
  for (let j = 0; j < TOTAL_DIM; j++) gradNorm += dOutput[j] * dOutput[j];
  gradNorm = Math.sqrt(gradNorm);
  if (gradNorm > GRADIENT_CLIP) {
    const scale = GRADIENT_CLIP / gradNorm;
    for (let j = 0; j < TOTAL_DIM; j++) dOutput[j] *= scale;
  }

  // Backprop through W2: dW2 = hidden^T @ dOutput, db2 = dOutput
  // dHidden = dOutput @ W2^T
  const dHidden = new Float32Array(HIDDEN_DIM);
  for (let i = 0; i < HIDDEN_DIM; i++) {
    let sum = 0;
    for (let j = 0; j < TOTAL_DIM; j++) {
      // Update W2
      W2[i * TOTAL_DIM + j] -= LEARNING_RATE * cachedHidden[i] * dOutput[j];
      sum += dOutput[j] * W2[i * TOTAL_DIM + j];
    }
    dHidden[i] = sum * reluGrad(cachedHidden[i]);
  }
  // Update b2
  for (let j = 0; j < TOTAL_DIM; j++) {
    b2[j] -= LEARNING_RATE * dOutput[j];
  }

  // Backprop through W1: dW1 = input^T @ dHidden, db1 = dHidden
  for (let i = 0; i < TOTAL_DIM; i++) {
    for (let j = 0; j < HIDDEN_DIM; j++) {
      W1[i * HIDDEN_DIM + j] -= LEARNING_RATE * cachedInput[i] * dHidden[j];
    }
  }
  for (let j = 0; j < HIDDEN_DIM; j++) {
    b1[j] -= LEARNING_RATE * dHidden[j];
  }

  totalUpdates++;
  runningLoss = runningLoss * 0.99 + loss * 0.01;
  if (totalUpdates % 100 === 0) {
    lossHistory.push({ update: totalUpdates, loss: runningLoss });
    if (lossHistory.length > 1000) lossHistory = lossHistory.slice(-500);
  }

  return { loss, running_loss: runningLoss, updates: totalUpdates };
}

// ═══════════════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════════════

export function save() {
  try {
    const dir = WEIGHTS_PATH.replace(/\/[^/]+$/, '');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data = {
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

    W1 = new Float32Array(data.W1);
    b1 = new Float32Array(data.b1);
    W2 = new Float32Array(data.W2);
    b2 = new Float32Array(data.b2);
    totalUpdates = data.totalUpdates || 0;
    runningLoss = data.runningLoss || 0;
    console.log(`[mlp] loaded weights (${totalUpdates} updates, loss ${runningLoss.toFixed(6)})`);
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
    weights_path: WEIGHTS_PATH
  };
}

export default { predict, learn, save, load, getStatus };
