#!/usr/bin/env node
// OCA Cognitive Loop — the continuous thinking process
// Replaces mind.js ponder cycle with grounded, hypothesis-driven cognition
import { pool, emit, on } from './event-bus.js';
import oca from './index.js';
import prospective from './memory/prospective.js';
import swiftSensory from './sensory/swift-bridge.js';
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
        "/usr/bin/osascript -e 'tell application \"System Events\" to get name of first application process whose frontmost is true'",
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
  // Form predictions from observations
  if (activity.presence !== 'away') {
    const pending = await oca.layers.hypothesis.getPendingTests(3);
    
    // App continuity hypothesis
    if (pending.length < 8 && appSwitched) {
      await oca.layers.hypothesis.form(
        'behavior',
        `User switched to ${visual.frontApp} — predicting 10+ min session`,
        `User will still be in ${visual.frontApp} in 10 minutes`,
        { confidence: 0.6, testType: 'passive_observation', deadline: new Date(Date.now() + 10 * 60000).toISOString() }
      ).catch(() => {});
    }
    
    // Test overdue hypotheses BEFORE expiring them (so test() can still find them as 'pending')
    const { rows: overdue } = await pool.query(
      `SELECT id, claim, prediction, confidence FROM hypotheses 
       WHERE status = 'pending' AND prediction_deadline < NOW() LIMIT 5`
    );
    for (const h of overdue) {
      try {
        const result = await oca.layers.hypothesis.test(h.id, 
          `Current app: ${visual.frontApp}. Time elapsed — testing prediction.`
        );
        // Feed result to emotion
        if (result.confirmed) {
          oca.layers.emotion.processSuccess('prediction');
          console.log(`[oca] ✅ hypothesis confirmed: "${h.claim}" (surprise=${result.surprise?.toFixed(2)})`);
        } else {
          oca.layers.emotion.processSurprise(0.3, 'prediction', `Expected: ${h.prediction}, got: ${visual.frontApp}`);
          console.log(`[oca] ❌ hypothesis refuted: "${h.claim}" (surprise=${result.surprise?.toFixed(2)})`);
        }
      } catch (e) {
        // If test fails, expire it
        await pool.query(`UPDATE hypotheses SET status = 'expired' WHERE id = $1`, [h.id]).catch(() => {});
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
          const { rows } = await pool.query('SELECT COUNT(*) as total FROM creative_artifacts');
          const progress = Math.min(1, parseInt(rows[0].total) / 20);
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
  
  // Boot experience
  await oca.experience('system', 'Cognitive architecture booted. All layers online.', {
    importanceScore: 0.7
  });
  
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
