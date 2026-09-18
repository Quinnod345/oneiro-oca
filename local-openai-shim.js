// Drop-in replacement for `import OpenAI from 'openai'; const openai = new OpenAI({…})`.
// Exposes the same `openai.embeddings.create()` and `openai.chat.completions.create()`
// shape. Chat remains local-only. Embeddings follow the selected Oneiro backend:
//   - local  → BGE-large at 127.0.0.1:7801 (1024-d)
//   - openai → OpenAI embeddings API with 1024 dimensions
//   - hash   → CPU-only lexical fallback so memory writes do not fail hard

import { getProviderCredential, hasProviderCredential } from './provider-credentials.js';
import { createLocalChatTransport } from './local-chat-transport.js';

const EMBED_URL  = process.env.ONEIRO_EMBED_URL          || 'http://127.0.0.1:7801/v1/embeddings';
const EMBED_BACKEND = chooseEmbeddingBackend();
const EMBED_DIMENSIONS = clampInt(process.env.ONEIRO_EMBED_DIMENSIONS, 1024, 128, 3072);
const OPENAI_EMBED_MODEL = process.env.ONEIRO_OPENAI_EMBED_MODEL || 'text-embedding-3-small';
const OPENAI_EMBED_URL = process.env.ONEIRO_OPENAI_EMBED_URL || 'https://api.openai.com/v1/embeddings';
const OPENAI_API_KEY = getProviderCredential('OPENAI_API_KEY');
// Model, transport and residency are explicit deployment choices. Observation
// remains deterministic; keeping weights loaded does not trigger generation.
const CHAT_URL   = process.env.ONEIRO_LOCAL_REASONER_URL || 'http://127.0.0.1:11434';
const CHAT_KEY   = process.env.ONEIRO_LOCAL_REASONER_KEY || '';
const CHAT_MODEL = process.env.ONEIRO_OCA_THINKER_MODEL || process.env.ONEIRO_LOCAL_REASONER_MODEL || 'qwen2.5:0.5b';
const KEEP_ALIVE = process.env.ONEIRO_OCA_THINKER_KEEP_ALIVE || '2m';
const createChat = createLocalChatTransport({ url: CHAT_URL, model: CHAT_MODEL, key: CHAT_KEY,
  keepAlive: KEEP_ALIVE, transport: process.env.ONEIRO_LOCAL_REASONER_TRANSPORT || 'openai',
  contextSize: Number(process.env.ONEIRO_LOCAL_REASONER_CONTEXT || 8192) });

async function postJson(url, headers, body, timeoutMs = 180_000, signal = null) {
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: signal ? AbortSignal.any([ctl.signal, signal]) : ctl.signal });
    if (!r.ok) throw new Error(`${url} ${r.status}: ${await r.text().catch(()=>'')}`);
    return await r.json();
  } finally { clearTimeout(tid); }
}

let warnedHashFallback = false;

