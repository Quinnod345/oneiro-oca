// OCA LLM Gateway — unified Claude access with configurable auth mode.
//
// Supported modes:
// - auto  : prefer Anthropic API if configured, fall back to OAuth-backed CLI
// - api   : use Anthropic API only
// - oauth : use Claude CLI OAuth session only
//
// Every cognitive layer should use this instead of raw Anthropic SDK.
// Drop-in replacement: llm.messages.create({...}) has the same signature.

import Anthropic from '@anthropic-ai/sdk';
import { execSync, spawn as spawnChild } from 'child_process';
import { createReadStream } from 'fs';
import { existsSync, writeFileSync, unlinkSync } from 'fs';

const API_KEY = process.env.ANTHROPIC_API_KEY || '';
let anthropic = null;
try {
  if (API_KEY) anthropic = new Anthropic({ apiKey: API_KEY });
} catch {}

const ANTHROPIC_AUTH_MODE = (() => {
  const raw = String(process.env.ANTHROPIC_AUTH_MODE || 'auto').trim().toLowerCase();
  return ['auto', 'api', 'oauth'].includes(raw) ? raw : 'auto';
})();

// Track API failures to avoid hammering a dead key in auto mode.
let apiFailCount = 0;
let apiDisabledUntil = 0;
const API_BACKOFF_MS = 5 * 60 * 1000;
const API_FAIL_THRESHOLD = 3;

// CLI concurrency limiter — only one claude -p call at a time
let cliLock = Promise.resolve();
function withCliLock(fn) {
  const prev = cliLock;
  let resolve;
  cliLock = new Promise(r => { resolve = r; });
  return prev.then(() => fn()).finally(() => resolve());
}

// Claude CLI path — resolve it once at startup
const CLAUDE_CLI = (() => {
  const candidates = [
    '/Users/quinnodonnell/.local/bin/claude',
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
  for (const p of candidates) {
    try { if (existsSync(p)) return p; } catch {}
  }
  // Last resort: try PATH
  try { return execSync('which claude', { encoding: 'utf8', timeout: 3000 }).trim(); } catch {}
  return 'claude'; // hope for the best
})();

// Model mapping for CLI (claude -p uses aliases)
const MODEL_TO_CLI = {
  'claude-sonnet-4-6': 'sonnet',
  'claude-sonnet-4-20250514': 'sonnet',
  'claude-haiku-4-5-20251001': 'haiku',
  'claude-haiku-3-5-20241022': 'haiku',
  'claude-opus-4-6': 'opus',
};

function getCliModel(apiModel) {
  return MODEL_TO_CLI[apiModel] || 'sonnet';
}

// ═══════════════════════════════════════════════════
// MAIN INTERFACE — drop-in replacement for anthropic.messages.create()
// ═══════════════════════════════════════════════════

const messages = {
  async create(params) {
    if (ANTHROPIC_AUTH_MODE === 'oauth') {
      return await withCliLock(() => callCLI(params));
    }

    if (!anthropic) {
      if (ANTHROPIC_AUTH_MODE === 'api') {
        throw new Error('ANTHROPIC_AUTH_MODE=api but ANTHROPIC_API_KEY is not configured');
      }
      return await withCliLock(() => callCLI(params));
    }

    if (ANTHROPIC_AUTH_MODE === 'api') {
      return await anthropic.messages.create(params);
    }

    if (Date.now() > apiDisabledUntil) {
      try {
        const response = await anthropic.messages.create(params);
        if (apiFailCount > 0) {
          apiFailCount = 0;
          console.log('[llm] Anthropic API recovered — switching back to API in auto mode');
        }
        return response;
      } catch (e) {
        const isRateLimit = e.status === 429 || e.status === 400 ||
          e.message?.includes('usage limits') || e.message?.includes('rate limit');

        if (isRateLimit) {
          apiFailCount++;
          console.log(`[llm] Anthropic API rate limited (${apiFailCount}/${API_FAIL_THRESHOLD}) — falling back to OAuth CLI`);
          if (apiFailCount >= API_FAIL_THRESHOLD) {
            apiDisabledUntil = Date.now() + API_BACKOFF_MS;
            console.log(`[llm] Anthropic API disabled for ${API_BACKOFF_MS / 1000}s in auto mode`);
          }
        } else {
          console.error(`[llm] Anthropic API error: ${e.message} — trying OAuth CLI fallback`);
        }
      }
    }

    return await withCliLock(() => callCLI(params));
  }
};

// ═══════════════════════════════════════════════════
// CLI FALLBACK — uses claude -p (Quinn's Max subscription)
// ═══════════════════════════════════════════════════

async function callCLI(params) {
  const { model, system, messages: msgs } = params;
  const cliModel = getCliModel(model);

  // Build the prompt from system + messages
  let prompt = '';
  if (system) prompt += `${system}\n\n`;
  for (const msg of msgs) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        prompt += msg.content;
      } else if (Array.isArray(msg.content)) {
        prompt += msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      }
    } else if (msg.role === 'assistant') {
      prompt += `\nAssistant: ${typeof msg.content === 'string' ? msg.content : ''}\n`;
    }
  }

  // Write prompt to temp file
  const tmpFile = `/tmp/oca-llm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
  writeFileSync(tmpFile, prompt, 'utf8');

  try {
    const output = await spawnClaude(cliModel, tmpFile);
    try { unlinkSync(tmpFile); } catch {}

    return {
      id: `cli-${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: output }],
      model: cliModel,
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
      _via: 'cli_fallback'
    };
  } catch (e) {
    try { unlinkSync(tmpFile); } catch {}
    throw new Error(`Both API and CLI failed. API: rate limited. CLI: ${e.message}`);
  }
}

