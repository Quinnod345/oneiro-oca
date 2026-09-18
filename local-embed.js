// Drop-in replacement for OpenAI embeddings — routes to the local BGE-large
// server (127.0.0.1:7801) which exposes an OpenAI-compatible /v1/embeddings
// endpoint. Exports a single getEmbedding(text) -> Float[] returning a
// 1024-d vector. Importers no longer need an OpenAI client.

const EMBED_URL = process.env.ONEIRO_EMBED_URL || 'http://127.0.0.1:7801/v1/embeddings';
export const EMBED_DIM = 1024;
export const EMBED_MODEL = 'BAAI/bge-large-en-v1.5';

export async function getEmbedding(text) {
  const input = String(text || '').slice(0, 8000);
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), 60_000);
  try {
    const r = await fetch(EMBED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
      signal: ctl.signal
    });
    if (!r.ok) throw new Error(`embed server ${r.status}: ${await r.text().catch(()=>'')}`);
    const j = await r.json();
    return j.data?.[0]?.embedding;
  } finally { clearTimeout(tid); }
}

export async function getEmbeddings(texts) {
  if (!texts?.length) return [];
  const inputs = texts.map(t => String(t || '').slice(0, 8000));
  const out = [];
  const CHUNK = 64;
  for (let i = 0; i < inputs.length; i += CHUNK) {
    const ctl = new AbortController();
    const tid = setTimeout(() => ctl.abort(), 120_000);
    try {
      const r = await fetch(EMBED_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: inputs.slice(i, i + CHUNK) }),
        signal: ctl.signal
      });
      if (!r.ok) throw new Error(`embed server ${r.status}: ${await r.text().catch(()=>'')}`);
      const j = await r.json();
      for (const d of j.data) out.push(d.embedding);
    } finally { clearTimeout(tid); }
  }
  return out;
}
