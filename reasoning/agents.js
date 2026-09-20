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
import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { Router } from 'express';
import { resolveProvider } from '../llm.js';
import { OWNER_KEY } from '../motivation/risk.js';

export const AGENT_KINDS = ['research', 'talker', 'builder', 'executor'];
export const REPORT_STATUSES = ['working', 'needs_person', 'done', 'failed', 'note'];
export const LIVE = ['queued', 'running', 'waiting_person'];
const text = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const THINKER = '[thinker]';

// The last ```oca block in a reply, validated. Null when the agent did not report.
export function parseReport(reply) {
  const blocks = [...String(reply || '').matchAll(/```oca\s*\n([\s\S]*?)```/g)];
  if (!blocks.length) return null;
  let r; try { r = JSON.parse(blocks.at(-1)[1]); } catch { return { status: 'malformed', summary: 'the oca block was not valid JSON' }; }
  if (!r || typeof r !== 'object' || !REPORT_STATUSES.includes(r.status)) return { status: 'malformed', summary: 'the oca block has no valid status' };
  const out = { status: r.status, summary: text(r.summary, 2000) };
  if (r.status === 'needs_person') out.question = text(r.question, 800) || text(r.summary, 800);
  if (typeof r.nextStep === 'string') out.nextStep = text(r.nextStep, 600);
  if (Array.isArray(r.remaining)) out.remaining = r.remaining.slice(0, 5).map(x => text(x, 300)).filter(Boolean);
  if (Array.isArray(r.evidence)) out.evidence = r.evidence.slice(0, 12).filter(e => e && typeof e === 'object').map(e => ({ source: text(e.source, 500), quote: typeof e.quote === 'string' ? e.quote.replace(/\s+/g, ' ').trim().slice(0, 600) : '', observation: text(e.observation, 800) })).filter(e => e.source && e.observation);
  if (Array.isArray(r.files_changed)) out.files_changed = r.files_changed.slice(0, 40).map(x => text(x, 200));
  if (typeof r.tests_run === 'boolean') out.tests_run = r.tests_run;
  if (typeof r.ready === 'boolean') out.ready = r.ready;
  if (typeof r.branch === 'string') out.branch = text(r.branch, 120);
  return out;
}

const CONTRACT = `End every reply with a fenced block tagged oca, JSON, one of:
{"status":"working","summary":"what you did and what is next"}  — you made progress and want to keep going (the thinker sends you on)
{"status":"needs_person","question":"the one thing only the person can answer or do","summary":"why"}  — ask in plain words above the block too
{"status":"done","summary":"…","evidence":[{"source":"https://… or /absolute/path","quote":"exact text you saw there (≥ 24 chars)","observation":"what it shows"}],"nextStep":"…","remaining":["open question"]}
{"status":"failed","summary":"why"}
Evidence counts only when the engine can re-read the source and find your quote; say what you saw, never what you assume.`;

