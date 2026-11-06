// "Since you were last here": what changed while the person was away, for the Mac app's Now page and its
// notifications. One read of what the engine already records; nothing here is computed by a model.
//
//   finished  pursuits that were sated or resolved since then
//   failed    pursuits that stalled, ran out of budget or failed since then, plus agent runs that failed
//   moved     pursuits that changed and are still going
//   waiting   open asks and things to judge (each marked new when it arrived since then)
//   night     the last overnight run since then, when it left cards or went wrong
//
// GET /oca/trail?days=<n> is the same record as a dated list for Activity: agents that ended, what was delivered and
// judged, pursuits that finished or stuck, and nights. Newest first.
//
// GET /oca/since?at=<ms or ISO date>. The app also polls it for notifications, with the header
// `X-Oneiro-Notifier: app` (channels/mac-notify.js), so it can tell a new ask or a finished pursuit apart from
// what it has already shown.
import { Router } from 'express';
import { agentNameFromTask } from './agent-names.js';
import { clipText } from './clip.js';

const text = clipText;
const ms = v => { const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? t : null; };
const iso = v => { const t = ms(v); return t === null ? null : new Date(t).toISOString(); };
export const FAILED = ['failed', 'stalled', 'budget'];
export const LIST_LIMIT = 6;
export const TRAIL_LIMIT = 120;

// `at` as the app sends it: epoch milliseconds or an ISO date. A missing or unreadable one is refused rather than
// read as "forever", which would flood the page.
export function parseSince(raw, now = Date.now()) {
  if (raw === undefined || raw === null || raw === '') return null;
  const s = String(raw).trim();
  const n = /^\d+$/.test(s) ? Number(s) : /^\d{4}-\d{2}-\d{2}/.test(s) ? Date.parse(s) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, now);
}

// One pursuit row as the digest shows it.
function pursuitOf(r) {
  const want = r.want || {};
  return { chainId: r.id, title: text(r.headline || want.description || r.seed, 160), status: r.status, wantStatus: want.status || null,
    progress: Number.isFinite(Number(want.progress)) ? Number(want.progress) : null, at: iso(r.updated_at) };
}

// Sort the changed pursuits into finished / failed / moved. Cancelled ones were the person's own doing: left out.
export function classify(rows) {
  const out = { finished: [], failed: [], moved: [] };
  for (const r of rows) {
    const p = pursuitOf(r);
    if (r.status === 'cancelled' || p.wantStatus === 'cancelled') continue;
    if (p.wantStatus === 'sated' || r.status === 'resolved') out.finished.push(p);
    else if (FAILED.includes(r.status)) out.failed.push(p);
    else out.moved.push(p);
  }
  return out;
}

