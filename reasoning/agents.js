// Deployed agents. The thinker holds wants; for a want it deploys as many agents as the work needs, each a
// gateway session the person can open in the Oneiro app: research agents that work pages in Aside, builders
// that change the engine's own code in a worktree, executors that act in the world (through the risk gate),
// and one standing talker per want — the thinker's voice, where the person and the engine talk directly.
//
// An agent that needs the person asks in its own session; the engine turns that into an ask (push to the
// phone, iMessage, Mac notification) that opens the session; the person answers there; the agent continues.
// Nothing an agent says is proof: a report's evidence is verified by the engine re-reading the page or file
// it quotes; the person's own words in a session are person-stated evidence. Fan-out is bounded by a control
// the person owns (agentSlots), never by the design.
//
// Contract with an agent: every reply ends with a fenced block tagged `oca` — {"status": "working" |
// "needs_person" | "done" | "failed", ...}. Messages from the engine start with [thinker]; anything else in
// the session is the person.
import { actionSummary } from './action-retries.js';
import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { Router } from 'express';
import { resolveProvider } from '../llm.js';
import { OWNER_KEY } from '../motivation/risk.js';
import { streamName } from './board.js';
import { createTaskDispositions, makeDisposition, DISPOSITIONS, PROVIDER_LIMIT } from './task-dispositions.js';

export const AGENT_KINDS = ['research', 'talker', 'builder', 'executor'];
export const REPORT_STATUSES = ['working', 'needs_person', 'done', 'failed', 'note'];
export const LIVE = ['queued', 'running', 'waiting_person'];
const text = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const THINKER = '[thinker]';

// Stream fallback entries are not terminal without an explicit terminal marker, even with stopReason 'stop'.
// Prefer explicit turn identity when present; timestamps retain legacy restart recovery.
function settledReply(t, since, runId = null) {
  const last = t?.messages?.at(-1);
  if (!t || t.pending || t.active || !last || last.role !== 'assistant'
    || !Number.isFinite(Number(last.at)) || Number(last.at) <= since
    || last.terminal === false || (last.streamFallback && last.terminal !== true) || (last.channel && last.channel !== 'final')) return null;
  if (runId) {
    const user = t.messages.findLast(m => m.role === 'user');
    // Assistant idempotency keys identify mirrored messages, not the requested turn. User
    // prompt keys can anchor a restarted execution to the original <requested run>:user.
    const requestedRun = user?.idempotencyKey?.endsWith(':user') ? user.idempotencyKey.slice(0, -5) : user?.runId;
    if (requestedRun && requestedRun !== runId) return null;
    if (last.runId && last.runId !== runId
      && !(requestedRun === runId && user?.runId === last.runId)) return null;
    if (!last.runId && !requestedRun && user && Number(user.at) <= since) return null;
  }
  return last;
}

// The last ```oca block in a reply, validated. Null when the agent did not report.
export function parseReport(reply) {
  const blocks = [...String(reply || '').matchAll(/```oca\s*\n([\s\S]*?)```/g)];
  if (!blocks.length) return null;
  let r; try { r = JSON.parse(blocks.at(-1)[1]); } catch { return { status: 'malformed', summary: 'the oca block was not valid JSON' }; }
  if (!r || typeof r !== 'object' || !REPORT_STATUSES.includes(r.status)) return { status: 'malformed', summary: 'the oca block has no valid status' };
  const out = { status: r.status, summary: text(r.summary, 2000) };
  if (r.status === 'needs_person') out.question = text(r.question, 800) || text(r.summary, 800);
  if (DISPOSITIONS.includes(r.disposition?.status)) out.disposition = { status: r.disposition.status };
  if (typeof r.nextStep === 'string') out.nextStep = text(r.nextStep, 600);
  // When the next step belongs to a future moment (a launch date, the end of a month), the agent says when.
  if (typeof r.resumeAt === 'string' && Number.isFinite(Date.parse(r.resumeAt))) out.resumeAt = new Date(Date.parse(r.resumeAt)).toISOString();
  if (Array.isArray(r.remaining)) out.remaining = r.remaining.slice(0, 5).map(x => text(x, 300)).filter(Boolean);
  if (Array.isArray(r.evidence)) out.evidence = r.evidence.slice(0, 12).filter(e => e && typeof e === 'object').map(e => ({ source: text(e.source, 500), quote: typeof e.quote === 'string' ? e.quote.replace(/\s+/g, ' ').trim().slice(0, 600) : '', observation: text(e.observation, 800) })).filter(e => e.source && e.observation);
  if (Array.isArray(r.files_changed)) out.files_changed = r.files_changed.slice(0, 40).map(x => text(x, 200));
  if (typeof r.tests_run === 'boolean') out.tests_run = r.tests_run;
  if (typeof r.ready === 'boolean') out.ready = r.ready;
  if (typeof r.branch === 'string') out.branch = text(r.branch, 120);
  // What the agent set up that lasts — a live listing, a post, a changed setting, a finished asset — for the board.
  if (Array.isArray(r.made)) out.made = r.made.slice(0, 8).filter(m => m && typeof m === 'object').map(m => ({ what: text(m.what, 200), where: text(m.where, 400) })).filter(m => m.what.length >= 4);
  return out;
}

const CONTRACT = `End every reply with a fenced block tagged oca, JSON, one of:
{"status":"working","summary":"what you did and what is next"}  — you made progress and want to keep going (the thinker sends you on)
{"status":"needs_person","question":"the one thing only the person can answer or do","summary":"why"}  — ask in plain words above the block too
{"status":"done","summary":"…","evidence":[{"source":"https://… or /absolute/path","quote":"exact text you saw there (≥ 24 chars)","observation":"what it shows"}],"nextStep":"…","remaining":["open question"],"resumeAt":"2026-10-01T09:00:00-04:00","made":[{"what":"what you set up that lasts","where":"its URL or file path"}]}
{"status":"failed","summary":"why"}
If this task scope is exhausted, superseded by the owner, or blocked on missing evidence, include "disposition":{"status":"exhausted|superseded|evidence-blocked"} in your done/failed block. Name the objective, period and blocker in the summary; do not report ordinary progress as retirement.
Evidence counts only when the engine can re-read the source and find your quote; say what you saw, never what you assume.
made lists only what exists now because of you and will last: a live listing, a published post, a changed account setting, a finished asset or file others will use. Leave it out when you only read or researched.
If the next step is something only the person can decide or provide, do not report done with it in nextStep — stop and ask it as needs_person, so it reaches their phone.
If the next step cannot happen before a certain time (a planned launch date, results that only exist after a period ends), set resumeAt to that time and nextStep to exactly what to do then: the engine sends no one until then, and at that time deploys an agent to do nextStep. Do not research what cannot exist yet.`;

