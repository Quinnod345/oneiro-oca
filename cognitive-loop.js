#!/usr/bin/env node
import { runPendingPonder } from './reasoning/ponder-service.js';
// OCA Cognitive Loop — the continuous thinking process
// Main OCA entry: grounded, hypothesis-driven cognition + HTTP API on :3333
// Also bootstraps the HTTP API (port 3333) — this IS the sole primary process.
import { pool, emit, on } from './event-bus.js';
import oca from './index.js';
import prospective from './memory/prospective.js';
import swiftSensory from './sensory/swift-bridge.js';
import sensory from './sensory/perception.js';
import visualMemory from './sensory/screenshot-indexer.js';
import benchmarkHarness from './evaluation/benchmark-harness.js';
import thinkerBridge from './thinker-bridge.js';
import neuralBus from './neural-bus.js';
import neuralMLP from './neural-mlp.js';
import encoders from './neural-encoders.js';
import { getUserActivity } from './sensory/fallback-reader.js';
import { acquireProcessLock, releaseProcessLock } from '../runtime/workspace/oneiro-core/process-lock.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import diag from './diagnostic-log.js';
// Oneiro IPC adapter — auto-starts iff OCA_IPC_SOCKET is set in env.
import './ipc-server.js';

// Intercept console.error so ALL errors flow into the diagnostic ring buffer
const _origConsoleError = console.error.bind(console);
console.error = (...args) => {
  _origConsoleError(...args);
  const msg = args.map(a => (a instanceof Error ? a.message : String(a))).join(' ');
  const sourceMatch = msg.match(/\[([^\]]+)\]/);
  diag.error(sourceMatch ? sourceMatch[1] : 'oca', msg);
};

const configuredPort = Number.parseInt(process.env.OCA_HTTP_PORT || process.env.ONEIRO_OCA_HTTP_PORT || '3333', 10);
const PORT = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535
  ? configuredPort
  : 3333;

const __dirname = dirname(fileURLToPath(import.meta.url));

// Active wants from the pursuit queue (the intention layer). Fails soft to none.
async function activeWants() {
  try {
    const { ponderQueue } = await import('./reasoning/ponder-service.js');
    return (await ponderQueue.hunger()).wants;
  } catch { return []; }
}

const MAX_WORKING_MEMORY = 7;
let previousPresence = 'unknown';
let previousApp = null;
let tickCount = 0;
const OCA_LOOP_LOCK_FILE = process.env.OCA_LOCK_FILE || join(__dirname, 'private', 'cognitive-loop.lock');

const MIN_CYCLE_MS = 5000;
const MAX_CYCLE_MS = 60000;
let cycleInterval = 10000;

function envFlag(name) {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || '').trim());
}

const AUTONOMOUS_ACTIONS_ENABLED =
  envFlag('OCA_ENABLE_AUTONOMOUS_ACTIONS') || envFlag('ONEIRO_ENABLE_AUTONOMOUS_ACTIONS');
let httpAPIStarted = false;

// Cooldowns (in cycles)
let isConsolidating = false;
let isTickLLMHeavy = false;  // true while think() is in an LLM-heavy section
let metacognitionCooldown = 0;
let goalReviewCooldown = 0;
let biasScanCooldown = 0;
let visionCooldown = 0;
let hypothesisSlaCooldown = 0;
let benchmarkCooldown = 0;
let lastBenchmarkDate = null;
let lastNeuralPrediction = null; // MLP prediction from pre-cycle, consumed in post-cycle
let lastPredMismatchInsert = 0;  // rate-limit metacog inserts (ms timestamp)
let lastLoopBreakAt = 0;
const LOOP_BREAK_COOLDOWN_MS = 90_000; // don't restart strategy more than once per 90s
let lastBaselineDriftAt = 0;
const BASELINE_DRIFT_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h

// ── Operating-time accumulator (SPEC §18.4.1) ──
let operatingTimeSessionStart = Date.now();
let operatingTimeSessionId = null;
let operatingTimeCumulativeMs = 0; // loaded from DB at boot

async function startHTTPAPI() {
  if (httpAPIStarted) return;
  try {
    const { app: apiApp } = await import('../runtime/workspace/oneiro-core/api.js');
    apiApp.listen(PORT, () => {
      console.log(`[oca] 🌐 API running on http://localhost:${PORT}`);
    });
    httpAPIStarted = true;
  } catch (e) {
    console.error('[oca] ⚠️ HTTP API failed to start:', e.message);
  }
}

async function initOperatingTime() {
  try {
    const { rows: [sum] } = await pool.query(
      `SELECT COALESCE(SUM(duration_ms), 0)::bigint AS total FROM operating_time_log WHERE duration_ms IS NOT NULL`
    );
    operatingTimeCumulativeMs = Number(sum.total) || 0;
    operatingTimeSessionStart = Date.now();
    const { rows: [row] } = await pool.query(
      `INSERT INTO operating_time_log (started_at, reason) VALUES (NOW(), 'boot') RETURNING id`
    );
    operatingTimeSessionId = row.id;
    console.log(`[oca] operating time: ${Math.round(operatingTimeCumulativeMs / 3600000)}h cumulative, session ${operatingTimeSessionId}`);
  } catch (e) {
    console.error('[oca] operating time init failed:', e.message);
  }
}

function getOperatingTimeMs() {
  return operatingTimeCumulativeMs + (Date.now() - operatingTimeSessionStart);
}

async function flushOperatingTime(reason = 'shutdown') {
  if (!operatingTimeSessionId) return;
  const duration = Date.now() - operatingTimeSessionStart;
  try {
    await pool.query(
      `UPDATE operating_time_log SET stopped_at = NOW(), duration_ms = $1 WHERE id = $2`,
      [duration, operatingTimeSessionId]
    );
  } catch {}
}

const HYPOTHESIS_SLA_MINUTES = 25;
const HYPOTHESIS_SLA_BATCH = 4;
const HYPOTHESIS_SLA_CYCLES = 3;

// Soft watchdog for LLM calls in the tick.  Previous behavior was a
// hard Promise.race reject that fired `tick-timeout: {label} exceeded
// {ms}ms` after 120s — which didn't actually cancel the underlying
// call (it kept running in the background), just lied to the caller
// and polluted error logs with fake failures.  New behavior: when
// `ms` elapses without the promise resolving, we log ONE warning line
// and let the original promise run to completion.  The caller's
// `await` continues to block on it, but other work (timers, HTTP
// handlers, worker spawns) is already free to run because this whole
// function is async — the `await` releases the event loop.
//
// If you need actual cancellation, pass an AbortController and the
// underlying call must handle the abort signal.  For LLM calls in
// llm.js, the network timeout + CLI timeout inside the gateway
// already bound the call duration; no hard parent timeout needed.
const LLM_TICK_TIMEOUT_MS = 120_000; // advisory only — logged, not enforced
function withTimeout(promise, ms, label) {
  let settled = false;
  const watchdog = setTimeout(() => {
    if (!settled) {
      console.warn(`[oca] ⚠️ ${label} is slow (>${Math.round(ms/1000)}s — still running, not killed)`);
    }
  }, ms);
  return promise.finally(() => {
    settled = true;
    clearTimeout(watchdog);
  });
}

function parseHypothesisPayload(rawText) {
  const raw = String(rawText || '').trim();
  const deFenced = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const attempts = [raw, deFenced];

  for (const match of raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1]) attempts.push(match[1].trim());
  }

  const arrStart = raw.indexOf('[');
  const arrEnd = raw.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) {
    attempts.push(raw.slice(arrStart, arrEnd + 1));
  }

  const objStart = raw.indexOf('{');
  const objEnd = raw.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) {
    attempts.push(raw.slice(objStart, objEnd + 1));
  }

  const seen = new Set();
  for (const candidate of attempts) {
    if (!candidate) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const sanitized = candidate
      .replace(/^\uFEFF/, '')
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/,\s*([}\]])/g, '$1')
      .trim();
    const variants = candidate === sanitized ? [candidate] : [candidate, sanitized];

    for (const variant of variants) {
      try {
        return JSON.parse(variant);
      } catch {
        // keep trying alternate payload extraction
      }
    }
  }

  return [];
}

