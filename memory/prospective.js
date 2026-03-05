// OCA Prospective Memory — future intentions triggered by conditions
// "Remember to do X when Y happens"
import { pool, emit } from '../event-bus.js';

// Create a prospective memory
export async function intend(intention, triggerType, triggerSpec, { priority = 0.5, context = null, expiresAt = null, sourceEpisode = null } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO prospective_memory (intention, trigger_type, trigger_spec, priority, context, expires_at, source_episode)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [intention, triggerType, JSON.stringify(triggerSpec), priority, context, expiresAt, sourceEpisode]
  );
  return { id: rows[0].id, intention, triggerType };
}

// Check all pending prospective memories against current state
export async function check(currentState) {
  const { rows } = await pool.query(
    `SELECT * FROM prospective_memory 
     WHERE status = 'pending' 
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY priority DESC`
  );
  
  const triggered = [];
  
  for (const mem of rows) {
    const spec = typeof mem.trigger_spec === 'string' ? JSON.parse(mem.trigger_spec) : mem.trigger_spec;
    let shouldTrigger = false;
    
    switch (mem.trigger_type) {
      case 'time': {
        const triggerTime = new Date(spec.at || spec.time);
        if (triggerTime <= new Date()) shouldTrigger = true;
        break;
      }
      
      case 'event': {
        // Check if the event pattern matches current state
        if (spec.event === 'app_switch' && currentState.frontApp === spec.app) {
          shouldTrigger = true;
        }
        if (spec.event === 'user_idle' && currentState.idleSeconds >= (spec.minutes || 5) * 60) {
          shouldTrigger = true;
        }
        if (spec.event === 'user_returns' && currentState.presence === 'present' && currentState.previousPresence === 'away') {
          shouldTrigger = true;
        }
        if (spec.event === 'keyword' && spec.pattern) {
          const pattern = new RegExp(spec.pattern, 'i');
          if (currentState.recentText && pattern.test(currentState.recentText)) {
            shouldTrigger = true;
          }
        }
        if (spec.event === 'quinn_mentions' && spec.pattern) {
          const pattern = new RegExp(spec.pattern, 'i');
          if (currentState.recentText && pattern.test(currentState.recentText)) {
            shouldTrigger = true;
          }
        }
        break;
      }
      
      case 'condition': {
        // Check compound conditions — require at least one recognized key
        const recognizedKeys = ['battery_above','battery_below','user_idle_minutes','user_present','user_away','app_running','time_after','time_before'];
        const hasRecognized = Object.keys(spec).some(k => recognizedKeys.includes(k));
        if (!hasRecognized) break; // no recognized conditions = don't trigger
        
        let allMet = true;
        if (spec.battery_above != null && (currentState.battery || 1) < spec.battery_above) allMet = false;
        if (spec.battery_below != null && (currentState.battery || 1) > spec.battery_below) allMet = false;
        if (spec.user_idle_minutes != null && (currentState.idleSeconds || 0) / 60 < spec.user_idle_minutes) allMet = false;
        if (spec.user_present && currentState.presence !== 'present') allMet = false;
        if (spec.user_away && currentState.presence !== 'away') allMet = false;
        if (spec.app_running && !(currentState.runningApps || []).includes(spec.app_running)) allMet = false;
        if (spec.time_after) {
          const hour = new Date().getHours();
          if (hour < spec.time_after) allMet = false;
        }
        if (spec.time_before) {
          const hour = new Date().getHours();
          if (hour > spec.time_before) allMet = false;
        }
        if (allMet) shouldTrigger = true;
        break;
      }
    }
    
    if (shouldTrigger) {
      await pool.query(
        `UPDATE prospective_memory SET status = 'triggered', triggered_at = NOW() WHERE id = $1`,
        [mem.id]
      );
      triggered.push(mem);
      
      await emit('interrupt', 'prospective_memory', {
        intention: mem.intention,
        context: mem.context,
        priority: mem.priority,
        id: mem.id
      }, { priority: mem.priority });
    } else {
      // Periodic reminder (surface in working memory if it's been a while)
      const lastReminded = mem.last_reminded ? new Date(mem.last_reminded) : new Date(mem.created_at);
      const hoursSinceReminder = (Date.now() - lastReminded.getTime()) / 3600000;
      if (hoursSinceReminder > 4 && mem.priority > 0.6) {
        await pool.query(
          `UPDATE prospective_memory SET reminder_count = reminder_count + 1, last_reminded = NOW() WHERE id = $1`,
          [mem.id]
        );
      }
    }
  }
  
  // Expire old ones
  await pool.query(
    `UPDATE prospective_memory SET status = 'expired' 
     WHERE status = 'pending' AND expires_at < NOW()`
  );
  
  return triggered;
}

// Complete an intention
export async function complete(intentionId) {
  await pool.query(
    `UPDATE prospective_memory SET status = 'completed', completed_at = NOW() WHERE id = $1`,
    [intentionId]
  );
}

// Cancel an intention
export async function cancel(intentionId) {
  await pool.query(
    `UPDATE prospective_memory SET status = 'cancelled' WHERE id = $1`,
    [intentionId]
  );
}

// Get all pending intentions
export async function getPending() {
  const { rows } = await pool.query(
    `SELECT * FROM prospective_memory WHERE status = 'pending' ORDER BY priority DESC`
  );
  return rows;
}

// Get triggered but uncompleted
export async function getTriggered() {
  const { rows } = await pool.query(
    `SELECT * FROM prospective_memory WHERE status = 'triggered' ORDER BY triggered_at DESC`
  );
  return rows;
}

export default { intend, check, complete, cancel, getPending, getTriggered };
