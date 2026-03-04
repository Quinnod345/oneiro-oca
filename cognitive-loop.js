#!/usr/bin/env node
// OCA Cognitive Loop — the continuous thinking process
// Replaces mind.js ponder cycle with grounded, hypothesis-driven cognition
import { pool, emit, on } from './event-bus.js';
import oca from './index.js';
import { execSync, exec } from 'child_process';
import { readFileSync, existsSync } from 'fs';

const MAX_WORKING_MEMORY = 7;

const MIN_CYCLE_MS = 5000;   // min 5s between cycles
const MAX_CYCLE_MS = 60000;  // max 60s between cycles
let cycleInterval = 10000;   // start at 10s

// Interoceptive sensing (lightweight, no Swift binary needed yet)
function getInteroception() {
  try {
    const battery = execSync("pmset -g batt 2>/dev/null | grep -o '[0-9]*%' | tr -d '%'", { encoding: 'utf8' }).trim();
    const cpuRaw = execSync("ps -A -o %cpu | awk '{s+=$1} END {print s/100}'", { encoding: 'utf8', timeout: 3000 }).trim();
    const memRaw = execSync("memory_pressure 2>/dev/null | grep 'System-wide' | grep -o '[0-9]*%' | tr -d '%'", { encoding: 'utf8', timeout: 3000 }).trim();
    
    return {
      battery: parseInt(battery || '100') / 100,
      cpu: Math.min(1, parseFloat(cpuRaw || '0')),
      memory: parseInt(memRaw || '0') / 100,
      thermal: 0 // TODO: read from SMC
    };
  } catch {
    return { battery: 1, cpu: 0, memory: 0, thermal: 0 };
  }
}

// Check user activity (lightweight)
function getUserActivity() {
  try {
    const idle = execSync("ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'", { encoding: 'utf8', timeout: 3000 }).trim();
    const idleSeconds = parseInt(idle || '0');
    const frontApp = execSync("osascript -e 'tell application \"System Events\" to get name of first application process whose frontmost is true' 2>/dev/null", { encoding: 'utf8', timeout: 3000 }).trim();
    
    return {
      idleSeconds,
      presence: idleSeconds < 30 ? 'present' : idleSeconds < 300 ? 'idle' : 'away',
      frontApp
    };
  } catch {
    return { idleSeconds: 0, presence: 'unknown', frontApp: 'unknown' };
  }
}

// Track state across cycles
let lastFrontApp = null;
let dreamCooldown = 0;

