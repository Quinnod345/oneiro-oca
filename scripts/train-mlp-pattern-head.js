#!/usr/bin/env node
// Train the Oneiro MLP pattern-head.
//
// Default mode: synthetic-only. Generates a labeled dataset from a
// hand-coded distribution that captures the obvious patterns
// (repeat actions ⇒ repeat_pattern_likelihood high, typing-burst ⇒
// interrupt_safe low, etc.). Trains with vanilla SGD in pure JS so it
// runs on any Node — no MLX dep — and writes weights to
// `oca-cognitive/private/mlp-pattern-head.json`.
//
// When the `--from-memory` flag is passed and `oca-cognitive/memory.db`
// exists, it also pulls real motor-action chains and the
// `mlp-pattern-head.feedback.jsonl` log to fine-tune. Synthetic always
// happens first; real-data fine-tune is on top.
//
// Usage:
//   node oca-cognitive/scripts/train-mlp-pattern-head.js
//   node oca-cognitive/scripts/train-mlp-pattern-head.js --from-memory
//   node oca-cognitive/scripts/train-mlp-pattern-head.js --epochs 50

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildFeatures } from '../sensory/mlp-pattern-head.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const WEIGHTS = path.join(ROOT, 'private', 'mlp-pattern-head.json');
const FEEDBACK = path.join(ROOT, 'private', 'mlp-pattern-head.feedback.jsonl');

const args = process.argv.slice(2);
const fromMemory = args.includes('--from-memory');
const epochs = (() => {
  const i = args.indexOf('--epochs');
  return i >= 0 ? parseInt(args[i + 1], 10) : 30;
})();
const lr = 0.05;
const batchSize = 32;

const INPUT_DIM = 24;
const HIDDEN_DIM = 64;
const OUTPUT_DIM = 4;

// ─── synthetic dataset ─────────────────────────────────────────────────

function makeSynthetic(n) {
  const data = [];
  for (let i = 0; i < n; i++) {
    // Random scenario parameters.
    const hasRepeat = Math.random() < 0.3;
    const isStuck   = Math.random() < 0.15;
    const hasRecall = Math.random() < 0.2;
    const typingBurst = Math.random() < 0.25 ? 1 : 0;
    const meeting   = Math.random() < 0.1 ? 1 : 0;
    const fullscreen = Math.random() < 0.1 ? 1 : 0;

    const motorLog = [];
    if (hasRepeat) {
      const action = ['rename', 'click', 'type'][Math.floor(Math.random() * 3)];
      const n2 = 3 + Math.floor(Math.random() * 5);
      for (let k = 0; k < n2; k++) motorLog.push({ at: Date.now() - k * 30000, action, app: 'TestApp' });
    } else {
      const n2 = Math.floor(Math.random() * 3);
      for (let k = 0; k < n2; k++) {
        const action = ['rename', 'click', 'type', 'scroll', 'hotkey'][Math.floor(Math.random() * 5)];
        motorLog.push({ at: Date.now() - k * 60000, action, app: 'TestApp' });
      }
    }
    const features = buildFeatures({
      motorLog,
      emotion: { padcn: [Math.random() * 2 - 1, Math.random(), 0, Math.random(), 0] },
      typing_burst: typingBurst,
      in_meeting: meeting,
      fullscreen,
      episodic_hit_count: hasRecall ? 2 + Math.floor(Math.random() * 4) : Math.floor(Math.random() * 2),
      semantic_density: hasRecall ? 0.7 + Math.random() * 0.3 : Math.random() * 0.3,
      procedural_density: hasRepeat ? 0.6 + Math.random() * 0.4 : Math.random() * 0.4,
      recall_flag: hasRecall ? 1 : 0
    });

    // Labels — heuristic ground truth that the MLP should learn.
    const label = [
      hasRepeat ? 0.9 : 0.05,
      isStuck ? 0.9 : 0.05,
      hasRecall ? 0.9 : 0.05,
      (typingBurst ? 0.05 : (meeting ? 0.1 : (fullscreen ? 0.2 : 0.85)))
    ];
    data.push({ x: features, y: label });
  }
  return data;
}

// ─── memory-derived dataset (best-effort) ───────────────────────────────

function makeFromMemory() {
  if (!fs.existsSync(FEEDBACK)) {
    console.log('[train] no feedback log yet — using synthetic only');
    return [];
  }
  const lines = fs.readFileSync(FEEDBACK, 'utf8').split('\n').filter(Boolean);
  const out = [];
  for (const line of lines) {
    try {
      const rec = JSON.parse(line);
      if (!rec.features || !Array.isArray(rec.features) || rec.features.length !== INPUT_DIM) continue;
      // Feedback is { features, intent_kind, accepted, dismissed, ... }.
      // Fine-tune target: increase the kind's likelihood when accepted,
      // decrease when dismissed; interrupt_safe stays at observation.
      const target = [0.5, 0.5, 0.5, rec.interrupt_safe ?? 0.5];
      const idxByKind = { suggest_automation: 0, ask_clarification: 1, offer_recall: 2 };
      const i = idxByKind[rec.intent_kind];
      if (i !== undefined) target[i] = rec.accepted ? 0.9 : 0.05;
      out.push({ x: rec.features, y: target });
    } catch {}
  }
  console.log(`[train] memory dataset: ${out.length} rows`);
  return out;
}

