#!/usr/bin/env node
// Re-embed every OCA table whose `embedding` column is now NULL after the
// 1024-d migration. Hits local BGE-large (127.0.0.1:7801). Processes tables
// in order of (size × recency) — newest rows first so the most useful
// context comes online quickly. Resumable: each run only embeds rows that
// are still NULL.

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    `postgres://${process.env.USER || 'postgres'}@localhost/oneiro`
});

const EMBED_URL = process.env.ONEIRO_EMBED_URL || 'http://127.0.0.1:7801/v1/embeddings';

// (table, primary_key, text-expression). text expr must return a TEXT.
// Tables not listed have no obvious textual column we'd want to re-embed —
// they'll stay NULL until OCA recomputes them naturally.
const TABLES = [
  { tbl: 'screenshot_memory', pk: 'id', text: "COALESCE(description,'') || E'\\n' || COALESCE('('||front_app||')','')" },
  { tbl: 'episodic_memory',   pk: 'id', text: 'content' },
  { tbl: 'semantic_memory',   pk: 'id', text: "COALESCE(content, claim, '')" },
  { tbl: 'hypotheses',        pk: 'id', text: 'claim' },
  { tbl: 'screen_context',    pk: 'id', text: "COALESCE(content, summary, '')" },
  { tbl: 'thoughts',          pk: 'id', text: 'content' },
  { tbl: 'thought_chains',    pk: 'id', text: "COALESCE(summary, content, '')" },
  { tbl: 'reflections',       pk: 'id', text: "COALESCE(content, summary, '')" },
  { tbl: 'moments',           pk: 'id', text: "COALESCE(summary, content, description, '')" },
  { tbl: 'dreams',            pk: 'id', text: "COALESCE(content, summary, narrative, '')" },
  { tbl: 'undercurrents',     pk: 'id', text: "COALESCE(content, theme, '')" },
  { tbl: 'extended_undercurrents', pk: 'id', text: "COALESCE(content, theme, '')" },
  { tbl: 'bonds',             pk: 'id', text: "COALESCE(content, description, '')" },
  { tbl: 'private_chunks',    pk: 'id', text: "COALESCE(content, '')" },
  { tbl: 'conversation_log',  pk: 'id', text: "COALESCE(message, content, '')" },
  { tbl: 'entities',          pk: 'id', text: "canonical_name || COALESCE(' ' || array_to_string(aliases, ' '), '')" }
];

const BATCH = 64;

async function embedBatch(texts) {
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), 180_000);
  try {
    const r = await fetch(EMBED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: texts }),
      signal: ctl.signal
    });
    if (!r.ok) throw new Error(`embed server ${r.status}: ${await r.text().catch(()=>'')}`);
    const j = await r.json();
    return j.data.map(d => d.embedding);
  } finally { clearTimeout(tid); }
}

function vectorLit(arr) { return '[' + arr.join(',') + ']'; }

async function probeColumns(tbl) {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
    [tbl]
  );
  return new Set(rows.map(r => r.column_name));
}

async function reembedTable({ tbl, pk, text }) {
  // Determine ORDER column — prefer captured_at, then occurred_at, then created_at, then pk.
  const cols = await probeColumns(tbl);
  const orderCol = ['captured_at','occurred_at','created_at','timestamp','last_seen','updated_at']
    .find(c => cols.has(c)) || pk;
  const { rows: [{ total }] } = await pool.query(
    `SELECT count(*)::int AS total FROM public.${tbl} WHERE embedding IS NULL`
  );
  if (total === 0) {
    console.log(`[${tbl}] already fully embedded`);
    return;
  }
  console.log(`[${tbl}] re-embedding ${total} rows (ordered by ${orderCol} DESC)`);

  let done = 0;
  const start = Date.now();
  while (true) {
    const { rows } = await pool.query(
      `SELECT ${pk} AS pk, (${text}) AS txt
       FROM public.${tbl}
       WHERE embedding IS NULL
       ORDER BY ${orderCol} DESC NULLS LAST
       LIMIT $1`,
      [BATCH]
    );
    if (rows.length === 0) break;

    const texts = rows.map(r => (r.txt && r.txt.trim()) ? r.txt : null);
    // Rows with empty/null text → mark them with a zero vector so they don't keep coming back.
    const nonEmptyIdx = texts.map((t,i) => t ? i : -1).filter(i => i >= 0);
    let vecs;
    try {
      vecs = nonEmptyIdx.length > 0
        ? await embedBatch(nonEmptyIdx.map(i => texts[i]))
        : [];
    } catch (e) {
      console.error(`[${tbl}] embedBatch error:`, e.message, '— retrying in 4s');
      await new Promise(r => setTimeout(r, 4000));
      continue;
    }

    // Build vector array for the WHOLE batch; empty texts get a zero vector.
    const ZERO = new Array(1024).fill(0);
    const allVecs = texts.map((t, i) => {
      const found = nonEmptyIdx.indexOf(i);
      return found >= 0 ? vecs[found] : ZERO;
    });
    const ids = rows.map(r => r.pk);
    const lits = allVecs.map(vectorLit);
    await pool.query(
      `UPDATE public.${tbl} o
         SET embedding = v.emb::vector
       FROM (SELECT UNNEST($1::bigint[]) AS pk, UNNEST($2::text[]) AS emb) v
       WHERE o.${pk} = v.pk`,
      [ids, lits]
    );

    done += rows.length;
    if (done % (BATCH * 10) === 0 || done >= total) {
      const rate = (done / ((Date.now() - start) / 1000)).toFixed(1);
      console.log(`  [${tbl}] ${done}/${total} (${rate}/s)`);
    }
  }
  const dur = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`[${tbl}] done in ${dur}s`);
}

async function main() {
  console.log('=== OCA re-embed (BGE-large, 1024-d) ===');
  for (const t of TABLES) {
    try { await reembedTable(t); }
    catch (e) {
      console.error(`[${t.tbl}] FAILED:`, e.message);
    }
  }
  console.log('=== all tables processed ===');
  await pool.end();
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
