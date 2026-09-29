// The growth loop. Once a day, after Apple's numbers are pulled, it proposes the moves those numbers support, and
// only past a minimum sample. Small numbers are mostly noise, and Apple withholds or blurs the smallest.
// - A search term that converts (enough taps and installs, cost per install at or under target) becomes an
//   exact-match keyword in its ad group, bid at the term's average cost per tap.
// - A term with enough taps and no installs becomes an exact negative in its ad group.
// - A keyword well under the target cost per install gets a bid 15% up; one well over it, or with no installs,
//   gets a bid 15% down.
// - Converting terms collect for the next release's keyword field, which only changes with a new version.
// - A customer review without a reply gets a drafted reply. Posting it is always Quinn's.
// Every move goes to the Apple broker, which decides it. In dry-run, its answer is what would happen; in live
// mode, a move that needs Quinn comes back with the command he runs to approve it, and the loop retries it with
// that approval until he does. The loop never goes around the broker.
import { readFile } from 'node:fs/promises';
import { Router } from 'express';
import { SETTINGS_PATH } from './metrics.js';

const DAY = 86_400_000;
const text = (v, max = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const round2 = n => Math.round(n * 100) / 100;
// Key order doesn't matter (Postgres reorders stored JSON), so compare requests by their sorted form.
const canonical = v => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));

export const RULES = {
  windowDays: 14,
  promote: { minTaps: 10, minInstalls: 3 },
  negative: { minTaps: 20 },
  bid: { minTaps: 20, step: 0.15, wellUnder: 0.7, wellOver: 1.3 },
  aso: { minInstalls: 3 },
};

// Rows of one source over the window, summed per subject.
function totals(rows) {
  const by = new Map();
  for (const r of rows) {
    const t = by.get(r.key) || { key: r.key, dims: r.dims, taps: 0, installs: 0, spend: 0, currency: null };
    t.taps += Number(r.metrics?.taps) || 0;
    t.installs += Number(r.metrics?.tapInstalls) || 0;
    t.spend += Number(r.metrics?.localSpend) || 0;
    t.currency = r.metrics?.currency || t.currency;
    by.set(r.key, t);
  }
  return [...by.values()];
}

// The moves the numbers support, before anyone decides them. Pure, so the thresholds are easy to test.
export function propose({ searchTerms, keywords, targetCpi = null, rules = RULES }) {
  const out = [];
  const exact = new Set(keywords.filter(k => String(k.dims?.matchType).toUpperCase() === 'EXACT')
    .map(k => `${k.dims?.adGroupId}:${String(k.dims?.name || '').toLowerCase()}`));
  const aso = [];
  for (const t of searchTerms) {
    const term = t.dims?.searchTerm, group = t.dims?.adGroupId;
    if (!term || !group) continue;   // low-volume terms have no text; Apple doesn't say what they were
    const cpi = t.installs ? t.spend / t.installs : null;
    const evidence = { window: `${rules.windowDays} days`, taps: t.taps, installs: t.installs, spend: round2(t.spend), cpi: cpi == null ? null : round2(cpi), targetCpi };
    if (t.installs >= rules.aso.minInstalls) aso.push({ term, installs: t.installs });
    if (targetCpi && t.taps >= rules.promote.minTaps && t.installs >= rules.promote.minInstalls && cpi <= targetCpi && !exact.has(`${group}:${term.toLowerCase()}`)) {
      out.push({ kind: 'promote_keyword', subject: `${group}:${term}`, evidence, why: `“${term}” converts: ${t.installs} installs from ${t.taps} taps at $${round2(cpi)} each, at or under the $${targetCpi} target`,
        request: { api: 'ads', method: 'POST', path: '/v1/keywords/bulk-create', body: { allowPartialSuccess: true, items: [{ correlationId: 1,
          data: { adGroupId: Number(group), text: term, matchType: 'EXACT', status: 'ENABLED', bid: { amount: String(Math.max(0.1, round2(t.spend / t.taps))), currency: t.currency || 'USD' } } }] } } });
    }
    if (t.taps >= rules.negative.minTaps && t.installs === 0) {
      out.push({ kind: 'negative_keyword', subject: `${group}:${term}`, evidence, why: `“${term}” drew ${t.taps} taps and no installs over ${rules.windowDays} days`,
        request: { api: 'ads', method: 'POST', path: '/v1/negative-keywords/bulk-create', body: { allowPartialSuccess: true, items: [{ correlationId: 1,
          data: { adGroupId: Number(group), text: term, matchType: 'EXACT', status: 'ENABLED' } }] } } });
    }
  }
  for (const k of keywords) {
    if (k.taps < rules.bid.minTaps) continue;
    const cpi = k.installs ? k.spend / k.installs : null;
    const evidence = { window: `${rules.windowDays} days`, taps: k.taps, installs: k.installs, spend: round2(k.spend), cpi: cpi == null ? null : round2(cpi), targetCpi };
    let direction = null, why = '';
    if (k.installs === 0) { direction = -1; why = `“${k.dims?.name}” drew ${k.taps} taps and no installs`; }
    else if (targetCpi && cpi < targetCpi * rules.bid.wellUnder) { direction = 1; why = `“${k.dims?.name}” installs at $${round2(cpi)}, well under the $${targetCpi} target`; }
    else if (targetCpi && cpi > targetCpi * rules.bid.wellOver) { direction = -1; why = `“${k.dims?.name}” installs at $${round2(cpi)}, well over the $${targetCpi} target`; }
    if (direction) out.push({ kind: direction > 0 ? 'bid_up' : 'bid_down', subject: String(k.key), keywordId: Number(k.key), direction, evidence, why });
  }
  if (aso.length) {
    aso.sort((a, b) => b.installs - a.installs);
    out.push({ kind: 'aso_keywords', subject: 'next-release', evidence: { terms: aso.slice(0, 25) },
      why: `search terms that convert, for the next release's keyword field: ${aso.slice(0, 8).map(a => a.term).join(', ')}` });
  }
  return out;
}

