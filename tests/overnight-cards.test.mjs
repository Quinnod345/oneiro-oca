// Morning cards: proposed from what was kept, checked read-only, edited, skipped, approved in one press, aged out. Mail
// is never sent; a calendar block is added only on approve; a failed check drops the card and says why. Aside is faked,
// except for the tests that read the code it would run.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGE_RULE, CARD_AGE_MS, createCards, matchesSubject, plainWhy, proposeCards, withoutScaffolding } from '../reasoning/overnight-cards.js';
import { createOvernight } from '../reasoning/overnight.js';
import { checkSlot, createGoogleChannel, dateFromKey, findSlot, parseChip } from '../reasoning/overnight-google.js';

const silent = { log() {}, warn() {} };
const migration = () => readFile(new URL('../migrations/071_overnight.sql', import.meta.url), 'utf8');
async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'cards_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  const dir = await mkdtemp(join(tmpdir(), 'oneiro-cards-'));
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema });
    await pool.query(await migration());
    await run(pool, dir);
  } finally { if (pool) await pool.end(); await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end(); await rm(dir, { recursive: true, force: true }); }
}

// A fake Google: a calendar in memory, a thread's state, and a list of everything that changed the world.
function fakeChannel(over = {}) {
  const w = { events: [], unreadable: [], answered: false, actions: [], reads: 0 };
  const onDate = iso => { const d = new Date(iso); return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }; };
  w.channel = {
    readCalendar: async () => { w.reads++; return { events: w.events, unreadable: w.unreadable }; },
    threadStatus: async () => ({ answered: w.answered, count: 2 }),
    openReplyDraft: async a => { w.actions.push(['draft', a]); return { opened: true }; },
    addEvent: async a => { w.actions.push(['add', a]); w.events.push({ id: 'new', title: a.title, start: new Date(a.start).toISOString(), end: new Date(a.end).toISOString(), date: onDate(a.start) }); return { saved: true }; },
    ...over };
  return w;
}
const inHours = (n, at = Date.now()) => new Date(at + n * 3_600_000).toISOString();
const mailCandidate = (over = {}) => ({ kind: 'mail_draft', title: 'Reply to Ana', why: 'She asked', body: 'Friday works for me.', evidence: 'Ana asked about Friday', dedupeKey: 'mail:me@x.com:t1:d1', payload: { account: 'me@x.com', threadId: 't1', to: 'Ana <ana@x.com>', subject: 'Lease' }, ...over });
const blockCandidate = (over = {}) => ({ kind: 'calendar_block', title: 'Read the lease', why: 'It is due', body: 'Go through the lease.', evidence: 'Lease due', dedupeKey: 'block:read-the-lease:2026-11', payload: { account: 'me@x.com', minutes: 30 }, ...over });
const briefCandidate = (over = {}) => ({ kind: 'brief', title: 'The lease', why: 'Several notes', body: '# Where it stands\n\nSigning moved.', evidence: 'Lease notes', dedupeKey: 'brief:the-lease:2026-11', payload: {}, ...over });

