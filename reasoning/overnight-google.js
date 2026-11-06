// Calendar and thread checks through Aside, on the Google accounts already connected there.
//
// Google Calendar has no Aside skill and the old app's EventKit is gone, so the read is the calendar's own week page:
// it has recurring events already expanded and each chip carries a full sentence ("8am to 10:30am, Title, Calendar: x,
// No location, November 1, 2026"). It is read only. A page that won't load or a chip that can't be parsed is reported;
// neither ever reads as an empty calendar, and a day with an unreadable chip can't be called free.
//
// The only calls that change anything are openReplyDraft and openNewDraft, which open Gmail's composer and stop (the
// person presses Send), and addEvent, which runs only from a card's approve. No path here clicks Send.
import { ASIDE_UNREACHABLE, scrub } from './integrations.js';

const lastJson = out => { for (const l of String(out ?? '').trim().split('\n').reverse()) { try { const v = JSON.parse(l); if (v && typeof v === 'object') return v; } catch {} } return null; };
const pad = n => String(n).padStart(2, '0');

const fail = message => Object.assign(new Error(message), { plain: true });
// The browser being closed says nothing about the account, and a read of Aside's own message would quote it.
const away = what => `Aside's browser wasn't open while ${what}. Open Aside, then try again.`;

// Calendar's data-datekey: (year - 1970) << 9 | month << 5 | day.
export function dateFromKey(key) {
  const k = Number(key);
  if (!Number.isInteger(k) || k <= 0) return null;
  return { year: (k >> 9) + 1970, month: (k >> 5) & 15, day: k & 31 };
}
function clockOf(s) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(String(s).trim());
  if (!m) return null;
  const h = Number(m[1]) % 12 + (/pm/i.test(m[3]) ? 12 : 0);
  return { h, m: Number(m[2] || 0) };
}
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const dayOf = (month, day, year) => { const m = MONTHS.indexOf(String(month).toLowerCase()); return m < 0 ? null : { year: Number(year), month: m + 1, day: Number(day) }; };
const at = (day, clock) => new Date(day.year, day.month - 1, day.day, clock.h, clock.m);
// One chip off the week grid into an event. The chip's full sentence is usually its first line but comes second on
// all-day chips, so it is looked for. Four shapes, as Calendar writes them:
//   "8am to 10:30am, Title, Calendar: x, No location, November 1, 2026"
//   "11am, Title, Calendar: x, ..."                                       (a start and no length: held as 30 minutes)
//   "November 6, 2026 at 4pm to November 7, 2026 at 11am, Title, ..."     (runs across days)
//   "All day, Title, Calendar: x, No location, November 2 – 4, 2026"
// Anything else comes back { unparsed: true }: never guessed at, and its day can't be called free.
export function parseChip({ id = '', dk = null, lines = [] }) {
  const clean = lines.map(l => String(l ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const TIME = '\\d{1,2}(?::\\d{2})?\\s*[ap]m';
  const across = new RegExp(`^([A-Za-z]+) (\\d{1,2}), (\\d{4}) at (${TIME}) to ([A-Za-z]+) (\\d{1,2}), (\\d{4}) at (${TIME}),`, 'i');
  const range = new RegExp(`^(${TIME})\\s+to\\s+(${TIME}),`, 'i'), single = new RegExp(`^(${TIME}),`, 'i');
  const head = clean.find(l => /^all day,/i.test(l) || across.test(l) || range.test(l) || single.test(l)) ?? clean[0] ?? '';
  const other = clean.find(l => l !== head && !new RegExp(`^${TIME}`, 'i').test(l)) ?? '';
  const named = other || head.split(',')[1]?.trim() || '';
  const day = dateFromKey(dk);
  if (/^all day,/i.test(head)) {
    const m = /([A-Za-z]+) (\d{1,2})(?:\s*[–-]\s*(?:[A-Za-z]+ )?\d{1,2})?, (\d{4})\s*$/.exec(head);
    return { id, allDay: true, title: named, raw: head, date: day || (m && dayOf(m[1], m[2], m[3])) };
  }
  const long = across.exec(head);
  if (long) {
    const from = dayOf(long[1], long[2], long[3]), to = dayOf(long[5], long[6], long[7]), a = clockOf(long[4]), b = clockOf(long[8]);
    if (from && to && a && b) return { id, title: named, raw: head, start: at(from, a).toISOString(), end: at(to, b).toISOString(), date: day || from };
  }
  const both = range.exec(head), one = single.exec(head);
  const start = day && clockOf(both ? both[1] : one ? one[1] : '');
  if (!start) return { id, unparsed: true, raw: head, title: named, date: day };
  if (one) { const s = at(day, start); return { id, title: named, raw: head, start: s.toISOString(), end: new Date(s.getTime() + 30 * 60_000).toISOString(), date: day }; }
  const finish = clockOf(both[2]);
  if (!finish) return { id, unparsed: true, raw: head, title: named, date: day };
  const s = at(day, start);
  let e = at(day, finish);
  if (e <= s) e = new Date(e.getTime() + 86_400_000);
  return { id, title: named, raw: head, start: s.toISOString(), end: e.toISOString(), date: day };
}
export const sameTitle = (a, b) => String(a).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === String(b).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const overlaps = (aStart, aEnd, b) => b.start && new Date(aStart) < new Date(b.end) && new Date(aEnd) > new Date(b.start);
const dayStart = ms => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

// Is this slot clear, on these events? { free: true } or { free: false, why } in plain words. Unreadable chips on that
// day mean it can't be said to be free.
export function checkSlot({ title, start, end, events = [], unreadable = [] }) {
  const onDay = e => e.date && new Date(e.date.year, e.date.month - 1, e.date.day).getTime() === dayStart(new Date(start).getTime());
  const dup = title ? events.find(e => onDay(e) && sameTitle(e.title, title)) : null;
  if (dup) return { free: false, duplicate: true, why: `"${title}" is already on your calendar that day` };
  if (unreadable.some(e => !e.date || onDay(e))) return { free: false, why: "an event that day couldn't be read, so the slot can't be called free" };
  const clash = events.find(e => overlaps(start, end, e));
  if (clash) return { free: false, why: `that time now clashes with "${clash.title}"` };
  return { free: true };
}
// The first clear half-hour boundary from tomorrow morning on, within the next few days. Never asks a model for a time.
export function findSlot({ minutes = 30, events = [], unreadable = [], now = Date.now(), days = 4, startHour = 9, endHour = 18 }) {
  for (let d = 1; d <= days; d++) {
    const base = new Date(dayStart(now) + d * 86_400_000 + 3 * 3_600_000);    // past any DST jump, then back to local midnight
    for (let slot = startHour * 2; slot + Math.ceil(minutes / 30) <= endHour * 2; slot++) {
      const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), Math.floor(slot / 2), slot % 2 ? 30 : 0);
      const end = new Date(start.getTime() + minutes * 60_000);
      if (checkSlot({ title: '', start, end, events, unreadable }).free) return { start: start.toISOString(), end: end.toISOString() };
    }
  }
  return null;
}
const stamp = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const uidLookup = account => `const acc = (await googleAccounts.list()).find(x => String(x.email).toLowerCase() === ${JSON.stringify(account)}); if (!acc) { console.log(JSON.stringify({ missing: true })); return; }`;
const safely = (tag, body) => `/*${tag}*/ await (async () => { try { ${body} } catch (e) { console.log(JSON.stringify({ error: String((e && e.message) || e).slice(0, 300) })); } })();`;

