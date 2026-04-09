// OCA Sensory Cortex — multi-modal perception (SPEC §5)
// Primary source: shared PerceptualState from Swift sensory process
// Fallback: osascript for basic queries when Swift sensory not running
import { execSync } from 'child_process';
import { emit, readPerceptualState } from '../event-bus.js';
import swiftBridge from './swift-bridge.js';
import visualMemory from './screenshot-indexer.js';

// ═══════════════════════════════════════════════════
// UNIFIED PERCEPTUAL STATE (SPEC §5.8)
// ═══════════════════════════════════════════════════

export function getFullPerception() {
  // Primary: read from shared state file written by Swift sensory process
  const shared = readPerceptualState();
  if (shared && shared.timestamp) {
    const age = Date.now() - new Date(shared.timestamp).getTime();
    if (age < 10000) return shared; // fresh enough (< 10s old)
  }

  // Fallback from swift bridge cached data
  const bridgeState = swiftBridge.getFullPerception();
  if (bridgeState && bridgeState.user_presence !== 'unknown') return bridgeState;

  // Last resort: osascript fallback for minimal perception
  return buildFallbackPerception();
}

function buildFallbackPerception() {
  const visual = getVisualState();
  const audio = getAudioState();
  const intero = getInteroception();
  const temporal = getTemporalState();
  const proprio = getProprioception();

  let userActivity = 'idle';
  const app = visual.frontApp || 'unknown';
  if (['Terminal', 'Cursor', 'Xcode'].includes(app)) userActivity = 'coding';
  else if (['Arc', 'Safari', 'Chrome', 'Dia'].includes(app)) userActivity = 'browsing';
  else if (['GarageBand'].includes(app)) userActivity = 'creating';
  else if (['Messages', 'Telegram', 'Discord'].includes(app)) userActivity = 'communicating';
  else if (['Preview', 'Books', 'Notion'].includes(app)) userActivity = 'reading';

  return {
    timestamp: new Date().toISOString(),
    visual: { active_app: app, active_window: { title: visual.windowTitle || '' }, running_apps: visual.runningApps || [] },
    auditory: audio,
    tactile: swiftBridge.getLatestHID() || {},
    proprioceptive: proprio,
    interoceptive: intero,
    temporal,
    user_presence: 'active',
    user_activity: userActivity,
    environment_stability: 'unknown',
    attention_target: app,
    surprises: []
  };
}

// ═══════════════════════════════════════════════════
// INDIVIDUAL CHANNEL ACCESSORS (backward compat)
// ═══════════════════════════════════════════════════

