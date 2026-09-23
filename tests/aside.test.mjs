import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createAside, validateUrl, replCode, searchUrl, isForeignBrowser } from '../aside.js';

test('the adapter runs Aside by argv only, JSON-encodes URLs, refuses non-http, and labels what a page showed', async () => {
  const calls = [];
  const runner = async (args, timeout) => {
    calls.push({ args, timeout });
    if (args[0] === 'repl') return { stdout: 'noise\n' + JSON.stringify({ title: 'Example', url: 'https://example.com/', text: 'Hello   world ' }) + '\n', stderr: '' };
    return { stdout: 'done', stderr: '' };
  };
  const a = createAside({ runner, account: 'u1' });
  const opened = await a.openUrl('https://example.com');
  assert.equal(opened.browser, 'aside'); assert.equal(opened.title, 'Example');
  assert.deepEqual(calls[0].args.slice(0, 3), ['repl', '--account', 'u1']);
  assert.match(calls[0].args[3], /openTab\("https:\/\/example\.com\/"\)/);
  const read = await a.readPage('https://example.com/a?b=c', { maxChars: 300 });
  assert.equal(read.source, 'Aside browser: https://example.com/'); assert.match(calls[1].args[3], /slice\(0, 300\)/);
  const s = await a.search('build target flaking');
  assert.equal(s.query, 'build target flaking'); assert.match(calls[2].args[3], /duckduckgo\.com\/html\/\?q=build%20target%20flaking/);
  const d = await a.delegate('Check the CI dashboard');
  assert.deepEqual(calls[3].args, ['exec', '--account', 'u1', 'Check the CI dashboard']); assert.equal(d.output, 'done');
  await assert.rejects(a.openUrl('file:///etc/passwd'), /http\(s\) URLs only/);
  await assert.rejects(a.openUrl('javascript:alert(1)'), /http\(s\) URLs only/);
  assert.throws(() => validateUrl('not a url'));
  assert.match(replCode.open('https://x.y/"); process.exit(1); //'), /openTab\("https:\/\/x\.y\/%22\);%20process\.exit\(1\);%20\/\/"\)/, 'a hostile URL stays a string');
  assert.equal(searchUrl('a b'), 'https://duckduckgo.com/html/?q=a%20b');
  for (const b of ['com.apple.Safari', 'company.thebrowser.dia', 'Dia', 'Google Chrome', 'arc', 'org.mozilla.firefox']) assert.equal(isForeignBrowser(b), true, b);
  for (const b of ['com.apple.Notes', 'Xcode', 'Aside', 'com.aside.browser']) assert.equal(isForeignBrowser(b), false, b);
  const missing = createAside({ cli: '/nowhere/aside' });
  assert.equal(missing.available(), false);
  await assert.rejects(missing.openUrl('https://example.com'), /no other browser/);
});

