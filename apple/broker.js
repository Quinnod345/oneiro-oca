// The engine's hand on Apple. App Store Connect, Apple Ads and the App Store Server API are reached only through
// the Apple broker (apple-broker/ in the Oneiro app repo). The broker is a separate program that runs as its own
// macOS account, holds the only copies of the keys, and decides every write: dry-run by default, Quinn's approval
// where it counts, hard Apple Ads caps. The engine sends it one request as JSON and gets Apple's answer, or the
// broker's decision, back. It never sees a key or a token.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export const BROKER_BIN = process.env.OCA_APPLE_BROKER || '/usr/local/libexec/oneiro-apple/oneiro-apple';
export const BROKER_ACCOUNT = '_oneiroapple';
export const NOT_INSTALLED = 'the Apple broker is not installed yet (run apple-broker/install.sh in the Oneiro app repo)';

// `sudo -n -u _oneiroapple oneiro-apple …`. The no-password rule covers only the broker's engine commands, so
// anything else fails here instead of waiting on a password prompt nobody will answer.
export function sudoRun(bin, args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/sudo', ['-n', '-u', BROKER_ACCOUNT, bin, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`the Apple broker took longer than ${Math.round(timeoutMs / 1000)}s`)); }, timeoutMs);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); resolve({ stdout, stderr, code }); });
    child.stdin.end(input ?? '');
  });
}

export function createAppleBroker({ bin = BROKER_BIN, run = sudoRun, installed = () => existsSync(bin), timeoutMs = 300_000 } = {}) {
  async function invoke(args, input = null) {
    if (!installed()) return { ok: false, decision: 'error', error: NOT_INSTALLED };
    const { stdout, stderr } = await run(bin, args, input, timeoutMs);
    const text = String(stdout).trim();
    if (text.startsWith('-----BEGIN PUBLIC KEY-----')) return { ok: true, publicKey: text };
    const line = text.split('\n').filter(Boolean).pop() || '';
    try { return JSON.parse(line); }
    catch { return { ok: false, decision: 'error', error: `the Apple broker answered without JSON: ${String(stderr || stdout).trim().slice(0, 300)}` }; }
  }
  const flags = o => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').flatMap(([k, v]) => [`--${k}`, String(v)]);
  return {
    installed,
    /** One request to Apple: { api: 'asc'|'ads'|'storekit', method, path, query, body, reason, chainId, approval }. */
    call: request => invoke(['call'], JSON.stringify(request)),
    status: () => invoke(['status']),
    journal: () => invoke(['journal']),
    verify: () => invoke(['verify']),
    reconcile: () => invoke(['reconcile']),
    /** First-time Apple Ads setup: makes the key pair once and returns only its public half. */
    adsKeygen: () => invoke(['ads-keygen']),
    /** Fills Apple Ads IDs that aren't set yet; changing a set one is Quinn's. */
    adsConfigure: ({ clientId, teamId, keyId, adAccountId } = {}) =>
      invoke(['ads-configure', ...flags({ 'client-id': clientId, 'team-id': teamId, 'key-id': keyId, 'ad-account-id': adAccountId })]),
    // The month's Apple Ads commitment (actual spend plus every enabled daily budget for the days left), for the
    // charter's shared spending limit. Zero before the broker exists. An installed broker that can't answer throws,
    // so the limit is treated as unknown rather than quietly leaving Apple out.
    async committedSpend() {
      if (!installed()) return 0;
      const s = await invoke(['status']);
      if (!s.ok) throw new Error(s.error || 'the Apple broker could not report its spend');
      return Number(s.ads?.committed) || 0;
    },
  };
}
