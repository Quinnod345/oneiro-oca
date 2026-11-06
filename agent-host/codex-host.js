// Where the engine's agents live: Codex threads on the engine's own `codex app-server`. Every deployed agent is a
// thread the person can open in Codex or T3 Code (they share ~/.codex), and every turn the engine starts is a run
// it can wait on, read back and interrupt. This replaced the OpenClaw gateway (2026-11): the interface is the one
// reasoning/agents.js already used, so the agent runtime did not change shape.
//
//   available()                       the server is up and signed in to ChatGPT (never a metered key)
//   createSession({ key, displayName, label, model, thinkingLevel, cwd })   a named thread for one agent
//   turn({ sessionKey, message, idempotencyKey })                           start a turn; idempotent by key
//   wait(runId, { timeoutMs })        { status: 'ok'|'error'|'pending', terminalReply: { text }, stopReason }
//   transcript(sessionKey)            { messages: [{ role, text, at, runId, terminal }], pending, active, activeRunId }
//   history(sessionKey)               transcript().messages
//   sessions()                        [{ key, updatedAt }] from Codex's own thread index
//   abort(sessionKey)                 interrupt the run in flight
//   threadOf(sessionKey)              the Codex thread id, for links
//
// Turns from other clients (Quinn replying in T3 Code or Codex) land in the same thread's rollout. The engine
// reads threads from disk after its own turns finish, so it sees them.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { connectCodex, userText } from './codex-rpc.js';
import { asideMcpArgs, appleMcpArgs, buildCodexEnvironment, REASONING_EFFORTS, SANDBOX_MODES } from '../codex-cli.js';

const text = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const DEFAULT_AGENT_CWD = '/Users/quinnodonnell/oneiro/runtime/workspace';
export const THREAD_SOURCE = 'oca-engine';

// One step of an agent's work, as the pursuit chat shows it: what kind, a one-line title, a little detail, and
// whether it is still going. Unknown item kinds are left out rather than shown raw.
export function stepOf(i) {
  const status = i.status === 'inProgress' ? 'running' : i.status === 'failed' || i.status === 'declined' ? 'failed' : 'done';
  switch (i.type) {
    case 'commandExecution': {
      const out = String(i.aggregatedOutput || '').trim();
      return { kind: 'command', text: text(i.command, 240), detail: out.slice(-1200), status: i.exitCode && i.exitCode !== 0 ? 'failed' : status };
    }
    case 'fileChange': {
      const files = (i.changes || []).map(c => `${c.kind?.type || c.kind || 'edit'} ${c.path}`);
      return files.length ? { kind: 'files', text: files.length === 1 ? files[0] : `${files.length} files changed`, detail: files.join('\n').slice(0, 1200), status } : null;
    }
    case 'mcpToolCall': {
      const result = i.error?.message || (i.result?.content || []).map(c => c.text || '').join(' ');
      return { kind: 'tool', text: text(`${i.server}.${i.tool}`, 160), detail: text(result, 1200), status: i.error ? 'failed' : status };
    }
    case 'webSearch': return { kind: 'search', text: text(i.query || i.action?.query || 'Web search', 240), detail: '', status };
    case 'reasoning': {
      const summary = (i.summary || []).map(x => typeof x === 'string' ? x : x?.text || '').join(' ');
      return summary.trim() ? { kind: 'thinking', text: text(summary, 400), detail: '', status } : null;
    }
    case 'plan': return i.text ? { kind: 'plan', text: text(i.text, 600), detail: '', status } : null;
    default: return null;
  }
}

export function resolveCodexBin(env = process.env) {
  const configured = String(env.OCA_CODEX_APP_SERVER_BIN || env.ONEIRO_CODEX_CLI || env.OCA_CODEX_CLI || '').trim();
  return [configured, '/opt/homebrew/bin/codex', '/usr/local/bin/codex'].filter(Boolean).find(p => existsSync(p)) || configured || 'codex';
}

