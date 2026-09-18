#!/usr/bin/env node
// One-shot: re-embed semantic_memory using the correct text columns.
// (Original reembed-all.js used COALESCE(content, claim) which don't exist
// on this table — its real text columns are `concept` and `category`.)
import { getEmbeddings } from '../local-embed.js';
import pg from 'pg';
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ||
    `postgres://${process.env.USER || 'postgres'}@localhost/oneiro`
});

const BATCH = 64;
const start = Date.now();
let done = 0;
const { rows: [{ total }] } = await pool.query(
  `SELECT count(*)::int AS total FROM semantic_memory WHERE embedding IS NULL`
);
console.log(`semantic_memory rows to embed: ${total}`);

while (true) {
  const { rows } = await pool.query(`
    SELECT id,
           COALESCE(concept,'') || COALESCE(' ['||category||']','') AS txt
    FROM semantic_memory WHERE embedding IS NULL
    ORDER BY created_at DESC LIMIT $1
  `, [BATCH]);
  if (rows.length === 0) break;
  const texts = rows.map(r => r.txt || ' ');
  let vecs;
  try { vecs = await getEmbeddings(texts); }
  catch (e) { console.error('embed err:', e.message); await new Promise(r => setTimeout(r, 3000)); continue; }
  const ids = rows.map(r => r.id);
  const lits = vecs.map(v => '[' + v.join(',') + ']');
  await pool.query(`
    UPDATE semantic_memory s SET embedding = v.emb::vector
    FROM (SELECT UNNEST($1::bigint[]) AS id, UNNEST($2::text[]) AS emb) v
    WHERE s.id = v.id
  `, [ids, lits]);
  done += rows.length;
  if (done % 320 === 0 || done >= total) {
    const rate = (done / ((Date.now() - start) / 1000)).toFixed(1);
    process.stdout.write(`\rprogress: ${done}/${total} (${rate}/s)`);
  }
}
console.log(`\nsemantic_memory done in ${((Date.now() - start) / 1000).toFixed(0)}s`);
await pool.end();
