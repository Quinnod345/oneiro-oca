// Operations: how the engine's work is going, week over week, measured from its journals.
//
// The Chinese Room Meter scores cognition. This scores the work the orchestrator does: its agent runs, the
// fixes it makes to itself, and what the person thought of what it produced. Every number is read from what
// the runtime recorded, never from what an agent said about itself:
//   - a run "went wrong" when the runtime ended it failed (its own failure, a spent turn budget, a timeout),
//     or when it repeated a task that had just failed on the same pursuit;
//   - a run was "productive" only when the engine confirmed something it produced (evidence it re-read and
//     found, or a fix that merged), because an agent reporting "done" is a claim, not proof;
//   - a stop by the model provider (credits, rate limits) is counted apart: it is not the engine's defect;
//   - a fix "holds" once it has been merged for a day without the failure it was made for recurring.
// These are measurements to look at, never a reward: nothing here feeds worth. The one place they act is the
// engine's standing pursuit about itself, whose done-when is literally this comparison ("each week at least one
// of my own fixes is merged, and fewer agent runs fail, repeat, or stall than the week before"): at the end of
// each week the observed result is recorded on it as a receipt, capped below 1 so that pursuit never closes.
import { Router } from 'express';
import { PROVIDER_LIMIT } from '../reasoning/task-dispositions.js';

export const DAY = 86400_000, WEEK = 7 * DAY;
export const MIN_RUNS = 10;   // below this many finished runs in a week, a rate is noise and is reported as such
const STALL = /turn budget|timed out|did not resolve|stalled/i;
const words = s => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9$@.\s]/g, ' ').split(/\s+/).filter(w => w.length > 3));
export function similarTask(a, b) {
  const A = words(a), B = words(b); if (A.size < 4 || B.size < 4) return false;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size) >= 0.6;
}
const ms = v => (v instanceof Date ? v.getTime() : Number.isFinite(Number(v)) ? Number(v) : Date.parse(v)) || 0;
const rate = (num, den) => (den > 0 ? num / den : null);

// One week of runs, classified. `runs` are agent_deployments rows (talkers excluded); `history` is every run on
// the same pursuits in the preceding week too, so a repeat of a recent failure can be recognised.
export function weekOfRuns(runs, history, merges, from, to) {
  const inWeek = runs.filter(r => r.ended_at && ms(r.ended_at) >= from && ms(r.ended_at) < to && ['done', 'failed'].includes(r.status));
  const cancelled = runs.filter(r => r.ended_at && ms(r.ended_at) >= from && ms(r.ended_at) < to && r.status === 'cancelled').length;
  let failed = 0, provider = 0, stalled = 0, repeated = 0, bad = 0, productive = 0;
  for (const r of inWeek) {
    const why = String(r.error || r.report?.summary || '');
    const isProvider = r.status === 'failed' && PROVIDER_LIMIT.test(why);
    if (isProvider) { provider++; continue; }
    const isFailed = r.status === 'failed';
    const isStall = isFailed && STALL.test(why);
    const start = ms(r.created_at);
    const isRepeat = history.some(h => h.id !== r.id && h.chain_id === r.chain_id && h.status === 'failed' && ms(h.ended_at) <= start && start - ms(h.ended_at) < WEEK
      && !PROVIDER_LIMIT.test(String(h.error || '')) && similarTask(h.task, r.task));
    if (isFailed) failed++;
    if (isStall) stalled++;
    if (isRepeat) repeated++;
    if (isFailed || isRepeat) bad++;
    const verified = Array.isArray(r.report?.verified) && r.report.verified.length > 0;
    const mergedFix = r.kind === 'builder' && r.status === 'done' && merges.some(m => m.chain_id === r.chain_id && ms(m.created_at) >= start);
    if (r.status === 'done' && (verified || mergedFix)) productive++;
  }
  const counted = inWeek.length - provider;   // runs the engine is answerable for
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), finished: inWeek.length, counted, cancelled, providerStopped: provider,
    failed, stalled, repeated, wentWrong: bad, productive, measurable: counted >= MIN_RUNS,
    rates: { wentWrong: rate(bad, counted), failed: rate(failed, counted), stalled: rate(stalled, counted), repeated: rate(repeated, counted), productive: rate(productive, counted) } };
}

// What the fixes the engine made to itself did: merged in the week, and — of all merged at least a day ago —
// how many held and how many recurred.
export function fixesOf(events, from, to, now) {
  const merged = events.filter(e => e.kind === 'merged');
  const inWeek = merged.filter(e => ms(e.created_at) >= from && ms(e.created_at) < to);
  const matured = merged.filter(e => now - ms(e.created_at) >= DAY);
  const recurredChains = new Set(events.filter(e => e.kind === 'recurred').map(e => e.chain_id));
  const recurred = matured.filter(e => recurredChains.has(e.chain_id)).length;
  return { merged: inWeek.length, matured: matured.length, holding: matured.length - recurred, recurred };
}

// The person's verdicts on what the engine produced: a rated deliverable, and a rating on a note it wrote.
export function verdictsOf(receipts, noteRatings, from, to) {
  const inWeek = x => ms(x.at) >= from && ms(x.at) < to;
  const artifacts = receipts.filter(inWeek);
  const notes = noteRatings.filter(inWeek);
  const useful = artifacts.filter(r => Number(r.usefulness) >= 0.67).length + notes.filter(n => Number(n.rating) >= 1).length;
  const rated = artifacts.length + notes.length;
  return { rated, useful, share: rate(useful, rated) };
}

