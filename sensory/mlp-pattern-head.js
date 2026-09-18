// Oneiro pattern-detection MLP head.
//
// Sits in front of the LLM-heavy `proactive_intent` path and decides — for
// each candidate trigger that the rule-based detectors find — whether the
// agent should actually *bother the user* now. Cheap (µs/call), runs
// in-process, gates the intent emitters in ipc-server.js.
//
// Inputs (per-tick context vector, 24-d):
//   [0..7]   recent-action one-hot bag — counts of (rename, click, type,
//            scroll, hotkey, switch_app, copy, paste) over the last 5 min,
//            normalized to [0,1].
//   [8..11]  emotion PADCN minus pleasure (4-d).
//   [12..14] interrupt-context — typing_burst (1 if ≥60s sustained),
//            in_meeting (zoom/teams frontmost), fullscreen (NSScreen.main
//            in fullscreen mode).
//   [15..18] time-of-day sin/cos + day-of-week sin/cos.
//   [19..22] memory-context — count of related episodic hits, semantic
//            density (0..1), procedural-recipe density (0..1), recall-
//            opportunity-flag.
//   [23]    bias term (always 1).
//
// Outputs (4-d):
//   [0] repeat_pattern_likelihood
//   [1] stuck_likelihood
//   [2] recall_opportunity_likelihood
//   [3] interrupt_safe       (1 = safe to surface a panel right now)
//
// Architecture: 24 → 64 → 4, ReLU + sigmoid output. Pure JS — no MLX
// dependency on the inference path so it runs anywhere Node runs.
// Training script (`scripts/train-mlp-pattern-head.js`) writes weights
// to `oca-cognitive/private/mlp-pattern-head.json`.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEIGHTS_PATH = path.join(__dirname, '..', 'private', 'mlp-pattern-head.json');

const INPUT_DIM = 24;
const HIDDEN_DIM = 64;
const OUTPUT_DIM = 4;

// ─── weights ────────────────────────────────────────────────────────────
let W1, b1, W2, b2;

/** Lazily load weights. If absent, initialize with a hand-crafted bias
 *  set that's slightly conservative — the MLP defaults to "interrupt
 *  safe = 0.5, repeat-pattern likelihood gated to recent-action density"
 *  so the system is usable before a real training run.
 */
function ensureWeights() {
  if (W1) return;
  if (fs.existsSync(WEIGHTS_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(WEIGHTS_PATH, 'utf8'));
      W1 = raw.W1; b1 = raw.b1; W2 = raw.W2; b2 = raw.b2;
      if (!Array.isArray(W1) || W1.length !== HIDDEN_DIM ||
          !Array.isArray(W1[0]) || W1[0].length !== INPUT_DIM) {
        throw new Error('weight shape mismatch');
      }
      return;
    } catch (e) {
      console.warn('[mlp-pattern-head] weights load failed:', e.message, '- falling back to bootstrap weights');
    }
  }
  // Bootstrap: small random + targeted bias so the head is non-degenerate
  // before any real training.
  W1 = make2D(HIDDEN_DIM, INPUT_DIM, () => (Math.random() - 0.5) * 0.1);
  b1 = new Array(HIDDEN_DIM).fill(0).map(() => (Math.random() - 0.5) * 0.05);
  W2 = make2D(OUTPUT_DIM, HIDDEN_DIM, () => (Math.random() - 0.5) * 0.1);
  // Initialize the output bias for "interrupt_safe" (idx 3) at 0 (sigmoid(0) = 0.5).
  // Other outputs start near 0 so they only fire when input drives them.
  b2 = [0, 0, 0, 0];
}

function make2D(rows, cols, fill) {
  const M = new Array(rows);
  for (let i = 0; i < rows; i++) {
    M[i] = new Array(cols);
    for (let j = 0; j < cols; j++) M[i][j] = typeof fill === 'function' ? fill(i, j) : fill;
  }
  return M;
}

function relu(x) { return x > 0 ? x : 0; }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

function matmul(M, v) {
  const out = new Array(M.length);
  for (let i = 0; i < M.length; i++) {
    let s = 0;
    const row = M[i];
    for (let j = 0; j < v.length; j++) s += row[j] * v[j];
    out[i] = s;
  }
  return out;
}

