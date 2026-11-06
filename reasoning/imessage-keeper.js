import { imessageHost as configuredHost } from './local-config.js';
// Keeps the iMessage line to Quinn honest. Oneiro texts him from Messages on the work Mac, which is signed in as his
// gmail account and driven over SSH (channels/imessage.js), so his phone sees a real conversation with Oneiro. When
// that Mac sleeps or drops off Tailscale, texts can't go out and his replies can't be read.
//
// Every few minutes this checks the line. If it has been down for ten minutes, Quinn hears it once with a Mac
// notification: texts are paused, and asks come as notifications and in the app until the line is back. A second
// notification tells him when texts work again. While the line is down, asks skip iMessage instead of waiting on it.
//
// Nothing is ever sent from this Mac's own Messages instead. This Mac is signed into his iCloud account, so a text
// from here lands in his own thread: nobody answers it, and his phone shows it twice (Quinn, 2026-10-01).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { connect } from 'node:net';

const text = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const PAUSED_TITLE = 'Texts are paused';
export const BACK_TITLE = 'Texts are back';
export const PAUSED_BODY = 'Your work Mac is offline, so Oneiro can’t text you. Until it’s back, asks come as notifications here: open Oneiro to answer them.';
export const BACK_BODY = 'Your work Mac is back, so Oneiro texts you from it again.';

// Whether a host accepts a TCP connection on a port: SSH answering means the work Mac is awake and on Tailscale.
// It only opens and closes the socket, so nothing runs on that Mac.
export function portOpen(host, port = 22, timeoutMs = 6000) {
  return new Promise(resolve => {
    const socket = connect({ host, port });
    const done = ok => { socket.removeAllListeners(); socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

// The work Mac's host name (the SSH target in OCA_IMESSAGE_HOST, user@host).
export function imessageHost(remote = configuredHost()) {
  return remote ? String(remote).split('@').pop() : null;
}

export function createImessageKeeper({ line, reachable, tell: notify, statePath, clock = Date.now, log = console,
  tickMs = 180_000, pausedAfterMs = 600_000 } = {}) {
  let state = null, up = null, timer = null, ticking = false;

  async function load() { try { return JSON.parse(await readFile(statePath, 'utf8')) || {}; } catch { return {}; } }
  async function save() { await mkdir(dirname(statePath), { recursive: true }); await writeFile(statePath, JSON.stringify(state)); }

  async function tell(title, body) {
    try { await notify({ title, body }); return true; }
    catch (e) { log.warn?.(`[imessage] couldn't tell Quinn "${title}":`, text(e.message, 160)); return false; }
  }

  // One pass. Returns what it did: 'up', 'back', 'paused' (Quinn told), 'down', or 'busy'.
  async function tick() {
    if (ticking) return 'busy'; ticking = true;
    try {
      if (state === null) state = await load();
      const live = await line().catch(() => false);
      const now = clock();
      if (live) {
        up = true;
        if (state.downSince == null) return 'up';
        log.log?.(`[imessage] texts work again after ${Math.round((now - state.downSince) / 60_000)} min down`);
        if (state.pausedAt != null) await tell(BACK_TITLE, BACK_BODY);
        state = {}; await save();
        return 'back';
      }
      up = false;
      if (state.downSince == null) {
        state.downSince = now; await save();
        const mac = await reachable().catch(() => false);
        log.warn?.(`[imessage] the line is down: ${mac ? 'the work Mac answers, but Messages there could not be read' : 'the work Mac is unreachable'}`);
      }
      if (state.pausedAt != null || now - state.downSince < pausedAfterMs) return 'down';
      if (!(await tell(PAUSED_TITLE, PAUSED_BODY))) return 'down';
      state.pausedAt = now; await save();
      log.log?.('[imessage] texts are paused; told Quinn on the Mac');
      return 'paused';
    } finally { ticking = false; }
  }

  function start() { if (!timer) { tick().catch(() => {}); timer = setInterval(() => { tick().catch(e => log.warn?.('[imessage] tick:', text(e.message, 160))); }, tickMs); timer.unref?.(); } }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  // Whether texting can work right now. Unknown counts as yes, so a send is still tried before the first read.
  return { tick, start, stop, ready: () => up !== false };
}
