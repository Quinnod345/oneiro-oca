import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppleGrowth, propose, RULES } from '../apple/growth.js';

async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'growth_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema + ',public' });
    await pool.query(await readFile(new URL('../migrations/065_apple_metrics.sql', import.meta.url), 'utf8'));
    await run(pool);
  } finally { if (pool) await pool.end(); await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end(); }
}
const quiet = { log() {}, warn() {} };
const term = (group, text, taps, installs, spend) => ({ key: `${group}:${text}`, dims: { searchTerm: text, adGroupId: group }, taps, installs, spend, currency: 'USD' });
const kw = (id, group, text, matchType, taps, installs, spend) => ({ key: String(id), dims: { name: text, adGroupId: group, matchType }, taps, installs, spend, currency: 'USD' });

test('moves are proposed only past a minimum sample, and a converting term becomes a keyword only if it isn\'t one already', () => {
  const ideas = propose({ targetCpi: 4, searchTerms: [
    term(9, 'dream journal', 12, 4, 10),     // converts: 4 installs at $2.50 → promote, and a keyword-field candidate
    term(9, 'journal', 30, 5, 15),           // converts, but already an exact keyword → no promotion
    term(9, 'free diary', 25, 0, 12),        // taps, no installs → negative
    term(9, 'mood app', 6, 2, 3),            // too few taps to say anything
    { key: '9:(low volume)', dims: { searchTerm: null, adGroupId: 9 }, taps: 40, installs: 0, spend: 20 },
  ], keywords: [
    kw(5, 9, 'journal', 'EXACT', 30, 10, 20),    // $2 per install, well under $4 → bid up
    kw(6, 9, 'diary app', 'BROAD', 25, 0, 30),   // no installs → bid down
    kw(7, 9, 'self care', 'EXACT', 10, 0, 8),    // too few taps
  ] });
  const by = k => ideas.filter(i => i.kind === k).map(i => i.subject);
  assert.deepEqual(by('promote_keyword'), ['9:dream journal']);
  assert.deepEqual(by('negative_keyword'), ['9:free diary'], 'a low-volume row has no text to block');
  assert.deepEqual(by('bid_up'), ['5']); assert.deepEqual(by('bid_down'), ['6']);
  assert.deepEqual(ideas.find(i => i.kind === 'aso_keywords').evidence.terms.map(t => t.term), ['journal', 'dream journal']);
  const promote = ideas.find(i => i.kind === 'promote_keyword');
  assert.deepEqual(promote.request.body.items[0].data, { adGroupId: 9, text: 'dream journal', matchType: 'EXACT', status: 'ENABLED', bid: { amount: '0.83', currency: 'USD' } });
  // With no target set, nothing is promoted or raised; a term with no installs is still blocked.
  const blind = propose({ searchTerms: [term(9, 'dream journal', 12, 4, 10), term(9, 'free diary', 25, 0, 12)], keywords: [kw(5, 9, 'journal', 'EXACT', 30, 10, 20)] });
  assert.deepEqual(blind.map(i => i.kind).sort(), ['aso_keywords', 'negative_keyword']);
  assert.equal(RULES.windowDays, 14);
});