// Main cognitive cycle
async function think() {
  const t0 = Date.now();
  
  // 1. SENSE — full perception
  const perception = oca.sense();
  const intero = perception.interoceptive;
  const activity = getUserActivity();
  const visual = perception.visual;
  
  // 2. BODY OWNERSHIP — negotiate based on activity
  await oca.layers.executive.negotiateOwnership(activity.idleSeconds);
  const mode = oca.layers.executive.determineMode(
    activity.presence, 
    oca.layers.emotion.getState(),
    (await oca.layers.executive.getActiveGoals()).length
  );
  
  // 3. FEEL — process all sensory channels into emotion
  oca.layers.emotion.processInteroception(
    intero.battery.level, intero.cpu.utilization, intero.memory.pressure, 
    intero.thermal.throttling ? 1 : 0
  );
  oca.layers.emotion.processIdle(activity.idleSeconds / 60);
  
  // App switch = novelty = mild curiosity
  if (visual.frontApp !== lastFrontApp && lastFrontApp) {
    oca.layers.emotion.processInformationGain(0.3);
  }
  lastFrontApp = visual.frontApp;
  
  // 4. THINK — core cognitive cycle
  const result = await oca.cycle();
  const emotionState = oca.layers.emotion.getState();
  const effects = oca.layers.emotion.getCognitiveEffects();
  
  // 5. WORKSPACE — update working memory with current focus
  await oca.layers.executive.decayWorkspace(0.02);
  await oca.layers.executive.addToWorkspace(
    'perception', 
    { app: visual.frontApp, presence: activity.presence, battery: intero.battery.level },
    'sensory',
    0.3
  ).catch(() => {});
  
  // 6. HYPOTHESIZE — form predictions from observations
  if (effects.exploration_vs_exploitation > 0 && activity.presence !== 'away') {
    const pending = await oca.layers.hypothesis.getPendingTests(3);
    if (pending.length < 10) {
      await oca.layers.hypothesis.form(
        'social',
        `Quinn is using ${visual.frontApp} — predicting continued use`,
        `Quinn will still be in ${visual.frontApp} in 5 minutes`,
        { confidence: 0.6, testType: 'passive_observation', deadline: new Date(Date.now() + 5 * 60000).toISOString() }
      ).catch(() => {});
    }
    
    // Test expired hypotheses against current state
    const expired = await oca.layers.hypothesis.expireOverdue();
    for (const h of expired.slice(0, 3)) {
      // Check if prediction was right
      if (h.claim?.includes(visual.frontApp)) {
        await oca.layers.hypothesis.test(h.id, `Quinn is in ${visual.frontApp}`).catch(() => {});
      }
    }
  }
  
  // 7. DREAM — creative synthesis during low activity
  dreamCooldown = Math.max(0, dreamCooldown - 1);
  if (mode === 'consolidating' && emotionState.creative_hunger > 0.3 && dreamCooldown <= 0) {
    console.log('[oca] entering dream state...');
    const dream = await oca.create('dream').catch(() => null);
    if (dream) {
      console.log(`[oca] dreamed: ${dream.novelConnections?.length || 0} novel connections`);
      dreamCooldown = 20; // wait 20 cycles before dreaming again
    }
  }
  
  // 8. CONSOLIDATE — during quiet periods
  if (result.cycle % 100 === 0 && mode !== 'alert') {
    console.log('[oca] running memory consolidation...');
    await oca.layers.consolidation.consolidate().catch(e => 
      console.error('[oca] consolidation error:', e.message)
    );
  }
  
  // 9. REMEMBER — store significant cycles
  const isSignificant = 
    result.cycle % 5 === 0 ||
    emotionState.arousal > 0.6 ||
    (result.meta && !result.meta.healthy);
    
  if (isSignificant) {
    await oca.experience('cognitive_cycle',
      `Cycle ${result.cycle} [${mode}]: ${activity.presence} (${visual.frontApp}), ` +
      `v=${emotionState.valence.toFixed(2)} a=${emotionState.arousal.toFixed(2)}, ` +
      `battery=${(intero.battery.level*100).toFixed(0)}%${intero.battery.charging ? '⚡' : ''}, ` +
      `${visual.runningApps?.length || 0} apps`,
      {
        activeApp: visual.frontApp,
        userPresence: activity.presence,
        interoceptive: { battery: intero.battery.level, cpu: intero.cpu.utilization },
        audioState: perception.audio,
        importanceScore: emotionState.arousal > 0.5 ? 0.5 : 0.2
      }
    ).catch(e => console.error('[loop] experience store failed:', e.message));
  }
  
  // 10. ADAPT CYCLE SPEED based on mode + emotion
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
  
  // Log every 10th cycle or significant events
  const elapsed = Date.now() - t0;
  if (result.cycle % 10 === 0 || elapsed > 5000) {
    const workspace = await oca.layers.executive.getWorkspace();
    console.log(
      `[oca] c${result.cycle} | ${elapsed}ms | ${mode} | ` +
      `${activity.presence}/${visual.frontApp} | ` +
      `v=${emotionState.valence.toFixed(2)} a=${emotionState.arousal.toFixed(2)} | ` +
      `wm=${workspace.length}/${MAX_WORKING_MEMORY} | ` +
      `next ${(cycleInterval/1000).toFixed(0)}s`
    );
  }
}

// Startup
async function start() {
  console.log('[oca] ═══ Oneiro Cognitive Architecture ═══');
  console.log('[oca] initializing...');
  
  await oca.init();
  
  // Store boot experience
  await oca.experience('system', 'Cognitive architecture booted. All layers online.', {
    importanceScore: 0.7
  });
  
  console.log('[oca] cognitive loop starting...');
  
  // Main loop
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