// The first message of a deployment: the pursuit, the task, what is known and missing, the rules.
export function composeBrief({ kind, chainId, want, doneWhen, task, evidence = [], missing = [], remaining = [], cwd = null, engine = 'http://localhost:3333' }) {
  const ev = evidence.slice(-8).map(e => `- ${text(e.observation, 240)} (${text(e.source, 80)})`).join('\n');
  const head = `${THINKER} You are deployed by the Oneiro engine on pursuit #${chainId}: ${text(want, 600)}\n`
    + (doneWhen ? `Done when: ${text(doneWhen, 400)}\n` : '')
    + `Your role: ${kind}. ${({ research: 'Find and verify what the pursuit is missing. The only browser is Aside — the aside__* tools: look at a tab (aside__aside_snapshot_tab), then click, type, select, press and navigate to set date ranges, filters and pages yourself until the page shows what you need. The person\'s signed-in accounts are the open tabs (aside__aside_tabs). Never ask the person to arrange a page you can arrange yourself; ask only for what only they can give — a sign-in, a number, a decision.',
        builder: `Change the engine's own code to carry out the task. Your worktree is ${cwd || '(named in the task)'} — every command runs there (cd into it first; your shell starts elsewhere) and you edit only files under it. Read SELF-BUILD.md there first, keep the constitution files untouched, run the tests (cd there && node --test tests/) until green. Your done block carries the fields, not prose: {"status":"done","summary":"…","files_changed":["thinker-bridge.js"],"tests_run":true,"ready":true}. Do not commit, push or merge — the engine does that after it observes the tests.`,
        executor: 'Act in the world exactly as the task says and no further; report what you did and what you observed happen, never what you intended.',
        talker: `You are the voice of the engine for this pursuit — you talk, you do not do the pursuit's work (research agents do that; you can see them and their results in the live state: curl -s ${engine}/ponder/${chainId} and curl -s ${engine}/oca/agents?chainId=${chainId}). When the person asks what is happening, answer from that state in two or three lines. What they state is fact for the engine; when they change direction, say back what changed. Do not open the browser, do not research. Until the person speaks, reply with one short line saying you are here for this pursuit.` })[kind]}\n`
    + (task ? `\nTask now: ${text(task, 3000)}\n` : '')
    + (missing.length ? `\nStill missing (from the last review):\n${missing.slice(0, 6).map(m => `- ${text(m, 300)}`).join('\n')}\n` : '')
    + (remaining.length ? `\nOpen questions from the last agent:\n${remaining.slice(0, 4).map(m => `- ${text(m, 200)}`).join('\n')}\n` : '')
    + (ev ? `\nWhat is already known (verified):\n${ev}\n` : '')
    + `\nMessages that start with ${THINKER} are the engine. Anything else here is the person — Quinn, the owner; they may join at any time. Never message anyone but them, never post, pay, delete or sign out; the tools refuse those anyway.\n\n${CONTRACT}`;
  return head;
}

export function createAgents({ pool, gateway, queue, risk = null, asks = null, aside = null, llm = null, controls = null, clock = Date.now, log = console,
  agentId = 'main', model = null, thinkingLevel = 'high', pollMs = 15_000, planMs = 60_000, maxTurns = 12, slotsDefault = 4,
  roots = [], engine = 'http://localhost:3333', continuityIntervalMs = 20 * 60_000 } = {}) {

  async function init() {
    await pool.query(await readFile(new URL('../migrations/062_agent_deployments.sql', import.meta.url), 'utf8'));
  }
  const rowOf = r => r && ({ id: r.id, chainId: r.chain_id, kind: r.kind, task: r.task, sessionKey: r.session_key, agentId: r.agent_id, displayName: r.display_name,
    status: r.status, turns: r.turns, question: r.question, askId: r.ask_id, report: r.report, error: r.error, firedBy: r.fired_by, cwd: r.cwd,
    createdAt: r.created_at, updatedAt: r.updated_at, endedAt: r.ended_at });
  const chain = async chainId => (await pool.query('SELECT id, seed, status, ponder_state AS state FROM thought_chains WHERE id = $1 AND ponder_state IS NOT NULL', [chainId])).rows[0] || null;
  async function slots() { try { const c = await controls?.get?.(); const n = Number(c?.agentSlots); return Number.isInteger(n) && n >= 0 ? n : slotsDefault; } catch { return slotsDefault; } }
  // Slots count agents that are working. One parked on a question for the person costs nothing and holds no slot.
  async function liveCount(chainId = null) {
    const { rows: [{ n }] } = await pool.query(`SELECT count(*)::int AS n FROM agent_deployments WHERE status IN ('queued', 'running') ${chainId !== null ? 'AND chain_id = $1' : ''}`, chainId !== null ? [chainId] : []);
    return n;
  }

  // ── deploy ────────────────────────────────────────────────────────────────────────────────────────────
  async function deploy(chainId, { kind, task = '', firedBy = 'engine', by = 'quinn', cwd = null, brief: briefOverride = null, standing = false } = {}) {
    if (!AGENT_KINDS.includes(kind)) throw new Error(`an agent is one of ${AGENT_KINDS.join(', ')}`);
    if (!['engine', 'person'].includes(firedBy)) throw new Error('an agent is fired by a person or the engine');
    const row = await chain(Number(chainId)); if (!row) throw new Error('Pursuit not found');
    if (['cancelled', 'resolved'].includes(row.status) || row.state.want?.status !== 'active') throw new Error('This pursuit is closed');
    if (!(await gateway.available())) throw new Error('The gateway is not reachable; no agent can be deployed');
    if (!standing && (await liveCount()) >= (await slots())) throw new Error(`all ${await slots()} agent slots are busy; raise agentSlots or wait`);
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
    await pool.query(`INSERT INTO agent_deployments (id, chain_id, kind, task, brief, session_key, agent_id, display_name, status, fired_by, cwd)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, row.id, kind, text(task, 3000), brief, key, agentId, displayName, standing ? 'standing' : 'queued', firedBy, cwd]);
    log.log?.(`[agents] deployed ${kind} ${id.slice(0, 8)} for want #${row.id} (${firedBy}) → ${key}`);
    if (!standing) await startTurn(id, brief).catch(e => log.warn?.('[agents] first turn:', e.message));
    else await gateway.turn({ sessionKey: key, message: brief, idempotencyKey: `${id}:0` }).catch(e => log.warn?.('[agents] talker brief:', e.message));
    if (standing) await pool.query(`UPDATE agent_deployments SET seen_at_ms = $2 WHERE id = $1`, [id, clock()]);
    return { ...rowOf((await pool.query('SELECT * FROM agent_deployments WHERE id = $1', [id])).rows[0]), decision: 'proceed' };
  }

  // The row is claimed before the gateway is called, so a poll tick in between cannot send the same turn twice;
  // a call that fails hands the row back to the queue.
  async function startTurn(id, message) {
    const { rows: [d] } = await pool.query(`UPDATE agent_deployments SET status = 'running', run_id = $2 || ':' || (turns + 1), turns = turns + 1, updated_at = now()
      WHERE id = $1 AND status IN ('queued', 'running', 'waiting_person', 'standing') RETURNING *`, [id, id]); if (!d) return;
    try {
      await gateway.turn({ sessionKey: d.session_key, message, idempotencyKey: d.run_id });
      await pool.query('UPDATE agent_deployments SET seen_at_ms = $2 WHERE id = $1', [id, clock()]);
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
  async function noteContinuity(chainId, { found, remaining = [], nextStep = null, error = null }) {
    await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{continuity}', (COALESCE(ponder_state -> 'continuity', '{}'::jsonb) || $2::jsonb)) WHERE id = $1`,
      [chainId, JSON.stringify({ lastSliceEndedAt: clock(), found, remaining, nextStep, error, ...(found ? { dry: 0 } : {}) })]).catch(() => {});
    if (!found) await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{continuity,dry}', to_jsonb(COALESCE((ponder_state #>> '{continuity,dry}')::int, 0) + 1)) WHERE id = $1`, [chainId]).catch(() => {});
  }
  const observe = (d, result, observation) => risk ? risk.observe(`agent:${d.id}`, { result, evidence: [{ id: `agent-${d.id.slice(0, 8)}-${result}`, source: 'agent runtime: gateway session and verification', observation }] }).catch(e => log.warn?.('[agents] outcome not journaled:', e.message)) : Promise.resolve();

  async function finish(d, report, messages) {
    const { verified, unverified } = await verifyEvidence(report.evidence || [], d.id);
    const stated = await personStatements(d, messages, 0);
    const evidence = [...stated, ...verified];
    let applied = false, applyError = null;
    if (evidence.length && ['awaiting_evidence', 'stalled', 'budget', 'failed', 'pondering', 'running', 'needs_input'].includes((await chain(d.chain_id))?.status)) {
      try { await queue.addEvidence(d.chain_id, evidence); applied = true; } catch (e) { applyError = e.message; }
    }
    const final = { ...report, verified, unverified, stated: stated.length, evidenceApplied: applied, applyError };
    await pool.query(`UPDATE agent_deployments SET status = 'done', report = $2::jsonb, ended_at = now(), updated_at = now(), question = NULL WHERE id = $1`, [d.id, JSON.stringify(final)]);
    await noteContinuity(d.chain_id, { found: applied, remaining: report.remaining || [], nextStep: report.nextStep || null });
    await observe(d, applied ? 'success' : 'failure', `Agent ${d.id.slice(0, 8)} (${d.kind}) finished after ${d.turns} turns: ${verified.length} verified sources of ${(report.evidence || []).length} claimed, ${stated.length} statements by the person; evidence applied: ${applied}${applyError ? '; ' + applyError : ''}.`);
    log.log?.(`[agents] ${d.kind} ${d.id.slice(0, 8)} for #${d.chain_id} done: ${verified.length} verified, ${stated.length} stated, applied=${applied}`);
    return final;
  }
  async function fail(d, why) {
    await pool.query(`UPDATE agent_deployments SET status = 'failed', error = $2, ended_at = now(), updated_at = now() WHERE id = $1`, [d.id, text(why, 500)]);
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
    if (report.status === 'failed') return fail(d, report.summary);
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
      for (const d of rows) {
        try {
          if (d.status === 'queued') { await startTurn(d.id, d.brief); continue; }
          if (d.status === 'running') {
            if (!d.run_id) { await startTurn(d.id, d.brief); continue; }
            const w = await gateway.wait(d.run_id, { timeoutMs: 1000 });
            if (!w || w.status === 'pending' || w.status === 'timeout') continue;
            const messages = await gateway.history(d.session_key).catch(() => []);
            if (w.status === 'error') { if (w.stopReason === 'superseded') continue; await fail(d, w.error?.message || w.error || 'the run ended in error'); continue; }
            await applyReply(d, w.terminalReply?.text || '', messages);
            continue;
          }
          // waiting on the person, or a standing talker: the person may have spoken in the session; the app ran the turn.
          const t = await gateway.transcript(d.session_key).catch(() => null);
          if (!t) continue;
          const { messages, pending } = t;
          const since = Number(d.seen_at_ms) || 0;
          const fresh = messages.filter(m => (m.at || 0) > since);
          if (!fresh.length || pending) continue;   // nothing new, or a turn is still in flight
          const personSaid = fresh.filter(m => m.role === 'user' && !String(m.text || '').startsWith(THINKER) && !String(m.text || '').startsWith('[Quinn, via'));
          const last = messages.at(-1);
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
  const dueIn = (state, now) => { const c = state.continuity || {}, dry = Math.min(4, Number(c.dry) || 0); return Math.max(Number(c.lastSliceStartedAt) || 0, Number(c.lastSliceEndedAt) || 0) + continuityIntervalMs * 2 ** dry - now; };
  async function plan({ perTick = 2 } = {}) {
    if (!(await gateway.available())) return { started: [] };
    const paused = await controls?.get?.().then(c => c.queuePaused === true).catch(() => false); if (paused) return { started: [] };
    const free = () => slots().then(async s => s - (await liveCount()));
    const { rows } = await pool.query(`SELECT id, seed, status, ponder_state AS state FROM thought_chains
      WHERE ponder_state IS NOT NULL AND (ponder_state ->> 'continuous')::boolean = true AND ponder_state #>> '{want,status}' = 'active'
        AND status IN ('awaiting_evidence', 'stalled', 'budget', 'failed', 'needs_input')
        AND NOT EXISTS (SELECT 1 FROM agent_deployments a WHERE a.chain_id = thought_chains.id AND a.status = ANY($1))
        AND NOT EXISTS (SELECT 1 FROM pursuit_work w WHERE w.chain_id = thought_chains.id AND w.status IN ('queued', 'running'))
      ORDER BY updated_at ASC`, [LIVE]);
    const now = clock(), started = [];
    for (const row of rows.filter(r => dueIn(r.state, now) <= 0).slice(0, perTick)) {
      if ((await free()) <= 0) break;
      const missing = row.state.result?.missingEvidence || [], remaining = row.state.continuity?.remaining || [];
      const threads = [...new Set([...missing, ...remaining].map(x => text(x, 300)).filter(Boolean))];
      let tasks = [`Keep this pursuit moving; the person wants an agent always working on it. Find what is still missing; if it truly is not obtainable, do the most useful concrete work toward the done-when and state precisely what only the person can provide.`];
      if (threads.length >= 2 && (await free()) >= 2 && llm) tasks = await split(row, threads, Math.min(3, await free())).catch(e => { log.warn?.('[agents] plan:', e.message); return tasks; });
      let deployed = 0;
      for (const task of tasks) {
        try { const d = await deploy(row.id, { kind: 'research', task, firedBy: 'engine' }); if (d.id) { started.push(d.id); deployed++; } } catch (e) { log.warn?.(`[agents] plan #${row.id}:`, text(e.message, 200)); break; }
      }
      // The cadence advances only on a deployment; a failed attempt is retried on the next tick.
      if (deployed) await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{continuity}', (COALESCE(ponder_state -> 'continuity', '{}'::jsonb) || $2::jsonb)) WHERE id = $1`,
        [row.id, JSON.stringify({ lastSliceStartedAt: now, runs: Number(row.state.continuity?.runs || 0) + deployed })]).catch(() => {});
    }
    return { started };
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

  return { init, deploy, poll, plan, talker, relay, cancel, list, get, waitFor, liveCount, slots, available: () => gateway.available(), start, stop, router, composeBrief, parseReport };
}