test('a checked card is staged; a failed check drops it and says why', () => database(async (pool, dir) => {
  const w = fakeChannel();
  const cards = createCards({ pool, channel: w.channel, vault: () => dir, log: silent });
  const fine = await cards.stage({ runId: null, candidates: [mailCandidate()], calendar: w });
  assert.deepEqual([fine.ready.length, fine.ready[0].status, fine.dropped.length], [1, 'ready', 0]);
  assert.ok(fine.ready[0].checkedAt);

  w.answered = true;
  const answered = await cards.stage({ runId: null, candidates: [mailCandidate({ dedupeKey: 'mail:me@x.com:t2:d1', payload: { account: 'me@x.com', threadId: 't2' } })], calendar: w });
  assert.deepEqual(answered.dropped, [{ title: 'Reply to Ana', why: 'you already replied in that thread' }]);

  const unreadable = fakeChannel({ threadStatus: async () => { throw new Error("Aside didn't answer while checking a thread in me@x.com. Open Aside, then try again."); } });
  const c2 = createCards({ pool, channel: unreadable.channel, vault: () => dir, log: silent });
  const failed = await c2.stage({ runId: null, candidates: [mailCandidate({ dedupeKey: 'mail:me@x.com:t3:d1' })], calendar: w });
  assert.match(failed.dropped[0].why, /Aside didn't answer/);
  assert.equal(unreadable.actions.length, 0);

  const noCal = await cards.stage({ runId: null, candidates: [blockCandidate()], calendar: { error: 'Aside is off' } });
  assert.match(noCal.dropped[0].why, /calendar couldn't be read: Aside is off/);
  assert.equal(w.actions.length, 0, 'prepare changed nothing in the world');
}));

test('the same thing is never offered twice, even after a skip, and a morning shows at most five', () => database(async (pool, dir) => {
  const w = fakeChannel();
  const cards = createCards({ pool, channel: w.channel, vault: () => dir, log: silent });
  const { ready } = await cards.stage({ runId: null, candidates: [mailCandidate()], calendar: w });
  await cards.skip(ready[0].id);
  const again = await cards.stage({ runId: null, candidates: [mailCandidate()], calendar: w });
  assert.deepEqual(again.dropped, [{ title: 'Reply to Ana', why: 'it was already offered' }]);
  const many = Array.from({ length: 7 }, (_, i) => briefCandidate({ dedupeKey: `brief:${i}`, title: `Brief ${i}` }));
  const staged = await cards.stage({ runId: null, candidates: many, calendar: w });
  assert.equal(staged.ready.length, 5);
  assert.match(staged.dropped[0].why, /at most 5/);
}));

test('editing changes what approve acts on; a blank card is refused; skip takes it off the list', () => database(async (pool, dir) => {
  const w = fakeChannel();
  const cards = createCards({ pool, channel: w.channel, vault: () => dir, log: silent });
  const { ready: [card] } = await cards.stage({ runId: null, candidates: [mailCandidate()], calendar: w });
  const edited = await cards.edit(card.id, { body: 'Friday at noon works. Thanks, Ana.' });
  assert.equal(edited.edited, true);
  await assert.rejects(() => cards.edit(card.id, { body: '   ' }), /needs words/);
  const res = await cards.approve(card.id);
  assert.equal(res.ok, true);
  assert.equal(w.actions[0][0], 'draft');
  assert.equal(w.actions[0][1].body, 'Friday at noon works. Thanks, Ana.', 'consent is to the edited words');
  await assert.rejects(() => cards.approve(card.id), /already approved/);
  assert.equal(w.actions.length, 1, 'a second press does nothing');

  const { ready: [other] } = await cards.stage({ runId: null, candidates: [briefCandidate()], calendar: w });
  assert.equal((await cards.list()).cards.length, 1);
  assert.equal((await cards.skip(other.id)).status, 'skipped');
  assert.deepEqual((await cards.list()).cards, []);
  await assert.rejects(() => cards.approve(other.id), /was skipped/);
}));

test('approve for mail opens a draft and stops; a thread answered since drops the card and opens nothing', () => database(async (pool, dir) => {
  const w = fakeChannel();
  const cards = createCards({ pool, channel: w.channel, vault: () => dir, log: silent });
  const { ready: [card] } = await cards.stage({ runId: null, candidates: [mailCandidate()], calendar: w });
  const res = await cards.approve(card.id);
  assert.match(res.line, /open in Aside as a draft\. It sends only when you press Send/);
  assert.deepEqual(w.actions.map(a => a[0]), ['draft']);

  const { ready: [second] } = await cards.stage({ runId: null, candidates: [mailCandidate({ dedupeKey: 'mail:me@x.com:t9:d' })], calendar: w });
  w.answered = true;
  const late = await cards.approve(second.id);
  assert.equal(late.ok, false);
  assert.match(late.error, /already replied/);
  assert.equal(late.card.status, 'dropped');
  assert.equal(w.actions.length, 1);
}));

test('no code path can send mail: the only compose call opens a reply and there is no Send press anywhere', async () => {
  const src = await readFile(new URL('../reasoning/overnight-google.js', import.meta.url), 'utf8');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /\[data-tooltip\*?="Send|aria-label="Send|send_message|gmail\.send|\.send\(/i);
  // Found on the real Mac: a tab `aside repl` opens closes when the run ends, so the card said "open" over nothing.
  const seen = [], opened = [];
  const answer = code => /mail:ready/.test(code) ? '{"uid":0,"tabs":["old"]}' : /mail:where/.test(code) ? '{"hex":"1"}' : '{"opened":true,"landed":true}';
  const channel = createGoogleChannel({ run: async args => { seen.push(args[1]); return { stdout: `${answer(args[1])}\n` }; }, openInAside: async url => { opened.push(url); } });
  assert.deepEqual(await channel.openReplyDraft({ account: 'me@x.com', threadId: 'thread-f:1', body: 'First line\n\n<b>Third</b> line' }), { opened: true });
  assert.deepEqual(opened, ['https://mail.google.com/mail/u/0/#inbox/1'], 'the Aside app opens the tab, so it outlives the run');
  const typed = seen.at(-1);
  assert.doesNotMatch(typed, /openTab|openReplyComposer/, 'no tab that dies with the run, and no helper that skips the body');
  assert.match(typed, /attachBrowserTab/);
  assert.match(typed, /"First line","","<b>Third<\/b> line"/, 'the words go in as text, line by line, so they can never be markup');
  assert.match(typed, /\["old"\]/, 'it looks for the tab that was not there before');
  assert.deepEqual(typed.match(/\.click\(\)/g), ['.click()'], 'its one click is Reply');
  assert.match(typed, /name: 'Reply', exact: true \}\)\.first\(\)\.click\(\)/);

  await channel.openNewDraft({ account: 'me@x.com', to: ['a@x.com'], subject: 'Hi there', body: 'Words' });
  assert.equal(opened.at(-1), 'https://mail.google.com/mail/u/0/?view=cm&fs=1&to=a%40x.com&su=Hi+there');
  assert.doesNotMatch(seen.at(-1), /\.click\(\)/, 'a new message has nothing to click');
});

test('a composer that did not really open is never reported as open', async () => {
  const say = last => createGoogleChannel({ run: async args => ({ stdout: `${/mail:ready/.test(args[1]) ? '{"uid":0,"tabs":[]}' : /mail:where/.test(args[1]) ? '{"hex":"1"}' : last}\n` }), openInAside: async () => {} });
  const press = c => c.openReplyDraft({ account: 'me@x.com', threadId: 'thread-f:1', body: 'Words' });
  await assert.rejects(() => press(say('{"noTab":true}')), /didn't open the draft/);
  await assert.rejects(() => press(say('{"noBox":true}')), /message box didn't appear/);
  await assert.rejects(() => press(say('{"opened":true,"landed":false}')), /words didn't go in/);
  assert.deepEqual(await press(say('{"opened":true,"existing":true}')), { opened: true, existing: true }, "someone's own draft is left as it is");
  await assert.rejects(() => createGoogleChannel({ run: async () => ({ stdout: '{"uid":0,"tabs":[]}\n' }) }).openNewDraft({ account: 'me@x.com', to: [], subject: 's', body: 'b' }), /no way to open Aside/);
  await assert.rejects(() => createGoogleChannel({ run: async () => ({ stdout: '{"missing":true}\n' }), openInAside: async () => {} }).openReplyDraft({ account: 'me@x.com', threadId: 'thread-f:1', body: 'b' }), /isn't signed in to Aside/);
});

test('a calendar block: the slot comes from the calendar, it is added only on the press, and the result is checked', () => database(async (pool, dir) => {
  const w = fakeChannel();
  const cards = createCards({ pool, channel: w.channel, vault: () => dir, log: silent });
  const { ready: [card] } = await cards.stage({ runId: null, candidates: [blockCandidate()], calendar: w });
  assert.equal(w.actions.length, 0, 'staging a block adds nothing');
  assert.ok(new Date(card.payload.start) > new Date(), 'a time ahead, from the calendar');
  assert.equal((new Date(card.payload.end) - new Date(card.payload.start)) / 60_000, 30);
  assert.ok(new Date(card.expiresAt) <= new Date(card.payload.start));
  const res = await cards.approve(card.id);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.match(res.line, /Added "Read the lease"/);
  assert.deepEqual(w.actions.map(a => a[0]), ['add']);
  assert.equal(w.actions[0][1].title, 'Read the lease');
  assert.equal((await cards.get(card.id)).status, 'approved');
}));

test('a block with a duplicate on the calendar is dropped; a slot taken since is refused with the reason and can be moved', () => database(async (pool, dir) => {
  const w = fakeChannel();
  const cards = createCards({ pool, channel: w.channel, vault: () => dir, log: silent });
  const { ready: [card] } = await cards.stage({ runId: null, candidates: [blockCandidate()], calendar: w });
  const { start, end } = card.payload;
  const d = new Date(start);
  const date = { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  w.events.push({ id: 'x', title: 'Dentist', start, end, date });
  const clash = await cards.approve(card.id);
  assert.equal(clash.ok, false);
  assert.match(clash.error, /clashes with "Dentist"/);
  assert.equal(w.actions.length, 0);
  assert.equal((await cards.get(card.id)).status, 'ready', 'it stays so it can be moved');

  const moved = await cards.edit(card.id, { start: inHours(40), minutes: 45 });
  assert.equal(moved.payload.minutes, 45);
  await assert.rejects(() => cards.edit(card.id, { start: inHours(-1) }), /still ahead/);
  assert.equal((await cards.approve(card.id)).ok, true);
  assert.equal(w.actions.length, 1);

  const { ready: [dup] } = await cards.stage({ runId: null, candidates: [blockCandidate({ dedupeKey: 'block:b', title: 'Pay the rent' })], calendar: w });
  const dd = new Date(dup.payload.start);
  w.events.push({ id: 'y', title: 'pay the RENT!', start: new Date(dd.getTime() + 2 * 3_600_000).toISOString(), end: new Date(dd.getTime() + 3 * 3_600_000).toISOString(), date: { year: dd.getFullYear(), month: dd.getMonth() + 1, day: dd.getDate() } });
  const r = await cards.approve(dup.id);
  assert.equal(r.card.status, 'dropped');
  assert.match(r.error, /already on your calendar/);
}));

test('a slot has to be free on every calendar the night can see, not only the one the block lands on', () => database(async (pool, dir) => {
  const w = fakeChannel();
  const asked = [];
  const channel = { ...w.channel, readCalendar: async ({ account }) => { asked.push(account); return account === 'work@x.com' && w.busy ? { events: [w.busy], unreadable: [] } : { events: [], unreadable: [] }; } };
  const cards = createCards({ pool, channel, vault: () => dir, log: silent });
  const { ready: [card] } = await cards.stage({ runId: null, candidates: [blockCandidate()], calendar: { events: [], unreadable: [], accounts: ['me@x.com', 'work@x.com'] } });
  assert.deepEqual(asked, ['me@x.com', 'work@x.com']);
  const d = new Date(card.payload.start);
  w.busy = { id: 'z', title: 'Other calendar', start: card.payload.start, end: card.payload.end, date: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() } };
  const res = await cards.approve(card.id);
  assert.match(res.error, /clashes with "Other calendar"/);
  assert.equal(w.actions.length, 0);
}));

test('Calendar saying it saved but not showing the event is not reported as done', () => database(async (pool, dir) => {
  const w = fakeChannel({ addEvent: async () => ({ saved: true }) });
  const cards = createCards({ pool, channel: w.channel, vault: () => dir, log: silent });
  const { ready: [card] } = await cards.stage({ runId: null, candidates: [blockCandidate()], calendar: w });
  const res = await cards.approve(card.id);
  assert.equal(res.ok, false);
  assert.match(res.error, /isn't showing yet/);
  assert.equal((await cards.get(card.id)).status, 'ready');

  const broken = fakeChannel({ addEvent: async () => { throw new Error("Calendar didn't confirm the save."); } });
  const c2 = createCards({ pool, channel: broken.channel, vault: () => dir, log: silent });
  const { ready: [other] } = await c2.stage({ runId: null, candidates: [blockCandidate({ dedupeKey: 'block:z' })], calendar: broken });
  const failed = await c2.approve(other.id);
  assert.match(failed.error, /didn't confirm/);
  assert.equal((await c2.get(other.id)).status, 'ready');
}));

test('approving a brief saves it to the knowledge base as a plain note', () => database(async (pool, dir) => {
  const w = fakeChannel();
  const vaultRoot = join(dir, 'vault');
  const cards = createCards({ pool, channel: w.channel, vault: () => vaultRoot, log: silent, clock: () => new Date('2026-11-06T12:00:00Z').getTime() });
  const { ready: [card] } = await cards.stage({ runId: null, candidates: [briefCandidate()], calendar: w });
  const res = await cards.approve(card.id);
  assert.match(res.line, /Briefs\/the-lease-2026-11-06\.md/);
  const text = await readFile(join(vaultRoot, 'Briefs/the-lease-2026-11-06.md'), 'utf8');
  assert.ok(text.startsWith('# The lease\n\n# Where it stands'));
  assert.deepEqual(w.actions, []);
}));

test('cards age out by the stated rule, and an aged card can\'t be approved', () => database(async (pool, dir) => {
  let t = Date.now();
  const w = fakeChannel();
  const cards = createCards({ pool, channel: w.channel, vault: () => dir, log: silent, clock: () => t });
  const { ready: [mail] } = await cards.stage({ runId: null, candidates: [mailCandidate()], calendar: w });
  const { ready: [block] } = await cards.stage({ runId: null, candidates: [blockCandidate()], calendar: w });
  assert.equal(new Date(mail.expiresAt).getTime(), t + CARD_AGE_MS);
  assert.match(AGE_RULE, /48 hours/);
  assert.equal((await cards.list()).ageRule, AGE_RULE);
  const blockExpires = new Date(block.expiresAt).getTime();
  t = blockExpires + 1;
  assert.deepEqual((await cards.list()).cards.map(c => c.kind).filter(k => k === 'calendar_block'), [], 'a block goes as soon as its time has passed');
  t = new Date(mail.expiresAt).getTime() + 1;
  assert.deepEqual((await cards.list()).cards, []);
  assert.equal((await cards.get(mail.id)).status, 'expired');
  await assert.rejects(() => cards.approve(mail.id), /aged out/);
  assert.deepEqual(w.actions, []);
}));

test('an approve the engine died during comes back to ready, with a warning', () => database(async (pool, dir) => {
  let t = Date.now();
  const w = fakeChannel();
  const cards = createCards({ pool, channel: w.channel, vault: () => dir, log: silent, clock: () => t });
  const { ready: [card] } = await cards.stage({ runId: null, candidates: [mailCandidate()], calendar: w });
  await pool.query(`UPDATE night_cards SET status = 'approving', decided_at = $2 WHERE id = $1`, [card.id, new Date(t)]);
  await assert.rejects(() => cards.approve(card.id), /being approved/);
  t += 6 * 60_000;
  const [back] = (await cards.list()).cards;
  assert.equal(back.status, 'ready');
  assert.match(back.detail, /never finished/);
}));

// ---- proposing -----------------------------------------------------------------------------------------------------
const notes = [
  { id: 1, source: 'mail', title: 'Lease signing', summary: 'Ana asked whether Friday works for signing the apartment lease.', needsReply: true, ref: { account: 'me@x.com', threadId: 't1', from: 'Ana <ana@x.com>', subject: 'Lease', date: 'd1' } },
  { id: 2, source: 'files', title: 'Budget review', summary: 'Quarterly budget review numbers need checking before the board meeting.', ref: {} },
];
const propose = (cards, calendarAccount = 'me@x.com') => proposeCards({ notes, calendarAccount, chat: async () => JSON.stringify({ cards }) });

test('the recipient comes from the mail itself, and a card has to point at what it came from', async () => {
  const good = await propose([{ kind: 'mail_draft', note_ids: [1], title: 'Reply about the lease signing', why: 'Ana is waiting', body: 'Friday works for signing the lease, Ana.', minutes: 0 }]);
  assert.equal(good.candidates.length, 1);
  assert.deepEqual([good.candidates[0].payload.to, good.candidates[0].payload.threadId, good.candidates[0].payload.account], ['Ana <ana@x.com>', 't1', 'me@x.com']);
  assert.match(good.candidates[0].evidence, /Friday works for signing/);

  const none = await propose([{ kind: 'brief', note_ids: [99], title: 'Budget', why: 'w', body: 'Budget review numbers checking board', minutes: 0 }]);
  assert.match(none.dropped[0].why, /didn't point at anything/);
  const fileMail = await propose([{ kind: 'mail_draft', note_ids: [2], title: 'Budget review reply', why: 'w', body: 'Budget review numbers checking done', minutes: 0 }]);
  assert.match(fileMail.dropped[0].why, /wasn't a reply/);
});

test('a draft that drifted off its subject or carries a secret is dropped; scaffolding is stripped; no calendar, no block', async () => {
  const drift = await propose([{ kind: 'brief', note_ids: [2], title: 'Product launch', why: 'w', body: 'Meet in conference room A at 3pm about the launch.', minutes: 0 }]);
  assert.match(drift.dropped[0].why, /drifted/);
  const secret = await propose([{ kind: 'brief', note_ids: [2], title: 'Budget review numbers', why: 'w', body: 'Budget review numbers for the board, card 4111 1111 1111 1111', minutes: 0 }]);
  assert.match(secret.dropped[0].why, /private/);
  assert.equal(withoutScaffolding('Title: Vet\nAdd to calendar\nWhy: Nora starts today\nDestination: Personal\nBlue Vet: bring records'), 'Add to calendar\nNora starts today\nBlue Vet: bring records');
  assert.equal(matchesSubject('completely unrelated words here', 'lease signing friday apartment'), false);
  const off = await propose([{ kind: 'calendar_block', note_ids: [2], title: 'Budget review check', why: 'w', body: 'Check the budget review numbers', minutes: 30 }], null);
  assert.match(off.dropped[0].why, /Calendar is switched off/);
  const on = await propose([{ kind: 'calendar_block', note_ids: [2], title: 'Budget review check', why: 'w', body: 'Check the budget review numbers', minutes: 900 }]);
  assert.equal(on.candidates[0].payload.minutes, 120, 'a block stays a sensible size');
  assert.equal(on.candidates[0].payload.start, undefined, 'the model never picks the time');
});

test('a model that fails on the cards reports it; no notes means no call at all', async () => {
  let called = 0;
  await proposeCards({ notes: [], chat: async () => { called++; return ''; } });
  assert.equal(called, 0);
  const slow = await proposeCards({ notes, chat: async () => { throw new Error('Local inference timed out'); }, timeoutMs: 20 * 60_000 });
  assert.deepEqual([slow.timedOut, slow.candidates.length], [true, 0]);
  assert.match(slow.failed, /took longer than 20 minutes/);
  const garbled = await proposeCards({ notes, chat: async () => 'sorry' });
  assert.match(garbled.failed, /couldn't be read/);
});

test('a full night leaves checked cards and reports the dropped ones by name; nothing is sent or added', () => database(async (pool, dir) => {
  const w = fakeChannel();
  w.answered = false;
  const integrations = { list: async () => ({ integrations: [{ provider: 'google', account: 'me@x.com', label: 'personal', uid: 0, enabled: true, status: 'connected' }] }),
    mailRecent: async () => ({ accounts: [{ account: 'me@x.com', ok: true }], messages: [
      { account: 'me@x.com', threadId: 't1', subject: 'Lease', from: 'Ana <ana@x.com>', date: inHours(-2), snippet: 'Does Friday work for signing the lease?' },
      { account: 'me@x.com', threadId: 't2', subject: 'Hello again', from: 'Bo <bo@x.com>', date: inHours(-3), snippet: 'Are you free to talk about the budget review?' }] }) };
  const channel = { ...w.channel, threadStatus: async ({ threadId }) => ({ answered: threadId === 't2' }) };
  const model = { where: 'test on this Mac', warm: async () => ({ ok: true }), check: async () => ({ ok: true }),
    chat: async ({ system, user }) => {
      if (system.includes('on-device judge')) return user.includes('lease') ? JSON.stringify({ summary: 'Ana asked whether Friday works for signing the lease.', title: 'Lease signing', junk: false, sensitive: false, needs_reply: true }) : JSON.stringify({ summary: 'Bo asked to talk about the budget review.', title: 'Budget review talk', junk: false, sensitive: false, needs_reply: true });
      if (system.includes('knowledge base: a folder')) { const ids = [...user.matchAll(/^\[(\d+)\]/gm)].map(m => Number(m[1])); return JSON.stringify({ notes: [{ path: 'people/ana.md', title: 'Ana', body: '- Lease signing on Friday asked about.', uses: ids }] }); }
      const ids = Object.fromEntries([...user.matchAll(/^\[(\d+)\] mail needs_reply from (\w+)/gm)].map(m => [m[2], Number(m[1])]));
      return JSON.stringify({ cards: [
        { kind: 'mail_draft', note_ids: [ids.Ana], title: 'Reply about the lease signing', why: 'Ana is waiting', body: 'Friday works for signing the lease, Ana.', minutes: 0 },
        { kind: 'mail_draft', note_ids: [ids.Bo], title: 'Reply about the budget review', why: 'Bo asked', body: 'Happy to talk about the budget review, Bo.', minutes: 0 },
        { kind: 'calendar_block', note_ids: [ids.Ana], title: 'Read the lease before signing', why: 'Signing is coming', body: 'Read the lease before signing on Friday.', minutes: 30 },
      ] });
    } };
  const told = [];
  const night = createOvernight({ pool, integrations, model, channel, vault: join(dir, 'vault'), power: async () => ({ onAC: true, lowPower: false }), helper: async () => ({ state: 'on' }), log: silent, notify: async m => { told.push(m); } });
  await night.init();
  await night.updateSettings({ mail: true, calendar: true });
  await night.start();
  await night.waitFor();
  const [run] = (await night.history(1)).runs;
  assert.equal(run.status, 'finished', JSON.stringify(run.report.problems));
  assert.equal(run.report.cards.ready, 2);
  assert.deepEqual(run.report.cards.dropped, [{ title: 'Reply about the budget review', why: 'you already replied in that thread' }]);
  const { cards } = await night.cards.list();
  assert.deepEqual(cards.map(c => c.kind).sort(), ['calendar_block', 'mail_draft']);
  assert.equal(cards.find(c => c.kind === 'mail_draft').payload.to, 'Ana <ana@x.com>');
  assert.deepEqual(w.actions, [], 'the night sent nothing and added nothing');
  assert.match(told[0].title, /2 cards are ready/);
  assert.match(await readFile(join(dir, 'vault/people/ana.md'), 'utf8'), /Lease signing/);
  assert.deepEqual(await readdir(join(dir, 'vault')), ['people']);
}));

// ---- reading the calendar -------------------------------------------------------------------------------------------
test('calendar chips parse as Google writes them, and an unreadable one is marked rather than guessed at', () => {
  assert.deepEqual(dateFromKey(29025), { year: 2026, month: 11, day: 1 });
  assert.deepEqual(dateFromKey(28993), { year: 2026, month: 10, day: 1 });
  const timed = parseChip({ id: 'abc', dk: '29027', lines: ['12:15pm to 1:15pm, Lunch with Ana, Calendar: Quinn, No location, November 3, 2026', 'Lunch with Ana', '12:15 – 1:15pm'] });
  assert.equal(timed.title, 'Lunch with Ana');
  assert.equal(new Date(timed.start).getHours(), 12);
  assert.equal(new Date(timed.start).getMinutes(), 15);
  assert.equal(new Date(timed.end).getHours(), 13);
  assert.equal(new Date(timed.start).getDate(), 3);
  const morning = parseChip({ id: 'b', dk: '29025', lines: ['8am to 10:30am, Run, Calendar: Quinn, No location, November 1, 2026', 'Run', '8 – 10:30am'] });
  assert.deepEqual([new Date(morning.start).getHours(), new Date(morning.end).getMinutes()], [8, 30]);
  const allDay = parseChip({ id: 'c', dk: null, lines: ['All day, Trip, Calendar: Quinn, No location, November 2 – 4, 2026', 'Trip'] });
  assert.equal(allDay.allDay, true);
  // As read off a real calendar: an all-day chip's sentence is its second line.
  const secondLine = parseChip({ id: 'c2', dk: null, lines: ['Trip to Boston', 'All day, Trip to Boston, Calendar: Quinn, No location, November 6 – 8, 2026'] });
  assert.deepEqual([secondLine.allDay, secondLine.title, secondLine.date], [true, 'Trip to Boston', { year: 2026, month: 11, day: 6 }]);
  const noLength = parseChip({ id: 'g', dk: '29030', lines: ['11am, Call the bank, Calendar: Quinn, No location, November 6, 2026', 'Call the bank', '11am'] });
  assert.deepEqual([noLength.title, new Date(noLength.start).getHours(), (new Date(noLength.end) - new Date(noLength.start)) / 60_000], ['Call the bank', 11, 30]);
  const across = parseChip({ id: 'h', dk: '29030', lines: ['November 6, 2026 at 4pm to November 7, 2026 at 11am, Hotel stay, Calendar: Quinn, New York', 'Hotel stay'] });
  assert.deepEqual([across.title, new Date(across.start).getDate(), new Date(across.start).getHours(), new Date(across.end).getDate(), new Date(across.end).getHours()], ['Hotel stay', 6, 16, 7, 11]);
  const odd = parseChip({ id: 'd', dk: '29027', lines: ['Sometime soon, Flight'] });
  assert.equal(odd.unparsed, true);
  const late = parseChip({ id: 'e', dk: '29027', lines: ['11pm to 12am, Late, Calendar: Q, November 3, 2026', 'Late'] });
  assert.ok(new Date(late.end) > new Date(late.start), 'ending at midnight is the next day');
});

test('the slot finder and check are strict: busy, duplicates and unreadable days are not free, all-day events are', () => {
  const now = new Date(2026, 10, 5, 22, 0).getTime();
  const nine = new Date(2026, 10, 6, 9, 0), ten = new Date(2026, 10, 6, 10, 0);
  const date = { year: 2026, month: 11, day: 6 };
  const slot = findSlot({ minutes: 30, events: [], now });
  assert.equal(new Date(slot.start).getTime(), nine.getTime());
  const busy = findSlot({ minutes: 60, events: [{ title: 'x', start: nine.toISOString(), end: ten.toISOString(), date }], now });
  assert.equal(new Date(busy.start).getTime(), ten.getTime());
  const allDay = findSlot({ minutes: 30, events: [{ title: 'Trip', allDay: true, date: null }], now });
  assert.equal(new Date(allDay.start).getTime(), nine.getTime());
  assert.equal(checkSlot({ title: 'New', start: nine, end: ten, events: [], unreadable: [{ date }] }).free, false);
  assert.equal(checkSlot({ title: 'Run!', start: nine, end: ten, events: [{ title: 'run', start: new Date(2026, 10, 6, 15).toISOString(), end: new Date(2026, 10, 6, 16).toISOString(), date }] }).duplicate, true);
  assert.equal(checkSlot({ title: 'New', start: nine, end: ten, events: [] }).free, true);
  assert.equal(findSlot({ minutes: 60, days: 1, events: [{ title: 'all', start: nine.toISOString(), end: new Date(2026, 10, 6, 18).toISOString(), date }], now }), null);
});

test('an event running across days blocks the slots it covers on both days', () => {
  const stay = parseChip({ id: 'h', dk: '29030', lines: ['November 6, 2026 at 4pm to November 7, 2026 at 11am, Hotel stay, Calendar: Quinn', 'Hotel stay'] });
  const morning = new Date(2026, 10, 7, 9, 0), later = new Date(2026, 10, 7, 12, 0);
  assert.equal(checkSlot({ title: 'New', start: morning, end: new Date(2026, 10, 7, 9, 30), events: [stay] }).free, false);
  assert.equal(checkSlot({ title: 'New', start: later, end: new Date(2026, 10, 7, 12, 30), events: [stay] }).free, true);
});

test('the calendar read goes through Aside read-only and says plainly when it can\'t', async () => {
  const seen = [];
  const reply = (stdout) => async args => { seen.push(args); return { stdout }; };
  const page = JSON.stringify({ uid: 0, pages: [[
    { id: 'a', dk: '29027', lines: ['9am to 10am, Standup, Calendar: Q, No location, November 3, 2026', 'Standup', '9 – 10am'] },
    { id: 'a', dk: '29027', lines: ['9am to 10am, Standup, Calendar: Q, No location, November 3, 2026', 'Standup', '9 – 10am'] },
    { id: 'b', dk: null, lines: ['All day, Trip, Calendar: Q, No location, November 2 – 4, 2026', 'Trip'] },
    { id: 'b', dk: null, lines: ['All day, Trip, Calendar: Q, No location, November 2 – 4, 2026', 'Trip'] },
    { id: 'c', dk: '29028', lines: ['something else entirely'] }]] });
  const ok = createGoogleChannel({ run: reply(`[system] tabs\n${page}\n[ok | 9ms]\n`) });
  const got = await ok.readCalendar({ account: 'me@x.com', from: Date.now(), to: Date.now() + 86_400_000 });
  assert.deepEqual(got.events.map(e => e.title), ['Standup', 'Trip']);
  assert.equal(got.unreadable.length, 1);
  const code = seen[0][1];
  assert.match(code, /calendar\.google\.com/);
  assert.match(code, /googleAccounts\.list/, 'uids can shift, so the account is looked up by email every time');
  assert.doesNotMatch(code, /eventedit|\.click\(/, 'a read presses nothing');

  await assert.rejects(() => createGoogleChannel({ run: reply('{"missing":true}\n') }).readCalendar({ account: 'me@x.com' }), /isn't signed in to Aside/);
  await assert.rejects(() => createGoogleChannel({ run: reply('{"signedOut":true}\n') }).readCalendar({ account: 'me@x.com' }), /asked me@x.com to sign in/);
  await assert.rejects(() => createGoogleChannel({ run: reply('{"error":"the calendar page did not load"}\n') }).readCalendar({ account: 'me@x.com' }), /did not load/);
  await assert.rejects(() => createGoogleChannel({ run: async () => { throw new Error('Aside took too long to answer'); } }).readCalendar({ account: 'me@x.com' }), /Open Aside, then try again/);
  await assert.rejects(() => createGoogleChannel({ run: reply('nothing useful') }).readCalendar({ account: 'me@x.com' }), /gave no answer/);
});

test('adding an event uses Calendar\'s own form, checks the title landed, and says when it wasn\'t confirmed', async () => {
  const seen = [];
  const channel = createGoogleChannel({ run: async args => { seen.push(args[1]); return { stdout: '{"saved":true}\n' }; } });
  const start = new Date(2026, 10, 6, 9, 0), end = new Date(2026, 10, 6, 9, 30);
  assert.deepEqual(await channel.addEvent({ account: 'me@x.com', title: 'Read & sign', start, end, details: 'Go through it' }), { saved: true });
  assert.match(seen[0], /eventedit/);
  assert.match(seen[0], /20261106T090000%2F20261106T093000/);
  assert.match(seen[0], /Read\+%26\+sign/);
  assert.match(seen[0], /aria-label="Save"/);
  await assert.rejects(() => createGoogleChannel({ run: async () => ({ stdout: '{"saved":false}\n' }) }).addEvent({ account: 'me@x.com', title: 'T', start, end }), /didn't confirm the save/);
});

test('a thread reads as answered only when the person sent the last message, and bodies aren\'t read out', async () => {
  const seen = [];
  const t = createGoogleChannel({ run: async args => { seen.push(args[1]); return { stdout: JSON.stringify({ count: 3, last: { from: 'ME@x.com'.toLowerCase(), at: 'now' } }) + '\n' }; } });
  assert.equal((await t.threadStatus({ account: 'me@x.com', threadId: 't' })).answered, true);
  assert.doesNotMatch(seen[0], /\.body/);
  const u = createGoogleChannel({ run: async () => ({ stdout: JSON.stringify({ count: 3, last: { from: 'ana@x.com', at: 'now' } }) + '\n' }) });
  assert.equal((await u.threadStatus({ account: 'me@x.com', threadId: 't' })).answered, false);
  await assert.rejects(() => createGoogleChannel({ run: async () => ({ stdout: '{"count":0,"last":null}\n' }) }).threadStatus({ account: 'me@x.com', threadId: 't' }), /gone from me@x.com/);
});

test('a mail card is never proposed for an automated sender', async () => {
  const { isAutomatedSender } = await import('../reasoning/overnight-cards.js');
  for (const from of ['Julius Brussee <notifications@github.com>', 'noreply@example.com', 'no-reply@x.io', '"Bank" <alerts@bank.com>', 'do-not-reply@a.b', 'notifications+abc@x.com']) assert.equal(isAutomatedSender(from), true, from);
  for (const from of ['Julius Brussee <julius@example.com>', 'newsome@example.com', 'alert.person@x.com', '']) assert.equal(isAutomatedSender(from), false, from);
});

test('work waiting in automated mail is offered as a to-do, never a reply, and comes before the calendar', async () => {
  let asked = '';
  const chat = async ({ user }) => { asked = user; return JSON.stringify({ cards: [] }); };
  const day = 86_400_000, soon = new Date(Date.now() + day).toISOString(), over = new Date(Date.now() - 9 * day).toISOString();
  await proposeCards({ chat, calendarAccount: 'me@x.com', notes: [
    { id: 1, source: 'calendar', title: 'Dentist', summary: 'Dentist on Tuesday.', date: soon, ref: {} },
    { id: 2, source: 'calendar', title: 'Old party', summary: 'A party long gone.', date: over, ref: {} },
    { id: 3, source: 'mail', needsReply: true, title: 'PR 12 review', summary: 'A reviewer asked for changes.', ref: { from: 'A Reviewer <notifications@github.com>' } },
    { id: 4, source: 'mail', needsReply: true, title: 'Lunch', summary: 'Sam asks about lunch.', ref: { from: 'Sam <sam@friends.example>' } },
  ] });
  assert.match(asked, /\[3\] mail to_do automated from/);
  assert.match(asked, /\[4\] mail needs_reply from/);
  assert.doesNotMatch(asked, /\[3\] mail[^\n]*needs_reply/);
  assert.doesNotMatch(asked, /Old party/, 'an event long over has nothing left to prepare for');
  assert.ok(asked.indexOf('[3]') < asked.indexOf('[1]'), 'work comes before the calendar');
});

test('a calendar block for work seen in automated mail is a real candidate', async () => {
  const out = await proposeCards({ calendarAccount: 'me@x.com',
    notes: [{ id: 3, source: 'mail', needsReply: true, title: 'PR 12 review comments', summary: 'A reviewer asked for changes to the retry boundary on PR 12.', ref: { from: 'A Reviewer <notifications@github.com>' } }],
    chat: async () => JSON.stringify({ cards: [{ kind: 'calendar_block', note_ids: [3], title: 'Answer the review comments on PR 12', why: 'A reviewer asked for changes.', body: 'Time to change the retry boundary on PR 12.', minutes: 30 }] }) });
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].kind, 'calendar_block');
  assert.deepEqual(out.dropped, []);
});

test("a card's reason never speaks the prompt's language", () => {
  assert.equal(plainWhy('A reviewer asked for changes.', [{ title: 'PR 12' }]), 'A reviewer asked for changes.');
  assert.equal(plainWhy('Note 25 is marked to_do and shows changes are needed.', [{ title: 'PR 12 review' }]), 'From what came in overnight: PR 12 review.');
  assert.equal(plainWhy('this is a to_do', []), 'From what came in overnight.');
  assert.equal(plainWhy('A note 5 minutes long.', [{ title: 'x' }]), 'From what came in overnight: x.', 'a false alarm only costs the fancier wording');
});

test("a morning's blocks each get their own time, and a later night leaves the earlier one's time alone", () => database(async (pool, dir) => {
  const w = fakeChannel();
  const cards = createCards({ pool, channel: w.channel, vault: () => dir, log: silent });
  const block = n => blockCandidate({ title: `Block ${n}`, dedupeKey: `block:${n}:2026-11` });
  const { ready } = await cards.stage({ runId: null, candidates: [block('one'), block('two')], calendar: { events: [], unreadable: [] } });
  assert.equal(ready.length, 2);
  assert.notEqual(ready[0].payload.start, ready[1].payload.start);
  assert.ok(new Date(ready[0].payload.end) <= new Date(ready[1].payload.start), 'one after the other, not overlapping');
  const next = await cards.stage({ runId: null, candidates: [block('three')], calendar: { events: [], unreadable: [] } });
  assert.ok(ready.every(c => new Date(c.payload.end) <= new Date(next.ready[0].payload.start)), 'still held the next night');
}));
