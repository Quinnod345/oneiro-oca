/**
 * Design Model Client — connects to the Phase 2b/3 Python inference server.
 *
 * Any Node.js code can import this to query design scores:
 *   import { queryServer, isServerRunning, evaluate, quickScore } from './client.js';
 */

import net from 'net';
import { existsSync } from 'fs';

const SOCKET_PATH = '/tmp/design-model-v2.sock';
const CONNECT_TIMEOUT = 3000;
const READ_TIMEOUT = 30000;

/**
 * Check if the Phase 2b server is running.
 */
export function isServerRunning() {
  return existsSync(SOCKET_PATH);
}

/**
 * Send a request to the Phase 2b server via Unix socket.
 * Returns the parsed JSON response.
 */
export function queryServer(request) {
  return new Promise((resolve, reject) => {
    if (!isServerRunning()) {
      reject(new Error('Phase 2b server not running (no socket at ' + SOCKET_PATH + ')'));
      return;
    }

    const client = net.createConnection({ path: SOCKET_PATH });
    let data = '';
    let connected = false;

    const connectTimer = setTimeout(() => {
      if (!connected) {
        client.destroy();
        reject(new Error('Connection timeout'));
      }
    }, CONNECT_TIMEOUT);

    const readTimer = setTimeout(() => {
      client.destroy();
      reject(new Error('Read timeout'));
    }, READ_TIMEOUT);

    client.on('connect', () => {
      connected = true;
      clearTimeout(connectTimer);
      client.write(JSON.stringify(request));
      client.end();
    });

    client.on('data', chunk => {
      data += chunk.toString();
    });

    client.on('end', () => {
      clearTimeout(readTimer);
      try {
        const response = JSON.parse(data);
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      } catch (e) {
        reject(new Error('Invalid server response: ' + data.slice(0, 100)));
      }
    });

    client.on('error', err => {
      clearTimeout(connectTimer);
      clearTimeout(readTimer);
      reject(err);
    });
  });
}

/**
 * Evaluate a design via the design model server.
 * Accepts screenshot path, precomputed features, code features, and an
 * optional design-intent brief (encoded server-side via MiniLM in v9+).
 */
export async function evaluate(input) {
  return queryServer({
    action: 'evaluate',
    input: {
      screenshot: input.screenshot || undefined,
      precomputed_features: input.precomputedFeatures || undefined,
      code_features: input.codeFeatures || undefined,
      brief: input.brief || undefined,
    },
  });
}

/**
 * Extract MobileNet features from a screenshot.
 */
export async function extractFeatures(screenshotPath) {
  return queryServer({
    action: 'extract_features',
    input: { screenshot: screenshotPath },
  });
}

/**
 * Get server status.
 */
export async function getStatus() {
  return queryServer({ action: 'status' });
}

/**
 * Hot-reload model weights.
 */
export async function reload() {
  return queryServer({ action: 'reload' });
}

/**
 * Quick overall score from a screenshot.
 */
export async function quickScore(screenshotPath) {
  const result = await evaluate({ screenshot: screenshotPath });
  return result.overall;
}

export default { isServerRunning, queryServer, evaluate, extractFeatures, getStatus, reload, quickScore };
