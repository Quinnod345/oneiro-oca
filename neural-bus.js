// OCA Neural Bus — vector-mediated signaling between cognitive layers
// Replaces text/JSON events with dense activation vectors for inter-layer communication.
// Each layer encodes its state as a float vector; other layers read weighted sums.
// Connection weights update via Hebbian learning; decay prevents saturation.

// ═══════════════════════════════════════════════════
// LAYER DIMENSIONS
// ═══════════════════════════════════════════════════

export const LAYER_DIMS = {
  sensory:       64,
  emotion:       32,
  hypothesis:    16,
  memory:        32,
  executive:     16,
  creative:      16,
  metacognition: 16,
  motor:         16,
  design:        16,
};

export const LAYERS = Object.keys(LAYER_DIMS);
export const TOTAL_DIM = Object.values(LAYER_DIMS).reduce((s, d) => s + d, 0); // 208

// Compute offset for each layer's slice in the shared workspace
const OFFSETS = {};
let offset = 0;
for (const [layer, dim] of Object.entries(LAYER_DIMS)) {
  OFFSETS[layer] = { start: offset, end: offset + dim, dim };
  offset += dim;
}
export { OFFSETS };

// ═══════════════════════════════════════════════════
// SHARED ACTIVATION WORKSPACE
// ═══════════════════════════════════════════════════

const workspace = new Float32Array(TOTAL_DIM);
const previousWorkspace = new Float32Array(TOTAL_DIM);

// Connection weight matrix W: inter-layer weights only
// W[i * TOTAL_DIM + j] = strength of connection from dim i to dim j
// Stored as flat Float32Array for performance
const W = new Float32Array(TOTAL_DIM * TOTAL_DIM);

// Hebbian learning parameters
const LEARNING_RATE = 0.0005;
const DECAY_RATE = 0.002;
const MAX_WEIGHT = 0.8;

// ═══════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════

export function initWeights(neuralConnections = []) {
  W.fill(0);

  // Initialize from DB neural_connections: map layer-pair strengths to block weights
  for (const conn of neuralConnections) {
    const fromInfo = OFFSETS[conn.from_layer];
    const toInfo = OFFSETS[conn.to_layer];
    if (!fromInfo || !toInfo) continue;
    if (conn.from_layer === conn.to_layer) continue;

    const strength = Math.min(MAX_WEIGHT, Number(conn.strength) || 0.3);

    // Set uniform block weight between the two layer regions
    for (let i = fromInfo.start; i < fromInfo.end; i++) {
      for (let j = toInfo.start; j < toInfo.end; j++) {
        W[i * TOTAL_DIM + j] = strength / fromInfo.dim;
        W[j * TOTAL_DIM + i] = strength / toInfo.dim;
      }
    }
  }

  // Small random noise to break symmetry
  for (let i = 0; i < W.length; i++) {
    if (W[i] !== 0) W[i] += (Math.random() - 0.5) * 0.01;
  }
}

// ═══════════════════════════════════════════════════
// WRITE: layer encodes its state into the workspace
// ═══════════════════════════════════════════════════

export function writeLayer(layerName, stateVector) {
  const info = OFFSETS[layerName];
  if (!info) return;

  // Ensure correct dimensionality
  for (let i = 0; i < info.dim; i++) {
    workspace[info.start + i] = Number(stateVector[i]) || 0;
  }
}

// ═══════════════════════════════════════════════════
// READ: layer reads weighted sum of other layers' activations
// ═══════════════════════════════════════════════════

export function readForLayer(layerName) {
  const info = OFFSETS[layerName];
  if (!info) return new Float32Array(0);

  const input = new Float32Array(info.dim);

  // Weighted sum: for each of this layer's dims, sum contributions from all other dims
  for (let i = 0; i < info.dim; i++) {
    const targetIdx = info.start + i;
    let sum = 0;
    for (let j = 0; j < TOTAL_DIM; j++) {
      if (j >= info.start && j < info.end) continue; // skip self-connections
      sum += workspace[j] * W[j * TOTAL_DIM + targetIdx];
    }
    input[i] = sum;
  }

  return input;
}

// ═══════════════════════════════════════════════════
// LEARN: Hebbian update + decay
// ═══════════════════════════════════════════════════