// The constitution of browsing: nothing in the live engine reaches a browser other than Aside.
const FORBIDDEN = [
  [/execSync\(\s*[`'"]open\s+(["'$]|http|-a\s)/, 'the OS `open` command on a URL or app'],
  [/spawn\(\s*['"]open['"]/, 'the OS `open` command'],
  [/['"`]agent-browser['"`]/, 'agent-browser'],
  [/\bplaywright\b|\bpuppeteer\b|chromium/i, 'a headless browser'],
  [/NSWorkspace\.shared\.open\(/, 'NSWorkspace.open (the default browser)'],
  [/open -a\s+["']?(Safari|Google Chrome|Arc|Dia|Firefox)/i, 'launching a system browser'],
];
const SKIP = [/^node_modules\//, /^\.claude\//, /^motor\/skills\//, /^tests\//, /^web\//, /^\.git\//, /^cognitive\//, /^private\//, /^evaluation\/results\//, /\.build\//, /^docs\//, /\.md$/];
async function walk(dir, root) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name), rel = relative(root, p);
    if (SKIP.some(r => r.test(rel))) continue;
    if (e.isDirectory()) out.push(...await walk(p, root));
    else if (/\.(js|mjs|swift)$/.test(e.name)) out.push(rel);
  }
  return out;
}
test('no live module opens, drives, or reads a page through anything but Aside; the legacy skills directory is not loaded', async () => {
  const root = new URL('..', import.meta.url).pathname;
  const files = await walk(root, root);
  const offenders = [];
  for (const f of files) {
    if (f === 'aside.js') continue;
    const src = await readFile(join(root, f), 'utf8');
    for (const [re, what] of FORBIDDEN) if (re.test(src)) offenders.push(`${f}: ${what}`);
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
  // motor/skills holds retired X-posting skills that used other browsers; nothing imports them.
  const importers = [];
  for (const f of files) { const src = await readFile(join(root, f), 'utf8'); if (/motor\/skills\/|hot-loader/.test(src) && f !== 'motor/hot-loader.js') importers.push(f); }
  assert.deepEqual(importers, [], `motor/skills must stay unloaded: ${importers.join(', ')}`);
});

test('the MCP server speaks JSON-RPC over stdio, lists its tools, and answers a call through the adapter', async () => {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [new URL('../aside-mcp.js', import.meta.url).pathname], { env: { ...process.env, OCA_ASIDE_CLI: '/nowhere/aside' } });
  let out = ''; child.stdout.on('data', d => { out += d; });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'aside_read', arguments: { url: 'https://example.com' } } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'aside_pay', arguments: {} } }) + '\n');
  child.stdin.end();
  await new Promise(r => child.on('close', r));
  const msgs = out.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(msgs.find(m => m.id === 1).result.serverInfo.name, 'aside');
  assert.deepEqual(msgs.find(m => m.id === 2).result.tools.map(t => t.name), ['aside_read', 'aside_search', 'aside_snapshot', 'aside_open', 'aside_tabs', 'aside_read_tab', 'aside_snapshot_tab', 'aside_click', 'aside_type', 'aside_select', 'aside_press', 'aside_scroll', 'aside_sign_in', 'aside_do', 'aside_go'], 'look, work, and act through the actuator');
  const read = msgs.find(m => m.id === 3).result;
  assert.equal(read.isError, true); assert.match(read.content[0].text, /no other browser/, 'no Aside installed: no browser, not another one');
  assert.match(msgs.find(m => m.id === 4).error.message, /unknown tool/);
});

