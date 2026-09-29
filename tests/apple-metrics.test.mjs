import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { gzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppleMetrics, parseSalesReport, notificationRow, adsReportRows, isoDay } from '../apple/metrics.js';

async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'apple_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema + ',public' });
    await run(pool);
  } finally { if (pool) await pool.end(); await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end(); }
}
const quiet = { log() {}, warn() {} };
const jws = payload => `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
const SALES = ['Provider\tSKU\tTitle\tProduct Type Identifier\tUnits\tDeveloper Proceeds\tCountry Code\tCurrency of Proceeds\tCustomer Price',
  'APPLE\tIE.PRO.M\tInnerEcho Pro\tIAY\t1\t4.24\tUS\tUSD\t4.99', 'APPLE\tIE.PRO.M\tInnerEcho Pro\tIAY\t2\t8.48\tUS\tUSD\t4.99', 'APPLE\tIE\tInnerEcho\t1F\t7\t0\tUS\tUSD\t0'].join('\n');

test('Sales and Trends rows sum by what they describe; notifications and Ads reports become one row per subject per day', () => {
  const rows = parseSalesReport(SALES);
  assert.equal(rows.length, 2);
  const pro = rows.find(r => r.dims.SKU === 'IE.PRO.M');
  assert.deepEqual(pro.metrics, { Units: 3, 'Developer Proceeds': 12.72, 'Customer Price': 4.99 }, 'units and proceeds add up; a price does not');
  const refund = notificationRow(jws({ notificationType: 'REFUND', notificationUUID: 'n-1', signedDate: Date.parse('2026-09-27T10:00:00Z'),
    data: { environment: 'Production', signedTransactionInfo: jws({ productId: 'ie.pro.monthly', price: 4990, currency: 'USD', transactionId: 't2', originalTransactionId: 't1', revocationDate: Date.parse('2026-09-27T09:00:00Z'), revocationReason: 0 }) } }));
  assert.equal(refund.day, '2026-09-27'); assert.equal(refund.dims.type, 'REFUND'); assert.equal(refund.metrics.price, 4.99); assert.equal(refund.metrics.revocationReason, 0);
  assert.equal(notificationRow('garbage'), null);
  const ads = adsReportRows({ result: { rows: [{ metadata: { searchTermText: null, adGroupId: 9, campaignId: 1 }, granularMetrics: [{ date: '2026-09-26', taps: 3, tapInstalls: 0, localSpend: { amount: '2.10', currency: 'USD' } }] }] } }, 'searchterm');
  assert.deepEqual(ads[0], { day: '2026-09-26', key: '9:(low volume)', dims: { searchTerm: null, source: null, keyword: null, keywordId: null, matchType: null, adGroupId: 9, campaignId: 1 }, metrics: { taps: 3, tapInstalls: 0, localSpend: 2.1, currency: 'USD' } });
});

test('a daily pull stores every source it can read and says why for the ones it can\'t', async () => database(async pool => {
  const now = Date.parse('2026-09-28T15:00:00Z');
  const dir = await mkdtemp(join(tmpdir(), 'apple-settings-'));
  const settingsPath = join(dir, 'settings.json');
  await writeFile(settingsPath, JSON.stringify({ vendorNumber: '12345678' }));
  const calls = [];
  const apple = {
    installed: () => true,
    status: async () => ({ ok: true, configured: { asc: ['app_manager', 'finance'], storekit: true, ads: { adAccount: false } } }),
    call: async r => {
      calls.push(r);
      if (r.path === '/v1/salesReports') {
        if (r.query['filter[reportType]'] === 'SALES' && r.query['filter[reportDate]'] === isoDay(now - 86_400_000)) return { ok: true, status: 200, bodyBase64: gzipSync(SALES).toString('base64') };
        if (r.query['filter[reportType]'] === 'SUBSCRIPTION_EVENT') return { ok: false, status: 400, body: { errors: [{ detail: 'Invalid version' }] } };
        if (r.query['filter[reportType]'] === 'SUBSCRIPTION' && r.query['filter[version]'] !== '1_5') return { ok: false, status: 400, body: { errors: [{ detail: 'Please include the version parameter. The latest version for this report is 1_5.' }] } };
        return { ok: false, status: 404, body: { errors: [] } };
      }
      if (r.path === '/inApps/v1/notifications/history') {
        const page = r.query?.paginationToken ? 2 : 1;
        return { ok: true, status: 200, body: { hasMore: page === 1, paginationToken: page === 1 ? 'p2' : undefined,
          notificationHistory: [{ signedPayload: jws({ notificationType: page === 1 ? 'SUBSCRIBED' : 'DID_RENEW', notificationUUID: `n-${page}`, signedDate: now - 3600e3, data: { signedTransactionInfo: jws({ productId: 'p', price: 4990, currency: 'USD' }) } }) }] } };
      }
      return { ok: false, status: 500 };
    },
  };
  const m = createAppleMetrics({ pool, apple, clock: () => now, log: quiet, settingsPath });
  await m.init();
  const out = await m.pull();
  assert.equal(out.asc_sales, 2); assert.equal(out.asc_subscriptions, 0, 'the version Apple named was used, and the reports that came back were empty'); assert.match(out.asc_subscription_events.error, /Invalid version/);
  assert.ok(calls.some(c => c.query?.['filter[reportType]'] === 'SUBSCRIPTION' && c.query['filter[version]'] === '1_5'), 'retried with the version Apple asked for');
  assert.equal(out.storekit_notification, 2, 'both pages'); assert.equal(out.ads, 'Apple Ads isn\'t set up yet');
  assert.ok(calls.every(c => !c.method || ['GET', 'POST'].includes(c.method)) && calls.filter(c => c.path === '/v1/salesReports').every(c => c.query['filter[vendorNumber]'] === '12345678'));
  const { rows } = await pool.query(`SELECT source, count(*)::int AS n FROM apple_metrics GROUP BY source ORDER BY source`);
  assert.deepEqual(rows, [{ source: 'asc_sales', n: 2 }, { source: 'storekit_notification', n: 2 }]);
  // Pulling the same days again replaces rows instead of adding to them.
  await m.pull();
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM apple_metrics`)).rows[0].n, 4);
  const s = await m.summary();
  assert.match(s.pulls.find(p => p.source === 'asc_subscription_events').last_error, /Invalid version/);
  // No broker, no pull, and a reason.
  const none = createAppleMetrics({ pool, apple: { installed: () => false, status: async () => ({ ok: false, error: 'the Apple broker is not installed yet' }) }, clock: () => now, log: quiet, settingsPath });
  assert.deepEqual(await none.pull(), { broker: 'the Apple broker is not installed yet' });
}));

