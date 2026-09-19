#!/usr/bin/env node
// Aside, as a read-only MCP tool server for the engine's Codex slices. A slice runs inside Codex's command
// sandbox, which cannot reach the Aside app; an MCP server is spawned by Codex itself, outside that sandbox,
// so this is how a slice reads the web through the engine's one browser. Read-only by construction: it can
// open, read, snapshot and search pages and list tabs; it cannot click, type, or post. Acting on the world
// stays with the risk gate.
//
// Protocol: MCP over stdio, newline-delimited JSON-RPC 2.0 (initialize, tools/list, tools/call, ping).
import { createInterface } from 'node:readline';
import { createAside, validateUrl } from './aside.js';

const aside = createAside();
const MAX = n => Math.max(200, Math.min(60000, Number(n) || 6000));

const TOOLS = [
  { name: 'aside_read', description: 'Read the visible text of a web page through Aside, the only browser. Returns title, final URL and text. Read-only.',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'http(s) URL' }, maxChars: { type: 'integer', description: 'text budget, default 6000' } }, required: ['url'], additionalProperties: false } },
  { name: 'aside_search', description: 'Web search through Aside (DuckDuckGo results page as text). Read-only.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, maxChars: { type: 'integer' } }, required: ['query'], additionalProperties: false } },
  { name: 'aside_snapshot', description: 'Accessibility snapshot of a page through Aside: the structural tree (headings, links, buttons, fields) as text. Read-only.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, maxChars: { type: 'integer' } }, required: ['url'], additionalProperties: false } },
  { name: 'aside_open', description: 'Open a page in Aside so the person can see it; returns its title. Read-only.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false } },
  { name: 'aside_tabs', description: 'List the tabs open in Aside (title and URL). Read-only.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];

async function call(name, args = {}) {
  switch (name) {
    case 'aside_read': { const r = await aside.readPage(validateUrl(args.url), { maxChars: MAX(args.maxChars) }); return { title: r.title, url: r.url, source: r.source, text: r.text }; }
    case 'aside_search': { const r = await aside.search(String(args.query || '').slice(0, 400), { maxChars: MAX(args.maxChars) }); return { query: r.query, url: r.url, source: r.source, text: r.text }; }
    case 'aside_snapshot': {
      const url = validateUrl(args.url), max = MAX(args.maxChars);
      const r = await aside.repl(`const p2 = await openTab(${JSON.stringify(url)}); await p2.waitForLoadState('domcontentloaded').catch(() => {}); const s = await snapshot(p2, { interactive: true }); console.log(JSON.stringify({ title: await p2.title(), url: p2.url(), tree: String(s?.tree ?? s).slice(0, ${max}) }));`);
      if (!r.json) throw new Error(`Aside could not snapshot ${url}: ${(r.stderr || r.stdout).slice(0, 200)}`);
      return { ...r.json, source: `Aside browser: ${r.json.url}` };
    }
    case 'aside_open': { const r = await aside.openUrl(validateUrl(args.url)); return { title: r.title, url: r.url }; }
    case 'aside_tabs': {
      const r = await aside.repl(`const lt2 = await listBrowserTabs(); console.log(JSON.stringify(lt2.map(t => ({ active: t.active, title: t.title, url: t.url }))));`);
      return { tabs: Array.isArray(r.json) ? r.json : [] };
    }
    default: throw new Error(`unknown tool ${name}`);
  }
}

const out = msg => process.stdout.write(JSON.stringify(msg) + '\n');
let pending = 0;   // in-flight tool calls; stdin closing waits for them
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async line => {
  let req; try { req = JSON.parse(line); } catch { return; }
  if (req.id === undefined) return;   // notifications need no reply
  const reply = result => out({ jsonrpc: '2.0', id: req.id, result });
  const fail = (code, message) => out({ jsonrpc: '2.0', id: req.id, error: { code, message } });
  try {
    switch (req.method) {
      case 'initialize': return reply({ protocolVersion: req.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'aside', version: '1.0.0' } });
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: TOOLS });
      case 'tools/call': {
        const { name, arguments: args } = req.params || {};
        if (!TOOLS.some(t => t.name === name)) return fail(-32602, `unknown tool ${name}`);
        pending++;
        try { const result = await call(name, args || {}); return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], isError: false }); }
        catch (e) { return reply({ content: [{ type: 'text', text: `Aside: ${e.message}` }], isError: true }); }
        finally { pending--; }
      }
      default: return fail(-32601, `method not found: ${req.method}`);
    }
  } catch (e) { fail(-32603, e.message); }
});
// When stdin closes, in-flight calls still finish and answer; the process ends when the loop drains.
rl.on('close', () => { const wait = () => (pending > 0 ? setTimeout(wait, 100) : process.exit(0)); wait(); });
