// CRM MLP — learns to predict Chinese Room Meter component scores
// 18-in -> 12-hidden (ReLU) -> 9-out (linear, MSE)
// Trains after each CRM evaluation. Prediction errors flag unexpected drift.
// Pure JS, zero dependencies.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

const INPUT_DIM = 18;
const HIDDEN_DIM = 12;
const OUTPUT_DIM = 9;
const WEIGHTS_PATH = '/Users/quinnodonnell/.openclaw/workspace/oneiro-core/cognitive/private/crm-mlp-weights.json';
const LEARNING_RATE = 0.002;
const GRADIENT_CLIP = 1.5;

const CRM_COMPONENTS = [
  'grounding', 'prediction', 'transfer', 'surprise',
  'creativity', 'metacognition', 'emotion', 'counterfactual', 'causal'
];

function xavierInit(fanIn, fanOut) {
  const scale = Math.sqrt(2.0 / (fanIn + fanOut));
  const w = new Float32Array(fanIn * fanOut);
  for (let i = 0; i < w.length; i++) w[i] = (Math.random() * 2 - 1) * scale;
  return w;
}

let W1 = xavierInit(INPUT_DIM, HIDDEN_DIM);
let b1 = new Float32Array(HIDDEN_DIM);
let W2 = xavierInit(HIDDEN_DIM, OUTPUT_DIM);
let b2 = new Float32Array(OUTPUT_DIM);

let totalUpdates = 0;
let runningLoss = 0;
let lossHistory = [];
let perComponentRunningError = new Float32Array(OUTPUT_DIM).fill(0.1);

let cachedInput = null;
let cachedHidden = null;
let cachedOutput = null;

function relu(x) { return x > 0 ? x : 0; }
function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

// Encode current OCA state + last CRM scores into input vector
export function encodeFeatures(lastCrmScores, ocaState = {}) {
  const v = new Float32Array(INPUT_DIM);
  let i = 0;

  // First 9 dims: last known CRM component scores
  for (const comp of CRM_COMPONENTS) {
    v[i++] = clamp01(lastCrmScores?.[comp] || 0.5);
  }

  // Next 9 dims: OCA context that might predict CRM drift
  v[i++] = clamp01((ocaState.operatingTimeHours || 0) / 1000);   // normalized operating time
  v[i++] = clamp01(ocaState.valence || 0.5);
  v[i++] = clamp01(ocaState.arousal || 0.5);
  v[i++] = clamp01(ocaState.confidence || 0.5);
  v[i++] = clamp01(ocaState.cognitiveLoad || 0.3);
  v[i++] = clamp01(ocaState.predictionAccuracy || 0.5);
  v[i++] = clamp01(ocaState.consolidationRate || 0);     // episodes consolidated per hour
  v[i++] = clamp01(ocaState.entityCountDelta || 0);       // change in entity graph size
  v[i++] = clamp01(ocaState.creativeArtifactDelta || 0);  // change in creative output

  return v;
}

export function predict(features) {
  if (!features || features.length !== INPUT_DIM) {
    return new Float32Array(OUTPUT_DIM).fill(0.5);
  }
  cachedInput = new Float32Array(features);

  const hidden = new Float32Array(HIDDEN_DIM);
  for (let j = 0; j < HIDDEN_DIM; j++) {
    let sum = b1[j];
    for (let k = 0; k < INPUT_DIM; k++) sum += features[k] * W1[k * HIDDEN_DIM + j];
    hidden[j] = relu(sum);
  }
  cachedHidden = hidden;

  const output = new Float32Array(OUTPUT_DIM);
  for (let j = 0; j < OUTPUT_DIM; j++) {
    let sum = b2[j];
    for (let k = 0; k < HIDDEN_DIM; k++) sum += hidden[k] * W2[k * OUTPUT_DIM + j];
    output[j] = Math.max(0, Math.min(1, sum)); // clamp to [0,1]
  }
  cachedOutput = output;
  return output;
}

