import { LocalInferenceQueue } from './local-inference-queue.js';
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
import OpenAI from 'openai';
import { execSync, spawn as spawnChild } from 'child_process';
import { createReadStream } from 'fs';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { openai as localOpenAI } from './local-openai-shim.js';
import { getProviderCredential } from './provider-credentials.js';
import { codexAvailable, runCodex } from './codex-cli.js';

const BUNDLED_APP = process.env.ONEIRO_BUNDLED_APP === '1' ||
  import.meta.url.includes('.app/Contents/Resources/oca-cognitive');
const API_KEY = getProviderCredential('ANTHROPIC_API_KEY');
let anthropic = null;
try {
  if (API_KEY) anthropic = new Anthropic({ apiKey: API_KEY });
} catch {}
const OPENAI_API_KEY = getProviderCredential('OPENAI_API_KEY');
const OPENAI_MODEL = process.env.ONEIRO_OPENAI_MODEL || 'gpt-4.1-mini';
let openai = null;
try {
  if (OPENAI_API_KEY) openai = new OpenAI({ apiKey: OPENAI_API_KEY });
} catch {}

const LLM_BACKEND = (() => {
  const raw = String(process.env.OCA_LLM_BACKEND || process.env.ONEIRO_LLM_BACKEND || 'local').trim().toLowerCase();
  return ['local', 'anthropic', 'openai', 'codex'].includes(raw) ? raw : 'local';
})();

// ═══════════════════════════════════════════════════
// INFERENCE POLICY — which brain the engine thinks with
// ═══════════════════════════════════════════════════
// A person's setting, not the environment's. `local` is WORK's model over Tailscale and never spends the
// Codex subscription; `cloud` is Codex (gpt-6-astra, high reasoning) for every step, local only while Codex
// is out; `auto` is local first, Codex for the hard steps that ask for it and for any step while the local
// backend is unreachable. The controls set it each tick; env seeds the default before the first tick.
export const INFERENCE_MODES = ['local', 'auto', 'cloud'];
const inferencePolicy = {
  mode: INFERENCE_MODES.includes(String(process.env.OCA_INFERENCE_MODE || '').toLowerCase()) ? String(process.env.OCA_INFERENCE_MODE).toLowerCase() : 'auto',
  cloudModel: process.env.OCA_CODEX_MODEL || process.env.ONEIRO_CODEX_MODEL || 'gpt-6-astra',
  cloudEffort: process.env.OCA_CODEX_REASONING_EFFORT || process.env.ONEIRO_CODEX_REASONING_EFFORT || 'high',
};
const inferenceStats = { calls: { local: 0, codex: 0, anthropic: 0, openai: 0 }, crossovers: [], lastUsed: null, lastUsedAt: null };
let codexDownUntil = 0;
const CODEX_BACKOFF_MS = 15 * 60 * 1000;
const CODEX_OUT = /usage limit|not logged|unauthori|rate limit|quota|exited \d+|ENOENT|timed out|ECONN|network|aborted/i;
const LOCAL_DOWN = /circuit open|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|timed out|aborted|socket hang up|HTTP 5\d\d/i;

