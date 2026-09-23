// The pursuit board: how the orchestrator shows a pursuit to the person. The strategist files every agent it
// deploys under a workstream it named ("Content", "Distribution", "Measurement"); the board keeper reads a
// pursuit's whole history now and then and writes down, in the engine's own words:
//   - its workstreams: what each is for and where it stands,
//   - the milestones from where it started to done-when (done, in progress, next),
//   - what it set up that lasts (a live listing, a published post, a changed setting, a finished kit),
//   - one honest sentence on how far along it is.
// None of that is proof. The measured progress is still the want's own (receipts only); the board is the
// orchestrator's account of its work, shown next to the measurement, never in place of it.
//
// GET /oca/orchestra       the orchestrator and every pursuit, for the map
// GET /oca/orchestra/:id   one pursuit in full: streams, agents, what it set up, milestones, schedule, history
// POST /oca/orchestra/:id/review   ask the board keeper to look again now
import { readFile } from 'node:fs/promises';
import { Router } from 'express';

const text = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const iso = v => { if (v === null || v === undefined || v === '') return null; const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const ms = v => { const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? t : 0; };
export const STREAM_STATES = ['active', 'waiting', 'blocked', 'done'];
export const MILESTONE_STATES = ['done', 'now', 'next'];
const LIVE = ['queued', 'running'];

// A stream name as the board keeps it: short, title-cased, no punctuation games.
export function streamName(v) {
  const s = text(v, 32).replace(/[^\p{L}\p{N} &/+'-]/gu, '').trim();
  if (s.length < 2) return null;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const words = s => new Set(key(s).split(' ').filter(w => w.length > 3));
function similar(a, b) {
  const A = words(a), B = words(b); if (!A.size || !B.size) return key(a) === key(b);
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size) >= 0.6;
}
const sameThing = (a, b) => (a.where && b.where && key(a.where) === key(b.where)) || similar(a.what, b.what);

// What the board keeper answered, validated and bounded. Unknown streams in labels are dropped.
export function parseBoard(raw, { runIds = [], now = Date.now() } = {}) {
  const j = typeof raw === 'string' ? JSON.parse(String(raw).replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, '$1')) : raw;
  if (!j || typeof j !== 'object') throw new Error('the board keeper returned no board');
  const streams = [];
  for (const s of Array.isArray(j.streams) ? j.streams : []) {
    const name = streamName(s?.name); if (!name || streams.some(x => key(x.name) === key(name))) continue;
    streams.push({ name, aim: text(s.aim, 200), state: STREAM_STATES.includes(s.state) ? s.state : 'active', standing: text(s.standing, 240) });
    if (streams.length >= 7) break;
  }
  const names = new Map(streams.map(s => [key(s.name), s.name]));
  const labels = {};
  for (const [id, name] of Object.entries(j.labels && typeof j.labels === 'object' ? j.labels : {})) {
    const n = names.get(key(name)); const full = runIds.find(r => r.startsWith(String(id).slice(0, 8)));
    if (n && full) labels[full] = n;
  }
  const made = [];
  for (const m of Array.isArray(j.made) ? j.made : []) {
    const item = { what: text(m?.what, 200), where: text(m?.where, 400), stream: names.get(key(m?.stream)) || null, at: iso(m?.at) };
    if (item.what.length < 4 || made.some(x => sameThing(x, item))) continue;
    made.push(item); if (made.length >= 30) break;
  }
  const milestones = [];
  for (const m of Array.isArray(j.milestones) ? j.milestones : []) {
    const label = text(m?.label, 140); if (label.length < 3) continue;
    milestones.push({ label, state: MILESTONE_STATES.includes(m?.state) ? m.state : 'next', at: iso(m?.at) });
    if (milestones.length >= 10) break;
  }
  return { headline: text(j.headline, 48) || null, progress: text(j.progress, 300) || null, streams, labels, made, milestones, updatedAt: new Date(now).toISOString() };
}

export function createBoard({ pool, llm = null, asks = null, agents = null, controls = null, gateway = null, clock = Date.now, log = console,
  reviewEveryMs = 20 * 60_000, tickMs = 5 * 60_000 } = {}) {
  const reviewing = new Set();

  async function init() { await pool.query(await readFile(new URL('../migrations/064_pursuit_board.sql', import.meta.url), 'utf8')); }

  const chainRow = async id => (await pool.query(`SELECT id, seed, status, updated_at, ponder_state AS state FROM thought_chains WHERE id = $1 AND ponder_state IS NOT NULL`, [id])).rows[0] || null;
  const runsOf = async (id, limit = 80) => (await pool.query(`SELECT * FROM agent_deployments WHERE chain_id = $1 ORDER BY created_at DESC LIMIT $2`, [id, limit])).rows;
  const actionsOf = async (id, limit = 40) => (await pool.query(`SELECT * FROM agent_actions WHERE chain_id = $1 ORDER BY created_at DESC LIMIT $2`, [id, limit]).catch(() => ({ rows: [] }))).rows;
  const mergesOf = async id => (await pool.query(`SELECT kind, payload, created_at FROM self_build_events WHERE chain_id = $1 AND kind = 'merged' ORDER BY created_at DESC LIMIT 10`, [id]).catch(() => ({ rows: [] }))).rows;

  // ── the board keeper ─────────────────────────────────────────────────────────────────────────────────
  const outcomeOf = r => text(r.report?.summary || r.error || r.question || '', 280);
  async function ask(system, user) {
    const r = await llm.messages.create({ max_tokens: 2400, temperature: 0.2, system, messages: [{ role: 'user', content: user }] });
    return typeof r === 'string' ? r : r?.content?.[0]?.text ?? r?.text ?? '';
  }
  async function review(chainId) {
    const id = Number(chainId);
    if (!llm) throw new Error('the board keeper needs a model');
    if (reviewing.has(id)) return { chainId: id, reviewing: true };
    reviewing.add(id);
    try {
      const row = await chainRow(id); if (!row) throw new Error('pursuit not found');
      const s = row.state || {}, want = s.want || {}, prior = s.continuity?.board || null;
      const runs = (await runsOf(id, 60)).filter(r => r.kind !== 'talker').reverse();
      const acts = (await actionsOf(id, 30)).reverse();
      const merges = await mergesOf(id);
      const schedule = (Array.isArray(s.continuity?.schedule) ? s.continuity.schedule : []).map(x => `- ${x.at}: ${text(x.task, 220)}`).join('\n');
      const said = (s.evidence || []).filter(e => /stated by Quinn|observed by quinn/i.test(e.source || '')).slice(-6).map(e => `- ${text(e.observation, 260)}`).join('\n');
      const system = `You keep the board for one pursuit of a cognitive engine that works for Quinn. The engine deploys agents on the pursuit; you read its whole history and write down, for Quinn to see at a glance:
- streams: the workstreams (categories of work) the orchestrator runs for this pursuit — 2 to 6, short names (1–3 words, e.g. "Content", "Distribution", "Measurement", "Pricing", "Product"). Keep the existing names unless one is clearly wrong. For each: aim (what it is for, one line), state (active | waiting | blocked | done), standing (one line: where it stands now, concrete).
- labels: every run id (the 8-character id) filed under exactly one stream.
- made: what the pursuit SET UP that lasts and exists now — a live listing, a published post, a changed account setting, a finished asset kit, a tracker or sheet in use, a merged fix. Only what the history shows was actually done and verified; never plans, never research notes. what (short, concrete), where (URL or file path), stream, at (ISO date).
- milestones: the path from where it started to done-when, in order — done ones, then the one in progress ("now"), then what is next (with the scheduled date when there is one). 4 to 8, each a short concrete label.
- progress: one honest sentence on how far along the pursuit is toward done-when. The measured progress is the only proof; do not claim more.
- headline: the pursuit in 2–5 words.
Return JSON only: {"headline":"…","progress":"…","streams":[{"name":"…","aim":"…","state":"active","standing":"…"}],"labels":{"a1b2c3d4":"Content"},"made":[{"what":"…","where":"…","stream":"…","at":"2026-09-23"}],"milestones":[{"label":"…","state":"done","at":null}]}`;
      const user = `Now: ${new Date(clock()).toISOString()}
Pursuit #${id}: ${text(want.description || row.seed, 700)}
Done when: ${text(want.doneWhen || s.doneWhen || '', 500)}
Measured progress: ${Math.round((Number(want.progress) || 0) * 100)}% (${(want.receipts || []).length} receipts)${s.standing === 'self' ? '\nThis is the engine\'s standing pursuit about itself: its work is reviews that end in self-wants and merged fixes.' : ''}

What Quinn said:
${said || '- (nothing recorded)'}

Existing board: ${prior ? JSON.stringify({ streams: prior.streams, milestones: prior.milestones, made: (prior.made || []).map(m => m.what) }).slice(0, 3000) : '(none yet)'}

Scheduled:
${schedule || '- (nothing)'}

Agent runs, oldest first (id | started | kind | status | stream | task → outcome):
${runs.map(r => `- ${r.id.slice(0, 8)} | ${iso(r.created_at)?.slice(0, 16)} | ${r.kind} | ${r.status} | ${r.stream || '-'} | ${text(r.task, 220)} → ${outcomeOf(r)}${(r.report?.made || []).length ? ` [made: ${r.report.made.map(m => `${m.what} @ ${m.where}`).join('; ')}]` : ''}`).join('\n') || '- (none)'}

Actions on the world (class on host: decision/outcome — what):
${acts.map(a => `- ${iso(a.created_at)?.slice(0, 16)} ${a.class} on ${a.host}: ${a.decision}/${a.outcome || '-'} — ${text(a.description, 160)} ${a.url ? `(${text(a.url, 120)})` : ''}`).join('\n') || '- (none)'}
${merges.length ? `\nMerged fixes:\n${merges.map(m => `- ${iso(m.created_at)?.slice(0, 16)} ${m.payload?.branch || ''} ${String(m.payload?.sha || '').slice(0, 8)}`).join('\n')}` : ''}`;
      const board = parseBoard(await ask(system, user), { runIds: runs.map(r => r.id), now: clock() });
      await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{continuity}', (COALESCE(ponder_state -> 'continuity', '{}'::jsonb) || jsonb_build_object('board', $2::jsonb))) WHERE id = $1`, [id, JSON.stringify(board)]);
      for (const [runId, name] of Object.entries(board.labels)) await pool.query(`UPDATE agent_deployments SET stream = $2 WHERE id = $1 AND stream IS NULL`, [runId, name]);
      log.log?.(`[board] #${id}: ${board.streams.length} streams, ${Object.keys(board.labels).length} runs filed, ${board.made.length} set up, ${board.milestones.length} milestones`);
      return { chainId: id, board };
    } finally { reviewing.delete(id); }
  }
  // A board is stale when something happened after it was written and it is older than the review cadence.
  async function stale(row) {
    const b = row.state?.continuity?.board;
    if (!b) return true;
    const since = ms(b.updatedAt);
    if (clock() - since < reviewEveryMs) return false;
    const { rows: [r] } = await pool.query(`SELECT max(greatest(updated_at, coalesce(ended_at, created_at))) AS at FROM agent_deployments WHERE chain_id = $1 AND kind <> 'talker'`, [row.id]);
    const { rows: [a] } = await pool.query(`SELECT max(coalesce(observed_at, created_at)) AS at FROM agent_actions WHERE chain_id = $1`, [row.id]).catch(() => ({ rows: [{}] }));
    return Math.max(ms(r?.at), ms(a?.at)) > since;
  }
  // At most two boards are written at once: a first look at the map must not start a review per pursuit.
  const soon = id => { if (llm && !reviewing.has(id) && reviewing.size < 2) review(id).catch(e => log.warn?.(`[board] #${id}:`, text(e.message, 200))); };
  // One stale board per tick: pursuits with work get looked at in turn, the busiest first.
  async function tick() {
    if (!llm) return null;
    const { rows } = await pool.query(`SELECT t.id, t.seed, t.status, t.updated_at, t.ponder_state AS state FROM thought_chains t
      WHERE t.ponder_state IS NOT NULL AND t.ponder_state #>> '{want,status}' = 'active' AND EXISTS (SELECT 1 FROM agent_deployments a WHERE a.chain_id = t.id AND a.kind <> 'talker')
      ORDER BY (SELECT max(a.updated_at) FROM agent_deployments a WHERE a.chain_id = t.id) DESC NULLS LAST LIMIT 20`);
    for (const row of rows) if (!reviewing.has(row.id) && await stale(row)) return review(row.id);
    return null;
  }

  // ── what the app reads ───────────────────────────────────────────────────────────────────────────────
  const agentOf = r => ({ id: r.id, kind: r.kind, status: r.status, stream: r.stream || null, task: text(r.task, 400), question: r.question || null, askId: r.ask_id || null,
    sessionKey: r.session_key, displayName: r.display_name, turns: r.turns, summary: text(r.report?.summary || '', 600), error: r.error ? text(r.error, 300) : null,
    made: Array.isArray(r.report?.made) ? r.report.made : [], firedBy: r.fired_by, startedAt: iso(r.created_at), endedAt: iso(r.ended_at), updatedAt: iso(r.updated_at) });
  const counts = rows => ({ total: rows.length, done: rows.filter(r => r.status === 'done').length, failed: rows.filter(r => r.status === 'failed').length,
    live: rows.filter(r => LIVE.includes(r.status)).length, waiting: rows.filter(r => r.status === 'waiting_person').length, cancelled: rows.filter(r => r.status === 'cancelled').length });
  // Streams as shown: the board's, then any the strategist named since the board was written, each with its runs counted.
  function streamsOf(board, runs) {
    const out = (board?.streams || []).map(s => ({ ...s }));
    for (const r of runs) if (r.stream && !out.some(s => key(s.name) === key(r.stream))) out.push({ name: r.stream, aim: '', state: 'active', standing: '' });
    return out.map(s => ({ ...s, counts: counts(runs.filter(r => key(r.stream) === key(s.name))) }));
  }
  // What it set up: the board keeper's list, then anything newer — an agent's own `made`, a committing action
  // that succeeded, a merged fix — that the keeper has not seen yet.
  function madeOf(board, runs, acts, merges) {
    const out = (board?.made || []).map(m => ({ ...m, source: 'board' }));
    const since = ms(board?.updatedAt);
    const add = item => { if (item.what && !out.some(x => sameThing(x, item))) out.push(item); };
    for (const r of runs) if (r.status === 'done' && ms(r.ended_at) > since) for (const m of r.report?.made || []) add({ what: text(m.what, 200), where: text(m.where, 400), stream: r.stream || null, at: iso(r.ended_at), agentId: r.id, source: 'agent' });
    // An action is the click behind something an agent reports it made: the same site within hours is the same thing.
    const hostOf = w => { try { return new URL(w).host.replace(/^www\./, ''); } catch { return ''; } };
    const covered = (host, at) => out.some(x => hostOf(x.where) === host.replace(/^www\./, '') && Math.abs(ms(x.at) - at) < 6 * 3600_000);
    for (const a of acts) if (a.outcome === 'success' && ms(a.observed_at || a.created_at) > since && !covered(a.host, ms(a.observed_at || a.created_at))) add({ what: text(String(a.description).replace(/\s*\(.*$/, ''), 200), where: a.url || a.host, stream: null, at: iso(a.observed_at || a.created_at), kind: a.class, source: 'action' });
    for (const m of merges) if (ms(m.created_at) > since) add({ what: `Merged ${m.payload?.branch || 'a fix'}`, where: String(m.payload?.sha || '').slice(0, 12), stream: null, at: iso(m.created_at), kind: 'merge', source: 'self-build' });
    return out.sort((a, b) => ms(b.at) - ms(a.at));
  }
  function summaryOf(row, runs, openAsks, selfId) {
    const s = row.state || {}, want = s.want || {}, c = s.continuity || {}, board = c.board || null;
    const schedule = (Array.isArray(c.schedule) ? c.schedule : []).filter(x => ms(x.at) > clock()).sort((a, b) => ms(a.at) - ms(b.at));
    const origin = s.origin?.kind || 'explicit';
    const work = runs.filter(r => r.kind !== 'talker');
    return {
      chainId: row.id, headline: board?.headline || null, description: text(want.description || row.seed, 600), doneWhen: text(want.doneWhen || s.doneWhen || '', 500),
      measured: Number(want.progress) || 0, receipts: (want.receipts || []).length, status: row.status, wantStatus: want.status || null, origin, topic: text(s.topic, 80) || null,
      standing: s.standing || null, parent: origin === 'self' && selfId && selfId !== row.id ? selfId : (s.origin?.parentChainId || null), continuous: s.continuous === true,
      lastThought: c.lastThought || null, lastThoughtAt: c.lastThoughtAt || null, progress: board?.progress || null,
      next: schedule[0] ? { at: schedule[0].at, task: text(schedule[0].task, 400) } : null,
      streams: streamsOf(board, work).map(({ name, state, standing, aim, counts }) => ({ name, state, standing, aim, counts })),
      milestones: { done: (board?.milestones || []).filter(m => m.state === 'done').length, total: (board?.milestones || []).length, now: (board?.milestones || []).find(m => m.state === 'now')?.label || null },
      agents: runs.filter(r => [...LIVE, 'waiting_person', 'standing'].includes(r.status)).map(agentOf),
      counts: { ...counts(work), made: (board?.made || []).length }, asks: openAsks.filter(a => a.chainId === row.id).length,
      boardAt: board?.updatedAt || null, updatedAt: iso(row.updated_at),
    };
  }

  async function overview() {
    const { rows } = await pool.query(`SELECT id, seed, status, updated_at, ponder_state AS state FROM thought_chains WHERE ponder_state IS NOT NULL
      AND (ponder_state #>> '{want,status}' = 'active' OR (ponder_state #>> '{want,status}' = 'sated' AND updated_at > now() - interval '7 days'))
      ORDER BY updated_at DESC LIMIT 40`);
    const ids = rows.map(r => r.id);
    const { rows: runs } = ids.length ? await pool.query(`SELECT * FROM agent_deployments WHERE chain_id = ANY($1) ORDER BY created_at DESC`, [ids]) : { rows: [] };
    const byChain = new Map(ids.map(id => [id, []])); for (const r of runs) byChain.get(r.chain_id)?.push(r);
    const openAsks = asks ? await asks.open().catch(() => []) : [];
    const selfId = rows.find(r => r.state?.standing === 'self')?.id || null;
    for (const row of rows) if (!row.state?.continuity?.board && (byChain.get(row.id) || []).some(r => r.kind !== 'talker') && row.state?.want?.status === 'active') soon(row.id);
    const q = (sql, args = []) => pool.query(sql, args).then(r => r.rows).catch(() => []);
    const [today] = await q(`SELECT count(*)::int AS deployed, sum((status = 'done')::int)::int AS done, sum((status = 'failed')::int)::int AS failed FROM agent_deployments WHERE created_at > now() - interval '24 hours' AND kind <> 'talker'`);
    const [merges] = await q(`SELECT count(*)::int AS n FROM self_build_events WHERE kind = 'merged' AND created_at > now() - interval '24 hours'`);
    const [lastMerge] = await q(`SELECT chain_id, payload, created_at FROM self_build_events WHERE kind = 'merged' ORDER BY created_at DESC LIMIT 1`);
    const c = await controls?.get?.().catch(() => null);
    const live = runs.filter(r => LIVE.includes(r.status));
    return {
      at: new Date(clock()).toISOString(),
      orchestrator: {
        slots: agents ? await agents.slots().catch(() => null) : null, working: live.length, builders: live.filter(r => r.kind === 'builder').length,
        waiting: runs.filter(r => r.status === 'waiting_person').length, queuePaused: c?.queuePaused === true,
        gatewayUp: gateway ? await gateway.available().catch(() => false) : null, pausedUntil: agents?.pausedUntil?.() ? iso(agents.pausedUntil()) : null,
        selfChainId: selfId, today: { deployed: today?.deployed || 0, done: today?.done || 0, failed: today?.failed || 0, merged: merges?.n || 0 },
        lastMerge: lastMerge ? { chainId: lastMerge.chain_id, branch: lastMerge.payload?.branch || null, at: iso(lastMerge.created_at) } : null,
        asks: openAsks.length,
      },
      pursuits: rows.map(row => summaryOf(row, byChain.get(row.id) || [], openAsks, selfId)),
    };
  }

  async function detail(chainId) {
    const id = Number(chainId);
    const row = await chainRow(id); if (!row) throw new Error('pursuit not found');
    const [runs, acts, merges] = await Promise.all([runsOf(id, 120), actionsOf(id, 60), mergesOf(id)]);
    const openAsks = asks ? await asks.open().catch(() => []) : [];
    const { rows: [self] } = await pool.query(`SELECT id FROM thought_chains WHERE ponder_state ->> 'standing' = 'self' AND ponder_state #>> '{want,status}' = 'active' ORDER BY id LIMIT 1`);
    const s = row.state || {}, c = s.continuity || {}, board = c.board || null;
    if (s.want?.status === 'active' && runs.some(r => r.kind !== 'talker') && await stale(row)) soon(id);
    const work = runs.filter(r => r.kind !== 'talker');
    // Everything it did, newest first: each run as it started and as it ended, each action, each fired step, each merge.
    const history = [];
    for (const r of work) {
      history.push({ at: iso(r.created_at), kind: 'deployed', title: text(r.task, 240), stream: r.stream || null, agentId: r.id, agentKind: r.kind, firedBy: r.fired_by });
      if (r.ended_at || r.status === 'waiting_person') history.push({ at: iso(r.ended_at || r.updated_at), kind: r.status, title: text(r.report?.summary || r.error || r.question || '', 400), stream: r.stream || null, agentId: r.id, agentKind: r.kind });
    }
    for (const a of acts) history.push({ at: iso(a.observed_at || a.created_at), kind: 'action', title: text(a.description, 300), detail: `${a.class} on ${a.host}: ${a.decision}${a.outcome ? ' → ' + a.outcome : ''}`, url: a.url || null, outcome: a.outcome || null, decision: a.decision });
    for (const m of merges) history.push({ at: iso(m.created_at), kind: 'merged', title: `Merged ${m.payload?.branch || 'a fix'}`, detail: String(m.payload?.sha || '').slice(0, 12) });
    if (c.firedStep?.firedAt) history.push({ at: iso(c.firedStep.firedAt), kind: 'step', title: text(c.firedStep.task, 300) });
    history.sort((a, b) => ms(b.at) - ms(a.at));
    return {
      ...summaryOf(row, runs, openAsks, self?.id || null),
      streams: streamsOf(board, work),
      milestoneList: board?.milestones || [],
      made: madeOf(board, work, acts, merges),
      agentList: runs.map(agentOf),
      schedule: (Array.isArray(c.schedule) ? c.schedule : []).filter(x => ms(x.at) > clock()).sort((a, b) => ms(a.at) - ms(b.at)).map(x => ({ at: x.at, task: text(x.task, 1500), stream: x.stream || null })),
      firedStep: c.firedStep || null,
      openAsks: openAsks.filter(a => a.chainId === id),
      evidence: (s.evidence || []).slice(-8).reverse().map(e => ({ source: text(e.source, 200), observation: text(e.observation, 400) })),
      evidenceCount: (s.evidence || []).length,
      history: history.slice(0, 200),
      reviewing: reviewing.has(id),
    };
  }

  let timer = null;
  function start() { stop(); timer = setInterval(() => tick().catch(e => log.warn?.('[board] tick:', text(e.message, 200))), tickMs); timer.unref?.(); }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  const router = Router();
  const route = h => async (req, res) => { try { res.json(await h(req)); } catch (e) { res.status(/not found/.test(e.message) ? 404 : 400).json({ error: e.message }); } };
  router.get('/oca/orchestra', route(() => overview()));
  router.get('/oca/orchestra/:id', route(req => detail(req.params.id)));
  router.post('/oca/orchestra/:id/review', route(async req => { const id = Number(req.params.id); if (!(await chainRow(id))) throw new Error('pursuit not found'); soon(id); return { chainId: id, reviewing: true }; }));
  return { init, review, tick, overview, detail, start, stop, router, stale };
}