test('every move goes to the broker; dry-run answers are kept, unchanged moves aren\'t re-sent, and a move that needs Quinn waits on his approval', async () => database(async pool => {
  const now = Date.parse('2026-09-28T15:00:00Z');
  const dir = await mkdtemp(join(tmpdir(), 'apple-growth-'));
  const settingsPath = join(dir, 'settings.json');
  await writeFile(settingsPath, JSON.stringify({ pursuit: 27, app: { appId: '1' }, appleAds: { targetCpi: 4 } }));
  const day = '2026-09-25';
  for (const [source, key, dims, metrics] of [
    ['ads_searchterm', '9:dream journal', { searchTerm: 'dream journal', adGroupId: 9 }, { taps: 12, tapInstalls: 4, localSpend: 10, currency: 'USD' }],
    ['ads_keyword', '5', { name: 'journal', adGroupId: 9, matchType: 'EXACT' }, { taps: 30, tapInstalls: 10, localSpend: 20, currency: 'USD' }],
  ]) await pool.query(`INSERT INTO apple_metrics (source, day, key, dims, metrics) VALUES ($1, $2, $3, $4, $5)`, [source, day, key, JSON.stringify(dims), JSON.stringify(metrics)]);
  let mode = 'dry-run';
  const calls = [], asked = [], closed = [];
  const apple = {
    status: async () => ({ ok: true, mode }),
    call: async r => {
      calls.push(r);
      if (r.method === 'GET' && r.path === '/v1/keywords/5') return { ok: true, decision: 'read', body: { result: { id: 5, bid: { amount: '2.00', currency: 'USD' } } } };
      if (r.method === 'GET' && r.path === '/v1/apps/1/customerReviews') return { ok: true, decision: 'read', body: { data: [
        { id: 'rv1', attributes: { rating: 2, title: 'Lost my entries', body: 'Sync lost a week of entries.', createdDate: '2026-09-26T10:00:00Z' }, relationships: { response: { data: null } } },
        { id: 'rv2', attributes: { rating: 5, body: 'Love it' }, relationships: { response: { data: { id: 'x' } } } }] } };
      if (mode === 'dry-run') return { ok: true, decision: 'dry_run', why: ['a routine Apple Ads change'], wouldNeedApproval: r.path === '/v1/customerReviewResponses' };
      if (r.approval === 'a1b2c3d4') return { ok: true, decision: 'sent', status: 200 };
      if (r.path === '/v1/customerReviewResponses') return { ok: true, decision: 'needs_approval', approvalId: 'a1b2c3d4', approve: 'sudo -u _oneiroapple … approve a1b2c3d4', why: ['posts a public reply to a customer review'] };
      return { ok: true, decision: 'sent', status: 200 };
    },
  };
  const llm = { messages: { create: async () => 'Sorry about the lost entries, and thank you for telling us. Please write to us from Settings → Help so we can look at your sync.' } };
  const g = createAppleGrowth({ pool, apple, llm, asks: { ask: async a => { asked.push(a); return { id: 1 }; }, closeSubject: async s => { closed.push(s); return []; } }, clock: () => now, log: quiet, settingsPath });
  await g.init();
  const first = await g.run();
  const kinds = first.moves.map(m => `${m.kind}:${m.status}`).sort();
  assert.deepEqual(kinds, ['aso_keywords:proposed', 'bid_up:dry_run', 'promote_keyword:dry_run', 'review_reply:dry_run']);
  const bid = calls.find(c => c.path === '/v1/keywords/bulk-update');
  assert.equal(bid.body.items[0].data.bid.amount, '2.3', '15% up from the current $2.00'); assert.equal(bid.chainId, 27); assert.match(bid.reason, /well under the \$4 target: bid \$2 → \$2.3/);
  const writes = () => calls.filter(c => c.method !== 'GET').length;
  const before = writes();
  await g.run();
  assert.equal(writes(), before, 'an unchanged dry-run move isn\'t sent to the broker again');
  // Live: the reply waits on Quinn, with the exact command; he approves; the next run sends it once.
  mode = 'live';
  await pool.query(`UPDATE apple_proposals SET status = 'proposed'`);
  await g.run();
  const reply = (await g.recent()).find(p => p.kind === 'review_reply');
  assert.equal(reply.status, 'needs_approval'); assert.equal(reply.approval_id, 'a1b2c3d4');
  assert.match(asked[0].detail, /In Terminal on your Mac, run: sudo -u _oneiroapple … approve a1b2c3d4/);
  assert.equal(asked[0].kind, 'apple_approval'); assert.equal(asked[0].subject, 'apple:review_reply:rv1');
  assert.equal(asked[0].apple.command, 'sudo -u _oneiroapple … approve a1b2c3d4');
  assert.match(asked[0].apple.change, /Posts this public reply to a 2-star App Store review: “Sorry about the lost entries/);
  await g.run();
  assert.equal((await g.recent()).find(p => p.kind === 'review_reply').status, 'sent');
  assert.ok(closed.includes('apple:review_reply:rv1'), 'once it is sent, its card closes on its own');
  assert.equal(calls.filter(c => c.path === '/v1/customerReviewResponses' && c.approval === 'a1b2c3d4').length, 1);
}));

