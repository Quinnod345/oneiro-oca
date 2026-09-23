// The engine's one browser. Every page the engine opens, reads, searches or drives goes through Aside —
// the browser a person authorized for automation. Nothing here ever reaches `open`, NSWorkspace, a
// system browser, a headless one, or agent-browser. If Aside is not installed, the honest answer is
// "no browser", not a different browser.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);
export const ASIDE_CLI = process.env.OCA_ASIDE_CLI || join(homedir(), '.local', 'bin', 'aside');
const DEFAULT_TIMEOUT_MS = 90_000;

export function asideAvailable(cli = ASIDE_CLI) { return existsSync(cli); }

// Only http(s) URLs, and only as data: the URL is JSON-encoded into the REPL code, never interpolated raw.
export function validateUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { throw new Error('a browser opens http(s) URLs only'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('a browser opens http(s) URLs only');
  return u.toString();
}

// Playwright-style code for Aside's REPL. Return values are printed with console.log by convention.
export const replCode = {
  open: url => `const page = await openTab(${JSON.stringify(validateUrl(url))}); await page.waitForLoadState('domcontentloaded').catch(() => {}); console.log(JSON.stringify({ title: await page.title(), url: page.url() }));`,
  read: (url, maxChars = 6000) => `const page = await openTab(${JSON.stringify(validateUrl(url))}); await page.waitForLoadState('domcontentloaded').catch(() => {}); const text = await page.evaluate(() => document.body?.innerText || ''); console.log(JSON.stringify({ title: await page.title(), url: page.url(), text: String(text).replace(/\\s+/g, ' ').trim().slice(0, ${Math.max(200, Math.min(40000, Number(maxChars) || 6000))}) }));`,
};

// Every other browser on this Mac, by bundle id or name. The engine never launches or activates one.
export const FOREIGN_BROWSERS = /^(com\.apple\.Safari|com\.google\.Chrome|com\.google\.Chrome\.canary|org\.chromium\.Chromium|company\.thebrowser\.(Browser|dia)|org\.mozilla\.firefox|com\.microsoft\.edgemac|com\.brave\.Browser|com\.operasoftware\.Opera|com\.vivaldi\.Vivaldi|com\.duckduckgo\.macos\.browser|com\.kagi\.kagimacOS|net\.imput\.orion|com\.sigmaos\.sigmaos)$|^(safari|google chrome|chrome|chromium|arc|dia|firefox|microsoft edge|edge|brave|brave browser|opera|vivaldi|duckduckgo|orion|sigmaos)$/i;
export function isForeignBrowser(appOrBundleId) { return FOREIGN_BROWSERS.test(String(appOrBundleId || '').trim()); }

export function searchUrl(query) { return `https://duckduckgo.com/html/?q=${encodeURIComponent(String(query).slice(0, 400))}`; }

// `runner` is injectable for tests; production runs the CLI with argv, never a shell string.
export function createAside({ cli = ASIDE_CLI, runner = null, timeoutMs = DEFAULT_TIMEOUT_MS, account = process.env.OCA_ASIDE_ACCOUNT || null, log = console } = {}) {
  const exec = runner || (async (args, ms) => {
    const { stdout, stderr } = await run(cli, args, { timeout: ms, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, TERM: 'dumb' } });
    return { stdout: String(stdout || ''), stderr: String(stderr || '') };
  });
  const base = () => (account ? ['--account', account] : []);
  function ensure() { if (!runner && !asideAvailable(cli)) throw new Error(`Aside is not installed at ${cli}; the engine has no other browser`); }
  const lastJson = out => { const lines = String(out).trim().split('\n').reverse(); for (const l of lines) { try { return JSON.parse(l); } catch {} } return null; };

  async function repl(code, { timeout = timeoutMs } = {}) {
    ensure();
    const { stdout, stderr } = await exec(['repl', ...base(), String(code)], timeout);
    return { stdout, stderr, json: lastJson(stdout) };
  }
  // Open a page in Aside so a person can see it; returns its title.
  async function openUrl(url, opts) {
    const r = await repl(replCode.open(url), opts);
    if (!r.json) throw new Error(`Aside did not open ${url}: ${(r.stderr || r.stdout).slice(0, 200)}`);
    return { ok: true, browser: 'aside', ...r.json };
  }
  // Read a page's visible text through Aside; the result is what the page showed, labelled as such.
  async function readPage(url, { maxChars = 6000, ...opts } = {}) {
    const r = await repl(replCode.read(url, maxChars), opts);
    if (!r.json) throw new Error(`Aside could not read ${url}: ${(r.stderr || r.stdout).slice(0, 200)}`);
    return { browser: 'aside', source: `Aside browser: ${r.json.url}`, ...r.json };
  }
  async function search(query, opts) { return { query: String(query), ...(await readPage(searchUrl(query), opts)) }; }
  // Delegate a whole task to Aside's own agent (a subagent with the person's sites and memory).
  // `permission: 'full-access'` lets Aside's agent read local files (an upload); the default Guard asks first.
  async function delegate(task, { timeout = 10 * 60_000, permission = null } = {}) {
    ensure();
    const { stdout } = await exec(['exec', ...base(), ...(permission ? ['--permission', permission] : []), String(task)], timeout);
    return { browser: 'aside', output: String(stdout).trim() };
  }
  return { openUrl, readPage, search, delegate, repl, available: () => (runner ? true : asideAvailable(cli)) };
}

export const aside = createAside();
export default aside;
