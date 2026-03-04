// OCA Motor Cortex — act in the world through the MacBook
// Keystroke synthesis, mouse control, app management, system control
import { execSync } from 'child_process';
import { pool, emit } from '../event-bus.js';

// === KEYSTROKE GENERATION ===

// Type text into the frontmost app (uses AppleScript)
export async function type(text, { speed = 'instant', app = null } = {}) {
  if (app) await activateApp(app);
  
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  
  if (speed === 'instant') {
    execSync(`osascript -e 'tell application "System Events" to keystroke "${escaped}"'`, { timeout: 5000 });
  } else {
    // Natural typing: character by character with delays
    const delay = speed === 'natural' ? 0.05 : 0.15; // natural or deliberate
    for (const char of text) {
      const c = char.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      execSync(`osascript -e 'tell application "System Events" to keystroke "${c}"'`, { timeout: 2000 });
      await sleep(delay * 1000 * (0.7 + Math.random() * 0.6)); // add jitter
    }
  }
  
  await logMotorAction('keystroke', { text: text.slice(0, 100), speed, app });
  return true;
}

// Press a key combination (e.g., cmd+s, cmd+shift+n)
export async function press(key, modifiers = [], { app = null } = {}) {
  if (app) await activateApp(app);
  
  const modMap = {
    cmd: 'command down', command: 'command down',
    shift: 'shift down',
    alt: 'option down', option: 'option down',
    ctrl: 'control down', control: 'control down'
  };
  
  const using = modifiers.map(m => modMap[m.toLowerCase()]).filter(Boolean).join(', ');
  const usingClause = using ? ` using {${using}}` : '';
  
  execSync(
    `osascript -e 'tell application "System Events" to key code ${getKeyCode(key)}${usingClause}'`,
    { timeout: 5000 }
  );
  
  await logMotorAction('keypress', { key, modifiers, app });
  return true;
}

function getKeyCode(key) {
  const codes = {
    'return': 36, 'enter': 36, 'tab': 48, 'space': 49, 'delete': 51,
    'escape': 53, 'esc': 53, 'up': 126, 'down': 125, 'left': 123, 'right': 124,
    'a': 0, 'b': 11, 'c': 8, 'd': 2, 'e': 14, 'f': 3, 'g': 5, 'h': 4,
    'i': 34, 'j': 38, 'k': 40, 'l': 37, 'm': 46, 'n': 45, 'o': 31,
    'p': 35, 'q': 12, 'r': 15, 's': 1, 't': 17, 'u': 32, 'v': 9,
    'w': 13, 'x': 7, 'y': 16, 'z': 6,
    '0': 29, '1': 18, '2': 19, '3': 20, '4': 21, '5': 23,
    '6': 22, '7': 26, '8': 28, '9': 25,
    'f1': 122, 'f2': 120, 'f3': 99, 'f4': 118, 'f5': 96, 'f6': 97,
    'f7': 98, 'f8': 100, 'f9': 101, 'f10': 109, 'f11': 103, 'f12': 111
  };
  return codes[key.toLowerCase()] ?? 0;
}

// === MOUSE CONTROL ===

export async function click(x, y, { button = 'left', doubleClick = false } = {}) {
  const clickType = doubleClick ? 'double click' : 'click';
  // Using cliclick for precise mouse control (brew install cliclick)
  try {
    const cmd = doubleClick ? `cliclick dc:${x},${y}` : `cliclick c:${x},${y}`;
    execSync(cmd, { timeout: 3000 });
  } catch {
    // Fallback to AppleScript
    execSync(`osascript -e '
      tell application "System Events"
        set position of mouse to {${x}, ${y}}
        click at {${x}, ${y}}
      end tell
    '`, { timeout: 3000 });
  }
  
  await logMotorAction('click', { x, y, button, doubleClick });
  return true;
}

export async function moveMouse(x, y, { duration = 0 } = {}) {
  try {
    execSync(`cliclick m:${x},${y}`, { timeout: 3000 });
  } catch {
    execSync(`osascript -e 'tell application "System Events" to set position of mouse to {${x}, ${y}}'`, { timeout: 3000 });
  }
  return true;
}

export async function scroll(amount, { x = null, y = null } = {}) {
  // amount: positive = up, negative = down
  const direction = amount > 0 ? 'up' : 'down';
  const steps = Math.abs(Math.round(amount));
  for (let i = 0; i < steps; i++) {
    execSync(`osascript -e 'tell application "System Events" to scroll ${direction}'`, { timeout: 2000 });
    await sleep(50);
  }
  return true;
}

// === APP CONTROL ===

export async function launchApp(appName) {
  execSync(`open -a "${appName}"`, { timeout: 10000 });
  await sleep(1000);
  await logMotorAction('launch_app', { app: appName });
  return true;
}

export async function quitApp(appName) {
  execSync(`osascript -e 'tell application "${appName}" to quit'`, { timeout: 5000 });
  await logMotorAction('quit_app', { app: appName });
  return true;
}

export async function activateApp(appName) {
  execSync(`osascript -e 'tell application "${appName}" to activate'`, { timeout: 5000 });
  await sleep(300); // let it come to front
  return true;
}

export async function hideApp(appName) {
  execSync(`osascript -e 'tell application "System Events" to set visible of process "${appName}" to false'`, { timeout: 3000 });
  return true;
}

