// Design-Aesthetic MLP — scalable, self-expanding neural network for design evaluation
// Starts as a configurable JS MLP, grows toward MLX/ONNX vision model.
// Pure JS, zero dependencies. Config-driven architecture with automatic growth.
// Any Claude Code agent can use this — not OCA-specific.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { OUTPUT_DIM, SCORE_NAMES, DIMENSION_WEIGHTS } from './knowledge.js';

const WEIGHTS_DIR = new URL('./weights/', import.meta.url).pathname;
const SCHEMA_VERSION = 1;

// ═══════════════════════════════════════════════════
// DEFAULT CONFIGURATION
// ═══════════════════════════════════════════════════

const DEFAULT_CONFIG = {
  schemaVersion: SCHEMA_VERSION,
  inputDim: 64,
  layers: [
    { dim: 256, activation: 'relu', dropout: 0.2 },
    { dim: 128, activation: 'relu', dropout: 0.15 },
    { dim: 64,  activation: 'relu', dropout: 0.1 },
  ],
  outputDim: OUTPUT_DIM,
  learningRate: 0.002,
  gradientClip: 1.5,
  batchSize: 16,
  warmupSteps: 100,
  // Growth config — the model knows how to expand itself
  growth: {
    autoExpand: true,
    expandThreshold: 0.85,     // expand when loss plateaus above this for N steps
    plateauWindow: 50,         // steps to confirm plateau
    maxLayerDim: 1024,         // per-layer cap before recommending Phase 2
    maxLayers: 8,              // depth cap
    dimStep: 64,               // add 64 neurons per expansion
    cooldownSteps: 200,        // steps between expansions
  },
};

// ═══════════════════════════════════════════════════
// ACTIVATION FUNCTIONS
// ═══════════════════════════════════════════════════

function relu(x) { return x > 0 ? x : 0; }
function reluDeriv(x) { return x > 0 ? 1 : 0; }
function gelu(x) {
  // Approximate GELU: x * 0.5 * (1 + tanh(sqrt(2/pi) * (x + 0.044715 * x^3)))
  const c = Math.sqrt(2 / Math.PI);
  const t = Math.tanh(c * (x + 0.044715 * x * x * x));
  return 0.5 * x * (1 + t);
}
function geluDeriv(x) {
  const c = Math.sqrt(2 / Math.PI);
  const inner = c * (x + 0.044715 * x * x * x);
  const t = Math.tanh(inner);
  const sech2 = 1 - t * t;
  return 0.5 * (1 + t) + 0.5 * x * sech2 * c * (1 + 3 * 0.044715 * x * x);
}

const ACTIVATIONS = {
  relu:  { fn: relu,  deriv: reluDeriv },
  gelu:  { fn: gelu,  deriv: geluDeriv },
};

function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

// ═══════════════════════════════════════════════════
// XAVIER INITIALIZATION
// ═══════════════════════════════════════════════════

function xavierInit(fanIn, fanOut) {
  const scale = Math.sqrt(2.0 / (fanIn + fanOut));
  const weights = new Float32Array(fanIn * fanOut);
  for (let i = 0; i < weights.length; i++) {
    weights[i] = (Math.random() * 2 - 1) * scale;
  }
  return weights;
}

// ═══════════════════════════════════════════════════
// DYNAMIC MLP CLASS
// ═══════════════════════════════════════════════════

export class DesignMLP {
  constructor(config = DEFAULT_CONFIG) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.weights = [];   // Array of { W, b, activation, dropout } per layer
    this.outputW = null;
    this.outputB = null;

    // Training state
    this.totalUpdates = 0;
    this.runningLoss = 0;
    this.lossHistory = [];
    this.perDimRunningError = new Float32Array(this.config.outputDim).fill(0.1);
    this.expansionCount = 0;
    this.lastExpansionStep = 0;
    this.warmupRemaining = this.config.warmupSteps;

    // Cached forward pass state for backprop
    this._cache = null;

    // Build per-dimension loss weights
    this.dimWeights = new Float32Array(this.config.outputDim);
    let dwSum = 0;
    for (let i = 0; i < this.config.outputDim; i++) {
      const name = SCORE_NAMES[i];
      this.dimWeights[i] = DIMENSION_WEIGHTS[name] ?? 1.0;
      dwSum += this.dimWeights[i];
    }
    // Normalize so they sum to outputDim (preserves loss scale)
    for (let i = 0; i < this.config.outputDim; i++) {
      this.dimWeights[i] = this.dimWeights[i] * this.config.outputDim / dwSum;
    }

