// The conversation side of the engine, in T3 Code. Each pursuit's talker (the engine's voice for that pursuit) is a
// T3 Code thread in the "Oneiro engine" project, running on Codex: Quinn opens T3 Code and talks to the engine there,
// and the same thread is in Codex's own list (T3 runs it on `codex app-server`). Agent questions and results are
// posted into it, and what Quinn writes there comes back to the engine.
//
// T3 Code only shows threads it owns, so these threads are T3's: the engine drives them through T3's own host
// command, `t3 thread start|send|show|list --json`, which needs no sign-in on this Mac. Same interface as the Codex
// host (reasoning/agents.js does not know which one carries a session).
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { workspaceDir } from '../reasoning/local-config.js';

const text = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const T3_PROJECT_DIR = process.env.OCA_T3_PROJECT_DIR || workspaceDir('oneiro-engine');
export const T3_BIN = process.env.OCA_T3_BIN || `${process.env.HOME}/.t3/bin/t3`;

export const PROJECT_AGENTS_MD = `# Oneiro engine — pursuit conversations

Each thread here is one of the Oneiro engine's pursuits, and you are the engine's voice for it. Quinn talks to the
engine here, from T3 Code or Codex.

- Messages that start with [thinker] come from the engine: agent questions, results, and status. Anything else is Quinn.
- Answer from the engine's live state: \`curl -s localhost:3333/ponder/<pursuit id>\`, \`curl -s "localhost:3333/oca/agents?chainId=<pursuit id>"\`.
- What Quinn says here is passed to the engine as their own words; when they answer an agent's question, the engine gives
  that agent the answer. Say back what changed in one line.
- You talk; you do not do the pursuit's work. No browsing, no edits, no purchases.
`;

