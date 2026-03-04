#!/usr/bin/env node
// OCA Cognitive Loop — the continuous thinking process
// Replaces mind.js ponder cycle with grounded, hypothesis-driven cognition
import { pool, emit, on } from './event-bus.js';
import oca from './index.js';
import { execSync, exec } from 'child_process';
import { readFileSync, existsSync } from 'fs';

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

// Main cognitive cycle
async function think() {
  const t0 = Date.now();
  
  // 1. SENSE — gather current state
  const intero = getInteroception();
  const activity = getUserActivity();
  
  // 2. FEEL — update interoceptive emotions
  oca.layers.emotion.processInteroception(intero.battery, intero.cpu, intero.memory, intero.thermal);
  oca.layers.emotion.processIdle(activity.idleSeconds / 60);
  
  // 3. THINK — run cognitive cycle
  const result = await oca.cycle();
  
  // 4. HYPOTHESIZE — form predictions about current state
  const emotionState = oca.layers.emotion.getState();
  const effects = oca.layers.emotion.getCognitiveEffects();
  
  // Auto-form hypotheses from observations
  if (activity.presence === 'present' && emotionState.curiosity > 0.3) {
    // We're curious and Quinn is here — form a social hypothesis
    const pending = await oca.layers.hypothesis.getPendingTests(3);
    if (pending.length < 5) { // don't overload
      // What is Quinn doing? Predict and learn.
      await oca.layers.hypothesis.form(
        'social',
        `Quinn is currently using ${activity.frontApp}`,
        `Quinn will continue using ${activity.frontApp} for the next 5 minutes`,
        { 
          confidence: 0.6, 
          testType: 'passive_observation',
          deadline: new Date(Date.now() + 5 * 60000).toISOString()
        }
      ).catch(() => {}); // duplicates are fine, just skip
    }
  }
  
  // 5. REMEMBER — store this cycle as experience
  if (result.cycle % 5 === 0) { // not every cycle, every 5th
    await oca.experience('cognitive_cycle', 
      `Cycle ${result.cycle}: ${activity.presence} user (${activity.frontApp}), ` +
      `emotion valence=${emotionState.valence.toFixed(2)}, ` +
      `battery=${(intero.battery*100).toFixed(0)}%, ` +
      `cpu=${(intero.cpu*100).toFixed(0)}%`,
      {
        activeApp: activity.frontApp,
        userPresence: activity.presence,
        interoceptive: intero,
        importanceScore: 0.2 // routine cycles are low importance
      }
    ).catch(e => console.error('[loop] experience store failed:', e.message));
  }
  
  // 6. ADAPT CYCLE SPEED
  // More activity = faster thinking. Bored = slower.
  if (activity.presence === 'present') {
    cycleInterval = Math.max(MIN_CYCLE_MS, 10000 - effects.sensory_sampling_rate * 3000);
  } else if (activity.presence === 'idle') {
    cycleInterval = 30000;
  } else {
    cycleInterval = MAX_CYCLE_MS;
  }
  
  // Log
  const elapsed = Date.now() - t0;
  if (result.cycle % 10 === 0) {
    console.log(
      `[oca] cycle ${result.cycle} | ${elapsed}ms | ` +
      `${activity.presence} (${activity.frontApp}) | ` +
      `v=${emotionState.valence.toFixed(2)} a=${emotionState.arousal.toFixed(2)} | ` +
      `next in ${(cycleInterval/1000).toFixed(0)}s`
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
