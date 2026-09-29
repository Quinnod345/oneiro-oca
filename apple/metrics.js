// Apple's numbers, in one place. Once a day the engine pulls what the Apple broker can read into apple_metrics,
// one row per source, day and subject:
// - asc_sales, asc_subscriptions, asc_subscription_events: App Store Connect's Sales and Trends summaries (units,
//   proceeds, active subscriptions, starts, renewals and cancellations);
// - ads_campaign, ads_keyword, ads_searchterm: Apple Ads' daily reports;
// - storekit_notification: every server notification the App Store sent for the app, which covers renewals,
//   cancellations and refunds.
// Absence stays absence. A source that isn't set up, or a day Apple hasn't finished, has no rows, and apple_pulls
// says why. Nothing here writes to Apple; every call is a read.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';

export const SETTINGS_PATH = process.env.OCA_APPLE_SETTINGS || '/Users/quinnodonnell/oneiro/runtime/workspace/apple/settings.json';
const DAY = 86_400_000;
const text = (v, max = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const isoDay = ms => new Date(ms).toISOString().slice(0, 10);

// Sales and Trends columns that are numbers; everything else in a row describes it.
const NUMERIC = new Set(['Units', 'Developer Proceeds', 'Customer Price', 'Quantity', 'Proceeds', 'Subscribers',
  'Active Standard Price Subscriptions', 'Active Free Trial Introductory Offer Subscriptions', 'Active Pay Up Front Introductory Offer Subscriptions',
  'Active Pay As You Go Introductory Offer Subscriptions', 'Marketing Opt-Ins', 'Billing Retry', 'Grace Period', 'Days Before Canceling', 'Days Canceled']);

const ADDITIVE = new Set([...NUMERIC].filter(h => !['Customer Price', 'Days Before Canceling', 'Days Canceled'].includes(h)));

// A tab-separated Sales and Trends report, as Apple sends it (gzipped, base64 through the broker), into rows
// that sum duplicates: { dims, metrics }.
export function parseSalesReport(tsv) {
  const lines = String(tsv).split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split('\t').map(h => h.trim());
  const rows = new Map();
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    const dims = {}, metrics = {};
    header.forEach((h, i) => {
      const v = (cells[i] ?? '').trim();
      if (NUMERIC.has(h)) { const n = Number(v); if (v !== '' && Number.isFinite(n)) metrics[h] = n; }
      else if (v !== '') dims[h] = v;
    });
    const key = createHash('sha1').update(JSON.stringify(Object.entries(dims).sort())).digest('hex').slice(0, 20);
    const prior = rows.get(key);
    // Counts add up; a price or a day count describes the row and keeps its first value.
    if (prior) for (const [m, n] of Object.entries(metrics)) prior.metrics[m] = ADDITIVE.has(m) ? (prior.metrics[m] || 0) + n : (prior.metrics[m] ?? n);
    else rows.set(key, { key, dims, metrics });
  }
  return [...rows.values()];
}

// A JWS's payload, decoded but not verified: it came from Apple over the broker's authenticated connection.
export function jwsPayload(jws) {
  const part = String(jws || '').split('.')[1];
  if (!part) return null;
  try { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); } catch { return null; }
}

// One App Store server notification as a metrics row.
export function notificationRow(signedPayload) {
  const n = jwsPayload(signedPayload);
  if (!n?.notificationUUID) return null;
  const tx = jwsPayload(n.data?.signedTransactionInfo) || {};
  const at = Number(n.signedDate) || Number(tx.signedDate) || null;
  return {
    day: at ? isoDay(at) : null, key: n.notificationUUID,
    dims: { type: n.notificationType, subtype: n.subtype || null, productId: tx.productId || null, storefront: tx.storefront || null,
      environment: n.data?.environment || tx.environment || null, offerType: tx.offerType ?? null },
    metrics: { ...(Number.isFinite(tx.price) ? { price: tx.price / 1000 } : {}), currency: tx.currency || null,
      transactionId: tx.transactionId || null, originalTransactionId: tx.originalTransactionId || null,
      ...(tx.revocationDate ? { revokedAt: new Date(tx.revocationDate).toISOString(), revocationReason: tx.revocationReason ?? null } : {}) },
  };
}

