// The OpenClaw gateway, as the engine sees it: the place its agents live. Every deployed agent is a gateway
// session — visible in the Oneiro app, addressable by the person, driven by the engine through the gateway's
// RPC (sessions.create, agent, agent.wait, chat.history, chat.send). Calls go through the openclaw CLI, which
// carries the paired device identity; the engine never holds a gateway token of its own.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const run = promisify(execFile);
export const OPENCLAW_CLI = process.env.OCA_OPENCLAW_CLI || '/opt/homebrew/bin/openclaw';

// Each CLI call starts a whole OpenClaw process (seconds of CPU). Calls run at most `concurrency` at a time,
// so a burst of polls queues instead of starving each other into timeouts.
export function createGateway({ cli = OPENCLAW_CLI, runner = null, timeoutMs = 30_000, concurrency = 2, log = console,
  httpUrl = process.env.OCA_GATEWAY_HTTP || 'http://127.0.0.1:18789', fetchImpl = null } = {}) {
  let active = 0; const waiting = [];
  const slot = () => new Promise(res => { if (active < concurrency) { active++; res(); } else waiting.push(res); });
  const release = () => { const next = waiting.shift(); if (next) next(); else active--; };
  const spawnOnce = runner || (async (args, ms) => {
    try {
      const { stdout } = await run(cli, args, { timeout: ms, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } });
      return stdout;
    } catch (e) {
      // The CLI's own words travel with the failure, so a hung prompt or a missing identity is named, not guessed.
      const detail = [e.killed || e.signal ? `timed out after ${ms} ms` : '', String(e.stderr || '').trim().slice(0, 300), String(e.stdout || '').trim().slice(0, 200)].filter(Boolean).join(' | ');
      throw new Error(`openclaw ${args[2] || args[0]}: ${detail || e.message}`);
    }
  });
  // The timeout starts when the call gets its slot, not while it waits for one.
  const exec = async (args, ms) => { await slot(); try { return await spawnOnce(args, ms); } finally { release(); } };
  // One RPC. The CLI prints the result as JSON; a gateway_request_error comes back as {ok:false,error}.
  async function call(method, params = {}, { timeout = timeoutMs } = {}) {
    const out = await exec(['gateway', 'call', method, '--json', '--timeout', String(timeout), '--params', JSON.stringify(params)], timeout + 10_000);
    // The CLI pretty-prints one JSON value, sometimes after a line or two of notes: parse from the first brace.
    const raw = String(out); const start = raw.search(/[{[]/);
    let r; try { r = start >= 0 ? JSON.parse(raw.slice(start)) : null; } catch { throw new Error(`gateway ${method}: unreadable answer ${raw.replace(/\s+/g, ' ').slice(0, 160)}`); }
    lastOk = Date.now();   // the gateway answered, even if the method said no
    if (r && r.ok === false) throw new Error(`gateway ${method}: ${r.error?.message || r.error?.code || 'failed'}`);
    return r;
  }
  // Reachable is observed, not probed for its own sake: any call that got an answer in the last two minutes
  // counts. Only when nothing has answered lately is health asked — with a timeout generous enough for a busy
  // machine, and one failure is not an outage: it takes two in a row to call the gateway down.
  // Liveness is the gateway's own HTTP endpoint (/startupz: 200 once started, 503 while starting or draining) —
  // a millisecond fetch, not a CLI process that a busy machine can take half a minute to start.
  // Each probe opens its own connection ("connection: close"): a pooled keep-alive socket the gateway has
  // already dropped can hang a request until it times out, which read as "gateway down" while it was fine.
  // `force` skips the cached answer and probes now, with more patience — for a caller about to act on it.
  let lastOk = 0, lastProbe = 0, lastProbeOk = true, strikes = 0;
  async function available({ force = false } = {}) {
    const now = Date.now();
    if (now - lastOk < 120_000) return true;
    if (!force && now - lastProbe < 15_000) return lastProbeOk;
    lastProbe = now;
    try {
      const res = await (fetchImpl || fetch)(`${httpUrl}/startupz`, { headers: { connection: 'close' }, signal: AbortSignal.timeout(force ? 12_000 : 5000) });
      if (res.status === 200) { lastProbeOk = true; strikes = 0; lastOk = now; }
      else { strikes++; lastProbeOk = false; log.warn?.(`[gateway] not ready: HTTP ${res.status}`); }
    } catch (e) { strikes++; lastProbeOk = strikes < 2; log.warn?.(`[gateway] liveness check failed (${strikes}${strikes >= 2 ? ', treating as down' : ''}):`, String(e.message).slice(0, 160)); }
    return lastProbeOk;
  }
  // A session for an agent: created idle (no turn), named so the person recognises it in the app.
  // No cwd: a session cwd makes the gateway treat the directory as a workspace and seed it with bootstrap files;
  // a builder's worktree is named in its brief instead. No idempotencyKey: the CLI call carries no principal.
  async function createSession({ agentId, key, label, displayName, model, thinkingLevel, parentSessionKey }) {
    const params = { agentId, key, label, displayName };
    if (model) params.model = model; if (thinkingLevel) params.thinkingLevel = thinkingLevel; if (parentSessionKey) params.parentSessionKey = parentSessionKey;
    return call('sessions.create', params);
  }
  // A turn: the message is what the engine (or the person, relayed) says; the agent answers in the session.
  // cwd is reserved by the gateway for its own subagent runs; a builder's worktree travels in the brief instead.
  async function turn({ sessionKey, message, idempotencyKey = randomUUID(), timeout = 900, label }) {
    const params = { sessionKey, message, idempotencyKey, deliver: false, timeout };
    if (label) params.label = label;
    return call('agent', params, { timeout: 20_000 });
  }
  // Waits at most timeoutMs for a run: {status:'ok'|'error'|'pending'|'timeout', terminalReply:{text}}.
  async function wait(runId, { timeoutMs = 1000 } = {}) { return call('agent.wait', { runId, timeoutMs }, { timeout: timeoutMs + 15_000 }); }
  // The transcript as the app shows it: [{role:'user'|'assistant', content, timestamp}], oldest first.
  // Only what was said: tool calls and results come back as text-less parts and are dropped here.
  async function transcript(sessionKey, { limit = 200 } = {}) {
    const r = await call('chat.history', { sessionKey, limit });
    const messages = (Array.isArray(r?.messages) ? r.messages : []).map(m => ({
      role: m.role, text: messageText(m.content), at: m.timestamp || null,
      runId: m.runId || m.__openclaw?.runId || null, idempotencyKey: m.idempotencyKey || null,
      streamFallback: Boolean(m.openclawStreamFallback), channel: m.channel || null,
      terminal: typeof m.__openclaw?.runTerminal === 'boolean' ? m.__openclaw.runTerminal : null,
    })).filter(m => (m.role === 'user' || m.role === 'assistant') && m.text.trim());
    // Current gateways return {items,total}; older ones return an array. A truncated items list
    // must not hide a positive total, and inconsistent totals must not hide queued items either.
    const inputs = r?.pendingInputs;
    const pending = Array.isArray(inputs) ? inputs.length : Math.max(
      Array.isArray(inputs?.items) ? inputs.items.length : 0,
      Number.isFinite(inputs?.total) && inputs.total > 0 ? inputs.total : 0);
    const activeRunId = r?.inFlightRun?.runId || null;
    const active = Boolean(r?.inFlightRun) || r?.sessionInfo?.hasActiveRun === true
      || ['running', 'queued'].includes(r?.sessionInfo?.status);
    return { messages, pending, active, activeRunId };
  }
  async function history(sessionKey, opts) { return (await transcript(sessionKey, opts)).messages; }
  async function sessions({ agentId, limit = 200 } = {}) { const r = await call('sessions.list', { agentId, limit, includeLastMessage: false }); return Array.isArray(r?.sessions) ? r.sessions : []; }
  async function reset(sessionKey, reason = 'cancelled by the engine') { return call('sessions.reset', { key: sessionKey, reason }).catch(() => null); }
  async function patch(sessionKey, fields) { return call('sessions.patch', { key: sessionKey, ...fields }); }
  return { call, available, createSession, turn, wait, history, transcript, sessions, reset, patch };
}

// Assistant content arrives as parts; the person's as text. Either way, the words.
export function messageText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(p => (typeof p === 'string' ? p : p?.type === 'text' ? p.text : '')).filter(Boolean).join('\n');
  if (content && typeof content === 'object' && typeof content.text === 'string') return content.text;
  return '';
}