export function createSince({ pool, inbox = null, night = null, clock = Date.now, log = console } = {}) {
  async function digest(sinceMs) {
    const since = new Date(sinceMs);
    const { rows } = await pool.query(`SELECT id, seed, status, updated_at, (ponder_state->'want') - 'receipts' AS want, ponder_state #>> '{continuity,board,headline}' AS headline
      FROM thought_chains WHERE ponder_state IS NOT NULL AND ponder_state -> 'deleted' IS NULL AND updated_at > $1 ORDER BY updated_at DESC LIMIT 200`, [since]);
    const sorted = classify(rows);
    // Agent runs that ended since then. A missing table (an engine without agents) is just no runs.
    const runs = await pool.query(`SELECT *, COALESCE(ended_at, updated_at) AS at
      FROM agent_deployments WHERE kind <> 'talker' AND status IN ('done', 'failed') AND COALESCE(ended_at, updated_at) > $1
      ORDER BY COALESCE(ended_at, updated_at) DESC LIMIT 200`, [since]).then(r => r.rows).catch(() => []);
    const agentFailures = runs.filter(r => r.status === 'failed');
    let list = null;
    if (inbox) list = await inbox.list().catch(e => { log.warn?.('[since] inbox:', text(e.message, 160)); return null; });
    const fresh = at => { const t = ms(at); return t !== null && t > sinceMs; };
    const asks = (list?.asks || []).map(a => ({ id: a.id, chainId: a.chainId ?? null, kind: a.kind || 'question', payment: a.payment === true,
      text: text(a.detail || a.message, 240), at: iso(a.at), isNew: fresh(a.at) }));
    const toRate = (list?.toRate || []).map(i => ({ kind: i.kind, id: String(i.id), chainId: i.chainId ?? null, title: text(i.title || i.id, 160), at: iso(i.at), isNew: fresh(i.at) }));
    const cap = a => a.slice(0, LIST_LIMIT);
    // A night that ended with cards ready or went wrong (reasoning/overnight.js).
    const nightNotice = night ? await night.notice(sinceMs).catch(e => { log.warn?.('[since] night:', text(e.message, 160)); return null; }) : null;
    return {
      night: nightNotice,
      since: new Date(sinceMs).toISOString(), at: new Date(clock()).toISOString(), awayMs: Math.max(0, clock() - sinceMs),
      counts: { finished: sorted.finished.length, failed: sorted.failed.length + agentFailures.length, moved: sorted.moved.length,
        waiting: asks.length + toRate.length, newWaiting: asks.filter(a => a.isNew).length + toRate.filter(i => i.isNew).length,
        agentsDone: runs.length - agentFailures.length, agentsFailed: agentFailures.length },
      finished: cap(sorted.finished), failed: cap(sorted.failed), moved: cap(sorted.moved),
      agentFailures: cap(agentFailures.map(r => ({ chainId: r.chain_id, kind: r.kind, name: r.name || agentNameFromTask(r.task || r.display_name, { kind: r.kind }), task: text(r.task || r.display_name, 160), why: text(r.error, 200) || null, at: iso(r.at) }))),
      waiting: { asks: cap(asks), toRate: cap(toRate) },
    };
  }

  // What happened lately, as a trail. One read of what's already recorded; a source that can't be read leaves its rows
  // out and says so in `missing`, so a short trail can't pass for a quiet one.
  async function trail(sinceMs, limit = TRAIL_LIMIT) {
    const since = new Date(sinceMs), missing = [], rows = [];
    const named = await pool.query(`SELECT id, seed, status, updated_at, (ponder_state->'want') - 'receipts' AS want, ponder_state #>> '{continuity,board,headline}' AS headline
      FROM thought_chains WHERE ponder_state IS NOT NULL AND ponder_state -> 'deleted' IS NULL AND NOT seed ILIKE '[verification fixture%'`);
    const nameOf = new Map(named.rows.map(r => [r.id, text(r.headline || r.want?.description || r.seed, 120)]));
    const changed = classify(named.rows.filter(r => r.updated_at > since));
    for (const p of changed.finished) rows.push({ kind: 'finished', title: nameOf.get(p.chainId) || p.title, detail: 'Finished', chainId: p.chainId, at: p.at });
    for (const p of changed.failed) rows.push({ kind: 'failed', title: nameOf.get(p.chainId) || p.title, detail: p.status === 'budget' ? 'Ran out of budget' : 'Needs a new approach', chainId: p.chainId, at: p.at });
    try {
      const { rows: runs } = await pool.query(`SELECT *, COALESCE(ended_at, updated_at) AS at FROM agent_deployments
        WHERE kind <> 'talker' AND status IN ('done', 'failed', 'cancelled') AND COALESCE(ended_at, updated_at) > $1 ORDER BY COALESCE(ended_at, updated_at) DESC LIMIT 200`, [since]);
      for (const r of runs) {
        if (!nameOf.has(r.chain_id)) continue;   // its pursuit was deleted, or is a test fixture
        const name = r.name || agentNameFromTask(r.task || r.display_name, { kind: r.kind });
        rows.push({ kind: r.status === 'done' ? 'agent' : r.status === 'failed' ? 'agentFailed' : 'agentStopped', title: `${name} ${r.status === 'done' ? 'finished' : r.status === 'failed' ? "didn't finish" : 'was stopped'}`,
          detail: nameOf.get(r.chain_id), chainId: r.chain_id, agentId: r.id, at: iso(r.at) });
      }
    } catch (e) { if (e.code !== '42P01') missing.push('agents'); }   // no table: an engine without agents has no runs
    if (inbox) {
      try {
        const list = await inbox.list();
        for (const i of list.toRate || []) if (ms(i.at) > sinceMs) rows.push({ kind: 'delivered', title: text(i.title || i.id, 160), detail: i.chainId ? `Delivered · ${nameOf.get(i.chainId) || 'waits for your verdict'}` : 'Waits for your verdict', chainId: i.chainId ?? null, workId: i.kind === 'artifact' ? String(i.id) : null, at: iso(i.at) });
        for (const i of list.judged || []) if (ms(i.at) > sinceMs) rows.push({ kind: 'judged', title: text(i.title || i.id, 160), detail: `You judged it ${i.verdict ? i.verdict[0].toUpperCase() + i.verdict.slice(1) : 'just now'}`, chainId: i.chainId ?? null, workId: i.kind === 'artifact' ? String(i.id) : null, at: iso(i.at) });
      } catch (e) { missing.push('what was delivered and judged'); log.warn?.('[since] trail inbox:', text(e.message, 160)); }
    }
    if (night) {
      try {
        const { runs } = await night.history(60);
        for (const r of runs) {
          const at = ms(r.finishedAt);
          if (at === null || at <= sinceMs || r.status === 'running') continue;
          const said = night.noticeFor({ id: r.id, status: r.status, report: r.report, trigger: r.trigger });
          rows.push({ kind: said?.trouble ? 'nightTrouble' : 'night', title: said?.title || 'The night ran', detail: text(r.report?.headline, 160), at: iso(at) });
        }
      } catch (e) { missing.push('the nights'); log.warn?.('[since] trail night:', text(e.message, 160)); }
    }
    rows.sort((a, b) => (ms(b.at) ?? 0) - (ms(a.at) ?? 0));
    return { since: since.toISOString(), at: new Date(clock()).toISOString(), total: rows.length, items: rows.slice(0, limit), missing };
  }

  const router = Router();
  router.get('/oca/trail', async (req, res) => {
    const days = Math.max(1, Math.min(60, Number(req.query.days) || 14));
    try { res.json(await trail(clock() - days * 86_400_000, Math.max(1, Math.min(300, Number(req.query.limit) || TRAIL_LIMIT)))); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/oca/since', async (req, res) => {
    const at = parseSince(req.query.at, clock());
    if (at === null) return res.status(400).json({ error: 'Say since when, as ?at=<milliseconds or ISO date>.' });
    try { res.json(await digest(at)); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  return { digest, trail, router };
}
