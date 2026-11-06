// The accounts Oneiro may use. Every account lives in Aside, the engine's one browser: Aside holds the cookies and
// Quinn's saved passwords, and its own agent signs in, fetching any verification code from Messages or Gmail itself.
// This module only keeps the list: which accounts are signed in right now (probed through Aside's site skills, which
// read the browser's session without opening a tab), which ones Quinn lets Oneiro use, and plain words about the last
// check. No password, token, cookie or verification code ever passes through here: the account field takes an email or
// a handle and nothing else, and everything Aside says back is scrubbed before it is stored or returned.
//
// Disconnecting is Oneiro's side only: the row stays, switched off and marked disconnected. Nothing here signs out of
// a browser account, changes an account setting, or grants a site anything.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Router } from 'express';
import { ASIDE_CLI, validateUrl } from '../aside.js';
import { clip, clipText as text } from './clip.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'" };
const decode = s => String(s ?? '').replace(/&(amp|lt|gt|quot|apos|#39|#x27);/g, (_, k) => ENTITIES[k]);

export const PROVIDERS = {
  google: { name: 'Google', capabilities: ['mail', 'calendar', 'docs', 'sheets', 'drive'], signIn: 'https://accounts.google.com/AddSession' },
  slack: { name: 'Slack', capabilities: ['chat'], signIn: 'https://slack.com/signin' },
  notion: { name: 'Notion', capabilities: ['notes', 'docs'], signIn: 'https://www.notion.so/login' },
  github: { name: 'GitHub', capabilities: ['code', 'issues'], signIn: 'https://github.com/login' },
  linkedin: { name: 'LinkedIn', capabilities: ['network', 'messages'], signIn: 'https://www.linkedin.com/login' },
  other: { name: 'Other site', capabilities: ['web'], signIn: null },
};
export const PROBED = ['google', 'slack', 'notion', 'github', 'linkedin'];
export const STATUSES = ['connected', 'needs_sign_in', 'checking', 'error', 'disconnected'];

// An email, a handle, a workspace slug or a host. Spaces, colons and quotes are refused, so a password or a pasted
// "user:pass" can't be stored as an account.
const ACCOUNT = /^[A-Za-z0-9._%+@-]{1,200}$/;
export function validAccount(account) {
  const a = text(account, 200);
  if (!a) return '';
  if (!ACCOUNT.test(a)) throw new Error('an account is an email address or a handle, nothing else');
  return a.toLowerCase();
}

// What Aside's agent says back can quote a page. Anything that could be a secret is hidden before it is kept.
export function scrub(s, max = 300) {
  return text(String(s ?? '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\b(xox[a-z]-[\w-]+|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[\w]{16,}|sk-[\w-]{16,}|ya29\.[\w.-]+|AIza[\w-]{20,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)/g, '[hidden]')
    .replace(/\b(password|passcode|passwd|pwd|token|secret|api[ _-]?key|code|otp|pin)\b(\s*(is|was|:|=)\s*)(?!(?:in|not|saved|stored|required|needed|missing|set|the|a|an|available|incorrect|wrong|invalid|expired|sent|being|still|already|to|for|on|from|no|none)\b)\S+/gi, '$1 [hidden]')
    .replace(/[A-Za-z0-9_+/=-]{32,}/g, '[hidden]')
    .replace(/\b\d{4,8}\b/g, '[number hidden]'), max);
}

// Google calls a gmail.com account personal; any other domain is named after itself (upaway.dev → upaway).
export function defaultLabel(provider, account, name = '') {
  if (provider === 'google') {
    const domain = String(account).split('@')[1] || '';
    return /^(gmail|googlemail)\.com$/i.test(domain) ? 'personal' : domain.split('.')[0] || null;
  }
  return text(name, 80) || null;
}

const wrap = (body, provider) => `/*probe:${provider}*/ await (async () => { try { ${body} } catch (e) { console.log(JSON.stringify({ error: String((e && e.message) || e).slice(0, 300) })); } })();`;
// One cheap check per provider, each run in its own `aside repl` so a slow one (Slack takes ~20 s) never holds the
// others up. Each prints one JSON line: { accounts: [...] } or { error }.
export const PROBES = {
  google: wrap(`const a = await googleAccounts.list(); console.log(JSON.stringify({ accounts: a.map(x => ({ uid: x.accountId, account: x.email, name: x.name, avatar: x.profileImageUrl })) }));`, 'google'),
  slack: wrap(`const w = await slack.listWorkspaces(); console.log(JSON.stringify({ accounts: w.filter(x => x.status !== 'pending-invite').map(x => ({ account: x.slug || x.teamId, name: x.name, avatar: x.iconUrl, signedOut: x.status === 'needs-login' })) }));`, 'slack'),
  notion: wrap(`const a = await notion.listAccounts(); console.log(JSON.stringify({ accounts: (Array.isArray(a) ? a : []).map(x => ({ account: x.email || (x.user && x.user.email) || x.id, name: (Array.isArray(x.workspaces) ? x.workspaces.map(w => w && (w.name || w.spaceName)).filter(Boolean).join(', ') : '') || x.workspaceName || x.fullName || x.name || '' })).filter(x => x.account) }));`, 'notion'),
  github: wrap(`const r = await fetch('https://github.com/', { redirect: 'manual' }); const t = await r.text(); const m = t.match(/<meta name="user-login" content="([^"]+)"/); console.log(JSON.stringify({ accounts: m ? [{ account: m[1], name: m[1] }] : [] }));`, 'github'),
  linkedin: wrap(`const me = await linkedin.getMe(); const m = (me.included || []).find(i => i.$type === 'com.linkedin.voyager.identity.shared.MiniProfile'); console.log(JSON.stringify({ accounts: m && m.publicIdentifier ? [{ account: m.publicIdentifier, name: [m.firstName, m.lastName].filter(Boolean).join(' ') }] : [] }));`, 'linkedin'),
};
// A skill that can't find a session says so; that is "signed out", not a failure.
// Aside's own plumbing failing says nothing about the account being checked.
export const ASIDE_UNREACHABLE = /not connected to the daemon|\bcdp\b|page\.enable|target closed|econnrefused|spawn \S*aside\S* enoent|aside gave no answer|^aside failed$|aside didn.t answer|aside.s browser wasn.t open/i;
/**
 * A check that couldn't run, in plain English with the fix. Command-line words (--account) don't reach the person, and
 * a line is shortened at a word, never inside one. `verb` and `retry` fit it to where it's shown. Pure.
 */
export function plainCheckFailure(name, error, { verb = 'check', retry = 'Try again in a moment, or press Test.' } = {}) {
  const why = String(error ?? '');
  if (ASIDE_UNREACHABLE.test(why)) return "Oneiro couldn't reach Aside to check this just now. Open Aside, then press Test.";
  const said = clip(why.split(/(?<=[.!?])\s+/).filter(s => !/--[a-z]/i.test(s)).join(' ').trim(), 200);
  return `Couldn't ${verb} ${name} just now${said ? `: ${said}` : '.'}${/[.!?…]$/.test(said) || !said ? '' : '.'} ${retry}`;
}
const SIGNED_OUT = /expired|not (logged|signed) ?in|no [\w ]*cookie|log ?in|sign ?in|unauthori[sz]ed|\b401\b|\b403\b|session/i;

const lastJson = out => { for (const l of String(out ?? '').trim().split('\n').reverse()) { try { const v = JSON.parse(l); if (v && typeof v === 'object') return v; } catch {} } return null; };

export function defaultRunner(cli = ASIDE_CLI) {
  return (args, { timeoutMs = 115_000 } = {}) => new Promise((resolve, reject) => {
    execFile(cli, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' } }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(new Error(err.killed ? 'Aside took too long to answer' : scrub(stderr || err.message, 200) || 'Aside failed'));
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// ---- opening Aside when its browser is closed --------------------------------------------------------------------
// Aside's daemon stays up with its browser closed, and then every read fails with "not connected to the daemon". So the
// engine opens the app, in the background and without taking focus, and waits a bounded time for a profile to answer.
// It doesn't sign anything in or out, doesn't touch an account, and writes no account detail anywhere: what Aside said
// back is only ever tested, never logged or kept.
//
// `open: null` is the default and means "never open anything", so a test or a stand-in CLI can't reach the real app.
// Only the engine's own wiring (api-routes.js) passes an opener.
const PROFILE_CHECK = `/*aside:alive*/ console.log(JSON.stringify({ alive: true }));`;
const said = r => (r.error ? String(r.error.message ?? r.error) : (() => { const j = lastJson(r.out?.stdout); return j ? String(j.error ?? '') : `${r.out?.stderr ?? ''} ${r.out?.stdout ?? ''}`; })());

/** How this engine opens Aside. A stand-in CLI means it isn't using the real app, so it opens nothing unless told how. */
export function asideOpener(env = process.env, exec = execFile) {
  const launch = (cmd, args) => () => new Promise((ok, no) => exec(cmd, args, { timeout: 15_000 }, e => (e ? no(e) : ok())));
  if (env.OCA_ASIDE_OPEN_CMD) return launch(env.OCA_ASIDE_OPEN_CMD, []);
  return env.OCA_ASIDE_CLI ? null : launch('/usr/bin/open', ['-g', '-a', 'Aside']);
}

/** How the engine puts a page in front of the person: a tab of Aside's own, which outlives any `aside repl` run. */
export function asideUrlOpener(env = process.env, exec = execFile) {
  if (env.OCA_ASIDE_CLI) return null;
  return url => new Promise((ok, no) => exec('/usr/bin/open', ['-a', 'Aside', url], { timeout: 15_000 }, e => (e ? no(e) : ok())));
}

export function createAsideWaker({ run, open = null, clock = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)), log = console, waitMs = 60_000, pollMs = 3_000, gapMs = 60_000, checkTimeoutMs = 20_000 } = {}) {
  let inFlight = null, endedAt = -Infinity, last = null;
  const answers = async () => { try { return lastJson((await run(['repl', PROFILE_CHECK], { timeoutMs: checkTimeoutMs })).stdout)?.alive === true; } catch { return false; } };

  // Open it and wait for a profile. At most once a minute, counted from when the last try ended, so a night whose reads
  // all fail waits once rather than once per read. Callers that arrive during a try share it.
  function wake() {
    if (inFlight) return inFlight;
    if (!open || clock() - endedAt < gapMs) return Promise.resolve({ tried: false, answering: false });
    inFlight = (async () => {
      let answering = false, openFailed = false;
      const startedAt = clock();
      try { await open(); } catch { openFailed = true; }
      if (!openFailed) {
        const deadline = clock() + waitMs;
        while (!answering && clock() < deadline) { await sleep(pollMs); answering = await answers(); }
      }
      last = { at: startedAt, openFailed, answering };
      log.log?.(`[aside] ${openFailed ? "couldn't open its browser" : answering ? 'opened its browser, and a profile answered' : 'opened its browser, but no profile answered in time'}`);
      return { tried: true, openFailed, answering };
    })().finally(() => { endedAt = clock(); inFlight = null; });
    return inFlight;
  }
  // Before a night reads: if no profile answers, try opening it.
  async function ensure() {
    if (!open) return { tried: false, answering: null };
    return (await answers()) ? { tried: false, answering: true } : wake();
  }
  // The same runner, except that a `repl` that couldn't reach a profile opens Aside and runs once more. Anything else
  // Aside says, a site's own error included, comes back untouched.
  function wrap(runner = run) {
    return async (args, options) => {
      if (args?.[0] !== 'repl' || !open) return runner(args, options);
      const attempt = () => runner(args, options).then(out => ({ out }), error => ({ error }));
      let r = await attempt();
      if (ASIDE_UNREACHABLE.test(said(r))) { await wake(); r = await attempt(); }
      if (r.error) throw r.error;
      return r.out;
    };
  }
  return { ensure, wake, wrap, answers, lastTry: () => last };
}

/** The one line a night says when Aside's browser kept it from reading: once per night, however many accounts. Pure. */
export function asideAwayLine(sources, lastTry = null) {
  const what = sources.join(' and ');
  const tried = lastTry?.openFailed ? " Oneiro couldn't open it." : lastTry ? ' It tried to open it.' : '';
  return `Aside's browser wasn't open, so ${what} couldn't be read.${tried} Open Aside, then press Run now.`;
}

// The task Aside's agent gets for a sign-in. The password and any code stay inside Aside.
export function signInTask({ provider, account = '', url = null }) {
  const p = PROVIDERS[provider];
  const where = provider === 'google'
    ? `Add a Google account to this browser so it is signed in alongside the accounts already there: go to ${p.signIn}${account ? ` and sign in as ${account}` : ''}. Do not remove or sign out of the accounts already signed in.`
    : `Sign in to ${provider === 'other' ? url : `${p.name} (${p.signIn})`}${account ? ` as ${account}` : ''}. If it already shows you signed in${account ? ' as that account' : ''}, change nothing and just confirm it.`;
  return `${where}
Sign in with the saved password for this site from Aside's password manager. If there is no saved password but the site offers "Continue with Google" for an account already signed in to this browser, or a sign-in code sent by email, use that instead (only to sign in to an account that already exists). If Google asks to share more than name, email address and profile picture with the site, stop. If it asks for a verification code, get it yourself and enter it: for a text or iMessage code use Aside's Messages skill (imessage.waitForCode()); for an email code read it from Gmail in an account that is already signed in (google-gmail skill). Enter a code only into the step that asked for it.
Never type a password or code anywhere else, and never write a password, code, key or token in your answer. Do not sign out of anything, do not change any account or security setting, do not create an account, do not grant any app or OAuth permission beyond what signing in itself needs, and do not buy anything. If a CAPTCHA or bot check appears, or a code can't be fetched, stop.
End your answer with one line: CONNECTED: <the account now signed in> or BLOCKED: <exactly what stopped you>.`;
}

// The outcome line of an Aside transcript: CONNECTED/BLOCKED if it said one, else its last line.
export function outcomeOf(output) {
  const lines = String(output ?? '').replace(/\x1b\[[0-9;]*m/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  const said = [...lines].reverse().find(l => /^(\**)?(CONNECTED|BLOCKED|DONE)\b\**:?/i.test(l));
  const line = said || lines.at(-1) || 'Aside returned nothing.';
  const kind = /^\**BLOCKED/i.test(line) ? 'blocked' : /^\**(CONNECTED|DONE)/i.test(line) ? 'connected' : 'unclear';
  return { kind, line: scrub(line.replace(/^\*+|\*+$/g, ''), 300) };
}

export function createIntegrations({ pool, run = defaultRunner(), clock = Date.now, log = console, jobTimeoutMs = 10 * 60_000, probeTimeoutMs = 110_000, imessageLine = null } = {}) {
  const jobs = new Map();

  async function init() {
    await pool.query(await readFile(new URL('../migrations/069_integrations.sql', import.meta.url), 'utf8'));
  }

  const rowOf = r => r && ({ id: r.id, checkFailed: r.check_failed === true, lastConnectedAt: r.last_connected_at || null, provider: r.provider, providerName: PROVIDERS[r.provider]?.name || r.provider, account: r.account, label: r.label,
    uid: r.uid, capabilities: r.capabilities || [], enabled: r.enabled, status: r.status, detail: r.detail, avatarUrl: r.avatar_url, site: r.site,
    checkedAt: r.checked_at, addedAt: r.added_at });

  async function list() {
    const { rows } = await pool.query(`SELECT * FROM integrations ORDER BY array_position($1::text[], provider), coalesce(uid, 99), account`, [Object.keys(PROVIDERS)]);
    return { integrations: rows.map(rowOf), providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, name: p.name, capabilities: p.capabilities, probed: PROBED.includes(id) })),
      jobs: [...jobs.values()].filter(j => j.status === 'running').map(jobOf),
      // The engine's own line to Quinn, for the page's Engine section: whether texts are set up and getting through.
      imessage: imessageLine ? (() => { try { return imessageLine(); } catch { return null; } })() : null };
  }
  async function get(id) {
    const { rows } = await pool.query('SELECT * FROM integrations WHERE id = $1', [Number(id)]);
    if (!rows[0]) throw Object.assign(new Error('no such account'), { status: 404 });
    return rowOf(rows[0]);
  }

  // A failed run of the CLI: its message is the whole command line, script and all, which is nothing to show a person.
  const asideDown = e => (/^Command failed|ENOENT|ETIMEDOUT|timed out/.test(String(e?.message)) || e?.code === 'ENOENT' || e?.killed) ? 'Aside didn\u2019t answer.' : scrub(e?.message, 200);
  // Probe one provider through Aside. { accounts: [...] } when it could tell, { error } when it couldn't.
  async function probe(provider) {
    try {
      const { stdout, stderr } = await run(['repl', PROBES[provider]], { timeoutMs: probeTimeoutMs });
      const j = lastJson(stdout);
      if (!j) return { error: scrub(stderr || stdout, 200) || 'Aside gave no answer' };
      if (j.error) return SIGNED_OUT.test(j.error) ? { accounts: [], signedOutBecause: scrub(j.error, 200) } : { error: scrub(j.error, 200) };
      return { accounts: (j.accounts || []).filter(a => a && a.account) };
    } catch (e) { return { error: asideDown(e) || 'Aside didn\u2019t answer.' }; }
  }

  async function upsert(provider, a, { status, detail }) {
    const account = validAccount(a.account);
    if (!account) return null;
    const label = defaultLabel(provider, account, decode(a.name));
    const caps = PROVIDERS[provider].capabilities;
    // A row Quinn disconnected stays disconnected (and off) however often it is seen signed in.
    const { rows } = await pool.query(`INSERT INTO integrations (provider, account, label, uid, capabilities, enabled, status, detail, avatar_url, checked_at, last_connected_at)
      VALUES ($1, $2, $3, $4, $5, true, $6::text, $7, $8, $9, CASE WHEN $6::text = 'connected' THEN $9::timestamptz END)
      ON CONFLICT (provider, account) DO UPDATE SET uid = EXCLUDED.uid, avatar_url = coalesce(EXCLUDED.avatar_url, integrations.avatar_url), checked_at = EXCLUDED.checked_at,
        check_failed = false, last_connected_at = CASE WHEN EXCLUDED.status = 'connected' THEN EXCLUDED.checked_at ELSE integrations.last_connected_at END,
        label = coalesce(integrations.label, EXCLUDED.label),
        status = CASE WHEN integrations.status = 'disconnected' THEN 'disconnected' ELSE EXCLUDED.status END,
        detail = CASE WHEN integrations.status = 'disconnected' THEN integrations.detail ELSE EXCLUDED.detail END
      RETURNING *`,
      [provider, account, label, Number.isInteger(a.uid) ? a.uid : null, caps, status, scrub(detail, 300), /^https:\/\//.test(a.avatar || '') ? String(a.avatar).slice(0, 600) : null, new Date(clock())]);
    return rowOf(rows[0]);
  }

  // Probe every provider that has a cheap check (or the ones named), record what each shows, and mark accounts that
  // are no longer signed in. A provider whose check failed keeps its rows' status; the failure goes in their detail.
  async function refresh({ providers = PROBED } = {}) {
    const wanted = providers.filter(p => PROBED.includes(p));
    const results = await Promise.all(wanted.map(async p => [p, await probe(p)]));
    const summary = {};
    for (const [provider, r] of results) {
      const now = new Date(clock());
      if (r.error) {
        // The account may be fine; the check couldn't run. It says so, and the row stops claiming it just saw it connected.
        await pool.query(`UPDATE integrations SET detail = $2, checked_at = $3, check_failed = true WHERE provider = $1 AND status <> 'disconnected'`,
          [provider, plainCheckFailure(PROVIDERS[provider].name, r.error), now]);
        summary[provider] = { ok: false, error: r.error };
        continue;
      }
      const seen = [];
      for (const a of r.accounts) {
        const out = a.signedOut
          ? { status: 'needs_sign_in', detail: `${PROVIDERS[provider].name} says this session has expired. Connect it again to sign back in.` }
          : { status: 'connected', detail: provider === 'google' ? `Signed in as Google account ${a.uid}.` : `Signed in.` };
        try { const row = await upsert(provider, a, out); if (row) seen.push(row.account); }
        catch (e) { log.warn?.(`[integrations] ${provider}: skipped an account Aside listed: ${e.message}`); }
      }
      const gone = await pool.query(`UPDATE integrations SET status = 'needs_sign_in', checked_at = $3, check_failed = false,
          detail = $4 WHERE provider = $1 AND NOT (account = ANY($2::text[])) AND status NOT IN ('disconnected', 'needs_sign_in') RETURNING id`,
        [provider, seen, now, r.signedOutBecause ? `Not signed in to ${PROVIDERS[provider].name} in Aside any more. Connect it to sign in again.` : `This account is no longer signed in to Aside. Connect it to sign in again.`]);
      summary[provider] = { ok: true, accounts: seen.length, signedOut: gone.rowCount };
    }
    return { ...(await list()), refreshed: summary };
  }

  const jobOf = j => ({ id: j.id, provider: j.provider, account: j.account || null, url: j.url || null, status: j.status, line: j.line, startedAt: j.startedAt, finishedAt: j.finishedAt || null, integrationId: j.integrationId || null });

  // Sign an account in through Aside's own agent, in the background. Returns the job at once; poll job(id).
  async function connect({ provider, account = '', url = null } = {}) {
    if (!PROVIDERS[provider]) throw new Error(`unknown provider "${text(provider, 40)}": choose ${Object.keys(PROVIDERS).join(', ')}`);
    const acct = validAccount(account);
    let site = null;
    if (provider === 'other') {
      if (!url) throw new Error('give the site\'s address to connect another site');
      site = validateUrl(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    }
    const running = [...jobs.values()].find(j => j.status === 'running' && j.provider === provider && (j.account || '') === acct && (j.url || null) === site);
    if (running) return jobOf(running);
    const job = { id: randomUUID(), provider, account: acct, url: site, status: 'running', line: `Asking Aside to sign in to ${PROVIDERS[provider].name}${acct ? ` as ${acct}` : ''}…`, startedAt: new Date(clock()).toISOString() };
    for (const old of [...jobs.values()].filter(j => j.status !== 'running').slice(0, Math.max(0, jobs.size - 30))) jobs.delete(old.id);
    jobs.set(job.id, job);
    const connectedNow = async () => (await pool.query(`SELECT * FROM integrations WHERE provider = $1 AND status = 'connected'`, [provider])).rows;
    const before = new Set((await connectedNow()).map(r => r.account));
    if (provider === 'other') {
      // No cheap check exists for another site, so its row is made here and Aside's own report decides it.
      const host = new URL(site).host.toLowerCase();
      const { rows } = await pool.query(`INSERT INTO integrations (provider, account, label, capabilities, enabled, status, detail, site)
        VALUES ('other', $1, $2, $3, true, 'checking', 'Signing in through Aside…', $4)
        ON CONFLICT (provider, account) DO UPDATE SET status = 'checking', enabled = true, detail = 'Signing in through Aside…', site = EXCLUDED.site RETURNING id`,
        [acct ? `${acct}@${host}`.slice(0, 200) : host, host, PROVIDERS.other.capabilities, site]);
      job.integrationId = rows[0].id;
    } else if (acct) {
      // Connecting an account by name brings it back if Quinn had disconnected it.
      const { rows } = await pool.query(`UPDATE integrations SET status = 'checking', enabled = true, detail = 'Signing in through Aside…' WHERE provider = $1 AND account = $2 RETURNING id`, [provider, acct]);
      if (rows[0]) job.integrationId = rows[0].id;
    }
    job.done = (async () => {
      let outcome;
      try {
        const { stdout } = await run(['exec', signInTask({ provider, account: acct, url: site })], { timeoutMs: jobTimeoutMs });
        outcome = outcomeOf(stdout);
      } catch (e) { outcome = { kind: 'failed', line: `Aside couldn't finish the sign-in: ${scrub(e.message, 200)}` }; }
      try {
        let found = null;
        if (provider === 'other') {
          const status = outcome.kind === 'connected' ? 'connected' : outcome.kind === 'blocked' ? 'needs_sign_in' : 'error';
          await pool.query(`UPDATE integrations SET status = $2, detail = $3, checked_at = $4 WHERE id = $1`, [job.integrationId, status,
            outcome.kind === 'connected' ? 'Aside reports it is signed in. (No automatic check exists for this site.)' : scrub(`Aside: ${outcome.line}`, 300), new Date(clock())]);
          if (status === 'connected') found = await get(job.integrationId);
        } else {
          job.line = `${outcome.line} Checking what Aside is signed in to…`;
          const r = await refresh({ providers: [provider] });
          const now = await connectedNow();
          // The account asked for; else one that wasn't signed in before; else (not Google) any signed-in account.
          const pick = (acct && now.find(x => x.account === acct)) || now.find(x => !before.has(x.account))
            || (!acct && provider !== 'google' ? now[0] : null);
          if (pick) found = rowOf(pick);
          if (!pick && r.refreshed?.[provider]?.ok === false) outcome = { kind: 'failed', line: scrub(`${outcome.line} Then checking ${PROVIDERS[provider].name} failed: ${r.refreshed[provider].error}`, 300) };
          if (!pick && acct) await pool.query(`UPDATE integrations SET status = $3, detail = $4, checked_at = $5 WHERE provider = $1 AND account = $2 AND status <> 'connected'`,
            [provider, acct, outcome.kind === 'blocked' ? 'needs_sign_in' : 'error', scrub(`Aside: ${outcome.line}`, 300), new Date(clock())]);
        }
        job.status = found ? 'done' : 'failed';
        job.integrationId = found?.id ?? job.integrationId ?? null;
        job.line = found ? (outcome.kind === 'connected' ? outcome.line : `Signed in as ${found.account}.`)
          : outcome.kind === 'connected' ? `Aside said it signed in, but ${PROVIDERS[provider].name} doesn't show ${acct || 'a new account'} yet. Refresh in a minute, or connect again.` : outcome.line;
      } catch (e) { job.status = 'failed'; job.line = scrub(`The sign-in finished, but recording it failed: ${e.message}`, 300); }
      job.finishedAt = new Date(clock()).toISOString();
      log.log?.(`[integrations] connect ${provider}${acct ? ` ${acct}` : ''}: ${job.status} — ${job.line}`);
    })();
    return jobOf(job);
  }
  function job(id) {
    const j = jobs.get(String(id));
    if (!j) throw Object.assign(new Error('no such connect job (the engine may have restarted; press Refresh)'), { status: 404 });
    return jobOf(j);
  }

  async function setEnabled(id, enabled) {
    const { rows } = await pool.query(`UPDATE integrations SET enabled = $2,
        status = CASE WHEN $2 AND status = 'disconnected' THEN 'checking' ELSE status END,
        detail = CASE WHEN $2 AND status = 'disconnected' THEN 'Switched back on. Refresh to check it is still signed in.' ELSE detail END
      WHERE id = $1 RETURNING *`, [Number(id), enabled === true]);
    if (!rows[0]) throw Object.assign(new Error('no such account'), { status: 404 });
    return rowOf(rows[0]);
  }
  // Oneiro stops using it. Nothing in the browser changes: Aside stays signed in.
  async function disconnect(id) {
    const { rows } = await pool.query(`UPDATE integrations SET enabled = false, status = 'disconnected',
        detail = 'Oneiro no longer uses this account. It is still signed in to Aside; nothing was signed out.' WHERE id = $1 RETURNING *`, [Number(id)]);
    if (!rows[0]) throw Object.assign(new Error('no such account'), { status: 404 });
    return rowOf(rows[0]);
  }

  // Use the account once, read-only. For Google: the inbox's size and its newest subject, never stored.
  async function test(id) {
    const row = await get(id);
    const now = new Date(clock());
    if (row.provider === 'google') {
      const code = `/*test:google*/ await (async () => { try { const acc = (await googleAccounts.list()).find(x => String(x.email).toLowerCase() === ${JSON.stringify(row.account)});
        if (!acc) { console.log(JSON.stringify({ missing: true })); return; }
        const r = await gmail.getInbox(acc.accountId); const top = (r.results || [])[0];
        console.log(JSON.stringify({ uid: acc.accountId, total: r.total, unread: (r.results || []).filter(x => x.isUnread).length, latestSubject: top ? top.subject : null, latestAt: top ? top.timestamp : null }));
      } catch (e) { console.log(JSON.stringify({ error: String((e && e.message) || e).slice(0, 300) })); } })();`;
      let j;
      try { j = lastJson((await run(['repl', code], { timeoutMs: probeTimeoutMs })).stdout); } catch (e) { j = { error: asideDown(e) }; }
      if (!j || j.error) {
        const why = scrub(j?.error || 'Aside gave no answer', 200);
        // Aside itself wasn't reachable, so this says nothing about the account: its status stays, marked as unchecked.
        if (ASIDE_UNREACHABLE.test(why)) {
          const plain = plainCheckFailure(row.providerName || row.provider, why);
          await pool.query(`UPDATE integrations SET detail = $2, checked_at = $3, check_failed = true WHERE id = $1 AND status <> 'disconnected'`, [row.id, plain, now]);
          return { ok: false, id: row.id, error: plain };
        }
        await pool.query(`UPDATE integrations SET status = $2, detail = $3, checked_at = $4, check_failed = false WHERE id = $1 AND status <> 'disconnected'`,
          [row.id, SIGNED_OUT.test(why) ? 'needs_sign_in' : 'error', `Reading the inbox failed: ${why}`, now]);
        return { ok: false, id: row.id, error: `Reading ${row.account}'s inbox failed: ${why}` };
      }
      if (j.missing) {
        await pool.query(`UPDATE integrations SET status = 'needs_sign_in', check_failed = false, detail = 'This account is not signed in to Aside. Connect it to sign in again.', checked_at = $2 WHERE id = $1 AND status <> 'disconnected'`, [row.id, now]);
        return { ok: false, id: row.id, error: `${row.account} is not signed in to Aside. Connect it to sign in again.` };
      }
      await pool.query(`UPDATE integrations SET uid = $2, checked_at = $3, check_failed = false, last_connected_at = CASE WHEN status = 'disconnected' THEN last_connected_at ELSE $3 END,
        status = CASE WHEN status = 'disconnected' THEN status ELSE 'connected' END,
        detail = CASE WHEN status = 'disconnected' THEN detail ELSE $4 END WHERE id = $1`,
        [row.id, j.uid, now, `Inbox read: ${j.total ?? '?'} conversations.`]);
      // The subject goes back to the person who pressed Test; it is not stored.
      return { ok: true, id: row.id, uid: j.uid, total: j.total ?? null, unread: j.unread ?? null, latestSubject: j.latestSubject ? text(j.latestSubject, 200) : null, latestAt: j.latestAt || null };
    }
    if (PROBED.includes(row.provider)) {
      await refresh({ providers: [row.provider] });
      const after = await get(id);
      return after.status === 'connected' ? { ok: true, id: row.id, detail: `${row.providerName} shows ${row.account} signed in.` }
        : { ok: false, id: row.id, error: after.detail || `${row.account} is not signed in.` };
    }
    return { ok: row.status === 'connected', id: row.id, detail: 'No automatic check exists for this site; Connect again to have Aside confirm the sign-in.' };
  }

  // Recent mail headers for every enabled, connected Google account: subject, from, date and a short snippet. Read
  // live through Aside and never stored here. `since`/`until` are times (ms, s or ISO).
  // A cold Gmail session can fail its first read ("No /sync/ request within 8s"); opening the inbox once wakes it.
  // `accounts` narrows it to named accounts; it can only ever take accounts away from the enabled, connected ones.
  async function mailRecent({ since = null, until = null, limit = 50, accounts: only = null } = {}) {
    const toSec = v => { if (v == null || v === '') return null; const n = Number(v); const ms = Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : Date.parse(v); if (!Number.isFinite(ms)) throw new Error('since/until must be a time'); return Math.floor(ms / 1000); };
    const after = toSec(since) ?? Math.floor((clock() - 86_400_000) / 1000), before = toSec(until);
    const { rows: enabled } = await pool.query(`SELECT * FROM integrations WHERE provider = 'google' AND enabled AND status = 'connected' ORDER BY coalesce(uid, 99)`);
    const rows = Array.isArray(only) ? enabled.filter(r => only.includes(r.account)) : enabled;
    if (!rows.length) return { accounts: [], messages: [], note: 'No Google account is connected and switched on.' };
    const emails = rows.map(r => r.account), cap = Math.max(1, Math.min(100, Number(limit) || 50));
    const query = `after:${after}${before ? ` before:${before}` : ''}`;
    const code = `/*mail:recent*/ await (async () => { try { const all = await googleAccounts.list(); const want = ${JSON.stringify(emails)}; const out = [];
      for (const email of want) { const acc = all.find(x => String(x.email).toLowerCase() === email); if (!acc) { out.push({ account: email, missing: true }); continue; }
        try { let r; try { r = await gmail.search(acc.accountId, ${JSON.stringify(query)}); } catch { const warm = await openTab('https://mail.google.com/mail/u/' + acc.accountId + '/#inbox'); try { await sleep(6000); r = await gmail.search(acc.accountId, ${JSON.stringify(query)}); } finally { await closeTab(warm).catch(() => {}); } } out.push({ account: email, uid: acc.accountId, total: r.total, results: (r.results || []).slice(0, ${cap}).map(m => ({ threadId: m.threadId, subject: m.subject, snippet: m.snippet, date: m.timestamp, unread: m.isUnread, from: (m.participants || []).filter(p => String(p.email).toLowerCase() !== email).map(p => p.name ? p.name + ' <' + p.email + '>' : p.email)[0] || email })) }); }
        catch (e) { out.push({ account: email, error: String((e && e.message) || e).slice(0, 200) }); } }
      console.log(JSON.stringify({ accounts: out })); } catch (e) { console.log(JSON.stringify({ error: String((e && e.message) || e).slice(0, 300) })); } })();`;
    let j = lastJson((await run(['repl', code], { timeoutMs: probeTimeoutMs })).stdout);
    // Aside can be busy (an agent is driving it) and time out on one call; that's worth one more try before reporting it.
    if (!j || /timeout/i.test(String(j.error || ''))) j = lastJson((await run(['repl', code], { timeoutMs: probeTimeoutMs })).stdout);
    if (!j) throw new Error('Aside gave no answer when reading mail');
    if (j.error) throw new Error(`Reading mail through Aside failed: ${scrub(j.error, 200)}`);
    const accounts = [], messages = [];
    for (const a of j.accounts || []) {
      accounts.push({ account: a.account, uid: a.uid ?? null, ok: !a.missing && !a.error, error: a.missing ? 'not signed in to Aside' : a.error ? scrub(a.error, 200) : null, total: a.total ?? null });
      for (const m of a.results || []) messages.push({ account: a.account, uid: a.uid, threadId: text(m.threadId, 80), subject: text(decode(m.subject), 300), from: text(decode(m.from), 200),
        date: m.date ? new Date(m.date).toISOString() : null, snippet: text(decode(m.snippet), 240), unread: m.unread === true });
    }
    messages.sort((x, y) => String(y.date).localeCompare(String(x.date)));
    return { since: new Date(after * 1000).toISOString(), until: before ? new Date(before * 1000).toISOString() : null, accounts, messages };
  }

  // One line for an agent's brief: which accounts it may use, and how to name each one to Aside.
  async function briefLine() {
    const { rows } = await pool.query(`SELECT * FROM integrations WHERE enabled AND status = 'connected' ORDER BY array_position($1::text[], provider), coalesce(uid, 99), account`, [Object.keys(PROVIDERS)]);
    if (!rows.length) return '';
    const name = r => {
      const label = r.label ? ` (${r.label})` : '';
      switch (r.provider) {
        case 'google': return `Google/Gmail uid ${r.uid ?? '?'} ${r.account}${label}`;
        case 'slack': return `Slack workspace ${r.account}${label}`;
        case 'other': return `${r.account} (signed in)`;
        default: return `${PROVIDERS[r.provider]?.name || r.provider} ${r.account}`;
      }
    };
    return `Accounts you may use through Aside: ${rows.map(name).join(', ')}. Pick the account the task belongs to; Google uids can shift, so confirm with googleAccounts.print() before using one. Don't use an account that isn't listed.`;
  }

  const router = Router();
  const route = h => async (req, res) => { try { res.json(await h(req)); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };
  router.get('/oca/integrations', route(() => list()));
  router.post('/oca/integrations/refresh', route(req => refresh(Array.isArray(req.body?.providers) ? { providers: req.body.providers } : {})));
  router.post('/oca/integrations/connect', route(req => connect({ provider: req.body?.provider, account: req.body?.account || '', url: req.body?.url || null })));
  router.get('/oca/integrations/jobs/:id', route(req => job(req.params.id)));
  router.get('/oca/integrations/mail/recent', route(req => mailRecent({ since: req.query.since ?? null, until: req.query.until ?? null, limit: req.query.limit })));
  router.post('/oca/integrations/:id/enable', route(req => setEnabled(req.params.id, req.body?.enabled !== false)));
  router.post('/oca/integrations/:id/test', route(req => test(req.params.id)));
  router.post('/oca/integrations/:id/disconnect', route(req => disconnect(req.params.id)));

  return { init, list, get, refresh, connect, job, jobs: () => [...jobs.values()].map(jobOf), waitForJob: id => jobs.get(String(id))?.done, setEnabled, disconnect, test, mailRecent, briefLine, router };
}
