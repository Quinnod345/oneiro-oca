// OCA Procedural Memory — learned skills and automatic behaviors
import { pool } from '../event-bus.js';

// Store a new procedure
export async function learn(triggerPattern, actionSequence, { domain = null, prerequisites = [] } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO procedural_memory (trigger_pattern, action_sequence, domain, prerequisite_skills)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [JSON.stringify(triggerPattern), JSON.stringify(actionSequence), domain, prerequisites]
  );
  return { id: rows[0].id };
}

// Find matching procedures for a given state
export async function match(currentState) {
  const { rows } = await pool.query(
    `SELECT * FROM procedural_memory ORDER BY automaticity DESC`
  );
  
  const matches = [];
  for (const proc of rows) {
    const trigger = proc.trigger_pattern;
    if (matchesTrigger(trigger, currentState)) {
      matches.push(proc);
    }
  }
  return matches;
}

function matchesTrigger(trigger, state) {
  for (const [key, value] of Object.entries(trigger)) {
    if (typeof value === 'string') {
      const stateVal = state[key];
      if (!stateVal) return false;
      if (typeof stateVal === 'string' && !stateVal.toLowerCase().includes(value.toLowerCase())) return false;
    } else if (typeof value === 'boolean') {
      if (state[key] !== value) return false;
    } else if (typeof value === 'object' && value.pattern) {
      const stateVal = state[key];
      if (!stateVal || !new RegExp(value.pattern, 'i').test(String(stateVal))) return false;
    }
  }
  return true;
}

// Record execution result
export async function recordExecution(procedureId, success, executionTimeMs = null) {
  const field = success ? 'success_count' : 'failure_count';
  const autoUpdate = success ? 'LEAST(1.0, automaticity + 0.05)' : 'GREATEST(0.0, automaticity - 0.1)';
  
  await pool.query(
    `UPDATE procedural_memory SET 
       execution_count = execution_count + 1,
       ${field} = ${field} + 1,
       automaticity = ${autoUpdate},
       average_execution_time_ms = COALESCE(
         (average_execution_time_ms * execution_count + $1) / (execution_count + 1),
         $1
       ),
       updated_at = NOW()
     WHERE id = $2`,
    [executionTimeMs, procedureId]
  );
}

// Get highly automatic procedures (for fast-path execution)
export async function getAutomatic(threshold = 0.7) {
  const { rows } = await pool.query(
    `SELECT * FROM procedural_memory WHERE automaticity >= $1 ORDER BY automaticity DESC`,
    [threshold]
  );
  return rows;
}

// Get all procedures in a domain
export async function getDomain(domain) {
  const { rows } = await pool.query(
    `SELECT * FROM procedural_memory WHERE domain = $1 ORDER BY execution_count DESC`,
    [domain]
  );
  return rows;
}

export default { learn, match, recordExecution, getAutomatic, getDomain };
