// OCA Motor Skill: Browser — all web interaction via agent-browser CLI
import { execSync } from 'child_process';
import { emit } from '../../event-bus.js';

const PROFILE = '/Users/quinnodonnell/.openclaw/workspace/oneiro-core/private/browser-profile';
const SESSION = 'oca';
const STEALTH_ARGS = '--disable-blink-features=AutomationControlled';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function ab(cmd, { timeout = 30000 } = {}) {
  return execSync(`agent-browser ${cmd} --session ${SESSION} --profile "${PROFILE}" --args "${STEALTH_ARGS}" --user-agent "${USER_AGENT}"`, {
    encoding: 'utf-8',
    timeout,
    env: { ...process.env, AGENT_BROWSER_SESSION: SESSION },
  }).trim();
}

export function open(url, opts = {}) {
  return ab(`open "${url}"`, opts);
}

export function search(query) {
  const encoded = encodeURIComponent(query);
  return ab(`open "https://www.google.com/search?q=${encoded}"`);
}

export function click(selector) {
  return ab(`click "${selector}"`);
}

export function type(selector, text) {
  return ab(`type "${selector}" "${text.replace(/"/g, '\\"')}"`);
}

export function fill(selector, text) {
  return ab(`fill "${selector}" "${text.replace(/"/g, '\\"')}"`);
}

export function press(key) {
  return ab(`press "${key}"`);
}

export function snapshot(opts = {}) {
  const flags = [opts.interactive ? '-i' : '', opts.compact ? '-c' : ''].filter(Boolean).join(' ');
  return ab(`snapshot ${flags}`);
}

export function screenshot(path) {
  return ab(path ? `screenshot "${path}"` : 'screenshot');
}

export function getText(selector) {
  return ab(`get text "${selector}"`);
}

export function getUrl() {
  return ab('get url');
}

export function wait(selectorOrMs) {
  return ab(`wait ${selectorOrMs}`, { timeout: 60000 });
}

export function evaluate(js) {
  return ab(`eval "${js.replace(/"/g, '\\"')}"`, { timeout: 15000 });
}

export function scrollTo(selector) {
  return ab(`scrollintoview "${selector}"`);
}

export function close() {
  try { return ab('close'); } catch { return 'already closed'; }
}

export default {
  open, search, click, type, fill, press, snapshot, screenshot,
  getText, getUrl, wait, evaluate, scrollTo, close,
  PROFILE, SESSION,
};
