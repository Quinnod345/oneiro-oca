// OCA Motor Cortex — SPEC §6
// Motor planning pipeline with sensorimotor verification loop.
// Sends commands to the Swift oneiro-motor binary via Unix domain socket.
// Fallback: AppleScript (backward compat when binary unavailable).

import net from 'net';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { pool, emit, readPerceptualState } from '../event-bus.js';
import procedural from '../memory/procedural.js';

const MOTOR_SOCKET = '/tmp/oneiro-motor.sock';
let socketConnected = false;
let motorSocket = null;
let pendingCallbacks = new Map();
let cmdCounter = 0;

// ═══════════════════════════════════════════════════
// SOCKET CONNECTION TO SWIFT MOTOR BINARY
// ═══════════════════════════════════════════════════

function ensureSocket() {
  if (socketConnected && motorSocket) return Promise.resolve();

  return new Promise((resolve) => {
    if (!existsSync(MOTOR_SOCKET)) { resolve(); return; }

    motorSocket = net.createConnection(MOTOR_SOCKET);
    let buffer = '';

    motorSocket.on('connect', () => {
      socketConnected = true;
      console.log('[motor] connected to oneiro-motor via socket');
      resolve();
    });

    motorSocket.on('data', (chunk) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const result = JSON.parse(line);
          const cmdId = result.command_id;
          if (cmdId && pendingCallbacks.has(cmdId)) {
            pendingCallbacks.get(cmdId)(result);
            pendingCallbacks.delete(cmdId);
          }
        } catch {}
      }
    });

    motorSocket.on('error', () => { socketConnected = false; resolve(); });
    motorSocket.on('close', () => { socketConnected = false; motorSocket = null; });

    setTimeout(() => { if (!socketConnected) resolve(); }, 2000);
  });
}

function sendMotorCommand(command) {
  return new Promise(async (resolve, reject) => {
    await ensureSocket();
    if (!socketConnected || !motorSocket) {
      resolve({ success: false, error: 'Motor binary not connected', fallback: true });
      return;
    }

    const id = `cmd_${++cmdCounter}_${Date.now()}`;
    command.id = id;
    const timeout = setTimeout(() => {
      pendingCallbacks.delete(id);
      resolve({ success: false, error: 'Motor command timed out', command_id: id });
    }, 10000);

    pendingCallbacks.set(id, (result) => {
      clearTimeout(timeout);
      resolve(result);
    });

    try {
      motorSocket.write(JSON.stringify(command) + '\n');
    } catch (e) {
      clearTimeout(timeout);
      pendingCallbacks.delete(id);
      resolve({ success: false, error: e.message, fallback: true });
    }
  });
}

// ═══════════════════════════════════════════════════
// MOTOR PLANNING PIPELINE (SPEC §6.3)
// Intention -> Plan -> Safety -> Body Ownership -> Execute -> Verify -> Error Handle
// ═══════════════════════════════════════════════════

