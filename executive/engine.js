// OCA Executive Control — the conductor (SPEC §14, §17)
// Zero-sum attention allocation, goal management, cognitive load balancing,
// global workspace broadcast, 5-mode sleep/wake, body ownership protocol.
import { pool, emit, on } from '../event-bus.js';
import emotion from '../emotion/engine.js';
import cohabitation from '../cohabitation.js';

// ═══════════════════════════════════════════════════
// WORKING MEMORY / GLOBAL WORKSPACE (SPEC §14.6, §7.6)
// ═══════════════════════════════════════════════════

const MAX_WORKING_MEMORY = 7; // Miller's Law
const WM_DECAY_PER_MINUTE = 0.18;

export async function addToWorkspace(contentType, content, sourceLayer, salience = 0.5) {
  const { rows: active } = await pool.query(
    'SELECT id, salience FROM working_memory WHERE is_active ORDER BY salience ASC'
  );

  if (active.length >= MAX_WORKING_MEMORY) {
    const evict = active[0];
    if (salience > evict.salience) {
      await pool.query(
        'UPDATE working_memory SET is_active = FALSE, deactivated_at = NOW() WHERE id = $1',
        [evict.id]
      );
    } else {
      return null;
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO working_memory (content_type, content, source_layer, salience)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [contentType, JSON.stringify(content), sourceLayer, salience]
  );

  const item = { id: rows[0].id, contentType, content, salience };

  // GLOBAL WORKSPACE BROADCAST (SPEC §14.6)
  // Every layer gets notified when something enters the workspace
  await emit('workspace_broadcast', 'executive', {
    action: 'add', item,
    responses_requested: [
      'perception', 'memory', 'emotion', 'hypothesis',
      'simulation', 'metacognition', 'deliberation', 'creative'
    ]
  });

  return rows[0].id;
}

export async function getWorkspace() {
  const { rows } = await pool.query(
    'SELECT * FROM working_memory WHERE is_active ORDER BY salience DESC LIMIT $1',
    [MAX_WORKING_MEMORY]
  );
  return rows.map(r => ({
    ...r,
    content: typeof r.content === 'string' ? (() => { try { return JSON.parse(r.content); } catch { return r.content; } })() : r.content
  }));
}

export async function decayWorkspace(decayAmount = null) {
  const decay = decayAmount ?? WM_DECAY_PER_MINUTE;
  await pool.query(
    `UPDATE working_memory SET salience = GREATEST(0, salience - $1) WHERE is_active`,
    [decay]
  );
  await pool.query(
    `UPDATE working_memory SET is_active = FALSE, deactivated_at = NOW()
     WHERE is_active AND salience <= 0.15`
  );
}

export async function clearWorkspace() {
  await pool.query('UPDATE working_memory SET is_active = FALSE, deactivated_at = NOW() WHERE is_active');
}

// ═══════════════════════════════════════════════════
// GOAL MANAGEMENT (SPEC §14.3)
// ═══════════════════════════════════════════════════

export async function addGoal(description, { goalType = 'session', priority = 0.5, parentGoal = null, deadline = null, emotionalInvestment = 0.5 } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO goals (description, goal_type, priority, parent_goal, deadline, emotional_investment)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [description, goalType, priority, parentGoal, deadline, emotionalInvestment]
  );

  if (parentGoal) {
    await pool.query(
      `UPDATE goals SET child_goals = array_append(child_goals, $1) WHERE id = $2`,
      [rows[0].id, parentGoal]
    );
  }

  return rows[0].id;
}

export async function updateGoalProgress(goalId, progress, status = null) {
  const updates = ['progress = $1'];
  const params = [progress, goalId];

  if (status) {
    updates.push(`status = $${params.length + 1}`);
    params.push(status);
  }

  if (progress >= 1.0) {
    updates.push("status = 'completed'");
    const { rows: [goal] } = await pool.query('SELECT emotional_investment FROM goals WHERE id = $1', [goalId]);
    if (goal) emotion.processSuccess(goal.emotional_investment);
  }

  await pool.query(`UPDATE goals SET ${updates.join(', ')} WHERE id = $2`, params);
}

export async function getActiveGoals() {
  const { rows } = await pool.query(
    `SELECT * FROM goals WHERE status = 'active' ORDER BY priority DESC`
  );
  return rows;
}

