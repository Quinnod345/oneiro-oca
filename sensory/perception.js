// OCA Sensory Cortex — multi-modal perception (SPEC §5)
// Primary source: shared PerceptualState from Swift sensory process
// Fallback: osascript for basic queries when Swift sensory not running
import fallback from './fallback-reader.js';
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
    if (age >= 0 && age < 10000) return shared; // fresh enough (< 10s old)
  }

  // Fallback from swift bridge cached data
  const bridgeState = swiftBridge.getFullPerception();
  const bridgeAge = Date.now() - new Date(bridgeState?.timestamp).getTime();
  if (bridgeState && bridgeAge >= 0 && bridgeAge < 10000 && bridgeState.user_presence !== 'unknown') return bridgeState;

  // Last resort: osascript fallback for minimal perception
  return buildFallbackPerception();
}

function buildFallbackPerception() {
  const visual = getVisualState();
  const audio = getAudioState();
  const intero = getInteroception();
  const temporal = getTemporalState();
  const proprio = getProprioception();

  let userActivity = 'unknown';
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
    user_presence: 'unknown',
    source: 'fallback_commands',
    user_activity: userActivity,
    environment_stability: 'unknown',
    attention_target: app,
    surprises: []
  };
}

// ═══════════════════════════════════════════════════
// INDIVIDUAL CHANNEL ACCESSORS (backward compat)
// ═══════════════════════════════════════════════════

function freshSharedState(maxAgeMs = 30000) {
  const shared = readPerceptualState();
  if (!shared?.timestamp) return null;
  const timestamp = new Date(shared.timestamp).getTime();
  if (!Number.isFinite(timestamp)) return null;
  const age = Date.now() - timestamp;
  return age >= 0 && age <= maxAgeMs ? shared : null;
}

function isKnownString(value) {
  return typeof value === 'string' && value.trim() !== '' && value !== 'unknown';
}

export function getVisualState() {
  const shared = freshSharedState();
  if (shared?.visual && isKnownString(shared.visual.active_app)) {
    return {
      frontApp: shared.visual.active_app || 'unknown',
      windowTitle: shared.visual.active_window?.title || '',
      runningApps: shared.visual.running_apps || [],
      timestamp: shared.timestamp
    };
  }

  return fallback.get('visual') || { frontApp: 'unknown', windowTitle: '', runningApps: [], timestamp: null, source: 'unavailable' };
}

export function getAudioState() {
  const shared = freshSharedState();
  if (shared?.auditory) return { ...shared.auditory, timestamp: shared.timestamp };

  return fallback.get('auditory') || { now_playing: null, volume: null, muted: null, timestamp: null, source: 'unavailable' };
}

export function getInteroception() {
  const shared = freshSharedState();
  if (shared?.interoceptive) return { ...shared.interoceptive, timestamp: shared.timestamp };
  return swiftBridge.getLatestInteroception() || { timestamp: new Date().toISOString() };
}

export function getTemporalState() {
  const shared = freshSharedState();
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
  const shared = freshSharedState();
  if (shared?.proprioceptive) return shared.proprioceptive;

  return fallback.get('proprioceptive') || { clipboard: null, network: { wifi: 'unknown' }, uptime: 'unknown', timestamp: null, source: 'unavailable' };
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