export async function plan(intention, options = {}) {
  const { force = false, skipVerification = false } = options;

  // 0. REFUSAL PROTOCOL (SPEC §17.5)
  // Check if this action should be refused on ethical/safety grounds
  if (!force) {
    const refusalCheck = await checkRefusal(intention);
    if (refusalCheck.refused) {
      try {
        await pool.query(
          `INSERT INTO identity_events (event_type, is_continuation, operating_time_at_ms, description, metadata)
           VALUES ('refusal', true, 0, $1, $2)`,
          [refusalCheck.reason, JSON.stringify({ intention: intention.action, parameters: intention.parameters })]
        );
      } catch {}
      await emit('motor_feedback', 'motor', {
        event: 'refusal', intention, reason: refusalCheck.reason
      }, { priority: 0.7 }).catch(() => {});
      return { executed: false, refused: true, reason: refusalCheck.reason };
    }
  }

  // 1. SAFETY CHECK: will this interrupt the user?
  if (!force) {
    const ownership = await getBodyOwnership();
    if (ownership === 'quinn_primary') {
      const perception = readPerceptualState();
      const idleSeconds = perception?.temporal?.relative?.since_user_interaction_s ?? 0;
      if (idleSeconds < 5) {
        return { executed: false, reason: 'user_active', ownership, idle_seconds: idleSeconds };
      }
    }
  }

  // 2. Record prediction in prediction_ledger
  let ledgerEntry = null;
  if (intention.expected_outcome) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO prediction_ledger (action_source, action_type, action_details, expected_outcome, confidence, status)
         VALUES ('motor', $1, $2, $3, $4, 'pending') RETURNING id`,
        [intention.action, JSON.stringify(intention), intention.expected_outcome, intention.confidence || 0.7]
      );
      ledgerEntry = rows[0];
    } catch {}
  }

  // 3. Capture pre-action sensory state
  const preState = readPerceptualState();

  // 4. EXECUTE via Swift binary or fallback
  let result;
  const command = {
    action: intention.action,
    parameters: intention.parameters || {},
    capture_after: !skipVerification
  };

  result = await sendMotorCommand(command);

  if (result.fallback) {
    result = await executeFallback(intention);
  }

  // 5. Log motor action
  await emit('motor_feedback', 'motor', {
    intention,
    result,
    pre_state_app: preState?.visual?.active_app,
    timestamp: new Date().toISOString()
  }, { priority: 0.4 }).catch(() => {});

  // 6. SENSORIMOTOR VERIFICATION (SPEC §6.4)
  if (!skipVerification && result.success) {
    const verification = await verifySensorimotor(intention, preState, result);
    result.verification = verification;

    // Update prediction ledger
    if (ledgerEntry) {
      try {
        await pool.query(
          `UPDATE prediction_ledger SET status = $1, observed_outcome = $2, success = $3,
           prediction_error = $4, observed_at = NOW() WHERE id = $5`,
          [
            verification.match ? 'confirmed' : 'refuted',
            JSON.stringify(verification),
            verification.match,
            verification.error || 0,
            ledgerEntry.id
          ]
        );
      } catch {}
    }

    // 7. ERROR HANDLING: retry on mismatch
    if (!verification.match && !options.isRetry) {
      console.log('[motor] sensorimotor mismatch, retrying...');
      await emit('motor_feedback', 'motor', {
        event: 'verification_failed',
        intention,
        expected: intention.expected_outcome,
        actual: verification.actual,
        error: verification.error
      }, { priority: 0.6 }).catch(() => {});

      return plan(intention, { ...options, isRetry: true, skipVerification: false });
    }
  }

  // B1: Close the sensorimotor-to-skill loop (SPEC §2.8 maintenance)
  // If this action matched a procedural memory, record the execution outcome
  try {
    const triggerState = { action: intention.action, app: intention.parameters?.app, ...intention.parameters };
    const matched = await procedural.match(triggerState);
    if (matched.length > 0) {
      const success = result.verification?.match !== false;
      await procedural.recordExecution(matched[0].id, success);
    }
  } catch {}

  return { executed: true, result };
}

async function verifySensorimotor(intention, preState, result) {
  // Wait for sensory state to update
  await new Promise(r => setTimeout(r, 200));
  const postState = readPerceptualState();

  const postSnapshot = result.sensory_snapshot || {};
  const verification = {
    match: true,
    pre_app: preState?.visual?.active_app,
    post_app: postSnapshot.front_app || postState?.visual?.active_app,
    actual: postSnapshot,
    error: 0
  };

  if (intention.expected_outcome) {
    const expected = intention.expected_outcome;
    if (expected.app && postSnapshot.front_app && expected.app !== postSnapshot.front_app) {
      verification.match = false;
      verification.error = 0.5;
      verification.mismatch = `Expected app ${expected.app}, got ${postSnapshot.front_app}`;
    }
    if (expected.window_title && postSnapshot.window_title &&
        !postSnapshot.window_title.includes(expected.window_title)) {
      verification.match = false;
      verification.error = 0.3;
      verification.mismatch = `Expected title containing "${expected.window_title}"`;
    }
  }

  return verification;
}

// ═══════════════════════════════════════════════════
// APPLESCRIPT FALLBACK (when Swift motor binary unavailable)
// ═══════════════════════════════════════════════════

async function executeFallback(intention) {
  const { action, parameters = {} } = intention;

  try {
    switch (action) {
      case 'type': {
        const text = parameters.text || '';
        execSync(`osascript -e 'tell application "System Events" to keystroke "${text.replace(/"/g, '\\"')}"'`, { timeout: 5000 });
        return { success: true, fallback: true };
      }
      case 'press': {
        const keyCode = parameters.key_code;
        const mods = parameters.modifiers || [];
        let using = mods.map(m => `${m} down`).join(', ');
        if (using) using = ` using {${using}}`;
        execSync(`osascript -e 'tell application "System Events" to key code ${keyCode}${using}'`, { timeout: 5000 });
        return { success: true, fallback: true };
      }
      case 'launch': {
        execSync(`open -b "${parameters.bundle_id}"`, { timeout: 5000 });
        return { success: true, fallback: true };
      }
      case 'activate': {
        execSync(`osascript -e 'tell application "${parameters.app}" to activate'`, { timeout: 5000 });
        return { success: true, fallback: true };
      }
      case 'applescript': {
        const output = execSync(`osascript -e '${parameters.script}'`, { encoding: 'utf8', timeout: 10000 }).trim();
        return { success: true, output, fallback: true };
      }
      case 'volume': {
        execSync(`osascript -e 'set volume output volume ${parameters.level}'`, { timeout: 3000 });
        return { success: true, fallback: true };
      }
      case 'notify': {
        execSync(`osascript -e 'display notification "${(parameters.body || '').replace(/"/g, '\\"')}" with title "${(parameters.title || '').replace(/"/g, '\\"')}"'`, { timeout: 3000 });
        return { success: true, fallback: true };
      }
      case 'open_url': {
        execSync(`open "${parameters.url}"`, { timeout: 3000 });
        return { success: true, fallback: true };
      }
      default:
        return { success: false, error: `Fallback: unknown action ${action}` };
    }
  } catch (e) {
    return { success: false, error: e.message, fallback: true };
  }
}

