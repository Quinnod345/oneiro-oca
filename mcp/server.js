#!/usr/bin/env node
// The Oneiro engine, as an MCP server: any coding agent Quinn uses (T3 Code, Codex, Claude Code) can see what the
// engine is doing and work with it, without coding inside Oneiro. It talks to the running engine over its HTTP API
// (OCA_ENGINE_URL, default http://localhost:3333) and adds no powers of its own.
//
//   codex mcp add oca -- node /path/to/oca-cognitive/mcp/server.js
//   claude mcp add --scope user oca -- node /path/to/oca-cognitive/mcp/server.js
//
// What a client may do, and what it may not:
// - Read everything the engine shows Quinn: pursuits, agents and their threads, asks, Judge, traces, health.
// - Hand the engine a new want, send an agent off, talk to an agent, answer an ask, record a verdict or progress —
//   always as Quinn's own words, relayed. Every such call is tagged as coming through MCP, so it is never mistaken
//   for something the engine observed itself.
// - Never decide a payment. A payment is decided only by the one-time code Quinn texts back from his phone; this
//   server refuses to answer a payment ask at all.
// The engine's own threads never speak for Quinn through it. Its work agents run without this server
// (agent-host/codex-host.js switches it off), and its conversations run in T3 Code under the engine's workspace.
// Codex starts an MCP server in the thread's own folder, so when this server finds itself in one of the engine's
// folders (OCA_ENGINE_AGENT_DIRS), it offers only the tools that read.
//
// Protocol: MCP over stdio, newline-delimited JSON-RPC 2.0 (initialize, tools/list, tools/call, ping).
import { forOwner } from '../reasoning/local-config.js';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { workspaceDir } from '../reasoning/local-config.js';

export const ENGINE = (process.env.OCA_ENGINE_URL || 'http://localhost:3333').replace(/\/$/, '');
const text = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const VIA = `${process.env.OCA_MCP_CLIENT || 'a coding agent'} (MCP)`;
export const ENGINE_AGENT_DIRS = (process.env.OCA_ENGINE_AGENT_DIRS || workspaceDir()).split(':').filter(Boolean).map(d => d.replace(/\/$/, ''));
export const READ_TOOLS = new Set(['oca_status', 'oca_inbox', 'oca_pursuits', 'oca_pursuit', 'oca_agents', 'oca_agent']);
// Inside one of the engine's own threads: a folder under the engine's workspace.
export const insideEngine = (cwd = process.cwd(), dirs = ENGINE_AGENT_DIRS) => dirs.some(d => cwd === d || cwd.startsWith(`${d}/`));

