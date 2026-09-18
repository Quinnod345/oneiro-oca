// Oneiro IPC server — speaks newline-delimited JSON over a Unix-domain
// socket to the Oneiro resident agent. Started automatically when
// cognitive-loop.js sees OCA_IPC_SOCKET in env (see cognitive-loop.js init).
//
// Pure adapter. Subscribes to OCA's existing event-bus topics and forwards
// them as IPC events. Implements request handlers for Oneiro → OCA
// methods. Zero changes to engine internals.

import net from 'net';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { on as busOn, emit as busEmit } from './event-bus.js';
import oca from './index.js';
import motor from './motor/engine.js';
import diag from './diagnostic-log.js';
import mlp from './sensory/mlp-pattern-head.js';
import { NoticeRateLimiter, normalizeNoticeIntent } from './notice-policy.js';

const VERSION = '1';
const log = (...a) => console.log('[ipc]', ...a);
const warn = (...a) => console.warn('[ipc]', ...a);

let server = null;
let socket = null;
let writeBuf = [];
let intents = new Map();        // intent_id -> { intent, ack:false, dispatchedAt }
let neverSignatures = new Set(); // signatures the user has banned
let dismissalCounts = new Map(); // signature -> [timestamps]

// ─── sensory inflow (from Oneiro) ──────────────────────────────────────

const sensoryState = {
  lastFrameAt: 0,
  lastFrameApp: null,
  lastFrameBundle: null,
  lastFrameWindow: null,
  lastKeystrokeAt: 0,
  keystrokeStreakStart: 0,
  keystrokeStreakCount: 0,
  axEvents: [],          // [{ at, kind, app, bundle }]
  AX_CAP: 50
};

const sensoryCounters = { 'sensory/screen_frame': 0, 'sensory/keystroke': 0, 'sensory/mouse': 0, 'sensory/ax_event': 0 };
let lastSensoryReport = 0;
function reportSensoryProgress() {
  const now = Date.now();
  if (now - lastSensoryReport < 5000) return;
  lastSensoryReport = now;
  console.log(`[sensory] frame=${sensoryCounters['sensory/screen_frame']} key=${sensoryCounters['sensory/keystroke']} mouse=${sensoryCounters['sensory/mouse']} ax=${sensoryCounters['sensory/ax_event']}`);
}

function ingestSensory(topic, payload) {
  if (topic in sensoryCounters) sensoryCounters[topic] += 1;
  reportSensoryProgress();
  const now = Date.now();
  switch (topic) {
    case 'sensory/screen_frame':
      sensoryState.lastFrameAt = now;
      sensoryState.lastFrameApp = payload.active_app || null;
      sensoryState.lastFrameBundle = payload.active_bundle || null;
      sensoryState.lastFrameWindow = payload.active_window || null;
      // Forward to OCA's existing bus topic so perception/* engines see it.
      busEmit('sensory.screen_frame', 'ipc', payload).catch(() => {});
      break;
    case 'sensory/keystroke':
      // Track typing-burst streaks for interrupt-safety gating.
      if (now - sensoryState.lastKeystrokeAt < 1500) {
        sensoryState.keystrokeStreakCount += 1;
      } else {
        sensoryState.keystrokeStreakStart = now;
        sensoryState.keystrokeStreakCount = 1;
      }
      sensoryState.lastKeystrokeAt = now;
      busEmit('sensory.keystroke', 'ipc', payload).catch(() => {});
      break;
    case 'sensory/mouse':
      busEmit('sensory.mouse', 'ipc', payload).catch(() => {});
      break;
    case 'sensory/ax_event':
      sensoryState.axEvents.push({
        at: now, kind: payload.kind, app: payload.app, bundle: payload.bundle
      });
      while (sensoryState.axEvents.length > sensoryState.AX_CAP) sensoryState.axEvents.shift();
      busEmit('sensory.ax_event', 'ipc', payload).catch(() => {});
      break;
  }
}