export function setInferencePolicy({ mode, cloudModel, cloudEffort } = {}) {
  if (mode !== undefined) {
    const m = String(mode).trim().toLowerCase();
    if (!INFERENCE_MODES.includes(m)) throw new Error(`inference mode must be one of ${INFERENCE_MODES.join(', ')}`);
    if (m !== inferencePolicy.mode) console.log(`[llm] inference mode ${inferencePolicy.mode} → ${m}`);
    inferencePolicy.mode = m;
  }
  if (cloudModel !== undefined && /^[A-Za-z0-9._:-]{1,64}$/.test(String(cloudModel))) inferencePolicy.cloudModel = String(cloudModel);
  if (cloudEffort !== undefined && ['minimal', 'low', 'medium', 'high', 'xhigh'].includes(String(cloudEffort).toLowerCase())) inferencePolicy.cloudEffort = String(cloudEffort).toLowerCase();
  return getInferencePolicy();
}
export function getInferencePolicy() {
  return { ...inferencePolicy, codexAvailable: codexAvailable(), codexSlots: CODEX_SLOTS, codexBusy: codexSlots, codexBackedOffUntil: codexDownUntil > Date.now() ? new Date(codexDownUntil).toISOString() : null,
    stats: { ...inferenceStats, calls: { ...inferenceStats.calls }, crossovers: inferenceStats.crossovers.slice(-10) } };
}
// The provider a step asked for, under the policy: local mode never reaches Codex; cloud mode sends local
// requests to Codex; auto leaves the request as asked (fallbacks happen on failure, below).
export function resolveProvider(requested) {
  const r = ['local', 'anthropic', 'openai', 'codex'].includes(requested) ? requested : 'local';
  if (inferencePolicy.mode === 'local' && r === 'codex') return 'local';
  if (inferencePolicy.mode === 'cloud' && r === 'local') return codexAvailable() ? 'codex' : 'local';
  return r;
}
function noteUsed(provider) { inferenceStats.calls[provider] = (inferenceStats.calls[provider] || 0) + 1; inferenceStats.lastUsed = provider; inferenceStats.lastUsedAt = Date.now(); }
function noteCrossover(from, to, why) {
  inferenceStats.crossovers.push({ at: Date.now(), from, to, why: String(why || '').slice(0, 160) });
  if (inferenceStats.crossovers.length > 50) inferenceStats.crossovers.splice(0, inferenceStats.crossovers.length - 50);
  console.warn(`[llm] ${from} → ${to}: ${String(why || '').slice(0, 140)}`);
}
// Codex runs as a subprocess per call. A few at once is plenty and keeps a burst of steps from spawning a
// dozen; a person-fired call (a draft they are waiting on) takes the next free slot ahead of queued strategies.
const CODEX_SLOTS = Math.max(1, Math.min(8, Number(process.env.OCA_CODEX_SLOTS) || 4));
let codexSlots = 0; const codexWaiters = [];
async function withCodexSlot(fn, { interactive = false } = {}) {
  if (codexSlots >= CODEX_SLOTS) await new Promise(resolve => { if (interactive) codexWaiters.unshift(resolve); else codexWaiters.push(resolve); });
  codexSlots++;
  try { return await fn(); } finally { codexSlots--; codexWaiters.shift()?.(); }
}