export function createEngineClient({ base = ENGINE, fetchImpl = fetch, timeoutMs = 30_000 } = {}) {
  async function call(method, path, body) {
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, { method, headers: { 'content-type': 'application/json', connection: 'close' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) { throw new Error(`The Oneiro engine is not reachable at ${base} (${text(e.message, 120)}). Is it running?`); }
    const raw = await res.text();
    let data; try { data = raw ? JSON.parse(raw) : null; } catch { data = { text: raw }; }
    if (!res.ok) throw new Error(`engine ${method} ${path}: ${text(data?.error || raw, 300)} (HTTP ${res.status})`);
    return data;
  }
  return { get: p => call('GET', p), post: (p, b = {}) => call('POST', p, b) };
}

const id = { type: 'integer', minimum: 1 };
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const RELAY = 'Pass only Quinn\'s own words, as he said them; never decide for him.';

export const TOOLS = [
  { name: 'oca_status', description: 'Is the engine up, are its agents able to run (Codex signed in, T3 Code open), and what is it working on.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'oca_inbox', description: 'What the engine has for Quinn: active wants, open asks, deliverables and notes waiting for his verdict (Judge), and what things are worth to it.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'oca_pursuits', description: 'Every pursuit at once: its goal, workstreams, live agents, progress and next step (the orchestrator\'s map).',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'oca_pursuit', description: 'One pursuit in full: goal and done-when, measured progress, milestones, what it set up, its schedule, every agent run, and its trace.',
    inputSchema: { type: 'object', properties: { pursuit: { ...id, description: 'Pursuit (want) id, e.g. 27' }, trace: { type: 'boolean', description: 'Also include the step-by-step trace from the journals' } }, required: ['pursuit'] } },
  { name: 'oca_agents', description: 'The engine\'s agents: research, builder, executor and talker, with status, task, question and report. Each is a Codex thread you can open.',
    inputSchema: { type: 'object', properties: { pursuit: { ...id, description: 'Only this pursuit' }, live: { type: 'boolean', description: 'Only agents still working or waiting' } } } },
  { name: 'oca_agent', description: 'One agent\'s conversation, every message in its thread, and where to open it (T3 Code link or `codex resume <thread>`).',
    inputSchema: { type: 'object', properties: { agent: str('Agent id (uuid)') }, required: ['agent'] } },
  { name: 'oca_conversation', description: 'Open (or find) a pursuit\'s conversation, the engine\'s voice for it, in T3 Code when it is running, and return where to talk.',
    inputSchema: { type: 'object', properties: { pursuit: id }, required: ['pursuit'] } },
  { name: 'oca_draft_want', description: `Hand the engine a loose request ("help me stay in touch with my brother"). It drafts a want (description, done-when, stakes, first evidence) and returns the draft to confirm with oca_confirm_want. ${RELAY}`,
    inputSchema: { type: 'object', properties: { request: str('What Quinn wants, in his words') }, required: ['request'] } },
  { name: 'oca_confirm_want', description: 'Confirm a draft into a want the engine pursues. Only when Quinn has said yes to the draft.',
    inputSchema: { type: 'object', properties: { draft: str('Draft id from oca_draft_want'), description: str('Edited description, if Quinn changed it'), doneWhen: str('Edited done-when, if Quinn changed it'),
      stakes: { type: 'array', description: 'What it is for, from the draft\'s known entities: [{ entityKey, share }]', items: { type: 'object', properties: { entityKey: { type: 'string' }, share: { type: 'number' } }, required: ['entityKey'] } },
      evidenceIds: { type: 'array', description: 'Evidence ids the draft found that Quinn agrees with', items: { type: 'string' } } }, required: ['draft'] } },
  { name: 'oca_say', description: `Say something to one of the engine's agents, as Quinn: an answer to its question, a change of direction. It goes into the agent's thread as his. ${RELAY}`,
    inputSchema: { type: 'object', properties: { agent: str('Agent id (uuid)'), words: str('Quinn\'s words') }, required: ['agent', 'words'] } },
  { name: 'oca_answer_ask', description: `Answer an open ask (a question the engine sent Quinn). It reaches every agent waiting on it. Payments are refused: those are decided only by the code Quinn texts back from his phone. ${RELAY}`,
    inputSchema: { type: 'object', properties: { ask: id, words: str('Quinn\'s answer') }, required: ['ask', 'words'] } },
  { name: 'oca_rate', description: `Record Quinn's verdict on a deliverable or note in Judge: useless, meh, useful or great. A verdict is the engine's only reward, so only ever his. ${RELAY}`,
    inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['artifact', 'note'] }, item: str('Item id from oca_inbox (an artifact is "<want id>/<file>")'), verdict: { type: 'string', enum: ['useless', 'meh', 'useful', 'great'] }, note: str('Why, in his words') }, required: ['kind', 'item', 'verdict'] } },
  { name: 'oca_progress', description: `Record progress Quinn observed on a want: the only thing that satisfies it. ${RELAY}`,
    inputSchema: { type: 'object', properties: { pursuit: id, progress: { type: 'number', minimum: 0, maximum: 1, description: 'How far along, 0 to 1' }, observation: str('What he saw happen'), criterionMet: { type: 'boolean' } }, required: ['pursuit', 'progress', 'observation'] } },
  { name: 'oca_send_agent', description: 'Send an agent off on a pursuit, on Quinn\'s say-so: research (find and verify), executor (act in the world, through the risk gate) or talker.',
    inputSchema: { type: 'object', properties: { pursuit: id, kind: { type: 'string', enum: ['research', 'executor', 'talker'] }, task: str('Exactly what the agent should do') }, required: ['pursuit', 'kind', 'task'] } },
  { name: 'oca_stop_agent', description: 'Stop one of the engine\'s agents now.',
    inputSchema: { type: 'object', properties: { agent: str('Agent id (uuid)') }, required: ['agent'] } },
];

