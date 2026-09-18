import { execFile } from 'node:child_process';

// Accessors must remain synchronous for callers, but OS queries must never
// block HTTP. One bounded asynchronous refresh serves all channels.
const command = (file, args) => new Promise(resolve => {
  execFile(file, args, { encoding: 'utf8', timeout: 1000, maxBuffer: 65536 }, (error, stdout) => {
    resolve(error ? null : stdout.trim());
  });
});
const script = text => command('/usr/bin/osascript', ['-e', text]);

async function readSystem() {
  const visual = (async () => {
    const [app, apps] = await Promise.all([
      script('tell application "System Events" to get name of first application process whose frontmost is true'),
      script('tell application "System Events" to get name of every application process whose background only is false')
    ]);
    const title = app ? await script('tell application "System Events" to get title of front window of application process ' + JSON.stringify(app)) : null;
    return { frontApp: app || 'unknown', windowTitle: title || '', runningApps: apps?.split(', ').filter(Boolean) || [] };
  })();
  const audio = (async () => {
    const [playing, volume, muted] = await Promise.all([
      script('if application "Music" is running then tell application "Music" to if player state is playing then return (name of current track) & " - " & (artist of current track)'),
      script('output volume of (get volume settings)'), script('output muted of (get volume settings)')
    ]);
    return { now_playing: playing || null, volume: volume !== null && Number.isFinite(Number(volume)) ? Number(volume) : null,
      muted: muted === 'true' ? true : muted === 'false' ? false : null };
  })();
  const proprio = (async () => {
    const [clipboard, uptime] = await Promise.all([command('/usr/bin/pbpaste', []), command('/usr/bin/uptime', [])]);
    return { clipboard: clipboard?.slice(0, 200) ?? null, network: { wifi: 'unknown' }, uptime: uptime ?? 'unknown' };
  })();
  const activity = command('/usr/sbin/ioreg', ['-c', 'IOHIDSystem']).then(output => {
    const match = output?.match(/HIDIdleTime\"?\s*=\s*(\d+)/);
    return { idleSeconds: match ? Number(match[1]) / 1e9 : null };
  });
  const [visualState, auditory, proprioceptive, userActivity] = await Promise.all([visual, audio, proprio, activity]);
  return { visual: visualState, auditory, proprioceptive, activity: userActivity };
}

export function createFallbackReader({ read = readSystem, now = Date.now, refreshMs = 5000, staleMs = 30000 } = {}) {
  let snapshot = null, observedAt = null, attemptedAt = -Infinity, pending = null;
  const refresh = () => {
    if (pending || now() - attemptedAt < refreshMs) return;
    attemptedAt = now();
    pending = Promise.resolve().then(read).then(value => {
      if (value && typeof value === 'object') { snapshot = value; observedAt = now(); }
    }).catch(() => {}).finally(() => { pending = null; });
  };
  return {
    get(channel) {
      refresh();
      const fresh = observedAt !== null && now() - observedAt >= 0 && now() - observedAt <= staleMs;
      return fresh && snapshot?.[channel] ? { ...snapshot[channel], source: 'fallback_commands', timestamp: new Date(observedAt).toISOString() } : null;
    },
    // Exposed to verification, never awaited by perception or HTTP accessors.
    settled: () => pending ?? Promise.resolve()
  };
}

const fallback = createFallbackReader();
export function getUserActivity(sensoryFrontApp = null, reader = fallback) {
  const value = reader.get('activity')?.idleSeconds;
  const idleSeconds = Number.isFinite(value) && value >= 0 ? value : null;
  const frontApp = sensoryFrontApp && sensoryFrontApp !== 'unknown'
    ? sensoryFrontApp : reader.get('visual')?.frontApp || 'unknown';
  return { idleSeconds, frontApp,
    presence: idleSeconds === null ? 'unknown' : idleSeconds < 30 ? 'present' : idleSeconds < 300 ? 'idle' : 'away' };
}
export default fallback;