function chooseEmbeddingBackend() {
  const explicit = String(process.env.ONEIRO_EMBED_BACKEND || '').trim().toLowerCase();
  if (['local', 'openai', 'hash'].includes(explicit)) return explicit;

  const llmBackend = String(process.env.OCA_LLM_BACKEND || process.env.ONEIRO_LLM_BACKEND || 'local').trim().toLowerCase();
  const hasOpenAIKey = hasProviderCredential('OPENAI_API_KEY');
  if ((llmBackend === 'openai' || llmBackend === 'anthropic') && hasOpenAIKey) return 'openai';
  if (llmBackend === 'openai' || llmBackend === 'anthropic') return 'hash';
  return 'local';
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeVector(values, dimensions = EMBED_DIMENSIONS) {
  const out = new Array(dimensions).fill(0);
  const source = Array.isArray(values) ? values : [];
  for (let i = 0; i < Math.min(source.length, dimensions); i++) {
    const n = Number(source[i]);
    out[i] = Number.isFinite(n) ? n : 0;
  }
  let norm = 0;
  for (const value of out) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return out.map(value => value / norm);
}

function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hashEmbedding(text, dimensions = EMBED_DIMENSIONS) {
  const input = String(text || '').toLowerCase();
  const tokens = input.match(/[a-z0-9_'-]{2,}/g) || [];
  const features = [];
  for (const token of tokens) features.push(token);
  for (let i = 0; i < tokens.length - 1; i++) features.push(`${tokens[i]} ${tokens[i + 1]}`);
  if (features.length === 0) features.push(input.slice(0, 64) || 'empty');

  const vec = new Array(dimensions).fill(0);
  for (const feature of features) {
    const hash = fnv1a32(feature);
    const idx = hash % dimensions;
    const sign = (hash & 0x80000000) ? -1 : 1;
    const weight = feature.includes(' ') ? 0.7 : 1.0;
    vec[idx] += sign * weight;
  }
  return normalizeVector(vec, dimensions);
}

function hashEmbeddingResponse(input, model = 'oneiro-lexical-hash') {
  const inputs = Array.isArray(input) ? input : [input];
  return {
    object: 'list',
    model,
    data: inputs.map((value, index) => ({
      object: 'embedding',
      index,
      embedding: hashEmbedding(value)
    })),
    usage: { prompt_tokens: 0, total_tokens: 0 }
  };
}

function warnHashFallback(reason) {
  if (warnedHashFallback) return;
  warnedHashFallback = true;
  console.warn(`[embed] ${reason}; using CPU lexical hash embeddings`);
}

async function createEmbedding({ input, model, dimensions } = {}) {
  const requestedModel = model || OPENAI_EMBED_MODEL;
  const requestedDimensions = clampInt(dimensions, EMBED_DIMENSIONS, 128, 3072);

  if (EMBED_BACKEND === 'hash') {
    warnHashFallback('remote embedding backend is not configured');
    return hashEmbeddingResponse(input);
  }

  if (EMBED_BACKEND === 'openai') {
    if (!OPENAI_API_KEY) {
      warnHashFallback('ONEIRO_EMBED_BACKEND=openai but OPENAI_API_KEY is missing');
      return hashEmbeddingResponse(input);
    }
    const body = {
      model: requestedModel,
      input: Array.isArray(input) ? input.map(t => String(t || '').slice(0, 8000)) : String(input || '').slice(0, 8000)
    };
    if (String(requestedModel).startsWith('text-embedding-3')) {
      body.dimensions = requestedDimensions;
    }
    try {
      const response = await postJson(
        OPENAI_EMBED_URL,
        {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body,
        60_000
      );
      if (!Array.isArray(response?.data) || response.data.length === 0) {
        throw new Error('OpenAI returned no embedding data');
      }
      const bad = response?.data?.find(item => item?.embedding?.length !== requestedDimensions);
      if (bad) throw new Error(`OpenAI returned ${bad.embedding?.length || 0} dimensions, expected ${requestedDimensions}`);
      return response;
    } catch (e) {
      warnHashFallback(`OpenAI embeddings failed: ${e.message}`);
      return hashEmbeddingResponse(input);
    }
  }

  try {
    return await postJson(EMBED_URL, { 'Content-Type': 'application/json' }, { input });
  } catch (e) {
    warnHashFallback(`local embed server failed: ${e.message}`);
    return hashEmbeddingResponse(input);
  }
}

export const openai = {
  embeddings: {
    async create(opts) {
      return await createEmbedding(opts);
    }
  },
  chat: {
    completions: {
      async create(opts, options = {}) {
        return await createChat(opts, options);
      }
    }
  },
  // No-op for vision images-in-chat — most callers route through chat.completions.create
  // with image_url content; the local text reasoner does not host vision, but
  // our `vision_server.py` (7802) does.
  // If a caller needs image vision, they should switch to the vision server directly.
};

// Provide a default export too so `import OpenAI from './local-openai-shim.js'` works:
//   const openai = new OpenAI();  // ignores config, returns the shim
class OpenAIShim {
  constructor() { return openai; }
}
export default OpenAIShim;
