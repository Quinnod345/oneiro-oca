// OCA Event Bus — the nervous system
// All cognitive layers communicate through this
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://quinnodonnell@localhost/oneiro' });

const listeners = new Map(); // event_type -> [callback]

// Emit a cognitive event
export async function emit(eventType, sourceLayer, payload, { targetLayer = null, priority = 0.5 } = {}) {
  const result = await pool.query(
    `INSERT INTO cognitive_events (event_type, source_layer, target_layer, priority, payload)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, timestamp`,
    [eventType, sourceLayer, targetLayer, priority, JSON.stringify(payload)]
  );
  
  // Notify local listeners synchronously
  const key = eventType;
  if (listeners.has(key)) {
    for (const cb of listeners.get(key)) {
      try { await cb({ id: result.rows[0].id, eventType, sourceLayer, targetLayer, priority, payload, timestamp: result.rows[0].timestamp }); }
      catch (e) { console.error(`[event-bus] listener error for ${key}:`, e.message); }
    }
  }
  // Also notify broadcast listeners
  if (listeners.has('*')) {
    for (const cb of listeners.get('*')) {
      try { await cb({ id: result.rows[0].id, eventType, sourceLayer, targetLayer, priority, payload, timestamp: result.rows[0].timestamp }); }
      catch (e) { console.error(`[event-bus] broadcast listener error:`, e.message); }
    }
  }
  
  // pg NOTIFY for cross-process communication
  await pool.query(`NOTIFY oca_events, '${result.rows[0].id}'`);
  
  return result.rows[0];
}

// Subscribe to events (in-process)
export function on(eventType, callback) {
  if (!listeners.has(eventType)) listeners.set(eventType, []);
  listeners.get(eventType).push(callback);
  return () => {
    const cbs = listeners.get(eventType);
    const idx = cbs.indexOf(callback);
    if (idx !== -1) cbs.splice(idx, 1);
  };
}

// Subscribe to pg NOTIFY (cross-process)
let pgListener = null;
export async function startCrossProcessListener(handler) {
  pgListener = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://quinnodonnell@localhost/oneiro' });
  await pgListener.connect();
  await pgListener.query('LISTEN oca_events');
  pgListener.on('notification', async (msg) => {
    const eventId = parseInt(msg.payload);
    if (isNaN(eventId)) return;
    const { rows } = await pool.query(
      'SELECT * FROM cognitive_events WHERE id = $1', [eventId]
    );
    if (rows[0] && handler) {
      await handler(rows[0]);
    }
  });
}

// Poll unprocessed events (for layers that use polling instead of listen)
export async function pollEvents(targetLayer, limit = 20) {
  const { rows } = await pool.query(
    `UPDATE cognitive_events 
     SET processed = TRUE 
     WHERE id IN (
       SELECT id FROM cognitive_events 
       WHERE NOT processed 
         AND (target_layer IS NULL OR target_layer = $1)
       ORDER BY priority DESC, timestamp ASC
       LIMIT $2
     )
     RETURNING *`,
    [targetLayer, limit]
  );
  return rows;
}

// Cleanup old events
export async function cleanup(hoursOld = 24) {
  const { rowCount } = await pool.query(
    'DELETE FROM cognitive_events WHERE timestamp < NOW() - $1::interval',
    [`${hoursOld} hours`]
  );
  return rowCount;
}

// Get recent events for a layer
export async function recentEvents(sourceLayer, limit = 10) {
  const { rows } = await pool.query(
    'SELECT * FROM cognitive_events WHERE source_layer = $1 ORDER BY timestamp DESC LIMIT $2',
    [sourceLayer, limit]
  );
  return rows;
}

export { pool };
