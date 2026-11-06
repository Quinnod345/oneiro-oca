#!/usr/bin/env node
// Live, end to end, with no OpenClaw: the real Codex app-server, the real T3 Code app, the real MCP server, the engine's
// own agent runtime, in a private database schema. It spends a little ChatGPT-subscription usage and leaves the
// threads it made in Codex and in T3 Code's "Oneiro engine" project, each titled "[eval] …".
//   OCA_TEST_DATABASE_URL=postgres://localhost/oneiro_test node evals/openclaw-removal/live-eval.mjs
//
// What it checks:
//  1. a research agent runs as a Codex thread on the engine's app-server and finishes with verified evidence;
//  2. that thread is in Codex's own index (so Codex and `codex resume` see it), named for the engine;
//  3. an agent that needs Quinn gets its question into the pursuit's conversation, a T3 Code thread on Codex;
//  4. Quinn's answer written in T3 Code reaches the waiting agent, which finishes with it;
//  5. the MCP server reads the agents, their threads and where to open them, and is read-only inside an engine folder.
import pg from 'pg';
import express from 'express';
import { randomBytes } from 'node:crypto';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createAgents } from '../../reasoning/agents.js';
import { createAsks } from '../../reasoning/asks.js';
import { createInbox } from '../../reasoning/inbox.js';
import { createPonderQueue } from '../../reasoning/ponder-queue.js';
import { createWorthLedger } from '../../motivation/worth-ledger.js';
import { createRiskJournal } from '../../motivation/risk-journal.js';
import { createAgentHost } from '../../agent-host/index.js';
import { createCodexHost } from '../../agent-host/codex-host.js';
import { createT3Host, T3_PROJECT_DIR, runT3 } from '../../agent-host/t3-host.js';

const ROOT = new URL('../..', import.meta.url).pathname;
const t0 = Date.now(); const at = () => Math.round((Date.now() - t0) / 100) / 10;
const results = { startedAt: new Date().toISOString(), checks: {}, timings: {} };
const check = (name, ok, detail = null) => { results.checks[name] = { ok: Boolean(ok), ...(detail !== null ? { detail } : {}) }; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== null ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); };
const until = async (label, fn, { timeoutMs = 8 * 60_000, everyMs = 3000 } = {}) => {
  const end = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v) { results.timings[label] = at(); return v; } if (Date.now() > end) { results.timings[label] = null; return null; } await new Promise(r => setTimeout(r, everyMs)); }
};

