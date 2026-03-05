// OCA Sensory Cortex — multi-modal perception
// Tries Swift binary cached data first, falls back to osascript
import { execSync } from 'child_process';
import { pool, emit } from '../event-bus.js';
import swiftBridge from './swift-bridge.js';

// === VISUAL PERCEPTION ===

// Get current screen state (structured, not pixels)
export function getVisualState() {
  // Try Swift binary cached data first (works in launchd)
  const swiftApp = swiftBridge.getLatestFrontApp();
  const swiftTitle = swiftBridge.getLatestWindowTitle();
  
  try {
    // Try osascript for full data (works in interactive shells)
    const frontApp = execSync(
      "osascript -e 'tell application \"System Events\" to get name of first application process whose frontmost is true'",
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    
    const windowTitle = execSync(
      `osascript -e 'tell application "System Events" to get title of front window of application process "${frontApp}"' 2>/dev/null`,
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    
    const windowCount = execSync(
      `osascript -e 'tell application "System Events" to count windows of application process "${frontApp}"' 2>/dev/null`,
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    
    const runningApps = execSync(
      "osascript -e 'tell application \"System Events\" to get name of every application process whose background only is false'",
      { encoding: 'utf8', timeout: 3000 }
    ).trim().split(', ');
    
    return {
      frontApp,
      windowTitle,
      windowCount: parseInt(windowCount || '0'),
      runningApps,
      timestamp: new Date().toISOString()
    };
  } catch (e) {
    // osascript failed (launchd context) — use Swift binary data
    return { 
      frontApp: swiftApp || 'unknown', 
      windowTitle: swiftTitle || '', 
      windowCount: 0, 
      runningApps: [], 
      timestamp: new Date().toISOString() 
    };
  }
}

// === AUDITORY PERCEPTION ===

export function getAudioState() {
  try {
    // Check if music is playing via Now Playing
    const nowPlaying = execSync(
      "osascript -e 'tell application \"Music\" to if player state is playing then get {name of current track, artist of current track} as string' 2>/dev/null || echo ''",
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    
    // System volume
    const volume = execSync(
      "osascript -e 'output volume of (get volume settings)'",
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    
    // Muted?
    const muted = execSync(
      "osascript -e 'output muted of (get volume settings)'",
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    
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
    const batteryRaw = execSync("pmset -g batt 2>/dev/null | grep -o '[0-9]*%' | head -1 | tr -d '%'", { encoding: 'utf8', timeout: 3000 }).trim();
    const charging = execSync("pmset -g batt 2>/dev/null | grep -o 'AC Power'", { encoding: 'utf8', timeout: 3000 }).trim();
    
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
        charging: charging.includes('AC')
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

export default { 
  getVisualState, getAudioState, getInteroception, getTemporalState, 
  getProprioception, getFullPerception, captureAndStore 
};