// Train on actual CRM scores. Returns per-component prediction errors.
export function learn(actual) {
  if (!cachedInput || !cachedHidden || !cachedOutput) return { loss: 0, componentErrors: {} };
  if (!actual || actual.length !== OUTPUT_DIM) return { loss: 0, componentErrors: {} };

  let loss = 0;
  const dOutput = new Float32Array(OUTPUT_DIM);
  const componentErrors = {};

  for (let j = 0; j < OUTPUT_DIM; j++) {
    const err = cachedOutput[j] - actual[j];
    dOutput[j] = 2 * err / OUTPUT_DIM;
    loss += err * err;
    const absErr = Math.abs(err);
    componentErrors[CRM_COMPONENTS[j]] = {
      predicted: cachedOutput[j],
      actual: actual[j],
      error: absErr,
      surprised: absErr > perComponentRunningError[j] * 2,
    };
    perComponentRunningError[j] = perComponentRunningError[j] * 0.9 + absErr * 0.1;
  }
  loss /= OUTPUT_DIM;

  // Gradient clipping
  let gradNorm = 0;
  for (let j = 0; j < OUTPUT_DIM; j++) gradNorm += dOutput[j] * dOutput[j];
  gradNorm = Math.sqrt(gradNorm);
  if (gradNorm > GRADIENT_CLIP) {
    const scale = GRADIENT_CLIP / gradNorm;
    for (let j = 0; j < OUTPUT_DIM; j++) dOutput[j] *= scale;
  }

  // Backprop through W2
  const dHidden = new Float32Array(HIDDEN_DIM);
  for (let k = 0; k < HIDDEN_DIM; k++) {
    let sum = 0;
    for (let j = 0; j < OUTPUT_DIM; j++) {
      W2[k * OUTPUT_DIM + j] -= LEARNING_RATE * cachedHidden[k] * dOutput[j];
      sum += dOutput[j] * W2[k * OUTPUT_DIM + j];
    }
    dHidden[k] = sum * (cachedHidden[k] > 0 ? 1 : 0);
  }
  for (let j = 0; j < OUTPUT_DIM; j++) b2[j] -= LEARNING_RATE * dOutput[j];

  // Backprop through W1
  for (let k = 0; k < INPUT_DIM; k++) {
    for (let j = 0; j < HIDDEN_DIM; j++) {
      W1[k * HIDDEN_DIM + j] -= LEARNING_RATE * cachedInput[k] * dHidden[j];
    }
  }
  for (let j = 0; j < HIDDEN_DIM; j++) b1[j] -= LEARNING_RATE * dHidden[j];

  totalUpdates++;
  runningLoss = runningLoss * 0.9 + loss * 0.1;

  if (totalUpdates % 5 === 0) {
    lossHistory.push({ update: totalUpdates, loss: runningLoss });
    if (lossHistory.length > 200) lossHistory = lossHistory.slice(-100);
  }

  save();

  const surprisedComponents = Object.entries(componentErrors).filter(([, v]) => v.surprised).map(([k]) => k);
  return { loss, running_loss: runningLoss, updates: totalUpdates, componentErrors, surprisedComponents };
}

export function save() {
  try {
    const dir = WEIGHTS_PATH.replace(/\/[^/]+$/, '');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(WEIGHTS_PATH, JSON.stringify({
      W1: Array.from(W1), b1: Array.from(b1), W2: Array.from(W2), b2: Array.from(b2),
      totalUpdates, runningLoss,
      perComponentRunningError: Array.from(perComponentRunningError),
      dims: { input: INPUT_DIM, hidden: HIDDEN_DIM, output: OUTPUT_DIM },
      savedAt: new Date().toISOString(),
    }));
    return true;
  } catch { return false; }
}

export function load() {
  try {
    if (!existsSync(WEIGHTS_PATH)) return false;
    const data = JSON.parse(readFileSync(WEIGHTS_PATH, 'utf-8'));
    if (data.dims?.input !== INPUT_DIM || data.dims?.hidden !== HIDDEN_DIM) return false;
    W1 = new Float32Array(data.W1);
    b1 = new Float32Array(data.b1);
    W2 = new Float32Array(data.W2);
    b2 = new Float32Array(data.b2);
    totalUpdates = data.totalUpdates || 0;
    runningLoss = data.runningLoss || 0;
    if (data.perComponentRunningError) {
      perComponentRunningError = new Float32Array(data.perComponentRunningError);
    }
    return true;
  } catch { return false; }
}

export function getStatus() {
  return {
    name: 'crm-mlp',
    total_updates: totalUpdates,
    running_loss: runningLoss,
    dims: { input: INPUT_DIM, hidden: HIDDEN_DIM, output: OUTPUT_DIM },
    total_params: INPUT_DIM * HIDDEN_DIM + HIDDEN_DIM + HIDDEN_DIM * OUTPUT_DIM + OUTPUT_DIM,
    components: CRM_COMPONENTS,
    per_component_running_error: Object.fromEntries(CRM_COMPONENTS.map((c, i) => [c, perComponentRunningError[i]])),
    recent_history: lossHistory.slice(-20),
  };
}

export { CRM_COMPONENTS };
export default { predict, learn, encodeFeatures, save, load, getStatus, CRM_COMPONENTS };
