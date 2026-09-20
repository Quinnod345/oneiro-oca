// The OpenClaw gateway, as the engine sees it: the place its agents live. Every deployed agent is a gateway
// session — visible in the Oneiro app, addressable by the person, driven by the engine through the gateway's
// RPC (sessions.create, agent, agent.wait, chat.history, chat.send). Calls go through the openclaw CLI, which
// carries the paired device identity; the engine never holds a gateway token of its own.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const run = promisify(execFile);
export const OPENCLAW_CLI = process.env.OCA_OPENCLAW_CLI || '/opt/homebrew/bin/openclaw';

export function createGateway({ cli = OPENCLAW_CLI, runner = null, timeoutMs = 30_000, log = console } = {}) {
  const exec = runner || (async (args, ms) => {
    const { stdout } = await run(cli, args, { timeout: ms, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } });
    return stdout;
  });
  // One RPC. The CLI prints the result as JSON; a gateway_request_error comes back as {ok:false,error}.
  async function call(method, params = {}, { timeout = timeoutMs } = {}) {
    const out = await exec(['gateway', 'call', method, '--json', '--timeout', String(timeout), '--params', JSON.stringify(params)], timeout + 10_000);
    // The CLI pretty-prints one JSON value, sometimes after a line or two of notes: parse from the first brace.
    const raw = String(out); const start = raw.search(/[{[]/);
    let r; try { r = start >= 0 ? JSON.parse(raw.slice(start)) : null; } catch { throw new Error(`gateway ${method}: unreadable answer ${raw.replace(/\s+/g, ' ').slice(0, 160)}`); }
    if (r && r.ok === false) throw new Error(`gateway ${method}: ${r.error?.message || r.error?.code || 'failed'}`);
    return r;
  }
  let lastHealth = { at: 0, ok: false };
  async function available() {
    if (Date.now() - lastHealth.at < 30_000) return lastHealth.ok;
    try { const h = await call('health', {}, { timeout: 8000 }); lastHealth = { at: Date.now(), ok: !!h && h.ok !== false }; }
    catch (e) { lastHealth = { at: Date.now(), ok: false }; log.warn?.('[gateway] unavailable:', String(e.message).slice(0, 160)); }
    return lastHealth.ok;
  }
  // A session for an agent: created idle (no turn), named so the person recognises it in the app.
  async function createSession({ agentId, key, label, displayName, model, thinkingLevel, cwd, parentSessionKey }) {
    // No idempotencyKey: the CLI call carries no principal the gateway would bind it to; the key itself is unique.
    const params = { agentId, key, label, displayName };
    if (model) params.model = model; if (thinkingLevel) params.thinkingLevel = thinkingLevel; if (cwd) params.cwd = cwd; if (parentSessionKey) params.parentSessionKey = parentSessionKey;
    return call('sessions.create', params);
  }
  // A turn: the message is what the engine (or the person, relayed) says; the agent answers in the session.
  async function turn({ sessionKey, message, idempotencyKey = randomUUID(), timeout = 900, cwd, label }) {
    const params = { sessionKey, message, idempotencyKey, deliver: false, timeout };
    if (cwd) params.cwd = cwd; if (label) params.label = label;
    return call('agent', params, { timeout: 20_000 });
  }
  // Waits at most timeoutMs for a run: {status:'ok'|'error'|'pending'|'timeout', terminalReply:{text}}.
  async function wait(runId, { timeoutMs = 1000 } = {}) { return call('agent.wait', { runId, timeoutMs }, { timeout: timeoutMs + 15_000 }); }
  // The transcript as the app shows it: [{role:'user'|'assistant', content, timestamp}], oldest first.
  // Only what was said: tool calls and results come back as text-less parts and are dropped here.
  async function transcript(sessionKey, { limit = 200 } = {}) {
    const r = await call('chat.history', { sessionKey, limit });
    const messages = (Array.isArray(r?.messages) ? r.messages : []).map(m => ({ role: m.role, text: messageText(m.content), at: m.timestamp || null })).filter(m => (m.role === 'user' || m.role === 'assistant') && m.text.trim());
    return { messages, pending: Array.isArray(r?.pendingInputs) ? r.pendingInputs.length : 0 };
  }
  async function history(sessionKey, opts) { return (await transcript(sessionKey, opts)).messages; }
  async function sessions({ agentId, limit = 200 } = {}) { const r = await call('sessions.list', { agentId, limit, includeLastMessage: false }); return Array.isArray(r?.sessions) ? r.sessions : r; }
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