// ═══════════════════════════════════════════════════
// BODY OWNERSHIP QUERY
// ═══════════════════════════════════════════════════

async function getBodyOwnership() {
  try {
    const { rows } = await pool.query(
      'SELECT mode FROM body_ownership_log ORDER BY timestamp DESC LIMIT 1'
    );
    return rows[0]?.mode || 'shared';
  } catch {
    return 'shared';
  }
}

// ═══════════════════════════════════════════════════
// HIGH-LEVEL MOTOR ACTIONS (convenience wrappers)
// ═══════════════════════════════════════════════════

export async function type(text, speed = 'instant') {
  return plan({ action: 'type', parameters: { text, speed } });
}

export async function press(keyCode, modifiers = []) {
  return plan({ action: 'press', parameters: { key_code: keyCode, modifiers } });
}

export async function click(x, y, button = 'left') {
  return plan({ action: 'click', parameters: { x, y, button } });
}

export async function launch(bundleId) {
  return plan({ action: 'launch', parameters: { bundle_id: bundleId } });
}

export async function activate(appName) {
  return plan({ action: 'activate', parameters: { app: appName } });
}

export async function notify(title, body) {
  return plan({ action: 'notify', parameters: { title, body }, skipVerification: true }, { force: true });
}

export async function applescript(script) {
  return plan({ action: 'applescript', parameters: { script } });
}

export async function setVolume(level) {
  return plan({ action: 'volume', parameters: { level } }, { force: true });
}

export async function openUrl(url) {
  return plan({ action: 'open_url', parameters: { url } });
}

export async function snapshot() {
  const result = await sendMotorCommand({ action: 'snapshot' });
  if (result.fallback) {
    const visual = readPerceptualState()?.visual || {};
    return { front_app: visual.active_app, window_title: visual.active_window?.title };
  }
  return result;
}

export function isConnected() { return socketConnected; }

// §17.5 Right of Refusal: actions that violate privacy, consent, or are high-risk + low-verifiability
async function checkRefusal(intention) {
  const action = intention.action;
  const params = intention.parameters || {};

  // Refuse actions that access private browsing content
  if (action === 'type' || action === 'click') {
    const perception = readPerceptualState();
    const frontApp = perception?.visual?.active_app || '';
    const windowTitle = perception?.visual?.active_window?.title || '';
    if (/private|incognito/i.test(windowTitle)) {
      return { refused: true, reason: 'Action targets private browsing window (§21.1 privacy boundary)' };
    }
  }

  // Refuse destructive system operations without explicit force flag
  if (action === 'applescript') {
    const script = (params.script || '').toLowerCase();
    if (/delete|remove|erase|format|wipe/i.test(script) && /disk|volume|drive|all/i.test(script)) {
      return { refused: true, reason: 'Potentially destructive system operation requires explicit force flag' };
    }
  }

  // Refuse actions metacognition has flagged as high-risk
  try {
    const { rows } = await pool.query(
      `SELECT description FROM metacognitive_observations
       WHERE observation_type = 'high_risk_flag'
         AND evidence->>'action' = $1
         AND timestamp > NOW() - INTERVAL '1 hour'
       LIMIT 1`,
      [action]
    );
    if (rows.length > 0) {
      return { refused: true, reason: `Metacognition flagged as high-risk: ${rows[0].description}` };
    }
  } catch {}

  return { refused: false };
}

export default {
  plan, type, press, click, launch, activate, notify,
  applescript, setVolume, openUrl, snapshot, isConnected
};