export function getVisualState() {
  const shared = readPerceptualState();
  if (shared?.visual) {
    return {
      frontApp: shared.visual.active_app || 'unknown',
      windowTitle: shared.visual.active_window?.title || '',
      runningApps: shared.visual.running_apps || [],
      timestamp: shared.timestamp
    };
  }

  // osascript fallback
  let frontApp = 'unknown', windowTitle = '', runningApps = [];
  try {
    frontApp = execSync(
      "osascript -e 'tell application \"System Events\" to get name of first application process whose frontmost is true' 2>/dev/null",
      { encoding: 'utf8', timeout: 3000 }
    ).trim() || 'unknown';
  } catch {}

  if (frontApp !== 'unknown') {
    try {
      windowTitle = execSync(
        `osascript -e 'tell application "System Events" to get title of front window of application process "${frontApp}"' 2>/dev/null`,
        { encoding: 'utf8', timeout: 3000 }
      ).trim();
    } catch {}
  }

  try {
    const raw = execSync(
      "osascript -e 'tell application \"System Events\" to get name of every application process whose background only is false' 2>/dev/null",
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    runningApps = raw.split(', ').filter(Boolean);
  } catch {}

  return { frontApp, windowTitle, runningApps, timestamp: new Date().toISOString() };
}

export function getAudioState() {
  const shared = readPerceptualState();
  if (shared?.auditory) return { ...shared.auditory, timestamp: shared.timestamp };

  let nowPlaying = '', volume = 50, muted = false;
  try {
    nowPlaying = execSync(
      `/usr/bin/osascript -e 'if application "Music" is running then tell application "Music" to if player state is playing then return (name of current track) & " - " & (artist of current track)' 2>/dev/null || echo ''`,
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
  } catch {}
  try { volume = parseInt(execSync("/usr/bin/osascript -e 'output volume of (get volume settings)'", { encoding: 'utf8', timeout: 3000 }).trim()); } catch {}
  try { muted = execSync("/usr/bin/osascript -e 'output muted of (get volume settings)'", { encoding: 'utf8', timeout: 3000 }).trim() === 'true'; } catch {}
  return { now_playing: nowPlaying || null, volume, muted, timestamp: new Date().toISOString() };
}

export function getInteroception() {
  const shared = readPerceptualState();
  if (shared?.interoceptive) return { ...shared.interoceptive, timestamp: shared.timestamp };
  return swiftBridge.getLatestInteroception() || { timestamp: new Date().toISOString() };
}

export function getTemporalState() {
  const shared = readPerceptualState();
  if (shared?.temporal) return shared.temporal;

  const now = new Date();
  const hour = now.getHours();
  return {
    absolute: { hour, day_of_week: now.getDay(), time_of_day: hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night', iso: now.toISOString() },
    relative: {},
    rhythms: {}
  };
}

export function getProprioception() {
  const shared = readPerceptualState();
  if (shared?.proprioceptive) return shared.proprioceptive;

  let clipboard = '', wifi = 'unknown', uptime = 'unknown';
  try { clipboard = execSync("pbpaste 2>/dev/null | head -c 200", { encoding: 'utf8', timeout: 2000 }).trim(); } catch {}
  try { wifi = execSync("/System/Library/PrivateFrameworks/Apple80211.framework/Resources/airport -I 2>/dev/null | grep ' SSID' | awk '{print $2}'", { encoding: 'utf8', timeout: 3000 }).trim() || 'disconnected'; } catch {}
  try { uptime = execSync("uptime | awk -F'up ' '{print $2}' | awk -F',' '{print $1}'", { encoding: 'utf8', timeout: 3000 }).trim(); } catch {}
  return { clipboard: clipboard.slice(0, 200), network: { wifi }, uptime, timestamp: new Date().toISOString() };
}

// ═══════════════════════════════════════════════════
// VISION ANALYSIS (unchanged — still uses screenshot indexer)
// ═══════════════════════════════════════════════════

let lastVisionAnalysis = null;
let lastVisionTime = 0;
const VISION_COOLDOWN_MS = 60000;

export async function analyzeScreenshot() {
  const now = Date.now();
  if (now - lastVisionTime < VISION_COOLDOWN_MS && lastVisionAnalysis) return lastVisionAnalysis;

  try {
    const latest = await visualMemory.getLatestVisualMemory();
    if (!latest) return lastVisionAnalysis;

    lastVisionAnalysis = {
      description: latest.description || 'No indexed screenshot description available.',
      contentSummary: latest.content_summary || null,
      app: latest.front_app || null,
      windowTitle: latest.window_title || null,
      url: latest.url || null,
      activityType: latest.activity_type || null,
      timestamp: latest.captured_at ? new Date(latest.captured_at).toISOString() : new Date().toISOString(),
      screenshotFile: String(latest.filepath || '').split('/').pop() || null,
      screenshotPath: latest.filepath || null,
      fileRetained: latest.file_retained !== false,
      source: latest.metadata?.source || null
    };
    lastVisionTime = now;
    return lastVisionAnalysis;
  } catch (e) {
    console.error('[perception] indexed vision lookup failed:', e.message);
    return lastVisionAnalysis;
  }
}

export function getLastVisionAnalysis() { return lastVisionAnalysis; }

export async function captureAndStore() {
  const perception = getFullPerception();
  await emit('perception_update', 'sensory', perception, { priority: 0.3 });
  return perception;
}

export default {
  getVisualState, getAudioState, getInteroception, getTemporalState,
  getProprioception, getFullPerception, captureAndStore,
  analyzeScreenshot, getLastVisionAnalysis
};
