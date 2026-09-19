#!/usr/bin/env node
// Aside, as a read-only MCP tool server for the engine's Codex slices. A slice runs inside Codex's command
// sandbox, which cannot reach the Aside app; an MCP server is spawned by Codex itself, outside that sandbox,
// so this is how a slice reads the web through the engine's one browser. Read-only by construction: it can
// open, read, snapshot and search pages and list tabs; it cannot click, type, or post. Acting on the world
// stays with the risk gate.
//
// Protocol: MCP over stdio, newline-delimited JSON-RPC 2.0 (initialize, tools/list, tools/call, ping).
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createAside, validateUrl } from './aside.js';

const aside = createAside();
const MAX = n => Math.max(200, Math.min(60000, Number(n) || 6000));

// A sign-in wall is an observed fact about access, not a guess: the URL or title says so. Reported on the
// result so the engine can ask the person for exactly that, and never inferred from model prose.
const AUTH_URL = /idmsa\.apple\.com|appleid\.apple\.com|accounts\.google\.com|login\.microsoftonline|\/(login|signin|sign-in|sign_in|auth|oauth|sso)(\/|\?|$)/i;
const AUTH_TITLE = /^(sign in|log in|login|sign-in)\b|\b(sign in|log in) to\b|two-factor|verification code/i;
export function accessBlock({ url, title, text }) {
  const u = String(url || ''), t = String(title || ''), body = String(text || '').slice(0, 400);
  if (AUTH_URL.test(u) || AUTH_TITLE.test(t) || /\b(enter your password|sign in with|log in to continue)\b/i.test(body)) {
    let host = ''; try { host = new URL(u).host; } catch {}
    return { kind: 'sign_in', host, url: u, title: t };
  }
  return null;
}
const withBlock = r => { const b = accessBlock(r); return b ? { ...r, accessBlocked: b } : r; };

const TOOLS = [
  { name: 'aside_read', description: 'Read the visible text of a web page through Aside, the only browser. Returns title, final URL and text. Read-only.',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'http(s) URL' }, maxChars: { type: 'integer', description: 'text budget, default 6000' } }, required: ['url'], additionalProperties: false } },
  { name: 'aside_search', description: 'Web search through Aside (DuckDuckGo results page as text). Read-only.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, maxChars: { type: 'integer' } }, required: ['query'], additionalProperties: false } },
  { name: 'aside_snapshot', description: 'Accessibility snapshot of a page through Aside: the structural tree (headings, links, buttons, fields) as text. Read-only.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, maxChars: { type: 'integer' } }, required: ['url'], additionalProperties: false } },
  { name: 'aside_open', description: 'Open a page in Aside so the person can see it; returns its title. Read-only.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false } },
  { name: 'aside_tabs', description: 'List the tabs open in Aside (targetId, title, URL). Read-only.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aside_read_tab', description: 'Read the visible text of a tab the person already has open in Aside (by targetId from aside_tabs) — use this for pages the person set up, like a report with a date range chosen. Read-only.',
    inputSchema: { type: 'object', properties: { targetId: { type: 'string' }, maxChars: { type: 'integer' } }, required: ['targetId'], additionalProperties: false } },
  { name: 'aside_snapshot_tab', description: 'Accessibility snapshot of a tab the person already has open in Aside (by targetId). Read-only.',
    inputSchema: { type: 'object', properties: { targetId: { type: 'string' }, maxChars: { type: 'integer' } }, required: ['targetId'], additionalProperties: false } },
];
const TARGET = /^[A-Za-z0-9_-]{1,80}$/;

async function call(name, args = {}) {
  switch (name) {
    case 'aside_read': { const r = await aside.readPage(validateUrl(args.url), { maxChars: MAX(args.maxChars) }); return withBlock({ title: r.title, url: r.url, source: r.source, text: r.text }); }
    case 'aside_search': { const r = await aside.search(String(args.query || '').slice(0, 400), { maxChars: MAX(args.maxChars) }); return { query: r.query, url: r.url, source: r.source, text: r.text }; }
    case 'aside_snapshot': {
      const url = validateUrl(args.url), max = MAX(args.maxChars);
      const r = await aside.repl(`const p2 = await openTab(${JSON.stringify(url)}); await p2.waitForLoadState('domcontentloaded').catch(() => {}); const s = await snapshot(p2, { interactive: true }); console.log(JSON.stringify({ title: await p2.title(), url: p2.url(), tree: String(s?.tree ?? s).slice(0, ${max}) }));`);
      if (!r.json) throw new Error(`Aside could not snapshot ${url}: ${(r.stderr || r.stdout).slice(0, 200)}`);
      return withBlock({ ...r.json, source: `Aside browser: ${r.json.url}` });
    }
    case 'aside_open': { const r = await aside.openUrl(validateUrl(args.url)); return withBlock({ title: r.title, url: r.url }); }
    case 'aside_tabs': {
      const r = await aside.repl(`const lt2 = await listBrowserTabs(); console.log(JSON.stringify(lt2.map(t => ({ targetId: t.targetId, active: t.active, title: t.title, url: t.url }))));`);
      return { tabs: Array.isArray(r.json) ? r.json : [] };
    }
    case 'aside_read_tab': case 'aside_snapshot_tab': {
      const id = String(args.targetId || ''); if (!TARGET.test(id)) throw new Error('a tab is named by its targetId from aside_tabs');
      const max = MAX(args.maxChars), snap = name === 'aside_snapshot_tab';
      const r = await aside.repl(`const p3 = await attachBrowserTab(${JSON.stringify(id)}); ${snap ? 'const s3 = await snapshot(p3, { interactive: true });' : 'const t3 = await p3.evaluate(() => document.body?.innerText || "");'} console.log(JSON.stringify({ title: await p3.title(), url: p3.url(), ${snap ? 'tree: String(s3?.tree ?? s3)' : 'text: String(t3).replace(/\\s+/g, " ").trim()'}.slice(0, ${max}) }));`);
      if (!r.json) throw new Error(`Aside could not read tab ${id}: ${(r.stderr || r.stdout).slice(0, 200)}`);
      return withBlock({ ...r.json, source: `Aside browser (open tab): ${r.json.url}` });
    }
    default: throw new Error(`unknown tool ${name}`);
  }
}

const out = msg => process.stdout.write(JSON.stringify(msg) + '\n');
let pending = 0;   // in-flight tool calls; stdin closing waits for them
// The server runs only when this file is the program; importing it (tests, the engine) just gets the helpers.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const rl = isMain ? createInterface({ input: process.stdin, crlfDelay: Infinity }) : null;
rl?.on('line', async line => {
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
rl?.on('close', () => { const wait = () => (pending > 0 ? setTimeout(wait, 100) : process.exit(0)); wait(); });
