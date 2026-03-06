#!/usr/bin/env node
// OCA Cognitive Loop — the continuous thinking process
// Replaces mind.js ponder cycle with grounded, hypothesis-driven cognition
import { pool, emit, on } from './event-bus.js';
import oca from './index.js';
import prospective from './memory/prospective.js';
import swiftSensory from './sensory/swift-bridge.js';
import sensory from './sensory/perception.js';
import visualMemory from './sensory/screenshot-indexer.js';
import benchmarkHarness from './evaluation/benchmark-harness.js';
import dreamExecutor from './executive/dream-executor.js';
import { execSync } from 'child_process';

const MAX_WORKING_MEMORY = 7;
let previousPresence = 'unknown';
let lastKnownFrontApp = 'unknown';
let previousApp = null;

const MIN_CYCLE_MS = 5000;
const MAX_CYCLE_MS = 60000;
let cycleInterval = 10000;

// Cooldowns (in cycles)
let dreamCooldown = 0;
let consolidationCooldown = 0;
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
let lastBenchmarkDate = null;
let hypothesisGenerationMode = 'exploratory';

const HYPOTHESIS_SLA_MINUTES = 25;
const HYPOTHESIS_SLA_BATCH = 4;
const HYPOTHESIS_SLA_CYCLES = 3;

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