export function createGoogleChannel({ run, openInAside = null, clock = Date.now, replTimeoutMs = 115_000 } = {}) {
  async function repl(code, what) {
    let out;
    try { out = await run(['repl', code], { timeoutMs: replTimeoutMs }); }
    catch (e) { throw fail(ASIDE_UNREACHABLE.test(e.message) ? away(what) : `Aside didn't answer while ${what}. Open Aside, then try again.`); }
    const j = lastJson(out.stdout);
    if (!j) throw fail(ASIDE_UNREACHABLE.test(`${out.stderr} ${out.stdout}`) ? away(what) : `Aside gave no answer while ${what}. Open Aside, then try again.`);
    if (j.error) throw fail(ASIDE_UNREACHABLE.test(j.error) ? away(what) : `${what[0].toUpperCase()}${what.slice(1)} failed: ${scrub(j.error, 200)}`);
    return j;
  }

  // Events on an account's calendar from `from` to `to` (at most three week pages). Read only.
  async function readCalendar({ account, from = clock(), to = clock() + 7 * 86_400_000 }) {
    // A date in the middle of each week, which lands on the right page whichever day the person's week starts on.
    const midWeek = ms => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay() + 3).getTime(); };
    const weeks = [...new Set([from, from + 7 * 86_400_000, from + 14 * 86_400_000, to].filter(ms => ms <= to).map(midWeek))].slice(0, 3);
    const code = safely('cal:read', `${uidLookup(account)}
      const urls = ${JSON.stringify(weeks)}.map(ms => { const d = new Date(ms); return 'https://calendar.google.com/calendar/u/' + acc.accountId + '/r/week/' + d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(); });
      const out = [];
      for (const u of urls) {
        const tab = await openTab(u);
        try {
          let grid = 0;
          for (let i = 0; i < 12 && !grid; i++) { await sleep(1000); grid = await tab.evaluate(() => document.querySelectorAll('[data-datekey]').length); }
          const seen = await tab.evaluate(() => ({ url: location.href, chips: [...document.querySelectorAll('[data-eventchip]')].map(n => ({ id: n.getAttribute('data-eventid') || '', dk: (n.closest('[data-datekey]') || { getAttribute() { return null; } }).getAttribute('data-datekey'), lines: (n.innerText || '').split('\\n') })) }));
          if (/accounts\\.google/.test(seen.url)) { console.log(JSON.stringify({ signedOut: true })); return; }
          if (!grid) { console.log(JSON.stringify({ error: 'the calendar page did not load' })); return; }
          out.push(seen.chips);
        } finally { await closeTab(tab).catch(() => {}); }
      }
      console.log(JSON.stringify({ uid: acc.accountId, pages: out }));`);
    const j = await repl(code, `reading ${account}'s calendar`);
    if (j.missing) throw fail(`${account} isn't signed in to Aside. Connect it in Integrations to read its calendar.`);
    if (j.signedOut) throw fail(`Google asked ${account} to sign in again. Connect it in Integrations to read its calendar.`);
    const seen = new Set(), events = [], unreadable = [];
    for (const chip of (j.pages || []).flat()) {
      const e = parseChip(chip);
      const k = `${e.id}|${e.allDay ? 'allday' : chip.dk}`;
      if (seen.has(k)) continue;
      seen.add(k);
      (e.unparsed ? unreadable : events).push(e);
    }
    return { uid: j.uid, events, unreadable };
  }

  // Has this thread had an answer? Reads who sent each message, never a body.
  async function threadStatus({ account, threadId }) {
    const code = safely('mail:thread', `${uidLookup(account)}
      const t = await gmail.getThread(acc.accountId, ${JSON.stringify(threadId)}, { bodyFormat: 'markdown' });
      const ms = (t.messages || []).map(m => ({ from: String((m.from && m.from.email) || '').toLowerCase(), at: m.timestamp }));
      console.log(JSON.stringify({ count: ms.length, last: ms[ms.length - 1] || null }));`);
    const j = await repl(code, `checking a thread in ${account}`);
    if (j.missing) throw fail(`${account} isn't signed in to Aside, so the thread couldn't be checked.`);
    if (!j.last) throw fail(`The thread is gone from ${account}.`);
    return { answered: j.last.from === account.toLowerCase(), lastAt: j.last.at, count: j.count };
  }

  // A tab that `aside repl` opens belongs to that one run and closes when the run ends, so a composer opened that way is
  // gone before anyone sees it. The person's composer has to be a real tab: the Aside app opens the URL, then a run
  // attaches to that tab to put the words in. Attaching doesn't take ownership, so the tab outlives the run.
  async function tabsNow(account, tag) {
    const j = await repl(safely(tag, `${uidLookup(account)}
      console.log(JSON.stringify({ uid: acc.accountId, tabs: (await listBrowserTabs()).map(t => t.targetId) }));`), `getting ${account} ready in Aside`);
    if (j.missing) throw fail(`${account} isn't signed in to Aside, so the draft couldn't be opened. Connect it in Integrations, then press again.`);
    return j;
  }
  const opener = () => {
    if (!openInAside) throw fail("Oneiro has no way to open Aside from here. Open Aside yourself, then press again.");
    return openInAside;
  };
  // Finds the tab the app just opened, attaches, opens the reply box if asked, and types the words. It stops there.
  const typeInto = ({ before, reply, body }) => `
      const before = new Set(${JSON.stringify(before)});
      let tab = null;
      for (let i = 0; i < 40 && !tab; i++) {
        const open = await listBrowserTabs();
        tab = open.find(t => !before.has(t.targetId) && /mail[.]google[.]com/.test(t.url || '')) || (i > 12 ? open.find(t => t.active && /mail[.]google[.]com/.test(t.url || '')) : null);
        if (!tab) await sleep(500);
      }
      if (!tab) { console.log(JSON.stringify({ noTab: true })); return; }
      const p = await attachBrowserTab(tab.targetId);
      await p.waitForSelector('[role="main"]', { timeout: 20000 });
      const box = '[role=textbox][aria-label]';
      let ready = await p.waitForSelector(box, { timeout: 3000 }).then(() => true).catch(() => false);
      ${reply ? `if (!ready) { await p.getByRole('link', { name: 'Reply', exact: true }).first().click(); ready = await p.waitForSelector(box, { timeout: 8000 }).then(() => true).catch(() => false); }` : ''}
      if (!ready) { console.log(JSON.stringify({ noBox: true })); return; }
      console.log(JSON.stringify(await p.evaluate(({ box, lines }) => {
        const b = document.querySelector(box);
        const had = b.innerText.trim();
        if (had && !/^Press \\/ for /.test(had)) return { opened: true, existing: true };
        b.focus();
        lines.forEach((line, i) => { if (i) document.execCommand('insertLineBreak'); if (line) document.execCommand('insertText', false, line); });
        return { opened: true, landed: b.innerText.includes(lines.find(Boolean) || '') };
      }, { box, lines: ${JSON.stringify(String(body).split('\n'))} })));`;
  const composed = (j, account) => {
    if (j.noTab) throw fail(`Aside didn't open the draft for ${account}. Open Aside, then press again.`);
    if (j.noBox) throw fail(`Gmail opened in Aside, but its message box didn't appear, so no words went in. Reply from that tab, or press again.`);
    if (j.existing) return { opened: true, existing: true };
    if (!j.landed) throw fail(`Gmail opened in Aside, but the words didn't go into the message. Copy them from the card into that tab.`);
    return { opened: true };
  };

  // Opens Gmail's reply box with the words in it, then stops. Sending is the person's press in Gmail.
  async function openReplyDraft({ account, threadId, body }) {
    const open = opener();
    const { uid, tabs } = await tabsNow(account, 'mail:ready');
    const where = await repl(safely('mail:where', `
      const id = ${JSON.stringify(threadId)};
      if (id.startsWith('thread-f:')) { console.log(JSON.stringify({ hex: BigInt(id.slice(9)).toString(16) })); return; }
      const last = (await gmail.getThread(${JSON.stringify(uid)}, id)).messages.filter(m => String(m.messageId).startsWith('msg-f:')).at(-1);
      console.log(JSON.stringify(last ? { hex: BigInt(last.messageId.slice(6)).toString(16) } : { gone: true }));`), `finding a thread in ${account}`);
    if (where.gone || !where.hex) throw fail(`That thread isn't in ${account} any more, so there's nothing to reply to.`);
    await open(`https://mail.google.com/mail/u/${uid}/#inbox/${where.hex}`);
    return composed(await repl(safely('mail:draft', typeInto({ before: tabs, reply: true, body })), `opening a reply in ${account}`), account);
  }

  // Opens a new message in Gmail with the words in it, in its own tab, then stops. Sending is the person's press in Gmail.
  async function openNewDraft({ account, to = [], subject = '', body = '' }) {
    const open = opener();
    const { uid, tabs } = await tabsNow(account, 'mail:ready');
    const params = new URLSearchParams({ view: 'cm', fs: '1', to: [].concat(to).join(','), su: subject });
    await open(`https://mail.google.com/mail/u/${uid}/?${params}`);
    return composed(await repl(safely('mail:new', typeInto({ before: tabs, reply: false, body })), `opening a draft in ${account}`), account);
  }

  // Adds one event, after an approve press. Fills Calendar's own form, checks the title landed, presses its Save.
  async function addEvent({ account, title, start, end, details = '' }) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const params = new URLSearchParams({ text: title, dates: `${stamp(new Date(start))}/${stamp(new Date(end))}`, ctz: tz, ...(details ? { details } : {}) });
    const code = safely('cal:add', `${uidLookup(account)}
      const tab = await openTab('https://calendar.google.com/calendar/u/' + acc.accountId + '/r/eventedit?' + ${JSON.stringify(params.toString())});
      try {
        let ready = false;
        for (let i = 0; i < 15 && !ready; i++) { await sleep(1000); ready = await tab.evaluate(() => !!document.querySelector('[aria-label="Save"]')); }
        if (!ready) { console.log(JSON.stringify({ error: 'the event form did not load' })); return; }
        const shown = await tab.evaluate(() => { const t = document.querySelector('input[aria-label="Title"],input[aria-label="Add title"]'); return t ? t.value : null; });
        if (shown !== ${JSON.stringify(title)}) { console.log(JSON.stringify({ error: 'the event form did not take the title' })); return; }
        await tab.locator('[aria-label="Save"]').first().click();
        let left = false;
        for (let i = 0; i < 15 && !left; i++) { await sleep(1000); left = await tab.evaluate(() => !location.pathname.includes('/eventedit')); }
        console.log(JSON.stringify({ saved: left }));
      } finally { await closeTab(tab).catch(() => {}); }`);
    const j = await repl(code, `adding to ${account}'s calendar`);
    if (j.missing) throw fail(`${account} isn't signed in to Aside, so nothing was added.`);
    if (!j.saved) throw fail(`Calendar didn't confirm the save. Check your calendar for "${title}" before pressing again.`);
    return { saved: true };
  }

  return { readCalendar, threadStatus, openReplyDraft, openNewDraft, addEvent };
}
