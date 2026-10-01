// Keeps the iMessage line to Quinn honest. Oneiro texts him from Messages on the work Mac, which is signed in as his
// gmail account and driven over SSH, so his phone sees a real conversation with Oneiro. When that Mac sleeps or drops
// off Tailscale, OpenClaw's iMessage channel stops, and after ten failed restarts it can stay down even once the Mac
// is back.
//
// Every few minutes this reads the channel. If it's down while the work Mac's SSH port answers, the channel gets
// restarted. If it's down because the Mac is unreachable, Quinn hears it once on his phone after ten minutes: texts
// are paused, and asks come as notifications and in the app until the Mac is back. A second push tells him when texts
// work again. While the line is down, asks skip iMessage instead of waiting on it.
//
// Nothing is ever sent from this Mac's own Messages instead. This Mac is signed into his iCloud account, so a text
// from here lands in his own thread: nobody answers it, and his phone shows it twice (Quinn, 2026-10-01).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { connect } from 'node:net';

const text = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const PAUSED_TITLE = 'Texts are paused';
export const BACK_TITLE = 'Texts are back';
export const PAUSED_BODY = 'Your work Mac is offline, so Oneiro can’t text you. Until it’s back, asks come here and in the Oneiro app.';
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

// The work Mac's host name, from the iMessage channel's remoteHost (`user@host`) in OpenClaw's config.
export async function imessageHost(configPath = `${process.env.HOME}/.openclaw/openclaw.json`) {
  try {
    const remote = JSON.parse(await readFile(configPath, 'utf8'))?.channels?.imessage?.remoteHost;
    return remote ? String(remote).split('@').pop() : null;
  } catch { return null; }
}

export function createImessageKeeper({ gateway, reachable, push, statePath, clock = Date.now, log = console,
  tickMs = 180_000, pausedAfterMs = 600_000, restartEveryMs = 300_000 } = {}) {
  let state = null, up = null, timer = null, ticking = false;

  async function load() { try { return JSON.parse(await readFile(statePath, 'utf8')) || {}; } catch { return {}; } }
  async function save() { await mkdir(dirname(statePath), { recursive: true }); await writeFile(statePath, JSON.stringify(state)); }

  // The iMessage account as the gateway reports it, or null when no iMessage channel is configured.
  async function channel() {
    const r = await gateway.call('channels.status', {}, { timeout: 30_000 });
    const account = r?.channelAccounts?.imessage?.[0] ?? r?.channels?.imessage ?? null;
    if (!account) return null;
    return { live: account.running === true && account.connected !== false, error: account.lastError || null };
  }

  async function tell(title, body) {
    try { await push({ title, body }); return true; }
    catch (e) { log.warn?.(`[imessage] couldn't tell Quinn "${title}":`, text(e.message, 160)); return false; }
  }

  // One pass. Returns what it did: 'up', 'back', 'restarted', 'paused' (Quinn told), 'down', or 'unknown'.
  async function tick() {
    if (ticking) return 'busy'; ticking = true;
    try {
      if (state === null) state = await load();
      let ch;
      try { ch = await channel(); } catch (e) { log.warn?.('[imessage] channel status unavailable:', text(e.message, 160)); return 'unknown'; }
      if (!ch) { up = null; return 'unknown'; }
      const now = clock();
      if (ch.live) {
        up = true;
        if (state.downSince == null) return 'up';
        log.log?.(`[imessage] texts work again after ${Math.round((now - state.downSince) / 60_000)} min down`);
        if (state.pausedAt != null) await tell(BACK_TITLE, BACK_BODY);
        state = {}; await save();
        return 'back';
      }
      up = false;
      if (state.downSince == null) { state.downSince = now; await save(); log.warn?.(`[imessage] the channel is down: ${text(ch.error, 160)}`); }
      if (await reachable().catch(() => false)) {
        if (state.restartedAt != null && now - state.restartedAt < restartEveryMs) return 'down';
        state.restartedAt = now; await save();
        log.log?.('[imessage] the channel is down but the work Mac answers; restarting the channel');
        await gateway.call('channels.stop', { channel: 'imessage' }, { timeout: 60_000 }).catch(() => {});
        await gateway.call('channels.start', { channel: 'imessage' }, { timeout: 90_000 }).catch(e => log.warn?.('[imessage] restart:', text(e.message, 160)));
        return 'restarted';
      }
      if (state.pausedAt != null || now - state.downSince < pausedAfterMs) return 'down';
      if (!(await tell(PAUSED_TITLE, PAUSED_BODY))) return 'down';
      state.pausedAt = now; await save();
      log.log?.('[imessage] the work Mac is unreachable; told Quinn texts are paused');
      return 'paused';
    } finally { ticking = false; }
  }

  function start() { if (!timer) { tick().catch(() => {}); timer = setInterval(() => { tick().catch(e => log.warn?.('[imessage] tick:', text(e.message, 160))); }, tickMs); timer.unref?.(); } }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  // Whether texting can work right now. Unknown counts as yes, so a send is still tried before the first read.
  return { tick, start, stop, ready: () => up !== false };
}