function vadd(a, b) { return a.map((v, i) => v + b[i]); }

// ─── inference ──────────────────────────────────────────────────────────

export function infer(featureVector) {
  ensureWeights();
  if (featureVector.length !== INPUT_DIM) {
    throw new Error(`feature dim ${featureVector.length} != ${INPUT_DIM}`);
  }
  const h = vadd(matmul(W1, featureVector), b1).map(relu);
  const z = vadd(matmul(W2, h), b2);
  return {
    repeat_pattern_likelihood: sigmoid(z[0]),
    stuck_likelihood: sigmoid(z[1]),
    recall_opportunity_likelihood: sigmoid(z[2]),
    interrupt_safe: sigmoid(z[3])
  };
}

// ─── feature builder ────────────────────────────────────────────────────

const ACTION_KEYS = ['rename', 'click', 'type', 'scroll', 'hotkey', 'switch_app', 'copy', 'paste'];

/**
 * Compose the 24-d context vector from rolling state. Inputs are loose to
 * avoid coupling to the exact data sources — the caller passes whatever
 * snapshot is at hand and we fill missing slots with 0.
 */
export function buildFeatures({
  motorLog = [],          // [{ at, action, app }]
  emotion = { padcn: [0, 0.3, 0, 0.5, 0] },
  typing_burst = 0,        // 0..1
  in_meeting = 0,          // 0|1
  fullscreen = 0,          // 0|1
  episodic_hit_count = 0,
  semantic_density = 0,
  procedural_density = 0,
  recall_flag = 0,
  now = Date.now()
} = {}) {
  const horizonMs = 5 * 60 * 1000;
  const recent = motorLog.filter(e => now - e.at <= horizonMs);
  const counts = ACTION_KEYS.map(k => 0);
  for (const e of recent) {
    const idx = ACTION_KEYS.indexOf(e.action);
    if (idx >= 0) counts[idx] += 1;
  }
  const norm = counts.map(c => Math.tanh(c / 5));   // saturate at ~5 actions

  const padcn = emotion.padcn || [0, 0.3, 0, 0.5, 0];
  const emoBlock = [padcn[1] || 0, padcn[2] || 0, padcn[3] || 0, padcn[4] || 0];

  const dt = new Date(now);
  const minOfDay = dt.getHours() * 60 + dt.getMinutes();
  const todSin = Math.sin(2 * Math.PI * minOfDay / 1440);
  const todCos = Math.cos(2 * Math.PI * minOfDay / 1440);
  const dow = dt.getDay();
  const dowSin = Math.sin(2 * Math.PI * dow / 7);
  const dowCos = Math.cos(2 * Math.PI * dow / 7);

  return [
    ...norm,                                    // 8
    ...emoBlock,                                // 4
    typing_burst, in_meeting, fullscreen,       // 3
    todSin, todCos, dowSin, dowCos,             // 4
    episodic_hit_count > 0 ? Math.tanh(episodic_hit_count / 4) : 0,
    semantic_density,
    procedural_density,
    recall_flag,                                // 4
    1                                           // 1
  ];
}

// ─── gate ────────────────────────────────────────────────────────────────

/** Returns true if the proposed intent should be emitted now. */
export function gate(intentKind, features, thresholds = {}) {
  const t = {
    repeat: 0.55,
    stuck: 0.55,
    recall: 0.50,
    interrupt: 0.45,
    ...thresholds
  };
  const out = infer(features);
  if (out.interrupt_safe < t.interrupt) return { allow: false, reason: 'unsafe', out };
  switch (intentKind) {
    case 'suggest_automation':
      return { allow: out.repeat_pattern_likelihood >= t.repeat, reason: 'repeat-MLP', out };
    case 'ask_clarification':
      return { allow: out.stuck_likelihood >= t.stuck, reason: 'stuck-MLP', out };
    case 'offer_recall':
      return { allow: out.recall_opportunity_likelihood >= t.recall, reason: 'recall-MLP', out };
    default:
      return { allow: true, reason: 'no-gate', out };
  }
}

export default { infer, buildFeatures, gate };