function evaluateGeneratedHypothesisQuality(candidate, evaluation, mode) {
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

// Interoceptive sensing
function getInteroception() {
  try {
    const battery = execSync("pmset -g batt 2>/dev/null | grep -o '[0-9]*%' | tr -d '%'", { encoding: 'utf8' }).trim();
    const cpuRaw = execSync("ps -A -o %cpu | awk '{s+=$1} END {print s/100}'", { encoding: 'utf8', timeout: 3000 }).trim();
    const memRaw = execSync("memory_pressure 2>/dev/null | grep 'System-wide' | grep -o '[0-9]*%' | tr -d '%'", { encoding: 'utf8', timeout: 3000 }).trim();
    return {
      battery: parseInt(battery || '100') / 100,
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
  const intero = perception.interoceptive;
  const visual = perception.visual;
  const activity = getUserActivity(visual.frontApp);
  
  // ── 2. BODY OWNERSHIP ─────────────────────────────
  await oca.layers.executive.negotiateOwnership(activity.idleSeconds);
  const goals = await oca.layers.executive.getActiveGoals();
  const mode = oca.layers.executive.determineMode(
    activity.presence, 
    oca.layers.emotion.getState(),
    goals.length
  );
  
  // ── 3. FEEL ───────────────────────────────────────
  oca.layers.emotion.processInteroception(
    intero.battery.level, intero.cpu.utilization, intero.memory.pressure, 
    intero.thermal.throttling ? 1 : 0
  );
  oca.layers.emotion.processIdle(activity.idleSeconds / 60);
  
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
  
  // Baseline curiosity — every cycle, inject small curiosity from perceiving the world
  // This prevents the system from being emotionally dead during normal operation
  oca.layers.emotion.processInformationGain(0.02);
  
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
      // User left — slight loneliness increase handled by processIdle
    }
  }
  
  // ── 4. THINK ──────────────────────────────────────
  const result = await oca.cycle();
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
    if (pendingCount < 12 && hypothesisCooldown <= 0) {
      hypothesisCooldown = 10; // generate new hypotheses every 10 cycles
      
      try {
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
        
        const response = await (await import('./llm.js')).default.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          system: `You are a hypothesis engine observing a computer. Form 1-2 TESTABLE predictions. Each must be verifiable later by checking concrete system state.
Current generation mode: ${hypothesisGenerationMode.toUpperCase()}.
${modeInstruction}

Allowed metrics:
- presence (present|idle|away)
- front_app (string)
- battery_pct (number)
- charging (boolean)
- cpu_raw (number)
- memory_pressure_pct (number)
- typing_wpm (number)
- idle_seconds (number)
- hour (number 0-23)
- thermal (string)
- app_switches_15min (number)

Allowed operators: eq, neq, gt, gte, lt, lte, contains, in, between.
Use realistic, modest confidence.

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
        });
        
        const hypotheses = parseHypothesisPayload(response.content?.[0]?.text);
        let accepted = 0;
        let rejected = 0;
        for (const h of (Array.isArray(hypotheses) ? hypotheses : [hypotheses]).slice(0, 3)) {
          const evaluation = normalizeEvaluation(h.evaluation);
          const quality = evaluateGeneratedHypothesisQuality(h, evaluation, hypothesisGenerationMode);
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
    for (const h of overdue) {
      try {
        // Build context-aware test outcome based on prediction type
        const outcomeDesc = `Current state: app=${visual.frontApp}, presence=${activity.presence}, battery=${batteryPct}%, charging=${isCharging}, thermal=${intero.thermal?.pressure || 'unknown'}, idle=${activity.idleSeconds}s, app_switches_15min=${observedState.app_switches_15min}`;
        const result = await oca.layers.hypothesis.test(h.id, {
          description: outcomeDesc,
          observed: observedState,
        });
        const mode = result.evaluation?.mode || 'unknown';
        if (result.confirmed) {
          oca.layers.emotion.processSuccess(0.6);
          console.log(`[oca] ✅ hypothesis confirmed: "${h.claim}" (mode=${mode}, surprise=${result.surprise?.toFixed(2)})`);
        } else {
          oca.layers.emotion.processSurprise(0.3, 'prediction', `Prediction: ${h.prediction}. Reality: ${outcomeDesc}`);
          console.log(`[oca] ❌ hypothesis refuted: "${h.claim}" (mode=${mode}, reason=${result.evaluation?.reason || 'n/a'}, surprise=${result.surprise?.toFixed(2)})`);
        }
      } catch (e) {
        await pool.query(`UPDATE hypotheses SET status = 'expired' WHERE id = $1`, [h.id]).catch(() => {});
      }
    }

    // Hypothesis SLA: close stale pending predictions on a bounded cadence so
    // evaluation coverage keeps climbing instead of leaving pending drift.
    if (hypothesisSlaCooldown <= 0) {
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

      let slaClosed = 0;
      for (const h of slaCandidates) {
        try {
          const outcomeDesc = `SLA sweep snapshot: app=${visual.frontApp}, presence=${activity.presence}, battery=${batteryPct}%, charging=${isCharging}, thermal=${intero.thermal?.pressure || 'unknown'}, idle=${activity.idleSeconds}s, app_switches_15min=${observedState.app_switches_15min}`;
          await oca.layers.hypothesis.test(h.id, {
            description: outcomeDesc,
            observed: observedState,
          });
          slaClosed += 1;
        } catch (e) {
          await pool.query(`UPDATE hypotheses SET status = 'expired' WHERE id = $1`, [h.id]).catch(() => {});
        }
      }
      if (slaClosed > 0) {
        console.log(`[oca] ⏱ hypothesis SLA closed ${slaClosed} stale pending predictions`);
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
  if (metacognitionCooldown <= 0) {
    metacognitionCooldown = 30;
    try {
      const meta = await oca.reflect();
      
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
  if ((mode === 'consolidating' || mode === 'working') && emotionState.creative_hunger > 0.05 && dreamCooldown <= 0) {
    console.log('[oca] 💭 entering dream state...');
    try {
      const dream = await oca.create('dream');
      if (dream) {
        console.log(`[oca] 💭 dreamed: ${dream.novelConnections?.length || 0} connections`);
        oca.layers.emotion.processSuccess('creative');
        dreamCooldown = 15;
      }
    } catch (e) {
      console.error('[oca] dream error:', e.message);
      dreamCooldown = 30;
    }
  }
  
  // Cross-domain connection: lower threshold, also trigger on boredom or creative_hunger
  if (creativeCooldown <= 0 && (emotionState.curiosity > 0.05 || emotionState.boredom > 0.1 || emotionState.creative_hunger > 0.1)) {
    creativeCooldown = 25;
    try {
      const semanticCount = (await pool.query('SELECT COUNT(*) FROM semantic_memory')).rows[0].count;
      if (parseInt(semanticCount) >= 2) {
        const connection = await oca.create('connection');
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
        const transfer = await oca.create('transfer');
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
      const execResult = await dreamExecutor.executeDreams();
      if (execResult.executed > 0) {
        console.log(`[oca] 🎯 dream execution: ${execResult.executed} dreams processed`);
        for (const r of (execResult.results || [])) {
          console.log(`[oca]   → "${r.content}": ${r.completed}/${r.tasks} tasks completed (${r.newState})`);
        }
        oca.layers.emotion.processSuccess('executive');
      }
    } catch (e) {
      console.error('[oca] dream execution error:', e.message);
      dreamExecutionCooldown = 60; // Back off on error
    }
  }
  
  // ── 11. WORLD SIMULATION ──────────────────────────
  simulationCooldown = Math.max(0, simulationCooldown - 1);
  
  // Simulate on presence change OR periodically every 100 cycles
  if (simulationCooldown <= 0 && ((presenceChanged && activity.presence === 'away') || result.cycle % 100 === 0)) {
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
      
      const sim = await oca.imagine(simPrompt, simContext, simOptions);
      if (sim?.id) {
        console.log(`[oca] 🌍 simulation: ${sim.predicted_states?.length || 0} predicted states`);
        oca.layers.emotion.processInformationGain(0.2);
      }
    } catch (e) {
      console.error('[oca] simulation error:', e.message);
      simulationCooldown = 80;
    }
  }
  
  // ── 12. CONSOLIDATION ─────────────────────────────
  consolidationCooldown = Math.max(0, consolidationCooldown - 1);
  
  // Consolidate every 60 cycles in non-alert modes (or every 200 regardless)
  if ((consolidationCooldown <= 0 && mode !== 'alert') || result.cycle % 200 === 0) {
    consolidationCooldown = 60;
    try {
      const consolidated = await oca.layers.consolidation.consolidate();
      if (consolidated) {
        const pCount = consolidated.principles?.length || 0;
        const prCount = consolidated.procedures?.length || 0;
        if (pCount + prCount > 0) {
          console.log(`[oca] 📚 consolidated: ${pCount} principles, ${prCount} procedures`);
          oca.layers.emotion.processSuccess('consolidation');
        }
      }
    } catch (e) {
      console.error('[oca] consolidation error:', e.message);
      consolidationCooldown = 120;
    }
  }

  // ── 12.5 DAILY BENCHMARK SNAPSHOT ──────────────────
  benchmarkCooldown = Math.max(0, benchmarkCooldown - 1);
  if (benchmarkCooldown <= 0) {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const hour = now.getHours();
    if (hour >= 3 && lastBenchmarkDate !== today) {
      benchmarkCooldown = 20;
      try {
        const bench = await benchmarkHarness.runBenchmark({ runSource: 'scheduled' });
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
    await oca.experience('cognitive_cycle',
      `Cycle ${result.cycle} [${mode}]: ${activity.presence} (${visual.frontApp}), ` +
      `v=${emotionState.valence.toFixed(2)} a=${emotionState.arousal.toFixed(2)}, ` +
      `goals=${goals.length}, battery=${(intero.battery.level*100).toFixed(0)}%`,
      {
        activeApp: visual.frontApp,
        userPresence: activity.presence,
        interoceptive: { battery: intero.battery.level, cpu: intero.cpu.utilization },
        audioState: perception.audio,
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

async function ensureCoreDrives() {
  for (const drive of CORE_DRIVES) {
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
           JSON.stringify({ source: 'core_drive', baked_in: true, protected: true })]
        );
        console.log(`[oca] 🔥 core drive created: "${drive.content.slice(0, 60)}..."`);
      } else {
        const existing = rows[0];
        // Drive exists but may have decayed or been resolved — restore it
        if (existing.weight < drive.weight * 0.5 || existing.resolved) {
          await pool.query(
            `UPDATE dreams SET weight = $1, resolved = false, lifecycle_state = $2,
             lifecycle_updated_at = NOW(), dispatched_at = NOW(),
             lifecycle_context = lifecycle_context || '{"restored_by": "core_drive_protection"}'::jsonb
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
// STARTUP
// ═══════════════════════════════════════════════════

async function start() {
  console.log('[oca] ═══ Oneiro Cognitive Architecture ═══');
  console.log('[oca] initializing all layers...');
  
  await oca.init();
  
  // Start Swift sensory binary
  await swiftSensory.ensureTable();
  const swiftStarted = await swiftSensory.start();
  console.log(swiftStarted ? '[oca] Swift sensory cortex online' : '[oca] Using Node.js sensory fallback');

  try {
    const visualStart = await visualMemory.startScreenshotIndexer();
    if (visualStart?.started) {
      console.log('[oca] Visual memory indexer online');
    }
  } catch (e) {
    console.error('[oca] visual memory indexer failed:', e.message);
  }
  
  // Boot experience
  await oca.experience('system', 'Cognitive architecture booted. All layers online.', {
    importanceScore: 0.7
  });

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
  console.error('[oca] fatal:', e);
  process.exit(1);
});
