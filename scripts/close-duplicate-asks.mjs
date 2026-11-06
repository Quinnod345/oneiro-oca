#!/usr/bin/env node
// Closes all but the newest open ask per subject. Before the growth loop keyed its asks on (kind, subject), every run
// that redrafted a review reply raised a new ask with a new approval code, so the same four reviews piled up in Judge.
//
// By default it prints what it would do and changes nothing. Pass --apply to act. Running it again finds nothing to do.
// It only ever closes Apple change asks, or asks that name a subject. Payments and asks an agent is parked on are left
// alone, and an ask holding the code its proposal still uses is never closed. Closing doesn't approve anything: a closed
// ask's code simply stops being shown.
//
//   DATABASE_URL=postgres://… node scripts/close-duplicate-asks.mjs [--apply]
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { parseAppleAsk } from '../apple/change-words.js';

/** Which asks to close: for each subject, everything but the newest. Pure. rows are newest first or any order. */
export function duplicatesOf(rows, { liveCodes = new Set(), parked = new Set() } = {}) {
  const groups = new Map();
  for (const r of rows) {
    if (r.metadata?.payment === true || parked.has(r.id)) continue;
    const old = r.metadata?.apple ? null : parseAppleAsk(r.message);
    const subject = r.metadata?.subject || (old ? `apple-why:${old.why}` : null);
    if (!subject) continue;
    const approval = r.metadata?.apple?.approval || old?.approval || null;
    if (!groups.has(subject)) groups.set(subject, []);
    groups.get(subject).push({ id: r.id, approval, at: new Date(r.created_at).getTime(), why: r.metadata?.apple?.why || old?.why || subject });
  }
  const close = [], keep = [];
  for (const [subject, asks] of groups) {
    asks.sort((a, b) => b.at - a.at || b.id - a.id);
    // Two reviews can share a date, so "why" alone can name two subjects. A code a proposal still holds is always current.
    const newest = asks[0];
    for (const a of asks) (a === newest || (a.approval && liveCodes.has(a.approval)) ? keep : close).push({ ...a, subject });
  }
  return { close, keep };
}

export async function closeDuplicates(pool, { apply = false, clock = Date.now, log = console.log } = {}) {
  const { rows } = await pool.query(`SELECT id, message, created_at, metadata FROM notifications WHERE category = 'ask' AND replied_at IS NULL ORDER BY created_at DESC`);
  const { rows: proposals } = await pool.query(`SELECT approval_id FROM apple_proposals WHERE approval_id IS NOT NULL`).catch(() => ({ rows: [] }));
  const { rows: waiting } = await pool.query(`SELECT DISTINCT ask_id FROM agent_deployments WHERE ask_id IS NOT NULL AND status IN ('waiting_person', 'standing', 'running')`).catch(() => ({ rows: [] }));
  const { close, keep } = duplicatesOf(rows, { liveCodes: new Set(proposals.map(p => p.approval_id)), parked: new Set(waiting.map(w => w.ask_id)) });
  for (const a of keep) log(`keep   #${a.id}${a.approval ? ` (code ${a.approval})` : ''}: ${a.why}`);
  for (const a of close) log(`${apply ? 'close ' : 'would close'} #${a.id}${a.approval ? ` (code ${a.approval})` : ''}: ${a.why}`);
  if (apply && close.length) {
    await pool.query(`UPDATE notifications SET replied_at = to_timestamp($2 / 1000.0), read = true,
      metadata = metadata || jsonb_build_object('closed', jsonb_build_object('why', 'a duplicate of a newer ask about the same thing', 'at', $2::float8))
      WHERE id = ANY($1) AND category = 'ask' AND replied_at IS NULL`, [close.map(a => a.id), clock()]);
  }
  log(close.length ? (apply ? `Closed ${close.length} duplicate asks; ${keep.length} stay open.` : `Would close ${close.length} duplicate asks; ${keep.length} would stay open. Run with --apply to do it.`) : 'Nothing to close.');
  return { closed: apply ? close.map(a => a.id) : [], wouldClose: close.map(a => a.id), kept: keep.map(a => a.id) };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const dsn = process.env.DATABASE_URL || process.env.OCA_DATABASE_URL;
  if (!dsn) { console.error('Set DATABASE_URL to the engine\'s database, then run this again.'); process.exit(1); }
  const pool = new pg.Pool({ connectionString: dsn });
  try { await closeDuplicates(pool, { apply: process.argv.includes('--apply') }); }
  catch (e) { console.error(`Couldn't read the open asks: ${e.message}`); process.exitCode = 1; }
  finally { await pool.end(); }
}
