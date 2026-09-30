// A push to Quinn's phone whenever something new lands in Judge: a deliverable the engine drafted, or a note the
// thinker wrote, waiting for his verdict. New items that arrive together go out as one push. The app opens Judge
// when he taps it; the title is how it knows (EngineAgentsBridge.judgeNotificationTitle).
//
// What has already been announced is kept on disk, so a restart never re-announces. The first run only records
// what is already waiting; the backlog he has already seen in the app isn't pushed at him.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const JUDGE_TITLE = 'Ready for your verdict';
const text = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const judgeKey = item => `${item.kind}:${item.id}`;

// The push body: one item by its title, several as a count with the newest named.
export function judgeMessage(items) {
  const first = text(items[0]?.title || items[0]?.id, 120);
  const what = items[0]?.kind === 'note' ? 'A note' : 'A deliverable';
  if (items.length === 1) return `${what} is waiting: ${first}`;
  return `${items.length} new things to judge, starting with ${first}`;
}

export function createJudgeNotifier({ list, push, statePath, clock = Date.now, log = console, tickMs = 120_000, keep = 500 } = {}) {
  let seen = null, timer = null, ticking = false;

  async function load() {
    try { const s = JSON.parse(await readFile(statePath, 'utf8')); return Array.isArray(s.seen) ? s.seen : null; }
    catch { return null; }
  }
  async function save(keys) {
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify({ seen: keys.slice(-keep), at: clock() }));
  }

  // One pass: announce what is new since the last one. Returns the items it pushed.
  async function tick() {
    if (ticking) return []; ticking = true;
    try {
      const items = (await list())?.toRate || [];
      if (seen === null) {
        const stored = await load();
        if (stored === null) {   // first run ever: what is already waiting counts as seen
          seen = items.map(judgeKey);
          await save(seen);
          return [];
        }
        seen = stored;
      }
      const known = new Set(seen);
      const fresh = items.filter(i => !known.has(judgeKey(i)));
      if (!fresh.length) return [];
      try { await push({ title: JUDGE_TITLE, body: judgeMessage(fresh) }); }
      catch (e) { log.warn?.('[judge] push failed; will try again next pass:', text(e.message, 160)); return []; }
      seen = [...seen, ...fresh.map(judgeKey)];
      await save(seen);
      log.log?.(`[judge] announced ${fresh.length} new item(s) waiting for Quinn's verdict`);
      return fresh;
    } finally { ticking = false; }
  }

  function start() { if (!timer) { timer = setInterval(() => { tick().catch(e => log.warn?.('[judge] tick:', text(e.message, 160))); }, tickMs); timer.unref?.(); } }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { tick, start, stop };
}
