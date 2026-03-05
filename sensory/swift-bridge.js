// Bridge between Swift oneiro-sensory binary and OCA cognitive system
// Spawns the Swift binary, parses JSON events from stdout, feeds into OCA
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { pool, emit } from '../event-bus.js';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BINARY_PATH = join(__dirname, 'swift/.build/debug/oneiro-sensory');
const VISUAL_CACHE_PATH = join(__dirname, 'latest-visual-cache.json');

let process = null;
let lastHIDMetrics = {};
let lastInteroception = {};
let lastFrontApp = null;
let lastWindowTitle = null;
let eventCount = 0;

function writeVisualCache() {
  try {
    writeFileSync(VISUAL_CACHE_PATH, JSON.stringify({
      frontApp: lastFrontApp || 'unknown',
      windowTitle: lastWindowTitle || '',
      timestamp: new Date().toISOString()
    }));
  } catch {
    // Best-effort cache only.
  }
}

// Start the Swift sensory binary
export async function start() {
  try {
    process = spawn(BINARY_PATH, [], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    const rl = createInterface({ input: process.stdout });
    
    rl.on('line', async (line) => {
      try {
        const event = JSON.parse(line);
        eventCount++;
        await handleEvent(event);
      } catch {
        // Not JSON, ignore
      }
    });
    
    process.stderr.on('data', (data) => {
      console.error('[sensory-swift]', data.toString().trim());
    });
    
    process.on('exit', (code) => {
      console.log(`[sensory-swift] exited with code ${code}`);
      // Restart after 5s
      setTimeout(() => start().catch(console.error), 5000);
    });
    
    console.log('[sensory-swift] started, PID:', process.pid);
    return true;
  } catch (error) {
    console.error('[sensory-swift] failed to start:', error.message);
    return false;
  }
}

// Handle a parsed event from the Swift binary
async function handleEvent(event) {
  const { type, payload, timestamp } = event;
  
  switch (type) {
    case 'hid_metrics':
      lastHIDMetrics = payload;
      await emit('perception_update', 'sensory_swift', {
        channel: 'tactile',
        ...payload
      }, { priority: 0.3 });
      
      // Store significant typing sessions
      if (payload.keystrokes > 10) {
        await pool.query(
          `INSERT INTO sensory_events (event_type, channel, data, timestamp)
           VALUES ('hid_metrics', 'tactile', $1, $2)
           ON CONFLICT DO NOTHING`,
          [JSON.stringify(payload), timestamp]
        ).catch(() => {});
      }
      break;
      
    case 'app_switch':
      lastFrontApp = payload.newApp || payload.app || payload.name || null;
      writeVisualCache();
      await emit('perception_update', 'sensory_swift', {
        channel: 'proprioceptive',
        event: 'app_switch',
        ...payload
      }, { priority: 0.5 });
      break;
      
    case 'window_change':
      if (payload.app) lastFrontApp = payload.app;
      lastWindowTitle = payload.title || payload.windowTitle || null;
      writeVisualCache();
      await emit('perception_update', 'sensory_swift', {
        channel: 'visual',
        event: 'window_change',
        ...payload
      }, { priority: 0.3 });
      break;

    case 'screenshot_captured':
      if (payload.app) lastFrontApp = payload.app;
      if (payload.title) lastWindowTitle = payload.title;
      writeVisualCache();
      await emit('perception_update', 'sensory_swift', {
        channel: 'visual',
        event: 'screenshot_captured',
        ...payload
      }, { priority: 0.6 });
      break;
      
    case 'interoception':
      lastInteroception = payload;
      await emit('perception_update', 'sensory_swift', {
        channel: 'interoceptive',
        ...payload
      }, { priority: 0.2 });
      break;
      
    case 'user_presence':
      await emit('perception_update', 'sensory_swift', {
        channel: 'temporal',
        event: 'presence_change',
        ...payload
      }, { priority: 0.6 });
      break;
      
    case 'audio':
      await emit('perception_update', 'sensory_swift', {
        channel: 'auditory',
        ...payload
      }, { priority: 0.2 });
      break;
      
    case 'screen':
      await emit('perception_update', 'sensory_swift', {
        channel: 'visual',
        event: 'screen_state',
        ...payload
      }, { priority: 0.5 });
      break;
      
    case 'power':
      await emit('perception_update', 'sensory_swift', {
        channel: 'interoceptive',
        event: 'power_state',
        ...payload
      }, { priority: 0.7 });
      break;
      
    case 'system':
      console.log('[sensory-swift]', payload.message);
      break;
      
    case 'error':
      console.error('[sensory-swift] ERROR:', payload.message);
      break;
  }
}

// Get latest sensor data
export function getLatestHID() { return lastHIDMetrics; }
export function getLatestInteroception() { return lastInteroception; }
export function getLatestFrontApp() { return lastFrontApp; }
export function getLatestWindowTitle() { return lastWindowTitle; }
export function getEventCount() { return eventCount; }

// Stop the binary
export function stop() {
  if (process) {
    process.kill();
    process = null;
  }
}

// Create sensory_events table if it doesn't exist
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

export default { start, stop, getLatestHID, getLatestInteroception, getLatestFrontApp, getLatestWindowTitle, getEventCount, ensureTable };
