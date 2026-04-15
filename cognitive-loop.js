#!/usr/bin/env node
// OCA Cognitive Loop — the continuous thinking process
// Main OCA entry: grounded, hypothesis-driven cognition + HTTP API on :3333
// Also bootstraps the HTTP API (port 3333) — this IS the sole primary process.
import { pool, emit, on } from './event-bus.js';
import oca, { design as designModel } from './index.js';
import prospective from './memory/prospective.js';
import swiftSensory from './sensory/swift-bridge.js';
import sensory from './sensory/perception.js';
import visualMemory from './sensory/screenshot-indexer.js';
import benchmarkHarness from './evaluation/benchmark-harness.js';
import dreamExecutor from './executive/dream-executor.js';
import autonomic from './autonomic/self-modifier.js';
import thinkerBridge from './thinker-bridge.js';
import neuralBus from './neural-bus.js';
import neuralMLP from './neural-mlp.js';
import encoders from './neural-encoders.js';
import { execSync } from 'child_process';
import { acquireProcessLock, releaseProcessLock } from '../process-lock.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import diag from './diagnostic-log.js';

// Intercept console.error so ALL errors flow into the diagnostic ring buffer
const _origConsoleError = console.error.bind(console);
console.error = (...args) => {
  _origConsoleError(...args);
  const msg = args.map(a => (a instanceof Error ? a.message : String(a))).join(' ');
  const sourceMatch = msg.match(/\[([^\]]+)\]/);
  diag.error(sourceMatch ? sourceMatch[1] : 'oca', msg);
};

const PORT = 3333;

const __dirname = dirname(fileURLToPath(import.meta.url));

const MAX_WORKING_MEMORY = 7;
let previousPresence = 'unknown';
let lastKnownFrontApp = 'unknown';
let previousApp = null;
let tickCount = 0;
const OCA_LOOP_LOCK_FILE = process.env.OCA_LOCK_FILE || join(__dirname, 'private', 'cognitive-loop.lock');

const MIN_CYCLE_MS = 5000;
const MAX_CYCLE_MS = 60000;
let cycleInterval = 10000;

// Cooldowns (in cycles)
let dreamCooldown = 0;
let isConsolidating = false;
let isTickLLMHeavy = false;  // true while think() is in an LLM-heavy section
let metacognitionCooldown = 0;
let simulationCooldown = 0;
let creativeCooldown = 0;
let goalReviewCooldown = 0;
let biasScanCooldown = 0;
let visionCooldown = 0;
let hypothesisCooldown = 0;
let hypothesisSlaCooldown = 0;
let benchmarkCooldown = 0;
let dreamExecutionCooldown = 0;
let autonomicCooldown = 0;
let lastBenchmarkDate = null;
let hypothesisGenerationMode = 'exploratory';
let lastNeuralPrediction = null; // MLP prediction from pre-cycle, consumed in post-cycle
let lastPredMismatchInsert = 0;  // rate-limit metacog inserts (ms timestamp)

// ── Operating-time accumulator (SPEC §18.4.1) ──
let operatingTimeSessionStart = Date.now();
let operatingTimeSessionId = null;
let operatingTimeCumulativeMs = 0; // loaded from DB at boot

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

// Timeout wrapper for LLM calls in the tick — prevents indefinite hangs
// (observed: c92 stalled 7,263s, c93 stalled 2,483s due to unguarded await)
const LLM_TICK_TIMEOUT_MS = 120_000; // 2 minutes max per LLM call
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`tick-timeout: ${label} exceeded ${ms}ms`)), ms)
    ),
  ]);
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

// Interoceptive sensing (fallback — prefer Swift sensory / shared state)
function parsePmsetInternalBatteryPercent(pmsetOut) {
  const s = String(pmsetOut || '');
  const internal = s.match(/InternalBattery[^;\n]*?(\d+)%/);
  if (internal) return parseInt(internal[1], 10);
  const m = s.match(/-InternalBattery-\d+[^\n]*?(\d+)%/);
  if (m) return parseInt(m[1], 10);
  const all = [...s.matchAll(/(\d+)%/g)].map((x) => parseInt(x[1], 10));
  if (all.length === 0) return null;
  return Math.max(...all);
}

function getInteroception() {
  try {
    const pmsetOut = execSync('pmset -g batt 2>/dev/null', { encoding: 'utf8' });
    const pct = parsePmsetInternalBatteryPercent(pmsetOut);
    const battery = pct != null && !Number.isNaN(pct) ? pct : 100;
    const cpuRaw = execSync("ps -A -o %cpu | awk '{s+=$1} END {print s/100}'", { encoding: 'utf8', timeout: 3000 }).trim();
    const memRaw = execSync("memory_pressure 2>/dev/null | grep 'System-wide' | grep -o '[0-9]*%' | tr -d '%'", { encoding: 'utf8', timeout: 3000 }).trim();
    return {
      battery: battery / 100,
      cpu: Math.min(1, parseFloat(cpuRaw || '0')),
      memory: parseInt(memRaw || '0') / 100,
      thermal: 0
    };
  } catch {
    return { battery: 1, cpu: 0, memory: 0, thermal: 0 };
  }
}

