// The integrations list: accounts signed in inside Aside, probed through its site skills, switched on or off for
// Oneiro, connected through Aside's own agent. Aside is faked here; nothing reaches a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { asideOpener, createAsideWaker, createIntegrations, scrub, outcomeOf, validAccount, signInTask, defaultLabel, plainCheckFailure } from '../reasoning/integrations.js';
import { clip, clipText } from '../reasoning/clip.js';
import { composeBrief } from '../reasoning/agents.js';
process.env.OCA_COMPANY_WORDS = 'acme';   // tests never read the person's own company list

const silent = { log() {}, warn() {} };
async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'integ_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema });
    await run(pool);
  } finally { if (pool) await pool.end(); await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end(); }
}

// A fake Aside: what each skill shows, and what its agent says when asked to sign in.
function fakeAside() {
  const w = {
    google: [{ uid: 0, account: 'person@gmail.com', name: 'Quinn O&#39;Donnell', avatar: 'https://lh3.googleusercontent.com/a/x' },
      { uid: 1, account: 'work@upaway.dev', name: 'Quinn O&#39;Donnell', avatar: 'https://lh3.googleusercontent.com/a/y' }],
    slack: [{ account: 'acme-llc', name: 'Acme' }],
    notion: null,                      // signed out: the skill throws "No token_v2 cookie"
    github: [{ account: 'Quinnod345', name: 'Quinnod345' }],
    linkedin: { error: 'fetch failed: ECONNRESET' },
    inbox: { total: 42, results: [{ subject: 'Your receipt', timestamp: '2026-11-05T09:00:00Z', isUnread: true, snippet: 'Thanks' }] },
    execOutput: 'Opened notion.so/login\nFilled the saved login.\nVerification code 482913 entered.\nCONNECTED: work@upaway.dev',
    onExec: null, calls: [],
  };
  w.run = async (args, { timeoutMs } = {}) => {
    w.calls.push({ args, timeoutMs });
    const [cmd, code] = args;
    const out = v => ({ stdout: `[system] no current open tabs in this session.\n${JSON.stringify(v)}\n[ok | 9ms]\n`, stderr: '' });
    if (cmd === 'exec') { await w.onExec?.(code); return { stdout: w.execOutput, stderr: '' }; }
    const m = code.match(/\/\*(probe|test|mail):(\w+)\*\//);
    if (!m) throw new Error('unexpected repl code');
    if (m[1] === 'probe') {
      const v = w[m[2]];
      if (v === null) return out({ error: 'No token_v2 cookie found — Notion session may be expired' });
      if (v.error) return out(v);
      return out({ accounts: v });
    }
    if (m[1] === 'test') {
      const acc = w.google.find(a => code.includes(JSON.stringify(a.account)));
      if (!acc) return out({ missing: true });
      return out({ uid: acc.uid, total: w.inbox.total, unread: 1, latestSubject: w.inbox.results[0].subject, latestAt: w.inbox.results[0].timestamp });
    }
    // mail:recent
    return out({ accounts: w.google.map(a => ({ account: a.account, uid: a.uid, total: 1, results: [{ threadId: `thread-f:${a.uid}`, subject: `Hello ${a.uid}`, snippet: 'Short preview', date: '2026-11-05T08:00:00Z', unread: true, from: 'Alice <alice@example.com>' }] })) });
  };
  return w;
}

async function everything(pool) {
  const { rows } = await pool.query('SELECT * FROM integrations');
  return JSON.stringify(rows);
}
const SECRETISH = [/482913/, /xoxc-/, /ghp_/, /hunter2/, /token_v2=/, /eyJ[\w-]+\./];

test('refresh finds both Google accounts with their uids and labels, Slack, GitHub; Notion signed out; a failed check keeps status', () => database(async pool => {
  const w = fakeAside();
  const integ = createIntegrations({ pool, run: w.run, log: silent });
  await integ.init();
  const r = await integ.refresh();
  const g = r.integrations.filter(i => i.provider === 'google');
  assert.deepEqual(g.map(i => [i.uid, i.account, i.label, i.status, i.enabled]), [
    [0, 'person@gmail.com', 'personal', 'connected', true],
    [1, 'work@upaway.dev', 'upaway', 'connected', true]]);
  assert.ok(g[0].capabilities.includes('mail') && g[0].capabilities.includes('calendar'));
  assert.equal(r.integrations.find(i => i.provider === 'slack').account, 'acme-llc');
  assert.equal(r.integrations.find(i => i.provider === 'github').account, 'quinnod345');
  assert.equal(r.integrations.some(i => i.provider === 'notion'), false, 'a signed-out provider with no rows makes none');
  assert.equal(r.refreshed.notion.ok, true);
  assert.equal(r.refreshed.linkedin.ok, false);
  // Each probe is its own repl call, bounded by a timeout.
  assert.equal(w.calls.filter(c => c.args[0] === 'repl').length, 5);
  assert.ok(w.calls.every(c => c.timeoutMs > 0 && c.timeoutMs <= 120_000));

  // Agents are told which accounts they may use.
  const line = await integ.briefLine();
  assert.match(line, /Google\/Gmail uid 0 person@gmail\.com \(personal\)/);
  assert.match(line, /Google\/Gmail uid 1 work@upaway\.dev \(upaway\)/);
  const brief = composeBrief({ kind: 'research', chainId: 7, want: 'w', task: 't', accounts: line });
  assert.match(brief, /Accounts you may use through Aside: Google\/Gmail uid 0/);
  assert.doesNotMatch(composeBrief({ kind: 'talker', chainId: 7, want: 'w', accounts: line }), /Accounts you may use/);
}));

test('an account that disappears is marked needs_sign_in; one that comes back is connected again with its new uid', () => database(async pool => {
  const w = fakeAside();
  const integ = createIntegrations({ pool, run: w.run, log: silent });
  await integ.init();
  await integ.refresh();
  w.google = [{ uid: 0, account: 'work@upaway.dev', name: 'Quinn' }];
  let r = await integ.refresh({ providers: ['google'] });
  const personal = r.integrations.find(i => i.account === 'person@gmail.com');
  assert.equal(personal.status, 'needs_sign_in');
  assert.match(personal.detail, /no longer signed in/);
  assert.equal(r.integrations.find(i => i.account === 'work@upaway.dev').uid, 0, 'uids follow what Google says now');
  assert.doesNotMatch(await integ.briefLine(), /person@gmail/);
  // A failed check doesn't flip a connected account.
  w.google = { error: 'fetch failed: ETIMEDOUT' };
  r = await integ.refresh({ providers: ['google'] });
  assert.equal(r.integrations.find(i => i.account === 'work@upaway.dev').status, 'connected');
  assert.match(r.integrations.find(i => i.account === 'work@upaway.dev').detail, /Couldn't check Google/);
  w.google = [{ uid: 0, account: 'person@gmail.com' }, { uid: 1, account: 'work@upaway.dev' }];
  r = await integ.refresh({ providers: ['google'] });
  assert.equal(r.integrations.find(i => i.account === 'person@gmail.com').status, 'connected');
}));

test('enable and disable; disconnect keeps the row, switched off, and never asks Aside to sign out', () => database(async pool => {
  const w = fakeAside();
  const integ = createIntegrations({ pool, run: w.run, log: silent });
  await integ.init();
  const { integrations } = await integ.refresh();
  const work = integrations.find(i => i.account === 'work@upaway.dev');
  assert.equal((await integ.setEnabled(work.id, false)).enabled, false);
  assert.doesNotMatch(await integ.briefLine(), /upaway/);
  assert.equal((await integ.setEnabled(work.id, true)).enabled, true);
  assert.match(await integ.briefLine(), /upaway/);
  const before = w.calls.length;
  const d = await integ.disconnect(work.id);
  assert.equal(d.status, 'disconnected');
  assert.equal(d.enabled, false);
  assert.match(d.detail, /still signed in to Aside/);
  assert.equal(w.calls.length, before, 'disconnecting touches no browser');
  // Seen signed in again, it stays disconnected and off.
  const again = (await integ.refresh({ providers: ['google'] })).integrations.find(i => i.id === work.id);
  assert.equal(again.status, 'disconnected');
  assert.equal(again.enabled, false);
  assert.equal(w.calls.some(c => /sign ?out|logout/i.test(c.args.join(' ')) && !/Do not sign out|do not sign out|Don't|sign out of anything/i.test(c.args.join(' '))), false);
  await assert.rejects(integ.setEnabled(99999, true), /no such account/);
}));

test('a connect job signs in through Aside\'s agent in the background, then refresh finds the account', () => database(async pool => {
  const w = fakeAside();
  const integ = createIntegrations({ pool, run: w.run, log: silent });
  await integ.init();
  await integ.refresh();
  let release;
  const gate = new Promise(r => { release = r; });
  w.execOutput = 'Opened https://www.notion.so/login\nSigned in with the saved password. The code was 482913 and token xoxc-1234567890-abcdef.\nCONNECTED: person@gmail.com';
  w.onExec = async () => { await gate; w.notion = [{ account: 'person@gmail.com', name: 'Quinn\'s Notion' }]; };
  const job = await integ.connect({ provider: 'notion', account: 'person@gmail.com' });
  assert.equal(job.status, 'running', 'returns at once');
  assert.equal(integ.job(job.id).status, 'running');
  const task = w.calls.find(c => c.args[0] === 'exec').args[1];
  assert.match(task, /saved password/);
  assert.match(task, /verification code, get it yourself/);
  assert.match(task, /do not sign out|Do not sign out/i);
  assert.match(task, /CAPTCHA/);
  assert.equal(await integ.connect({ provider: 'notion', account: 'person@gmail.com' }).then(j => j.id), job.id, 'the same connect while one runs is the same job');
  release();
  await integ.waitForJob(job.id);
  const done = integ.job(job.id);
  assert.equal(done.status, 'done');
  assert.match(done.line, /CONNECTED: person@gmail\.com/);
  const row = (await integ.list()).integrations.find(i => i.provider === 'notion');
  assert.equal(row.status, 'connected');
  assert.equal(row.enabled, true);
  // Nothing secret-looking was kept, in the job or the table.
  for (const re of SECRETISH) { assert.doesNotMatch(JSON.stringify(integ.jobs()), re); assert.doesNotMatch(await everything(pool), re); }

  // A blocked sign-in says why, and the account is not shown as connected.
  w.execOutput = 'Reached the sign-in page.\nBLOCKED: a CAPTCHA appeared on github.com/login';
  w.onExec = null;
  w.github = [];
  const blocked = await integ.connect({ provider: 'github', account: 'Quinnod345' });
  await integ.waitForJob(blocked.id);
  assert.equal(integ.job(blocked.id).status, 'failed');
  assert.match(integ.job(blocked.id).line, /BLOCKED: a CAPTCHA/);
  assert.equal((await integ.list()).integrations.find(i => i.provider === 'github').status, 'needs_sign_in');

  // Another site: Aside's report is the evidence.
  w.execOutput = 'CONNECTED: quinn on example.com';
  const other = await integ.connect({ provider: 'other', url: 'example.com/login' });
  await integ.waitForJob(other.id);
  assert.equal(integ.job(other.id).status, 'done');
  assert.equal((await integ.list()).integrations.find(i => i.provider === 'other').account, 'example.com');
  await assert.rejects(integ.connect({ provider: 'other' }), /site's address/);
  await assert.rejects(integ.connect({ provider: 'myspace' }), /unknown provider/);
  assert.throws(() => integ.job('nope'), /no such connect job/);
}));

test('connecting Google with no account named finds the account that was added', () => database(async pool => {
  const w = fakeAside();
  const integ = createIntegrations({ pool, run: w.run, log: silent });
  await integ.init();
  await integ.refresh();
  w.execOutput = 'CONNECTED: a new Google account';
  w.onExec = async () => { w.google = [...w.google, { uid: 2, account: 'quinn@nomelin.com', name: 'Quinn' }]; };
  const job = await integ.connect({ provider: 'google' });
  await integ.waitForJob(job.id);
  assert.equal(integ.job(job.id).status, 'done');
  const added = (await integ.list()).integrations.find(i => i.account === 'quinn@nomelin.com');
  assert.equal(added.uid, 2);
  assert.equal(added.label, 'nomelin');
  assert.equal(integ.job(job.id).integrationId, added.id);
  assert.match(signInTask({ provider: 'google' }), /accounts\.google\.com\/AddSession/);
  // Aside claiming success while Google shows nothing new is not success.
  w.onExec = null;
  const nothing = await integ.connect({ provider: 'google' });
  await integ.waitForJob(nothing.id);
  assert.equal(integ.job(nothing.id).status, 'failed');
  assert.match(integ.job(nothing.id).line, /doesn't show a new account/);
}));

test('test() reads the inbox without storing a subject; mail/recent returns headers for enabled accounts only', () => database(async pool => {
  const w = fakeAside();
  const integ = createIntegrations({ pool, run: w.run, log: silent });
  await integ.init();
  const { integrations } = await integ.refresh();
  const work = integrations.find(i => i.account === 'work@upaway.dev');
  const t = await integ.test(work.id);
  assert.equal(t.ok, true);
  assert.equal(t.uid, 1);
  assert.equal(t.total, 42);
  assert.equal(t.latestSubject, 'Your receipt');
  assert.doesNotMatch(await everything(pool), /Your receipt/, 'the subject is shown, not stored');
  const personal = integrations.find(i => i.account === 'person@gmail.com');
  await integ.setEnabled(personal.id, false);
  const mail = await integ.mailRecent({ since: Date.parse('2026-11-04T00:00:00Z') });
  assert.equal(mail.since, '2026-11-04T00:00:00.000Z');
  const code = w.calls.findLast(c => /mail:recent/.test(c.args[1] || '')).args[1];
  assert.match(code, /after:1793750400/);
  assert.doesNotMatch(code, /person@gmail/, 'a switched-off account is not read');
  assert.ok(mail.messages.every(m => m.subject && m.from && m.date && 'snippet' in m));
  assert.doesNotMatch(await everything(pool), /Short preview|Hello 1/, 'mail is passed through, never stored');
  // An account that went missing tells the test what to do.
  w.google = [];
  const gone = await integ.test(personal.id);
  assert.equal(gone.ok, false);
  assert.match(gone.error, /not signed in to Aside/);
}));

test('no secret-looking string is ever stored: accounts are emails or handles only, and Aside text is scrubbed', () => database(async pool => {
  assert.throws(() => validAccount('quinn@gmail.com password hunter2'), /email address or a handle/);
  assert.throws(() => validAccount('quinn:hunter2'), /email address or a handle/);
  assert.equal(validAccount('Work@Upaway.dev'), 'work@upaway.dev');
  const s = scrub('Signed in. Your code is 482913; password: hunter2; token xoxc-12345-abcdef; ghp_abcdefghijklmnopqrstuvwxyz012345; eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl');
  for (const re of SECRETISH) assert.doesNotMatch(s, re);
  assert.equal(outcomeOf('step one\n**BLOCKED: needs the 6-digit code 123456 that never arrived**').kind, 'blocked');
  assert.doesNotMatch(outcomeOf('BLOCKED: code 123456').line, /123456/);
  assert.equal(defaultLabel('google', 'a@gmail.com'), 'personal');

  const w = fakeAside();
  w.slack = { error: 'invalid_auth for token xoxc-99999-zzzz' };
  w.execOutput = 'I typed the password hunter2 and code 482913.\nCONNECTED: Quinnod345';
  const integ = createIntegrations({ pool, run: w.run, log: silent });
  await integ.init();
  await integ.refresh();
  const job = await integ.connect({ provider: 'github', account: 'Quinnod345' });
  await integ.waitForJob(job.id);
  const all = await everything(pool) + JSON.stringify(integ.jobs()) + JSON.stringify(await integ.list());
  for (const re of SECRETISH) assert.doesNotMatch(all, re);
  await assert.rejects(integ.connect({ provider: 'google', account: 'me@gmail.com hunter2' }), /email address or a handle/);
}));

test('a check that can\'t run says so once, plainly, and stops claiming the account was just seen connected', () => database(async pool => {
  const { plainCheckFailure } = await import('../reasoning/integrations.js');
  const raw = 'Aside Browser profile for account u0 — quin***@icloud.com ("Profile 0") is not connected to the daemon. Make sure that profile is running, or pick another account with --account.';
  assert.equal(plainCheckFailure('Google', raw), "Oneiro couldn't reach Aside to check this just now. Open Aside, then press Test.");
  assert.doesNotMatch(plainCheckFailure('Google', 'something broke. Pick one with --account.'), /--account/);
  assert.match(plainCheckFailure('Google', 'fetch failed: ETIMEDOUT'), /Couldn't check Google just now: fetch failed: ETIMEDOUT\. Try again/);
  const w = fakeAside();
  const integ = createIntegrations({ pool, run: w.run, log: silent });
  await integ.init();
  let r = await integ.refresh({ providers: ['google'] });
  const seen = r.integrations.find(i => i.provider === 'google');
  assert.equal(seen.checkFailed, false); assert.ok(seen.lastConnectedAt, 'a real sighting is recorded');
  w.google = { error: raw };
  r = await integ.refresh({ providers: ['google'] });
  const failed = r.integrations.find(i => i.id === seen.id);
  assert.equal(failed.status, 'connected', 'what it last knew stays'); assert.equal(failed.checkFailed, true);
  assert.equal(new Date(failed.lastConnectedAt).getTime(), new Date(seen.lastConnectedAt).getTime(), 'a failed check is not a sighting');
  assert.doesNotMatch(failed.detail, /daemon|--account/);
  w.google = [{ uid: 0, account: seen.account }];
  r = await integ.refresh({ providers: ['google'] });
  assert.equal(r.integrations.find(i => i.id === seen.id).checkFailed, false);
}));

test('when Aside can\'t be run, a check says so in words, never the command line and script it tried', async () => database(async pool => {
  const script = `Command failed: /usr/local/bin/aside repl /*probe:github*/ await (async () => { try { const r = await fetch('https://github.com/') } catch (e) {} })();`;
  const run = async () => { throw Object.assign(new Error(script), { code: 1 }); };
  const integ = createIntegrations({ pool, run, log: silent });
  await integ.init();
  const { refreshed } = await integ.refresh({ providers: ['github'] });
  assert.equal(refreshed.github.ok, false);
  assert.equal(refreshed.github.error, 'Aside didn’t answer.');
  assert.doesNotMatch(JSON.stringify(refreshed), /probe:github|Command failed|fetch\(/);
  assert.match(plainCheckFailure('GitHub', refreshed.github.error), /couldn't reach Aside.*Open Aside/, 'and it counts as Aside being away, not the account failing');
}));

// ---- opening Aside: everything below stubs Aside. Nothing quits, opens or reads the real app. --------------------------
const NOT_CONNECTED = 'Aside Browser profile for account u0 — someone***@icloud.com ("Profile 0") is not connected to the daemon. Make sure that profile is running, or pick another account with --account.';
const stepped = (start = 1_000_000) => { let now = start; return { clock: () => now, sleep: async ms => { now += ms; }, advance: ms => { now += ms; } }; };
const alive = '{"alive":true}\n';

test('waking Aside: opens it in the background, waits for a profile, and runs the read once more', async () => {
  const t = stepped();
  let up = false, opened = 0, reads = 0;
  const run = async args => { if (!up) throw new Error(NOT_CONNECTED); return { stdout: args[1].includes('aside:alive') ? alive : (reads++, '{"accounts":[]}\n'), stderr: '' }; };
  const said = [];
  const log = { log: (...a) => said.push(a.join(' ')), warn: (...a) => said.push(a.join(' ')) };
  const aside = createAsideWaker({ run, open: async () => { opened++; t.advance(5000); up = true; }, ...t, log });
  const out = await aside.wrap()(['repl', 'code'], { timeoutMs: 1000 });
  assert.equal(opened, 1); assert.equal(reads, 1); assert.equal(out.stdout, '{"accounts":[]}\n');
  assert.doesNotMatch(said.join(' '), /icloud|Profile 0|someone|--account/, 'no account detail in the log');
});

test('waking Aside is bounded, at most once a minute, shared by callers at the same moment, and gives the same failure back', async () => {
  const t = stepped();
  let opened = 0, checks = 0;
  const run = async args => { if (args[1].includes('aside:alive')) checks++; throw new Error(NOT_CONNECTED); };
  const aside = createAsideWaker({ run, open: async () => { opened++; }, ...t, log: silent });
  const wrapped = aside.wrap();
  const started = t.clock();
  const all = await Promise.allSettled(['google', 'slack', 'notion'].map(p => wrapped(['repl', p], {})));
  assert.equal(opened, 1, 'three failures at once: one open');
  assert.ok(all.every(r => r.status === 'rejected' && /not connected/.test(r.reason.message)));
  assert.ok(t.clock() - started >= 60_000 && t.clock() - started <= 64_000, 'about 60 seconds, then it stops waiting');
  assert.ok(checks >= 2 && checks <= 21, String(checks));
  // Inside the minute: no second open, no second wait.
  const before = t.clock();
  await assert.rejects(wrapped(['repl', 'x'], {}));
  assert.equal(opened, 1); assert.equal(t.clock(), before);
  // A minute on it may try again.
  t.advance(60_001);
  await assert.rejects(wrapped(['repl', 'x'], {}));
  assert.equal(opened, 2);
});

test('waking Aside: nothing else counts, nothing but a repl is run twice, and no opener means nothing is opened', async () => {
  const t = stepped();
  let opened = 0, runs = 0;
  const open = async () => { opened++; };
  const siteError = async () => { runs++; return { stdout: '{"error":"Gmail said 500"}\n', stderr: '' }; };
  assert.deepEqual(await createAsideWaker({ run: siteError, open, ...t, log: silent }).wrap()(['repl', 'x'], {}), { stdout: '{"error":"Gmail said 500"}\n', stderr: '' });
  assert.deepEqual([opened, runs], [0, 1], 'a site failing is not Aside being closed');
  runs = 0;
  await assert.rejects(createAsideWaker({ run: async () => { runs++; throw new Error(NOT_CONNECTED); }, open, ...t, log: silent }).wrap()(['exec', 'sign in'], {}));
  assert.deepEqual([opened, runs], [0, 1], 'a sign-in is never repeated');
  runs = 0;
  const closed = createAsideWaker({ run: async () => { runs++; throw new Error(NOT_CONNECTED); }, ...t, log: silent });
  await assert.rejects(closed.wrap()(['repl', 'x'], {}));
  assert.equal(runs, 1); assert.deepEqual(await closed.ensure(), { tried: false, answering: null });
  // A failure to open at all is said, not waited on.
  const broken = createAsideWaker({ run: async () => { throw new Error(NOT_CONNECTED); }, open: async () => { throw new Error('no such app'); }, ...t, log: silent });
  const before = t.clock();
  assert.deepEqual(await broken.wake(), { tried: true, openFailed: true, answering: false });
  assert.equal(t.clock(), before); assert.equal(broken.lastTry().openFailed, true);
});

test('a JSON error or a stderr message about the profile wakes it too, and a probe recovers', () => database(async pool => {
  const t = stepped();
  let up = false, opened = 0;
  const run = async args => {
    if (args[1].includes('aside:alive')) return up ? { stdout: alive, stderr: '' } : { stdout: '', stderr: NOT_CONNECTED };
    if (!up) return { stdout: JSON.stringify({ error: NOT_CONNECTED }) + '\n', stderr: '' };
    return { stdout: JSON.stringify({ accounts: [{ uid: 0, account: 'me@gmail.com', name: 'Me' }] }) + '\n', stderr: '' };
  };
  const aside = createAsideWaker({ run, open: async () => { opened++; up = true; }, ...t, log: silent });
  const integ = createIntegrations({ pool, run: aside.wrap(), log: silent });
  await integ.init();
  const r = await integ.refresh({ providers: ['google'] });
  assert.equal(opened, 1);
  assert.equal(r.refreshed.google.ok, true);
  assert.equal(r.integrations.find(i => i.account === 'me@gmail.com').checkFailed, false);
}));

test('mail/recent opens Aside on its first such failure and reads', () => database(async pool => {
  const t = stepped();
  let up = false, opened = 0;
  const run = async args => {
    if (!up) throw new Error(NOT_CONNECTED);
    if (args[1].includes('aside:alive')) return { stdout: alive, stderr: '' };
    return { stdout: JSON.stringify({ accounts: [{ account: 'me@gmail.com', uid: 0, total: 0, results: [] }] }) + '\n', stderr: '' };
  };
  const aside = createAsideWaker({ run, open: async () => { opened++; up = true; }, ...t, log: silent });
  const integ = createIntegrations({ pool, run: aside.wrap(), log: silent });
  await integ.init();
  await pool.query(`INSERT INTO integrations (provider, account, label, uid, capabilities, enabled, status, detail) VALUES ('google', 'me@gmail.com', 'personal', 0, '{mail}', true, 'connected', 'x')`);
  const out = await integ.mailRecent({ since: 1 });
  assert.equal(opened, 1);
  assert.equal(out.accounts[0].ok, true);
}));

test('how Aside gets opened: in the background, and never with a stand-in CLI unless told how', async () => {
  const calls = [];
  const exec = (cmd, args, _o, done) => { calls.push([cmd, ...args]); done(null); };
  await asideOpener({}, exec)();
  assert.deepEqual(calls, [['/usr/bin/open', '-g', '-a', 'Aside']]);
  assert.equal(asideOpener({ OCA_ASIDE_CLI: '/tmp/stub' }, exec), null);
  await asideOpener({ OCA_ASIDE_CLI: '/tmp/stub', OCA_ASIDE_OPEN_CMD: '/tmp/open-stub' }, exec)();
  assert.deepEqual(calls[1], ['/tmp/open-stub']);
});

test('words are shortened at a sentence or a word, never inside one', () => {
  const long = 'Aside Browser profile for account u0 is not connected. Make sure that profile is running, or pick another account with some flag.';
  assert.equal(clip(long, 500), long);
  assert.equal(clip(long, 100), 'Aside Browser profile for account u0 is not connected.', 'a finished sentence when one keeps enough');
  assert.equal(clip('one two three four five six seven', 20), 'one two three four…');
  assert.ok(clip('x'.repeat(50), 20).length <= 20, 'one long token still fits');
  assert.equal(clipText('  a   b\n c ', 10), 'a b c');
  for (let max = 20; max < long.length; max += 3) {
    const cut = clip(long, max);
    assert.ok(cut.length <= max, `${max}: ${cut}`);
    const words = cut.replace(/[….]$/, '').split(' ');
    assert.ok(words.every(w => long.includes(w)) && long.split(' ').map(w => w.replace(/[.,]$/, '')).includes(words.at(-1).replace(/[.,]$/, '')), `${max}: "${cut}" ended inside a word`);
  }
  assert.doesNotMatch(scrub(NOT_CONNECTED, 160), /accou$/);
});
