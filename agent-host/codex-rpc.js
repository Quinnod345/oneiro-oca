// A JSON-RPC connection to `codex app-server` over stdio (one JSON object per line). The engine owns one
// long-lived server; agents are threads on it. When the server exits, the connection says so and every
// pending request fails with the reason, so the host can start a new one.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const text = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function connectCodex({ bin = 'codex', args = [], env = process.env, spawnImpl = spawn, clientName = 'oca-engine', log = console } = {}) {
  const child = spawnImpl(bin, ['app-server', ...args], { stdio: ['pipe', 'pipe', 'pipe'], env });
  let next = 1, alive = true, exitReason = null, initialized = null;
  const pending = new Map();
  const listeners = new Set();
  const serverRequests = new Set();
  let stderrTail = '';

  const rl = createInterface({ input: child.stdout });
  rl.on('line', line => {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined && msg.method === undefined) {
      const p = pending.get(msg.id); if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(Object.assign(new Error(`codex ${p.method}: ${text(msg.error.message || JSON.stringify(msg.error), 300)}`), { rpc: msg.error }));
      else p.resolve(msg.result);
      return;
    }
    if (msg.id !== undefined && msg.method) { for (const h of serverRequests) h(msg); return; }   // the server asks us something
    for (const l of listeners) { try { l(msg); } catch (e) { log.warn?.('[codex] listener:', e.message); } }
  });
  child.stderr?.on('data', d => { stderrTail = (stderrTail + String(d)).slice(-2000); });
  const onExit = (code, signal) => {
    if (!alive) return;
    alive = false;
    exitReason = `codex app-server exited (${signal || code})${stderrTail ? `: ${text(stderrTail.split('\n').filter(Boolean).at(-1), 200)}` : ''}`;
    for (const [, p] of pending) p.reject(new Error(exitReason));
    pending.clear();
    for (const l of listeners) { try { l({ method: '__exit', params: { reason: exitReason } }); } catch {} }
  };
  child.on('exit', onExit);
  child.on('error', e => onExit(null, e.message));

  const write = obj => { if (!alive) throw new Error(exitReason || 'codex app-server is not running'); child.stdin.write(JSON.stringify(obj) + '\n'); };
  function request(method, params = {}, { timeoutMs = 60_000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!alive) return reject(new Error(exitReason || 'codex app-server is not running'));
      const id = next++;
      const timer = timeoutMs ? setTimeout(() => { if (pending.delete(id)) reject(new Error(`codex ${method}: no answer in ${timeoutMs} ms`)); }, timeoutMs) : null;
      pending.set(id, { method, resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      try { write({ id, method, params }); } catch (e) { pending.delete(id); clearTimeout(timer); reject(e); }
    });
  }
  const notify = (method, params) => write(params === undefined ? { method } : { method, params });
  const respond = (id, result) => write({ id, result });
  const on = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  const onServerRequest = fn => { serverRequests.add(fn); return () => serverRequests.delete(fn); };

  // The engine runs agents unattended: anything that would wait for a person to approve in a terminal is
  // answered no, and the agent reports through its oca block instead. (Threads start with approvalPolicy
  // "never", so this only catches what a future protocol adds.)
  const UNATTENDED = 'Nobody is at a terminal for an engine agent: report what you need in your oca block instead.';
  onServerRequest(msg => {
    try {
      if (msg.method === 'item/commandExecution/requestApproval' || msg.method === 'item/fileChange/requestApproval') respond(msg.id, { decision: 'decline' });
      else if (msg.method === 'applyPatchApproval' || msg.method === 'execCommandApproval') respond(msg.id, { decision: { denied: { rejection: UNATTENDED } } });
      else if (msg.method === 'item/tool/requestUserInput') respond(msg.id, { answers: {} });
      else if (msg.method === 'mcpServer/elicitation/request') respond(msg.id, { action: 'decline', content: null, _meta: null });
      else write({ id: msg.id, error: { code: -32601, message: `the OCA engine does not handle ${msg.method}` } });
    } catch {}
  });

  function init() {
    initialized ||= request('initialize', { clientInfo: { name: clientName, title: 'Oneiro engine', version: '1.0.0' }, capabilities: null }, { timeoutMs: 30_000 })
      .then(r => { notify('initialized'); return r; });
    return initialized;
  }
  function close() {
    return new Promise(resolve => {
      if (!alive) return resolve();
      child.once('exit', () => resolve());
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(); }, 3000).unref?.();
    });
  }
  return { request, notify, on, init, close, get alive() { return alive; }, get exitReason() { return exitReason; }, pid: child.pid };
}

export const userText = t => ({ type: 'text', text: String(t), text_elements: [] });