// The first message of a deployment: the pursuit, the task, what is known and missing, the rules.
export function composeBrief({ kind, chainId, want, doneWhen, task, evidence = [], missing = [], remaining = [], cwd = null, engine = 'http://localhost:3333' }) {
  const ev = evidence.slice(-8).map(e => `- ${text(e.observation, 240)} (${text(e.source, 80)})`).join('\n');
  const head = `${THINKER} You are deployed by the Oneiro engine on pursuit #${chainId}: ${text(want, 600)}\n`
    + (doneWhen ? `Done when: ${text(doneWhen, 400)}\n` : '')
    + `Your role: ${kind}. ${({ research: 'Find and verify what the pursuit is missing. The only browser is Aside — the aside__* tools: look at a tab (aside__aside_snapshot_tab), then click, type, select, press and navigate to set date ranges, filters and pages yourself until the page shows what you need. The person\'s signed-in accounts are the open tabs (aside__aside_tabs). Never ask the person to arrange a page you can arrange yourself.',
        builder: `Change the engine's own code to carry out the task. Your worktree is ${cwd || '(named in the task)'} — every command runs there (cd into it first; your shell starts elsewhere) and you edit only files under it. Read SELF-BUILD.md there first, keep the constitution files untouched, run the tests (cd there && node --test tests/) until green. Your done block carries the fields, not prose: {"status":"done","summary":"…","files_changed":["thinker-bridge.js"],"tests_run":true,"ready":true}. Do not commit, push or merge — the engine does that after it observes the tests.`,
        executor: 'Act in the world exactly as the task says and no further; report what you did and what you observed happen, never what you intended.',
        talker: `You are the voice of the engine for this pursuit — you talk, you do not do the pursuit's work (research agents do that; you can see them and their results in the live state: curl -s ${engine}/ponder/${chainId} and curl -s ${engine}/oca/agents?chainId=${chainId}). When the person asks what is happening, answer from that state in two or three lines. What they state is fact for the engine; when they change direction, say back what changed. Do not open the browser, do not research. Until the person speaks, reply with one short line saying you are here for this pursuit.` })[kind]}\n`
    + (task ? `\nTask now: ${text(task, 3000)}\n` : '')
    + (missing.length ? `\nStill missing (from the last review):\n${missing.slice(0, 6).map(m => `- ${text(m, 300)}`).join('\n')}\n` : '')
    + (remaining.length ? `\nOpen questions from the last agent:\n${remaining.slice(0, 4).map(m => `- ${text(m, 200)}`).join('\n')}\n` : '')
    + (ev ? `\nWhat is already known (verified):\n${ev}\n` : '')
    + `\nMessages that start with ${THINKER} are the engine. Anything else here is the person — Quinn, the owner; they may join at any time.\n`
    + `You act, not just research: sign in (aside__aside_sign_in), post, submit, upload, change settings, spend within the cap — click it with aside__aside_click, or hand the whole task to aside__aside_do — always passing pursuit ${chainId} and a one-line purpose. The engine decides each committing step under Quinn's charter: it proceeds, or it is held for his one yes (end your turn with needs_person quoting the question you were given, then retry with approval=<ask id> after he says yes), or it is refused with the reason. Do the work yourself; ask Quinn only for what only he can decide or give. Graded coursework and CAPTCHAs are never yours to do.\n\n${CONTRACT}`;
  return head;
}

