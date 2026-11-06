// A macOS notification on this Mac, for when Quinn is at it. Best-effort: it fails quietly when no one is logged in.
//
// When the Oneiro app is running it posts these itself, as real notifications that open the ask or pursuit they're
// about (an AppleScript banner can only open Script Editor). The app says it is listening by polling GET /oca/since
// with the header `X-Oneiro-Notifier: app`; while it has done so recently, this stays quiet so nothing shows twice.
// If the app stops polling (quit, crashed, asleep), the banners come back on their own after APP_LISTEN_MS.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { clip } from '../reasoning/clip.js';

const run = promisify(execFile);
export const APP_LISTEN_MS = 180_000;
export const NOTIFIER_HEADER = 'x-oneiro-notifier';
let appHeardAt = 0;

// The app polled with the notifier header: it will post notifications for the next APP_LISTEN_MS.
export function noteAppListening(at = Date.now()) { appHeardAt = Math.max(appHeardAt, at); }
export function appIsListening(at = Date.now()) { return appHeardAt > 0 && at - appHeardAt < APP_LISTEN_MS; }
export function resetAppListening() { appHeardAt = 0; }

// Express middleware: any request carrying the header counts as the app listening.
export function appListenerMiddleware(req, _res, next) {
  if (String(req.headers?.[NOTIFIER_HEADER] || '').toLowerCase() === 'app') noteAppListening();
  next();
}

// Returns 'app' when the app will show it instead, 'banner' when this posted it.
export async function macNotify({ title = 'Oneiro', body = '' } = {}, { exec = run, now = Date.now } = {}) {
  if (appIsListening(now())) return 'app';
  await exec('osascript', ['-e', `display notification ${JSON.stringify(clip(body, 200))} with title ${JSON.stringify(clip(title, 60))}`], { timeout: 5000 });
  return 'banner';
}