test('the tool boundary: looking is free; a committing control is classified for the engine\'s actuator; credentials, uploads and disabled controls never go through a click', async () => {
  const { interactionPolicy, commitClass, ASIDE_TOOL_NAMES } = await import('../aside-mcp.js');
  const { ASIDE_MCP_TOOLS } = await import('../codex-cli.js');
  assert.deepEqual(ASIDE_MCP_TOOLS, ASIDE_TOOL_NAMES, 'Codex pre-approves exactly the tools the server offers');
  for (const t of ['aside_sign_in', 'aside_do']) assert.ok(ASIDE_TOOL_NAMES.includes(t), t);
  const view = (kind, c) => { const p = interactionPolicy(kind, c); assert.equal(p.allowed, true, `${kind} ${JSON.stringify(c)}`); assert.equal(p.commit, undefined, `${kind} ${JSON.stringify(c)} is a view action`); };
  const commits = (kind, c, cls) => { const p = interactionPolicy(kind, c); assert.equal(p.allowed, true, `${kind} ${JSON.stringify(c)}`); assert.equal(p.commit, cls, `${kind} ${JSON.stringify(c)}`); };
  const no = (kind, c, why) => { const p = interactionPolicy(kind, c); assert.equal(p.allowed, false, `${kind} ${JSON.stringify(c)}`); if (why) assert.match(p.why, why); };
  // looking: pickers, filters, presets, tabs, pagination, dialogs about the view — no decision needed
  view('click', { role: 'button', name: '6–12 Sep' }); view('click', { role: 'button', name: 'Last 30 days' }); view('click', { role: 'button', name: 'Apply' });
  view('click', { role: 'button', name: 'Add filter' }); view('click', { role: 'button', name: 'Remove filter' }); view('click', { role: 'button', name: 'Clear date range' });
  view('click', { role: 'button', name: 'Close dialog' }); view('click', { role: 'button', name: 'close' }); view('click', { role: 'button', name: 'Cancel' }); view('click', { role: 'button', name: '×' }); view('click', { role: 'tab', name: 'Trends' }); view('click', { role: 'link', name: 'Next page', href: '/reports?page=2' });
  view('click', { role: 'checkbox', name: 'Premium Purchased' }); view('click', { role: 'option', name: 'August' }); view('click', { role: 'button', name: 'Show more' });
  // committing: classified for the actuator, never silently done
  commits('click', { role: 'button', name: 'Share' }, 'publish'); commits('click', { role: 'button', name: 'Post' }, 'publish'); commits('click', { role: 'button', name: 'Publish' }, 'publish');
  commits('click', { role: 'button', name: 'Save as cohort' }, 'submit'); commits('click', { role: 'button', name: 'Download CSV' }, 'submit'); commits('click', { role: 'button', name: 'Create Reports' }, 'submit');
  commits('click', { role: 'button', name: 'Pay now' }, 'spend'); commits('click', { role: 'button', name: 'Boost post' }, 'spend');
  commits('click', { role: 'button', name: 'Delete dashboard' }, 'destroy'); commits('click', { role: 'button', name: 'Close account' }, 'destroy'); commits('click', { role: 'button', name: 'Cancel subscription' }, 'destroy'); commits('click', { role: 'link', name: 'Sign out', href: '/logout' }, 'destroy');
  commits('click', { role: 'button', name: 'Send' }, 'message');
  commits('click', { role: 'button', name: 'Continue', submit: true, inForm: true }, 'submit');
  assert.equal(commitClass('Reply'), 'publish'); assert.equal(commitClass('Buy now'), 'spend'); assert.equal(commitClass('Save'), 'submit');
  // never through a click: credential forms (aside_sign_in), file inputs and mailto (aside_do), disabled controls
  no('click', { role: 'button', name: 'Continue', submit: true, inForm: true, formHasCredential: true }, /aside_sign_in/); no('click', { role: 'file', name: 'Upload', inputType: 'file' }, /aside_do/);
  no('click', { role: 'link', name: 'Email us', href: 'mailto:x@y' }, /aside_do/); no('click', { role: 'button', name: 'Apply', disabled: true }, /disabled/);
  // typing: text fields yes; credentials never; Enter on a committing form is classified
  view('type', { role: 'searchbox', name: 'Search events' }); view('type', { role: 'textbox', name: 'Filter' }); view('type', { role: 'combobox', name: 'Event' });
  no('type', { role: 'textbox', name: 'Password', credential: true }, /credential/); no('type', { role: 'textbox', name: 'Card number', credential: true }); no('type', { role: 'button', name: 'x' }, /not a text field/);
  view('enter', { role: 'searchbox', name: 'Search', inForm: true, formSubmitName: 'Search' }); no('enter', { role: 'textbox', name: 'Email', inForm: true, formHasCredential: true }, /aside_sign_in/);
  commits('enter', { role: 'textbox', name: 'Message', inForm: true, formSubmitName: 'Send' }, 'message');
  view('select', { role: 'combobox', name: 'Interval', tag: 'select' }); no('select', { role: 'combobox', name: 'Interval', tag: 'div' }, /click the option/);
});

test('a retry refusal stops Aside delegation, forwards recovery evidence, and leaves discovery ungated', async () => {
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, body: JSON.parse(body) });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ decision: 'refuse', why: 'Retry suppressed after stored mobile-only failure; read-only discovery remains allowed.' }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const child = spawn(process.execPath, [new URL('../aside-mcp.js', import.meta.url).pathname], { env: { ...process.env,
      OCA_ENGINE_URL: `http://127.0.0.1:${server.address().port}`, OCA_ASIDE_CLI: '/nowhere/aside' } });
    let out = ''; child.stdout.on('data', d => { out += d; });
    const retryEvidence = { source: 'https://www.instagram.com/getinnerecho/', quote: 'The profile editor is available through a supported mobile route.' };
    for (const [id, name, args] of [
      [1, 'aside_do', { pursuit: 27, class: 'submit', task: 'Update the @getinnerecho profile website link.', url: retryEvidence.source, retryEvidence }],
      [2, 'aside_read', { url: retryEvidence.source }],
    ]) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n');
    child.stdin.end(); await new Promise(r => child.on('close', r));
    const messages = out.trim().split('\n').map(l => JSON.parse(l));
    const commit = JSON.parse(messages.find(m => m.id === 1).result.content[0].text);
    assert.equal(commit.refused, true); assert.match(commit.why, /mobile-only/);
    assert.equal(requests.length, 1, 'no actuator call for read-only discovery and no outcome from a refused delegation');
    assert.equal(requests[0].path, '/oca/act/authorize');
    assert.deepEqual(requests[0].body.retryEvidence, retryEvidence);
    assert.match(messages.find(m => m.id === 2).result.content[0].text, /no other browser/, 'read reached the browser adapter independently of retry suppression');
  } finally { await new Promise(r => server.close(r)); }
});
