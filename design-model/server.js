// Design Model Server — Unix socket server for design evaluation
// Any process can connect and get design scores.
// Phase 1: JS MLP inference. Phase 2+: MLX GPU inference at same socket path.

import net from 'net';
import { existsSync, unlinkSync } from 'fs';
import { evaluateDesign, quickScore } from './evaluate.js';
import { loadModel } from './model.js';
import { getTrainingFocus } from './trainer.js';

const SOCKET_PATH = '/tmp/design-model.sock';

// ═══════════════════════════════════════════════════
// SERVER
// ═══════════════════════════════════════════════════

export function startServer(socketPath = SOCKET_PATH) {
  // Clean up stale socket
  if (existsSync(socketPath)) {
    try { unlinkSync(socketPath); } catch {}
  }

  // Preload model
  const model = loadModel();
  console.log(`[design-server] model loaded: ${model.getArchitectureSummary().layerString} (${model.getParamCount()} params)`);

  const server = net.createServer(async (conn) => {
    let data = '';
    conn.on('data', chunk => data += chunk);
    conn.on('end', async () => {
      try {
        const request = JSON.parse(data);
        let result;

        switch (request.action) {
          case 'evaluate':
            result = await evaluateDesign(request.input, request.options || {});
            break;

          case 'quick':
            result = { overall: quickScore(request.code, request.context || {}) };
            break;

          case 'status':
            result = model.getStatus();
            break;

          case 'focus':
            result = getTrainingFocus();
            break;

          default:
            result = { error: `Unknown action: ${request.action}` };
        }

        conn.write(JSON.stringify(result));
      } catch (err) {
        conn.write(JSON.stringify({ error: err.message }));
      }
      conn.end();
    });

    conn.on('error', () => {}); // Silently handle client disconnects
  });

  server.listen(socketPath, () => {
    console.log(`[design-server] listening on ${socketPath}`);
  });

  server.on('error', (err) => {
    console.error('[design-server] server error:', err.message);
  });

  // Cleanup on exit
  process.on('exit', () => {
    try { unlinkSync(socketPath); } catch {}
  });
  process.on('SIGINT', () => {
    try { unlinkSync(socketPath); } catch {}
    process.exit(0);
  });

  return server;
}

// ═══════════════════════════════════════════════════
// CLIENT (for other processes to connect)
// ═══════════════════════════════════════════════════

export function queryServer(request, socketPath = SOCKET_PATH) {
  return new Promise((resolve, reject) => {
    if (!existsSync(socketPath)) {
      reject(new Error('Design model server not running'));
      return;
    }

    const client = net.createConnection(socketPath, () => {
      client.write(JSON.stringify(request));
      client.end();
    });

    let data = '';
    client.on('data', chunk => data += chunk);
    client.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error(`Failed to parse response: ${err.message}`));
      }
    });
    client.on('error', reject);
    client.setTimeout(10000, () => {
      client.destroy();
      reject(new Error('Connection timeout'));
    });
  });
}

// Convenience functions for clients
export async function remoteEvaluate(input, options = {}) {
  return queryServer({ action: 'evaluate', input, options });
}

export async function remoteQuickScore(code, context = {}) {
  return queryServer({ action: 'quick', code, context });
}

export async function remoteStatus() {
  return queryServer({ action: 'status' });
}

export async function remoteTrainingFocus() {
  return queryServer({ action: 'focus' });
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}

export default { startServer, queryServer, remoteEvaluate, remoteQuickScore, remoteStatus, remoteTrainingFocus };
