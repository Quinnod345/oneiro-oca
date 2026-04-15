// Bridge between Swift oneiro-sensory process and OCA cognitive system
// In multi-process mode: connects to sensory via Unix socket + reads shared state
// Fallback: spawns as child process (backward compat)
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { pool, emit, connectSocket, readPerceptualState } from '../event-bus.js';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import net from 'net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BINARY_PATH_RELEASE = join(__dirname, 'swift/.build/release/oneiro-sensory');
const BINARY_PATH_DEBUG = join(__dirname, 'swift/.build/debug/oneiro-sensory');
const BINARY_PATH = existsSync(BINARY_PATH_RELEASE) ? BINARY_PATH_RELEASE : BINARY_PATH_DEBUG;
const SOCKET_PATH = '/tmp/oneiro-sensory.sock';

/** After socket close or child exit, OCA used to always respawn sensory in 5s — killing the PID never stuck. */
function isSensoryAutorestartEnabled() {
  const ar = process.env.OCA_SENSORY_AUTORESTART;
  if (ar != null && String(ar).trim() !== '') {
    const v = String(ar).trim().toLowerCase();
    if (['0', 'false', 'no', 'off'].includes(v)) return false;
    if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  }
  const cap = process.env.ONEIRO_DISABLE_SCREEN_CAPTURE;
  if (cap == null || String(cap).trim() === '') {
    return false;
  }
  const capV = String(cap).trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(capV)) return true;
  return false;
}

function scheduleSensoryReconnect() {
  if (!isSensoryAutorestartEnabled()) {
    console.log('[sensory-bridge] not respawning sensory (set ONEIRO_DISABLE_SCREEN_CAPTURE=0 or OCA_SENSORY_AUTORESTART=1 to auto-restart after exit)');
    return;
  }
  setTimeout(() => start().catch(console.error), 5000);
}

let childProcess = null;
let socketClient = null;
let lastHIDMetrics = {};
let lastInteroception = {};
let lastFrontApp = null;
let lastWindowTitle = null;
let eventCount = 0;
let mode = 'disconnected'; // 'socket' | 'child' | 'disconnected'

// Try connecting to an already-running sensory process via socket first.
// If that fails, spawn as child process (backward compat).
export async function start() {
  if (await trySocketConnect()) {
    mode = 'socket';
    console.log('[sensory-bridge] connected via Unix socket (multi-process mode)');
    return true;
  }
  return startAsChild();
}

async function trySocketConnect() {
  return new Promise((resolve) => {
    if (!existsSync(SOCKET_PATH)) { resolve(false); return; }
    const socket = net.createConnection(SOCKET_PATH);
    const timeout = setTimeout(() => { socket.destroy(); resolve(false); }, 2000);

    socket.on('connect', () => {
      clearTimeout(timeout);
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try {
            const event = JSON.parse(line);
            eventCount++;
            handleEvent(event).catch(() => {});
          } catch {}
        }
      });
      socket.on('error', () => {});
      socket.on('close', () => {
        console.log('[sensory-bridge] socket closed');
        mode = 'disconnected';
        socketClient = null;
        scheduleSensoryReconnect();
      });
      socketClient = socket;
      resolve(true);
    });

    socket.on('error', () => { clearTimeout(timeout); resolve(false); });
  });
}

function startAsChild() {
  try {
    // Inherit process.env (../.env via npm start).
    // Screen capture: ONEIRO_DISABLE_SCREEN_CAPTURE=1 for DRM without SCStream.
    // Microphone: off by default; ONEIRO_ENABLE_MIC_CAPTURE=1 in .env to enable (avoids speaker crackle; LaunchAgent uses run-sensory.sh).
    childProcess = spawn(BINARY_PATH, [], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } });
    mode = 'child';

    const rl = createInterface({ input: childProcess.stdout });
    rl.on('line', async (line) => {
      try {
        const event = JSON.parse(line);
        eventCount++;
        await handleEvent(event);
      } catch {}
    });

    childProcess.stderr.on('data', (data) => {
      console.error('[sensory-swift]', data.toString().trim());
    });

    childProcess.on('exit', (code, signal) => {
      console.log(`[sensory-swift] exited with code ${code}, signal ${signal}`);
      mode = 'disconnected';
      childProcess = null;
      scheduleSensoryReconnect();
    });

    console.log('[sensory-bridge] started as child process, PID:', childProcess.pid);
    return true;
  } catch (error) {
    console.error('[sensory-bridge] failed to start:', error.message);
    return false;
  }
}

