// OCA Event Bus — the nervous system
// Cross-process IPC: pg LISTEN/NOTIFY + Unix domain sockets + shared state files
// All cognitive layers and separate processes communicate through this

import pg from 'pg';
import net from 'net';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { dirname } from 'path';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || `postgres://${process.env.USER || 'postgres'}@localhost/oneiro`
});

// ═══════════════════════════════════════════════════
// IN-PROCESS EVENT LISTENERS
// ═══════════════════════════════════════════════════

const listeners = new Map(); // event_type -> [callback]

export async function emit(eventType, sourceLayer, payload, { targetLayer = null, priority = 0.5 } = {}) {
  const result = await pool.query(
    `INSERT INTO cognitive_events (event_type, source_layer, target_layer, priority, payload)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, timestamp`,
    [eventType, sourceLayer, targetLayer, priority, JSON.stringify(payload)]
  );

  const event = {
    id: result.rows[0].id,
    eventType, sourceLayer, targetLayer, priority, payload,
    timestamp: result.rows[0].timestamp
  };

  // Local listeners
  if (listeners.has(eventType)) {
    for (const cb of listeners.get(eventType)) {
      try { await cb(event); }
      catch (e) { console.error(`[event-bus] listener error for ${eventType}:`, e.message); }
    }
  }
  // Broadcast listeners
  if (listeners.has('*')) {
    for (const cb of listeners.get('*')) {
      try { await cb(event); }
      catch (e) { console.error(`[event-bus] broadcast listener error:`, e.message); }
    }
  }

  // pg NOTIFY for cross-process
  await pool.query(`NOTIFY oca_events, '${result.rows[0].id}'`);

  return result.rows[0];
}

export function on(eventType, callback) {
  if (!listeners.has(eventType)) listeners.set(eventType, []);
  listeners.get(eventType).push(callback);
  return () => {
    const cbs = listeners.get(eventType);
    const idx = cbs.indexOf(callback);
    if (idx !== -1) cbs.splice(idx, 1);
  };
}

// ═══════════════════════════════════════════════════
// CROSS-PROCESS: pg LISTEN/NOTIFY
// ═══════════════════════════════════════════════════

let pgListener = null;
export async function startCrossProcessListener(handler) {
  if (pgListener) return;
  pgListener = new pg.Client({
    connectionString: process.env.DATABASE_URL || `postgres://${process.env.USER || 'postgres'}@localhost/oneiro`
  });
  await pgListener.connect();
  await pgListener.query('LISTEN oca_events');
  pgListener.on('notification', async (msg) => {
    const eventId = parseInt(msg.payload);
    if (isNaN(eventId)) return;
    try {
      const { rows } = await pool.query('SELECT * FROM cognitive_events WHERE id = $1', [eventId]);
      if (rows[0] && handler) await handler(rows[0]);
    } catch (e) {
      console.error('[event-bus] cross-process handler error:', e.message);
    }
  });
  pgListener.on('error', (e) => {
    console.error('[event-bus] pg listener error, reconnecting:', e.message);
    pgListener = null;
    setTimeout(() => startCrossProcessListener(handler).catch(() => {}), 5000);
  });
}

// ═══════════════════════════════════════════════════
// CROSS-PROCESS: Unix Domain Sockets
// ═══════════════════════════════════════════════════

const SOCKET_DIR = '/tmp';
const activeServers = new Map();
const activeClients = new Map();

export function createSocketServer(name, onMessage) {
  const socketPath = `${SOCKET_DIR}/oneiro-${name}.sock`;
  try { if (existsSync(socketPath)) { const { unlinkSync } = require('fs'); unlinkSync(socketPath); } } catch {}

  const clients = new Set();
  const server = net.createServer((socket) => {
    clients.add(socket);
    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (onMessage) onMessage(msg, socket);
        } catch (e) {
          console.error(`[ipc:${name}] parse error:`, e.message);
        }
      }
    });

    socket.on('error', () => clients.delete(socket));
    socket.on('close', () => clients.delete(socket));
  });

  server.listen(socketPath, () => {
    console.log(`[ipc] socket server listening: ${socketPath}`);
  });
  server.on('error', (e) => {
    console.error(`[ipc:${name}] server error:`, e.message);
  });

  const handle = {
    broadcast(msg) {
      const line = JSON.stringify(msg) + '\n';
      for (const c of clients) {
        try { c.write(line); } catch {}
      }
    },
    send(socket, msg) {
      try { socket.write(JSON.stringify(msg) + '\n'); } catch {}
    },
    close() {
      for (const c of clients) { try { c.destroy(); } catch {} }
      server.close();
      try { if (existsSync(socketPath)) { const fs = require('fs'); fs.unlinkSync(socketPath); } } catch {}
    },
    clients,
    path: socketPath
  };

  activeServers.set(name, handle);
  return handle;
}

export function connectSocket(name, onMessage) {
  const socketPath = `${SOCKET_DIR}/oneiro-${name}.sock`;
  let reconnectTimer = null;
  let destroyed = false;

  function connect() {
    const socket = net.createConnection(socketPath);
    let buffer = '';

    socket.on('connect', () => {
      console.log(`[ipc] connected to ${socketPath}`);
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (onMessage) onMessage(msg);
        } catch {}
      }
    });

    socket.on('error', () => {});
    socket.on('close', () => {
      if (!destroyed) {
        reconnectTimer = setTimeout(connect, 2000);
      }
    });

    const handle = {
      send(msg) { try { socket.write(JSON.stringify(msg) + '\n'); } catch {} },
      close() { destroyed = true; socket.destroy(); if (reconnectTimer) clearTimeout(reconnectTimer); },
      socket
    };
    activeClients.set(name, handle);
    return handle;
  }

  return connect();
}

// ═══════════════════════════════════════════════════
// SHARED STATE FILES (fast cross-process reads)
// ═══════════════════════════════════════════════════

const STATE_DIR = '/tmp/oneiro-state';

function ensureStateDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

export function writeSharedState(name, state) {
  ensureStateDir();
  const target = `${STATE_DIR}/${name}.json`;
  const tmp = `${target}.tmp.${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, target);
  } catch (e) {
    console.error(`[shared-state] write error for ${name}:`, e.message);
    try { if (existsSync(tmp)) { const fs = require('fs'); fs.unlinkSync(tmp); } } catch {}
  }
}

export function readSharedState(name) {
  const target = `${STATE_DIR}/${name}.json`;
  try {
    const data = readFileSync(target, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function writePerceptualState(state) {
  writeSharedState('perception', state);
}

export function readPerceptualState() {
  return readSharedState('perception');
}

// ═══════════════════════════════════════════════════
// POLLING & MAINTENANCE (unchanged from original)
// ═══════════════════════════════════════════════════

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

export async function cleanup(hoursOld = 24) {
  const { rowCount } = await pool.query(
    'DELETE FROM cognitive_events WHERE timestamp < NOW() - $1::interval',
    [`${hoursOld} hours`]
  );
  return rowCount;
}

export async function recentEvents(sourceLayer, limit = 10) {
  const { rows } = await pool.query(
    'SELECT * FROM cognitive_events WHERE source_layer = $1 ORDER BY timestamp DESC LIMIT $2',
    [sourceLayer, limit]
  );
  return rows;
}

// Graceful shutdown
export function shutdownIPC() {
  for (const [, server] of activeServers) { try { server.close(); } catch {} }
  for (const [, client] of activeClients) { try { client.close(); } catch {} }
  activeServers.clear();
  activeClients.clear();
  if (pgListener) { try { pgListener.end(); } catch {} pgListener = null; }
}

export { pool };