// An Apple Ads report's rows, one per entity per day: the entity from `metadata`, the numbers from `granularMetrics`.
export function adsReportRows(report, entity) {
  const out = [];
  for (const row of report?.result?.rows || []) {
    const m = row.metadata || {};
    const key = entity === 'searchterm'
      ? `${m.adGroupId ?? m.adGroup?.id ?? '?'}:${m.searchTermText || '(low volume)'}`
      : String(m.id ?? m[`${entity}Id`] ?? m.keywordId ?? m.campaignId ?? '?');
    const dims = entity === 'searchterm'
      ? { searchTerm: m.searchTermText || null, source: m.searchTermSource || null, keyword: m.keyword?.text ?? m.keyword?.keyword ?? null,
          keywordId: m.keyword?.id ?? null, matchType: m.keyword?.matchType ?? null, adGroupId: m.adGroupId ?? m.adGroup?.id ?? null, campaignId: m.campaignId ?? null }
      : { name: m.name ?? m.text ?? m.keyword ?? null, campaignId: m.campaignId ?? (entity === 'campaign' ? m.id : null) ?? null,
          adGroupId: m.adGroupId ?? null, matchType: m.matchType ?? null, status: m.status ?? m.displayStatus ?? null };
    for (const g of row.granularMetrics || []) {
      if (!g.date) continue;
      const metrics = {};
      for (const [k, v] of Object.entries(g)) {
        if (k === 'date') continue;
        if (v && typeof v === 'object' && 'amount' in v) { metrics[k] = Number(v.amount); metrics.currency = v.currency; }
        else if (typeof v === 'number') metrics[k] = v;
      }
      out.push({ day: String(g.date).slice(0, 10), key, dims, metrics });
    }
  }
  return out;
}