const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro_test';
const schema = 'live_eval_' + randomBytes(5).toString('hex');
const admin = new pg.Pool({ connectionString: dsn });
await admin.query('CREATE SCHEMA ' + schema);
const pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema + ',public' });
const quiet = { log: (...a) => process.env.EVAL_VERBOSE && console.log(...a), warn: (...a) => process.env.EVAL_VERBOSE && console.warn(...a) };
let host, server;
try {
  await pool.query(`CREATE TABLE thought_chains (id SERIAL PRIMARY KEY, seed TEXT NOT NULL, priority FLOAT8 DEFAULT .5, status TEXT DEFAULT 'pondering', depth INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), ponder_state JSONB)`);
  await pool.query(`CREATE TABLE hypotheses (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(), domain TEXT, claim TEXT, confidence FLOAT8, prediction TEXT, prediction_deadline TIMESTAMPTZ, status TEXT, actual_outcome TEXT, tested_at TIMESTAMPTZ, source_type TEXT, source_data JSONB DEFAULT '{}'::jsonb)`);
  await pool.query(`CREATE TABLE pursuit_work (id UUID PRIMARY KEY, chain_id INT, status TEXT, request_id UUID, created_at TIMESTAMPTZ DEFAULT now())`);
  for (const m of ['057_worth_ledger', '058_risk_decisions', '062_agent_deployments', '064_pursuit_board']) await pool.query(await readFile(join(ROOT, `migrations/${m}.sql`), 'utf8'));

  const dir = await mkdtemp(join(tmpdir(), 'oca-live-eval-'));
  await writeFile(join(dir, 'price.txt'), 'The InnerEcho Premium plan costs $4.99 per month in the US App Store.\n');
  const worth = createWorthLedger({ pool }); await worth.seed();
  const controls = { autonomousActions: false, askOwner: true, agentSlots: 4 };
  const risk = createRiskJournal({ pool, worth, controls: () => controls });
  const queue = createPonderQueue({ pool, reason: async () => ({ status: 'needs_evidence', checkpoint: { version: 1, passes: [] }, missingEvidence: ['the price'] }), worth, risk });
  const asks = createAsks({ pool, risk, log: quiet, notify: false, deliverers: {} }); await asks.init();
  host = createAgentHost({ pool, log: quiet, codex: createCodexHost({ pool, log: quiet, effort: 'low' }), t3: createT3Host({ pool, log: quiet }) });
  await host.init();
  check('codex app-server up and signed in to ChatGPT', await host.available({ force: true }), host.status());
  check('T3 Code running with the "Oneiro engine" project', await host.hosts.t3.available({ force: true }), host.hosts.t3.status());
  const agents = createAgents({ pool, host, queue, risk, asks, controls: { get: async () => controls }, log: quiet, roots: [dir], thinkingLevel: 'low', maxTurns: 6 });
  await agents.init();
  const inbox = createInbox({ pool, queue, worth, workRoot: dir, agents, asks });
  const want = await inbox.want({ description: '[eval] Price InnerEcho Premium (OpenClaw-removal live eval)', doneWhen: 'The price is quoted from a file.' });
  const chainId = want.chain_id;

  // 1–2. a research agent on Codex
  const t1 = Date.now();
  const research = await agents.deploy(chainId, { kind: 'research', firedBy: 'person',
    task: `[eval] Read the file ${join(dir, 'price.txt')} with your shell and report its price. Report done with evidence whose source is that exact absolute path and whose quote is the file's full sentence, copied exactly. Do not browse.` });
  results.timings.researchDeployedMs = Date.now() - t1;
  check('a research agent is deployed as a Codex thread', research?.id && (await host.hostOf(research.sessionKey)) === 'codex', { deployMs: results.timings.researchDeployedMs });
  const done = await until('researchDoneS', async () => { await agents.poll(); const d = await agents.get(research.id); return ['done', 'failed'].includes(d.status) ? d : null; });
  check('it finishes with its evidence verified by the engine', done?.status === 'done' && done.report?.verified?.length >= 1, done ? { status: done.status, verified: done.report?.verified?.length, summary: done.report?.summary, error: done.error } : 'timed out');
  const threadId = await host.threadOf(research.sessionKey);
  const codexRow = threadId ? execFileSync('sqlite3', ['-readonly', '-json', join(homedir(), '.codex/state_5.sqlite'), `select originator, source, thread_source, title, cwd from threads where id='${threadId}'`], { encoding: 'utf8' }) : '[]';
  const row = JSON.parse(codexRow || '[]')[0] || null;
  check('the thread is in Codex\'s own index, as the engine\'s, named for the agent', row && row.originator === 'oca-engine', row);
  const listed = (await host.hosts.codex.sessions()).find(s => s.key === research.sessionKey);
  check('Codex lists it (thread/list), so Codex and `codex resume` see it', Boolean(listed), listed);

  // 3–4. an agent that needs Quinn; the conversation in T3 Code; his answer from T3 Code
  const asker = await agents.deploy(chainId, { kind: 'research', firedBy: 'person',
    task: '[eval] Before anything else, ask the person which App Store region to price InnerEcho in: reply with a needs_person block whose question is exactly "Which App Store region should I price InnerEcho in?". When you have their answer, report done (no evidence needed) with a summary that names the region they chose. Do not browse.' });
  const waiting = await until('askerWaitingS', async () => { await agents.poll(); const d = await agents.get(asker.id); return d.status === 'waiting_person' ? d : (['done', 'failed'].includes(d.status) ? d : null); });
  check('the agent stops and asks Quinn', waiting?.status === 'waiting_person', waiting ? { status: waiting.status, question: waiting.question } : 'timed out');
  const talker = await until('talkerOpenS', async () => (await agents.list({ chainId })).find(x => x.kind === 'talker') || null, { timeoutMs: 60_000, everyMs: 1000 });
  const t3Thread = talker ? await until('talkerThreadS', async () => host.threadOf(talker.sessionKey), { timeoutMs: 120_000 }) : null;
  check('the pursuit\'s conversation is a T3 Code thread', talker && (await host.hostOf(talker.sessionKey)) === 't3' && t3Thread, { talker: talker?.id, thread: t3Thread });
  const posted = t3Thread ? await until('questionPostedS', async () => {
    const s = await runT3(['thread', 'show', t3Thread, '--json', '--messages', '50']);
    return (s.messages || []).some(m => m.role === 'user' && /needs you: Which App Store region/.test(m.text)) ? s : null;
  }, { timeoutMs: 180_000 }) : null;
  check('the agent\'s question is posted in that T3 Code thread', Boolean(posted), posted ? { title: posted.thread.title, provider: posted.thread.providerInstanceId, link: posted.thread.link } : null);
  const t3Row = t3Thread ? JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', join(homedir(), '.codex/state_5.sqlite'), `select originator, cwd from threads where cwd='${T3_PROJECT_DIR}' order by created_at desc limit 1`], { encoding: 'utf8' }) || '[]')[0] : null;
  check('the conversation also shows in Codex (T3 runs it on Codex)', t3Row?.originator === 'T3 Code', t3Row);
  // wait for T3's turn on the note to settle, then answer as Quinn would, in T3 Code
  await until('talkerIdleS', async () => { const s = await runT3(['thread', 'show', t3Thread, '--json', '--messages', '5']); return s.thread.activeRunId ? null : s; }, { timeoutMs: 180_000 });
  await runT3(['thread', 'send', t3Thread, '-', '--json'], { input: 'Use the Canada store.' });
  const answered = await until('askerDoneS', async () => { await agents.poll(); const d = await agents.get(asker.id); return ['done', 'failed'].includes(d.status) ? d : null; });
  check('Quinn\'s answer in T3 Code reaches the waiting agent, which finishes with it', answered?.status === 'done' && /canad/i.test(answered.report?.summary || ''), answered ? { status: answered.status, summary: answered.report?.summary } : 'timed out');
  const relayed = (await host.history(asker.sessionKey)).some(m => m.role === 'user' && /\[Quinn, via the pursuit conversation\] Use the Canada store\./.test(m.text));
  check('his words went into the agent\'s thread as his', relayed);

  // 5. the MCP server over a real HTTP engine API
  const app = express(); app.use(express.json()); app.use(agents.router);
  server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const mcp = async (cwd, calls) => {
    const child = spawn(process.execPath, [join(ROOT, 'mcp/server.js')], { cwd, env: { ...process.env, OCA_ENGINE_URL: base, OCA_ENGINE_AGENT_DIRS: join(homedir(), 'oneiro/runtime/workspace') }, stdio: ['pipe', 'pipe', 'inherit'] });
    const out = []; const rl = createInterface({ input: child.stdout });
    const got = new Promise(resolve => rl.on('line', l => { out.push(JSON.parse(l)); if (out.length === calls.length) resolve(); }));
    calls.forEach((c, i) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i + 1, ...c }) + '\n'));
    await got; child.kill(); return out;
  };
  const [list, one, conv] = await mcp(ROOT, [
    { method: 'tools/call', params: { name: 'oca_agents', arguments: { pursuit: chainId } } },
    { method: 'tools/call', params: { name: 'oca_agent', arguments: { agent: research.id } } },
    { method: 'tools/call', params: { name: 'oca_agent', arguments: { agent: talker?.id } } }]);
  const agentsSeen = JSON.parse(list.result.content[0].text);
  check('MCP lists the pursuit\'s agents', Array.isArray(agentsSeen) && agentsSeen.length >= 3, { count: agentsSeen?.length });
  const oneSeen = one.result.structuredContent;
  check('MCP reads a work agent\'s thread and says how to open it in Codex', oneSeen?.messages?.length >= 2 && /^codex resume /.test(oneSeen?.open?.command || ''), { messages: oneSeen?.messages?.length, open: oneSeen?.open });
  check('MCP gives the T3 Code link for the conversation', /^https:\/\/app\.t3\.codes\/threads\//.test(conv.result.structuredContent?.open?.url || ''), conv.result.structuredContent?.open);
  const [toolsInside] = await mcp(T3_PROJECT_DIR, [{ method: 'tools/list' }]);
  const names = toolsInside.result.tools.map(t => t.name);
  check('inside the engine\'s T3 project, the MCP only reads', !names.includes('oca_answer_ask') && !names.includes('oca_say') && names.includes('oca_agents'), names);
} catch (e) {
  check('the eval ran to the end', false, e.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  results.finishedAt = new Date().toISOString();
  results.passed = Object.values(results.checks).filter(c => c.ok).length;
  results.total = Object.keys(results.checks).length;
  await host?.close().catch(() => {}); server?.close();
  await pool.end(); await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end();
  await writeFile(join(ROOT, 'evals/openclaw-removal/results/live-after.json'), JSON.stringify(results, null, 1));
  console.log(`${results.passed}/${results.total} checks passed in ${at()} s`);
}
