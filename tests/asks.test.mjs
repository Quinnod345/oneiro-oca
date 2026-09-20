import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createAsks, composeAsk, pushAlert } from '../reasoning/asks.js';
import { createProposal, appraise, OWNER_KEY } from '../motivation/risk.js';
import { createWorthLedger } from '../motivation/worth-ledger.js';
import { createRiskJournal } from '../motivation/risk-journal.js';
import { accessBlock } from '../aside-mcp.js';
import { classifyFriction } from '../reasoning/self-build.js';

async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'asks_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema + ',public' });
    for (const m of ['057_worth_ledger', '058_risk_decisions']) await pool.query(await readFile(new URL(`../migrations/${m}.sql`, import.meta.url), 'utf8'));
    await run(pool);
  } finally { if (pool) await pool.end(); await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end(); }
}

test('an ask is the one message the engine may send itself: only to its person, only observed content, only under the standing permission', () => {
  assert.throws(() => createProposal({ kind: 'ask', description: 'x', reversibility: 'none', recipient: 'person:dan', verified: true }), /only to the engine's own person/);
  assert.throws(() => createProposal({ kind: 'ask', description: 'x', reversibility: 'none', recipient: OWNER_KEY }), /observed content/);
  const p = createProposal({ kind: 'ask', description: 'needs a sign-in', reversibility: 'undo', recipient: OWNER_KEY, verified: true, serves: ['project:demo'] });
  assert.equal(p.reversibility, 'none', 'a message cannot be unsent'); assert.equal(p.capability, 'message');
  const lookup = k => (k === 'project:demo' ? { worth: 0.7, confidence: 0.5, provenance: 'rated', constraint: false, weighable: true } : null);
  assert.equal(appraise(p, { lookup, controls: { autonomousActions: false, askOwner: true } }).decision, 'proceed', 'the person fired this class in advance');
  assert.equal(appraise(p, { lookup, controls: { autonomousActions: true, askOwner: false } }).decision, 'prepare_artifact', 'without the permission it is only recorded');
  const message = createProposal({ kind: 'message', description: 'hello', reversibility: 'none', recipient: OWNER_KEY, verified: true, serves: ['project:demo'] });
  assert.equal(appraise(message, { lookup, controls: { autonomousActions: true, askOwner: true } }).decision, 'prepare_artifact', 'an ordinary message still waits for a person to fire it');
});

test('asks are composed from observed fields only, deduplicated per want and need, capped per day, delivered where they can be, and always recorded for the app', async () => database(async pool => {
  let now = 30 * 86400000;
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => ({ autonomousActions: false, askOwner: true }) });
  const sent = [];
  const asks = createAsks({ pool, risk, clock: () => now, perDay: 2, log: { log() {}, warn() {} },
    deliverers: { imessage: async m => { sent.push(['imessage', m]); }, notification: async () => { throw new Error('no display'); } } });
  await asks.init();
  assert.match(composeAsk({ kind: 'sign_in', host: 'appstoreconnect.apple.com', want: 'InnerEcho marketing', chainId: 27 }), /signed in to appstoreconnect\.apple\.com in Aside/);
  const a = await asks.ask({ chainId: 27, kind: 'sign_in', host: 'appstoreconnect.apple.com', want: 'InnerEcho marketing', stakes: [{ entityKey: 'person:quinn', share: 1 }] });
  assert.equal(a.asked, true); assert.deepEqual(a.delivered, ['imessage']); assert.equal(a.failed.length, 1); assert.equal(sent.length, 1);
  const again = await asks.ask({ chainId: 27, kind: 'sign_in', host: 'appstoreconnect.apple.com' });
  assert.equal(again.asked, false); assert.equal(again.why, 'already asked'); assert.equal(sent.length, 1);
  const other = await asks.ask({ chainId: 27, kind: 'sign_in', host: 'app.posthog.com' });
  assert.equal(other.asked, true); assert.equal(sent.length, 2);
  const capped = await asks.ask({ chainId: 27, kind: 'sign_in', host: 'ads.apple.com' });
  assert.equal(capped.asked, false); assert.match(capped.why, /daily cap/); assert.ok(capped.id, 'still recorded for the app'); assert.equal(sent.length, 2, 'the phone stayed quiet');
  const open = await asks.open(); assert.deepEqual(open.map(o => o.host).sort(), ['ads.apple.com', 'app.posthog.com', 'appstoreconnect.apple.com']);
  await asks.answer(capped.id, 'seen');
  const journal = (await risk.recent({ chainId: 27 })).filter(d => d.id.startsWith('ask:'));
  assert.equal(journal.length, 2); assert.ok(journal.every(d => d.decision === 'proceed' && d.outcome?.result === 'success'));
  // the person answers; the same need may be asked again later
  await asks.answer(a.id, 'signed in'); now += 60_000;
  assert.equal((await asks.open()).length, 1);
  now += 24 * 3600_000;
  assert.equal((await asks.ask({ chainId: 27, kind: 'sign_in', host: 'appstoreconnect.apple.com' })).asked, true);
  // with the permission off, an ask is recorded for the app but nothing is sent
  const quiet = createAsks({ pool, risk: createRiskJournal({ pool, worth, clock: () => now, controls: () => ({ autonomousActions: false, askOwner: false }) }), clock: () => now, log: { log() {}, warn() {} }, deliverers: { imessage: async m => { sent.push(['q', m]); } } });
  const held = await quiet.ask({ chainId: 28, kind: 'evidence', detail: 'August revenue' });
  assert.equal(held.asked, false); assert.equal(held.decision, 'prepare_artifact'); assert.equal(sent.length, 4 - 1, 'nothing sent'); assert.ok((await quiet.open()).some(x => x.chainId === 28));
}));

test('a sign-in wall is observed from the page, not inferred; tooling friction is a defect the engine may want to fix', () => {
  assert.deepEqual(accessBlock({ url: 'https://idmsa.apple.com/IDMSWebAuth/signin', title: 'Sign in' }).host, 'idmsa.apple.com');
  assert.equal(accessBlock({ url: 'https://app.posthog.com/login', title: 'PostHog' }).kind, 'sign_in');
  assert.equal(accessBlock({ url: 'https://appstoreconnect.apple.com/apps', title: 'Apps - App Store Connect', text: 'My Apps InnerEcho' }), null);
  assert.equal(classifyFriction('Slice x completed with 0 verified sources; evidence applied: false. tooling: 12 Aside reads yielded no verifiable rows.'), 'defect');
});

test('the phone is a delivery channel only when a paired node is configured; a push is judged by the gateway\'s answer', async () => {
  const stub = { query: async () => ({ rows: [] }) };
  assert.deepEqual(createAsks({ pool: stub, imessage: null, pushNode: null, notify: false }).channels(), []);
  assert.deepEqual(createAsks({ pool: stub, imessage: null, pushNode: 'node-1', notify: false }).channels(), ['push']);
  // a non-JSON or not-ok answer from the gateway is a failed delivery, never a silent success
  await assert.rejects(() => pushAlert({ nodeId: 'node-1', title: 't', body: 'b', openclawCli: '/usr/bin/false' }));
  await assert.rejects(() => pushAlert({ nodeId: 'node-1', title: 't', body: 'b', openclawCli: '/bin/echo' }), /gateway:/);
});
