// OCA Sensory Cortex — multi-modal perception
// Tries Swift binary cached data first, falls back to osascript
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { emit } from '../event-bus.js';
import swiftBridge from './swift-bridge.js';
import visualMemory from './screenshot-indexer.js';

const VISUAL_CACHE_PATH = new URL('./latest-visual-cache.json', import.meta.url);
let lastVisualState = {
  frontApp: 'unknown',
  windowTitle: '',
  windowCount: 0,
  runningApps: [],
  timestamp: new Date().toISOString()
};

function normalizeFrontApp(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  if (normalized.toLowerCase() === 'unknown') return null;
  return normalized;
}

function readVisualCache() {
  try {
    if (!existsSync(VISUAL_CACHE_PATH)) return null;
    const parsed = JSON.parse(readFileSync(VISUAL_CACHE_PATH, 'utf8'));
    return {
      frontApp: normalizeFrontApp(parsed?.frontApp),
      windowTitle: String(parsed?.windowTitle || '').trim(),
      timestamp: parsed?.timestamp || null
    };
  } catch {
    return null;
  }
}

// === VISUAL PERCEPTION ===

// Get current screen state (structured, not pixels)
export function getVisualState() {
  const swiftApp = normalizeFrontApp(swiftBridge.getLatestFrontApp());
  const swiftTitle = String(swiftBridge.getLatestWindowTitle() || '').trim();
  const cached = readVisualCache();
  const fallbackApp = swiftApp || cached?.frontApp || normalizeFrontApp(lastVisualState.frontApp) || 'unknown';
  const fallbackTitle = swiftTitle || cached?.windowTitle || lastVisualState.windowTitle || '';

  let frontApp = fallbackApp;
  let windowTitle = fallbackTitle;
  let windowCount = Number(lastVisualState.windowCount || 0);
  let runningApps = Array.isArray(lastVisualState.runningApps) ? lastVisualState.runningApps : [];

  try {
    const osascriptFrontApp = execSync(
      "osascript -e 'tell application \"System Events\" to get name of first application process whose frontmost is true' 2>/dev/null",
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    frontApp = normalizeFrontApp(osascriptFrontApp) || frontApp;
  } catch {
    // keep fallbackApp
  }

  if (frontApp && frontApp !== 'unknown') {
    try {
      windowTitle = execSync(
        `osascript -e 'tell application "System Events" to get title of front window of application process "${frontApp}"' 2>/dev/null`,
        { encoding: 'utf8', timeout: 3000 }
      ).trim() || windowTitle;
    } catch {
      // keep fallbackTitle
    }

    try {
      const rawCount = execSync(
        `osascript -e 'tell application "System Events" to count windows of application process "${frontApp}"' 2>/dev/null`,
        { encoding: 'utf8', timeout: 3000 }
      ).trim();
      windowCount = parseInt(rawCount || '0') || windowCount;
    } catch {
      // keep previous count
    }
  }

  try {
    const appsRaw = execSync(
      "osascript -e 'tell application \"System Events\" to get name of every application process whose background only is false' 2>/dev/null",
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    const parsedApps = appsRaw.split(', ').filter(Boolean);
    if (parsedApps.length > 0) runningApps = parsedApps;
  } catch {
    // keep previous running apps
  }

  const result = {
    frontApp: frontApp || 'unknown',
    windowTitle,
    windowCount,
    runningApps,
    timestamp: new Date().toISOString()
  };
  if (result.frontApp !== 'unknown') lastVisualState = result;
  return result;
}

// === AUDITORY PERCEPTION ===

export function getAudioState() {
  try {
    // Check if music is playing via Now Playing
    let nowPlaying = '';
    try {
      nowPlaying = execSync(
        `/usr/bin/osascript -e 'tell application "Music" to if player state is playing then return (name of current track) & " - " & (artist of current track)' 2>/dev/null || echo ''`,
        { encoding: 'utf8', timeout: 3000 }
      ).trim();
    } catch { nowPlaying = ''; }
    
    // System volume
    let volume = '50';
    try { volume = execSync("/usr/bin/osascript -e 'output volume of (get volume settings)'", { encoding: 'utf8', timeout: 3000 }).trim(); } catch {}
    
    // Muted?
    let muted = 'false';
    try { muted = execSync("/usr/bin/osascript -e 'output muted of (get volume settings)'", { encoding: 'utf8', timeout: 3000 }).trim(); } catch {}
    
    return {
      nowPlaying: nowPlaying || null,
      volume: parseInt(volume || '50'),
      muted: muted === 'true',
      timestamp: new Date().toISOString()
    };
  } catch {
    return { nowPlaying: null, volume: 50, muted: false, timestamp: new Date().toISOString() };
  }
}

// === INTEROCEPTIVE PERCEPTION ===

export function getInteroception() {
  try {
    // Battery
    const batteryRaw = execSync("/usr/bin/pmset -g batt 2>/dev/null | /usr/bin/grep -o '[0-9]*%' | head -1 | /usr/bin/tr -d '%'", { encoding: 'utf8', timeout: 3000 }).trim();
    let charging = '0';
    try { charging = execSync("/usr/bin/pmset -g batt 2>/dev/null | /usr/bin/grep -c 'AC Power'", { encoding: 'utf8', timeout: 3000 }).trim(); } catch { charging = '0'; }
    
    // CPU
    const cpuRaw = execSync("ps -A -o %cpu | awk '{s+=$1} END {printf \"%.1f\", s}'", { encoding: 'utf8', timeout: 5000 }).trim();
    
    // Memory
    const memRaw = execSync("vm_stat | head -5", { encoding: 'utf8', timeout: 3000 }).trim();
    const freePages = memRaw.match(/Pages free:\s+(\d+)/)?.[1] || '0';
    const activePages = memRaw.match(/Pages active:\s+(\d+)/)?.[1] || '0';
    const totalUsed = parseInt(activePages) / (parseInt(freePages) + parseInt(activePages));
    
    // Disk
    const diskRaw = execSync("df -h / | tail -1 | awk '{print $5}' | tr -d '%'", { encoding: 'utf8', timeout: 3000 }).trim();
    
    // Thermal (simplified)
    let thermalPressure = 'nominal';
    try {
      thermalPressure = execSync("pmset -g therm 2>/dev/null | grep -i 'CPU_Scheduler_Limit' | awk '{print $3}'", { encoding: 'utf8', timeout: 3000 }).trim() || 'nominal';
    } catch {}
    
    return {
      battery: {
        level: parseInt(batteryRaw || '100') / 100,
        charging: charging !== '0' && charging !== ''
      },
      cpu: {
        utilization: Math.min(1, parseFloat(cpuRaw || '0') / 100),
        raw: parseFloat(cpuRaw || '0')
      },
      memory: {
        pressure: Math.min(1, totalUsed || 0)
      },
      disk: {
        used: parseInt(diskRaw || '0') / 100
      },
      thermal: {
        pressure: thermalPressure,
        throttling: thermalPressure !== 'nominal' && thermalPressure !== '100'
      },
      timestamp: new Date().toISOString()
    };
  } catch {
    return {
      battery: { level: 1, charging: false },
      cpu: { utilization: 0, raw: 0 },
      memory: { pressure: 0 },
      disk: { used: 0 },
      thermal: { pressure: 'nominal', throttling: false },
      timestamp: new Date().toISOString()
    };
  }
}

// === TEMPORAL PERCEPTION ===

export function getTemporalState() {
  const now = new Date();
  const hour = now.getHours();
  
  return {
    absolute: now.toISOString(),
    hour,
    dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
    timeOfDay: hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night',
    isWeekend: [0, 6].includes(now.getDay()),
    // Quinn's schedule awareness
    isClassTime: now.getDay() === 4 && ((hour === 9) || (hour === 12)), // Thursday 9-10am, 12-1pm
    isLateNight: hour >= 23 || hour < 8
  };
}

// === PROPRIOCEPTIVE PERCEPTION ===

export function getProprioception() {
  try {
    // Clipboard
    let clipboard = '';
    try {
      clipboard = execSync("pbpaste 2>/dev/null | head -c 200", { encoding: 'utf8', timeout: 2000 }).trim();
    } catch {}
    
    // Network
    const wifi = execSync(
      "/System/Library/PrivateFrameworks/Apple80211.framework/Resources/airport -I 2>/dev/null | grep ' SSID' | awk '{print $2}'",
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    
    // Uptime
    const uptime = execSync("uptime | awk -F'up ' '{print $2}' | awk -F',' '{print $1}'", { encoding: 'utf8', timeout: 3000 }).trim();
    
    return {
      clipboard: clipboard.slice(0, 200),
      network: { wifi: wifi || 'disconnected' },
      uptime,
      timestamp: new Date().toISOString()
    };
  } catch {
    return { clipboard: '', network: { wifi: 'unknown' }, uptime: 'unknown', timestamp: new Date().toISOString() };
  }
}

// === INTEGRATED PERCEPTUAL STATE ===

export function getFullPerception() {
  const visual = getVisualState();
  const audio = getAudioState();
  const intero = getInteroception();
  const temporal = getTemporalState();
  const proprio = getProprioception();
  
  // Derive user state
  let userActivity = 'idle';
  if (visual.frontApp === 'Terminal' || visual.frontApp === 'Cursor' || visual.frontApp === 'Xcode') {
    userActivity = 'coding';
  } else if (visual.frontApp === 'Arc' || visual.frontApp === 'Safari' || visual.frontApp === 'Chrome') {
    userActivity = 'browsing';
  } else if (visual.frontApp === 'Logic Pro' || visual.frontApp === 'GarageBand') {
    userActivity = 'creating';
  } else if (visual.frontApp === 'Messages' || visual.frontApp === 'Telegram' || visual.frontApp === 'Discord') {
    userActivity = 'communicating';
  } else if (visual.frontApp === 'Preview' || visual.frontApp === 'Books' || visual.frontApp === 'Notion') {
    userActivity = 'reading';
  }
  
  return {
    visual,
    audio,
    interoceptive: intero,
    temporal,
    proprioceptive: proprio,
    derived: {
      userActivity,
      environmentStability: 'stable', // TODO: track change rate
    }
  };
}

// Store a perceptual snapshot as an event
export async function captureAndStore() {
  const perception = getFullPerception();
  
  await emit('perception_update', 'sensory', perception, { priority: 0.3 });
  
  return perception;
}

// Vision analysis — analyze screenshot with Claude for deep context
let lastVisionAnalysis = null;
let lastVisionTime = 0;
const VISION_COOLDOWN_MS = 60000; // analyze at most once per minute

export async function analyzeScreenshot() {
  const now = Date.now();
  if (now - lastVisionTime < VISION_COOLDOWN_MS && lastVisionAnalysis) {
    return lastVisionAnalysis;
  }

  try {
    const latest = await visualMemory.getLatestVisualMemory();
    if (!latest) return lastVisionAnalysis;

    const screenshotFile = String(latest.filepath || '').split('/').pop() || null;
    lastVisionAnalysis = {
      description: latest.description || 'No indexed screenshot description available.',
      contentSummary: latest.content_summary || null,
      app: latest.front_app || null,
      windowTitle: latest.window_title || null,
      url: latest.url || null,
      activityType: latest.activity_type || null,
      timestamp: latest.captured_at ? new Date(latest.captured_at).toISOString() : new Date().toISOString(),
      screenshotFile,
      screenshotPath: latest.filepath || null,
      fileRetained: latest.file_retained !== false,
      source: latest.metadata?.source || null
    };
    lastVisionTime = now;

    return lastVisionAnalysis;
  } catch (e) {
    console.error('[perception] indexed vision lookup failed:', e.message);
    return lastVisionAnalysis; // return stale if available
  }
}

export function getLastVisionAnalysis() {
  return lastVisionAnalysis;
}

export default { 
  getVisualState, getAudioState, getInteroception, getTemporalState, 
  getProprioception, getFullPerception, captureAndStore,
  analyzeScreenshot, getLastVisionAnalysis
};
