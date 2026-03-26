// OCA Executive Control — the conductor
// Attention allocation, goal management, cognitive load balancing,
// global workspace, body ownership negotiation
import { pool, emit, on, pollEvents } from '../event-bus.js';
import emotion from '../emotion/engine.js';

// === WORKING MEMORY (Global Workspace) ===
const MAX_WORKING_MEMORY = 7; // Miller's Law

export async function addToWorkspace(contentType, content, sourceLayer, salience = 0.5) {
  // Enforce capacity
  const { rows: active } = await pool.query(
    'SELECT id, salience FROM working_memory WHERE is_active ORDER BY salience ASC'
  );
  
  if (active.length >= MAX_WORKING_MEMORY) {
    // Evict lowest salience item
    const evict = active[0];
    if (salience > evict.salience) {
      await pool.query(
        'UPDATE working_memory SET is_active = FALSE, deactivated_at = NOW() WHERE id = $1',
        [evict.id]
      );
    } else {
      // New item isn't salient enough
      return null;
    }
  }
  
  const { rows } = await pool.query(
    `INSERT INTO working_memory (content_type, content, source_layer, salience)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [contentType, JSON.stringify(content), sourceLayer, salience]
  );
  
  // Broadcast to all layers
  await emit('workspace_broadcast', 'executive', {
    action: 'add',
    item: { id: rows[0].id, contentType, content, salience }
  });
  
  return rows[0].id;
}

export async function getWorkspace() {
  const { rows } = await pool.query(
    'SELECT * FROM working_memory WHERE is_active ORDER BY salience DESC LIMIT $1',
    [MAX_WORKING_MEMORY]
  );
  return rows.map(r => ({ ...r, content: typeof r.content === 'string' ? JSON.parse(r.content) : r.content }));
}

// Decay salience of working memory items
export async function decayWorkspace(decayAmount = 0.05) {
  await pool.query(
    `UPDATE working_memory SET salience = GREATEST(0, salience - $1) WHERE is_active`,
    [decayAmount]
  );
  // Evict items that dropped to 0
  await pool.query(
    `UPDATE working_memory SET is_active = FALSE, deactivated_at = NOW() 
     WHERE is_active AND salience <= 0`
  );
}

export async function clearWorkspace() {
  await pool.query('UPDATE working_memory SET is_active = FALSE, deactivated_at = NOW() WHERE is_active');
}

// === GOAL MANAGEMENT ===

export async function addGoal(description, { goalType = 'session', priority = 0.5, parentGoal = null, deadline = null, emotionalInvestment = 0.5 } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO goals (description, goal_type, priority, parent_goal, deadline, emotional_investment)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [description, goalType, priority, parentGoal, deadline, emotionalInvestment]
  );
  
  // Add parent's child reference
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
    // Trigger satisfaction
    const { rows: [goal] } = await pool.query('SELECT emotional_investment FROM goals WHERE id = $1', [goalId]);
    if (goal) emotion.processSuccess(goal.emotional_investment);
  }
  
  await pool.query(
    `UPDATE goals SET ${updates.join(', ')} WHERE id = $2`,
    params
  );
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
  // All top-level goals
  const { rows } = await pool.query(
    `SELECT * FROM goals WHERE parent_goal IS NULL AND status = 'active' ORDER BY priority DESC`
  );
  return rows;
}

// === ATTENTION ALLOCATION ===

export async function setAttention(primaryFocus, focusType, allocation = {}) {
  await pool.query(
    `INSERT INTO attention_log (primary_focus, focus_type, allocation)
     VALUES ($1, $2, $3)`,
    [primaryFocus, focusType, JSON.stringify(allocation)]
  );
}

export async function getCurrentAttention() {
  const { rows } = await pool.query(
    'SELECT * FROM attention_log ORDER BY timestamp DESC LIMIT 1'
  );
  return rows[0] || { primary_focus: 'idle', focus_type: 'none', allocation: {} };
}

// === BODY OWNERSHIP ===

let currentOwnership = 'quinn_primary'; // default: Quinn owns it

export async function setBodyOwnership(mode, reason = '') {
  currentOwnership = mode;
  await pool.query(
    `INSERT INTO body_ownership_log (mode, reason, quinn_active, oneiro_active)
     VALUES ($1, $2, $3, $4)`,
    [mode, reason,
     ['quinn_primary', 'shared', 'collaborative'].includes(mode),
     ['oneiro_primary', 'shared', 'collaborative'].includes(mode)]
  );
  return mode;
}

export function getBodyOwnership() {
  return currentOwnership;
}

// Negotiate body ownership based on user activity
export async function negotiateOwnership(userIdleSeconds) {
  let newMode;
  if (userIdleSeconds < 5) {
    newMode = 'quinn_primary';
  } else if (userIdleSeconds < 300) {
    newMode = 'shared';
  } else {
    newMode = 'oneiro_primary';
  }
  
  if (newMode !== currentOwnership) {
    await setBodyOwnership(newMode, `User idle for ${userIdleSeconds}s`);
  }
  return newMode;
}

// === COGNITIVE LOAD ===

export function computeCognitiveLoad(emotionState, workspaceSize, activeGoals) {
  const emotionalLoad = emotionState.arousal * 0.3;
  const memoryLoad = (workspaceSize / MAX_WORKING_MEMORY) * 0.3;
  const goalLoad = Math.min(1, activeGoals / 10) * 0.2;
  const baseLoad = 0.2;
  return Math.min(1, baseLoad + emotionalLoad + memoryLoad + goalLoad);
}

// === INTERRUPT HANDLING ===

export async function interrupt(source, content, priority = 0.8) {
  // Add to workspace at high salience
  await addToWorkspace('interrupt', { source, content }, source, priority);
  
  // Emit interrupt event
  await emit('interrupt', 'executive', { source, content, priority }, { priority });
  
  // If high priority, shift attention
  if (priority > 0.7) {
    await setAttention(source, 'interrupt', { [source]: priority });
  }
}

// === SLEEP/WAKE CYCLE ===

export function determineMode(userPresence, emotionState, activeGoalCount) {
  if (userPresence === 'present') return 'alert';
  if (userPresence === 'idle' && activeGoalCount > 0) return 'working';
  if (userPresence === 'away' && activeGoalCount > 0) return 'working';
  if (userPresence === 'away' && emotionState.creative_hunger > 0.5) return 'consolidating';
  return 'dormant';
}

export default {
  addToWorkspace, getWorkspace, decayWorkspace, clearWorkspace,
  addGoal, updateGoalProgress, getActiveGoals, getGoalTree,
  setAttention, getCurrentAttention,
  setBodyOwnership, getBodyOwnership, negotiateOwnership,
  computeCognitiveLoad, interrupt, determineMode
};