test('what the broker\'s reconciler found outside it reaches Quinn once', async () => database(async pool => {
  const now = Date.parse('2026-09-28T15:00:00Z');
  const dir = await mkdtemp(join(tmpdir(), 'apple-drift-'));
  const settingsPath = join(dir, 'settings.json');
  await writeFile(settingsPath, JSON.stringify({ pursuit: 27 }));
  let drift = [{ at: '2026-09-28T14:30:00Z', campaign: 'US', change: 'daily budget raised from $10.00 to $30.00', action: 'paused' }];
  const alerts = [];
  const m = createAppleMetrics({ pool, apple: { installed: () => true, status: async () => ({ ok: true, ads: { drift } }) }, clock: () => now, log: quiet, settingsPath, alert: a => { alerts.push(a); } });
  await m.init();
  assert.equal(await m.watchDrift(), 1);
  assert.deepEqual(alerts, [{ chainId: 27, detail: 'Apple Ads changed outside the Apple broker: US: daily budget raised from $10.00 to $30.00 (paused)' }]);
  assert.equal(await m.watchDrift(), 0, 'once');
  drift = [...drift, { at: '2026-09-28T15:00:00Z', campaign: 'UK', change: 'resumed', action: 'reported' }];
  assert.equal(await m.watchDrift(), 1); assert.match(alerts[1].detail, /UK: resumed \(reported\)$/);
}));