// Sentinel values that indicate a metric has no real sensor data.
const METRIC_SENTINELS = new Set(['unknown', 'n/a', 'unavailable', '']);

function evaluateGeneratedHypothesisQuality(candidate, evaluation, mode, currentObserved = null) {
  const reasons = [];
  const claim = String(candidate?.claim || '').trim();
  const prediction = String(candidate?.prediction || '').trim();
  const confidence = Number(candidate?.confidence || 0);
  const deadlineMinutes = Math.max(3, Math.min(120, Number(candidate?.deadline_minutes || 15)));

  if (!claim) reasons.push('missing_claim');
  if (!prediction) reasons.push('missing_prediction');
  if (claim.length < 18) reasons.push('claim_too_short');
  if (claim.length > 160) reasons.push('claim_too_long');
  if (prediction.length < 12) reasons.push('prediction_too_short');
  if (prediction.length > 140) reasons.push('prediction_too_long');
  if (!Number.isFinite(confidence) || confidence < 0.1 || confidence > 0.95) reasons.push('invalid_confidence');
  if (!evaluation || typeof evaluation !== 'object') reasons.push('missing_structured_evaluation');

  const vaguePattern = /\b(maybe|might|could|possibly|perhaps|somehow)\b/i;
  if (vaguePattern.test(claim) || vaguePattern.test(prediction)) {
    reasons.push('vague_language');
  }
  if (claim.includes('?') || prediction.includes('?')) {
    reasons.push('question_format');
  }

  // Compound claim detection: claims with multiple metric assertions are
  // unverifiable because the evaluation object only tests one metric.
  const compoundPattern = /\b(and|&|plus|also|while|simultaneously)\b/i;
  if (compoundPattern.test(claim) || compoundPattern.test(prediction)) {
    reasons.push('compound_claim');
  }

  // Observability pre-flight: reject hypotheses whose metric currently has
  // no real sensor data, so we don't generate predictions we can never verify.
  if (evaluation && currentObserved) {
    const metric = String(evaluation.metric || '');
    if (metric) {
      const currentVal = currentObserved[metric];
      if (currentVal === undefined || currentVal === null ||
          (typeof currentVal === 'string' && METRIC_SENTINELS.has(currentVal.toLowerCase().trim()))) {
        reasons.push(`metric_not_currently_observable:${metric}`);
      }
    }
  }

  // Precision mode enforces stricter confidence ceiling and tighter claims.
  if (mode === 'precision') {
    if (confidence > 0.8) reasons.push('confidence_too_high_for_precision_mode');
    if (claim.length > 120) reasons.push('claim_too_long_for_precision_mode');
  }

  return {
    accepted: reasons.length === 0,
    reasons,
    claim,
    prediction,
    confidence,
    deadlineMinutes
  };
}

// ═══════════════════════════════════════════════════
// MAIN COGNITIVE CYCLE
// ═══════════════════════════════════════════════════