// The app-server's command line: Aside and Apple as MCP servers (as every Codex run of the engine gets), and the
// engine's own MCP server switched off inside its agents, so an agent can never answer its own asks.
export function appServerArgs({ mcp = true, effort = '', extra = [], disableServers = [] } = {}) {
  const args = [];
  if (mcp) args.push(...asideMcpArgs(), ...appleMcpArgs());
  for (const name of disableServers) args.push('-c', `mcp_servers.${name}.enabled=false`);
  const e = String(effort || '').toLowerCase();
  if (REASONING_EFFORTS.includes(e)) args.push('-c', `model_reasoning_effort="${e}"`);
  return [...args, ...extra];
}

// Servers named in ~/.codex/config.toml that point at the engine itself (the OCA MCP server): those are disabled
// for the engine's own agents.
export async function engineMcpServersIn(configPath = `${process.env.HOME}/.codex/config.toml`) {
  try {
    const toml = await readFile(configPath, 'utf8');
    // Each [mcp_servers.<name>] table runs until the next table header; a server that points at mcp/server.js here is the engine's.
    const names = [];
    let current = null;
    for (const line of toml.split('\n')) {
      const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
      if (header) { const m = header[1].match(/^mcp_servers\.([A-Za-z0-9_-]+)$/); current = m ? m[1] : (header[1].startsWith(`mcp_servers.${current}.`) ? current : null); continue; }
      if (current && /oca-cognitive\/mcp\/server\.js|oca-mcp/i.test(line) && !names.includes(current)) names.push(current);
    }
    return names;
  } catch { return []; }
}

const statusOf = t => ({ completed: 'ok', interrupted: 'interrupted', failed: 'error' })[t?.status] || (t?.status === 'inProgress' ? 'running' : 'error');
const lastAgentText = items => (items || []).filter(i => i.type === 'agentMessage' && String(i.text || '').trim()).map(i => i.text).at(-1) || '';
const inputText = content => (content || []).map(c => (c?.type === 'text' ? c.text : '')).filter(Boolean).join('\n');

