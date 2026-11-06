// A `codex app-server` in memory, speaking the slice of the protocol the engine uses: threads with turns and items,
// turns that complete when the test says so, other clients' turns, crashes. Shaped like agent-host/codex-rpc.js's
// connection, so createCodexHost({ connect }) drives it exactly as it drives the real server.
let seq = 0;
const uid = p => `${p}-${(++seq).toString(16).padStart(6, '0')}-0000-7000-8000-000000000000`;

export function fakeCodex({ signedIn = true, clock = () => Date.now() } = {}) {
  const threads = new Map();
  const requests = [];
  let current = null;
  const conns = [];

  function threadView(t, includeTurns) {
    return { id: t.id, name: t.name, preview: t.turns[0]?.items.find(i => i.type === 'userMessage')?.content?.[0]?.text || '', cwd: t.cwd,
      createdAt: t.createdAt, updatedAt: t.updatedAt, source: 'vscode', ...(includeTurns ? { turns: t.turns.map(x => structuredClone(x)) } : {}) };
  }
  const touch = t => { t.updatedAt = Math.floor(clock() / 1000) + t.turns.length; };

  function connect() {
    const listeners = new Set();
    let alive = true;
    const conn = {
      pid: 4242 + conns.length,
      get alive() { return alive; },
      get exitReason() { return alive ? null : 'codex app-server exited (SIGKILL)'; },
      init: async () => ({ userAgent: 'fake-codex/0.166' }),
      on: fn => { listeners.add(fn); return () => listeners.delete(fn); },
      emit: msg => { for (const l of listeners) l(msg); },
      close: async () => { alive = false; },
      async request(method, params = {}) {
        if (!alive) throw new Error('codex app-server exited (SIGKILL)');
        requests.push([method, params]);
        switch (method) {
          case 'account/read': return signedIn ? { account: { type: 'chatgpt', planType: 'pro' }, requiresOpenaiAuth: true } : { account: null, requiresOpenaiAuth: true };
          case 'thread/start': {
            const t = { id: uid('thread'), name: null, cwd: params.cwd, turns: [], createdAt: Math.floor(clock() / 1000), updatedAt: Math.floor(clock() / 1000), params };
            threads.set(t.id, t); return { thread: threadView(t, false), model: params.model || 'gpt-6.1-sol', modelProvider: 'openai' };
          }
          case 'thread/name/set': { threads.get(params.threadId).name = params.name; return {}; }
          case 'thread/resume': { const t = threads.get(params.threadId); if (!t) throw new Error('thread not found'); return { thread: threadView(t, !params.excludeTurns) }; }
          case 'thread/unsubscribe': return {};
          case 'turn/start': {
            const t = threads.get(params.threadId); if (!t) throw new Error('thread not found');
            const turn = { id: uid('turn'), status: 'inProgress', error: null, startedAt: Math.floor(clock() / 1000), completedAt: null,
              items: [{ type: 'userMessage', id: uid('item'), clientId: params.clientUserMessageId || null, content: params.input, startedAtMs: clock() }] };
            t.turns.push(turn); touch(t);
            return { turn: structuredClone(turn) };
          }
          case 'turn/interrupt': {
            const turn = threads.get(params.threadId)?.turns.find(x => x.id === params.turnId);
            if (turn && turn.status === 'inProgress') { turn.status = 'interrupted'; turn.completedAt = Math.floor(clock() / 1000); queueMicrotask(() => conn.emit({ method: 'turn/completed', params: { threadId: params.threadId, turn: structuredClone(turn) } })); }
            return {};
          }
          case 'thread/read': { const t = threads.get(params.threadId); if (!t) throw new Error('thread not found'); return { thread: threadView(t, params.includeTurns) }; }
          case 'thread/list': return { data: [...threads.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(t => threadView(t, false)), nextCursor: null };
          default: throw new Error(`fake codex: unexpected ${method}`);
        }
      },
    };
    conns.push(conn); current = conn;
    return conn;
  }

  // The agent answers: the turn ends with these words (or as given), and the server says so.
  function complete(threadId, turnId = null, { text = '', status = 'completed', partial = false, error = null } = {}) {
    const t = threads.get(threadId);
    const turn = turnId ? t.turns.find(x => x.id === turnId) : t.turns.at(-1);
    if (text) turn.items.push({ type: 'agentMessage', id: uid('item'), text, phase: null, startedAtMs: clock(), completedAtMs: clock() });
    if (partial) { touch(t); return turn; }
    turn.status = status; turn.error = error; turn.completedAt = Math.floor(clock() / 1000); touch(t);
    current?.alive && current.emit({ method: 'turn/completed', params: { threadId, turn: structuredClone(turn) } });
    return turn;
  }
  // Another client (Quinn in T3 Code or Codex) runs a turn on the same thread, straight into its history.
  function external(threadId, said, reply, { status = 'completed' } = {}) {
    const t = threads.get(threadId);
    const turn = { id: uid('turn'), status, error: null, startedAt: Math.floor(clock() / 1000), completedAt: status === 'completed' ? Math.floor(clock() / 1000) : null,
      items: [{ type: 'userMessage', id: uid('item'), clientId: null, content: [{ type: 'text', text: said, text_elements: [] }], startedAtMs: clock() },
        ...(reply ? [{ type: 'agentMessage', id: uid('item'), text: reply, phase: null, startedAtMs: clock(), completedAtMs: clock() }] : [])] };
    t.turns.push(turn); touch(t);
    return turn;
  }
  // The server dies: every turn in flight on it is cut off.
  function crash() {
    if (!current) return;
    const c = current; current = null;
    c.close(); c.emit({ method: '__exit', params: { reason: 'codex app-server exited (SIGKILL)' } });
  }

  return { connect, threads, requests, complete, external, crash, conns, lastThread: () => [...threads.values()].at(-1) };
}