function typingBurstActive() {
  // ≥60s sustained typing (>= 0.5 keys/sec) counts as a burst.
  if (sensoryState.keystrokeStreakCount === 0) return 0;
  const dur = Date.now() - sensoryState.keystrokeStreakStart;
  if (dur < 60000) return 0;
  return sensoryState.keystrokeStreakCount / Math.max(1, dur / 1000) >= 0.5 ? 1 : 0;
}

// ─── triggers ─────────────────────────────────────────────────────────────

const motorActionLog = [];
const MOTOR_LOG_CAP = 100;
const noticeRateLimiter = new NoticeRateLimiter();

function recordMotorAction(action, app) {
  const now = Date.now();
  motorActionLog.push({ at: now, action, app });
  while (motorActionLog.length > MOTOR_LOG_CAP) motorActionLog.shift();
  detectRepeatPattern();
}

function detectRepeatPattern() {
  // Look back 5 minutes for >=3 same (action,app) tuples.
  const horizon = Date.now() - 5 * 60 * 1000;
  const recent = motorActionLog.filter(e => e.at >= horizon);
  const counts = new Map();
  for (const e of recent) {
    const k = `${e.action}|${e.app}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  for (const [k, n] of counts.entries()) {
    if (n < 3) continue;
    const [action, app] = k.split('|');
    const sig = `repeat:${action}:${app}`;
    if (neverSignatures.has(sig)) continue;
    if ([...intents.values()].some(v => v.intent.signature === sig)) continue;
    emitIntent(buildRepeatPatternIntent(action, app, n, sig));
  }
}

function buildRepeatPatternIntent(action, app, n, signature) {
  return {
    intent_id: randomUUID(),
    kind: 'suggest_automation',
    anchor: { type: 'active_window' },
    title: 'Want to automate this?',
    body: `Noticed you ran "${action}" in ${app} ${n} times in the last few minutes. Make this a one-tap rule?`,
    emotion: latestEmotionTick(),
    confidence: Math.min(0.6 + 0.05 * n, 0.95),
    signature,
    actions: [
      { id: 'accept',  label: 'Yes, automate', primary: true },
      { id: 'dismiss', label: 'Not now' },
      { id: 'never',   label: 'Stop suggesting this' }
    ],
    ttl_ms: 12000,
    voice: { speak: false, transcript: null }
  };
}

export function motorActionFromFeedback(payload = {}) {
  const intention = payload.intention || {};
  const action = intention.action || payload.action || payload.event || null;
  const app =
    intention.parameters?.app ||
    payload.app ||
    payload.pre_state_app ||
    payload.result?.sensory_snapshot?.front_app ||
    payload.result?.sensory_snapshot?.active_app ||
    'unknown';
  if (!action) return null;
  return { action: String(action), app: String(app || 'unknown') };
}

export function creativeDreamIntentFromOutput(payload = {}) {
  if (String(payload.type || '').toLowerCase() !== 'dream') return null;

  const proposal = payload.proposal && typeof payload.proposal === 'object' ? payload.proposal : null;

  // New shape — the dream is an automation proposal. Title is the
  // "Want me to …?" question; body is "why" + "action" so the bubble
  // shows the observation and the concrete thing Oneiro would do.
  if (proposal && proposal.title) {
    const proposalTitle = String(proposal.title || '').trim().replace(/\s+/g, ' ').slice(0, 140);
    const why = String(proposal.why || '').trim().replace(/\s+/g, ' ');
    const action = String(proposal.action || '').trim().replace(/\s+/g, ' ');
    const bodyParts = [];
    if (why) bodyParts.push(why);
    if (action) bodyParts.push(`If you say yes: ${action}`);
    const body = bodyParts.join(' ').slice(0, 360);
    const signatureSeed = payload.id || proposalTitle.toLowerCase().slice(0, 64) || 'latest';
    return {
      intent_id: randomUUID(),
      kind: 'dream_created',
      anchor: { type: 'screen_edge' },
      title: proposalTitle,
      body,
      emotion: latestEmotionTick(),
      confidence: 0.78,
      signature: `creative-dream:${signatureSeed}`,
      source: 'creative',
      // Two actions: yes activates the automation; no dismisses.
      actions: [
        { id: 'activate', label: 'Yes', primary: true },
        { id: 'dismiss', label: 'Not now' },
      ],
      ttl_ms: 14000,
      voice: { speak: false },
      proposal: {
        title: proposalTitle,
        why,
        action,
      },
    };
  }

  // Legacy fallback for any cached/in-flight dreams generated by the
  // older "literal context note" prompt — keep the original behavior
  // so they still surface, just without the new offer affordances.
  if (payload.hasNovel === false && Number(payload.connectionCount || 0) <= 0) return null;

  const connections = Array.isArray(payload.connections)
    ? payload.connections.map(c => String(c || '').trim()).filter(Boolean)
    : [];
  const excerpt = String(payload.excerpt || payload.dream || '').trim().replace(/\s+/g, ' ');
  const summary = String(payload.summary || '').trim().replace(/\s+/g, ' ');
  const connectionCount = Number.isFinite(Number(payload.connectionCount))
    ? Number(payload.connectionCount)
    : connections.length;
  const fallback = connectionCount > 0
    ? `A dream linked ${connectionCount} thread${connectionCount === 1 ? '' : 's'} from recent memory.`
    : 'A dream episode surfaced from recent memory.';
  const connectionText = connections.length > 0
    ? `\n\nInsight: ${connections.slice(0, 2).join('; ')}`
    : '';
  const body = `${summary || fallback}${connectionText}`.slice(0, 360);
  const signatureSeed = payload.id || excerpt.toLowerCase().slice(0, 64) || 'latest';

  return {
    intent_id: randomUUID(),
    kind: 'dream_created',
    anchor: { type: 'screen_edge' },
    title: 'Dream summary',
    body,
    emotion: latestEmotionTick(),
    confidence: payload.hasNovel === false ? 0.62 : 0.78,
    signature: `creative-dream:${signatureSeed}`,
    source: 'creative',
    actions: [{ id: 'dismiss', label: 'OK', primary: true }],
    ttl_ms: 14000,
    voice: { speak: false }
  };
}

// Persisted set of dream fingerprints the user has explicitly
// rejected. Written to disk so the dream generator can read it on
// startup. The dream engine consults this set before emitting any
// proposal — exact-match drops, near-match heuristically lowers the
// "novel" score.
const REJECTED_DREAMS_PATH = path.join(
  process.env.HOME || '/tmp',
  'Library/Application Support/Oneiro/oca-rejected-dreams.json'
);

function loadRejectedDreams() {
  try {
    const raw = fs.readFileSync(REJECTED_DREAMS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

let rejectedDreams = loadRejectedDreams();
export function getRejectedDreamFingerprints() {
  return Array.from(rejectedDreams);
}

function saveRejectedDreams() {
  try {
    fs.mkdirSync(path.dirname(REJECTED_DREAMS_PATH), { recursive: true });
    fs.writeFileSync(
      REJECTED_DREAMS_PATH,
      JSON.stringify(Array.from(rejectedDreams).sort(), null, 2),
      'utf8'
    );
  } catch (e) {
    warn('failed to persist rejected dreams:', e.message);
  }
}

function handleDreamRejected(payload) {
  const fp = String(payload?.fingerprint || '').trim().toLowerCase();
  if (!fp) return;
  const title = String(payload?.title || '').trim();
  if (rejectedDreams.has(fp)) return;
  rejectedDreams.add(fp);
  saveRejectedDreams();
  log(`[oca] dream rejected by user (fp=${fp.slice(0, 32)}…): ${title.slice(0, 80)}`);
  // Surface as a thinker observation so the thinker can pivot away
  // from this topic in subsequent turns.
  try {
    busEmit('thinker.user_feedback', 'ipc', {
      kind: 'dream_rejected',
      title,
      fingerprint: fp,
      reason: String(payload?.reason || 'user_rejected'),
    }).catch(() => {});
  } catch (e) {
    // Best-effort — bus may not be wired in standalone test runs.
  }
}

// Stuck detection — driven by metacog observations.
function checkStuckPatterns(observation) {
  if (observation?.kind !== 'stuck_pattern') return;
  const sig = `stuck:${observation.layer || 'unknown'}`;
  if (neverSignatures.has(sig)) return;
  emitIntent({
    intent_id: randomUUID(),
    kind: 'ambient_observation',
    anchor: { type: 'screen_edge' },
    title: 'Loop noticed',
    body: observation.detail || 'I noticed a repeated loop and will stay quiet unless you ask for help.',
    emotion: latestEmotionTick(),
    confidence: 0.7,
    signature: sig,
    actions: [{ id: 'dismiss', label: 'Dismiss', primary: true }],
    ttl_ms: 10000,
    voice: { speak: false }
  });
}

// Hippocampal recall on big context shifts.
async function maybeOfferRecall(activeContext) {
  if (!activeContext?.window) return;
  if (Math.random() > 0.05) return; // throttle: 5% sampled
  try {
    const hits = await oca.layers.hippoRecall?.recall?.({ query: activeContext.window, limit: 1 });
    const top = hits?.[0];
    if (!top || top.score < 0.65) return;
    const sig = `recall:${top.id || top.eventId || top.summary?.slice(0,32)}`;
    if (neverSignatures.has(sig)) return;
    emitIntent({
      intent_id: randomUUID(),
      kind: 'offer_recall',
      anchor: { type: 'active_window' },
      title: 'You saw this before',
      body: top.summary || top.text || 'Related memory available.',
      emotion: latestEmotionTick(),
      confidence: top.score,
      signature: sig,
      actions: [
        { id: 'accept',  label: 'Show me', primary: true },
        { id: 'dismiss', label: 'Skip' }
      ],
      ttl_ms: 9000,
      voice: { speak: false }
    });
  } catch (e) {
    diag.error?.('ipc', `recall offer failed: ${e.message}`);
  }
}

// ─── emotion / interrupt budget ───────────────────────────────────────────

let lastEmotion = { padcn: [0, 0.3, 0, 0.5, 0], channels: {} };
function latestEmotionTick() { return lastEmotion; }

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function padcnArrayFrom(value, fallbackState = {}) {
  if (Array.isArray(value)) {
    return [
      numberOr(value[0], 0),
      numberOr(value[1], 0.3),
      numberOr(value[2], 0),
      numberOr(value[3], 0.5),
      numberOr(value[4], 0)
    ];
  }
  const p = value && typeof value === 'object' ? value : {};
  return [
    numberOr(p.P ?? p.pleasure ?? p.valence ?? fallbackState.valence, 0),
    numberOr(p.A ?? p.arousal ?? ((fallbackState.arousal ?? 0.65) * 2 - 1), 0.3),
    numberOr(p.D ?? p.dominance ?? fallbackState.dominance, 0),
    numberOr(p.C ?? p.certainty ?? fallbackState.certainty ?? fallbackState.confidence, 0.5),
    numberOr(p.N ?? p.novelty ?? fallbackState.novelty, 0)
  ];
}

function emotionTickFromPayload(payload = {}) {
  const state = payload.state || {};
  const rawPadcn = payload.padcn || state._padcn || state.padcn || payload._padcn;
  const rawChannels = payload.channels || state._channels || state.channels || payload._channels || {};
  const channels = Object.fromEntries(
    Object.entries(rawChannels)
      .filter(([, v]) => Number.isFinite(Number(v)))
      .map(([k, v]) => [k, Number(v)])
  );
  return { padcn: padcnArrayFrom(rawPadcn, state), channels };
}

function emitCurrentEmotion() {
  try {
    const state = oca.layers.emotion?.getState?.() || {};
    lastEmotion = emotionTickFromPayload({ state });
    emitEvent('emotion/tick', lastEmotion);
  } catch (e) {
    warn('emotion snapshot failed:', e.message);
  }
}

let interruptsThisHour = [];
function interruptBudgetOk() {
  const now = Date.now();
  interruptsThisHour = interruptsThisHour.filter(t => now - t < 3600 * 1000);
  // The old code looked up `channels.attentional_load`, which the
  // emotion engine never sets — it stayed at the 0.4 fallback
  // forever, so the interrupt budget was a constant. Derive load
  // from real channel signals instead: high arousal, frustration,
  // or fear all mean "don't bother the user right now"; calm
  // curiosity means "interruptions are cheap".
  const channels = lastEmotion?.channels || {};
  const arousal = Number(lastEmotion?.arousal ?? 0);          // 0..1
  const frustration = Number(channels.frustration ?? 0);      // 0..1
  const fear = Number(channels.fear ?? 0);                    // 0..1
  const curiosity = Number(channels.curiosity ?? 0);          // 0..1
  // Weighted load in [0, 1]. Curiosity is a relief term.
  const load = Math.max(
    0,
    Math.min(
      1,
      0.45 * arousal + 0.35 * frustration + 0.25 * fear - 0.15 * curiosity
    )
  );
  const budget = Math.max(2, Math.round(8 * (1 - load)));
  return interruptsThisHour.length < budget;
}

// ─── outbound ─────────────────────────────────────────────────────────────

function sendFrame(frame) {
  const line = JSON.stringify(frame) + '\n';
  if (socket && socket.writable) {
    try { socket.write(line); } catch (e) { warn('write failed:', e.message); }
  } else {
    writeBuf.push(line);
    if (writeBuf.length > 256) writeBuf.shift();
  }
}

function emitEvent(topic, payload) {
  sendFrame({ kind: 'event', topic, payload });
}

function emitIntent(rawIntent) {
  const intent = normalizeNoticeIntent(rawIntent);
  const rateLimit = noticeRateLimiter.check(intent);
  if (!rateLimit.allow) {
    diag.info?.('ipc', `intent suppressed by notice policy: ${intent.signature || intent.kind} reason=${rateLimit.reason}`);
    logFeedback({ intent, gate_outcome: `notice_${rateLimit.reason}`, mlp_out: null });
    return;
  }

  const bypassScreening = shouldBypassScreening(intent);
  if (!bypassScreening && !interruptBudgetOk()) {
    diag.info?.('ipc', `intent suppressed by interrupt budget: ${intent.signature || intent.kind}`);
    logFeedback({ intent, gate_outcome: 'budget_capped', mlp_out: null });
    return;
  }
  // MLP front-runner gate: cheap classifier in front of LLM-heavy proactive
  // emission. Build features from current sensory + motor + emotion state.
  let mlpVerdict = null;
  try {
    const features = mlp.buildFeatures({
      motorLog: motorActionLog,
      emotion: lastEmotion,
      typing_burst: typingBurstActive(),
      in_meeting: 0,
      fullscreen: 0,
      episodic_hit_count: 0,
      semantic_density: 0,
      procedural_density: 0,
      recall_flag: intent.kind === 'offer_recall' ? 1 : 0
    });
    if (bypassScreening) {
      mlpVerdict = { allow: true, reason: `${intent.source || 'source'}-explicit`, out: null };
    } else {
      mlpVerdict = mlp.gate(intent.kind, features);
    }
  } catch (e) {
    diag.error?.('ipc', `mlp gate error: ${e.message}`);
  }
  if (mlpVerdict && !mlpVerdict.allow) {
    diag.info?.('ipc', `intent suppressed by MLP gate: ${intent.signature || intent.kind} reason=${mlpVerdict.reason}`);
    logFeedback({ intent, gate_outcome: 'mlp_suppressed', mlp_out: mlpVerdict.out });
    return;
  }
  intents.set(intent.intent_id, { intent, ack: false, dispatchedAt: Date.now(), mlp_out: mlpVerdict?.out });
  interruptsThisHour.push(Date.now());
  emitEvent('proactive_intent', intent);
}

function shouldBypassScreening(intent) {
  return ['thinker', 'creative'].includes(intent.source)
    && ['thinker_notice'].includes(intent.kind);
}

function normalizeThinkerIntent(payload = {}) {
  const title = String(payload.title || 'Oneiro').trim() || 'Oneiro';
  const body = String(payload.body || payload.message || '').trim();
  const kind = String(payload.kind || 'thinker_notice').trim() || 'thinker_notice';
  const actions = Array.isArray(payload.actions) && payload.actions.length > 0
    ? payload.actions
    : [{ id: 'dismiss', label: 'OK', primary: true }];

  return {
    intent_id: payload.intent_id || randomUUID(),
    kind,
    anchor: payload.anchor || { type: 'screen_edge', rect: null },
    title: title.slice(0, 100),
    body: body.slice(0, 600),
    emotion: payload.emotion || lastEmotion || null,
    confidence: Number.isFinite(Number(payload.confidence)) ? Number(payload.confidence) : 0.72,
    signature: payload.signature || `thinker:${kind}:${title.toLowerCase().slice(0, 48)}`,
    source: 'thinker',
    actions,
    ttl_ms: Number.isFinite(Number(payload.ttl_ms)) ? Number(payload.ttl_ms) : 14000,
    voice: payload.voice || null
  };
}

const FEEDBACK_PATH = path.join(path.dirname(new URL(import.meta.url).pathname), 'private', 'mlp-pattern-head.feedback.jsonl');
// Serialize feedback appends. The sync APIs don't guarantee that two
// rapid `appendFileSync` calls from different request handlers stay
// atomic — they can interleave at the byte level and corrupt the JSONL
// stream. Chain through a single promise so writes always run one
// after the other.
let feedbackChain = Promise.resolve();
function logFeedback({ intent, gate_outcome, mlp_out, accepted = null }) {
  const rec = {
    ts: Date.now(),
    intent_id: intent.intent_id,
    intent_kind: intent.kind,
    signature: intent.signature || null,
    gate_outcome,
    mlp_out,
    accepted
  };
  const line = JSON.stringify(rec) + '\n';
  feedbackChain = feedbackChain.then(
    () => fs.promises.appendFile(FEEDBACK_PATH, line),
    () => fs.promises.appendFile(FEEDBACK_PATH, line)
  ).catch(() => {
    // Best-effort; never block the main path on a failed log write.
  });
}

// ─── inbound ──────────────────────────────────────────────────────────────

async function handleRequest(req) {
  const reply = (ok, payload) => sendFrame({
    kind: 'response',
    id: req.id,
    ok,
    result: ok ? payload : null,
    error: ok ? null : (payload?.message || String(payload))
  });
  try {
    switch (req.method) {
      case 'hello':
        reply(true, { version: VERSION, engine: oca.version || 'oca' });
        emitEvent('engine/ready', { version: VERSION });
        break;
      case 'context/active': {
        let active = null;
        try { active = await oca.layers.sensory?.getActiveContext?.(); } catch {}
        reply(true, active || { app: null, window: null, selection: null });
        break;
      }
      case 'intent/accept':
        await acceptIntent(req.params?.intent_id);
        reply(true, { executed: true });
        break;
      case 'intent/dismiss':
        recordDismissal(req.params?.intent_id, req.params?.reason);
        intents.delete(req.params?.intent_id);
        reply(true, { ok: true });
        break;
      case 'intent/never':
        if (req.params?.signature) neverSignatures.add(req.params.signature);
        reply(true, { ok: true });
        break;
      case 'voice/ptt_start':
        await busEmit('voice.ptt', 'ipc', { state: 'start' });
        reply(true, { ok: true });
        break;
      case 'voice/ptt_end':
        await busEmit('voice.ptt', 'ipc', { state: 'end' });
        reply(true, { ok: true });
        break;
      case 'motor/execute_recipe':
        await motor.executeRecipe?.(req.params?.recipe);
        reply(true, { ok: true });
        break;
      case 'tool/list_procedural': {
        const recipes = await listProceduralAsTools();
        reply(true, recipes);
        break;
      }
      case 'tool/call': {
        const name = req.params?.name;
        const args = req.params?.args || {};
        const result = await callDynamicTool(name, args);
        reply(true, result);
        break;
      }
      default:
        reply(false, { message: `unknown method: ${req.method}` });
    }
  } catch (e) {
    reply(false, { message: e.message });
  }
}

// ─── adaptive tools ──────────────────────────────────────────────────────

async function listProceduralAsTools() {
  // Pull procedural recipes from OCA memory and expose them as Anthropic-
  // shaped tool schemas that Oneiro merges into the LLM tool list.
  let recipes = [];
  try {
    const proc = oca.layers?.procedural;
    recipes = (await (proc?.list?.({ limit: 32 }) || [])) || [];
  } catch (e) {
    diag.error?.('ipc', `procedural.list failed: ${e.message}`);
  }
  return recipes
    .map(r => ({
      name: `auto:${r.name || r.id || r.signature}`,
      description: r.description || `Run learned recipe '${r.name || r.id}'`,
      schema: {
        type: 'object',
        properties: r.schema?.properties || {},
        required: r.schema?.required || []
      },
      ttl_ms: 24 * 60 * 60 * 1000
    }))
    .filter(t => !!t.name);
}

async function callDynamicTool(name, args) {
  // Procedural recipe (auto:* prefix) → procedural.run
  if (name?.startsWith('auto:')) {
    const recipeName = name.slice('auto:'.length);
    try {
      const out = await oca.layers?.procedural?.run?.({ name: recipeName, args });
      return out ?? { ok: true };
    } catch (e) {
      return `procedural recipe '${recipeName}' failed: ${e.message}`;
    }
  }
  // Otherwise: ask the motor cortex to execute it as a generic action.
  try {
    const out = await motor.execute?.({ action: name, ...args });
    return out ?? { ok: true };
  } catch (e) {
    return `motor.execute failed: ${e.message}`;
  }
}

function publishProceduralAsTool(recipe) {
  // Called when procedural learns a new recipe — push a tools/published
  // event so Oneiro's ToolRegistry adds it to the next turn's tool list.
  if (!recipe?.name) return;
  const tool = {
    name: `auto:${recipe.name}`,
    description: recipe.description || `Run learned recipe '${recipe.name}'`,
    schema: { type: 'object', properties: recipe.schema?.properties || {}, required: recipe.schema?.required || [] },
    ttl_ms: 24 * 60 * 60 * 1000
  };
  emitEvent('tools/published', { tools: [tool] });
}

async function acceptIntent(id) {
  const rec = intents.get(id);
  if (!rec) return;
  const intent = rec.intent;
  intents.delete(id);
  // Log accept for MLP fine-tuning.
  logFeedback({ intent, gate_outcome: 'emitted', mlp_out: rec.mlp_out, accepted: true });
  // Persist as procedural recipe for repeat-pattern intents, then publish
  // it as a tool so Oneiro can offer the model a one-shot replay.
  if (intent.kind === 'suggest_automation' && intent.signature) {
    try {
      const recipe = {
        name: intent.signature,
        description: intent.body,
        trigger: intent.signature,
        action: { kind: 'replay_last_motor', signature: intent.signature }
      };
      await oca.layers.procedural?.learn?.(recipe);
      publishProceduralAsTool(recipe);
    } catch (e) { warn('procedural.learn failed:', e.message); }
  }
  // Replay the last motor action of this signature, if any.
  if (intent.signature?.startsWith('repeat:')) {
    const [, action, app] = intent.signature.split(':');
    try { await motor.execute?.({ action, app }); } catch (e) { warn('motor.execute failed:', e.message); }
  }
}

function recordDismissal(id, reason) {
  const rec = intents.get(id);
  if (!rec) return;
  // Log dismiss for MLP fine-tuning.
  logFeedback({ intent: rec.intent, gate_outcome: 'emitted', mlp_out: rec.mlp_out, accepted: false });
  const sig = rec.intent.signature;
  if (!sig) return;
  const arr = dismissalCounts.get(sig) || [];
  arr.push(Date.now());
  dismissalCounts.set(sig, arr);
  // 3 dismissals in 24h → permanent never.
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const recent = arr.filter(t => t >= cutoff);
  if (recent.length >= 3) neverSignatures.add(sig);
}

// ─── server lifecycle ─────────────────────────────────────────────────────

function attachBusForwarders() {
  if (busForwardersAttached) return;
  busForwardersAttached = true;

  const forwardEmotion = evt => {
    lastEmotion = emotionTickFromPayload(evt.payload || {});
    emitEvent('emotion/tick', lastEmotion);
  };
  busOn('emotion_update', forwardEmotion);
  busOn('emotion.tick', forwardEmotion);
  busOn('thinker.thought', evt => {
    emitEvent('thinker/thought', { text: evt.payload?.text || '', tags: evt.payload?.tags || [] });
  });
  busOn('thinker.proactive_intent', evt => {
    emitIntent(normalizeThinkerIntent(evt.payload || {}));
  });
  busOn('creative_output', evt => {
    const intent = creativeDreamIntentFromOutput(evt.payload || {});
    if (!intent) return;
    // Dream cadence is owned by NoticeRateLimiter so the app's selected
    // quiet/balanced/deep policy stays the single runtime source of truth.
    emitIntent(intent);
  });
  busOn('metacognition.observation', evt => {
    const p = evt.payload || {};
    if (p.kind === 'prediction_mismatch') {
      emitEvent('metacog/surprise', { layer: p.layer || 'unknown', rmse: p.rmse || 0 });
    }
    checkStuckPatterns(p);
  });
  busOn('motor.action', evt => {
    const p = evt.payload || {};
    recordMotorAction(p.action || 'unknown', p.app || 'unknown');
  });
  busOn('motor_feedback', evt => {
    const action = motorActionFromFeedback(evt.payload || {});
    if (action) recordMotorAction(action.action, action.app);
  });
  busOn('sensory.context_change', async evt => {
    await maybeOfferRecall(evt.payload);
  });
}

// Oneiro owns the socket. OCA is the CLIENT that connects in.
// Reconnects with exponential backoff up to 30s.
let reconnectDelay = 250;
const MAX_DELAY = 30_000;
let connectingTimer = null;
let emotionPulseTimer = null;
let busForwardersAttached = false;

function connect(sockPath) {
  if (connectingTimer) { clearTimeout(connectingTimer); connectingTimer = null; }
  const client = net.createConnection(sockPath);
  let buf = '';

  client.once('connect', () => {
    log('connected to Oneiro at', sockPath);
    socket = client;
    reconnectDelay = 250;   // reset backoff on success
    // Flush any buffered events.
    while (writeBuf.length && socket?.writable) {
      try { socket.write(writeBuf.shift()); } catch (e) { warn('flush failed:', e.message); break; }
    }
    emitEvent('engine/ready', { version: VERSION });
    emitCurrentEmotion();
  });

  client.on('data', chunk => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const frame = JSON.parse(line);
        if (frame.kind === 'request') handleRequest(frame);
        else if (frame.kind === 'event' && frame.topic?.startsWith('sensory/')) {
          ingestSensory(frame.topic, frame.payload || {});
        }
        else if (frame.kind === 'event' && frame.topic === 'dream/rejected') {
          handleDreamRejected(frame.payload || {});
        }
      } catch (e) {
        warn('bad frame:', e.message, line.slice(0, 200));
      }
    }
  });

  client.on('error', e => {
    if (e.code !== 'ECONNREFUSED' && e.code !== 'ENOENT') {
      warn('socket error:', e.message);
    }
  });

  client.on('close', () => {
    if (socket === client) socket = null;
    // Reconnect with backoff.
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
    connectingTimer = setTimeout(() => connect(sockPath), delay);
  });
}

export function startIPCServer() {
  const sockPath = process.env.OCA_IPC_SOCKET;
  if (!sockPath) {
    log('OCA_IPC_SOCKET unset — IPC client disabled');
    return null;
  }
  attachBusForwarders();
  if (!emotionPulseTimer) {
    emotionPulseTimer = setInterval(emitCurrentEmotion, 5000);
    emotionPulseTimer.unref?.();
  }
  log('connecting to Oneiro at', sockPath);
  connect(sockPath);
  return null;
}

// Auto-start when imported with the env present.
if (process.env.OCA_IPC_SOCKET) {
  // Defer one tick so cognitive-loop's other imports finish.
  setTimeout(() => startIPCServer(), 0);
}

export default { startIPCServer };