async function handleEvent(event) {
  const { type, payload, timestamp } = event;

  switch (type) {
    case 'hid_metrics':
      lastHIDMetrics = payload;
      await emit('perception_update', 'sensory_swift', {
        channel: 'tactile', ...payload
      }, { priority: 0.3 }).catch(() => {});
      await pool.query(
        `INSERT INTO sensory_events (event_type, channel, data, timestamp)
         VALUES ('hid_metrics', 'tactile', $1, $2) ON CONFLICT DO NOTHING`,
        [JSON.stringify(payload), timestamp]
      ).catch(() => {});
      break;

    case 'app_switch':
      lastFrontApp = payload.app || payload.newApp || null;
      await emit('perception_update', 'sensory_swift', {
        channel: 'proprioceptive', event: 'app_switch', ...payload
      }, { priority: 0.5 }).catch(() => {});
      break;

    case 'window_change':
      if (payload.app) lastFrontApp = payload.app;
      lastWindowTitle = payload.title || null;
      await emit('perception_update', 'sensory_swift', {
        channel: 'visual', event: 'window_change', ...payload
      }, { priority: 0.3 }).catch(() => {});
      break;

    case 'screenshot_captured':
      if (payload.app) lastFrontApp = payload.app;
      if (payload.title) lastWindowTitle = payload.title;
      await emit('perception_update', 'sensory_swift', {
        channel: 'visual', event: 'screenshot_captured', ...payload
      }, { priority: 0.6 }).catch(() => {});
      break;

    case 'perception_update':
      // Full integrated perception from sensory integrator
      await emit('perception_update', 'sensory_integrated', payload, { priority: 0.4 }).catch(() => {});
      break;

    case 'interoception':
      lastInteroception = payload;
      await emit('perception_update', 'sensory_swift', {
        channel: 'interoceptive', ...payload
      }, { priority: 0.2 }).catch(() => {});
      break;

    case 'user_presence':
      await emit('perception_update', 'sensory_swift', {
        channel: 'temporal', event: 'presence_change', ...payload
      }, { priority: 0.6 }).catch(() => {});
      break;

    case 'audio_now_playing':
    case 'audio_vad':
      await emit('perception_update', 'sensory_swift', {
        channel: 'auditory', ...payload
      }, { priority: 0.2 }).catch(() => {});
      break;

    case 'visual_change':
      await emit('perception_update', 'sensory_swift', {
        channel: 'visual', event: 'frame_change', ...payload
      }, { priority: 0.3 }).catch(() => {});
      break;

    case 'screen':
      await emit('perception_update', 'sensory_swift', {
        channel: 'visual', event: 'screen_state', ...payload
      }, { priority: 0.5 }).catch(() => {});
      break;

    case 'power':
      await emit('perception_update', 'sensory_swift', {
        channel: 'interoceptive', event: 'power_state', ...payload
      }, { priority: 0.7 }).catch(() => {});
      break;

    case 'system':
      console.log('[sensory-swift]', payload.message);
      break;

    case 'error':
      console.error('[sensory-swift] ERROR:', payload.message);
      break;
  }
}

// Getters: prefer fresh shared state file, fall back to cached event data
export function getFullPerception() {
  const shared = readPerceptualState();
  if (shared && shared.timestamp) {
    const age = Date.now() - new Date(shared.timestamp).getTime();
    if (age < 30000) return shared; // file is fresh (< 30s)
  }

  // Build from cached event data (updated by socket/stdout events)
  const app = lastFrontApp || 'unknown';
  const hasRecentEvents = eventCount > 0;
  const hid = lastHIDMetrics || {};
  const isTyping = (hid.wpm || 0) > 5;
  const isClicking = (hid.clicks || 0) > 0;

  let userActivity = 'idle';
  if (isTyping && isClicking) userActivity = 'coding';
  else if (isTyping) userActivity = 'typing';
  else if (isClicking) userActivity = 'browsing';
  else if (hasRecentEvents) userActivity = 'reading';

  return {
    timestamp: new Date().toISOString(),
    visual: { active_app: app, active_window: { title: lastWindowTitle || '' }, frontApp: app },
    auditory: {},
    tactile: hid,
    proprioceptive: {},
    interoceptive: lastInteroception || {},
    temporal: {},
    user_presence: hasRecentEvents ? 'active' : 'unknown',
    user_activity: userActivity,
    environment_stability: 'unknown',
    attention_target: app,
    surprises: []
  };
}

export function getLatestHID() { return lastHIDMetrics; }
export function getLatestInteroception() { return lastInteroception; }
export function getLatestFrontApp() { return lastFrontApp; }
export function getLatestWindowTitle() { return lastWindowTitle; }
export function getEventCount() { return eventCount; }
export function getMode() { return mode; }

export function stop() {
  if (socketClient) { try { socketClient.destroy(); } catch {} socketClient = null; }
  if (childProcess) { childProcess.kill(); childProcess = null; }
  mode = 'disconnected';
}

export async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sensory_events (
      id SERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      channel TEXT NOT NULL,
      data JSONB DEFAULT '{}',
      timestamp TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_se_type_time ON sensory_events (event_type, timestamp DESC);
  `).catch(() => {});
}

export default {
  start, stop, getFullPerception,
  getLatestHID, getLatestInteroception, getLatestFrontApp, getLatestWindowTitle,
  getEventCount, getMode, ensureTable
};
