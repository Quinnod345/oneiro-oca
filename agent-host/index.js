// The engine's agent host: one interface over two places an agent can live.
//   codex  the engine's own `codex app-server` — every work agent (research, builder, executor). Fast, with the
//          engine's tools (Aside, Apple); each agent is a named Codex thread that shows up in Codex.
//   t3     T3 Code — the conversation for each pursuit (the talker), so Quinn talks to the engine in T3 Code;
//          T3 runs it on Codex, so it shows up in Codex too.
// A session is placed when it is created (by its kind, OCA_T3_KINDS, default "talker") and stays where it was put.
// If T3 Code is not running, a conversation is placed on Codex instead, so nothing waits on a desktop app.
import { readFile } from 'node:fs/promises';
import { createCodexHost } from './codex-host.js';
import { createT3Host } from './t3-host.js';

const KINDS = ['research', 'talker', 'builder', 'executor'];
export const kindOfKey = key => (String(key).match(/-(research|talker|builder|executor)-/) || [])[1] || null;

export function createAgentHost({ pool, codex = null, t3 = null, t3Kinds = (process.env.OCA_T3_KINDS ?? 'talker').split(',').map(s => s.trim()).filter(Boolean),
  log = console, ...options } = {}) {
  codex ||= createCodexHost({ pool, log, ...options });
  t3 ||= process.env.OCA_T3 === 'off' ? null : createT3Host({ pool, log });
  const hosts = { codex, ...(t3 ? { t3 } : {}) };

  async function init() {
    await pool.query(await readFile(new URL('../migrations/068_agent_host.sql', import.meta.url), 'utf8'));
    await codex.init();
    if (t3) await t3.init().catch(e => log.warn?.('[agents] T3 Code project:', e.message));
  }
  const hostOfSession = async key => {
    const { rows: [r] } = await pool.query('SELECT host FROM agent_threads WHERE session_key = $1', [key]);
    return hosts[r?.host] || codex;
  };
  const hostOfRun = async runId => {
    const { rows: [r] } = await pool.query('SELECT host FROM agent_runs WHERE run_id = $1', [runId]);
    return hosts[r?.host] || codex;
  };

  async function createSession(opts) {
    const kind = opts.kind || kindOfKey(opts.key);
    if (kind && !KINDS.includes(kind)) throw new Error(`unknown agent kind ${kind}`);
    const wantsT3 = t3 && kind && t3Kinds.includes(kind);
    const host = wantsT3 && (await t3.available().catch(() => false)) ? t3 : codex;
    const r = await host.createSession(opts);
    return { ...r, host: host.kind };
  }

  return {
    kind: 'router', hosts,
    init,
    // Agents need Codex; T3 Code only carries conversations and is optional.
    available: opts => codex.available(opts),
    createSession,
    turn: async opts => (await hostOfSession(opts.sessionKey)).turn(opts),
    wait: async (runId, opts) => (await hostOfRun(runId)).wait(runId, opts),
    transcript: async (key, opts) => (await hostOfSession(key)).transcript(key, opts),
    history: async key => (await hostOfSession(key)).history(key),
    abort: async key => (await hostOfSession(key)).abort(key),
    reset: async key => (await hostOfSession(key)).abort(key),
    threadOf: async key => (await hostOfSession(key)).threadOf(key),
    hostOf: async key => (await hostOfSession(key)).kind,
    // Where Quinn can open a session: T3 Code's link for a conversation, Codex's resume command for a work agent.
    async link(key) {
      const h = await hostOfSession(key);
      if (h.kind === 't3') return { app: 'T3 Code', url: await h.link(key), threadId: await h.threadOf(key) };
      const id = await h.threadOf(key);
      return id ? { app: 'Codex', command: `codex resume ${id}`, threadId: id } : null;
    },
    async sessions(opts) {
      const out = await codex.sessions(opts);
      if (t3 && await t3.available().catch(() => false)) out.push(...await t3.sessions(opts).catch(e => { log.warn?.('[agents] T3 sessions:', e.message); return []; }));
      return out;
    },
    status: () => ({ codex: codex.status(), t3: t3 ? t3.status() : { up: false, why: 'off' } }),
    close: async () => { await codex.close(); await t3?.close?.(); },
  };
}