// The standing self pursuit's weekly criterion, from two measured weeks.
export function selfCriterion(thisWeek, lastWeek, fixes) {
  const merged = fixes.merged >= 1;
  const comparable = thisWeek.measurable && lastWeek.measurable;
  const fewer = comparable && thisWeek.rates.wentWrong < lastWeek.rates.wentWrong;
  const pct = r => (r == null ? '—' : `${Math.round(r * 100)}%`);
  const why = [
    merged ? `${fixes.merged} of its own fix${fixes.merged === 1 ? '' : 'es'} merged` : 'no fix of its own merged',
    comparable ? `${pct(thisWeek.rates.wentWrong)} of runs went wrong against ${pct(lastWeek.rates.wentWrong)} the week before (${fewer ? 'fewer' : 'not fewer'})`
      : `run comparison not measurable (${thisWeek.counted} and ${lastWeek.counted} runs; needs ${MIN_RUNS} in each week)`,
  ].join('; ');
  return { merged, comparable, fewer, met: merged && fewer, progress: 0.45 * (merged ? 1 : 0) + 0.45 * (fewer ? 1 : 0), why };
}

// ISO week label (UTC) and bounds: weeks start Monday 00:00 UTC.
export function isoWeek(t) {
  const d = new Date(t); const day = (d.getUTCDay() + 6) % 7;
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
  const thursday = new Date(monday + 3 * DAY);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = 1 + Math.floor((thursday.getTime() - yearStart) / WEEK);
  return { label: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`, from: monday, to: monday + WEEK };
}

export function createOperations({ pool, queue = null, clock = Date.now, log = console, tickMs = 30 * 60_000 } = {}) {
  const q = (sql, args = []) => pool.query(sql, args).then(r => r.rows);
  async function load(since) {
    const [runs, events, receipts, notes] = await Promise.all([
      q(`SELECT id, chain_id, kind, task, status, error, report, created_at, ended_at FROM agent_deployments WHERE kind <> 'talker' AND created_at >= $1`, [new Date(since)]),
      q(`SELECT chain_id, kind, created_at FROM self_build_events WHERE kind IN ('merged', 'recurred', 'settled')`).catch(() => []),
      q(`SELECT r ->> 'receiptId' AS id, (r ->> 'usefulness')::float AS usefulness, (r ->> 'at')::bigint AS at FROM thought_chains, jsonb_array_elements(COALESCE(ponder_state #> '{want,receipts}', '[]'::jsonb)) r
         WHERE r ->> 'receiptId' LIKE 'rated-artifact-%'`).catch(() => []),
      q(`SELECT (payload ->> 'rating')::int AS rating, created_at AS at FROM worth_signals WHERE id LIKE 'rate:note:%'`).catch(() => []),
    ]);
    return { runs, events, receipts, notes };
  }
  // Two weeks ending at `end`: the week to judge, and the one before it.
  async function measure({ end = clock() } = {}) {
    const d = await load(end - 3 * WEEK);
    const merges = d.events.filter(e => e.kind === 'merged');
    const thisWeek = weekOfRuns(d.runs, d.runs, merges, end - WEEK, end);
    const lastWeek = weekOfRuns(d.runs, d.runs, merges, end - 2 * WEEK, end - WEEK);
    const fixes = fixesOf(d.events, end - WEEK, end, end);
    const fixesBefore = fixesOf(d.events, end - 2 * WEEK, end - WEEK, end - WEEK);
    return { at: new Date(end).toISOString(), thisWeek, lastWeek, fixes, fixesBefore,
      verdicts: verdictsOf(d.receipts, d.notes, end - WEEK, end), verdictsBefore: verdictsOf(d.receipts, d.notes, end - 2 * WEEK, end - WEEK),
      selfCriterion: selfCriterion(thisWeek, lastWeek, fixes) };
  }
  // At the end of each ISO week, the measured result goes on the standing self pursuit as a receipt — once.
  async function settleWeek() {
    if (!queue) return null;
    const { rows: [self] } = await pool.query(`SELECT id, ponder_state AS state FROM thought_chains WHERE ponder_state ->> 'standing' = 'self' AND ponder_state #>> '{want,status}' = 'active' ORDER BY id LIMIT 1`);
    if (!self) return null;
    const week = isoWeek(clock() - WEEK);   // the last complete week
    const receiptId = `operations-${week.label}`;
    if ((self.state?.want?.receipts || []).some(r => r.receiptId === receiptId)) return null;
    const m = await measure({ end: week.to });
    const c = m.selfCriterion;
    const w = m.thisWeek;
    const observation = `Week ${week.label}: ${c.why}. Runs: ${w.counted} the engine answers for (${w.wentWrong} went wrong: ${w.failed} failed, ${w.stalled} of them stalled, ${w.repeated} repeated a recent failure; ${w.productive} productive), plus ${w.providerStopped} stopped by the model provider.`;
    const receipt = { receiptId, progress: Math.min(0.9, c.progress), criterionMet: false,
      evidence: [{ id: receiptId, source: 'measured from the engine runtime journals (agent_deployments, self_build_events), not from any agent report', observation }] };
    await queue.outcome(self.id, receipt, { park: true });
    log.log?.(`[operations] ${receiptId} on self pursuit #${self.id}: progress ${receipt.progress.toFixed(2)} — ${c.why}`);
    return { chainId: self.id, receiptId, progress: receipt.progress, why: c.why };
  }
  let timer = null;
  function start() { stop(); const tick = () => settleWeek().catch(e => log.warn?.('[operations] settle:', e.message)); tick(); timer = setInterval(tick, tickMs); timer.unref?.(); }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  const router = Router();
  router.get('/oca/operations', async (_req, res) => { try { res.json(await measure()); } catch (e) { res.status(500).json({ error: e.message }); } });
  return { measure, settleWeek, start, stop, router };
}