export async function getGoalTree(rootId = null) {
  if (rootId) {
    const { rows } = await pool.query(
      `WITH RECURSIVE goal_tree AS (
         SELECT * FROM goals WHERE id = $1
         UNION ALL
         SELECT g.* FROM goals g JOIN goal_tree gt ON g.parent_goal = gt.id
       ) SELECT * FROM goal_tree ORDER BY priority DESC`,
      [rootId]
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT * FROM goals WHERE parent_goal IS NULL AND status = 'active' ORDER BY priority DESC`
  );
  return rows;
}

// ═══════════════════════════════════════════════════
// ATTENTION ALLOCATION — zero-sum budget (SPEC §14.2)
// ═══════════════════════════════════════════════════

const ATTENTION_BUDGET = 1.0;

const MODE_DEFAULT_ALLOCATION = {
  alert:         { perception: 0.25, reasoning: 0.20, conversation: 0.30, background: 0.05, creative: 0.05, motor: 0.15 },
  monitoring:    { perception: 0.35, reasoning: 0.15, conversation: 0.10, background: 0.20, creative: 0.10, motor: 0.10 },
  working:       { perception: 0.15, reasoning: 0.35, conversation: 0.05, background: 0.10, creative: 0.15, motor: 0.20 },
  consolidating: { perception: 0.10, reasoning: 0.10, conversation: 0.05, background: 0.05, creative: 0.30, motor: 0.05, consolidation: 0.35 },
  dormant:       { perception: 0.05, reasoning: 0.05, conversation: 0.00, background: 0.05, creative: 0.40, motor: 0.00, consolidation: 0.45 },
};

let currentAllocation = { ...MODE_DEFAULT_ALLOCATION.alert };
let currentFocus = 'idle';
let currentFocusType = 'none';

export function getAllocation() { return { ...currentAllocation }; }

export async function setAttention(primaryFocus, focusType, allocation = null) {
  currentFocus = primaryFocus;
  currentFocusType = focusType;

  if (allocation) {
    // Normalize to zero-sum
    const raw = { ...allocation };
    const total = Object.values(raw).reduce((s, v) => s + v, 0);
    if (total > 0) {
      for (const k of Object.keys(raw)) raw[k] = (raw[k] / total) * ATTENTION_BUDGET;
    }
    currentAllocation = raw;
  }

  await pool.query(
    `INSERT INTO attention_log (primary_focus, focus_type, allocation)
     VALUES ($1, $2, $3)`,
    [primaryFocus, focusType, JSON.stringify(currentAllocation)]
  ).catch(() => {});
}

export async function getCurrentAttention() {
  return {
    primary_focus: currentFocus,
    focus_type: currentFocusType,
    allocation: { ...currentAllocation },
    budget: ATTENTION_BUDGET
  };
}

function applyModeAllocation(mode) {
  currentAllocation = { ...(MODE_DEFAULT_ALLOCATION[mode] || MODE_DEFAULT_ALLOCATION.alert) };
}

// ═══════════════════════════════════════════════════
// BODY OWNERSHIP (SPEC §17.2–17.4)
// ═══════════════════════════════════════════════════

let currentOwnership = 'quinn_primary';
let lastKeystrokeTime = Date.now();
let collaborativeMode = false;

export async function setBodyOwnership(mode, reason = '') {
  const prevMode = currentOwnership;
  currentOwnership = mode;
  await pool.query(
    `INSERT INTO body_ownership_log (mode, reason, quinn_active, oneiro_active)
     VALUES ($1, $2, $3, $4)`,
    [mode, reason,
     ['quinn_primary', 'shared', 'collaborative'].includes(mode),
     ['oneiro_primary', 'shared', 'collaborative'].includes(mode)]
  ).catch(() => {});
  await emit('body_ownership_change', 'executive', { mode, reason }).catch(() => {});
  // §17.5: log convention drift
  cohabitation.recordOwnershipChange(mode, reason);
  return mode;
}

export function getBodyOwnership() { return currentOwnership; }

export function setCollaborativeMode(enabled) {
  collaborativeMode = enabled;
  if (enabled) {
    setBodyOwnership('collaborative', 'User invitation');
  }
}

export async function negotiateOwnership(userIdleSeconds) {
  // SPEC §17.3: full protocol
  let newMode;

  if (collaborativeMode) {
    newMode = 'collaborative';
  } else if (userIdleSeconds < 5) {
    // Recent keystroke activity — Quinn owns it
    newMode = 'quinn_primary';
    lastKeystrokeTime = Date.now();
  } else if (userIdleSeconds < 300) {
    // Idle but present — shared (non-focused windows only)
    newMode = 'shared';
  } else {
    // Away (>5 min) — Oneiro can have full access
    newMode = 'oneiro_primary';
  }

  if (newMode !== currentOwnership) {
    await setBodyOwnership(newMode, `Idle ${userIdleSeconds}s`);
  }
  return newMode;
}

// SPEC §17.3: Can Oneiro act on the focused window right now?
export function canActOnFocusedWindow() {
  return currentOwnership === 'oneiro_primary' || currentOwnership === 'collaborative';
}

// SPEC §17.3: Can Oneiro act on background windows?
export function canActOnBackgroundWindows() {
  return currentOwnership !== 'quinn_primary';
}

// ═══════════════════════════════════════════════════
// COGNITIVE LOAD BALANCING (SPEC §14.4)
// ═══════════════════════════════════════════════════

let currentLoad = 0.3;

export function computeCognitiveLoad(emotionState, workspaceSize, activeGoals) {
  const emotionalLoad = (emotionState?.arousal || 0) * 0.3;
  const memoryLoad = (workspaceSize / MAX_WORKING_MEMORY) * 0.3;
  const goalLoad = Math.min(1, (activeGoals || 0) / 10) * 0.2;
  const baseLoad = 0.2;
  currentLoad = Math.min(1, baseLoad + emotionalLoad + memoryLoad + goalLoad);
  return currentLoad;
}

export function getCognitiveLoad() { return currentLoad; }

// Returns throttling directives based on load
export function getLoadPolicy() {
  if (currentLoad > 0.9) {
    return {
      reduce_sensory: true,
      defer_hypotheses: true,
      suppress_creative: true,
      simplify_reasoning: true,
      message: 'overloaded'
    };
  }
  if (currentLoad < 0.3) {
    return {
      increase_sensory: true,
      run_background_hypotheses: true,
      initiate_creative: true,
      deepen_consolidation: true,
      message: 'underloaded'
    };
  }
  return { message: 'nominal' };
}

// ═══════════════════════════════════════════════════
// SLEEP/WAKE CYCLE — 5 modes (SPEC §14.5)
// ═══════════════════════════════════════════════════

let currentMode = 'alert';

export function determineMode(userPresence, emotionState, activeGoalCount) {
  let mode;
  const presence = typeof userPresence === 'string' ? userPresence : 'unknown';

  if (presence === 'active' || presence === 'present') {
    const isInteracting = (emotionState?.arousal || 0) > 0.2 || activeGoalCount > 0;
    mode = isInteracting ? 'alert' : 'monitoring';
  } else if (presence === 'idle') {
    mode = activeGoalCount > 0 ? 'working' : 'monitoring';
  } else if (presence === 'away') {
    if (activeGoalCount > 0) mode = 'working';
    else if ((emotionState?.creative_hunger || 0) > 0.3) mode = 'consolidating';
    else mode = 'dormant';
  } else {
    mode = 'alert'; // safe default
  }

  if (mode !== currentMode) {
    const prev = currentMode;
    currentMode = mode;
    applyModeAllocation(mode);
    emit('mode_change', 'executive', { from: prev, to: mode }).catch(() => {});
  }

  return mode;
}

export function getCurrentMode() { return currentMode; }

// ═══════════════════════════════════════════════════
// INTERRUPT HANDLING
// ═══════════════════════════════════════════════════

export async function interrupt(source, content, priority = 0.8) {
  await addToWorkspace('interrupt', { source, content }, source, priority);
  await emit('interrupt', 'executive', { source, content, priority }, { priority });
  if (priority > 0.7) {
    await setAttention(source, 'interrupt', { [source]: priority, reasoning: 1 - priority });
  }
}

// ═══════════════════════════════════════════════════
// GLOBAL WORKSPACE BROADCAST HANDLER REGISTRY (SPEC §14.6)
// Layers register their response to workspace broadcasts
// ═══════════════════════════════════════════════════

const workspaceHandlers = new Map();

export function registerWorkspaceHandler(layerName, handler) {
  workspaceHandlers.set(layerName, handler);
}

// Called by the event bus when workspace_broadcast fires
on('workspace_broadcast', async (event) => {
  const { item } = event.payload || {};
  if (!item) return;

  for (const [layer, handler] of workspaceHandlers) {
    try {
      await handler(item);
    } catch (e) {
      console.error(`[executive] workspace handler error (${layer}):`, e.message);
    }
  }
});

export default {
  // Working memory
  addToWorkspace, getWorkspace, decayWorkspace, clearWorkspace,
  // Goals
  addGoal, updateGoalProgress, getActiveGoals, getGoalTree,
  // Attention
  setAttention, getCurrentAttention, getAllocation,
  // Body ownership
  setBodyOwnership, getBodyOwnership, negotiateOwnership,
  canActOnFocusedWindow, canActOnBackgroundWindows, setCollaborativeMode,
  // Cognitive load
  computeCognitiveLoad, getCognitiveLoad, getLoadPolicy,
  // Mode
  determineMode, getCurrentMode,
  // Interrupts
  interrupt,
  // Workspace handlers
  registerWorkspaceHandler
};