const ANTHROPIC_AUTH_MODE = (() => {
  const fallback = BUNDLED_APP ? 'api' : 'auto';
  const raw = String(process.env.ANTHROPIC_AUTH_MODE || fallback).trim().toLowerCase();
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
  if (BUNDLED_APP) return '';
  const homedir = process.env.HOME || process.env.USERPROFILE || '/tmp';
  const userLocalClaude = [homedir, '.local', 'bin', 'claude'].join('/');
  const candidates = [
    userLocalClaude,
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
  'claude-sonnet-4-20250514': 'sonnet',
  'claude-haiku-3-5-20241022': 'haiku',
  'claude-3-5-haiku-20241022': 'haiku',
  'claude-opus-4-1-20250805': 'opus',
};

function getCliModel(apiModel) {
  return MODEL_TO_CLI[apiModel] || 'sonnet';
}

// ═══════════════════════════════════════════════════
// MAIN INTERFACE — drop-in replacement for anthropic.messages.create()
// ═══════════════════════════════════════════════════

const localInferenceQueue = new LocalInferenceQueue();
const messages = {
  async create(params, options = {}) {
    // Per-call backend override so the thinker can use OpenAI gpt-5.4
    // even when the rest of OCA is on Anthropic/local. Strip the
    // override before forwarding so it never reaches the provider SDK.
    const providerOverride = (() => {
      const raw = String(params?.provider || '').trim().toLowerCase();
      if (raw && ['local', 'anthropic', 'openai', 'codex'].includes(raw)) return raw;
      return null;
    })();
    if (providerOverride) {
      const { provider, ...forward } = params;
      void provider;
      params = forward;
    }

    const effectiveBackend = resolveProvider(providerOverride || LLM_BACKEND);
    const local = async () => { const r = await localInferenceQueue.run(() => callLocal(params, options), options); noteUsed('local'); return r; };
    const cloud = async () => { const r = await withCodexSlot(() => callCodex(params, options), { interactive: options.interactive === true }); noteUsed('codex'); return r; };

    if (effectiveBackend === 'local') {
      try { return await local(); }
      catch (e) {
        // Auto: a local backend that is down is not a reason for the engine to stop thinking.
        if (inferencePolicy.mode === 'auto' && LOCAL_DOWN.test(String(e.message)) && codexAvailable() && Date.now() >= codexDownUntil) {
          noteCrossover('local', 'codex', e.message);
          try { return await cloud(); } catch (e2) { if (CODEX_OUT.test(String(e2.message))) codexDownUntil = Date.now() + CODEX_BACKOFF_MS; throw e; }
        }
        throw e;
      }
    }

    if (effectiveBackend === 'openai') {
      noteUsed('openai');
      return await callOpenAI(params);
    }

    if (effectiveBackend === 'codex') {
      // Codex out (usage limit, sign-in, transport): the same step runs locally, and Codex rests for a while.
      if (Date.now() < codexDownUntil) { noteCrossover('codex', 'local', `Codex resting until ${new Date(codexDownUntil).toISOString()}`); return await local(); }
      try { return await cloud(); }
      catch (e) {
        if (!CODEX_OUT.test(String(e.message))) throw e;
        codexDownUntil = Date.now() + CODEX_BACKOFF_MS;
        noteCrossover('codex', 'local', e.message);
        return await local();
      }
    }

    if (ANTHROPIC_AUTH_MODE === 'oauth') {
      return await withCliLock(() => callCLI(params));
    }

    if (!anthropic) {
      if (ANTHROPIC_AUTH_MODE === 'api') {
        throw new Error('ANTHROPIC_AUTH_MODE=api but ANTHROPIC_API_KEY is not configured');
      }
      if (BUNDLED_APP) {
        throw new Error('Anthropic backend selected, but no Anthropic API key is configured for the bundled app');
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

async function callOpenAI(params) {
  if (!openai) {
    throw new Error('OpenAI backend selected, but OPENAI_API_KEY is not configured');
  }

  const chatMessages = [];
  if (params.system) {
    chatMessages.push({ role: 'system', content: flattenContent(params.system) });
  }
  for (const msg of params.messages || []) {
    chatMessages.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: flattenContent(msg.content),
    });
  }

  // GPT-5 series rejects the legacy `max_tokens` field and requires
  // `max_completion_tokens`. We send the new field unconditionally —
  // the chat completions API accepts it for older models too.
  const completion = await openai.chat.completions.create({
    model: getOpenAIModel(params.model),
    messages: chatMessages,
    temperature: params.temperature ?? 0.3,
    max_completion_tokens: params.max_tokens ?? 2000,
  });
  const text = completion?.choices?.[0]?.message?.content || '';
  return {
    id: completion?.id || `openai-${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: completion?.model || OPENAI_MODEL,
    stop_reason: completion?.choices?.[0]?.finish_reason || 'end_turn',
    usage: completion?.usage || { input_tokens: 0, output_tokens: 0 },
    _via: 'openai_api',
  };
}

async function callCodex(params, options = {}) {
  const prompt = buildTextPrompt(params);
  const requestedModel = String(params?.model || '').trim();
  // A step that names a Codex model gets it; anything else (a local model name, nothing) gets the policy's.
  const model = requestedModel.startsWith('gpt-') ? requestedModel : inferencePolicy.cloudModel;
  const result = await runCodex(prompt, {
    workingDirectory: process.env.ONEIRO_CODEX_WORKSPACE || '/Users/quinnodonnell/oneiro/runtime/workspace',
    model, reasoningEffort: inferencePolicy.cloudEffort,
    sandbox: 'read-only', signal: options.signal, outputSchema: options.responseSchema,
  });

  return {
    id: `codex-${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: result.text }],
    model: result.model,
    stop_reason: 'end_turn',
    usage: result.usage || { input_tokens: 0, output_tokens: 0 },
    _via: result.via,
  };
}

function getOpenAIModel(requested) {
  const model = String(requested || '').trim();
  if (!model || model.startsWith('claude-')) return OPENAI_MODEL;
  return model;
}

async function callLocal(params, options = {}) {
  const chatMessages = [];
  if (params.system) {
    chatMessages.push({ role: 'system', content: flattenContent(params.system) });
  }
  for (const msg of params.messages || []) {
    chatMessages.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: flattenContent(msg.content),
    });
  }

  const completion = await localOpenAI.chat.completions.create({
    messages: chatMessages,
    temperature: params.temperature ?? 0.3,
    max_tokens: params.max_tokens ?? 2000,
    ...(options.responseSchema ? { response_format: { type: 'json_schema',
      json_schema: { name: 'oca_response', strict: true, schema: options.responseSchema } } }
      : options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  }, options);
  const localModel =
    process.env.ONEIRO_OCA_THINKER_MODEL ||
    process.env.ONEIRO_LOCAL_REASONER_MODEL ||
    'qwen2.5:0.5b';
  const text = completion?.choices?.[0]?.message?.content || '';
  return {
    id: `local-${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: completion?.model || localModel,
    stop_reason: completion?.choices?.[0]?.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
    usage: completion?.usage || { input_tokens: 0, output_tokens: 0 },
    timings: completion?.timings,
    _via: 'local_reasoner',
  };
}

function flattenContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  return content
    .map(part => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text') return part.text || '';
      if (part?.type === 'image' || part?.type === 'image_url') return '[image omitted for local text reasoner]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function buildTextPrompt(params) {
  const parts = [];
  if (params?.system) parts.push(flattenContent(params.system));
  for (const message of params?.messages || []) {
    const role = message?.role === 'assistant' ? 'Assistant' : 'User';
    parts.push(`${role}: ${flattenContent(message?.content)}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

// ═══════════════════════════════════════════════════
// CLI FALLBACK — local development only, disabled in bundled apps.
// ═══════════════════════════════════════════════════

async function callCLI(params) {
  if (BUNDLED_APP) {
    throw new Error('CLI fallback is disabled in bundled Oneiro builds');
  }
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
        HOME: process.env.HOME || process.env.USERPROFILE || '/tmp',
        PATH: `${process.env.HOME || ''}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
        USER: process.env.USER || 'unknown',
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
    
    const CLI_TIMEOUT_MS = parseInt(process.env.LLM_CLI_TIMEOUT_MS || '120000', 10);
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI timeout (${Math.round(CLI_TIMEOUT_MS/1000)}s). stderr: ${stderr.slice(0, 200)}`));
    }, CLI_TIMEOUT_MS);
    
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
    backend: LLM_BACKEND,
    local: {
      model: process.env.ONEIRO_OCA_THINKER_MODEL || process.env.ONEIRO_LOCAL_REASONER_MODEL || 'qwen2.5:0.5b',
      transport: process.env.ONEIRO_LOCAL_REASONER_TRANSPORT || 'openai',
      contextSize: process.env.ONEIRO_LOCAL_REASONER_TRANSPORT === 'ollama'
        ? Number(process.env.ONEIRO_LOCAL_REASONER_CONTEXT || 8192) : null,
      keepAlive: process.env.ONEIRO_LOCAL_REASONER_TRANSPORT === 'ollama'
        ? (process.env.ONEIRO_OCA_THINKER_KEEP_ALIVE || '2m') : null,
      residencyControl: process.env.ONEIRO_LOCAL_REASONER_TRANSPORT === 'ollama' ? 'per_request' : 'server_default',
    },
    inference: getInferencePolicy(),
    authMode: ANTHROPIC_AUTH_MODE,
    apiAvailable:
      LLM_BACKEND === 'openai'
        ? Boolean(openai)
        : LLM_BACKEND === 'codex'
          ? codexAvailable()
          : Boolean(anthropic),
    codexAvailable: codexAvailable(),
    openaiAvailable: Boolean(openai),
    anthropicAvailable: Boolean(anthropic),
    apiDisabled: Date.now() < apiDisabledUntil,
    apiDisabledUntil: apiDisabledUntil > 0 ? new Date(apiDisabledUntil).toISOString() : null,
    apiFailCount,
    cliFallbackActive: ANTHROPIC_AUTH_MODE !== 'api',
    mode:
      LLM_BACKEND === 'local'
        ? 'local_reasoner'
        : LLM_BACKEND === 'openai'
        ? 'openai_api'
        : LLM_BACKEND === 'codex'
        ? 'codex_chatgpt_subscription'
        : ANTHROPIC_AUTH_MODE === 'oauth'
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

// Backend health for /oca/health: circuit state of the local inference transport.
export function inferenceHealth() { return localOpenAI.inferenceHealth?.() || null; }
