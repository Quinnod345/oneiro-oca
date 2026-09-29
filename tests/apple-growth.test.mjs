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
  const calls = [], asked = [];
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
  const g = createAppleGrowth({ pool, apple, llm, asks: { ask: async a => { asked.push(a); return { id: 1 }; } }, clock: () => now, log: quiet, settingsPath });
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
  await g.run();
  assert.equal((await g.recent()).find(p => p.kind === 'review_reply').status, 'sent');
  assert.equal(calls.filter(c => c.path === '/v1/customerReviewResponses' && c.approval === 'a1b2c3d4').length, 1);
}));