// One call of the T3 host command. stdin carries the message, so nothing is limited by argv or quoting.
export function runT3(args, { bin = T3_BIN, cwd = T3_PROJECT_DIR, input = null, timeoutMs = 60_000, exec = execFile } = {}) {
  return new Promise((resolve, reject) => {
    const child = exec(bin, args, { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } }, (err, stdout, stderr) => {
      const out = String(stdout || '').trim();
      if (err && !out) return reject(new Error(`t3 ${args.slice(0, 2).join(' ')}: ${text(stderr || err.message, 300)}`));
      try { resolve(out ? JSON.parse(out.slice(out.search(/[[{]/))) : null); }
      catch { reject(new Error(`t3 ${args.slice(0, 2).join(' ')}: unreadable answer ${text(out, 160)}`)); }
    });
    if (input !== null) { child.stdin?.write(input); child.stdin?.end(); }
  });
}

const ordinalOf = runId => Number((String(runId || '').match(/ordinal:(\d+)/) || [])[1]) || 0;

export function createT3Host({ pool, projectDir = T3_PROJECT_DIR, provider = process.env.OCA_T3_PROVIDER || 'codex', model = process.env.OCA_T3_MODEL || 'gpt-6.1-sol',
  run = runT3, clock = Date.now, log = console, availabilityTtlMs = 30_000 } = {}) {
  let avail = { at: 0, ok: false, why: 'not checked' };
  const t3 = (args, opts = {}) => run(args, { cwd: projectDir, ...opts });

  async function init() {
    await pool.query(await readFile(new URL('../migrations/068_agent_host.sql', import.meta.url), 'utf8'));
    if (!existsSync(projectDir)) mkdirSync(projectDir, { recursive: true });
    const md = join(projectDir, 'AGENTS.md');
    if (!existsSync(md) || (await readFile(md, 'utf8')) !== PROJECT_AGENTS_MD) writeFileSync(md, PROJECT_AGENTS_MD);
  }

  // T3 Code is a desktop app: it is up when its server answers. When it is not, the engine's conversations wait and
  // agents still run on the engine's own Codex app-server.
  async function available({ force = false } = {}) {
    if (!force && clock() - avail.at < availabilityTtlMs) return avail.ok;
    try {
      await t3(['thread', 'list', '--project', projectDir, '--json'], { timeoutMs: 20_000 });
      avail = { at: clock(), ok: true, why: null };
    } catch (e) {
      if (/project/i.test(e.message) && !/No running/i.test(e.message)) {
        // The project is missing: add it once, then it is there.
        try { await run(['project', 'add', projectDir, '--title', 'Oneiro engine'], { cwd: projectDir, timeoutMs: 20_000 }); avail = { at: clock(), ok: true, why: null }; return true; } catch {}
      }
      avail = { at: clock(), ok: false, why: text(e.message, 200) };
    }
    return avail.ok;
  }

  const threadRow = async key => (await pool.query(`SELECT * FROM agent_threads WHERE session_key = $1 AND host = 't3'`, [key])).rows[0] || null;
  const pendingId = key => `pending:${key}`;
  async function threadOf(key) { const r = await threadRow(key); return r && !r.thread_id.startsWith('pending:') ? r.thread_id : null; }

  // T3 creates a thread with its first message, so the session is recorded now and the thread starts with the first turn.
  async function createSession({ agentId = 'oca', key, label, displayName }) {
    const existing = await threadRow(key);
    if (existing) return { ok: true, key, threadId: existing.thread_id };
    await pool.query(`INSERT INTO agent_threads (session_key, host, thread_id, agent_id, display_name, cwd) VALUES ($1,'t3',$2,$3,$4,$5) ON CONFLICT (session_key) DO NOTHING`,
      [key, pendingId(key), agentId, text(label || displayName || key, 200), projectDir]);
    return { ok: true, key, threadId: null };
  }

  async function turn({ sessionKey, message, idempotencyKey }) {
    if (!idempotencyKey) throw new Error('a turn needs an idempotency key');
    const prior = (await pool.query('SELECT * FROM agent_runs WHERE run_id = $1', [idempotencyKey])).rows[0];
    if (prior) return { runId: prior.run_id, turnId: prior.turn_id, status: prior.status };
    const row = await threadRow(sessionKey); if (!row) throw new Error(`no T3 thread for ${sessionKey}`);
    let r;
    if (row.thread_id.startsWith('pending:')) {
      r = await t3(['thread', 'start', projectDir, '-', '--title', text(row.display_name, 100), '--provider', provider, '--model', model, '--json'], { input: message, timeoutMs: 120_000 });
      await pool.query(`UPDATE agent_threads SET thread_id = $2, updated_at = now() WHERE session_key = $1`, [sessionKey, r.threadId]);
    } else {
      r = await t3(['thread', 'send', row.thread_id, '-', '--json'], { input: message, timeoutMs: 60_000 });
      await pool.query(`UPDATE agent_threads SET updated_at = now() WHERE session_key = $1`, [sessionKey]);
    }
    await pool.query(`INSERT INTO agent_runs (run_id, host, session_key, thread_id, turn_id, status) VALUES ($1,'t3',$2,$3,$4,'running') ON CONFLICT (run_id) DO NOTHING`,
      [idempotencyKey, sessionKey, r.threadId, r.runId]);
    return { runId: idempotencyKey, turnId: r.runId, threadId: r.threadId, link: r.link || null };
  }

  async function show(threadId, messages = 200) { return t3(['thread', 'show', threadId, '--json', '--messages', String(messages)], { timeoutMs: 30_000 }); }

  async function wait(runId) {
    const row = (await pool.query('SELECT * FROM agent_runs WHERE run_id = $1', [runId])).rows[0];
    if (!row) return { status: 'pending' };
    if (row.status === 'ok') return { status: 'ok', terminalReply: { text: row.reply || '' } };
    if (row.status !== 'running') return { status: 'error', stopReason: row.status, error: { message: row.error || row.status } };
    const s = await show(row.thread_id, 50);
    if (s.thread.activeRunId === row.turn_id) return { status: 'pending' };
    const reply = (s.messages || []).filter(m => m.role === 'assistant' && m.runId === row.turn_id).map(m => m.text).at(-1) || '';
    const failed = s.thread.latestRunId === row.turn_id && /fail|error|stopp/i.test(String(s.thread.status));
    const waiting = s.thread.latestRunId === row.turn_id && s.thread.pendingRequestCount > 0;
    if (waiting) return { status: 'pending' };
    const status = failed && !reply ? 'error' : 'ok';
    await pool.query(`UPDATE agent_runs SET status = $2, reply = $3, error = $4, completed_at = now() WHERE run_id = $1`, [runId, status, reply, failed && !reply ? `T3 run ${s.thread.status}` : null]);
    return status === 'ok' ? { status: 'ok', terminalReply: { text: reply } } : { status: 'error', stopReason: 'error', error: { message: `T3 run ${s.thread.status}` } };
  }

  // T3's transcript has run ids but no times. A run is dated the first time the engine sees it, which is all the
  // runtime compares against: what is new since it last looked.
  async function transcript(sessionKey) {
    const row = await threadRow(sessionKey);
    if (!row || row.thread_id.startsWith('pending:')) return { messages: [], pending: 0, active: false, activeRunId: null };
    const s = await show(row.thread_id, 200);
    const { rows: known } = await pool.query('SELECT run_id, turn_id, started_at FROM agent_runs WHERE thread_id = $1', [row.thread_id]);
    const byTurn = new Map(known.map(k => [k.turn_id, k]));
    for (const m of s.messages || []) {
      if (!m.runId || byTurn.has(m.runId)) continue;
      const ins = await pool.query(`INSERT INTO agent_runs (run_id, host, session_key, thread_id, turn_id, status, completed_at) VALUES ($1,'t3',$2,$3,$4,'external', now())
        ON CONFLICT (run_id) DO UPDATE SET run_id = EXCLUDED.run_id RETURNING run_id, turn_id, started_at`, [`t3:${m.runId}`, sessionKey, row.thread_id, m.runId]);
      byTurn.set(m.runId, ins.rows[0]);
    }
    const active = Boolean(s.thread.activeRunId);
    const messages = (s.messages || []).map(m => {
      const k = byTurn.get(m.runId);
      const base = k ? new Date(k.started_at).getTime() : clock();
      const ours = k && !String(k.run_id).startsWith('t3:');
      return { role: m.role, text: String(m.text || ''), at: base + (m.role === 'assistant' ? 1 : 0) + ordinalOf(m.runId) * 0,
        runId: ours ? k.run_id : null, terminal: m.role === 'assistant' ? m.runId !== s.thread.activeRunId : null, channel: null };
    }).filter(m => (m.role === 'user' || m.role === 'assistant') && m.text.trim());
    const activeRun = active ? byTurn.get(s.thread.activeRunId) : null;
    return { messages, pending: s.thread.pendingRequestCount || 0, active, activeRunId: activeRun && !String(activeRun.run_id).startsWith('t3:') ? activeRun.run_id : null,
      threadId: row.thread_id, link: s.thread.link || null };
  }
  async function history(sessionKey) { return (await transcript(sessionKey)).messages; }

  async function sessions() {
    const { rows } = await pool.query(`SELECT session_key, thread_id FROM agent_threads WHERE host = 't3' AND thread_id NOT LIKE 'pending:%'`);
    if (!rows.length) return [];
    const byThread = new Map(rows.map(r => [r.thread_id, r.session_key]));
    const list = await t3(['thread', 'list', '--project', projectDir, '--json'], { timeoutMs: 30_000 });
    return (list || []).filter(t => byThread.has(t.threadId)).map(t => ({ key: byThread.get(t.threadId), updatedAt: Date.parse(t.updatedAt) || 0, threadId: t.threadId, link: t.link }));
  }

  // The host command has no interrupt; a talker turn is short and is left to finish.
  async function abort() { return { ok: true, interrupted: 0 }; }
  async function link(sessionKey) { const id = await threadOf(sessionKey); if (!id) return null; try { return (await show(id, 1)).thread.link || null; } catch { return null; } }
  function status() { return { up: avail.ok, why: avail.why, project: projectDir }; }
  async function close() {}

  return { kind: 't3', init, available, createSession, turn, wait, transcript, history, sessions, abort, reset: abort, threadOf, link, status, close };
}