test('a review keeps its one drafted reply, and a new code replaces the last ask instead of piling up beside it', async () => database(async pool => {
  const { createAsks } = await import('../reasoning/asks.js');
  await pool.query(await readFile(new URL('../migrations/066_apple_proposals.sql', import.meta.url), 'utf8'));
  let now = Date.parse('2026-10-05T15:00:00Z');
  const dir = await mkdtemp(join(tmpdir(), 'apple-growth-'));
  const settingsPath = join(dir, 'settings.json');
  await writeFile(settingsPath, JSON.stringify({ app: { appId: '1' } }));
  const sent = [];
  const asks = createAsks({ pool, clock: () => now, log: quiet, deliverers: { imessage: async m => { sent.push(m); } } });
  await asks.init();
  let code = 0, drafted = 0;
  const review = id => ({ id, attributes: { rating: 5, body: 'Love it', createdDate: '2024-10-05T10:00:00Z' }, relationships: { response: { data: null } } });
  const apple = {
    status: async () => ({ ok: true, mode: 'live' }),
    call: async r => {
      if (r.method === 'GET') return { ok: true, decision: 'read', body: { data: [review('rv1'), review('rv2')] } };
      // Each code runs out before he answers, which is what the broker reports when its window closes.
      if (r.approval) return { ok: false, decision: 'failed', error: `approval ${r.approval} expired` };
      code += 1;
      return { ok: true, decision: 'needs_approval', approvalId: `c0de${String(code).padStart(4, '0')}`, approve: `sudo -u _oneiroapple approve c0de${String(code).padStart(4, '0')}` };
    },
  };
  const llm = { messages: { create: async () => { drafted += 1; return `Thank you, draft number ${drafted}.`; } } };
  const g = createAppleGrowth({ pool, apple, llm, asks, clock: () => now, log: quiet, settingsPath });
  await g.init();
  const open = async () => (await asks.open()).filter(a => a.kind === 'apple_approval');

  await g.run();
  assert.equal(drafted, 2, 'one reply drafted per review');
  assert.equal((await open()).length, 2, 'one ask per review');
  const words = new Set((await open()).map(a => a.apple.change));
  // Day after day: never more than one open ask per review, whatever happens to the codes, and it isn't redrafted.
  for (let day = 0; day < 6; day++) {
    now += 86_400_000;
    await g.run();
    const asksNow = await open();
    assert.ok(asksNow.length <= 2, `day ${day}: ${asksNow.length} open asks for two reviews`);
    for (const a of asksNow) assert.ok(words.has(a.apple.change), 'each review keeps the words it was first drafted with');
  }
  assert.equal(drafted, 2, 'a drafted reply is never written again');
  const [one] = await open();
  assert.match(one.apple.change, /Posts this public reply to a 5-star App Store review: “Thank you, draft number/);
  assert.match(one.apple.command, /^sudo -u _oneiroapple approve c0de\d{4}$/);
  assert.match(one.message, /approve c0de\d{4}/);
  assert.doesNotMatch(sent.join('\n'), /T3 Code/);
}));

test('asks: the dedupe keys on the subject, not the text holding the code; a stale code can never sit open beside a newer one', async () => database(async pool => {
  const { createAsks } = await import('../reasoning/asks.js');
  let now = Date.parse('2026-10-05T15:00:00Z');
  const asks = createAsks({ pool, clock: () => now, log: quiet, notify: false });
  await asks.init();
  const say = (code, subject = 'apple:review_reply:rv1') => asks.ask({ chainId: null, kind: 'apple_approval', subject, detail: `Approve an Apple change: a reply. In Terminal on your Mac, run: sudo approve ${code}` });
  const a = await say('aaaa1111');
  const again = await say('aaaa1111');
  assert.equal(again.asked, false); assert.equal(again.id, a.id, 'the same code is the same ask');
  now += 1000;
  const b = await say('bbbb2222');
  assert.notEqual(b.id, a.id);
  const open = await asks.open();
  assert.deepEqual(open.map(x => x.id), [b.id], 'the older code closed when the newer one was asked');
  const { rows: [closed] } = await pool.query(`SELECT replied_at, metadata FROM notifications WHERE id = $1`, [a.id]);
  assert.ok(closed.replied_at); assert.equal(closed.metadata.closed.why, 'superseded');
  // A different subject is a different ask, and a question without a pursuit is deduped too (it used to compare null to null).
  const c = await say('cccc3333', 'apple:review_reply:rv2');
  assert.equal((await asks.open()).length, 2); assert.notEqual(c.id, b.id);
  const q1 = await asks.ask({ chainId: null, kind: 'question', detail: 'Which store region should this use?' });
  const q2 = await asks.ask({ chainId: null, kind: 'question', detail: 'Which store region should this use?' });
  assert.equal(q2.id, q1.id);
  // A payment is only ever decided, so a subject can't close it.
  await pool.query(`UPDATE notifications SET metadata = metadata || '{"payment":true,"subject":"pay"}'::jsonb WHERE id = $1`, [q1.id]);
  assert.deepEqual(await asks.closeSubject('pay'), []);
}));