export function createAppleGrowth({ pool, apple, llm = null, asks = null, clock = Date.now, log = console, settingsPath = SETTINGS_PATH, rules = RULES } = {}) {
  async function init() { await pool.query(await readFile(new URL('../migrations/066_apple_proposals.sql', import.meta.url), 'utf8')); }
  async function settings() { try { return JSON.parse(await readFile(settingsPath, 'utf8')); } catch { return {}; } }

  async function window(source) {
    const { rows } = await pool.query(`SELECT key, dims, metrics FROM apple_metrics WHERE source = $1 AND day >= $2::date`, [source, new Date(clock() - rules.windowDays * DAY).toISOString().slice(0, 10)]);
    return totals(rows);
  }

  // A bid move needs the keyword's current bid, which the reports don't carry.
  async function withBid(p) {
    const r = await apple.call({ api: 'ads', method: 'GET', path: `/v1/keywords/${p.keywordId}` });
    const bid = Number(r?.body?.result?.bid?.amount);
    if (!r?.ok || !Number.isFinite(bid)) return null;
    const next = round2(bid * (1 + p.direction * rules.bid.step));
    return { ...p, why: `${p.why}: bid $${bid} → $${next}`, request: { api: 'ads', method: 'POST', path: '/v1/keywords/bulk-update', body: { allowPartialSuccess: true,
      items: [{ correlationId: 1, data: { id: p.keywordId, bid: { amount: String(next), currency: r.body.result.bid.currency || 'USD' } } }] } } };
  }

  // Replies for recent reviews that don't have one, drafted for Quinn to approve. Written in his voice: calm,
  // specific, never defensive, never promising what the app doesn't do.
  async function reviewReplies(s) {
    if (!llm || !s.app?.appId) return [];
    const r = await apple.call({ api: 'asc', method: 'GET', path: `/v1/apps/${s.app.appId}/customerReviews`, query: { sort: '-createdDate', limit: '20', include: 'response' } });
    if (!r?.ok) return [];
    const out = [];
    for (const review of r.body?.data || []) {
      if (review.relationships?.response?.data) continue;
      const a = review.attributes || {};
      const reply = text(await llm.messages.create({ provider: 'codex', max_tokens: 400, temperature: 0.3,
        system: 'You draft a developer reply to an App Store review of InnerEcho, a journaling app, for its maker Quinn to approve. Plain, warm, specific, under 400 characters. Thank them for something they actually said; answer their point honestly; never promise features, dates or refunds; never be defensive. Reply with the text only.',
        messages: [{ role: 'user', content: `Rating: ${a.rating}/5\nTitle: ${a.title || ''}\nReview: ${a.body || ''}` }] }).then(x => (typeof x === 'string' ? x : x?.content?.[0]?.text ?? '')).catch(() => ''), 1000);
      if (!reply) continue;
      out.push({ kind: 'review_reply', subject: review.id, evidence: { rating: a.rating, title: a.title || null, review: text(a.body, 600), territory: a.territory || null },
        why: `a ${a.rating}-star review from ${a.createdDate ? a.createdDate.slice(0, 10) : 'recently'} has no reply`,
        request: { api: 'asc', method: 'POST', path: '/v1/customerReviewResponses', body: { data: { type: 'customerReviewResponses', attributes: { responseBody: reply },
          relationships: { review: { data: { type: 'customerReviews', id: review.id } } } } } } });
    }
    return out;
  }

  // Sends a proposal's request to the broker, unless nothing changed since its last answer.
  async function decide(p, pursuit) {
    const { rows: [prior] } = await pool.query(`SELECT request, status, approval_id FROM apple_proposals WHERE kind = $1 AND subject = $2`, [p.kind, p.subject]);
    if (prior?.status === 'sent') return { ...p, status: 'sent', unchanged: true };
    let decision = null, status = 'proposed', approvalId = prior?.approval_id || null;
    const same = prior && canonical(prior.request) === canonical(p.request || null);
    if (p.request && !(same && prior.status === 'dry_run')) {
      const r = await apple.call({ ...p.request, reason: p.why, chainId: pursuit, ...(same && approvalId ? { approval: approvalId } : {}) });
      decision = { decision: r.decision, why: r.why || [], notes: r.notes || [], error: r.error || null, approve: r.approve || null, wouldNeedApproval: r.wouldNeedApproval ?? null };
      status = r.decision === 'dry_run' ? 'dry_run' : r.decision === 'needs_approval' ? 'needs_approval' : r.decision === 'sent' ? 'sent'
        : /still waiting on Quinn/.test(r.error || '') ? 'needs_approval' : r.decision === 'denied' ? 'denied' : 'failed';
      if (r.approvalId) approvalId = r.approvalId;
      // An approval that was used or ran out can't be spent again: the next run asks afresh.
      if (/is used|expired|different request/.test(r.error || '')) approvalId = null;
      if (r.decision === 'needs_approval' && asks && !(same && prior.status === 'needs_approval')) {
        await asks.ask({ chainId: pursuit, kind: 'question', detail: `Approve an Apple change: ${text(p.why, 200)}. In Terminal on your Mac, run: ${r.approve}` }).catch(() => {});
      }
    } else if (same) status = prior.status;
    await pool.query(`INSERT INTO apple_proposals (kind, subject, evidence, request, why, status, decision, approval_id, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9 / 1000.0))
      ON CONFLICT (kind, subject) DO UPDATE SET evidence = EXCLUDED.evidence, request = EXCLUDED.request, why = EXCLUDED.why, status = EXCLUDED.status,
        decision = COALESCE(EXCLUDED.decision, apple_proposals.decision), approval_id = EXCLUDED.approval_id, updated_at = EXCLUDED.updated_at`,
    [p.kind, text(p.subject, 300), JSON.stringify(p.evidence || {}), JSON.stringify(p.request || null), text(p.why, 1000), status, decision ? JSON.stringify(decision) : null, approvalId, clock()]);
    return { ...p, status, decision };
  }

  async function run() {
    const s = await settings();
    const status = await apple.status().catch(() => null);
    if (!status?.ok) return { skipped: 'the Apple broker isn\'t installed or reachable yet' };
    const targetCpi = Number(s.appleAds?.targetCpi) || null;
    const ideas = propose({ searchTerms: await window('ads_searchterm'), keywords: await window('ads_keyword'), targetCpi, rules });
    const bids = [];
    for (const p of ideas.filter(p => p.kind === 'bid_up' || p.kind === 'bid_down')) { const full = await withBid(p); if (full) bids.push(full); }
    const moves = [...ideas.filter(p => p.kind !== 'bid_up' && p.kind !== 'bid_down'), ...bids, ...await reviewReplies(s).catch(() => [])];
    const decided = [];
    for (const p of moves) decided.push(await decide(p, Number(s.pursuit) || null));
    log.log?.(`[apple] growth: ${decided.length} move(s): ${decided.map(d => `${d.kind} ${d.status}`).join(', ') || 'none, the numbers don\'t support any yet'}`);
    return { mode: status.mode, targetCpi, moves: decided.map(d => ({ kind: d.kind, subject: d.subject, status: d.status, why: d.why })) };
  }

  async function recent(limit = 50) {
    const { rows } = await pool.query(`SELECT id, kind, subject, evidence, request, why, status, decision, approval_id, updated_at FROM apple_proposals ORDER BY updated_at DESC LIMIT $1`, [limit]);
    return rows;
  }

  return { init, run, recent, propose };
}

// What the app and Quinn see: the broker's state, what each source last pulled, and the loop's proposals.
export function appleRouter({ apple, metrics, growth }) {
  const router = Router();
  const route = h => async (req, res) => { try { res.json(await h(req)); } catch (e) { res.status(400).json({ error: e.message }); } };
  router.get('/oca/apple', route(async () => ({ broker: await apple.status(), metrics: await metrics.summary(), proposals: await growth.recent(50) })));
  // A pull with the growth loop after it can take minutes (drafting review replies), so it runs in the background;
  // GET /oca/apple shows what it found.
  let pulling = null;
  router.post('/oca/apple/pull', route(async () => {
    if (pulling) return { running: true };
    pulling = metrics.pull().catch(e => ({ error: e.message })).finally(() => { pulling = null; });
    return { started: true, see: '/oca/apple' };
  }));
  return router;
}