const requireText = (v, name, max = 4000) => { const s = String(v ?? '').trim(); if (!s) throw new Error(`${name} is required`); return s.slice(0, max); };
const requireId = (v, name) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`); return n; };
const requireUuid = (v, name) => { const s = String(v ?? ''); if (!/^[0-9a-f-]{36}$/i.test(s)) throw new Error(`${name} must be an agent id (uuid)`); return s; };

export function createHandlers(engine = createEngineClient()) {
  return {
    async oca_status() {
      const [health, host, inbox] = await Promise.all([engine.get('/oca/health').catch(e => ({ error: e.message })), engine.get('/oca/agent-host').catch(e => ({ error: e.message })), engine.get('/oca/inbox').catch(() => null)]);
      return { engine: ENGINE, health, agents: host, wants: (inbox?.wants || []).map(w => ({ id: w.id, description: w.description, status: w.status, pressure: w.pressure })),
        openAsks: (inbox?.asks || []).length };
    },
    oca_inbox: () => engine.get('/oca/inbox'),
    oca_pursuits: () => engine.get('/oca/orchestra'),
    async oca_pursuit({ pursuit, trace = false }) {
      const n = requireId(pursuit, 'pursuit');
      const full = await engine.get(`/oca/orchestra/${n}`);
      return trace ? { ...full, trace: await engine.get(`/oca/trace/${n}`).catch(e => ({ error: e.message })) } : full;
    },
    oca_agents: ({ pursuit, live } = {}) => engine.get(`/oca/agents?${new URLSearchParams({ ...(pursuit ? { chainId: String(requireId(pursuit, 'pursuit')) } : {}), ...(live ? { live: '1' } : {}) })}`),
    async oca_agent({ agent }) {
      const a = requireUuid(agent, 'agent');
      const [row, messages, link] = await Promise.all([engine.get(`/oca/agents/${a}`), engine.get(`/oca/agents/${a}/messages`).catch(e => ({ error: e.message })), engine.get(`/oca/agents/${a}/link`).catch(() => null)]);
      return { agent: row, open: link, messages: messages?.messages ?? messages };
    },
    async oca_conversation({ pursuit }) {
      const t = await engine.post(`/oca/inbox/want/${requireId(pursuit, 'pursuit')}/talker`);
      const link = t?.id ? await engine.get(`/oca/agents/${t.id}/link`).catch(() => null) : null;
      return { agent: t?.id, status: t?.status, open: link };
    },
    async oca_draft_want({ request }) {
      const r = await engine.post('/oca/inbox/draft', { clientRequestId: randomUUID(), text: requireText(request, 'request', 2000), by: 'quinn' });
      const draftId = r?.id || r?.draftId || r?.draft?.id;
      if (!draftId) return r;
      for (let i = 0; i < 4; i++) {
        const d = await engine.get(`/oca/inbox/draft/${draftId}?wait=25`);
        if (!['drafting', 'pending', 'queued'].includes(d?.status)) return d;
      }
      return { draftId, status: 'drafting', note: 'Still drafting; call oca_inbox or try oca_confirm_want later.' };
    },
    oca_confirm_want: ({ draft, description, doneWhen, stakes, evidenceIds }) => engine.post('/oca/inbox/want', { draftId: requireText(draft, 'draft', 80),
      ...(description ? { description: text(description, 2000) } : {}), ...(doneWhen ? { doneWhen: text(doneWhen, 1000) } : {}),
      ...(Array.isArray(stakes) ? { stakes: stakes.slice(0, 8) } : {}), ...(Array.isArray(evidenceIds) ? { evidenceIds: evidenceIds.slice(0, 20).map(String) } : {}), by: 'quinn' }),
    oca_say: ({ agent, words }) => engine.post(`/oca/agents/${requireUuid(agent, 'agent')}/say`, { text: requireText(words, 'words'), via: VIA }),
    async oca_answer_ask({ ask, words }) {
      const n = requireId(ask, 'ask');
      const inbox = await engine.get('/oca/inbox');
      const a = (inbox?.asks || []).find(x => Number(x.id) === n);
      if (!a) throw new Error(`ask #${n} is not open`);
      if (a.payment) throw new Error(`ask #${n} is a payment. Payments are decided only by the APPROVE/DENY code Quinn texts back from his phone; nothing here can answer it.`);
      if (a.kind === 'finish') throw new Error(`ask #${n} asks whether a pursuit is finished. Only Quinn can say so, by replying to its text or in the Oneiro app; nothing here can answer it.`);
      return engine.post(`/oca/inbox/asks/${n}/answer`, { reply: requireText(words, 'words', 500), via: VIA });
    },
    oca_rate: ({ kind, item, verdict, note = '' }) => {
      if (!['artifact', 'note'].includes(kind)) throw new Error('kind is artifact or note');
      if (!['useless', 'meh', 'useful', 'great'].includes(verdict)) throw new Error('verdict is useless, meh, useful or great');
      return engine.post('/oca/inbox/rate', { kind, id: requireText(item, 'item', 300), usefulness: verdict, note: text(note, 1000), by: 'quinn', via: VIA });
    },
    oca_progress: ({ pursuit, progress, observation, criterionMet }) => {
      const p = Number(progress); if (!(p >= 0 && p <= 1)) throw new Error('progress is between 0 and 1');
      return engine.post('/oca/inbox/progress', { chainId: requireId(pursuit, 'pursuit'), progress: p, observation: `${requireText(observation, 'observation', 1500)} (relayed via ${VIA})`, ...(typeof criterionMet === 'boolean' ? { criterionMet } : {}) });
    },
    oca_send_agent: ({ pursuit, kind, task }) => {
      if (!['research', 'executor', 'talker'].includes(kind)) throw new Error('kind is research, executor or talker');
      return engine.post(`/oca/inbox/want/${requireId(pursuit, 'pursuit')}/deploy`, { kind, task: requireText(task, 'task', 3000) });
    },
    oca_stop_agent: ({ agent }) => engine.post(`/oca/agents/${requireUuid(agent, 'agent')}/cancel`),
  };
}