test('an ask written before the Apple record existed still reads as an Apple change, in its old words and with the current proposal\'s description', async () => database(async pool => {
  const { createAsks } = await import('../reasoning/asks.js');
  const { parseAppleAsk, appleChangeWords } = await import('../apple/change-words.js');
  await pool.query(await readFile(new URL('../migrations/066_apple_proposals.sql', import.meta.url), 'utf8'));
  const old = 'Oneiro\'s agent on #null asks: Approve an Apple change: a 5-star review from 2024-10-05 has no reply. In Terminal on your Mac, run: sudo -u _oneiroapple /opt/oneiro/apple/run approve 404916dc — open Oneiro and answer it in the chat, or reply here.';
  const parsed = parseAppleAsk(old);
  assert.deepEqual(parsed, { why: 'a 5-star review from 2024-10-05 has no reply', command: 'sudo -u _oneiroapple /opt/oneiro/apple/run approve 404916dc', approval: '404916dc' });
  assert.equal(parseAppleAsk('Which store region?'), null);
  assert.equal(parseAppleAsk(old.replace(/ — open Oneiro.*$/, ' — reply here, or answer in the pursuit\'s conversation in T3 Code.')).command, parsed.command);
  const asks = createAsks({ pool, log: quiet, notify: false }); await asks.init();
  await pool.query(`INSERT INTO notifications (message, category, metadata) VALUES ($1, 'ask', $2::jsonb)`, [old, JSON.stringify({ chainId: null, kind: 'question', detail: old.slice(0, 300) })]);
  await pool.query(`INSERT INTO apple_proposals (kind, subject, evidence, request, why, status, approval_id) VALUES ('review_reply', 'rv1', '{"rating":5}', $1, 'a 5-star review', 'needs_approval', '404916dc')`,
    [JSON.stringify({ body: { data: { attributes: { responseBody: 'Thank you.' } } } })]);
  const [a] = await asks.open();
  assert.equal(a.apple.command, parsed.command);
  assert.equal(a.apple.change, 'Posts this public reply to a 5-star App Store review: “Thank you.”');
  assert.equal(appleChangeWords({ kind: 'negative_keyword', request: { body: { items: [{ data: { text: 'free diary' } }] } } }), 'Stops Apple Ads from showing for “free diary”.');
}));

test('close-duplicate-asks prints by default, closes only with --apply, keeps the newest per subject, and is idempotent', async () => database(async pool => {
  const { createAsks } = await import('../reasoning/asks.js');
  const { closeDuplicates } = await import('../scripts/close-duplicate-asks.mjs');
  await pool.query(await readFile(new URL('../migrations/066_apple_proposals.sql', import.meta.url), 'utf8'));
  const asks = createAsks({ pool, log: quiet, notify: false }); await asks.init();
  const insert = async (date, code, at) => (await pool.query(`INSERT INTO notifications (message, category, created_at, metadata) VALUES ($1, 'ask', $2, $3::jsonb) RETURNING id`,
    [`Oneiro's agent on #null asks: Approve an Apple change: a 5-star review from ${date} has no reply. In Terminal on your Mac, run: sudo approve ${code} — open Oneiro and answer it in the chat, or reply here.`, at, JSON.stringify({ chainId: null, kind: 'question' })])).rows[0].id;
  const old1 = await insert('2024-10-05', 'aaaaaaaa', '2026-10-05T00:00:00Z');
  const old2 = await insert('2024-10-05', 'bbbbbbbb', '2026-10-06T00:00:00Z');
  const newest = await insert('2024-10-05', 'cccccccc', '2026-11-05T00:00:00Z');
  const other = await insert('2025-09-05', 'dddddddd', '2026-10-05T00:00:00Z');
  // Same words as another subject, but its code is still the one a proposal holds, so it stays.
  const sameDay = await insert('2024-10-05', 'eeeeeeee', '2026-10-01T00:00:00Z');
  await pool.query(`INSERT INTO apple_proposals (kind, subject, why, status, approval_id) VALUES ('review_reply', 'rvE', 'x', 'needs_approval', 'eeeeeeee')`);
  const question = (await pool.query(`INSERT INTO notifications (message, category, metadata) VALUES ('Which region?', 'ask', '{"kind":"question","chainId":null}') RETURNING id`)).rows[0].id;
  const pay = (await pool.query(`INSERT INTO notifications (message, category, metadata) VALUES ('Pay', 'ask', '{"kind":"question","payment":true,"subject":"apple:x"}') RETURNING id`)).rows[0].id;
  const lines = [];
  const dry = await closeDuplicates(pool, { log: l => lines.push(l) });
  assert.deepEqual(dry.closed, []); assert.deepEqual(dry.wouldClose.sort((a, b) => a - b), [old1, old2].sort((a, b) => a - b));
  assert.match(lines.join('\n'), /would close #\d+ \(code aaaaaaaa\)/); assert.match(lines.at(-1), /--apply/);
  const open = async () => (await pool.query(`SELECT id FROM notifications WHERE category = 'ask' AND replied_at IS NULL ORDER BY id`)).rows.map(r => r.id);
  assert.equal((await open()).length, 7, 'a dry run changes nothing');
  const done = await closeDuplicates(pool, { apply: true, log: () => {} });
  assert.deepEqual(done.closed.sort((a, b) => a - b), [old1, old2].sort((a, b) => a - b));
  assert.deepEqual(await open(), [newest, other, sameDay, question, pay].sort((a, b) => a - b));
  const again = await closeDuplicates(pool, { apply: true, log: () => {} });
  assert.deepEqual(again.closed, [], 'running it twice finds nothing');
}));