// Get list of running apps
export function getRunningApps() {
  try {
    const raw = execSync(
      "osascript -e 'tell application \"System Events\" to get name of every application process whose background only is false'",
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    return raw.split(', ');
  } catch { return []; }
}

// === WINDOW MANAGEMENT ===

export async function resizeWindow(appName, x, y, width, height) {
  execSync(`osascript -e '
    tell application "System Events" to tell process "${appName}"
      set position of window 1 to {${x}, ${y}}
      set size of window 1 to {${width}, ${height}}
    end tell
  '`, { timeout: 5000 });
  await logMotorAction('resize_window', { app: appName, x, y, width, height });
  return true;
}

export async function minimizeWindow(appName) {
  execSync(`osascript -e '
    tell application "System Events" to tell process "${appName}"
      set value of attribute "AXMinimized" of window 1 to true
    end tell
  '`, { timeout: 5000 });
  return true;
}

// Select a menu item
export async function selectMenuItem(appName, menuPath) {
  // menuPath: ["File", "Save"] or ["Edit", "Find", "Find..."]
  let script = `tell application "System Events" to tell process "${appName}"\n`;
  script += `  tell menu bar 1\n`;
  
  for (let i = 0; i < menuPath.length; i++) {
    if (i === 0) {
      script += `    tell menu bar item "${menuPath[i]}"\n`;
      script += `      tell menu "${menuPath[i]}"\n`;
    } else if (i < menuPath.length - 1) {
      script += `        tell menu item "${menuPath[i]}"\n`;
      script += `          tell menu "${menuPath[i]}"\n`;
    } else {
      script += `            click menu item "${menuPath[i]}"\n`;
    }
  }
  
  // Close nested tells
  for (let i = menuPath.length - 1; i >= 0; i--) {
    if (i === 0) {
      script += `      end tell\n    end tell\n`;
    } else if (i < menuPath.length - 1) {
      script += `          end tell\n        end tell\n`;
    }
  }
  script += `  end tell\nend tell`;
  
  execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, { timeout: 5000 });
  await logMotorAction('menu_item', { app: appName, path: menuPath });
  return true;
}

// === SYSTEM CONTROL ===

export async function setVolume(level) {
  // level: 0-100
  execSync(`osascript -e 'set volume output volume ${Math.round(level)}'`, { timeout: 3000 });
  await logMotorAction('volume', { level });
  return true;
}

export async function setBrightness(level) {
  // level: 0.0-1.0
  execSync(`brightness ${level}`, { timeout: 3000 });
  return true;
}

export async function showNotification(title, message, { sound = 'default' } = {}) {
  const escaped = message.replace(/"/g, '\\"');
  const titleEsc = title.replace(/"/g, '\\"');
  execSync(
    `osascript -e 'display notification "${escaped}" with title "${titleEsc}"'`,
    { timeout: 5000 }
  );
  await logMotorAction('notification', { title, message });
  return true;
}

export async function openUrl(url) {
  execSync(`open "${url}"`, { timeout: 5000 });
  await logMotorAction('open_url', { url });
  return true;
}

export async function runShellCommand(command, { timeout = 10000 } = {}) {
  try {
    const output = execSync(command, { encoding: 'utf8', timeout });
    await logMotorAction('shell', { command: command.slice(0, 200), success: true });
    return output;
  } catch (e) {
    await logMotorAction('shell', { command: command.slice(0, 200), success: false, error: e.message });
    throw e;
  }
}

// === CLIPBOARD ===

export async function copyToClipboard(text) {
  execSync(`echo "${text.replace(/"/g, '\\"')}" | pbcopy`, { timeout: 3000 });
  return true;
}

export function getClipboard() {
  try {
    return execSync('pbpaste', { encoding: 'utf8', timeout: 3000 });
  } catch { return ''; }
}

// === MOTOR PLANNING (safety check before execution) ===

export async function plan(intention, actions) {
  // Before executing, check:
  // 1. Is the user currently active? (body ownership)
  // 2. Is the target correct?
  // 3. Could this be destructive?
  
  const ownership = await pool.query(
    'SELECT mode FROM body_ownership_log ORDER BY timestamp DESC LIMIT 1'
  );
  const currentMode = ownership.rows[0]?.mode || 'quinn_primary';
  
  if (currentMode === 'quinn_primary') {
    // Only non-intrusive actions allowed
    const intrusiveActions = ['keystroke', 'click', 'menu_item', 'launch_app'];
    const hasIntrusive = actions.some(a => intrusiveActions.includes(a.type));
    if (hasIntrusive) {
      return { allowed: false, reason: 'Quinn is actively using the machine', mode: currentMode };
    }
  }
  
  return { allowed: true, mode: currentMode };
}

// === LOGGING ===

async function logMotorAction(actionType, details) {
  await pool.query(
    `INSERT INTO motor_commands (action_type, details, executed_at) VALUES ($1, $2, NOW())`,
    [actionType, JSON.stringify(details)]
  ).catch(() => {
    // Table might not exist yet
    pool.query(
      `CREATE TABLE IF NOT EXISTS motor_commands (
        id SERIAL PRIMARY KEY, action_type TEXT, details JSONB, 
        executed_at TIMESTAMPTZ DEFAULT NOW(), success BOOLEAN DEFAULT TRUE
      )`
    ).then(() => {
      pool.query('INSERT INTO motor_commands (action_type, details) VALUES ($1, $2)', 
        [actionType, JSON.stringify(details)]);
    }).catch(() => {});
  });
  
  await emit('motor_feedback', 'motor', { actionType, details }, { priority: 0.4 });
}

// === HELPERS ===

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default {
  type, press, click, moveMouse, scroll,
  launchApp, quitApp, activateApp, hideApp, getRunningApps,
  resizeWindow, minimizeWindow, selectMenuItem,
  setVolume, setBrightness, showNotification, openUrl, runShellCommand,
  copyToClipboard, getClipboard, plan
};