// after: what runs once a pull has read Apple (the growth loop), so its moves always see fresh numbers.
// alert: how drift the broker's reconciler found reaches Quinn (a notice), once per finding.
export function createAppleMetrics({ pool, apple, clock = Date.now, log = console, settingsPath = SETTINGS_PATH, tickMs = 3600_000, everyMs = 20 * 3600_000, after = null, alert = null } = {}) {
  let timer = null, running = null;
  // Sales and Trends report versions. The subscription reports need one; Apple says which when it changes.
  const versions = { SUBSCRIPTION: '1_4', SUBSCRIPTION_EVENT: '1_4' };
  async function init() { await pool.query(await readFile(new URL('../migrations/065_apple_metrics.sql', import.meta.url), 'utf8')); }
  async function settings() {
    try { return JSON.parse(await readFile(settingsPath, 'utf8')); } catch { return {}; }
  }

  async function store(source, rows) {
    for (const r of rows) {
      if (!r.day) continue;
      await pool.query(`INSERT INTO apple_metrics (source, day, key, dims, metrics, fetched_at) VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))
        ON CONFLICT (source, day, key) DO UPDATE SET dims = EXCLUDED.dims, metrics = EXCLUDED.metrics, fetched_at = EXCLUDED.fetched_at`,
      [source, r.day, text(r.key, 300), JSON.stringify(r.dims || {}), JSON.stringify(r.metrics || {}), clock()]);
    }
  }
  async function mark(source, { rows = 0, error = null }) {
    if (error) await pool.query(`INSERT INTO apple_pulls (source, last_error, last_error_at) VALUES ($1, $2, to_timestamp($3 / 1000.0))
      ON CONFLICT (source) DO UPDATE SET last_error = EXCLUDED.last_error, last_error_at = EXCLUDED.last_error_at`, [source, text(error, 500), clock()]);
    else await pool.query(`INSERT INTO apple_pulls (source, last_ok_at, rows, last_error) VALUES ($1, to_timestamp($2 / 1000.0), $3, NULL)
      ON CONFLICT (source) DO UPDATE SET last_ok_at = EXCLUDED.last_ok_at, rows = EXCLUDED.rows, last_error = NULL`, [source, clock(), rows]);
  }
  // The broker's answer, or a thrown reason worth recording.
  async function read(request) {
    const r = await apple.call(request);
    if (!r?.ok) throw new Error(r?.error || (r?.status ? `Apple answered ${r.status}: ${text(JSON.stringify(r.body), 300)}` : 'the Apple broker said no'));
    return r;
  }

  // Sales and Trends for the last few days: Apple posts a day's report the next day and can revise it.
  async function salesReports(s) {
    if (!s.vendorNumber) throw new Error('needs the vendor number in apple/settings.json');
    const kinds = [['asc_sales', 'SALES'], ['asc_subscriptions', 'SUBSCRIPTION'], ['asc_subscription_events', 'SUBSCRIPTION_EVENT']];
    const counts = {};
    for (const [source, reportType] of kinds) {
      let rows = 0, lastError = null;
      for (let back = 1; back <= 4; back++) {
        const day = isoDay(clock() - back * DAY);
        const ask = () => apple.call({ api: 'asc', method: 'GET', path: '/v1/salesReports',
          query: { 'filter[frequency]': 'DAILY', 'filter[reportDate]': day, 'filter[reportSubType]': 'SUMMARY', 'filter[reportType]': reportType,
            'filter[vendorNumber]': String(s.vendorNumber), ...(versions[reportType] ? { 'filter[version]': versions[reportType] } : {}) } });
        let r = await ask();
        // Apple names the version it wants when a report needs one; use it, and remember it for the next days.
        const wanted = r?.ok ? null : /latest version for this report is ([0-9_]+)/.exec(JSON.stringify(r?.body || ''))?.[1];
        if (wanted && wanted !== versions[reportType]) { versions[reportType] = wanted; r = await ask(); }
        // No report yet for a day is Apple's 404, not a failure.
        if (!r?.ok) { if (r?.status !== 404) lastError = r?.error || `Apple answered ${r?.status}: ${text(JSON.stringify(r?.body), 300)}`; continue; }
        if (!r.bodyBase64) continue;
        const parsed = parseSalesReport(gunzipSync(Buffer.from(r.bodyBase64, 'base64')).toString('utf8')).map(x => ({ ...x, day }));
        await store(source, parsed); rows += parsed.length;
      }
      if (lastError && !rows) { await mark(source, { error: lastError }); counts[source] = { error: lastError }; }
      else { await mark(source, { rows }); counts[source] = rows; }
    }
    return counts;
  }

  // Apple Ads: the last week of campaign, keyword and search-term rows, by day in the account's time zone.
  async function adsReports() {
    const counts = {};
    const range = { start: isoDay(clock() - 7 * DAY), end: isoDay(clock() - DAY), timeZone: 'ORTZ', granularity: 'DAILY' };
    for (const entity of ['campaign', 'keyword', 'searchterm']) {
      const source = `ads_${entity}`;
      try {
        const r = await read({ api: 'ads', method: 'POST', path: `/v1/reports/apps/${entity === 'campaign' ? 'campaigns' : entity === 'keyword' ? 'keywords' : 'searchterms'}/query`,
          body: { timeRange: range, pagination: { offset: 0, pageSize: 1000 } } });
        const rows = adsReportRows(r.body, entity);
        await store(source, rows); await mark(source, { rows: rows.length }); counts[source] = rows.length;
      } catch (e) { await mark(source, { error: e.message }); counts[source] = { error: e.message }; }
    }
    return counts;
  }

  // The App Store's server notifications for the last three days, page by page.
  async function notifications() {
    const rows = [];
    let token = null, pages = 0;
    do {
      const r = await read({ api: 'storekit', method: 'POST', path: '/inApps/v1/notifications/history', ...(token ? { query: { paginationToken: token } } : {}),
        body: { startDate: clock() - 3 * DAY, endDate: clock() } });
      for (const item of r.body?.notificationHistory || []) { const row = notificationRow(item.signedPayload); if (row) rows.push(row); }
      token = r.body?.hasMore ? r.body.paginationToken : null;
    } while (token && ++pages < 50);
    await store('storekit_notification', rows);
    return rows.length;
  }

  // One pull of every source. A source that fails says why in apple_pulls; the others still run.
  async function pull() {
    if (running) return running;
    running = (async () => {
      const s = await settings();
      const out = {};
      const status = await apple.status().catch(e => ({ ok: false, error: e.message }));
      if (!status?.ok) { await mark('broker', { error: status?.error || 'the Apple broker is unavailable' }); return { broker: status?.error || 'unavailable' }; }
      const configured = status.configured || {};
      if ((configured.asc || []).length) {
        try { Object.assign(out, await salesReports(s)); } catch (e) { await mark('asc_sales', { error: e.message }); out.asc_sales = { error: e.message }; }
      } else out.asc = 'no App Store Connect key yet';
      if (configured.ads?.adAccount) Object.assign(out, await adsReports().catch(e => ({ ads: { error: e.message } })));
      else out.ads = 'Apple Ads isn\'t set up yet';
      if (configured.storekit) {
        try { const n = await notifications(); await mark('storekit_notification', { rows: n }); out.storekit_notification = n; }
        catch (e) { await mark('storekit_notification', { error: e.message }); out.storekit_notification = { error: e.message }; }
      } else out.storekit = 'no App Store Server API key yet';
      log.log?.(`[apple] pulled ${JSON.stringify(out)}`);
      if (after) out.after = await after().catch(e => ({ error: e.message }));
      return out;
    })().finally(() => { running = null; });
    return running;
  }

  async function due() {
    const { rows: [r] } = await pool.query(`SELECT max(last_ok_at) AS at FROM apple_pulls WHERE source NOT IN ('broker', 'drift_alert')`);
    return !r?.at || clock() - new Date(r.at).getTime() >= everyMs;
  }
  // The broker's reconciler runs every half hour on its own; what it found outside the broker (a budget raised,
  // a campaign resumed or added, a campaign it paused to hold the caps) reaches Quinn once, as a notice.
  async function watchDrift() {
    if (!alert) return 0;
    const status = await apple.status().catch(() => null);
    const drift = status?.ads?.drift || [];
    if (!drift.length) return 0;
    const { rows: [r] } = await pool.query(`SELECT last_ok_at FROM apple_pulls WHERE source = 'drift_alert'`);
    const since = r?.last_ok_at ? new Date(r.last_ok_at).getTime() : 0;
    const fresh = drift.filter(d => Date.parse(d.at) > since);
    if (!fresh.length) return 0;
    const s = await settings();
    await alert({ chainId: Number(s.pursuit) || null, detail: `Apple Ads changed outside the Apple broker: ${fresh.map(d => `${d.campaign}: ${d.change} (${d.action})`).join('; ')}` });
    await pool.query(`INSERT INTO apple_pulls (source, last_ok_at, rows) VALUES ('drift_alert', to_timestamp($1 / 1000.0), $2)
      ON CONFLICT (source) DO UPDATE SET last_ok_at = EXCLUDED.last_ok_at, rows = EXCLUDED.rows`, [Math.max(...fresh.map(d => Date.parse(d.at))), fresh.length]);
    return fresh.length;
  }
  async function tick() {
    try {
      if (apple.installed?.() === false) return;
      await watchDrift();
      if (await due()) await pull();
    } catch (e) { log.warn?.('[apple] pull:', e.message); }
  }
  function start() { if (!timer) { timer = setInterval(tick, tickMs); timer.unref?.(); setTimeout(tick, 60_000).unref?.(); } }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  async function summary() {
    const { rows: pulls } = await pool.query(`SELECT source, last_ok_at, rows, last_error, last_error_at FROM apple_pulls ORDER BY source`);
    const { rows: counts } = await pool.query(`SELECT source, count(*)::int AS n, min(day) AS first, max(day) AS last FROM apple_metrics GROUP BY source ORDER BY source`);
    return { pulls, counts };
  }

  return { init, pull, tick, start, stop, summary, watchDrift, salesReports, adsReports, notifications };
}