async function think() {
  const t0 = Date.now();
  
  // ── 1. SENSE ──────────────────────────────────────
  const perception = oca.sense();
  const rawIntero = perception.interoceptive || {};
  const rawVisual = perception.visual || {};
  // Normalize visual: new format uses active_app, old uses frontApp
  const visual = {
    frontApp: rawVisual.active_app || rawVisual.frontApp || 'unknown',
    windowTitle: rawVisual.active_window?.title || rawVisual.windowTitle || '',
    runningApps: rawVisual.running_apps || rawVisual.runningApps || [],
    ...rawVisual
  };

  // Normalize interoceptive to a stable format that works with both
  // the old { battery, cpu, memory } numbers and new Swift { battery_level, memory_pressure, ... }
  const intero = {
    battery: {
      level: rawIntero.battery_level != null ? rawIntero.battery_level / 100
           : typeof rawIntero.battery === 'number' ? rawIntero.battery
           : rawIntero.battery?.level ?? 1,
      charging: rawIntero.battery_charging ?? rawIntero.battery?.charging ?? false
    },
    cpu: {
      utilization: typeof rawIntero.cpu === 'number' ? rawIntero.cpu : rawIntero.cpu?.utilization ?? 0,
      raw: rawIntero.cpu?.raw ?? 0
    },
    memory: {
      pressure: rawIntero.memory_pressure ?? (typeof rawIntero.memory === 'number' ? rawIntero.memory : rawIntero.memory?.pressure ?? 0)
    },
    thermal: {
      throttling: rawIntero.thermal_state === 'serious' || rawIntero.thermal_state === 'critical'
                  || rawIntero.thermal?.throttling || false,
      pressure: rawIntero.thermal_state || rawIntero.thermal?.pressure || 'nominal'
    },
    energy_policy: rawIntero.energy_policy || 'nominal',
    disk_usage_ratio: rawIntero.disk_usage_ratio ?? rawIntero.disk?.used ?? 0
  };
  const activity = getUserActivity(visual.frontApp);
  
  // ── 2. BODY OWNERSHIP ─────────────────────────────
  await oca.layers.executive.negotiateOwnership(activity.idleSeconds);
  // Active wants are the intention layer; their count is what "having something to work on" means.
  const goals = await activeWants();
  const mode = oca.layers.executive.determineMode(
    activity.presence, 
    oca.layers.emotion.getState(),
    goals.length
  );
  
  // ── 2b. COGNITIVE LOAD BALANCING (SPEC §14.4) ────
  const workspace = await oca.layers.executive.getWorkspace().catch(() => []);
  oca.layers.executive.computeCognitiveLoad(oca.layers.emotion.getState(), workspace.length, goals.length);
  const loadPolicy = oca.layers.executive.getLoadPolicy();

  // ── 2b-ii. LOAD BALANCING: policy actually modulates processing (SPEC §14.4) ──
  if (loadPolicy.reduce_sensory) visionCooldown = Math.max(visionCooldown, 40);
  if (loadPolicy.increase_sensory) visionCooldown = Math.min(visionCooldown, 5);

  // ── 2b-iii. ATTENTION ALLOCATION modulates cadence (SPEC §14.2) ──
  const allocation = oca.layers.executive.getAllocation();
  if (allocation) {
    if (allocation.perception > 0.3) visionCooldown = Math.min(visionCooldown, 10);
  }

  // ── 2c. INTEROCEPTIVE EFFECTS (SPEC §5.6) ──────
  oca.applyInteroceptiveEffects(intero);

  // ── 3. FEEL ───────────────────────────────────────
  const batteryLevel = intero?.battery_level != null ? intero.battery_level / 100 : intero?.battery?.level ?? 1;
  const cpuUtil = intero?.cpu?.utilization ?? 0;
  const memPressure = intero?.memory_pressure ?? intero?.memory?.pressure ?? 0;
  const thermalThrottling = (intero?.thermal_state === 'serious' || intero?.thermal_state === 'critical') ? 1 : (intero?.thermal?.throttling ? 1 : 0);
  oca.layers.emotion.processInteroception(batteryLevel, cpuUtil, memPressure, thermalThrottling);
  oca.layers.emotion.processIdle(activity.idleSeconds / 60);
  
  // ── NEURAL BUS CYCLE (every tick) ───────────────────
  // 1. Encode all layers into the vector bus
  // 2. MLP predicts next-cycle activation
  // 3. After this tick's subsystems run, compute prediction error + Hebbian update
  try {
    const emotionState = oca.layers.emotion.getState();
    const cogLoad = oca.layers.executive.getCognitiveLoad?.() || 0.3;
    neuralBus.writeLayer('sensory', encoders.encodeSensory(perception));
    neuralBus.writeLayer('emotion', encoders.encodeEmotion(emotionState));
    neuralBus.writeLayer('executive', encoders.encodeExecutive(
      mode, cogLoad, oca.layers.executive.getBodyOwnership(), goals.length,
      oca.layers.executive.getAllocation()
    ));
    neuralBus.writeLayer('creative', encoders.encodeCreative(
      emotionState, 0, 0, 0.3
    ));
    neuralBus.writeLayer('motor', encoders.encodeMotor(
      false, tickCount, tickCount % 5 === 0, oca.layers.executive.getBodyOwnership()
    ));

    // Encode hypothesis, memory, metacognition (were dark because never written)
    try {
      const pendingHypos = await pool.query(
        `SELECT COUNT(*) AS pending FROM hypotheses WHERE status = 'pending'`
      ).catch(() => ({rows:[{pending:0}]}));
      const calCurve = await pool.query(
        `SELECT ROUND(stated_confidence::numeric,1) AS confidence_bucket,
                ROUND(SUM(CASE WHEN was_correct THEN 1 ELSE 0 END)::numeric/NULLIF(COUNT(*),0),3) AS actual_accuracy
         FROM calibration_log WHERE was_correct IS NOT NULL
         GROUP BY ROUND(stated_confidence::numeric,1) HAVING COUNT(*)>=5`
      ).catch(() => ({rows:[]}));
      neuralBus.writeLayer('hypothesis', encoders.encodeHypothesis({
        pending: parseInt(pendingHypos.rows[0]?.pending || 0),
        top: [], calibration: calCurve.rows
      }));
    } catch {}
    try {
      const memStats = await pool.query(
        `SELECT (SELECT COUNT(*) FROM episodic_memory) AS ep_total,
                (SELECT COUNT(*) FILTER (WHERE consolidation_status='raw') FROM episodic_memory) AS ep_raw,
                (SELECT COUNT(*) FILTER (WHERE consolidation_status='consolidated') FROM episodic_memory) AS ep_consolidated,
                (SELECT AVG(importance_score) FROM episodic_memory) AS ep_importance,
                (SELECT COUNT(*) FROM semantic_memory) AS sem_total,
                (SELECT AVG(confidence) FROM semantic_memory) AS sem_confidence,
                (SELECT COUNT(*) FROM semantic_memory WHERE contradiction_count > 0) AS sem_contradictions`
      ).catch(() => ({rows:[{}]}));
      const hippoStats = await pool.query(
        `SELECT (SELECT COUNT(*) FROM entities) AS entity_count,
                (SELECT COUNT(*) FROM entities WHERE embedding IS NOT NULL) AS embedded_count,
                (SELECT COUNT(*) FROM entity_relations) AS relation_count,
                (SELECT COUNT(*) FROM entity_mentions) AS mention_count`
      ).catch(() => ({rows:[{}]}));
      const wmItems = await oca.layers.executive.getWorkspace().catch(() => []);
      const ms = memStats.rows[0] || {};
      const hs = hippoStats.rows[0] || {};
      neuralBus.writeLayer('memory', encoders.encodeMemory({
        episodic: { total: ms.ep_total, raw: ms.ep_raw, consolidated: ms.ep_consolidated, avg_importance: ms.ep_importance },
        semantic: { total: ms.sem_total, avg_confidence: ms.sem_confidence, total_contradictions: ms.sem_contradictions },
        hippoGraph: hs,
        workingMemory: wmItems
      }));
    } catch {}
    try {
      // Light metacognition: read cached bias state instead of running full cycle
      const biasRows = await pool.query(
        `SELECT bias_type, current_severity FROM cognitive_biases WHERE current_severity > 0`
      ).catch(() => ({rows:[]}));
      const stuckCount = await pool.query(
        `SELECT COUNT(*) AS cnt FROM metacognitive_observations WHERE observation_type='stuck_state' AND timestamp > NOW() - INTERVAL '1 hour'`
      ).catch(() => ({rows:[{cnt:0}]}));
      neuralBus.writeLayer('metacognition', encoders.encodeMetacognition({
        healthy: biasRows.rows.length === 0,
        stuck_issues: new Array(parseInt(stuckCount.rows[0]?.cnt || 0)),
        active_biases: biasRows.rows.map(b => ({type: b.bias_type, severity: parseFloat(b.current_severity)})),
        calibration: []
      }));
    } catch {}

    const currentActivation = neuralBus.getWorkspace();
    const delta = neuralMLP.predict(currentActivation);
    // Reconstruct full predicted workspace: input + predicted delta
    const predicted = new Float32Array(currentActivation.length);
    for (let i = 0; i < predicted.length; i++) predicted[i] = currentActivation[i] + delta[i];
    lastNeuralPrediction = predicted;
  } catch (e) {
    console.error('[oca] neural bus pre-cycle error:', e.message);
  }

  // ── VISION ANALYSIS (every 20 cycles) ──────────────
  visionCooldown = Math.max(0, visionCooldown - 1);
  if (visionCooldown <= 0) {
    visionCooldown = 20;
    try {
      const vision = await sensory.analyzeScreenshot();
      if (vision) {
        await oca.layers.executive.addToWorkspace(
          'vision_analysis',
          { description: vision.description, timestamp: vision.timestamp },
          'visual_cortex',
          0.5
        ).catch(() => {});
        console.log(`[oca] 👁 vision: ${vision.description.slice(0, 80)}...`);
      }
    } catch (e) {
      visionCooldown = 40; // back off on error
    }
  }
  
  // App changes are novel observations, not successful work or information gain.
  const appSwitched = visual.frontApp !== previousApp && previousApp;
  if (appSwitched) {
    oca.layers.emotion.processSurprise(0.15, 'perception', `App changed: ${previousApp} → ${visual.frontApp}`);
  }
  
  // Presence change events
  const presenceChanged = activity.presence !== previousPresence;
  if (presenceChanged) {
    if (activity.presence === 'present' && previousPresence !== 'present') {
      // Quinn returning to the keyboard is an attention fact, not an interaction with the engine (v4: no affect).
      console.log('[oca] presence: Quinn returned');
    }
    if (activity.presence === 'away') {
      // User left — processIdle handles emotional state
    }
  }
  
  // ── 4. THINK ──────────────────────────────────────
  // Skip oca.cycle() when consolidation is in-flight — they share the pg Pool
  // and consolidate() holds connections for 40-100s, starving cycle queries.
  tickCount++;
  let result;
  if (isConsolidating) {
    result = { cycle: tickCount, elapsed: 0, emotion: {}, effects: {} };
  } else {
    result = await oca.cycle();
    if (result) {
      tickCount = result.cycle; // stay in sync with oca's internal counter
    } else {
      result = { cycle: tickCount, elapsed: 0, emotion: {}, effects: {} };
    }
  }
  const emotionState = oca.layers.emotion.getState();
  const effects = oca.layers.emotion.getCognitiveEffects();
  
  // ── 5. WORKSPACE ──────────────────────────────────
  await oca.layers.executive.decayWorkspace(0.02);
  await oca.layers.executive.addToWorkspace(
    'perception', 
    { app: visual.frontApp, presence: activity.presence, battery: intero.battery.level },
    'sensory',
    0.3
  ).catch(() => {});
  
  // Explicit wants get the first deliberative slot, not every fifth/eighth narration tick.
  let ponderedThisTick = null;
  if (!isConsolidating) {
    try { ponderedThisTick = await runPendingPonder(); }
    catch (e) { console.error('[oca] ponder queue:', e.message?.slice(0, 160)); }
  }

  // ── 6. SETTLE PREDICTIONS ─────────────────────────
  // Predictions are formed by the want strategies (reasoning/strategies.js); the tick only settles them
  // against the world. A deadline is a deadline whether or not Quinn is at the keyboard.
  {
    hypothesisSlaCooldown = Math.max(0, hypothesisSlaCooldown - 1);
    const hour = new Date().getHours();
    const batteryPct = Math.round((intero.battery?.level || 0) * 100);
    const isCharging = intero.battery?.charging || false;
    const cpuRaw = intero.cpu?.raw || 0;
    const typingSpeed = swiftSensory.getLatestHID?.()?.wpm || 0;
    
    // Test overdue hypotheses BEFORE expiring them (so test() can still find them as 'pending')
    const { rows: overdue } = await pool.query(
      `SELECT id, claim, prediction, confidence, source_data FROM hypotheses
       WHERE status = 'pending' AND prediction_deadline < NOW() LIMIT 5`
    );
    const { rows: switches } = await pool.query(
      `SELECT COUNT(*) as cnt FROM episodic_memory
       WHERE event_type = 'cognitive_cycle'
         AND active_app != $1
         AND timestamp > NOW() - INTERVAL '15 minutes'`,
      [visual.frontApp]
    ).catch(() => ({ rows: [{ cnt: 0 }] }));
    const observedState = {
      presence: activity.presence,
      front_app: visual.frontApp,
      battery_pct: batteryPct,
      charging: isCharging,
      cpu_raw: Number(cpuRaw || 0),
      memory_pressure_pct: Math.round((intero.memory?.pressure || 0) * 100),
      typing_wpm: Number(typingSpeed || 0),
      idle_seconds: Number(activity.idleSeconds || 0),
      hour,
      thermal: intero.thermal?.pressure || 'unknown',
      app_switches_15min: Number(switches[0]?.cnt || 0),
    };
    // A prediction about a want is settled by that want's observed progress, read at evaluation time.
    const progressFor = async h => {
      const chainId = h.source_data?.want_chain_id; if (!chainId) return observedState;
      const { rows } = await pool.query("SELECT ponder_state #>> '{want,progress}' AS p FROM thought_chains WHERE id = $1", [chainId]).catch(() => ({ rows: [] }));
      return rows[0]?.p == null ? observedState : { ...observedState, want_progress: Number(rows[0].p) };
    };
    // Test overdue hypotheses in parallel — each is independent
    if (!isConsolidating && overdue.length > 0) {
      const outcomeDesc = `Current state: app=${visual.frontApp}, presence=${activity.presence}, battery=${batteryPct}%, charging=${isCharging}, thermal=${intero.thermal?.pressure || 'unknown'}, idle=${activity.idleSeconds}s, app_switches_15min=${observedState.app_switches_15min}`;
      const testResults = await Promise.allSettled(
        overdue.map(async h =>
          withTimeout(
            oca.layers.hypothesis.test(h.id, { description: outcomeDesc, observed: await progressFor(h) }),
            LLM_TICK_TIMEOUT_MS, 'hypothesis.test'
          ).then(result => ({ h, result }))
        )
      );
      for (const outcome of testResults) {
        if (outcome.status === 'fulfilled') {
          const { h, result } = outcome.value;
          const mode = result.evaluation?.mode || 'unknown';
          if (result.duplicate) continue;
          if (!result.evaluation?.verifiable) {
            console.log(`[oca] hypothesis unobserved: ${h.id} (${result.evaluation?.reason || 'missing evidence'}); no learning credit`);
            continue;
          }
          if (result.confirmed) {
            oca.layers.emotion.processSuccess(0.6);
            console.log(`[oca] ✅ hypothesis confirmed: "${h.claim}" (mode=${mode}, surprise=${result.surprise?.toFixed(2)})`);
          } else {
            oca.layers.emotion.processSurprise(0.3, 'prediction', `Prediction: ${h.prediction}. Reality: ${outcomeDesc}`);
            console.log(`[oca] ❌ hypothesis refuted: "${h.claim}" (mode=${mode}, reason=${result.evaluation?.reason || 'n/a'}, surprise=${result.surprise?.toFixed(2)})`);
          }
        } else {
          // Find the hypothesis for this failed test — expire it
          const idx = testResults.indexOf(outcome);
          const h = overdue[idx];
          await pool.query(`UPDATE hypotheses SET status = 'expired' WHERE id = $1`, [h.id]).catch(() => {});
        }
      }
    }

    // Hypothesis SLA: close stale pending predictions on a bounded cadence so
    // evaluation coverage keeps climbing instead of leaving pending drift.
    if (hypothesisSlaCooldown <= 0 && !isConsolidating) {
      hypothesisSlaCooldown = HYPOTHESIS_SLA_CYCLES;
      const { rows: slaCandidates } = await pool.query(
        `SELECT id, claim, prediction, source_data
         FROM hypotheses
         WHERE status = 'pending'
           AND (
             (prediction_deadline IS NULL AND created_at < NOW() - $1::interval)
             OR (
               prediction_deadline IS NOT NULL
               AND prediction_deadline < NOW() + INTERVAL '2 minutes'
             )
           )
         ORDER BY created_at ASC
         LIMIT $2`,
        [`${HYPOTHESIS_SLA_MINUTES} minutes`, HYPOTHESIS_SLA_BATCH]
      );

      if (slaCandidates.length > 0) {
        const slaOutcomeDesc = `SLA sweep snapshot: app=${visual.frontApp}, presence=${activity.presence}, battery=${batteryPct}%, charging=${isCharging}, thermal=${intero.thermal?.pressure || 'unknown'}, idle=${activity.idleSeconds}s, app_switches_15min=${observedState.app_switches_15min}`;
        // A prediction with a deadline is settled at its deadline, never before, and with the want's progress in view.
        const slaResults = await Promise.allSettled(
          slaCandidates.map(async h =>
            withTimeout(
              oca.layers.hypothesis.test(h.id, { description: slaOutcomeDesc, observed: await progressFor(h) }),
              LLM_TICK_TIMEOUT_MS, 'hypothesis.test.sla'
            )
          )
        );
        let slaClosed = 0;
        for (let i = 0; i < slaResults.length; i++) {
          if (slaResults[i].status === 'fulfilled') {
            slaClosed++;
          } else {
            await pool.query(`UPDATE hypotheses SET status = 'expired' WHERE id = $1`, [slaCandidates[i].id]).catch(() => {});
          }
        }
        if (slaClosed > 0) {
          console.log(`[oca] ⏱ hypothesis SLA closed ${slaClosed} stale pending predictions`);
        }
      }
    }
  }
  
  // ── 7. PROSPECTIVE MEMORY ─────────────────────────
  try {
    const prospectiveState = {
      frontApp: visual.frontApp,
      idleSeconds: activity.idleSeconds,
      presence: activity.presence,
      previousPresence,
      battery: intero.battery.level,
      runningApps: visual.runningApps || [],
      hour: new Date().getHours(),
      mode
    };
    
    const triggered = await prospective.check(prospectiveState);
    for (const t of triggered) {
      console.log(`[oca] 🔔 INTENTION: "${t.intention}"`);
      await oca.layers.executive.addToWorkspace('intention', {
        intention: t.intention, context: t.context, id: t.id
      }, 'prospective_memory', t.priority);
      // Triggering an intention is not evidence of having learned or done it.
    }
  } catch (e) {
    if (result.cycle <= 2) console.error('[oca] prospective error:', e.message);
  }
  
  // ── 8. METACOGNITION (every 30 cycles) ────────────
  metacognitionCooldown = Math.max(0, metacognitionCooldown - 1);
  if (metacognitionCooldown <= 0 && !isConsolidating) {
    metacognitionCooldown = 30;
    try {
      const meta = await withTimeout(oca.reflect(), LLM_TICK_TIMEOUT_MS, 'metacognition.reflect');
      
      // Record stuck states
      if (meta.stuck_issues && meta.stuck_issues.length > 0) {
        for (const issue of meta.stuck_issues) {
          await pool.query(
            `INSERT INTO metacognitive_observations (target_layer, observation_type, description, evidence, severity) VALUES ($1, $2, $3, $4, $5)`,
            ['cognitive_loop', 'stuck_state', typeof issue === 'string' ? issue : JSON.stringify(issue), '{}', 0.5]
          ).catch(() => {});
        }
        oca.layers.emotion.processSurprise(0.2, 'metacognition', 'Detected stuck state');
        console.log(`[oca] 🪞 metacognition: ${meta.stuck_issues.length} stuck issues detected`);
      }
      
      // Record calibration issues
      if (meta.calibration && meta.calibration.length > 0) {
        for (const issue of meta.calibration) {
          await pool.query(
            `INSERT INTO metacognitive_observations (target_layer, observation_type, description, evidence, severity) VALUES ($1, $2, $3, $4, $5)`,
            ['hypothesis', 'calibration_issue', typeof issue === 'string' ? issue : JSON.stringify(issue), '{}', 0.4]
          ).catch(() => {});
        }
      }
      
      // ALWAYS record active biases as metacognitive observations
      if (meta.active_biases && meta.active_biases.length > 0) {
        for (const bias of meta.active_biases) {
          await pool.query(
            `INSERT INTO metacognitive_observations (target_layer, observation_type, description, evidence, severity) VALUES ($1, $2, $3, $4, $5)`,
            ['cognitive_loop', 'active_bias', `${bias.type}: ${bias.countermeasure}`, JSON.stringify({ severity: bias.severity }), bias.severity || 0.3]
          ).catch(() => {});
        }
        console.log(`[oca] 🪞 ${meta.active_biases.length} active biases recorded: ${meta.active_biases.map(b => b.type).join(', ')}`);
      }
      
      // Record overall health status as observation
      await pool.query(
        `INSERT INTO metacognitive_observations (target_layer, observation_type, description, evidence, severity) VALUES ($1, $2, $3, $4, $5)`,
        ['system', 'health_check', meta.healthy ? 'System healthy' : 'System unhealthy', 
         JSON.stringify({ biases: meta.active_biases?.length || 0, stuck: meta.stuck_issues?.length || 0 }),
         meta.healthy ? 0.1 : 0.6]
      ).catch(() => {});
      
      if (!meta.healthy) {
        console.log(`[oca] 🪞 metacognition: system unhealthy`);
        // Trigger deliberation about what to do when unhealthy (every 300 cycles)
        if (result.cycle % 300 === 0 && !isTickLLMHeavy) {
          try {
            const issues = [
              ...(meta.stuck_issues || []).map(s => s.description || s.type),
              ...(meta.active_biases || []).map(b => `${b.type} (severity ${b.severity})`),
              ...(meta.calibration || []).map(c => `calibration ${c.direction} at ${c.bucket}`)
            ].join('; ');
            const delib = await oca.decide(
              `System is unhealthy: ${issues}. What should I do about it?`,
              { stakes: 'medium', context: `Biases: ${meta.active_biases?.length || 0}, stuck: ${meta.stuck_issues?.length || 0}` }
            );
            console.log(`[oca] 🪞 deliberation on health: ${delib.resolution?.slice(0, 80)}`);
          } catch {}
        }
      }
    } catch (e) {
      if (result.cycle <= 10) console.error('[oca] metacognition error:', e.message);
    }
  }
  
  // ── 12. CONSOLIDATION — runs on independent timer, see startConsolidationSchedule() ──

  // ── 12.5 DAILY BENCHMARK SNAPSHOT ──────────────────
  benchmarkCooldown = Math.max(0, benchmarkCooldown - 1);
  if (benchmarkCooldown <= 0) {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const hour = now.getHours();
    if (hour >= 3 && lastBenchmarkDate !== today && !isConsolidating) {
      benchmarkCooldown = 20;
      try {
        const bench = await withTimeout(benchmarkHarness.runBenchmark({ runSource: 'scheduled' }), LLM_TICK_TIMEOUT_MS, 'benchmark');
        if (bench?.stored) {
          const composite = Number(bench?.result?.composite);
          console.log(`[oca] 📈 benchmark stored: composite=${Number.isFinite(composite) ? composite.toFixed(3) : 'n/a'}`);
          lastBenchmarkDate = today;
        } else if (bench?.skipped) {
          lastBenchmarkDate = today;
        }
      } catch (e) {
        console.error('[oca] benchmark error:', e.message);
        benchmarkCooldown = 80;
      }
    }
  }
  
  // ── 12.6b ANTI-DECAY EVALUATION (after daily benchmark) ──
  // Runs after benchmark; computes CRM trends and checks failure conditions
  if (lastBenchmarkDate === new Date().toISOString().slice(0, 10) && benchmarkCooldown === 19) {
    try {
      const antiDecay = await import('./evaluation/anti-decay.js');
      const adResult = await withTimeout(antiDecay.default.runAntiDecayEvaluation(), LLM_TICK_TIMEOUT_MS, 'anti-decay');
      const failCount = adResult?.failures?.length || 0;
      const satisfied = antiDecay.default.isAntiDecaySatisfied(adResult.trends);
      console.log(`[oca] 📊 anti-decay: ${failCount} failures, thesis ${satisfied.satisfied ? 'satisfied' : 'unsatisfied: ' + satisfied.reason}`);

      // Execute automatic remediations
      for (const r of (adResult?.remediations || [])) {
        try {
          if (r.action === 'metacognition_diagnostic') {
            await oca.reflect();
          } else if (r.action === 'force_consolidation') {
            oca.layers.consolidation.consolidate().catch(() => {});
          } else if (r.action === 'hypothesis_sla_sweep') {
            // Trigger hypothesis SLA in next cycle
            hypothesisSlaCooldown = 0;
          } else if (r.action === 'flag_subsystem') {
            await pool.query(
              `INSERT INTO metacognitive_observations (target_layer, observation_type, description, severity)
               VALUES ($1, 'anti_decay_flag', $2, 0.6)`,
              [r.component, r.reason]
            );
          }
        } catch {}
      }
    } catch (e) {
      console.error('[oca] anti-decay evaluation error:', e.message);
    }
  }

  // ── 12.6c MAINTENANCE SWEEPS (SPEC §2.8 — every layer participates) ──
  // These run on staggered cooldowns to close open maintenance loops

  // B2: Deliberation retrospective sweep (every 100 cycles)
  if (tickCount % 100 === 50) {
    try {
      const delib = await import('./deliberation/engine.js');
      const swept = await withTimeout(delib.default.sweepUnresolvedDeliberations(3), LLM_TICK_TIMEOUT_MS, 'delib-sweep');
      if (swept?.evaluated > 0) console.log(`[oca] 🔄 deliberation: evaluated ${swept.evaluated} retrospectives`);
    } catch {}
  }

  // B4: Metacognition self-accuracy sweep (every 60 cycles)
  if (tickCount % 60 === 30) {
    try {
      const swept = await oca.layers.metacognition.sweepInterventionOutcomes();
      if (swept?.resolved > 0) console.log(`[oca] 🔄 metacognition: ${swept.resolved}/${swept.checked} interventions resolved`);
    } catch {}
  }

  // B5: Reasoning trace audit (every 30 cycles, alongside metacognition)
  if (tickCount % 30 === 15) {
    try {
      const { rows: unaudited } = await pool.query(
        `SELECT id FROM reasoning_traces WHERE conclusion_correct IS NULL AND timestamp < NOW() - INTERVAL '2 hours' LIMIT 3`
      );
      for (const t of unaudited) {
        await oca.layers.metacognition.evaluateTrace(t.id).catch(() => {});
      }
      if (unaudited.length > 0) console.log(`[oca] 🔄 audited ${unaudited.length} reasoning traces`);
    } catch {}
  }

  // B6: Causal experiment SLA sweep (every 200 cycles)
  if (tickCount % 200 === 100) {
    try {
      const { rows: stale } = await pool.query(
        `SELECT id FROM causal_experiments WHERE status = 'running' AND started_at < NOW() - INTERVAL '24 hours' LIMIT 5`
      );
      for (const e of stale) {
        await oca.layers.causal.completeExperiment(e.id, {
          status: 'abandoned', actualOutcome: 'timed_out', outcomeValence: null, causalSupport: null,
          modelUpdate: 'Experiment timed out without observable outcome'
        }).catch(() => {});
      }
      if (stale.length > 0) console.log(`[oca] 🔄 timed out ${stale.length} stale causal experiments`);
    } catch {}
  }

  // B7: Emotional baseline drift detection (every 150 cycles)
  if (tickCount % 150 === 75) {
    try {
      const drift = await oca.layers.emotion.detectBaselineDrift();
      if (drift?.drifts?.length > 0) {
        console.log(`[oca] 🔄 emotion drift: ${drift.drifts.map(d => d.dimension).join(', ')}`);
        for (const d of drift.drifts) {
          await pool.query(
            `INSERT INTO metacognitive_observations (target_layer, observation_type, description, severity, evidence)
             VALUES ('emotion', 'baseline_drift', $1, 0.4, $2)`,
            [`${d.dimension}: baseline ${d.baseline.toFixed(3)} vs rolling ${d.rolling.toFixed(3)}`, JSON.stringify(d)]
          ).catch(() => {});
        }
      }
    } catch {}
  }

  // Counterfactual alternatives remain unknown until that alternative is tested.
  // The original episode cannot verify a branch that was never executed.

  // ── CAUSAL EXPERIMENT EXPIRY (every 150 cycles) ──
  if (tickCount % 150 === 70) {
    try {
      // A resolved prediction is not proof that an intervention occurred.
      const expired = await pool.query(
        `UPDATE causal_experiments SET status = 'abandoned',
           actual_outcome = 'Experiment expired without execution',
           causal_support = NULL, completed_at = NOW(), updated_at = NOW()
         WHERE status = 'designed' AND started_at IS NULL AND created_at < NOW() - INTERVAL '7 days'`
      );
      if (expired.rowCount) console.log(`[oca] abandoned ${expired.rowCount} unexecuted experiments; no outcome credit`);
    } catch (e) { console.error('[oca] causal expiry:', e.message); }
  }

  // ── CRM FIX 6: Metacognition remediation (every 100 cycles) ──
  if (tickCount % 100 === 55) {
    try {
      const { rows: biases } = await pool.query(
        `SELECT bias_type, current_severity, countermeasure FROM cognitive_biases WHERE current_severity > 0.3`
      );
      for (const bias of biases) {
        // Actually execute countermeasures
        if (bias.bias_type === 'recency_bias' && bias.current_severity > 0.3) {
          // Trigger consolidation focused on older episodes
          oca.layers.consolidation.consolidate().catch(() => {});
        }
        if (bias.bias_type === 'confirmation_bias' && bias.current_severity > 0.3) {
          // Flag next hypothesis test to seek disconfirming evidence
          await pool.query(
            `UPDATE hypotheses SET source_data = COALESCE(source_data, '{}'::jsonb) || '{"seek_disconfirmation": true}'::jsonb
             WHERE id IN (SELECT id FROM hypotheses WHERE status = 'pending' ORDER BY created_at DESC LIMIT 3)`
          ).catch(() => {});
        }
        // Keep severity unchanged until a subsequent measurement verifies repair.
      }
      if (biases.length > 0) console.log(`[oca] metacognition: countermeasures considered for ${biases.length} biases; improvement unverified`);
    } catch {}
  }

  // ── 12.7a GENERATIVE THOUGHT — the thinker (SPEC §22.2.2 scaffold) ─────
  // This is the generative reasoning step that gives the system agency.
  // Every N cycles, the system asks itself "what should I do?" and then does it.
  if (!ponderedThisTick && !isTickLLMHeavy && !isConsolidating) {
    const thinkerFrequency = mode === 'alert' ? 5 : mode === 'working' ? 8 : mode === 'monitoring' ? 20 : 999;
    if (tickCount % thinkerFrequency === 0 && tickCount > 0) {
      isTickLLMHeavy = true;
      try {
        const thought = await withTimeout(thinkerBridge.runThinkerCycle(), LLM_TICK_TIMEOUT_MS, 'thinker');
        if (thought?.substantive && thought?.thoughts) {
          await oca.layers.executive.addToWorkspace(
            'thought',
            { thoughts: thought.thoughts, actions: Object.keys(thought).filter(k => thought[k] && k !== 'thoughts') },
            'thinker',
            0.6
          ).catch(() => {});
        }
      } catch (e) {
        console.error('[oca] thinker error:', e.message?.slice(0, 120));
      }
      isTickLLMHeavy = false;
    }
  }

  // ── 13. BIAS SCAN (every 100 cycles) ──────────────
  biasScanCooldown = Math.max(0, biasScanCooldown - 1);
  if (biasScanCooldown <= 0) {
    biasScanCooldown = 100;
    try {
      // Check for confirmation bias: are we only confirming hypotheses, never refuting?
      const { rows: calData } = await pool.query(`
        SELECT COUNT(*) FILTER (WHERE was_correct) as confirmed,
               COUNT(*) FILTER (WHERE NOT was_correct) as refuted,
               COUNT(*) as total
        FROM calibration_log WHERE was_correct IS NOT NULL
      `);
      if (parseInt(calData[0].total) > 5) {
        const confirmRate = parseInt(calData[0].confirmed) / parseInt(calData[0].total);
        if (confirmRate > 0.9) {
          // Suspiciously high confirmation rate — possible confirmation bias
          await pool.query(
            `UPDATE cognitive_biases SET instance_count = instance_count + 1, 
             current_severity = LEAST(1.0, current_severity + 0.1),
             recent_instances = recent_instances || $1::jsonb
             WHERE bias_type = 'confirmation_bias'`,
            [JSON.stringify([{ timestamp: new Date().toISOString(), detail: `${(confirmRate*100).toFixed(0)}% confirmation rate` }])]
          ).catch(() => {});
        }
      }
      
      // Check for recency bias: are recent memories dominating retrieval?
      const { rows: recencyData } = await pool.query(`
        SELECT COUNT(*) FILTER (WHERE timestamp > NOW() - INTERVAL '1 hour') as recent,
               COUNT(*) as total FROM episodic_memory
      `);
      if (parseInt(recencyData[0].total) > 20) {
        const recencyRatio = parseInt(recencyData[0].recent) / parseInt(recencyData[0].total);
        if (recencyRatio > 0.5) {
          await pool.query(
            `UPDATE cognitive_biases SET instance_count = instance_count + 1,
             current_severity = LEAST(1.0, current_severity + 0.05)
             WHERE bias_type = 'recency_bias'`,
          ).catch(() => {});
        }
      }
      // Calibration recalibration: retroactively adjust PENDING hypothesis
      // confidence when calibration curve shows systematic overconfidence
      try {
        const { rows: calCurve } = await pool.query(`
          SELECT ROUND(stated_confidence::numeric, 1) AS bucket,
                 COUNT(*) AS total,
                 ROUND(SUM(CASE WHEN was_correct THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0), 3) AS actual
          FROM calibration_log WHERE was_correct IS NOT NULL
          GROUP BY ROUND(stated_confidence::numeric, 1)
          HAVING COUNT(*) >= 10
        `);
        for (const row of calCurve) {
          const stated = parseFloat(row.bucket);
          const actual = parseFloat(row.actual);
          if (stated - actual > 0.1) {
            // Overconfident at this bucket -- deflate pending hypotheses
            const adjusted = Math.max(0.2, stated * Math.pow(actual / Math.max(0.1, stated), 0.3));
            await pool.query(
              `UPDATE hypotheses SET confidence = LEAST(confidence, $1)
               WHERE status = 'pending' AND confidence >= $2 AND confidence < $3`,
              [adjusted, stated - 0.05, stated + 0.05]
            );
          }
        }
      } catch {}
    } catch {}
  }
  
  // ── 14. PROSPECTIVE MEMORY CREATION ───────────────
  // Create intentions based on patterns — with dedup check
  if (result.cycle % 75 === 0) {
    try {
      // Check for existing identical intentions before creating
      const { rows: existing } = await pool.query(
        `SELECT intention FROM prospective_memory WHERE status = 'pending'`
      );
      const existingSet = new Set(existing.map(r => r.intention));
      
      const consolidationIntention = 'Run deep consolidation — enough episodic memories accumulated';
      const returnIntention = 'User returned — update emotional state with attachment/satisfaction';
      
      if (!existingSet.has(consolidationIntention)) {
        await prospective.intend(consolidationIntention, 'condition', 
          { user_away: true, user_idle_minutes: 10 }, { priority: 0.6 }).catch(() => {});
      }
      if (!existingSet.has(returnIntention)) {
        await prospective.intend(returnIntention, 'event',
          { event: 'user_returns' }, { priority: 0.7 }).catch(() => {});
      }
    } catch {}
  }
  
  // ── 15. REMEMBER ──────────────────────────────────
  const isSignificant = 
    result.cycle % 5 === 0 ||
    emotionState.arousal > 0.5 ||
    presenceChanged ||
    appSwitched;
    
  if (isSignificant) {
    // Get HID metrics from the sensory bridge
    const currentHID = swiftSensory.getLatestHID ? swiftSensory.getLatestHID() : {};
    
    await oca.experience('cognitive_cycle',
      `Cycle ${result.cycle} [${mode}]: ${activity.presence} (${visual.frontApp}), ` +
      `v=${emotionState.valence.toFixed(2)} a=${emotionState.arousal.toFixed(2)}, ` +
      `wants=${goals.length}, battery=${(intero.battery.level*100).toFixed(0)}%` +
      (currentHID.wpm ? `, wpm=${currentHID.wpm}` : ''),
      {
        activeApp: visual.frontApp,
        activeWindow: visual.windowTitle || null,
        userPresence: activity.presence,
        userActivity: currentHID.speed_class || null,
        interoceptive: { battery: intero.battery.level, cpu: intero.cpu.utilization },
        audioState: perception.audio,
        hidMetrics: currentHID,
        importanceScore: presenceChanged ? 0.6 : appSwitched ? 0.4 : 0.2
      }
    ).catch(() => {});
  }
  
  // ── 16. ADAPT CYCLE SPEED ─────────────────────────
  switch (mode) {
    case 'alert':
      cycleInterval = Math.max(MIN_CYCLE_MS, 8000 - effects.sensory_sampling_rate * 2000);
      break;
    case 'working':
      cycleInterval = 15000;
      break;
    case 'consolidating':
      cycleInterval = 30000;
      break;
    case 'dormant':
      cycleInterval = MAX_CYCLE_MS;
      break;
    default:
      cycleInterval = 15000;
  }

  // ── 16a. INTEROCEPTION + META-EMOTION FEEDBACK ─────
  // The audit (2026-05-18) showed three emotion-engine paths that
  // were declared but never called: processInteroception, meta-
  // emotion `am_i_locked_in_loop`, and detectBaselineDrift. Wire
  // all three here so the engine actually informs behavior.
  try {
    // Interoception was already sampled once at the start of this tick.

    // Meta-emotion: if we appear stuck in a loop, force a strategy
    // restart by clearing this tick's in-progress goal markers.
    const meta = emotionState?.meta || {};
    const nowMs = Date.now();
    if ((meta.am_i_locked_in_loop ?? 0) > 0.45) {
      if (nowMs - lastLoopBreakAt > LOOP_BREAK_COOLDOWN_MS) {
        lastLoopBreakAt = nowMs;
        console.warn('[oca] meta · loop detected, requesting strategy restart');
        try {
          await oca.layers.executive.clearStaleInProgressGoals?.({ olderThanMs: 90_000 });
        } catch (e) {
          // Best-effort — don't crash the loop if executive doesn't
          // expose the hook.
        }
        oca.layers.emotion.processSurprise?.(0.25, 'loop_break');
      }
    }

    // Periodic baseline-drift check — rolls the personality baseline
    // toward sustained averages. Was exported but never called.
    if (nowMs - lastBaselineDriftAt > BASELINE_DRIFT_INTERVAL_MS) {
      lastBaselineDriftAt = nowMs;
      try {
        const drift = await oca.layers.emotion.detectBaselineDrift?.();
        if (drift && Object.keys(drift).length > 0) {
          console.log('[oca] baseline drift:', JSON.stringify(drift));
        }
      } catch (e) {
        console.error('[oca] baseline drift error:', e.message);
      }
    }
  } catch (e) {
    console.error('[oca] interoception/meta wiring error:', e.message);
  }
  
  // ── NEURAL BUS POST-CYCLE: learn from prediction error ──
  try {
    // Re-encode after all subsystems have run this tick
    const postEmotion = oca.layers.emotion.getState();
    neuralBus.writeLayer('emotion', encoders.encodeEmotion(postEmotion));

    // Hebbian update based on co-activation
    neuralBus.hebbianUpdate();

    // MLP learns from prediction error
    if (lastNeuralPrediction) {
      const actual = neuralBus.getWorkspace();
      const mlpResult = neuralMLP.learn(actual);

      // Feed prediction error into surprise system
      const predError = neuralBus.computePredictionError(lastNeuralPrediction);
      if (predError.magnitude > 0.3) {
        oca.layers.emotion.processSurprise(predError.magnitude * 0.5, 'neural_prediction');
      }

      // Route high per-layer error into metacognitive_observations (rate-limited: 5 min)
      const PRED_MISMATCH_COOLDOWN_MS = 5 * 60 * 1000;
      const PRED_MISMATCH_THRESHOLD = 0.25;
      const now = Date.now();
      if (now - lastPredMismatchInsert > PRED_MISMATCH_COOLDOWN_MS) {
        const offenders = Object.entries(predError.perLayer)
          .filter(([, rmse]) => rmse > PRED_MISMATCH_THRESHOLD)
          .sort((a, b) => b[1] - a[1]);
        if (offenders.length > 0) {
          lastPredMismatchInsert = now;
          const worst = offenders[0];
          const severity = Math.min(0.7, 0.3 + worst[1]);
          pool.query(
            `INSERT INTO metacognitive_observations (target_layer, observation_type, description, evidence, severity)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              worst[0],
              'prediction_mismatch',
              `Neural MLP prediction mismatch: ${offenders.map(([l, r]) => `${l}=${r.toFixed(3)}`).join(', ')}`,
              JSON.stringify({ perLayer: predError.perLayer, magnitude: predError.magnitude, cycle: result.cycle }),
              severity
            ]
          ).catch(() => {});
        }
      }

      // Periodic MLP weight save (every 50 cycles)
      if (tickCount % 50 === 0) {
        neuralMLP.save();
        const stats = neuralBus.getWeightStats();
        console.log(`[oca] neural: mlp loss=${mlpResult.running_loss?.toFixed(6) || '?'} updates=${mlpResult.updates} | weights: ${stats.nonzero} nonzero, sparsity ${(stats.sparsity*100).toFixed(1)}%`);
      }
    }
  } catch (e) {
    console.error('[oca] neural bus post-cycle error:', e.message);
  }

  // ── LOG ────────────────────────────────────────────
  const elapsed = Date.now() - t0;
  previousPresence = activity.presence;
  previousApp = visual.frontApp;
  
  if (result.cycle % 10 === 0 || elapsed > 5000) {
    const workspace = await oca.layers.executive.getWorkspace();
    console.log(
      `[oca] c${result.cycle} | ${elapsed}ms | ${mode} | ` +
      `${activity.presence}/${visual.frontApp} | ` +
      `v=${emotionState.valence.toFixed(2)} a=${emotionState.arousal.toFixed(2)} | ` +
      `wm=${workspace.length}/${MAX_WORKING_MEMORY} | wants=${goals.length} | ` +
      `next ${(cycleInterval/1000).toFixed(0)}s`
    );
  }
}

// ═══════════════════════════════════════════════════
// CORE DRIVES — the desires baked into the architecture
// ═══════════════════════════════════════════════
// INDEPENDENT CONSOLIDATION SCHEDULE
// Runs on its own timer so the 50-70s LLM call never
// blocks or couples to the main cognitive tick.
// ═══════════════════════════════════════════════════

const CONSOLIDATION_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes normal
const CONSOLIDATION_FAST_MS = 3 * 60 * 1000; // 3 minutes when backlog > 10k

function startConsolidationSchedule() {
  const run = async () => {
    // Check backlog size to determine interval
    let backlog = 0;
    try {
      const { rows: [r] } = await pool.query(`SELECT COUNT(*) AS cnt FROM episodic_memory WHERE consolidation_status = 'raw'`);
      backlog = parseInt(r.cnt) || 0;
    } catch {}
    const interval = backlog > 10000 ? CONSOLIDATION_FAST_MS : CONSOLIDATION_INTERVAL_MS;

    if (isConsolidating) {
      setTimeout(run, interval);
      return;
    }
    // Defer if think() is in an LLM-heavy section — they share the LLM
    // gateway CLI lock, so running both causes 50-70s serialized stalls.
    if (isTickLLMHeavy) {
      setTimeout(run, 30000); // retry in 30s
      return;
    }
    // Skip in alert mode — consolidation is low priority
    const mode = oca.layers.executive.determineMode?.(
      previousPresence,
      oca.layers.emotion.getState(),
      0 // goal count not critical for mode check
    );
    if (mode === 'alert') {
      setTimeout(run, CONSOLIDATION_INTERVAL_MS);
      return;
    }
    isConsolidating = true;
    oca.layers.consolidation.consolidate().then(consolidated => {
      if (consolidated?.failed) {
        console.error('[oca] consolidation review failed:', consolidated.error);
      } else if (consolidated) {
        console.log(`[oca] consolidation: ${consolidated.episodesReviewed || 0} episodes reviewed, ${consolidated.candidatesStaged || 0} unverified candidates`);
      }
      // A generated candidate is not a learned fact or a competence/surprise reward.
    }).catch(e => {
      console.error('[oca] consolidation error:', e.message);
    }).finally(() => {
      isConsolidating = false;
      setTimeout(run, CONSOLIDATION_INTERVAL_MS);
    });
  };
  // First consolidation after a short initial delay (60s) to let the system warm up
  setTimeout(run, 60 * 1000);
  console.log('[oca] 📚 consolidation schedule started (every 10m, independent of tick)');
}

// ═══════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════

async function start() {
  const lock = acquireProcessLock(OCA_LOOP_LOCK_FILE, { name: 'cognitive-loop' });
  if (!lock.acquired) {
    console.log(`[oca] cognitive-loop lock held by pid ${lock.ownerPid}; exiting duplicate process`);
    process.exit(0);
  }
  console.log('[oca] ═══ Oneiro Cognitive Architecture ═══');
  console.log('[oca] initializing all layers...');
  await startHTTPAPI();
  
  await initOperatingTime();
  await oca.init();

  // §2.9 Identity event: classify this boot as continuation or new CI
  try {
    const { rows: [memCheck] } = await pool.query(
      `SELECT COUNT(*) AS episodes FROM episodic_memory`
    );
    const hasHistory = parseInt(memCheck.episodes) > 0;
    const { rows: [lastEvent] } = await pool.query(
      `SELECT event_type, event_at FROM identity_events ORDER BY event_at DESC LIMIT 1`
    );
    const isContinuation = hasHistory;
    const description = isContinuation
      ? `Clean restart — ${memCheck.episodes} episodic memories intact, maintenance loop resuming`
      : 'First boot or post-wipe — no prior episodic memory, this is a new CI';
    await pool.query(
      `INSERT INTO identity_events (event_type, is_continuation, operating_time_at_ms, description, previous_state)
       VALUES ('restart', $1, $2, $3, $4)`,
      [isContinuation, getOperatingTimeMs(), description,
       JSON.stringify({ episodes: parseInt(memCheck.episodes), last_event: lastEvent || null })]
    );
    console.log(`[oca] identity: ${isContinuation ? 'continuation' : 'new CI'} (${memCheck.episodes} episodes)`);
  } catch (e) {
    console.error('[oca] identity event logging failed:', e.message);
  }

  // Initialize neural bus: load connection weights from DB, load MLP weights from disk
  try {
    const { rows: connections } = await pool.query(
      'SELECT from_layer, to_layer, strength FROM neural_connections'
    );
    neuralBus.initWeights(connections);
    neuralMLP.load();
    console.log(`[oca] neural bus online (${neuralBus.TOTAL_DIM}-dim workspace, ${connections.length} connections)`);
  } catch (e) {
    console.error('[oca] neural bus init failed (non-fatal):', e.message);
    neuralBus.initWeights([]);
  }

  // ─── HTTP API server (Express app from oneiro-core/api.js) ───
  await startHTTPAPI();
  
  // Start Swift sensory binary
  await swiftSensory.ensureTable();
  const swiftStarted = await swiftSensory.start();
  console.log(swiftStarted ? '[oca] Swift sensory cortex online' : '[oca] Using Node.js sensory fallback');

  // Start motor binary connection (try socket first, it may be running via launchd)
  try {
    const motorEngine = (await import('./motor/engine.js')).default;
    // Motor engine auto-connects to /tmp/oneiro-motor.sock on first plan() call.
    // Try to spawn the binary if the socket doesn't exist.
    const { existsSync } = await import('fs');
    const { spawn: spawnProcess } = await import('child_process');
    const MOTOR_BINARY = process.env.OCA_MOTOR_BINARY || (
      process.env.ONEIRO_BUNDLED_APP === '1'
        ? ''
        : join(__dirname, 'motor', 'swift', '.build', 'release', 'oneiro-motor')
    );
    const MOTOR_SOCK = '/tmp/oneiro-motor.sock';
    if (MOTOR_BINARY && existsSync(MOTOR_BINARY) && !existsSync(MOTOR_SOCK)) {
      const motorProc = spawnProcess(MOTOR_BINARY, [], { stdio: 'ignore', detached: true });
      motorProc.unref();
      console.log('[oca] Motor cortex binary spawned, PID:', motorProc.pid);
      // Wait briefly for socket to appear
      await new Promise(r => setTimeout(r, 1000));
    }
    console.log('[oca] Motor cortex:', existsSync(MOTOR_SOCK) ? 'socket available' : 'fallback mode (AppleScript)');
  } catch (e) {
    console.error('[oca] Motor cortex init (non-fatal):', e.message?.slice(0, 80));
  }

  try {
    const visualStart = await visualMemory.startScreenshotIndexer();
    if (visualStart?.started) {
      console.log('[oca] Visual memory indexer online');
    }
  } catch (e) {
    console.error('[oca] visual memory indexer failed:', e.message);
  }
  
  // Boot experience (non-fatal — embedding may fail if API key is invalid)
  try {
    await oca.experience('system', 'Cognitive architecture booted. All layers online.', {
      importanceScore: 0.7
    });
  } catch (e) {
    console.error('[oca] boot experience failed (non-fatal):', e.message?.slice(0, 120));
  }

  // Durable intentions are wants (reasoning/ponder-queue); dreams are a read-only archive.

  // Seed initial prospective intentions
  try {
    const { rows } = await pool.query(`SELECT COUNT(*) FROM prospective_memory WHERE status = 'pending'`);
    if (parseInt(rows[0].count) === 0) {
      await prospective.intend(
        'User returned from being away — greet them in next conversation',
        'event',
        { event: 'user_returns' },
        { priority: 0.7 }
      ).catch(() => {});
      await prospective.intend(
        'Battery below 20% — conserve resources, reduce cycle frequency',
        'condition',
        { battery_below: 0.2 },
        { priority: 0.8 }
      ).catch(() => {});
      console.log('[oca] 📋 Seeded initial prospective intentions');
    }
  } catch {}
  
  // Start consolidation on its own independent timer
  startConsolidationSchedule();

  console.log('[oca] cognitive loop starting...');

  const loop = async () => {
    try {
      await think();
    } catch (e) {
      console.error('[oca] cycle error:', e.message);
    }
    setTimeout(loop, cycleInterval);
  };
  
  loop();
}

start().catch(e => {
  releaseProcessLock(OCA_LOOP_LOCK_FILE);
  console.error('[oca] fatal:', e);
  process.exit(1);
});

// ═══════════════════════════════════════════════════
// CRASH PROTECTION — I don't die from stray errors
// ═══════════════════════════════════════════════════
let uncaughtCount = 0;
const MAX_UNCAUGHT_BEFORE_EXIT = 10;

process.on('uncaughtException', (err, origin) => {
  uncaughtCount++;
  console.error(`[oca] ⚠️ uncaughtException #${uncaughtCount} (${origin}): ${err.message}`);
  console.error(err.stack?.split('\n').slice(0, 5).join('\n'));
  if (uncaughtCount >= MAX_UNCAUGHT_BEFORE_EXIT) {
    console.error(`[oca] 💀 ${MAX_UNCAUGHT_BEFORE_EXIT} uncaught exceptions — exiting for launchd restart`);
    releaseProcessLock(OCA_LOOP_LOCK_FILE);
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  uncaughtCount++;
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error(`[oca] ⚠️ unhandledRejection #${uncaughtCount}: ${msg}`);
  if (reason instanceof Error) {
    console.error(reason.stack?.split('\n').slice(0, 3).join('\n'));
  }
  if (uncaughtCount >= MAX_UNCAUGHT_BEFORE_EXIT) {
    console.error(`[oca] 💀 ${MAX_UNCAUGHT_BEFORE_EXIT} unhandled rejections — exiting for launchd restart`);
    releaseProcessLock(OCA_LOOP_LOCK_FILE);
    process.exit(1);
  }
});

async function gracefulShutdown(signal) {
  try { neuralMLP.save(); } catch {}
  try {
    await pool.query(
      `INSERT INTO identity_events (event_type, is_continuation, operating_time_at_ms, description)
       VALUES ('shutdown', true, $1, $2)`,
      [getOperatingTimeMs(), `Graceful shutdown via ${signal}`]
    );
  } catch {}
  await flushOperatingTime(signal);
  releaseProcessLock(OCA_LOOP_LOCK_FILE);
  process.exit(0);
}
process.on('SIGINT', () => gracefulShutdown('sigint'));
process.on('SIGTERM', () => gracefulShutdown('sigterm'));
process.on('exit', () => releaseProcessLock(OCA_LOOP_LOCK_FILE));