export function createCodexHost({ pool, bin = resolveCodexBin(), args = null, env = buildCodexEnvironment(process.env), connect = connectCodex,
  cwd = DEFAULT_AGENT_CWD, sandbox = 'danger-full-access', model = null, effort = process.env.OCA_AGENT_THINKING || '',
  clock = Date.now, log = console, restartGapMs = 5000, accountTtlMs = 60_000 } = {}) {
  if (!SANDBOX_MODES.includes(sandbox)) throw new Error(`sandbox must be one of ${SANDBOX_MODES.join(', ')}`);
  let conn = null, starting = null, lastStart = 0, account = { at: 0, ok: false, why: 'not checked' };
  const loaded = new Set();                       // threads resumed on the current connection
  const started = new Set();                      // turns started on the current connection (only these can still be running)
  const waiters = new Map();                      // turnId → [resolve]
  const early = new Map();                        // turnId → completed turn that arrived before turn/start returned

  // A run still marked running from before this process is reconciled against its thread when it is next waited on
  // (wait): a turn that finished while the engine was down is taken once, and one that was cut off is lost.
  async function init() {
    await pool.query(await readFile(new URL('../migrations/068_agent_host.sql', import.meta.url), 'utf8'));
  }

  async function onCompleted(threadId, turn) {
    let reply = lastAgentText(turn.items);
    if (!reply && turn.status === 'completed') reply = await turnReply(threadId, turn.id).catch(() => '');
    const status = statusOf(turn);
    const error = turn.error ? text(turn.error.message || JSON.stringify(turn.error), 500) : (status === 'interrupted' ? 'interrupted' : null);
    const { rowCount } = await pool.query(`UPDATE agent_runs SET status = $2, reply = $3, error = $4, completed_at = now() WHERE turn_id = $1 AND status = 'running'`,
      [turn.id, status, reply, error]).catch(() => ({ rowCount: 0 }));
    if (!rowCount) early.set(turn.id, true);
    // The thread is let go once its turn ends: the next read comes from the rollout on disk, which is where turns
    // Quinn runs from T3 Code or Codex land.
    if (conn?.alive && loaded.has(threadId)) { loaded.delete(threadId); conn.request('thread/unsubscribe', { threadId }, { timeoutMs: 10_000 }).catch(() => {}); }
    for (const w of waiters.get(turn.id) || []) w();
    waiters.delete(turn.id);
  }

  async function ensure() {
    if (conn?.alive) return conn;
    if (starting) return starting;
    const wait = lastStart + restartGapMs - clock();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    starting = (async () => {
      lastStart = clock();
      const disable = await engineMcpServersIn();
      const c = connect({ bin, args: args || appServerArgs({ effort, disableServers: disable }), env, clientName: 'oca-engine', log });
      c.on(msg => {
        if (msg.method === 'turn/completed') onCompleted(msg.params.threadId, msg.params.turn).catch(e => log.warn?.('[agents] turn completion:', e.message));
        else if (msg.method === '__exit') {
          loaded.clear(); started.clear();
          log.warn?.(`[agents] ${msg.params.reason}`);
          pool.query(`UPDATE agent_runs SET status = 'lost', error = $1, completed_at = now() WHERE status = 'running' AND host = 'codex'`, [text(msg.params.reason, 300)]).catch(() => {});
          for (const [, ws] of waiters) for (const w of ws) w();
          waiters.clear();
        }
      });
      await c.init();
      conn = c;
      return c;
    })();
    try { return await starting; } finally { starting = null; }
  }

  async function available({ force = false } = {}) {
    try {
      const c = await ensure();
      if (!force && clock() - account.at < accountTtlMs) return account.ok;
      const r = await c.request('account/read', { refreshToken: false }, { timeoutMs: 20_000 });
      const ok = Boolean(r?.account) || r?.requiresOpenaiAuth === false;
      account = { at: clock(), ok, why: ok ? null : 'Codex is not signed in to ChatGPT' };
      if (!ok) log.warn?.('[agents] Codex is not signed in; agents cannot run');
      return ok;
    } catch (e) {
      account = { at: clock(), ok: false, why: text(e.message, 200) };
      log.warn?.('[agents] codex app-server unavailable:', text(e.message, 200));
      return false;
    }
  }

  const threadRow = async key => (await pool.query('SELECT * FROM agent_threads WHERE session_key = $1', [key])).rows[0] || null;
  async function threadOf(key) { return (await threadRow(key))?.thread_id || null; }

  async function load(c, row) {
    if (loaded.has(row.thread_id)) return;
    await c.request('thread/resume', { threadId: row.thread_id, excludeTurns: true, approvalPolicy: 'never', sandbox, ...(row.cwd ? { cwd: row.cwd } : {}) }, { timeoutMs: 60_000 });
    loaded.add(row.thread_id);
  }

  async function createSession({ agentId = 'oca', key, label, displayName, model: m = model, thinkingLevel = null, cwd: dir = null }) {
    const existing = await threadRow(key);
    if (existing) return { ok: true, key, threadId: existing.thread_id };
    const c = await ensure();
    const effortNow = REASONING_EFFORTS.includes(String(thinkingLevel || '').toLowerCase()) ? String(thinkingLevel).toLowerCase() : null;
    const r = await c.request('thread/start', { cwd: dir || cwd, approvalPolicy: 'never', sandbox, threadSource: THREAD_SOURCE, serviceName: 'oca-engine',
      ...(m ? { model: m } : {}), ...(effortNow ? { config: { model_reasoning_effort: effortNow } } : {}) }, { timeoutMs: 60_000 });
    const threadId = r.thread.id;
    loaded.add(threadId);
    const name = text(label || displayName || key, 120);
    await c.request('thread/name/set', { threadId, name }, { timeoutMs: 10_000 }).catch(e => log.warn?.('[agents] thread name:', e.message));
    await pool.query(`INSERT INTO agent_threads (session_key, thread_id, agent_id, display_name, cwd) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (session_key) DO NOTHING`,
      [key, threadId, agentId, text(displayName || name, 200), dir || cwd]);
    return { ok: true, key, threadId };
  }

  async function turn({ sessionKey, message, idempotencyKey }) {
    if (!idempotencyKey) throw new Error('a turn needs an idempotency key');
    const prior = (await pool.query('SELECT * FROM agent_runs WHERE run_id = $1', [idempotencyKey])).rows[0];
    if (prior) return { runId: prior.run_id, turnId: prior.turn_id, status: prior.status };
    const row = await threadRow(sessionKey); if (!row) throw new Error(`no agent thread for ${sessionKey}`);
    const c = await ensure();
    await load(c, row);
    const r = await c.request('turn/start', { threadId: row.thread_id, input: [userText(message)], clientUserMessageId: idempotencyKey }, { timeoutMs: 60_000 });
    const turnId = r.turn.id;
    started.add(turnId);
    await pool.query(`INSERT INTO agent_runs (run_id, session_key, thread_id, turn_id, status) VALUES ($1,$2,$3,$4,'running') ON CONFLICT (run_id) DO NOTHING`,
      [idempotencyKey, sessionKey, row.thread_id, turnId]);
    await pool.query('UPDATE agent_threads SET updated_at = now() WHERE session_key = $1', [sessionKey]);
    if (early.delete(turnId)) await onCompleted(row.thread_id, (await readTurn(row.thread_id, turnId)) || { id: turnId, status: 'completed', items: [] });
    return { runId: idempotencyKey, turnId };
  }

  async function readThread(threadId) {
    const c = await ensure();
    return (await c.request('thread/read', { threadId, includeTurns: true }, { timeoutMs: 60_000 })).thread;
  }
  async function readTurn(threadId, turnId) { return (await readThread(threadId)).turns?.find(t => t.id === turnId) || null; }
  async function turnReply(threadId, turnId) { return lastAgentText((await readTurn(threadId, turnId))?.items); }

  // A run this connection did not start cannot still be running here: whatever its thread says now is final.
  async function reconcile(row) {
    let t = null;
    try { t = await readTurn(row.thread_id, row.turn_id); } catch (e) { log.warn?.('[agents] reconcile:', text(e.message, 160)); return row; }
    const status = !t || t.status === 'inProgress' ? 'lost' : statusOf(t);
    const reply = t ? lastAgentText(t.items) : '';
    const error = status === 'lost' ? 'the turn was cut off by a restart' : t?.error ? text(t.error.message || JSON.stringify(t.error), 500) : (status === 'interrupted' ? 'interrupted' : null);
    await pool.query(`UPDATE agent_runs SET status = $2, reply = $3, error = $4, completed_at = now() WHERE run_id = $1 AND status = 'running'`, [row.run_id, status, reply, error]);
    return (await pool.query('SELECT * FROM agent_runs WHERE run_id = $1', [row.run_id])).rows[0];
  }

  async function wait(runId, { timeoutMs = 1000 } = {}) {
    let row = (await pool.query('SELECT * FROM agent_runs WHERE run_id = $1', [runId])).rows[0];
    if (!row) return { status: 'pending' };
    if (row.status === 'running' && row.turn_id && !started.has(row.turn_id)) row = await reconcile(row);
    if (row.status === 'running' && timeoutMs > 0 && row.turn_id) {
      await new Promise(resolve => {
        const t = setTimeout(resolve, timeoutMs);
        const list = waiters.get(row.turn_id) || []; list.push(() => { clearTimeout(t); resolve(); }); waiters.set(row.turn_id, list);
      });
      row = (await pool.query('SELECT * FROM agent_runs WHERE run_id = $1', [runId])).rows[0];
    }
    if (row.status === 'running') return { status: 'pending' };
    if (row.status === 'ok') return { status: 'ok', terminalReply: { text: row.reply || '' } };
    return { status: 'error', stopReason: row.status, error: { message: row.error || row.status } };
  }

  // With `steps`, the agent's work between messages comes too (commands, file edits, searches, tool calls), as
  // role 'step' entries, for the pursuit chat. The engine's own readers never ask for them.
  async function transcript(sessionKey, { steps = false } = {}) {
    const row = await threadRow(sessionKey);
    if (!row) return { messages: [], pending: 0, active: false, activeRunId: null };
    const thread = await readThread(row.thread_id);
    const { rows: runs } = await pool.query('SELECT run_id, turn_id FROM agent_runs WHERE thread_id = $1', [row.thread_id]);
    const runOf = new Map(runs.map(r => [r.turn_id, r.run_id]));
    const messages = []; let activeRunId = null, active = false;
    for (const t of thread.turns || []) {
      const runId = runOf.get(t.id) || null;
      const inFlight = t.status === 'inProgress';
      if (inFlight) { active = true; activeRunId = runId; }
      const agentItems = (t.items || []).filter(i => i.type === 'agentMessage' && String(i.text || '').trim());
      const lastAgent = agentItems.at(-1);
      for (const i of t.items || []) {
        const at = Number(i.startedAtMs || i.completedAtMs || 0) || (t.startedAt ? t.startedAt * 1000 : null);
        if (i.type === 'userMessage') {
          const said = inputText(i.content); if (!said.trim()) continue;
          messages.push({ role: 'user', text: said, at, runId, idempotencyKey: i.clientId || null, terminal: null });
        } else if (i.type === 'agentMessage' && String(i.text || '').trim()) {
          const done = Number(i.completedAtMs || 0) || (t.completedAt ? t.completedAt * 1000 : at);
          messages.push({ role: 'assistant', text: i.text, at: done, runId, terminal: inFlight ? false : i === lastAgent, channel: null });
        } else if (steps) {
          const step = stepOf(i);
          if (step) messages.push({ role: 'step', ...step, at, runId, terminal: null });
        }
      }
    }
    return { messages, pending: 0, active, activeRunId, threadId: row.thread_id };
  }
  async function history(sessionKey) { return (await transcript(sessionKey)).messages; }

  // Which of the engine's threads changed, and when, from Codex's own index: a thread Quinn answered in T3 Code
  // shows a newer updatedAt here before the engine reads it.
  async function sessions({ limit = 300 } = {}) {
    const { rows } = await pool.query(`SELECT session_key, thread_id FROM agent_threads WHERE host = 'codex' ORDER BY updated_at DESC LIMIT $1`, [limit]);
    if (!rows.length) return [];
    const byThread = new Map(rows.map(r => [r.thread_id, r.session_key]));
    const c = await ensure();
    const out = []; let cursor = null;
    for (let page = 0; page < 10 && out.length < byThread.size; page++) {
      const r = await c.request('thread/list', { limit: 100, cursor, sortKey: 'updated_at', sourceKinds: [] }, { timeoutMs: 30_000 });
      for (const t of r.data || []) if (byThread.has(t.id)) out.push({ key: byThread.get(t.id), updatedAt: Number(t.updatedAt || t.createdAt || 0) * 1000, threadId: t.id });
      cursor = r.nextCursor; if (!cursor) break;
    }
    return out;
  }

  async function abort(sessionKey) {
    const { rows } = await pool.query(`SELECT * FROM agent_runs WHERE session_key = $1 AND status = 'running'`, [sessionKey]);
    if (!rows.length) return { ok: true, interrupted: 0 };
    const c = await ensure();
    for (const r of rows) {
      await c.request('turn/interrupt', { threadId: r.thread_id, turnId: r.turn_id }, { timeoutMs: 20_000 }).catch(e => log.warn?.('[agents] interrupt:', e.message));
    }
    return { ok: true, interrupted: rows.length };
  }
  const reset = abort;

  async function rename(sessionKey, name) {
    const row = await threadRow(sessionKey); if (!row) return;
    const c = await ensure();
    await c.request('thread/name/set', { threadId: row.thread_id, name: text(name, 120) }, { timeoutMs: 10_000 });
  }

  async function close() { const c = conn; conn = null; loaded.clear(); started.clear(); if (c) await c.close(); }
  function status() { return { up: Boolean(conn?.alive), pid: conn?.pid || null, signedIn: account.ok, why: account.why, loaded: loaded.size }; }

  return { kind: 'codex', init, available, createSession, turn, wait, transcript, history, sessions, abort, reset, rename, threadOf, status, close };
}
