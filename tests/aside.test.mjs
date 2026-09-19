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
