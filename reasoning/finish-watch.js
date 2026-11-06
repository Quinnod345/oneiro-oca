// A finish line lands somewhere. For a witness the engine can check (a file, a repository, a test, a calendar) it looks,
// and when what it sees says the line is met it asks "Looks done: <evidence>, confirm?". For a witness only a person can
// be, the same ask comes when they rate a deliverable Useful or Great on a run that says the line is met. The person
// always answers: only their confirmation finishes a pursuit, here or anywhere. "Not yet" leaves it open and lets its
// agents carry on.
//
// POST /oca/pursuits/:id/finish            the person: it's done
// POST /oca/pursuits/:id/finish/decline    the person: not yet
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { Router } from 'express';
import { sameThing } from './dedupe.js';
import { sameTitle } from './overnight-google.js';
import { finishCandidate, holdContext, MACHINE_WITNESSES } from './deliverables.js';
import { YES } from './actuator.js';

const text = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const plain = (message, status = 400) => Object.assign(new Error(message), { status });
const NOT_YET = /^\s*(n|no|nope|not yet|not done|don'?t|do not|stop|wait)\b/i;
const CHECK_EVERY_MS = { file: 3_600_000, repo: 3_600_000, test: 24 * 3_600_000, calendar: 12 * 3_600_000 };
// Only these test commands are ever run, and never through a shell.
const TEST_RUNNERS = [['npm', 'test'], ['npm', 'run', 'test'], ['pnpm', 'test'], ['yarn', 'test'], ['node', '--test'], ['swift', 'test'], ['pytest'], ['cargo', 'test'], ['go', 'test'], ['make', 'test']];

/** The first file path a witness names: ~/x, /x or a quoted path. Pure. */
export function pathIn(detail, home = homedir()) {
  const m = /(?:^|[\s"'`(])(~\/[^\s"'`),;]+|\/[^\s"'`),;]+)/.exec(String(detail ?? ''));
  if (!m) return null;
  const p = m[1].replace(/[.:]+$/, '');
  return p.startsWith('~/') ? `${home}/${p.slice(2)}` : p;
}
const quoted = detail => /["“]([^"”]{3,120})["”]/.exec(String(detail ?? ''))?.[1] || null;
/** A test command a witness names in backticks, as argv, if it's one of the known runners and carries no shell. Pure. */
export function testCommand(detail) {
  const raw = /`([^`]{2,200})`/.exec(String(detail ?? ''))?.[1];
  if (!raw || /[;&|<>$()\\\n]/.test(raw)) return null;
  const argv = raw.trim().split(/\s+/);
  return TEST_RUNNERS.some(r => r.every((w, i) => argv[i] === w)) ? argv : null;
}

function runner(command, args, { cwd, timeoutMs }) {
  return new Promise(resolve => execFile(command, args, { cwd, timeout: timeoutMs, maxBuffer: 4_000_000 }, (error, stdout) => resolve({ ok: !error, stdout: String(stdout || '') })));
}

/**
 * Look at a witness. { met: true, evidence } or { met: false, why }, in plain words. Reads only: a test run is the one
 * thing it executes, and only an allowed runner, in the folder the witness names.
 */
export async function observeWitness({ kind, detail, doneWhen = '', since = 0, now = Date.now() }, { run = runner, calendar = null, statFile = stat, testTimeoutMs = 10 * 60_000 } = {}) {
  const miss = why => ({ met: false, why });
  if (kind === 'file') {
    const path = pathIn(detail);
    if (!path) return miss('its witness names no file path');
    const s = await statFile(path).catch(() => null);
    if (!s) return miss(`${path} isn't there yet`);
    if (s.mtimeMs < since) return miss(`${path} hasn't changed since the pursuit began`);
    return { met: true, evidence: `${path} is there, changed ${new Date(s.mtimeMs).toISOString().slice(0, 10)}` };
  }
  if (kind === 'repo') {
    const path = pathIn(detail);
    if (!path) return miss('its witness names no repository folder');
    const grep = quoted(detail);
    const log = await run('git', ['-C', path, 'log', '-1', '--format=%h %s', `--since=${new Date(since).toISOString()}`, ...(grep ? ['--fixed-strings', `--grep=${grep}`] : [])], { cwd: undefined, timeoutMs: 15_000 });
    if (!log.ok) return miss(`${path} couldn't be read as a repository`);
    const commit = text(log.stdout, 160);
    return commit ? { met: true, evidence: `${path} has a new commit: ${commit}` } : miss(`${path} has no matching commit since the pursuit began`);
  }
  if (kind === 'test') {
    const argv = testCommand(detail), cwd = pathIn(String(detail ?? '').replace(/`[^`]*`/g, ''));
    if (!argv) return miss('its witness names no test command in backticks that Oneiro can run');
    if (!cwd) return miss('its witness names no folder to run the test in');
    const r = await run(argv[0], argv.slice(1), { cwd, timeoutMs: testTimeoutMs });
    return r.ok ? { met: true, evidence: `\`${argv.join(' ')}\` passes in ${cwd}` } : miss(`\`${argv.join(' ')}\` doesn't pass yet in ${cwd}`);
  }
  if (kind === 'calendar') {
    if (!calendar) return miss('the calendar can\'t be read here');
    const title = quoted(detail);
    const events = await calendar({ from: Math.max(since, now - 14 * 86_400_000), to: now + 14 * 86_400_000 });
    const hit = events.find(e => (title ? sameTitle(e.title, title) : false) || sameThing(e.title, title || detail) || sameThing(e.title, doneWhen));
    return hit ? { met: true, evidence: `"${text(hit.title, 120)}" is on your calendar${hit.start ? ` on ${String(hit.start).slice(0, 10)}` : ''}` } : miss('nothing matching it is on your calendar');
  }
  return miss('only a person can show this one');
}

export function createFinishWatch({ pool, queue, inbox, asks, agents = null, calendar = null, run = runner, clock = Date.now, log = console, tickMs = 10 * 60_000, perTick = 3, recentMs = 14 * 86_400_000 } = {}) {
  const chain = async id => (await pool.query(`SELECT id, seed, status, updated_at, ponder_state AS state FROM thought_chains WHERE id = $1 AND ponder_state IS NOT NULL`, [Number(id)])).rows[0] || null;
  const note = (id, fields) => pool.query(`UPDATE thought_chains SET ponder_state = ponder_state || jsonb_build_object('finishWatch', COALESCE(ponder_state -> 'finishWatch', '{}'::jsonb) || $2::jsonb) WHERE id = $1`, [id, JSON.stringify(fields)]);

  async function propose(row, { evidence, name = null }) {
    const s = row.state;
    const r = await asks.ask({ chainId: row.id, kind: 'finish', detail: `Looks done: ${text(evidence, 300)}. Confirm?`, want: s.want?.description || row.seed, stakes: s.want?.stakes || [] });
    if (!r?.id) { log.log?.(`[finish] #${row.id}: couldn't ask (${r?.why || 'no answer'})`); return null; }
    await note(row.id, { status: 'proposed', askId: r.id, evidence: text(evidence, 400), name, proposedAt: clock() });
    log.log?.(`[finish] #${row.id}: looks done (${text(evidence, 120)}); ask #${r.id}`);
    return { askId: r.id, evidence: text(evidence, 400) };
  }

  // After a Useful or Great. Whether it asks is finishCandidate's rule.
  async function onVerdict(chainId) {
    const row = await chain(chainId);
    if (!row) return null;
    const candidate = finishCandidate(row.state, await holdContext(pool, row));
    return candidate ? propose(row, candidate) : null;
  }

  // Look at the witnesses due a look, and catch verdicts given before this was running. Bounded per tick.
  let ticking = false;
  async function tick() {
    if (ticking) return { looked: 0 };
    // A background question doesn't text anyone overnight. One that follows a person's own verdict (onVerdict) still comes
    // at once, because they're there.
    const hour = new Date(clock()).getHours();
    if (hour >= 22 || hour < 8) return { looked: 0, quiet: true };
    ticking = true;
    let looked = 0;
    try {
      const { rows } = await pool.query(`SELECT id, seed, status, updated_at, ponder_state AS state FROM thought_chains WHERE ponder_state IS NOT NULL
        AND ponder_state #>> '{want,status}' = 'active' AND ponder_state -> 'deleted' IS NULL AND ponder_state -> 'archived' IS NULL ORDER BY updated_at DESC LIMIT 60`);
      for (const row of rows) {
        if (looked >= perTick) break;
        const s = row.state, seen = s.finishWatch || {};
        if (s.standing === 'self' || s.origin?.kind === 'self' || seen.status === 'proposed' || seen.status === 'confirmed') continue;
        const verdictAt = Math.max(0, ...(s.want?.receipts || []).filter(r => Number.isFinite(r.usefulness)).map(r => Number(r.at) || 0));
        if (verdictAt > clock() - recentMs) {
          const candidate = finishCandidate(s, await holdContext(pool, row));
          if (candidate) { looked++; await propose(row, candidate); continue; }
        }
        const kind = s.finishLine?.witness?.kind;
        if (!MACHINE_WITNESSES.includes(kind) || s.paused) continue;
        if (clock() - (Number(seen.lastCheckAt) || 0) < CHECK_EVERY_MS[kind]) continue;
        looked++;
        const since = Number(s.finishLine?.at) || Number(s.createdAt) || new Date(row.updated_at).getTime();
        const seenNow = await observeWitness({ kind, detail: s.finishLine.witness.detail, doneWhen: s.want?.doneWhen, since, now: clock() }, { run, calendar }).catch(e => ({ met: false, why: text(e.message, 200) }));
        await note(row.id, { lastCheckAt: clock(), lastCheck: seenNow.met ? seenNow.evidence : seenNow.why });
        if (seenNow.met && (seen.status !== 'declined' || seen.evidence !== seenNow.evidence)) await propose(row, { evidence: seenNow.evidence });
      }
    } finally { ticking = false; }
    return { looked };
  }

  // The person says it's done. The only path here to a finished pursuit, and it stops what's still running on it.
  async function confirm(chainId, { askId = null, via = 'the app', by = 'quinn', observation = null } = {}) {
    const row = await chain(chainId);
    if (!row) throw plain('Pursuit not found.', 404);
    const s = row.state;
    if (s.want?.status === 'sated') return { finished: true, chainId: row.id, already: true };
    if (s.want?.status !== 'active') throw plain('This pursuit is closed, so it can\'t be finished now.');
    const evidence = (text(observation, 700) || text(s.finishWatch?.evidence, 700)).replace(/[.\s]+$/, '');
    await inbox.progress({ chainId: row.id, progress: 1, criterionMet: true, by, observation: `${by} confirmed the finish line is met${via ? `, in ${via}` : ''}${evidence ? `: ${evidence}` : ''}.` });
    await note(row.id, { status: 'confirmed', confirmedAt: clock(), by: text(by, 60) });
    const open = askId ?? s.finishWatch?.askId;
    if (open) await asks.answer(Number(open), 'yes').catch(() => {});
    for (const d of await agents?.list({ chainId: row.id, live: true }).catch(() => []) ?? []) {
      if (d.kind !== 'talker') await agents.cancel(d.id).catch(e => log.warn?.(`[finish] #${row.id} stop ${String(d.id).slice(0, 8)}:`, e.message));
    }
    log.log?.(`[finish] #${row.id}: confirmed by ${by}`);
    return { finished: true, chainId: row.id };
  }

  // "Not yet": it stays open, its agents may go on, and the same evidence won't ask again.
  async function decline(chainId, { askId = null, why = '' } = {}) {
    const row = await chain(chainId);
    if (!row) throw plain('Pursuit not found.', 404);
    const seen = row.state.finishWatch || {};
    await note(row.id, { status: 'declined', declinedAt: clock(), declined: [...new Set([...(seen.declined || []), ...(seen.name ? [seen.name] : [])])], ...(text(why, 300) ? { why: text(why, 300) } : {}) });
    const open = askId ?? seen.askId;
    if (open) await asks.answer(Number(open), text(why, 300) || 'not yet').catch(() => {});
    return { finished: false, chainId: row.id };
  }

  // An answer that came by text or from the question card. Yes finishes; anything else is "not yet", in their words.
  async function answered(ask, reply, { via = 'Messages' } = {}) {
    const chainId = Number(ask.metadata?.chainId);
    if (YES.test(reply || '')) return confirm(chainId, { askId: ask.id, via });
    return decline(chainId, { askId: ask.id, why: NOT_YET.test(reply || '') ? '' : reply });
  }

  let timer = null;
  function start() { if (!timer) { timer = setInterval(() => tick().catch(e => log.warn?.('[finish] tick:', e.message)), tickMs); timer.unref?.(); } }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  const router = Router();
  const route = h => async (req, res) => { try { res.json(await h(req)); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };
  router.post('/oca/pursuits/:id/finish', route(req => confirm(req.params.id, { askId: req.body?.askId ?? null, via: req.body?.via || 'the app', by: req.body?.by || 'quinn', observation: req.body?.observation ?? null })));
  router.post('/oca/pursuits/:id/finish/decline', route(req => decline(req.params.id, { askId: req.body?.askId ?? null, why: req.body?.why || '' })));
  return { onVerdict, tick, confirm, decline, answered, start, stop, router };
}