    this._initLayers();
  }

  _initLayers() {
    this.weights = [];
    let prevDim = this.config.inputDim;

    for (const layerSpec of this.config.layers) {
      this.weights.push({
        W: xavierInit(prevDim, layerSpec.dim),
        b: new Float32Array(layerSpec.dim),
        activation: layerSpec.activation || 'relu',
        dropout: layerSpec.dropout || 0,
        dim: layerSpec.dim,
        prevDim,
      });
      prevDim = layerSpec.dim;
    }

    // Output layer (no activation — linear output, clamped to [0,1])
    this.outputW = xavierInit(prevDim, this.config.outputDim);
    this.outputB = new Float32Array(this.config.outputDim);
  }

  // ═══════════════════════════════════════════════════
  // FORWARD PASS
  // ═══════════════════════════════════════════════════

  predict(input, training = false) {
    if (!input || input.length !== this.config.inputDim) {
      return new Float32Array(this.config.outputDim).fill(0.5);
    }

    const cache = { inputs: [], preActivations: [], activations: [] };
    let current = new Float32Array(input);
    cache.inputs.push(new Float32Array(current));

    for (let l = 0; l < this.weights.length; l++) {
      const { W, b, activation, dropout, dim, prevDim } = this.weights[l];
      const act = ACTIVATIONS[activation] || ACTIVATIONS.relu;

      // Linear transform
      const pre = new Float32Array(dim);
      for (let j = 0; j < dim; j++) {
        let sum = b[j];
        for (let k = 0; k < prevDim; k++) {
          sum += current[k] * W[k * dim + j];
        }
        pre[j] = sum;
      }
      cache.preActivations.push(pre);

      // Activation
      const post = new Float32Array(dim);
      for (let j = 0; j < dim; j++) {
        post[j] = act.fn(pre[j]);
      }

      // Dropout (training only)
      if (training && dropout > 0) {
        const scale = 1.0 / (1.0 - dropout);
        for (let j = 0; j < dim; j++) {
          if (Math.random() < dropout) post[j] = 0;
          else post[j] *= scale;
        }
      }

      cache.activations.push(post);
      current = post;
      cache.inputs.push(new Float32Array(current));
    }

    // Output layer
    const lastDim = this.weights[this.weights.length - 1].dim;
    const output = new Float32Array(this.config.outputDim);
    for (let j = 0; j < this.config.outputDim; j++) {
      let sum = this.outputB[j];
      for (let k = 0; k < lastDim; k++) {
        sum += current[k] * this.outputW[k * this.config.outputDim + j];
      }
      output[j] = clamp01(sum);
    }

    this._cache = { ...cache, output: new Float32Array(output), input: new Float32Array(input) };
    return output;
  }

  // ═══════════════════════════════════════════════════
  // BACKWARD PASS (BACKPROPAGATION)
  // ═══════════════════════════════════════════════════

  learn(actual) {
    if (!this._cache || !actual || actual.length !== this.config.outputDim) {
      return { loss: 0, componentErrors: {} };
    }

    const { output, inputs, preActivations } = this._cache;
    const clip = this.config.gradientClip;

    // Learning rate with warmup
    let lr = this.config.learningRate;
    if (this.warmupRemaining > 0) {
      lr *= (this.config.warmupSteps - this.warmupRemaining) / this.config.warmupSteps;
      this.warmupRemaining--;
    }

    // Compute output layer gradients (weighted MSE)
    let loss = 0;
    const dOutput = new Float32Array(this.config.outputDim);
    const componentErrors = {};

    for (let j = 0; j < this.config.outputDim; j++) {
      const err = output[j] - clamp01(actual[j]);
      const weightedErr = err * this.dimWeights[j];
      dOutput[j] = 2 * weightedErr / this.config.outputDim;
      loss += weightedErr * err;
      componentErrors[SCORE_NAMES[j]] = Math.abs(err);
      this.perDimRunningError[j] = 0.95 * this.perDimRunningError[j] + 0.05 * Math.abs(err);
    }
    loss /= this.config.outputDim;

    // Update output layer
    const lastHidden = inputs[inputs.length - 1];
    const lastDim = this.weights[this.weights.length - 1].dim;

    for (let j = 0; j < this.config.outputDim; j++) {
      for (let k = 0; k < lastDim; k++) {
        let grad = dOutput[j] * lastHidden[k];
        grad = Math.max(-clip, Math.min(clip, grad));
        this.outputW[k * this.config.outputDim + j] -= lr * grad;
      }
      this.outputB[j] -= lr * Math.max(-clip, Math.min(clip, dOutput[j]));
    }

    // Backpropagate through hidden layers
    let dCurrent = new Float32Array(lastDim);
    for (let k = 0; k < lastDim; k++) {
      let sum = 0;
      for (let j = 0; j < this.config.outputDim; j++) {
        sum += dOutput[j] * this.outputW[k * this.config.outputDim + j];
      }
      dCurrent[k] = sum;
    }

    for (let l = this.weights.length - 1; l >= 0; l--) {
      const { W, b, activation, dim, prevDim } = this.weights[l];
      const act = ACTIVATIONS[activation] || ACTIVATIONS.relu;
      const pre = preActivations[l];
      const inp = inputs[l];

      // Apply activation derivative
      const dPre = new Float32Array(dim);
      for (let j = 0; j < dim; j++) {
        dPre[j] = dCurrent[j] * act.deriv(pre[j]);
      }

      // Update weights
      for (let j = 0; j < dim; j++) {
        for (let k = 0; k < prevDim; k++) {
          let grad = dPre[j] * inp[k];
          grad = Math.max(-clip, Math.min(clip, grad));
          W[k * dim + j] -= lr * grad;
        }
        b[j] -= lr * Math.max(-clip, Math.min(clip, dPre[j]));
      }

      // Propagate gradient to previous layer
      if (l > 0) {
        const dPrev = new Float32Array(prevDim);
        for (let k = 0; k < prevDim; k++) {
          let sum = 0;
          for (let j = 0; j < dim; j++) {
            sum += dPre[j] * W[k * dim + j];
          }
          dPrev[k] = sum;
        }
        dCurrent = dPrev;
      }
    }

    // Update stats
    this.totalUpdates++;
    this.runningLoss = 0.95 * this.runningLoss + 0.05 * loss;
    this.lossHistory.push(loss);
    if (this.lossHistory.length > 1000) this.lossHistory.shift();

    // Check for auto-expansion
    if (this.config.growth.autoExpand) {
      this._checkExpansion();
    }

    return { loss, runningLoss: this.runningLoss, componentErrors, updates: this.totalUpdates };
  }

  // ═══════════════════════════════════════════════════
  // AUTO-EXPANSION
  // ═══════════════════════════════════════════════════

  _checkExpansion() {
    const { expandThreshold, plateauWindow, cooldownSteps, maxLayerDim, maxLayers, dimStep } = this.config.growth;

    // Must have enough history
    if (this.lossHistory.length < plateauWindow) return;
    // Cooldown period
    if (this.totalUpdates - this.lastExpansionStep < cooldownSteps) return;

    // Check if loss has plateaued above threshold
    const recentLosses = this.lossHistory.slice(-plateauWindow);
    const avgLoss = recentLosses.reduce((s, l) => s + l, 0) / recentLosses.length;
    const variance = recentLosses.reduce((s, l) => s + (l - avgLoss) ** 2, 0) / recentLosses.length;

    // Plateau = high loss + low variance (not improving)
    if (avgLoss < expandThreshold || variance > 0.01) return;

    // Find the bottleneck — the smallest hidden layer
    let bottleneckIdx = -1;
    let bottleneckDim = Infinity;
    for (let i = 0; i < this.weights.length; i++) {
      if (this.weights[i].dim < bottleneckDim && this.weights[i].dim < maxLayerDim) {
        bottleneckDim = this.weights[i].dim;
        bottleneckIdx = i;
      }
    }

    if (bottleneckIdx >= 0 && bottleneckDim + dimStep <= maxLayerDim) {
      // Expand the bottleneck layer
      this._expandLayer(bottleneckIdx, dimStep);
    } else if (this.weights.length < maxLayers) {
      // Add a new layer before the output
      this._addLayer(dimStep);
    } else {
      // At capacity — recommend Phase 2 upgrade
      console.log('[design-mlp] ⚡ JS MLP at capacity. Consider upgrading to MLX vision model (Phase 2).');
    }
  }

  _expandLayer(layerIdx, addDim) {
    const layer = this.weights[layerIdx];
    const newDim = layer.dim + addDim;
    const { prevDim } = layer;

    console.log(`[design-mlp] 🌱 expanding layer ${layerIdx}: ${layer.dim} → ${newDim} (+${addDim} neurons)`);

    // Create new weights, preserving existing
    const newW = xavierInit(prevDim, newDim);
    const newB = new Float32Array(newDim);

    // Copy existing weights into the new array
    for (let k = 0; k < prevDim; k++) {
      for (let j = 0; j < layer.dim; j++) {
        newW[k * newDim + j] = layer.W[k * layer.dim + j];
      }
    }
    for (let j = 0; j < layer.dim; j++) {
      newB[j] = layer.b[j];
    }

    layer.W = newW;
    layer.b = newB;
    layer.dim = newDim;

    // Update next layer's input dimension
    if (layerIdx < this.weights.length - 1) {
      const nextLayer = this.weights[layerIdx + 1];
      const nextNewW = xavierInit(newDim, nextLayer.dim);
      // Copy existing weights
      for (let k = 0; k < layer.dim - addDim; k++) {
        for (let j = 0; j < nextLayer.dim; j++) {
          nextNewW[k * nextLayer.dim + j] = nextLayer.W[k * nextLayer.dim + j];
        }
      }
      nextLayer.W = nextNewW;
      nextLayer.prevDim = newDim;
    } else {
      // This is the last hidden layer — update output weights
      const newOutW = xavierInit(newDim, this.config.outputDim);
      for (let k = 0; k < layer.dim - addDim; k++) {
        for (let j = 0; j < this.config.outputDim; j++) {
          newOutW[k * this.config.outputDim + j] = this.outputW[k * this.config.outputDim + j];
        }
      }
      this.outputW = newOutW;
    }

    // Update config
    this.config.layers[layerIdx].dim = newDim;
    this.expansionCount++;
    this.lastExpansionStep = this.totalUpdates;
    this.lossHistory = []; // Reset loss history after expansion
  }

  _addLayer(dim) {
    const lastHidden = this.weights[this.weights.length - 1];
    const prevDim = lastHidden.dim;

    console.log(`[design-mlp] 🌿 adding new layer: ${prevDim} → ${dim} (depth ${this.weights.length + 1})`);

    // New layer between last hidden and output
    const newLayer = {
      W: xavierInit(prevDim, dim),
      b: new Float32Array(dim),
      activation: 'relu',
      dropout: 0.1,
      dim,
      prevDim,
    };
    this.weights.push(newLayer);

    // Reinitialize output weights for new input dimension
    this.outputW = xavierInit(dim, this.config.outputDim);
    this.outputB = new Float32Array(this.config.outputDim);

    // Update config
    this.config.layers.push({ dim, activation: 'relu', dropout: 0.1 });
    this.expansionCount++;
    this.lastExpansionStep = this.totalUpdates;
    this.lossHistory = [];
  }

  // ═══════════════════════════════════════════════════
  // PARAMETER COUNTING
  // ═══════════════════════════════════════════════════

  getParamCount() {
    let total = 0;
    for (const layer of this.weights) {
      total += layer.W.length + layer.b.length;
    }
    total += this.outputW.length + this.outputB.length;
    return total;
  }

  getArchitectureSummary() {
    const layers = [this.config.inputDim, ...this.config.layers.map(l => l.dim), this.config.outputDim];
    return {
      layers,
      layerString: layers.join(' → '),
      paramCount: this.getParamCount(),
      depth: this.weights.length + 1,
      expansions: this.expansionCount,
      maxDim: Math.max(...this.config.layers.map(l => l.dim)),
    };
  }

  // ═══════════════════════════════════════════════════
  // PERSISTENCE
  // ═══════════════════════════════════════════════════

  save() {
    try {
      if (!existsSync(WEIGHTS_DIR)) mkdirSync(WEIGHTS_DIR, { recursive: true });
    } catch {}

    const data = {
      schemaVersion: SCHEMA_VERSION,
      config: this.config,
      layers: this.weights.map(l => ({
        W: Array.from(l.W),
        b: Array.from(l.b),
        activation: l.activation,
        dropout: l.dropout,
        dim: l.dim,
        prevDim: l.prevDim,
      })),
      outputW: Array.from(this.outputW),
      outputB: Array.from(this.outputB),
      stats: {
        totalUpdates: this.totalUpdates,
        runningLoss: this.runningLoss,
        perDimRunningError: Array.from(this.perDimRunningError),
        expansionCount: this.expansionCount,
        lastExpansionStep: this.lastExpansionStep,
        paramCount: this.getParamCount(),
      },
      savedAt: new Date().toISOString(),
    };

    const filename = `model-v${SCHEMA_VERSION}-latest.json`;
    const path = WEIGHTS_DIR + filename;
    writeFileSync(path, JSON.stringify(data));

    // Also save timestamped backup every 100 updates
    if (this.totalUpdates % 100 === 0 && this.totalUpdates > 0) {
      const backupPath = WEIGHTS_DIR + `model-v${SCHEMA_VERSION}-${this.totalUpdates}.json`;
      writeFileSync(backupPath, JSON.stringify(data));
    }

    return path;
  }

  load() {
    const path = WEIGHTS_DIR + `model-v${SCHEMA_VERSION}-latest.json`;
    if (!existsSync(path)) return false;

    try {
      const data = JSON.parse(readFileSync(path, 'utf-8'));
      if (data.schemaVersion !== SCHEMA_VERSION) {
        console.log(`[design-mlp] schema version mismatch (${data.schemaVersion} vs ${SCHEMA_VERSION}), reinitializing`);
        return false;
      }

      // Restore config
      this.config = data.config;

      // Restore layers
      this.weights = data.layers.map(l => ({
        W: new Float32Array(l.W),
        b: new Float32Array(l.b),
        activation: l.activation,
        dropout: l.dropout,
        dim: l.dim,
        prevDim: l.prevDim,
      }));

      this.outputW = new Float32Array(data.outputW);
      this.outputB = new Float32Array(data.outputB);

      // Restore stats
      if (data.stats) {
        this.totalUpdates = data.stats.totalUpdates || 0;
        this.runningLoss = data.stats.runningLoss || 0;
        this.perDimRunningError = new Float32Array(data.stats.perDimRunningError || new Array(this.config.outputDim).fill(0.1));
        this.expansionCount = data.stats.expansionCount || 0;
        this.lastExpansionStep = data.stats.lastExpansionStep || 0;
        this.warmupRemaining = 0; // No warmup on reload
      }

      console.log(`[design-mlp] loaded ${this.getArchitectureSummary().layerString} (${this.getParamCount()} params, ${this.totalUpdates} updates)`);
      return true;
    } catch (err) {
      console.error('[design-mlp] failed to load weights:', err.message);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════
  // STATUS
  // ═══════════════════════════════════════════════════

  getStatus() {
    const arch = this.getArchitectureSummary();
    return {
      architecture: arch.layerString,
      paramCount: arch.paramCount,
      depth: arch.depth,
      expansions: arch.expansions,
      totalUpdates: this.totalUpdates,
      runningLoss: this.runningLoss,
      perDimError: Object.fromEntries(SCORE_NAMES.map((n, i) => [n, this.perDimRunningError[i]])),
      atCapacity: arch.maxDim >= this.config.growth.maxLayerDim && this.weights.length >= this.config.growth.maxLayers,
      phase: 'js_mlp',
    };
  }

  getLastScores() {
    return this._cache?.output ? Array.from(this._cache.output) : null;
  }

  getWeakestDimensions(n = 3) {
    const entries = SCORE_NAMES.map((name, i) => ({ name, error: this.perDimRunningError[i] }));
    entries.sort((a, b) => b.error - a.error);
    return entries.slice(0, n);
  }
}

// ═══════════════════════════════════════════════════
// SINGLETON LOADER
// ═══════════════════════════════════════════════════

let _instance = null;

export function loadModel(config) {
  if (_instance) return _instance;
  _instance = new DesignMLP(config);
  _instance.load();
  return _instance;
}

export function getModel() {
  return _instance;
}

export default { DesignMLP, loadModel, getModel };