// Use child_process.spawn for better control over the claude process
function spawnClaude(model, inputFile) {
  return new Promise((resolve, reject) => {
    // CRITICAL: strip ANTHROPIC_API_KEY so claude uses OAuth/Max subscription
    // instead of the raw API key (which may be rate-limited)
    const cliEnv = { ...process.env };
    delete cliEnv.ANTHROPIC_API_KEY;
    
    const child = spawnChild(CLAUDE_CLI, ['-p', '--model', model], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...cliEnv,
        HOME: '/Users/quinnodonnell',
        PATH: '/Users/quinnodonnell/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
        USER: 'quinnodonnell',
        TERM: 'dumb',
      }
    });

    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    
    // Pipe the input file to stdin
    const input = createReadStream(inputFile);
    input.pipe(child.stdin);
    input.on('error', () => { try { child.stdin.end(); } catch {} });
    
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI timeout (120s). stderr: ${stderr.slice(0, 200)}`));
    }, 120_000);
    
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`CLI exit ${code}. stderr: ${stderr.slice(0, 300)}. stdout: ${stdout.slice(0, 200)}`));
      }
    });
    
    child.on('error', (e) => {
      clearTimeout(timeout);
      reject(new Error(`CLI spawn error: ${e.message}`));
    });
  });
}

// ═══════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════

function getStatus() {
  return {
    authMode: ANTHROPIC_AUTH_MODE,
    apiAvailable: Boolean(anthropic),
    apiDisabled: Date.now() < apiDisabledUntil,
    apiDisabledUntil: apiDisabledUntil > 0 ? new Date(apiDisabledUntil).toISOString() : null,
    apiFailCount,
    cliFallbackActive: ANTHROPIC_AUTH_MODE !== 'api',
    mode:
      ANTHROPIC_AUTH_MODE === 'oauth'
        ? 'cli_only'
        : ANTHROPIC_AUTH_MODE === 'api'
          ? 'api_only'
          : (!anthropic || Date.now() < apiDisabledUntil)
            ? 'cli_only'
            : apiFailCount > 0
              ? 'degraded'
              : 'api_primary'
  };
}

function forceCLI() {
  apiDisabledUntil = Date.now() + (24 * 60 * 60 * 1000);
  console.log('[llm] forced OAuth CLI mode for 24h');
}

function resetAPI() {
  apiFailCount = 0;
  apiDisabledUntil = 0;
  console.log('[llm] API reset — auto mode will try Anthropic API again');
}

export { messages, getStatus, forceCLI, resetAPI };
export default { messages, getStatus, forceCLI, resetAPI };