export async function handle(req, handlers = createHandlers(), { engineThread = insideEngine() } = {}) {
  const reply = result => ({ jsonrpc: '2.0', id: req.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: req.id, error: { code, message } });
  switch (req.method) {
    case 'initialize': return reply({ protocolVersion: req.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'oca', title: 'Oneiro engine', version: '1.0.0' },
      instructions: 'The Oneiro engine (OCA): wants, agents, asks and verdicts. Read freely. Anything that speaks for Quinn must carry his own words. Payments are never decided here.' });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: JSON.parse(forOwner(JSON.stringify(engineThread ? TOOLS.filter(t => READ_TOOLS.has(t.name)) : TOOLS))) });
    case 'tools/call': {
      const name = req.params?.name, h = handlers[name];
      if (!h) return fail(-32602, `unknown tool ${name}`);
      if (engineThread && !READ_TOOLS.has(name)) return reply({ content: [{ type: 'text', text: 'This is one of the engine\'s own threads: it can read the engine here, but it can\'t speak or act for Quinn.' }], isError: true });
      try {
        const out = await h(req.params?.arguments || {});
        return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 1).slice(0, 200_000) }], structuredContent: out && typeof out === 'object' && !Array.isArray(out) ? out : { result: out } });
      } catch (e) { return reply({ content: [{ type: 'text', text: e.message }], isError: true }); }
    }
    default: return req.id === undefined ? null : fail(-32601, `method not found: ${req.method}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const handlers = createHandlers();
  const context = { engineThread: insideEngine() };
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async line => {
    let req; try { req = JSON.parse(line); } catch { return; }
    const res = await handle(req, handlers, context);
    if (res) process.stdout.write(JSON.stringify(res) + '\n');
  });
}