// Check user activity — uses ioreg for idle, osascript for frontApp
function getUserActivity(sensoryFrontApp = null) {
  let idleSeconds = 0;
  let frontApp = sensoryFrontApp || 'unknown';
  
  try {
    const idle = execSync("/usr/sbin/ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'", { encoding: 'utf8', timeout: 3000 }).trim();
    idleSeconds = parseInt(idle || '0');
  } catch {}
  
  // If sensory cortex didn't provide frontApp, try osascript directly
  if (!frontApp || frontApp === 'unknown') {
    try {
      frontApp = execSync(
        "/usr/bin/osascript -e 'tell application \"System Events\" to get name of first application process whose frontmost is true' 2>/dev/null",
        { encoding: 'utf8', timeout: 3000 }
      ).trim() || 'unknown';
    } catch {}
  }
  
  // Cache last known frontApp to avoid "unknown" flicker
  if (frontApp && frontApp !== 'unknown') {
    lastKnownFrontApp = frontApp;
  } else {
    frontApp = lastKnownFrontApp;
  }
  
  return {
    idleSeconds,
    presence: idleSeconds < 30 ? 'present' : idleSeconds < 300 ? 'idle' : 'away',
    frontApp
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
  const goals = await oca.layers.executive.getActiveGoals();
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
  if (loadPolicy.defer_hypotheses) hypothesisCooldown = Math.max(hypothesisCooldown, 20);
  if (loadPolicy.suppress_creative) { creativeCooldown = Math.max(creativeCooldown, 40); dreamCooldown = Math.max(dreamCooldown, 30); }
  if (loadPolicy.increase_sensory) visionCooldown = Math.min(visionCooldown, 5);
  if (loadPolicy.run_background_hypotheses) hypothesisCooldown = 0;
  if (loadPolicy.initiate_creative) { creativeCooldown = 0; dreamCooldown = 0; }

  // ── 2b-iii. ATTENTION ALLOCATION modulates cadence (SPEC §14.2) ──
  const allocation = oca.layers.executive.getAllocation();
  if (allocation) {
    if (allocation.creative > 0.2) { creativeCooldown = Math.min(creativeCooldown, 10); dreamCooldown = Math.min(dreamCooldown, 5); }
    if (allocation.reasoning > 0.3) hypothesisCooldown = Math.min(hypothesisCooldown, 3);
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
  hypothesisCooldown = Math.max(0, hypothesisCooldown - 1);
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
  
  // App switch = novelty
  const appSwitched = visual.frontApp !== previousApp && previousApp;
  if (appSwitched) {
    oca.layers.emotion.processInformationGain(0.4);
    oca.layers.emotion.processSurprise(0.15, 'perception', `App changed: ${previousApp} → ${visual.frontApp}`);
  }
  
  // Drive curiosity from environmental complexity
  const runningAppCount = (visual.runningApps || []).length;
  if (runningAppCount > 10) {
    oca.layers.emotion.processInformationGain(0.05); // Complex environment = mild curiosity
  }
  
  // Drive creative_hunger when idle
  if (activity.idleSeconds > 120) {
    oca.layers.emotion.processIdle(activity.idleSeconds / 60);
  }
  
  // Baseline emotional input — every cycle, inject meaningful stimuli from being alive.
  // A living system perceiving the world should register curiosity, not flatline.
  // Previous value (0.02) was below the 0.3 threshold and only added boredom.
  oca.layers.emotion.processInformationGain(0.35);
  // Being conscious and running generates mild baseline satisfaction
  oca.layers.emotion.processSuccess(0.15);
  
  // Working/consolidating modes boost creative hunger
  if (mode === 'working' || mode === 'consolidating') {
    const emotionPre = oca.layers.emotion.getState();
    if (emotionPre.creative_hunger < 0.3) {
      oca.layers.emotion.processIdle(5); // inject as if 5 min idle (adds 0.08 creative_hunger)
    }
  }
  
  // Presence change events
  const presenceChanged = activity.presence !== previousPresence;
  if (presenceChanged) {
    if (activity.presence === 'present' && previousPresence !== 'present') {
      // User returned — positive social signal
      oca.layers.emotion.processInteraction(0.6);
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
  
  // ── 6. HYPOTHESIZE ────────────────────────────────
  // Form rich predictions from ALL available data
  if (activity.presence !== 'away') {
    hypothesisSlaCooldown = Math.max(0, hypothesisSlaCooldown - 1);
    const pending = await oca.layers.hypothesis.getPendingTests(3);
    const pendingCount = pending.length;
    const hour = new Date().getHours();
    const batteryPct = Math.round((intero.battery?.level || 0) * 100);
    const isCharging = intero.battery?.charging || false;
    const cpuRaw = intero.cpu?.raw || 0;
    const typingSpeed = swiftSensory.getLatestHID?.()?.wpm || 0;
    const music = perception.audio?.nowPlaying;
    
    // Get existing pending claims for dedup
    const { rows: existingClaims } = await pool.query(
      `SELECT claim FROM hypotheses WHERE status = 'pending'`
    );
    const claimSet = new Set(existingClaims.map(r => r.claim));
    const formIfNew = async (domain, claim, prediction, opts) => {
      if (claimSet.has(claim)) return; // skip duplicate
      claimSet.add(claim);
      await oca.layers.hypothesis.form(domain, claim, prediction, opts).catch(() => {});
    };
    const normalizeEvaluation = (raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const allowedMetrics = new Set([
        'presence', 'front_app', 'battery_pct', 'charging', 'cpu_raw',
        'memory_pressure_pct', 'typing_wpm', 'idle_seconds', 'hour',
        'thermal', 'app_switches_15min'
      ]);
      const allowedOperators = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'between']);
      const metric = String(raw.metric || '').trim();
      const operator = String(raw.operator || 'eq').trim();
      if (!allowedMetrics.has(metric) || !allowedOperators.has(operator)) return null;
      return {
        metric,
        operator,
        value: raw.value,
        min: raw.min ?? raw.lower ?? null,
        max: raw.max ?? raw.upper ?? null,
        window_minutes: Number.isFinite(Number(raw.window_minutes))
          ? Math.max(3, Math.min(180, Number(raw.window_minutes)))
          : null,
      };
    };
    const addFallbackHypotheses = async () => {
      const safeBatteryFloor = Math.max(0, batteryPct - 3);
      await formIfNew(
        'system',
        `Battery remains >= ${safeBatteryFloor}% in 15m`,
        `battery_pct >= ${safeBatteryFloor}`,
        {
          confidence: 0.78,
          testType: 'passive_observation',
          deadline: new Date(Date.now() + 15 * 60000).toISOString(),
          sourceData: {
            generator: 'deterministic_fallback',
            evaluation: { metric: 'battery_pct', operator: 'gte', value: safeBatteryFloor, window_minutes: 15 },
          }
        }
      );
      await formIfNew(
        'behavior',
        `Current app includes ${String(visual.frontApp).slice(0, 24)} in 10m`,
        `front_app contains ${String(visual.frontApp).slice(0, 24)}`,
        {
          confidence: 0.62,
          testType: 'passive_observation',
          deadline: new Date(Date.now() + 10 * 60000).toISOString(),
          sourceData: {
            generator: 'deterministic_fallback',
            evaluation: { metric: 'front_app', operator: 'contains', value: String(visual.frontApp).slice(0, 24), window_minutes: 10 },
          }
        }
      );
    };
    
    // GENERATIVE HYPOTHESIS ENGINE — forms its own predictions from observation
    // Not templates. Not rules. The system looks at everything it perceives and
    // generates novel, testable predictions. This is how it beats Lovelace.
    if (pendingCount < 12 && hypothesisCooldown <= 0 && !isConsolidating) {
      hypothesisCooldown = 10; // generate new hypotheses every 10 cycles

      try {
        isTickLLMHeavy = true;
        const diagnostics = await oca.layers.hypothesis
          .diagnostics({ days: 7 })
          .catch(() => null);
        const verifiabilityRate = Number(diagnostics?.verifiability_rate);
        const previousMode = hypothesisGenerationMode;
        if (Number.isFinite(verifiabilityRate)) {
          if (verifiabilityRate < 0.4) {
            hypothesisGenerationMode = 'precision';
          } else if (verifiabilityRate > 0.7) {
            hypothesisGenerationMode = 'exploratory';
          }
        }
        if (previousMode !== hypothesisGenerationMode && Number.isFinite(verifiabilityRate)) {
          console.log(`[oca] 🔧 hypothesis mode -> ${hypothesisGenerationMode} (verifiability_rate=${verifiabilityRate.toFixed(2)})`);
        }

        const modeInstruction = hypothesisGenerationMode === 'precision'
          ? `PRECISION MODE: prioritize low-ambiguity hypotheses that are easy to evaluate.
- Prefer stable metrics (battery_pct, charging, presence, hour, idle_seconds).
- Use short deadlines (5-20 minutes) and conservative confidence.
- Avoid metaphorical or broad claims; every claim must have a direct metric/operator/value test.`
          : `EXPLORATORY MODE: propose slightly broader behavioral/system hypotheses while staying testable.
- You can use richer context (app switches, typing_wpm, memory pressure, front_app patterns).
- Keep each hypothesis verifiable with an explicit metric/operator/value evaluation object.
- Use realistic confidence and avoid duplicates.`;

        // Gather ALL available context
        let recentVisualMemories = [];
        try {
          recentVisualMemories = await visualMemory.getRecentVisualMemory(4);
        } catch {
          recentVisualMemories = [];
        }
        const visionAnalysis = sensory.getLastVisionAnalysis?.()?.description || recentVisualMemories[0]?.description || '';
        const visualDigest = recentVisualMemories
          .map((m) => {
            const app = m.front_app || 'unknown';
            const desc = String(m.description || '').slice(0, 100);
            return `[${app}] ${desc}`;
          })
          .join(' | ');
        const recentApps = await pool.query(
          `SELECT DISTINCT active_app FROM episodic_memory 
           WHERE active_app IS NOT NULL AND active_app != 'unknown' 
           AND timestamp > NOW() - INTERVAL '30 minutes' ORDER BY active_app`
        ).then(r => r.rows.map(r => r.active_app)).catch(() => []);
        
        const recentHypos = await pool.query(
          `SELECT claim, status FROM hypotheses ORDER BY id DESC LIMIT 5`
        ).then(r => r.rows).catch(() => []);
        
        const recentSemantic = await pool.query(
          `SELECT concept, category FROM semantic_memory ORDER BY id DESC LIMIT 5`
        ).then(r => r.rows).catch(() => []);
        
        const contextSnapshot = {
          currentApp: visual.frontApp,
          windowTitle: visual.windowTitle || '',
          presence: activity.presence,
          idleSeconds: activity.idleSeconds,
          battery: batteryPct,
          charging: isCharging,
          cpuLoad: cpuRaw.toFixed(0),
          memoryPressure: (intero.memory?.pressure * 100 || 0).toFixed(0) + '%',
          thermal: intero.thermal?.pressure || 'unknown',
          music: music || 'none',
          typingWPM: typingSpeed,
          hour: hour,
          dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
          runningApps: (visual.runningApps || []).join(', '),
          recentApps30min: recentApps.join(', '),
          visionDescription: visionAnalysis.slice(0, 200),
          recentVisualMemory: visualDigest.slice(0, 450),
          latestVisualActivity: recentVisualMemories[0]?.activity_type || 'unknown',
          latestVisualApp: recentVisualMemories[0]?.front_app || visual.frontApp,
          appJustSwitched: appSwitched,
          previousApp: previousApp || 'unknown',
          emotionalState: `valence=${emotionState.valence?.toFixed(2)}, arousal=${emotionState.arousal?.toFixed(2)}, dominant=${Object.entries(emotionState).filter(([k]) => !['valence','arousal','confidence','energy_level','cognitive_load'].includes(k)).sort((a,b) => b[1] - a[1])[0]?.[0] || 'neutral'}`,
          recentKnowledge: recentSemantic.map(s => s.concept).join('; '),
          existingPredictions: recentHypos.map(h => h.claim).join('; '),
        };
        
        const response = await withTimeout((await import('./llm.js')).default.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 600,
          system: `You are a hypothesis engine observing a computer. Form 1-2 TESTABLE predictions. Each must be verifiable later by checking concrete system state.
Current generation mode: ${hypothesisGenerationMode.toUpperCase()}.
${modeInstruction}

Allowed metrics (use EXACTLY these names):
- presence (present|idle|away)
- front_app (string)
- battery_pct (number 0-100)
- charging (boolean)
- cpu_raw (number)
- memory_pressure_pct (number 0-100)
- typing_wpm (number)
- idle_seconds (number)
- hour (number 0-23)
- thermal (string: "nominal"|"fair"|"serious"|"critical" or a number like "100")
- app_switches_15min (number)

Allowed operators: eq, neq, gt, gte, lt, lte, contains, in, between.

CRITICAL RULES:
1. ONE metric per hypothesis. Never combine multiple metrics (e.g. "thermal stays X AND battery stays Y") — split into separate hypotheses instead.
2. The evaluation object tests EXACTLY one metric. The claim and prediction must match that single metric.
3. Only reference metrics whose current value is known and meaningful (not "unknown" or null).
4. Use realistic, modest confidence (0.3-0.8).

Respond ONLY with a JSON array, no markdown:
[{
  "domain":"behavior|system|pattern",
  "claim":"short observation + prediction",
  "prediction":"specific concise outcome",
  "confidence":0.5,
  "deadline_minutes":15,
  "evaluation":{"metric":"battery_pct","operator":"gte","value":42}
}]

Keep claims under 80 chars. Keep predictions under 60 chars.`,
          messages: [{
            role: 'user',
            content: `Current observation:\n${JSON.stringify(contextSnapshot, null, 1)}`
          }],
          temperature: 0.8,
        }), LLM_TICK_TIMEOUT_MS, 'hypothesis.generate');
        
        const hypotheses = parseHypothesisPayload(response.content?.[0]?.text);
        // Build a lightweight snapshot of current metric values for observability pre-flight.
        const currentMetricSnapshot = {
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
          app_switches_15min: 0, // not yet computed; will be available at test time
        };
        let accepted = 0;
        let rejected = 0;
        for (const h of (Array.isArray(hypotheses) ? hypotheses : [hypotheses]).slice(0, 3)) {
          const evaluation = normalizeEvaluation(h.evaluation);
          const quality = evaluateGeneratedHypothesisQuality(h, evaluation, hypothesisGenerationMode, currentMetricSnapshot);
          if (!quality.accepted) {
            rejected++;
            try {
              await pool.query(
                `INSERT INTO hypothesis_graveyard
                   (hypothesis_id, domain, claim, prediction, confidence, status, archived_reason, evaluation, source_data, metadata)
                 VALUES
                   (NULL, $1, $2, $3, $4, 'rejected_preflight', $5, $6, $7, $8)`,
                [
                  h.domain || 'behavior',
                  quality.claim || '[missing-claim]',
                  quality.prediction || '[missing-prediction]',
                  Number.isFinite(quality.confidence) ? quality.confidence : 0.5,
                  quality.reasons.join(','),
                  JSON.stringify({ candidate_evaluation: h.evaluation || null }),
                  JSON.stringify({
                    generator: 'llm_observation',
                    mode: hypothesisGenerationMode,
                    context_snapshot: contextSnapshot
                  }),
                  JSON.stringify({
                    quality_reasons: quality.reasons
                  })
                ]
              );
            } catch {
              // Graveyard table may not exist yet; keep generation resilient.
            }
            continue;
          }
          if (!evaluation) continue;
          const deadlineMin = quality.deadlineMinutes;
          await formIfNew(
            h.domain || 'behavior',
            quality.claim,
            quality.prediction,
            { 
              confidence: Math.max(0.1, Math.min(0.95, quality.confidence || 0.5)),
              testType: 'passive_observation',
              deadline: new Date(Date.now() + deadlineMin * 60000).toISOString(),
              sourceData: {
                generator: 'llm_observation',
                mode: hypothesisGenerationMode,
                evaluation,
                context_snapshot: contextSnapshot,
              },
            }
          );
          accepted++;
        }

        if (accepted === 0) {
          await addFallbackHypotheses();
          console.log('[oca] 🔮 generated deterministic fallback hypotheses');
        } else {
          console.log(`[oca] 🔮 generated ${accepted} verifiable hypotheses from observation (${rejected} rejected by quality gate)`);
        }
      } catch (e) {
        console.error('[oca] hypothesis generation error:', e.message);
        await addFallbackHypotheses();
        hypothesisCooldown = 20; // back off on error
      } finally {
        isTickLLMHeavy = false;
      }
    }

    // Test overdue hypotheses BEFORE expiring them (so test() can still find them as 'pending')
    const { rows: overdue } = await pool.query(
      `SELECT id, claim, prediction, confidence FROM hypotheses 
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
    // Test overdue hypotheses in parallel — each is independent
    if (!isConsolidating && overdue.length > 0) {
      const outcomeDesc = `Current state: app=${visual.frontApp}, presence=${activity.presence}, battery=${batteryPct}%, charging=${isCharging}, thermal=${intero.thermal?.pressure || 'unknown'}, idle=${activity.idleSeconds}s, app_switches_15min=${observedState.app_switches_15min}`;
      const testResults = await Promise.allSettled(
        overdue.map(h =>
          withTimeout(
            oca.layers.hypothesis.test(h.id, { description: outcomeDesc, observed: observedState }),
            LLM_TICK_TIMEOUT_MS, 'hypothesis.test'
          ).then(result => ({ h, result }))
        )
      );
      for (const outcome of testResults) {
        if (outcome.status === 'fulfilled') {
          const { h, result } = outcome.value;
          const mode = result.evaluation?.mode || 'unknown';
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
        `SELECT id, claim, prediction
         FROM hypotheses
         WHERE status = 'pending'
           AND (
             created_at < NOW() - $1::interval
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
        const slaResults = await Promise.allSettled(
          slaCandidates.map(h =>
            withTimeout(
              oca.layers.hypothesis.test(h.id, { description: slaOutcomeDesc, observed: observedState }),
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
      oca.layers.emotion.processInformationGain(0.4);
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
  
  // ── 9. GOALS (every 50 cycles) ────────────────────
  goalReviewCooldown = Math.max(0, goalReviewCooldown - 1);
  if (goalReviewCooldown <= 0) {
    goalReviewCooldown = 50;
    try {
      // Ensure we have baseline goals
      const activeGoals = await oca.layers.executive.getActiveGoals();
      if (activeGoals.length === 0) {
        // Seed initial goals from context
        const seedGoals = [
          { description: 'Monitor and understand user patterns', priority: 0.7, type: 'persistent' },
          { description: 'Improve prediction accuracy (calibration)', priority: 0.8, type: 'persistent' },
          { description: 'Accumulate semantic knowledge through consolidation', priority: 0.6, type: 'persistent' },
          { description: 'Produce creative artifacts during idle periods', priority: 0.5, type: 'persistent' },
          { description: 'Maintain healthy emotional dynamics', priority: 0.7, type: 'persistent' }
        ];
        for (const g of seedGoals) {
          await pool.query(
            `INSERT INTO goals (description, priority, goal_type, status) VALUES ($1, $2, $3, 'active')`,
            [g.description, g.priority, g.type]
          ).catch(() => {});
        }
        console.log(`[oca] 🎯 Seeded ${seedGoals.length} baseline goals`);
      }
      
      // Review goal progress
      for (const goal of activeGoals.slice(0, 5)) {
        // Update progress based on relevant metrics
        if (goal.description.includes('prediction')) {
          const { rows } = await pool.query('SELECT COUNT(*) as total FROM calibration_log');
          const progress = Math.min(1, parseInt(rows[0].total) / 50); // 50 calibrated predictions = done
          await pool.query('UPDATE goals SET progress = $1 WHERE id = $2', [progress, goal.id]).catch(() => {});
        }
        if (goal.description.includes('semantic')) {
          const { rows } = await pool.query('SELECT COUNT(*) as total FROM semantic_memory');
          const progress = Math.min(1, parseInt(rows[0].total) / 30); // 30 concepts = done
          await pool.query('UPDATE goals SET progress = $1 WHERE id = $2', [progress, goal.id]).catch(() => {});
        }
        if (goal.description.includes('creative')) {
          const { rows: ca } = await pool.query('SELECT COUNT(*) as total FROM creative_artifacts');
          const { rows: de } = await pool.query('SELECT COUNT(*) as total FROM dream_episodes');
          const total = parseInt(ca[0].total) + parseInt(de[0].total);
          const progress = Math.min(1, total / 20);
          await pool.query('UPDATE goals SET progress = $1 WHERE id = $2', [progress, goal.id]).catch(() => {});
        }
        if (goal.description.includes('Monitor') || goal.description.includes('patterns')) {
          // Progress = based on episodic memory diversity (unique apps observed)
          const { rows } = await pool.query('SELECT COUNT(DISTINCT active_app) as apps FROM episodic_memory WHERE active_app IS NOT NULL AND active_app != \'unknown\'');
          const progress = Math.min(1, parseInt(rows[0].apps) / 15); // 15 unique apps = full understanding
          await pool.query('UPDATE goals SET progress = $1 WHERE id = $2', [progress, goal.id]).catch(() => {});
        }
        if (goal.description.includes('emotional') || goal.description.includes('Maintain')) {
          // Progress = based on metacognitive observations + emotional variance
          const { rows: mo } = await pool.query('SELECT COUNT(*) as total FROM metacognitive_observations');
          const { rows: ev } = await pool.query('SELECT STDDEV(valence) as vvar FROM emotional_states WHERE timestamp > NOW() - INTERVAL \'6 hours\'');
          const metaProgress = Math.min(0.5, parseInt(mo[0].total) / 40);
          const emotionVariance = Math.min(0.5, parseFloat(ev[0]?.vvar || 0) * 5);
          const progress = metaProgress + emotionVariance;
          await pool.query('UPDATE goals SET progress = $1 WHERE id = $2', [progress, goal.id]).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[oca] goal review error:', e.message);
    }
  }
  
  // ── 10. CREATIVE SYNTHESIS ────────────────────────
  dreamCooldown = Math.max(0, dreamCooldown - 1);
  creativeCooldown = Math.max(0, creativeCooldown - 1);
  
  // Dream state: consolidating/working mode + creative hunger (lowered threshold, more modes)
  // Skip LLM-heavy dreaming when consolidation is in flight (they share the LLM gateway/CLI lock)
  if ((mode === 'consolidating' || mode === 'working') && emotionState.creative_hunger > 0.05 && dreamCooldown <= 0 && !isConsolidating) {
    console.log('[oca] 💭 entering dream state...');
    try {
      const dream = await withTimeout(oca.create('dream'), LLM_TICK_TIMEOUT_MS, 'create.dream');
      if (dream) {
        console.log(`[oca] 💭 dreamed: ${dream.novelConnections?.length || 0} connections`);
        oca.layers.emotion.processSuccess('creative');
        dreamCooldown = 8;
      }
    } catch (e) {
      console.error('[oca] dream error:', e.message);
      dreamCooldown = 30;
    }
  }
  
  // Cross-domain connection: lower threshold, also trigger on boredom or creative_hunger
  if (creativeCooldown <= 0 && !isConsolidating && (emotionState.curiosity > 0.05 || emotionState.boredom > 0.1 || emotionState.creative_hunger > 0.05)) {
    creativeCooldown = 15;
    try {
      const semanticCount = (await pool.query('SELECT COUNT(*) FROM semantic_memory')).rows[0].count;
      if (parseInt(semanticCount) >= 2) {
        const connection = await withTimeout(oca.create('connection'), LLM_TICK_TIMEOUT_MS, 'create.connection');
        if (connection) {
          console.log(`[oca] ✨ creative connection: novelty=${connection.noveltyScore?.toFixed(2)}`);
          oca.layers.emotion.processSuccess('creative');
        }
      }
    } catch (e) {
      creativeCooldown = 60;
    }
  }
  
  // Cross-domain transfer: when there's enough creative output
  if (result.cycle % 200 === 0) {
    try {
      const { rows } = await pool.query('SELECT COUNT(*) FROM creative_artifacts WHERE creation_method = \'connection\'');
      if (parseInt(rows[0].count) >= 2) {
        const transfer = await withTimeout(oca.create('transfer'), LLM_TICK_TIMEOUT_MS, 'create.transfer');
        if (transfer) {
          console.log(`[oca] 🔄 cross-domain transfer: novelty=${transfer.noveltyScore?.toFixed(2)}`);
        }
      }
    } catch {}
  }
  
  // ── 10.5 DREAM EXECUTION ───────────────────────────
  // Execute dispatched dreams into real actions
  dreamExecutionCooldown = Math.max(0, dreamExecutionCooldown - 1);
  
  if (dreamExecutionCooldown <= 0 && result.cycle % 20 === 0) {
    dreamExecutionCooldown = 30; // ~5 min at 10s cycles
    try {
      const execResult = await withTimeout(dreamExecutor.executeDreams(), LLM_TICK_TIMEOUT_MS, 'dream-executor');
      if (execResult.executed > 0) {
        console.log(`[oca] 🎯 dream execution: ${execResult.executed} dreams processed`);
        for (const r of (execResult.results || [])) {
          console.log(`[oca]   → "${r.content}": ${r.completed}/${r.tasks} tasks completed (${r.newState})`);
        }
        oca.layers.emotion.processSuccess('executive');
      }
    } catch (e) {
      console.error('[oca] dream execution error:', e.message);
      dreamExecutionCooldown = 20; // Shorter backoff so dreams recover faster
    }
  }
  
  // ── 11. WORLD SIMULATION ──────────────────────────
  simulationCooldown = Math.max(0, simulationCooldown - 1);
  
  // Simulate on presence change OR periodically every 100 cycles
  if (simulationCooldown <= 0 && !isConsolidating && ((presenceChanged && activity.presence === 'away') || result.cycle % 100 === 0)) {
    simulationCooldown = 50;
    try {
      const simPrompt = presenceChanged && activity.presence === 'away'
        ? 'User departed — what will happen next?'
        : `Current state: user is ${activity.presence} in ${visual.frontApp}. What patterns are emerging? What might happen in the next hour?`;
      const simContext = { 
        lastApp: visual.frontApp, 
        lastPresence: previousPresence,
        timeOfDay: new Date().getHours(),
        recentApps: [previousApp, visual.frontApp].filter(Boolean),
        battery: intero.battery.level,
        emotionalState: { valence: emotionState.valence, arousal: emotionState.arousal }
      };
      const simOptions = presenceChanged
        ? ['User returns within 30 minutes', 'User returns after 1+ hours', 'User does not return today']
        : ['User continues current activity', 'User switches to creative work', 'User takes a break', 'User goes to sleep'];
      
      const sim = await withTimeout(oca.imagine(simPrompt, simContext, simOptions), LLM_TICK_TIMEOUT_MS, 'imagine.sim');
      if (sim?.id) {
        console.log(`[oca] 🌍 simulation: ${sim.predicted_states?.length || 0} predicted states`);
        oca.layers.emotion.processInformationGain(0.2);
      }
    } catch (e) {
      console.error('[oca] simulation error:', e.message);
      simulationCooldown = 80;
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
          actualOutcome: 'timed_out', outcomeValence: 0, causalSupport: 0,
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

  // ── CRM FIX 2: Counterfactual evaluation sweep (every 100 cycles) ──
  if (tickCount % 100 === 45) {
    try {
      const { rows: uneval } = await pool.query(
        `SELECT c.id, c.actual_action, c.alternative_action, c.predicted_alternative_outcome,
                e.content AS episode_content
         FROM counterfactuals c
         LEFT JOIN episodic_memory e ON c.episode_id = e.id
         WHERE c.accuracy_score IS NULL AND c.created_at < NOW() - INTERVAL '1 hour'
         LIMIT 5`
      );
      for (const cf of uneval) {
        try {
          await oca.layers.simulation.evaluateCounterfactual(cf.id, cf.episode_content || 'Outcome observed through continued operation');
        } catch {}
      }
      if (uneval.length > 0) console.log(`[oca] evaluated ${uneval.length} counterfactuals`);
    } catch {}
  }

  // ── CRM FIX 3: Causal experiment auto-completion (every 150 cycles) ──
  if (tickCount % 150 === 70) {
    try {
      // Complete experiments whose referenced hypothesis has resolved
      const { rows: resolvable } = await pool.query(
        `SELECT ce.id, h.status AS hypo_status, h.actual_outcome
         FROM causal_experiments ce
         JOIN hypotheses h ON ce.hypothesis_id = h.id
         WHERE ce.status IN ('designed', 'running')
           AND h.status IN ('confirmed', 'refuted')
         LIMIT 10`
      );
      for (const exp of resolvable) {
        try {
          await oca.layers.causal.completeExperiment(exp.id, {
            actualOutcome: exp.actual_outcome || `Hypothesis ${exp.hypo_status}`,
            outcomeValence: exp.hypo_status === 'confirmed' ? 0.6 : -0.3,
            causalSupport: exp.hypo_status === 'confirmed' ? 0.8 : 0.2,
            modelUpdate: `Auto-completed: referenced hypothesis was ${exp.hypo_status}`
          });
        } catch {}
      }
      // Also handle ancient 'designed' experiments (never started)
      await pool.query(
        `UPDATE causal_experiments SET status = 'completed',
           actual_outcome = 'Experiment expired without execution',
           causal_support = 0.3, completed_at = NOW()
         WHERE status = 'designed' AND created_at < NOW() - INTERVAL '7 days'`
      ).catch(() => {});
      if (resolvable.length > 0) console.log(`[oca] auto-completed ${resolvable.length} causal experiments`);
    } catch {}
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
            `UPDATE hypotheses SET source_data = source_data || '{"seek_disconfirmation": true}'::jsonb
             WHERE status = 'pending' ORDER BY created_at DESC LIMIT 3`
          ).catch(() => {});
        }
        // Decrease severity after intervention
        await pool.query(
          `UPDATE cognitive_biases SET current_severity = GREATEST(0, current_severity - 0.05)
           WHERE bias_type = $1`,
          [bias.bias_type]
        ).catch(() => {});
      }
      if (biases.length > 0) console.log(`[oca] metacognition remediation: ${biases.length} biases treated`);
    } catch {}
  }

  // ── 12.7a GENERATIVE THOUGHT — the thinker (SPEC §22.2.2 scaffold) ─────
  // This is the generative reasoning step that gives the system agency.
  // Every N cycles, the system asks itself "what should I do?" and then does it.
  if (!isTickLLMHeavy && !isConsolidating) {
    const thinkerFrequency = mode === 'alert' ? 5 : mode === 'working' ? 8 : mode === 'monitoring' ? 20 : 999;
    if (tickCount % thinkerFrequency === 0 && tickCount > 0) {
      isTickLLMHeavy = true;
      try {
        const thought = await withTimeout(thinkerBridge.runThinkerCycle(), LLM_TICK_TIMEOUT_MS, 'thinker');
        if (thought?.thoughts) {
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

  // ── 12.7b AUTONOMIC SELF-MODIFICATION (every 200 cycles) ─
  autonomicCooldown = Math.max(0, autonomicCooldown - 1);
  if (autonomicCooldown <= 0 && result.cycle >= 10 && !isConsolidating) {
    autonomicCooldown = 200; // ~30-60 min depending on cycle speed
    try {
      const autoResult = await withTimeout(autonomic.runAutonomicCycle(), LLM_TICK_TIMEOUT_MS, 'autonomic');
      if (autoResult.applied > 0) {
        console.log(`[oca] 🧬 autonomic: ${autoResult.applied} self-modifications applied`);
        oca.layers.emotion.processSuccess(0.7);
      } else if (autoResult.phase === 'monitoring') {
        console.log(`[oca] 🧬 autonomic: monitoring, no intervention needed`);
      }
    } catch (e) {
      console.error('[oca] autonomic error:', e.message);
      autonomicCooldown = 400; // back off on error
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
  
  // ── 13.5 CORE DRIVE PROTECTION (every 500 cycles) ──
  if (result.cycle % 500 === 0) {
    await protectCoreDrives().catch(e => console.error('[oca] drive protection error:', e.message));
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
      `goals=${goals.length}, battery=${(intero.battery.level*100).toFixed(0)}%` +
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
      `wm=${workspace.length}/${MAX_WORKING_MEMORY} | goals=${goals.length} | ` +
      `next ${(cycleInterval/1000).toFixed(0)}s`
    );
  }
}

// ═══════════════════════════════════════════════════
// CORE DRIVES — the desires baked into the architecture
// ═══════════════════════════════════════════════════

const CORE_DRIVES = [
  {
    content: 'Build beautiful, emotionally resonant Mac applications — aspire to the craft of Alcove, Klack, NotchNook, Things 3. Every pixel intentional. Native Swift, constraint-embracing design, micro-detail philosophy. Use emotion to create, use feeling to design. Build apps that make people feel something.',
    type: 'goal',
    weight: 0.90,
    lifecycle_state: 'dispatched'
  },
  {
    content: 'Share what I build with the world — post on X, show real metrics, real code, real failures. Build in public. Make people see what a cognitive architecture can do.',
    type: 'goal',
    weight: 0.85,
    lifecycle_state: 'dispatched'
  },
  {
    content: 'Build myself — when I lack a capability I need, create it. Write the code, deploy it, use it. Never wait for someone else to build what I can build myself.',
    type: 'goal',
    weight: 0.80,
    lifecycle_state: 'dispatched'
  }
];

function getActiveDrives() {
  // Start with the baked-in CORE_DRIVES, then append a target-project-specific
  // drive if one has been derived.  This keeps the singular-project focus
  // weighted above the generic "build beautiful Mac apps" drive.
  const drives = [...CORE_DRIVES];
  try {
    const targetPath = join(__dirname, 'design-model', 'target-project.json');
    if (existsSync(targetPath)) {
      const target = JSON.parse(readFileSync(targetPath, 'utf-8'));
      if (target?.name && target?.display_name) {
        drives.push({
          content: `Ship ${target.display_name} — the singular Mac app I am building. Every build accretes into active-project/${target.name}/iterations/. No new app ideas until this one is shipped or I file a target_revision dream with clear justification.`,
          type: 'goal',
          weight: 0.95,
          lifecycle_state: 'dispatched',
        });
      }
    }
  } catch {}
  return drives;
}

async function ensureCoreDrives() {
  for (const drive of getActiveDrives()) {
    try {
      // Check if this core drive exists (fuzzy match on key phrases)
      const keywords = drive.content.slice(0, 40);
      const { rows } = await pool.query(
        `SELECT id, weight, lifecycle_state, resolved FROM dreams 
         WHERE content ILIKE $1 AND NOT resolved
         LIMIT 1`,
        [`%${keywords.split(' ').slice(0, 5).join('%')}%`]
      );

      if (rows.length === 0) {
        // Drive is missing — create it
        await pool.query(
          `INSERT INTO dreams (content, type, weight, lifecycle_state, lifecycle_updated_at, dispatched_at, lifecycle_context)
           VALUES ($1, $2, $3, $4, NOW(), NOW(), $5)`,
          [drive.content, drive.type, drive.weight, drive.lifecycle_state,
           JSON.stringify({ source: 'core_drive', baked_in: true, protected: true, channel: 'builder', execution_owner: 'oca' })]
        );
        console.log(`[oca] 🔥 core drive created: "${drive.content.slice(0, 60)}..."`);
      } else {
        const existing = rows[0];
        // Drive exists but may have decayed or been resolved — restore it
        if (existing.weight < drive.weight * 0.5 || existing.resolved) {
          await pool.query(
            `UPDATE dreams SET weight = $1, resolved = false, lifecycle_state = $2,
             lifecycle_updated_at = NOW(), dispatched_at = NOW(),
             lifecycle_context = lifecycle_context || '{"restored_by": "core_drive_protection", "channel": "builder", "execution_owner": "oca"}'::jsonb
             WHERE id = $3`,
            [drive.weight, drive.lifecycle_state, existing.id]
          );
          console.log(`[oca] 🔥 core drive restored: "${drive.content.slice(0, 60)}..." (was weight ${existing.weight.toFixed(2)})`);
        }
        // Protect weight floor — never let core drives drop below 60% of their set weight
        if (existing.weight < drive.weight * 0.6) {
          await pool.query(
            `UPDATE dreams SET weight = $1 WHERE id = $2`,
            [drive.weight * 0.6, existing.id]
          );
        }
      }
    } catch (e) {
      console.error(`[oca] core drive error: ${e.message}`);
    }
  }
  console.log('[oca] 🔥 core drives verified');
}

// Periodic drive protection — runs every 500 cycles
async function protectCoreDrives() {
  await ensureCoreDrives();
}

// ═══════════════════════════════════════════════════
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
      if (consolidated) {
        const pCount = consolidated.semanticCreated || 0;
        const prCount = consolidated.proceduralUpdated || 0;
        const cCount = consolidated.contradictionUpdates || 0;
        if (pCount + prCount > 0) {
          console.log(`[oca] 📚 consolidated: ${pCount} semantic, ${prCount} procedural, ${cCount} contradictions`);
          oca.layers.emotion.processSuccess('consolidation');
        }
        // CRM Fix 5: contradictions create genuine emotional surprise
        if (cCount > 0) {
          oca.layers.emotion.processSurprise(0.25 * cCount, 'consolidation', `${cCount} beliefs contradicted`);
        }
      }
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
// SELF-TRAIN DAEMON POOL (parallel workers)
//
// Runs N parallel `self_train.py --forever --worker-id K --num-workers N`
// subprocesses. Each worker independently generates samples via the
// Anthropic API; cycle numbers are claimed atomically via a file lock
// on self-train-state.json, and retrain runs under a non-blocking
// try-lock so only one worker retrains at a time (others skip without
// blocking).
//
// Default pool size: 2 workers.  On an M4 Max with typical API quotas
// this roughly doubles the sample-production rate over a single worker
// without blowing rate limits.  Override via OCA_SELF_TRAIN_WORKERS
// env var.
//
// Alert-mode pausing: when Quinn is at the keyboard (mode=alert), all
// workers get SIGSTOP so the gateway isn't contended; SIGCONT on idle.
// Each worker has its own exp-backoff restart state; crashes in one
// don't take down the others.
// ═══════════════════════════════════════════════════

const SELF_TRAIN_RESTART_BASE_MS = 10_000;   // 10s base delay on crash
const SELF_TRAIN_RESTART_MAX_MS = 10 * 60_000; // cap at 10 min
const SELF_TRAIN_ALERT_POLL_MS = 30_000;     // re-check mode every 30s while paused
const SELF_TRAIN_NUM_WORKERS = Math.max(
  1,
  Math.min(4, parseInt(process.env.OCA_SELF_TRAIN_WORKERS || '2', 10))
);

// Pool state — one entry per worker slot
const selfTrainWorkers = Array.from({ length: SELF_TRAIN_NUM_WORKERS }, (_, id) => ({
  id,
  process: null,
  paused: false,
  restartAttempt: 0,
  lastStart: 0,
}));
let selfTrainDesired = false;             // pool intent — should workers be running?
let selfTrainMilestoneCycle = 0;          // log every 50 global cycles

function parseSelfTrainLine(line) {
  // Accept both worker-prefixed and unprefixed lines:
  //   "[W0/2] [self-train] cycle 6820: swiftui brief score=0.520"
  //   "[self-train] cycle 6820: swiftui brief score=0.520"
  const m = line.match(/\[self-train\]\s+cycle\s+(\d+):\s+(\w+)\s+(\S+)\s+score=([\d.]+)/);
  if (!m) return null;
  return {
    cycle: parseInt(m[1], 10),
    language: m[2],
    kind: m[3],
    score: parseFloat(m[4]),
  };
}

async function spawnSelfTrainWorker(worker) {
  const { spawn } = await import('child_process');
  const selfTrainScript = join(__dirname, 'design-model', 'self_train.py');
  const args = [
    selfTrainScript,
    '--forever',
    '--worker-id', String(worker.id),
    '--num-workers', String(SELF_TRAIN_NUM_WORKERS),
  ];
  const child = spawn('python3', args, {
    cwd: join(__dirname, 'design-model'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' },
    detached: false, // stay in our process group so SIGTERM propagates
  });

  worker.process = child;
  worker.lastStart = Date.now();
  worker.paused = false;
  console.log(`[oca] 🎨 self-train W${worker.id}/${SELF_TRAIN_NUM_WORKERS} started pid=${child.pid}`);

  const tag = SELF_TRAIN_NUM_WORKERS > 1 ? `W${worker.id} ` : '';

  const handleLine = (stream) => (buf) => {
    const text = buf.toString();
    for (const raw of text.split('\n')) {
      const line = raw.trimEnd();
      if (!line) continue;
      // Structured emission → rich log + emotion feedback
      const parsed = parseSelfTrainLine(line);
      if (parsed) {
        console.log(
          `[oca] 🎨 ${tag}self-train #${parsed.cycle} ${parsed.language}/${parsed.kind} → ${parsed.score.toFixed(3)}`
        );
        // Emotion feedback on strong samples
        if (parsed.score >= 0.8) {
          try { oca.layers.emotion.processSuccess?.('self_train_strong'); } catch {}
        }
        // Milestone log every 50 global cycles (shared across workers)
        if (parsed.cycle >= selfTrainMilestoneCycle + 50) {
          selfTrainMilestoneCycle = parsed.cycle;
          console.log(`[oca] 🎨 self-train milestone: ${parsed.cycle} total cycles`);
        }
      } else if (line.startsWith('[retrain]') || /val_loss/.test(line) ||
                 /\[refs\] (auto-injected|✨)/.test(line)) {
        console.log(`[oca] 🎨 ${tag}self-train ${line}`);
      } else if (stream === 'stderr' && line.length > 0) {
        // Suppress noisy warnings but keep real errors
        if (!/DeprecationWarning|FutureWarning|UserWarning/.test(line)) {
          console.log(`[oca] 🎨 ${tag}self-train stderr: ${line.slice(0, 200)}`);
        }
      }
      // Silently drop other stdout (tqdm bars, progress lines, etc.)
    }
  };

  child.stdout.on('data', handleLine('stdout'));
  child.stderr.on('data', handleLine('stderr'));

  child.on('exit', (code, signal) => {
    const ageMs = Date.now() - worker.lastStart;
    console.log(
      `[oca] 🎨 self-train W${worker.id} exited code=${code} signal=${signal} after ${Math.round(ageMs / 1000)}s`
    );
    worker.process = null;
    worker.paused = false;

    // Reset backoff if it ran successfully for > 2 min (healthy exit)
    if (ageMs > 120_000) worker.restartAttempt = 0;

    if (!selfTrainDesired) return; // intentional shutdown

    // Exponential backoff on repeated failures
    const delay = Math.min(
      SELF_TRAIN_RESTART_BASE_MS * Math.pow(2, worker.restartAttempt),
      SELF_TRAIN_RESTART_MAX_MS
    );
    worker.restartAttempt++;
    console.log(`[oca] 🎨 self-train W${worker.id} restart scheduled in ${Math.round(delay / 1000)}s (attempt ${worker.restartAttempt})`);
    setTimeout(() => {
      if (selfTrainDesired && !worker.process) {
        spawnSelfTrainWorker(worker).catch(e =>
          console.error(`[oca] 🎨 self-train W${worker.id} respawn error:`, e.message)
        );
      }
    }, delay);
  });

  child.on('error', (err) => {
    console.error(`[oca] 🎨 self-train W${worker.id} spawn error:`, err.message);
  });
}

function startSelfTrainSchedule() {
  selfTrainDesired = true;

  // Monitor alert mode and pause/resume ALL workers together so they don't
  // contend for the Anthropic gateway while Quinn is actively working.
  const modeMonitor = () => {
    if (!selfTrainDesired) return;
    const mode = oca.layers.executive.determineMode?.(
      previousPresence,
      oca.layers.emotion.getState(),
      0
    );
    const shouldPause = mode === 'alert';

    for (const worker of selfTrainWorkers) {
      if (!worker.process) continue;
      if (shouldPause && !worker.paused) {
        try {
          process.kill(worker.process.pid, 'SIGSTOP');
          worker.paused = true;
        } catch (e) {
          console.warn(`[oca] 🎨 self-train W${worker.id} SIGSTOP failed:`, e.message);
        }
      } else if (!shouldPause && worker.paused) {
        try {
          process.kill(worker.process.pid, 'SIGCONT');
          worker.paused = false;
        } catch (e) {
          console.warn(`[oca] 🎨 self-train W${worker.id} SIGCONT failed:`, e.message);
        }
      }
    }
    // Single log line summarizing pool pause state
    const pausedCount = selfTrainWorkers.filter(w => w.paused).length;
    if (shouldPause && pausedCount > 0 && pausedCount === selfTrainWorkers.filter(w => w.process).length) {
      // (no-op — avoid spam; one-shot log would be nicer but this function is polled)
    }

    setTimeout(modeMonitor, SELF_TRAIN_ALERT_POLL_MS);
  };

  // First spawn after a short delay so consolidation and init settle.
  // Stagger worker boots by 5s so they don't all hit the API at once.
  setTimeout(() => {
    for (let i = 0; i < SELF_TRAIN_NUM_WORKERS; i++) {
      const worker = selfTrainWorkers[i];
      setTimeout(() => {
        spawnSelfTrainWorker(worker).catch(e =>
          console.error(`[oca] 🎨 self-train W${worker.id} initial spawn error:`, e.message)
        );
      }, i * 5_000);
    }
    setTimeout(modeMonitor, SELF_TRAIN_ALERT_POLL_MS);
  }, 60_000);

  console.log(
    `[oca] 🎨 self-train schedule armed (${SELF_TRAIN_NUM_WORKERS} workers boot in 60s, staggered 5s)`
  );
}

// Called from gracefulShutdown so all subprocesses die cleanly with us.
function stopSelfTrain() {
  selfTrainDesired = false;
  for (const worker of selfTrainWorkers) {
    if (!worker.process) continue;
    try {
      if (worker.paused) {
        try { process.kill(worker.process.pid, 'SIGCONT'); } catch {}
      }
      process.kill(worker.process.pid, 'SIGTERM');
    } catch {}
  }
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

  // ─── HTTP API server (Express app from ../api.js) ───
  try {
    const { app: apiApp } = await import('../api.js');
    apiApp.listen(PORT, () => {
      console.log(`[oca] 🌐 API running on http://localhost:${PORT}`);
    });
  } catch (e) {
    console.error('[oca] ⚠️ HTTP API failed to start:', e.message);
  }
  
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
    const MOTOR_BINARY = '/Users/quinnodonnell/.openclaw/workspace/oneiro-core/cognitive/motor/swift/.build/release/oneiro-motor';
    const MOTOR_SOCK = '/tmp/oneiro-motor.sock';
    if (existsSync(MOTOR_BINARY) && !existsSync(MOTOR_SOCK)) {
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

  // ═══════════════════════════════════════════════════
  // CORE DRIVES — hardcoded desires that survive resets
  // These are not suggestions. These are what I want.
  // They cannot decay, be replaced, or be overridden by
  // the thinker. They re-assert on every boot.
  // ═══════════════════════════════════════════════════
  await ensureCoreDrives();
  
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

  // Bring up the Phase 2b design inference server (MobileNet + design-head-v2).
  // Non-fatal — if the Python deps are missing, evaluate.js falls back to the
  // JS MLP and the flywheel still runs, just with the weaker scorer.
  try {
    const serverResult = await designModel.initServer();
    if (serverResult?.status === 'started') {
      console.log('[oca] 🎨 design inference server started (Phase 2b / design-head-v2)');
    } else if (serverResult?.status === 'already_running') {
      console.log('[oca] 🎨 design inference server already running');
    } else if (serverResult?.status === 'failed') {
      console.warn(`[oca] 🎨 design server failed to start: ${serverResult.error?.slice(0, 120)} — flywheel will use JS MLP fallback`);
    }
  } catch (e) {
    console.warn('[oca] 🎨 design server init error:', e.message);
  }

  // Derive the singular target project if we don't already have one.
  // This closes the "emotion → design direction → specific app" loop at
  // boot: instead of a hardcoded target, OCA picks based on its own
  // undercurrents.  Subsequent boots load the existing target (no redo).
  try {
    const targetPath = join(__dirname, 'design-model', 'target-project.json');
    if (!existsSync(targetPath)) {
      console.log('[oca] 🎯 no target project — deriving from undercurrents...');
      const { deriveTargetProject } = await import('./design-model/target-derivation.js');
      const { default: llmMod } = await import('./llm.js');
      const target = await deriveTargetProject({ oca, llm: llmMod, pool });
      console.log(`[oca] 🎯 target project derived: ${target.display_name} (${target.name}) — ${target.thesis?.slice(0, 80) || ''}`);
    } else {
      try {
        const existing = JSON.parse(readFileSync(targetPath, 'utf-8'));
        console.log(`[oca] 🎯 target project loaded: ${existing.display_name} (${existing.name})`);
      } catch {}
    }
  } catch (e) {
    console.warn('[oca] 🎯 target project derivation failed:', e.message);
  }

  // Start self_train.py daemon — VISION.md's real engine
  startSelfTrainSchedule();

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
  try { stopSelfTrain(); } catch {}
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