export function createAgents({ pool, gateway, queue, risk = null, asks = null, aside = null, llm = null, controls = null, clock = Date.now, log = console,
  agentId = 'main', model = null, thinkingLevel = 'high', pollMs = 15_000, planMs = 60_000, maxTurns = 12, slotsDefault = 4,
  roots = [], engine = 'http://localhost:3333', continuityIntervalMs = 20 * 60_000, ensureSelf = false, selfGapMs = 15 * 60_000,
  staleTurnMs = 90 * 60_000 } = {}) {

  const dispositions = createTaskDispositions({ pool, llm, log });

  async function init() {
    await pool.query(await readFile(new URL('../migrations/062_agent_deployments.sql', import.meta.url), 'utf8'));
    await pool.query(await readFile(new URL('../migrations/064_pursuit_board.sql', import.meta.url), 'utf8'));
    if (ensureSelf) await selfPursuit().catch(e => log.warn?.('[agents] self pursuit:', e.message));
  }
  // The engine's one standing pursuit about itself. Quinn asked for it: the only time it sits is when it is
  // thinking over itself. Idle capacity goes here; its moves are fixes the engine files against its own code.
  const SELF_SEED = 'Keep getting better at pursuing Quinn\'s wants: find where I fail, waste runs, repeat myself, stall, or ask Quinn for something I could have done — and fix it in my own code.';
  async function selfPursuit() {
    const { rows } = await pool.query(`SELECT id FROM thought_chains WHERE ponder_state ->> 'standing' = 'self' AND ponder_state #>> '{want,status}' = 'active' ORDER BY id LIMIT 1`);
    if (rows[0]) return rows[0].id;
    if (!queue?.enqueue) return null;
    const c = await queue.enqueue({ seed: SELF_SEED, doneWhen: 'Never finished: each week at least one of my own fixes is merged, and fewer agent runs fail, repeat, or stall than the week before.',
      topic: 'OCA engine', learning: false, priority: 0.6, continuous: true }, { origin: { kind: 'explicit', by: 'quinn' } });
    await pool.query(`UPDATE thought_chains SET status = 'awaiting_evidence', ponder_state = ponder_state || '{"standing":"self"}'::jsonb WHERE id = $1`, [c.chain_id]);
    log.log?.(`[agents] standing self pursuit is #${c.chain_id}`);
    return c.chain_id;
  }
  // What the engine can see about its own operation over the last day: the material for thinking over itself.
  async function selfSignals() {
    const q = (sql, args = []) => pool.query(sql, args).then(r => r.rows).catch(() => []);
    const byStatus = await q(`SELECT status, count(*)::int AS n FROM agent_deployments WHERE created_at > now() - interval '24 hours' GROUP BY status`);
    const failures = await q(`SELECT '#' || chain_id AS want, left(coalesce(error, report ->> 'summary', ''), 200) AS why FROM agent_deployments WHERE status = 'failed' AND created_at > now() - interval '48 hours' ORDER BY created_at DESC LIMIT 8`);
    const actions = await q(`SELECT id, class, host, url, observation, decision, coalesce(outcome, '') AS outcome, left(why, 120) AS why FROM agent_actions WHERE created_at > now() - interval '48 hours' AND (decision <> 'proceed' OR outcome = 'failure') ORDER BY created_at DESC LIMIT 8`);
    const asks = await q(`SELECT left(metadata ->> 'detail', 160) AS q, coalesce(left(reply, 80), '(open)') AS a FROM notifications WHERE category = 'ask' AND created_at > now() - interval '72 hours' ORDER BY id DESC LIMIT 8`);
    const builds = await q(`SELECT kind, count(*)::int AS n FROM self_build_events WHERE created_at > now() - interval '24 hours' GROUP BY kind`);
    const churn = await q(`SELECT '#' || chain_id AS want, count(*)::int AS runs, sum(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::int AS failed FROM agent_deployments WHERE created_at > now() - interval '24 hours' GROUP BY chain_id ORDER BY runs DESC LIMIT 6`);
    return `Agent runs in the last 24 h by status: ${byStatus.map(r => `${r.status} ${r.n}`).join(', ') || 'none'}
Runs per pursuit (24 h): ${churn.map(r => `${r.want} ${r.runs} (${r.failed} failed)`).join(', ') || 'none'}
Recent failures:\n${failures.map(f => `- ${f.want}: ${f.why}`).join('\n') || '- none'}
Actions held, refused or failed:\n${actions.map(a => `- ${actionSummary(a)}`).join('\n') || '- none'}
Questions sent to Quinn (72 h) and his answers:\n${asks.map(a => `- ${a.q} → ${a.a}`).join('\n') || '- none'}
Self-build events (24 h): ${builds.map(b => `${b.kind} ${b.n}`).join(', ') || 'none'}
To change the engine's code, an agent files a self-want: curl -s -X POST localhost:3333/oca/self-build/want -H 'content-type: application/json' -d '{"seed":"<the defect and the fix>","doneWhen":"<observable>","evidence":[{"id":"<id>","source":"<where seen>","observation":"<what was seen>"}]}' — the engine builds it on a branch, tests it, and merges it itself. The engine's repository is /Users/quinnodonnell/oneiro/oca-cognitive (read it; do not edit it directly).`;
  }
  const rowOf = r => r && ({ id: r.id, chainId: r.chain_id, kind: r.kind, task: r.task, sessionKey: r.session_key, agentId: r.agent_id, displayName: r.display_name,
    status: r.status, turns: r.turns, question: r.question, askId: r.ask_id, report: r.report, error: r.error, firedBy: r.fired_by, cwd: r.cwd, stream: r.stream || null,
    createdAt: r.created_at, updatedAt: r.updated_at, endedAt: r.ended_at });
  const chain = async chainId => (await pool.query('SELECT id, seed, status, ponder_state AS state FROM thought_chains WHERE id = $1 AND ponder_state IS NOT NULL', [chainId])).rows[0] || null;
  async function slots() { try { const c = await controls?.get?.(); const n = Number(c?.agentSlots); return Number.isInteger(n) && n >= 0 ? n : slotsDefault; } catch { return slotsDefault; } }
  // Slots count agents that are working. One parked on a question for the person costs nothing and holds no slot.
  async function liveCount(chainId = null) {
    const { rows: [{ n }] } = await pool.query(`SELECT count(*)::int AS n FROM agent_deployments WHERE status IN ('queued', 'running') ${chainId !== null ? 'AND chain_id = $1' : ''}`, chainId !== null ? [chainId] : []);
    return n;
  }

  // ── deploy ────────────────────────────────────────────────────────────────────────────────────────────
  async function deploy(chainId, { kind, task = '', firedBy = 'engine', by = 'quinn', cwd = null, brief: briefOverride = null, standing = false, stream = null } = {}) {
    if (!AGENT_KINDS.includes(kind)) throw new Error(`an agent is one of ${AGENT_KINDS.join(', ')}`);
    if (!['engine', 'person'].includes(firedBy)) throw new Error('an agent is fired by a person or the engine');
    const row = await chain(Number(chainId)); if (!row) throw new Error('Pursuit not found');
    if (['cancelled', 'resolved'].includes(row.status) || row.state.want?.status !== 'active') throw new Error('This pursuit is closed');
    // A cached "down" is re-checked before it stops a deployment: the planner may have spent minutes thinking since.
    if (!(await gateway.available()) && !(await gateway.available({ force: true }))) throw new Error('The gateway is not reachable; no agent can be deployed');
    if (firedBy === 'engine' && clock() < providerBackoffUntil) throw new Error(`the model provider is limiting agents; deployments resume at ${new Date(providerBackoffUntil).toISOString()}`);
    // A builder is the engine repairing itself (self-build runs one at a time); it never waits behind pursuit work.
    if (!standing && kind !== 'builder' && (await liveCount()) >= (await slots())) throw new Error(`all ${await slots()} agent slots are busy; raise agentSlots or wait`);
    if (kind !== 'talker') {
      const eligibility = await dispositions.eligible(row.id, task || row.state.want?.description || row.seed, row.state);
      if (!eligibility.eligible) return { id: null, decision: 'retired', why: eligibility.why, disposition: eligibility.disposition };
    }
    const id = randomUUID();
    const s = row.state, want = s.want?.description || row.seed;
    const brief = briefOverride || composeBrief({ kind, chainId: row.id, want, doneWhen: s.want?.doneWhen || s.doneWhen, task,
      evidence: s.evidence || [], missing: s.result?.missingEvidence || [], remaining: s.continuity?.remaining || [], cwd, engine });
    // Appraised like any other action. Research, talking and building in a worktree touch nothing of the
    // person's; an executor acts in the world and needs the master switch like everything else that does.
    const decision = risk ? await risk.decide({ id: `agent:${id}`, chainId: row.id, kind: 'deploy_agent', firedBy,
      description: `Deploy a ${kind} agent for pursuit ${row.id}: ${text(task || want, 300)}`, serves: s.want?.stakes || [], touches: [],
      reversibility: kind === 'executor' ? 'undo' : 'sandboxed' }) : { decision: 'proceed' };
    if (decision.decision !== 'proceed') {
      log.log?.(`[agents] ${kind} for #${row.id} not deployed: ${decision.decision}`);
      return { id: null, decision: decision.decision, why: decision.why || decision.reason || decision.decision };
    }
    // The label is what the app shows in its list: the want, the role, and enough of the task to tell agents apart.
    const displayName = `#${row.id} ${kind} · ${text(task || want, 56)}${task ? '' : ''}`.replace(/\s+·\s*$/, '');
    const key = `agent:${agentId}:want-${row.id}-${kind}-${id.slice(0, 8)}`;
    await gateway.createSession({ agentId, key, label: `${displayName} (${id.slice(0, 6)})`, displayName, model, thinkingLevel });
    await pool.query(`INSERT INTO agent_deployments (id, chain_id, kind, task, brief, session_key, agent_id, display_name, status, fired_by, cwd, stream)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [id, row.id, kind, text(task, 3000), brief, key, agentId, displayName, standing ? 'standing' : 'queued', firedBy, cwd, streamName(stream)]);
    log.log?.(`[agents] deployed ${kind} ${id.slice(0, 8)} for want #${row.id} (${firedBy}) → ${key}`);
    if (!standing) await startTurn(id, brief).catch(e => log.warn?.('[agents] first turn:', e.message));
    else await gateway.turn({ sessionKey: key, message: brief, idempotencyKey: `${id}:0` }).catch(e => log.warn?.('[agents] talker brief:', e.message));
    if (standing) await pool.query(`UPDATE agent_deployments SET seen_at_ms = $2 WHERE id = $1`, [id, clock()]);
    return { ...rowOf((await pool.query('SELECT * FROM agent_deployments WHERE id = $1', [id])).rows[0]), decision: 'proceed' };
  }

  // The row is claimed before the gateway is called, so a poll tick in between cannot send the same turn twice;
  // a call that fails hands the row back to the queue.
  async function startTurn(id, message) {
    // seen_at_ms is the turn's start; recovery also checks liveness and available turn identity.
    const { rows: [d] } = await pool.query(`UPDATE agent_deployments SET status = 'running', run_id = $2 || ':' || (turns + 1), turns = turns + 1, seen_at_ms = $3, updated_at = now()
      WHERE id = $1 AND status IN ('queued', 'running', 'waiting_person', 'standing') RETURNING *`, [id, id, clock() - 1]); if (!d) return;
    try {
      await gateway.turn({ sessionKey: d.session_key, message, idempotencyKey: d.run_id });
    } catch (e) {
      await pool.query(`UPDATE agent_deployments SET status = 'queued', turns = turns - 1, run_id = NULL WHERE id = $1`, [id]);
      throw e;
    }
  }

  // ── what an agent said, applied ───────────────────────────────────────────────────────────────────────
  async function verifyEvidence(items = [], depId) {
    const verified = [], unverified = []; let reads = 0;
    const realRoots = await Promise.all(roots.map(r => realpath(r).catch(() => null))).then(a => a.filter(Boolean));
    for (const [i, e] of items.entries()) {
      const quote = norm(e.quote); let ok = false, label = '';
      if (quote.length >= 24 && /^https?:\/\//i.test(e.source) && aside && reads < 6) {
        reads++; try { const page = await aside.readPage(e.source, { maxChars: 60000 }); ok = norm(page.text).includes(quote); label = `Aside browser: ${page.url}`; } catch {}
      } else if (quote.length >= 24 && e.source.startsWith('/') && realRoots.length) {
        try { const p = await realpath(e.source); if (realRoots.some(r => p === r || p.startsWith(r + '/'))) { ok = norm(await readFile(p, 'utf8')).includes(quote); label = `file: ${p}`; } } catch {}
      }
      (ok ? verified : unverified).push(ok ? { id: `agent-${depId.slice(0, 8)}-${i}`, source: label, observation: `${e.observation} — quoted: "${e.quote.slice(0, 300)}"` } : e);
    }
    return { verified, unverified };
  }
  // The person's words in a session are theirs; the engine records them as stated evidence.
  // A message the app sent appears once as sent and once as the run persisted it; one statement, not two.
  async function personStatements(d, messages, sinceMs = 0) {
    const seen = new Set();
    const said = messages.filter(m => m.role === 'user' && (m.at || 0) > sinceMs && !String(m.text || '').startsWith(THINKER) && text(m.text, 20).length >= 3)
      .filter(m => { const k = norm(m.text); if (seen.has(k)) return false; seen.add(k); return true; });
    return said.map(m => ({ id: `person-${d.session_key.slice(-8)}-${m.at || clock()}`, source: `stated by Quinn in the agent session "${d.display_name}"`, observation: text(String(m.text).replace(/^\[Quinn, via [^\]]+\]\s*/, ''), 1000) }));
  }
  // Dated steps form a schedule: a report adds its step, it never erases another's (a November review must
  // not swallow an October launch). The earliest future step is what the pursuit waits for.
  async function noteContinuity(chainId, { found, remaining = [], nextStep = null, error = null, resumeAt = undefined, stream = null }) {
    const at = resumeAt ? Date.parse(resumeAt) : null;
    let schedule = null;
    if (at && at > clock() + 60 * 60_000 && nextStep) {
      const { rows: [r] } = await pool.query(`SELECT ponder_state -> 'continuity' -> 'schedule' AS s FROM thought_chains WHERE id = $1`, [chainId]).catch(() => ({ rows: [] }));
      const prior = Array.isArray(r?.s) ? r.s : [];
      const iso = new Date(at).toISOString();
      schedule = [...prior.filter(x => Date.parse(x.at) > clock() && !(x.at === iso && x.task === nextStep)), { at: iso, task: text(nextStep, 1500), addedAt: new Date(clock()).toISOString(), ...(stream ? { stream } : {}) }]
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(0, 12);
    }
    const next = schedule?.[0];
    const resume = schedule ? { schedule, resumeAt: next.at, resumeTask: next.task } : {};
    await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{continuity}', (COALESCE(ponder_state -> 'continuity', '{}'::jsonb) || $2::jsonb)) WHERE id = $1`,
      [chainId, JSON.stringify({ lastSliceEndedAt: clock(), found, remaining, nextStep, error, ...resume, ...(found ? { dry: 0 } : {}) })]).catch(() => {});
    if (schedule) log.log?.(`[agents] #${chainId} scheduled ${new Date(at).toISOString()}: ${text(nextStep, 120)}; next due ${next.at}`);
    if (!found) await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{continuity,dry}', to_jsonb(COALESCE((ponder_state #>> '{continuity,dry}')::int, 0) + 1)) WHERE id = $1`, [chainId]).catch(() => {});
  }
  const observe = (d, result, observation) => risk ? risk.observe(`agent:${d.id}`, { result, evidence: [{ id: `agent-${d.id.slice(0, 8)}-${result}`, source: 'agent runtime: gateway session and verification', observation }] }).catch(e => log.warn?.('[agents] outcome not journaled:', e.message)) : Promise.resolve();

  async function finish(d, report, messages) {
    const { verified, unverified } = await verifyEvidence(report.evidence || [], d.id);
    const stated = await personStatements(d, messages, 0);
    const evidence = [...stated, ...verified];
    let applied = false, applyError = null;
    // Any open want takes new evidence, including one whose last review is ready for the person: an always-worked
    // pursuit keeps learning while its review waits.
    if (evidence.length && ['awaiting_evidence', 'stalled', 'budget', 'failed', 'pondering', 'running', 'needs_input', 'ready'].includes((await chain(d.chain_id))?.status)) {
      try { await queue.addEvidence(d.chain_id, evidence); applied = true; } catch (e) { applyError = e.message; }
    }
    const taskDisposition = makeDisposition(d, report, (await chain(d.chain_id))?.state);
    const final = { ...report, verified, unverified, stated: stated.length, evidenceApplied: applied, applyError, ...(taskDisposition ? { taskDisposition } : {}) };
    await pool.query(`UPDATE agent_deployments SET status = 'done', report = $2::jsonb, ended_at = now(), updated_at = now(), question = NULL WHERE id = $1`, [d.id, JSON.stringify(final)]);
    await noteContinuity(d.chain_id, { found: !taskDisposition && (applied || report.status === 'done'), remaining: report.remaining || [], nextStep: report.nextStep || null, resumeAt: report.resumeAt || null, stream: d.stream || null });
    await observe(d, applied ? 'success' : 'failure', `Agent ${d.id.slice(0, 8)} (${d.kind}) finished after ${d.turns} turns: ${verified.length} verified sources of ${(report.evidence || []).length} claimed, ${stated.length} statements by the person; evidence applied: ${applied}${applyError ? '; ' + applyError : ''}.`);
    log.log?.(`[agents] ${d.kind} ${d.id.slice(0, 8)} for #${d.chain_id} done: ${verified.length} verified, ${stated.length} stated, applied=${applied}`);
    return final;
  }
  // The model provider, not the pursuit: usage limits and quotas pause deployments for a while and tell the
  // person once, instead of spending the cadence on attempts that cannot run.
  let providerBackoffUntil = 0, providerNoticeAt = 0;
  async function providerTrouble(d, why) {
    const until = clock() + 60 * 60_000;
    providerBackoffUntil = Math.max(providerBackoffUntil, until);
    log.warn?.(`[agents] provider limit: deployments paused until ${new Date(until).toISOString()}: ${text(why, 160)}`);
    if (asks && clock() - providerNoticeAt > 6 * 3600_000) {
      providerNoticeAt = clock();
      try { await asks.ask({ chainId: d.chain_id, kind: 'notice', detail: `its agents cannot run — the model provider says: "${text(why, 140)}". Deployments are paused for an hour and will retry on their own; switch the agent model or add credits to resume sooner.`, want: '' }); }
      catch (e) { log.warn?.('[agents] provider notice:', e.message); }
    }
  }
  async function fail(d, why, report = {}) {
    const provider = PROVIDER_LIMIT.test(String(why));
    const taskDisposition = provider ? null : makeDisposition(d, report, (await chain(d.chain_id))?.state, why);
    await pool.query(`UPDATE agent_deployments SET status = 'failed', error = $2, report = COALESCE(report, '{}'::jsonb) || $3::jsonb, ended_at = now(), updated_at = now() WHERE id = $1`,
      [d.id, text(why, 500), JSON.stringify({ ...report, ...(provider ? { failureClass: 'provider' } : {}), ...(taskDisposition ? { taskDisposition } : {}) })]);
    if (provider) { await providerTrouble(d, why); await observe(d, 'not_attempted', `Agent ${d.id.slice(0, 8)} (${d.kind}) could not run: ${text(why, 200)}`); return; }
    await noteContinuity(d.chain_id, { found: false, error: text(why, 200) });
    await observe(d, 'failure', `Agent ${d.id.slice(0, 8)} (${d.kind}) failed: ${text(why, 300)}`);
    log.warn?.(`[agents] ${d.kind} ${d.id.slice(0, 8)} for #${d.chain_id} failed: ${text(why, 200)}`);
  }
  // The agent needs the person: an ask that opens this session. If asks are off, the question still waits here.
  const words = s => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9$@.\s]/g, ' ').split(/\s+/).filter(w => w.length > 3));
  const similar = (a, b) => { const A = words(a), B = words(b); if (!A.size || !B.size) return false; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size) >= 0.5; };
  async function needPerson(d, report, messages) {
    const row = await chain(d.chain_id);
    let askId = null;
    // Another agent on this want may already be waiting on the same thing: join its ask, do not ring twice.
    if (asks) {
      const open = (await asks.open().catch(() => [])).filter(a => a.chainId === d.chain_id && a.kind === 'question');
      const same = open.find(a => similar(a.detail, report.question));
      if (same) { askId = same.id; log.log?.(`[agents] ${d.kind} ${d.id.slice(0, 8)} joins ask #${same.id} (same need)`); }
    }
    if (asks && askId === null) {
      try {
        const a = await asks.ask({ chainId: d.chain_id, kind: 'question', detail: report.question, want: row?.state?.want?.description || row?.seed || '', stakes: row?.state?.want?.stakes || [],
          sessionKey: d.session_key, agent: d.display_name });
        askId = a.id ?? null;
      } catch (e) { log.warn?.('[agents] ask:', e.message); }
    }
    await pool.query(`UPDATE agent_deployments SET status = 'waiting_person', question = $2, ask_id = $3, seen_at_ms = $4, updated_at = now() WHERE id = $1`, [d.id, report.question, askId, clock()]);
    log.log?.(`[agents] ${d.kind} ${d.id.slice(0, 8)} for #${d.chain_id} needs the person: ${text(report.question, 160)}`);
  }
  async function applyReply(d, replyText, messages) {
    const report = parseReport(replyText);
    if (!report || report.status === 'malformed' || report.status === 'note' || report.status === 'working') {
      if (d.turns >= maxTurns) return fail(d, `turn budget of ${maxTurns} spent without a result`);
      const nudge = !report || report.status === 'malformed' ? `${THINKER} Your reply had no valid oca block. Reply again with the block: working, needs_person, done or failed.` : `${THINKER} Continue. (${maxTurns - d.turns} turns left.)`;
      return startTurn(d.id, nudge);
    }
    if (report.status === 'needs_person') return needPerson(d, report, messages);
    if (report.status === 'failed') return fail(d, report.summary, report);
    return finish(d, report, messages);
  }

  // ── poll: move every live deployment along ────────────────────────────────────────────────────────────
  // A finished agent's evidence that met the want mid-review is applied as soon as the review is over.
  async function reapply() {
    const { rows } = await pool.query(`SELECT * FROM agent_deployments WHERE status = 'done' AND (report ->> 'evidenceApplied') = 'false' AND report ->> 'applyError' IS NOT NULL
      AND ended_at > now() - interval '2 hours' ORDER BY ended_at ASC LIMIT 10`);
    for (const d of rows) {
      const r = d.report || {};
      if (!(r.verified || []).length && !r.stated) { await pool.query(`UPDATE agent_deployments SET report = report || '{"applyError": null}'::jsonb WHERE id = $1`, [d.id]); continue; }
      const row = await chain(d.chain_id); if (!row || row.status === 'running' || row.status === 'pondering') continue;
      try {
        const messages = await gateway.history(d.session_key).catch(() => []);
        const all = [...(await personStatements(d, messages, 0)), ...(r.verified || [])];
        if (all.length) await queue.addEvidence(d.chain_id, all);
        await pool.query(`UPDATE agent_deployments SET report = report || '{"evidenceApplied": true, "applyError": null}'::jsonb WHERE id = $1`, [d.id]);
        await noteContinuity(d.chain_id, { found: true, remaining: r.remaining || [], nextStep: r.nextStep || null });
        log.log?.(`[agents] ${d.kind} ${d.id.slice(0, 8)} for #${d.chain_id}: evidence applied after the review (${all.length} items)`);
      } catch (e) { if (!/running|wait/i.test(e.message)) await pool.query(`UPDATE agent_deployments SET report = report || $2::jsonb WHERE id = $1`, [d.id, JSON.stringify({ applyError: text(e.message, 200), evidenceApplied: false })]); }
    }
  }
  let polling = false;
  async function poll() {
    if (polling) return; polling = true;
    try {
      if (!(await gateway.available())) return;
      await reapply().catch(e => log.warn?.('[agents] reapply:', e.message));
      const { rows } = await pool.query(`SELECT * FROM agent_deployments WHERE status IN ('queued','running','waiting_person','standing') ORDER BY updated_at ASC LIMIT 40`);
      // Sessions parked on the person (or standing) are read only when the gateway says they changed: one
      // sessions.list instead of a transcript per session per tick.
      let changed = null;
      if (rows.some(d => d.status === 'waiting_person' || d.status === 'standing') && gateway.sessions) {
        try {
          const list = await gateway.sessions({ agentId, limit: 300 });
          changed = new Map(list.map(s => [s.key, Number(s.updatedAt) || 0]));
        } catch (e) { log.warn?.('[agents] sessions.list:', text(e.message, 160)); }
      }
      for (const d of rows) {
        if ((d.status === 'waiting_person' || d.status === 'standing') && changed) {
          const at = changed.get(d.session_key);
          if (at !== undefined && at <= (Number(d.seen_at_ms) || 0)) continue;   // nothing new in that session
        }
        try {
          if (d.status === 'queued') { await startTurn(d.id, d.brief); continue; }
          if (d.status === 'running') {
            if (!d.run_id) { await startTurn(d.id, d.brief); continue; }
            // A wait the gateway does not answer is the same as a run still pending: it falls through to the
            // transcript, which is where a lost run is recovered from (or found never to have run).
            const w = await gateway.wait(d.run_id, { timeoutMs: 1000 }).catch(e => { log.warn?.(`[agents] wait ${d.id.slice(0, 8)}:`, text(e.message, 120)); return null; });
            if (!w || w.status === 'pending' || w.status === 'timeout') {
              // A gateway restart re-runs a turn under a new run id, so the old one never resolves. The transcript
              // still shows the reply: after a grace period, a settled session whose last words are the agent's,
              // newer than the turn's start, is that turn's reply.
              const since = Number(d.seen_at_ms) || 0;
              if (clock() - since < 90_000) continue;
              const t = await gateway.transcript(d.session_key).catch(() => null);
              const last = settledReply(t, since, d.run_id);
              if (!last) {
                // A turn that has shown nothing for longer than any turn runs — no reply, nothing pending, nothing
                // active — was lost by the gateway. It fails, with the reason, so its slot and its pursuit are free
                // again; waiting on it would hold both forever.
                if (clock() - since > staleTurnMs && t && !t.pending && !t.active) await fail(d, `the gateway never answered this run (${d.run_id}) and its session shows no reply after ${Math.round((clock() - since) / 60_000)} minutes`);
                continue;
              }
              log.log?.(`[agents] ${d.kind} ${d.id.slice(0, 8)}: run ${d.run_id} did not resolve; taking the reply from the transcript`);
              await applyReply(d, last.text, t.messages);
              continue;
            }
            const messages = await gateway.history(d.session_key).catch(() => []);
            if (w.status === 'error') { if (w.stopReason === 'superseded') continue; await fail(d, w.error?.message || w.error || 'the run ended in error'); continue; }
            await applyReply(d, w.terminalReply?.text || '', messages);
            continue;
          }
          // waiting on the person, or a standing talker: the person may have spoken in the session; the app ran the turn.
          const t = await gateway.transcript(d.session_key).catch(() => null);
          if (!t) continue;
          const { messages } = t;
          const since = Number(d.seen_at_ms) || 0;
          const fresh = messages.filter(m => (m.at || 0) > since);
          if (!fresh.length) continue;
          const personSaid = fresh.filter(m => m.role === 'user' && !String(m.text || '').startsWith(THINKER) && !String(m.text || '').startsWith('[Quinn, via'));
          const last = settledReply(t, since);
          if (!last) continue;   // no settled reply yet, including when the app is running the turn
          const latest = Math.max(since, ...messages.map(m => m.at || 0));
          if (d.status === 'standing') {
            // Whatever the person states to the talker is theirs to state; it goes on the want as evidence.
            if (personSaid.length && last.role === 'assistant') {
              const stated = await personStatements(d, messages, since);
              if (stated.length) { try { await queue.addEvidence(d.chain_id, stated); log.log?.(`[agents] talker for #${d.chain_id}: ${stated.length} statement(s) by the person recorded`); } catch (e) { log.warn?.('[agents] talker evidence:', e.message); } }
              await pool.query('UPDATE agent_deployments SET seen_at_ms = $2, updated_at = now() WHERE id = $1', [d.id, latest]);
            }
            continue;
          }
          if (!personSaid.length || last.role !== 'assistant') continue;   // the person has not answered yet, or the agent is still replying
          if (d.ask_id && asks) await asks.answer(d.ask_id, text(personSaid.at(-1).text, 500)).catch(() => {});
          await pool.query('UPDATE agent_deployments SET seen_at_ms = $2, updated_at = now() WHERE id = $1', [d.id, latest]);
          await applyReply({ ...d, seen_at_ms: latest }, last.text, messages);
        } catch (e) { log.warn?.(`[agents] poll ${d.id.slice(0, 8)}:`, text(e.message, 200)); }
      }
    } finally { polling = false; }
  }

  // ── plan: the thinker decides what to deploy ─────────────────────────────────────────────────────────
  // The floor is deterministic: a continuous want with no live agent gets a research agent on the
  // continuity cadence. Above the floor, when slots are free and a want has several open threads, the
  // thinker splits them into parallel research tasks. Builders are deployed by self-build; talkers on demand.
  const dueIn = (state, now) => {
    const c = state.continuity || {};
    const resume = c.resumeAt ? Date.parse(c.resumeAt) : null;
    if (resume && resume <= now && Number(c.lastSliceStartedAt || 0) < resume) return 0;            // a dated step's moment has come
    const dry = Math.min(4, Number(c.dry) || 0);
    return Math.max(Number(c.lastSliceStartedAt) || 0, Number(c.lastSliceEndedAt) || 0) + continuityIntervalMs * 2 ** dry - now;
  };
  // One plan at a time. A strategist call can take minutes (a slow model, a fallback), longer than the plan
  // interval; two plans at once would both see a pursuit with no live agent and both deploy on it.
  let planning = false;
  async function plan(opts = {}) {
    if (planning) return { started: [], busy: true };
    planning = true;
    try { return await planOnce(opts); } finally { planning = false; }
  }
  async function planOnce({ perTick = 2 } = {}) {
    if ((!(await gateway.available()) && !(await gateway.available({ force: true }))) || clock() < providerBackoffUntil) return { started: [] };
    const paused = await controls?.get?.().then(c => c.queuePaused === true).catch(() => false); if (paused) return { started: [] };
    const free = () => slots().then(async s => s - (await liveCount()));
    const { rows } = await pool.query(`SELECT id, seed, status, ponder_state AS state FROM thought_chains
      WHERE ponder_state IS NOT NULL AND (ponder_state ->> 'continuous')::boolean = true AND ponder_state #>> '{want,status}' = 'active'
        AND status IN ('awaiting_evidence', 'stalled', 'budget', 'failed', 'needs_input', 'ready')
        AND NOT EXISTS (SELECT 1 FROM agent_deployments a WHERE a.chain_id = thought_chains.id AND a.status IN ('queued', 'running'))
        AND NOT EXISTS (SELECT 1 FROM pursuit_work w WHERE w.chain_id = thought_chains.id AND w.status IN ('queued', 'running'))
      ORDER BY updated_at ASC`);
    const now = clock(), started = [];
    // The only time the engine sits is when it thinks over itself: when no other pursuit is due and a slot is
    // free, the standing self pursuit is due (at most every selfGapMs), whatever its own cadence says.
    const isSelf = r => r.state?.standing === 'self';
    const due = rows.filter(r => !isSelf(r) && dueIn(r.state, now) <= 0);
    if (!due.length && (await free()) > 0) {
      const self = rows.find(r => isSelf(r) && now - Math.max(Number(r.state.continuity?.lastSliceStartedAt) || 0, Number(r.state.continuity?.lastSliceEndedAt) || 0) >= selfGapMs);
      if (self) due.push(self);
    }
    for (const row of due.slice(0, perTick)) {
      if ((await free()) <= 0) break;
      const missing = row.state.result?.missingEvidence || [], remaining = row.state.continuity?.remaining || [];
      const threads = [...new Set([...missing, ...remaining].map(x => text(x, 300)).filter(Boolean))];
      const c = row.state.continuity || {};
      const resuming = c.resumeAt && Date.parse(c.resumeAt) <= now && Number(c.lastSliceStartedAt || 0) < Date.parse(c.resumeAt);
      let tasks = [{ task: `Keep this pursuit moving; the person wants an agent always working on it. Do the most useful concrete thing you can toward the goal right now — make, publish, list, fix, improve, reach out — rather than waiting on evidence that does not exist yet.` }];
      if (resuming && c.resumeTask) {
        const step = (Array.isArray(c.schedule) ? c.schedule : []).find(x => x.at === c.resumeAt && x.task === c.resumeTask);
        tasks = [{ task: `It is now ${new Date(now).toISOString()}, the time the pursuit was parked for. Do the planned step: ${text(c.resumeTask, 1500)}`, stream: step?.stream || null }];
        const rest = (Array.isArray(c.schedule) ? c.schedule : []).filter(x => Date.parse(x.at) > now);
        await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{continuity}', (COALESCE(ponder_state -> 'continuity', '{}'::jsonb) || $2::jsonb)) WHERE id = $1`,
          [row.id, JSON.stringify({ schedule: rest, resumeAt: rest[0]?.at || null, resumeTask: rest[0]?.task || null, firedStep: { at: c.resumeAt, task: c.resumeTask, firedAt: new Date(now).toISOString() } })]).catch(() => {});
      }
      else if (llm) {
        const s = await strategize(row, Math.max(1, Math.min(3, await free())), now).catch(e => { log.warn?.('[agents] strategist:', text(e.message, 200)); return null; });
        if (s) {
          await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{continuity}', (COALESCE(ponder_state -> 'continuity', '{}'::jsonb) || $2::jsonb)) WHERE id = $1`,
            [row.id, JSON.stringify({ lastThought: s.thought, lastThoughtAt: new Date(now).toISOString(), lastMoves: s.moves.map(m => m.task.slice(0, 300)) })]).catch(() => {});
          log.log?.(`[agents] thinking on #${row.id}: ${text(s.thought, 200)} → ${s.moves.length} move(s)`);
          if (s.moves.length) tasks = s.moves.map(m => ({ task: `${m.task}${m.why ? `\nWhy now: ${m.why}` : ''}`, stream: m.stream }));
          else {   // nothing worth doing this cycle: say so and look again next cycle
            await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{continuity}', (COALESCE(ponder_state -> 'continuity', '{}'::jsonb) || $2::jsonb)) WHERE id = $1`,
              [row.id, JSON.stringify({ lastSliceStartedAt: now, lastSliceEndedAt: now })]).catch(() => {});
            continue;
          }
        } else if (threads.length >= 2 && (await free()) >= 2) tasks = await split(row, threads, Math.min(3, await free())).then(t => t.map(task => ({ task }))).catch(() => tasks);
      }
      let deployed = 0; const refused = [];
      for (const { task, stream = null } of tasks) {
        try {
          const d = await deploy(row.id, { kind: 'research', task, firedBy: 'engine', stream });
          if (d.id) { started.push(d.id); deployed++; continue; }
          // Refused before it started: a repeat of retired work, or held/refused by the risk gate. Said, not dropped.
          refused.push({ task: text(task, 300), decision: d.decision, why: text(d.why || d.decision, 200), at: new Date(now).toISOString() });
          log.log?.(`[agents] #${row.id} move not deployed (${d.decision}): ${text(d.why || '', 120)} — ${text(task, 100)}`);
        } catch (e) { log.warn?.(`[agents] plan #${row.id}:`, text(e.message, 200)); break; }
      }
      // The cadence advances on a deployment; a failed attempt is retried on the next tick.
      if (deployed) await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{continuity}', (COALESCE(ponder_state -> 'continuity', '{}'::jsonb) || $2::jsonb)) WHERE id = $1`,
        [row.id, JSON.stringify({ lastSliceStartedAt: now, runs: Number(row.state.continuity?.runs || 0) + deployed })]).catch(() => {});
      // What was refused goes to the strategist next cycle, so it proposes different work instead of variants of
      // the same. A cycle whose every move was refused still counts as a slice: thinking again a minute later would
      // spend a model call per retired task only to be refused again.
      if (tasks.length) await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{continuity}', (COALESCE(ponder_state -> 'continuity', '{}'::jsonb) || $2::jsonb)) WHERE id = $1`,
        [row.id, JSON.stringify({ lastRefused: refused, ...(!deployed && refused.length ? { lastSliceStartedAt: now, lastSliceEndedAt: now } : {}) })]).catch(() => {});
    }
    return { started };
  }
  // The strategist: every cycle, for a pursuit that is always worked, what are the most useful moves right now?
  // It sees the goal, what the person said, what is known, what agents recently did and how it went, what the
  // engine may do on its own, and what is scheduled — and answers with one line of thought and 0–max moves.
  async function strategize(row, max, now) {
    const s = row.state || {}, want = s.want || {};
    const { rows: recent } = await pool.query(`SELECT to_char(created_at, 'MM-DD HH24:MI') AS at, status, left(task, 240) AS task,
        left(coalesce(report ->> 'summary', error, question, ''), 260) AS outcome, stream FROM agent_deployments WHERE chain_id = $1 AND kind <> 'talker' ORDER BY created_at DESC LIMIT 14`, [row.id]);
    const { rows: acts } = await pool.query(`SELECT to_char(created_at, 'MM-DD HH24:MI') AS at, id, class, host, url, observation, why, decision, coalesce(outcome, '') AS outcome, left(description, 180) AS d
        FROM agent_actions WHERE chain_id = $1 ORDER BY created_at DESC LIMIT 8`, [row.id]).catch(() => ({ rows: [] }));
    const retired = await dispositions.records(row.id, s);
    const retirement = retired.map(d => `- [${d.status}] ${d.scope.description} (${d.period}); ${d.reason}`).join('\n');
    const refusedLast = (Array.isArray(s.continuity?.lastRefused) ? s.continuity.lastRefused : []).map(r => `- ${text(r.task, 200)} → ${text(r.why, 120)}`).join('\n');
    const ev = s.evidence || [];
    const said = ev.filter(e => /stated by Quinn|observed by quinn/i.test(e.source || '') || /^person-/.test(e.id || '')).slice(-8).map(e => `- ${text(e.observation, 300)}`).join('\n');
    const known = ev.filter(e => !/stated by Quinn/i.test(e.source || '')).slice(-12).map(e => `- ${text(e.observation, 200)}`).join('\n');
    const charter = await controls?.get?.().then(c => c.charter).catch(() => null);
    const grants = charter ? Object.entries(charter).filter(([k, v]) => v && v.granted).map(([k, v]) => k + (v.monthlyCap ? ` (≤ $${v.monthlyCap}/month)` : '')).join(', ') : 'unknown';
    const schedule = (Array.isArray(s.continuity?.schedule) ? s.continuity.schedule : []).map(x => `- ${x.at}: ${text(x.task, 200)}`).join('\n');
    const own = s.standing === 'self' ? `\n\nThe engine's own operation (this pursuit is about itself; its moves are reviews that end in concrete self-wants, one defect each, with the evidence):\n${await selfSignals()}` : '';
    const p = resolveProvider('cloud');
    const r = await llm.messages.create({ provider: p.provider, model: p.model, max_tokens: 1400, temperature: 0.4,
      system: `You are the strategist of a cognitive engine that works for Quinn. For one pursuit, decide what its agents should do next. A pursuit like this is never "waiting": there is almost always a useful move — make content, publish, get listed or featured, improve the product or its store page, reach the right communities, fix what is broken, learn what works from what has been tried. Agents can browse and act on Quinn's signed-in accounts (Aside), run and record InnerEcho in the iOS Simulator (never Quinn's own phone), drive Mac apps, write files, and run code; the engine gates committing actions under his charter. Rules: moves are concrete and doable now; each produces something or changes something; never repeat a recent task or retry what just failed the same way; never research data that cannot exist yet; respect what Quinn said; retired tasks stay retired unless materially new relevant evidence permits reopening, and superseded scopes additionally require new applicable owner authorization; propose distinct useful work instead; no graded coursework, no CAPTCHAs, nothing in anyone else's name. File every move under a workstream: the categories of work you run for this pursuit (1–3 words, e.g. "Content", "Distribution", "Measurement"); reuse an existing one, name a new one only when none fits. Return JSON only: {"thought":"one sentence — what you think about this pursuit right now","moves":[{"task":"exact instruction for one agent","why":"one line","stream":"Content"}]} with at most N moves; an empty list only if every useful move is genuinely done or in flight.`,
      messages: [{ role: 'user', content: `Now: ${new Date(now).toISOString()}\nN = ${max}\nPursuit #${row.id}: ${text(want.description || row.seed, 600)}\nDone when: ${text(want.doneWhen || s.doneWhen || '', 400)}\nThe engine may act on its own for: ${grants}\n\nWhat Quinn said:\n${said || '- (nothing recorded)'}\n\nWhat is known:\n${known || '- (nothing yet)'}\n\nScheduled:\n${schedule || '- (nothing)'}\n\nDurable task dispositions (not a recent-run window):\n${retirement || '- (none)'}${refusedLast ? `\n\nMoves refused last cycle, before they started (do not propose these or close variants; propose genuinely different work):\n${refusedLast}` : ''}\n\nRecent agent work (newest first):\n${recent.map(x => `- ${x.at} [${x.status}]${x.stream ? ` (${x.stream})` : ''} ${x.task} → ${x.outcome}`).join('\n') || '- (none)'}\n\nRecent actions:\n${acts.map(a => `- ${a.at} ${actionSummary(a)} — ${a.d}`).join('\n') || '- (none)'}\n\nWorkstreams so far: ${[...new Set([...(s.continuity?.board?.streams || []).map(x => x.name), ...recent.map(x => x.stream).filter(Boolean)])].join(', ') || '(none yet — name them)'}\n\nLast thought: ${text(s.continuity?.lastThought || '', 300) || '(none)'}${own}` }] });
    const raw = typeof r === 'string' ? r : r?.content?.[0]?.text ?? r?.text ?? '';
    const j = JSON.parse(String(raw).replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, '$1'));
    const moves = (Array.isArray(j.moves) ? j.moves : []).map(m => ({ task: text(m?.task, 1500), why: text(m?.why, 300), stream: streamName(m?.stream) })).filter(m => m.task.length >= 20).slice(0, max);
    return { thought: text(j.thought, 400) || '(no thought)', moves };
  }
  // The thinker splits open threads into parallel, non-overlapping tasks. JSON only; falls back to one task.
  async function split(row, threads, max) {
    const p = resolveProvider('cloud');
    const r = await llm.messages.create({ provider: p.provider, model: p.model, max_tokens: 800, temperature: 0.2,
      system: 'You are the orchestrator of a cognitive engine. Split open threads of one pursuit into parallel research tasks for separate agents, each self-contained and non-overlapping, at most N. JSON only: {"tasks":["…"]}.',
      messages: [{ role: 'user', content: `Pursuit: ${text(row.state.want?.description || row.seed, 500)}\nN = ${max}\nOpen threads:\n${threads.map(t => `- ${t}`).join('\n')}` }] });
    const raw = typeof r === 'string' ? r : r?.content?.[0]?.text ?? r?.text ?? '';
    const j = JSON.parse(String(raw).replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, '$1'));
    const tasks = (Array.isArray(j.tasks) ? j.tasks : []).map(t => text(t, 1500)).filter(t => t.length >= 20).slice(0, max);
    if (!tasks.length) throw new Error('no tasks');
    return tasks;
  }

  // ── the person's side ─────────────────────────────────────────────────────────────────────────────────
  async function talker(chainId) {
    const { rows } = await pool.query(`SELECT * FROM agent_deployments WHERE chain_id = $1 AND kind = 'talker' AND status = 'standing' ORDER BY created_at DESC LIMIT 1`, [chainId]);
    if (rows[0]) return rowOf(rows[0]);
    return deploy(Number(chainId), { kind: 'talker', firedBy: 'person', standing: true });
  }
  // A reply that came another way (Messages, the Judge form) is relayed into the agent's session as the person's.
  async function relay(id, reply, { via = 'Messages' } = {}) {
    const { rows: [d] } = await pool.query('SELECT * FROM agent_deployments WHERE id = $1', [id]); if (!d) throw new Error('agent not found');
    if (!['waiting_person', 'standing', 'done', 'running'].includes(d.status)) throw new Error(`agent is ${d.status}`);
    if (d.ask_id && asks) await asks.answer(d.ask_id, text(reply, 500)).catch(() => {});
    if (d.status === 'standing' || d.status === 'done') { await gateway.turn({ sessionKey: d.session_key, message: `[Quinn, via ${via}] ${text(reply, 4000)}` }); }
    else await startTurn(d.id, `[Quinn, via ${via}] ${text(reply, 4000)}`);
    return rowOf((await pool.query('SELECT * FROM agent_deployments WHERE id = $1', [id])).rows[0]);
  }
  async function cancel(id) {
    const { rows: [d] } = await pool.query('SELECT * FROM agent_deployments WHERE id = $1', [id]); if (!d) throw new Error('agent not found');
    if (!LIVE.includes(d.status) && d.status !== 'standing') return rowOf(d);
    await pool.query(`UPDATE agent_deployments SET status = 'cancelled', ended_at = now(), updated_at = now() WHERE id = $1`, [id]);
    await gateway.call('chat.abort', { sessionKey: d.session_key }).catch(() => {});
    await observe(d, 'not_attempted', `Agent ${d.id.slice(0, 8)} cancelled by a person.`);
    return rowOf((await pool.query('SELECT * FROM agent_deployments WHERE id = $1', [id])).rows[0]);
  }
  async function list({ chainId = null, live = false, limit = 50 } = {}) {
    const { rows } = await pool.query(`SELECT * FROM agent_deployments WHERE ($1::int IS NULL OR chain_id = $1) ${live ? `AND status = ANY($3)` : ''} ORDER BY created_at DESC LIMIT $2`, live ? [chainId, limit, [...LIVE, 'standing']] : [chainId, limit]);
    return rows.map(rowOf);
  }
  async function get(id) { const { rows: [d] } = await pool.query('SELECT * FROM agent_deployments WHERE id = $1', [id]); if (!d) throw new Error('agent not found'); return rowOf(d); }
  // Wait for one deployment to reach a terminal status (used by self-build for its builder).
  async function waitFor(id, { timeoutMs = 20 * 60_000, signal = null } = {}) {
    const until = clock() + timeoutMs;
    for (;;) {
      const d = await get(id);
      if (!LIVE.includes(d.status)) return d;
      if (signal?.aborted) { await cancel(id); throw new Error('cancelled'); }
      if (clock() > until) { await cancel(id); throw new Error('agent timed out'); }
      await poll().catch(() => {});
      await new Promise(r => setTimeout(r, Math.min(pollMs, 5000)));
    }
  }

  let timers = [];
  function start() { stop(); timers = [setInterval(() => poll().catch(e => log.warn?.('[agents] poll:', e.message)), pollMs), setInterval(() => plan().catch(e => log.warn?.('[agents] plan:', e.message)), planMs)]; timers.forEach(t => t.unref?.()); }
  function stop() { timers.forEach(clearInterval); timers = []; }

  const router = Router();
  const route = h => async (req, res) => { try { res.json(await h(req)); } catch (e) { res.status(400).json({ error: e.message }); } };
  router.get('/oca/agents', route(req => list({ chainId: req.query.chainId ? Number(req.query.chainId) : null, live: req.query.live === '1' })));
  router.get('/oca/agents/:id', route(req => get(req.params.id)));
  router.post('/oca/agents/:id/cancel', route(req => cancel(req.params.id)));
  router.post('/oca/agents/:id/say', route(req => relay(req.params.id, req.body?.text ?? req.body?.reply ?? '', { via: req.body?.via || 'Messages' })));
  router.post('/oca/inbox/want/:id/deploy', route(req => deploy(Number(req.params.id), { kind: req.body?.kind || 'research', task: req.body?.task || '', firedBy: 'person' })));
  router.get('/oca/inbox/want/:id/talker', route(req => talker(Number(req.params.id))));
  router.post('/oca/inbox/want/:id/talker', route(req => talker(Number(req.params.id))));

  return { init, deploy, poll, plan, talker, relay, cancel, list, get, waitFor, liveCount, slots, pausedUntil: () => (providerBackoffUntil > clock() ? providerBackoffUntil : null), available: () => gateway.available(), start, stop, router, composeBrief, parseReport };
}