// ─── network ────────────────────────────────────────────────────────────

function rand(scale = 0.1) { return (Math.random() - 0.5) * scale; }
function make2D(rows, cols, fill = () => rand(0.2 / Math.sqrt(cols))) {
  const M = new Array(rows);
  for (let i = 0; i < rows; i++) {
    M[i] = new Array(cols);
    for (let j = 0; j < cols; j++) M[i][j] = fill();
  }
  return M;
}

function init() {
  return {
    W1: make2D(HIDDEN_DIM, INPUT_DIM),
    b1: new Array(HIDDEN_DIM).fill(0),
    W2: make2D(OUTPUT_DIM, HIDDEN_DIM),
    b2: new Array(OUTPUT_DIM).fill(0)
  };
}

function relu(x) { return x > 0 ? x : 0; }
function reluGrad(x) { return x > 0 ? 1 : 0; }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

function matmulVec(M, v) {
  const out = new Array(M.length).fill(0);
  for (let i = 0; i < M.length; i++) {
    const r = M[i];
    let s = 0;
    for (let j = 0; j < v.length; j++) s += r[j] * v[j];
    out[i] = s;
  }
  return out;
}

function forward(net, x) {
  const z1 = new Array(HIDDEN_DIM);
  for (let i = 0; i < HIDDEN_DIM; i++) {
    let s = net.b1[i];
    const r = net.W1[i];
    for (let j = 0; j < INPUT_DIM; j++) s += r[j] * x[j];
    z1[i] = s;
  }
  const h = z1.map(relu);
  const z2 = new Array(OUTPUT_DIM);
  for (let i = 0; i < OUTPUT_DIM; i++) {
    let s = net.b2[i];
    const r = net.W2[i];
    for (let j = 0; j < HIDDEN_DIM; j++) s += r[j] * h[j];
    z2[i] = s;
  }
  const out = z2.map(sigmoid);
  return { z1, h, z2, out };
}

function trainStep(net, x, y) {
  const f = forward(net, x);
  // BCE loss + sigmoid: dL/dz2 = out - y
  const dz2 = f.out.map((o, i) => o - y[i]);
  // gradient W2, b2
  const dW2 = make2D(OUTPUT_DIM, HIDDEN_DIM, () => 0);
  const db2 = new Array(OUTPUT_DIM).fill(0);
  for (let i = 0; i < OUTPUT_DIM; i++) {
    db2[i] = dz2[i];
    for (let j = 0; j < HIDDEN_DIM; j++) dW2[i][j] = dz2[i] * f.h[j];
  }
  // dh = W2^T dz2
  const dh = new Array(HIDDEN_DIM).fill(0);
  for (let j = 0; j < HIDDEN_DIM; j++) {
    let s = 0;
    for (let i = 0; i < OUTPUT_DIM; i++) s += net.W2[i][j] * dz2[i];
    dh[j] = s;
  }
  // dz1 = dh * relu'(z1)
  const dz1 = dh.map((d, i) => d * reluGrad(f.z1[i]));
  const dW1 = make2D(HIDDEN_DIM, INPUT_DIM, () => 0);
  const db1 = new Array(HIDDEN_DIM).fill(0);
  for (let i = 0; i < HIDDEN_DIM; i++) {
    db1[i] = dz1[i];
    for (let j = 0; j < INPUT_DIM; j++) dW1[i][j] = dz1[i] * x[j];
  }
  // SGD update
  for (let i = 0; i < HIDDEN_DIM; i++) {
    net.b1[i] -= lr * db1[i];
    for (let j = 0; j < INPUT_DIM; j++) net.W1[i][j] -= lr * dW1[i][j];
  }
  for (let i = 0; i < OUTPUT_DIM; i++) {
    net.b2[i] -= lr * db2[i];
    for (let j = 0; j < HIDDEN_DIM; j++) net.W2[i][j] -= lr * dW2[i][j];
  }
  // BCE loss
  let loss = 0;
  for (let i = 0; i < OUTPUT_DIM; i++) {
    const o = Math.min(Math.max(f.out[i], 1e-6), 1 - 1e-6);
    loss += -(y[i] * Math.log(o) + (1 - y[i]) * Math.log(1 - o));
  }
  return loss / OUTPUT_DIM;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ─── run ────────────────────────────────────────────────────────────────

const synthetic = makeSynthetic(3000);
const memory = fromMemory ? makeFromMemory() : [];
const data = [...synthetic, ...memory];
console.log(`[train] dataset: ${data.length} rows (synthetic=${synthetic.length} memory=${memory.length})`);

const net = init();
for (let ep = 0; ep < epochs; ep++) {
  shuffle(data);
  let total = 0; let n = 0;
  for (const ex of data) {
    total += trainStep(net, ex.x, ex.y);
    n++;
  }
  if (ep === 0 || ep === epochs - 1 || ep % 5 === 4) {
    console.log(`[train] epoch ${ep + 1}/${epochs} · loss ${(total / n).toFixed(4)}`);
  }
}

fs.mkdirSync(path.dirname(WEIGHTS), { recursive: true });
fs.writeFileSync(WEIGHTS, JSON.stringify({
  trainedAt: new Date().toISOString(),
  rows: data.length,
  W1: net.W1, b1: net.b1, W2: net.W2, b2: net.b2
}));
console.log(`[train] weights → ${WEIGHTS}`);