export function hebbianUpdate() {
  // Save current state for prediction error computation
  previousWorkspace.set(workspace);

  // Hebbian rule: connections between co-active dimensions strengthen
  // Only update inter-layer connections (not within-layer)
  for (const [layerA, infoA] of Object.entries(OFFSETS)) {
    for (const [layerB, infoB] of Object.entries(OFFSETS)) {
      if (layerA >= layerB) continue; // only upper triangle, then mirror

      for (let i = infoA.start; i < infoA.end; i++) {
        const ai = workspace[i];
        if (Math.abs(ai) < 0.01) continue; // skip near-zero activations

        for (let j = infoB.start; j < infoB.end; j++) {
          const aj = workspace[j];
          if (Math.abs(aj) < 0.01) continue;

          const delta = LEARNING_RATE * ai * aj;
          const idx = i * TOTAL_DIM + j;
          const mirrorIdx = j * TOTAL_DIM + i;

          W[idx] = Math.min(MAX_WEIGHT, W[idx] + delta);
          W[mirrorIdx] = Math.min(MAX_WEIGHT, W[mirrorIdx] + delta);
        }
      }
    }
  }

  // Global decay: all weights drift toward 0
  for (let i = 0; i < W.length; i++) {
    W[i] *= (1 - DECAY_RATE);
    if (Math.abs(W[i]) < 0.001) W[i] = 0; // clamp near-zero to zero for sparsity
  }
}

// ═══════════════════════════════════════════════════
// PREDICTION ERROR (for MLP and metacognition)
// ═══════════════════════════════════════════════════

export function computePredictionError(predicted) {
  if (!predicted || predicted.length !== TOTAL_DIM) return { mse: 0, magnitude: 0, perLayer: {} };

  let totalError = 0;
  const perLayer = {};

  for (const [layer, info] of Object.entries(OFFSETS)) {
    let layerError = 0;
    for (let i = info.start; i < info.end; i++) {
      const err = workspace[i] - (predicted[i] || 0);
      layerError += err * err;
      totalError += err * err;
    }
    perLayer[layer] = Math.sqrt(layerError / info.dim);
  }

  const mse = totalError / TOTAL_DIM;
  return { mse, magnitude: Math.sqrt(mse), perLayer };
}

// ═══════════════════════════════════════════════════
// ACCESSORS
// ═══════════════════════════════════════════════════

export function getWorkspace() { return new Float32Array(workspace); }
export function getPreviousWorkspace() { return new Float32Array(previousWorkspace); }

export function getLayerActivation(layerName) {
  const info = OFFSETS[layerName];
  if (!info) return null;
  return new Float32Array(workspace.buffer, info.start * 4, info.dim);
}

export function getConnectionStrength(fromLayer, toLayer) {
  const from = OFFSETS[fromLayer];
  const to = OFFSETS[toLayer];
  if (!from || !to) return 0;

  let sum = 0, count = 0;
  for (let i = from.start; i < from.end; i++) {
    for (let j = to.start; j < to.end; j++) {
      sum += Math.abs(W[i * TOTAL_DIM + j]);
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

export function getWeightStats() {
  let nonZero = 0, sum = 0, max = 0;
  for (let i = 0; i < W.length; i++) {
    const abs = Math.abs(W[i]);
    if (abs > 0.001) { nonZero++; sum += abs; max = Math.max(max, abs); }
  }
  return {
    total_weights: W.length,
    nonzero: nonZero,
    sparsity: 1 - nonZero / W.length,
    avg_nonzero: nonZero > 0 ? sum / nonZero : 0,
    max_weight: max
  };
}

// Layer-to-layer summary for visualization
export function getInterLayerStrengths() {
  const strengths = {};
  for (const a of LAYERS) {
    for (const b of LAYERS) {
      if (a === b) continue;
      const s = getConnectionStrength(a, b);
      if (s > 0.001) {
        strengths[`${a}->${b}`] = Math.round(s * 1000) / 1000;
      }
    }
  }
  return strengths;
}

export default {
  LAYER_DIMS, LAYERS, TOTAL_DIM, OFFSETS,
  initWeights, writeLayer, readForLayer,
  hebbianUpdate, computePredictionError,
  getWorkspace, getPreviousWorkspace, getLayerActivation,
  getConnectionStrength, getWeightStats, getInterLayerStrengths
};
