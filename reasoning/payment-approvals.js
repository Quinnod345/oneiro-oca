// Payments ask on Quinn's iPhone, with Approve and Deny. For each payment ask the engine opens a gateway approval;
// OpenClaw pushes it to his iPhone as a notification he can pull down or press and hold, then tap Approve (after the
// phone unlocks) or Deny. His tap resolves it on the gateway, and the engine reads the decision back.
//
// A decision counts only when the gateway recorded it as made on one of his approving devices: the paired phone the
// engine pushes to, plus any listed in OCA_PAYMENT_APPROVER_DEVICES. The gateway takes that identity from the
// device's signed connection, not from anything the client says. A client on this Mac, where agents run, resolves as
// another device and is ignored, so an agent can't approve its own payment, and Quinn hears about the attempt.
// The decision answers the ask and wakes every agent waiting on it, like a reply in its session would.
//
// The first answer wins. The gateway keeps an approval open for ten minutes at most; after that, or once he has
// answered in Messages or the app, the phone's prompt is gone and the ask is settled the way he answered it.
const text = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const APPROVAL_WINDOW_MS = 600_000;
export const APPROVE = 'allow-once';
export const DENY = 'deny';

// The gateway answers either with the value itself or wrapped; read the id or approval from any of those shapes.
const unwrap = r => (r && typeof r === 'object' ? (r.result ?? r.payload ?? r) : r);

export function createPaymentApprovals({ pool, gateway, deciders = [], clock = Date.now, log = console, onDecision = null, onUntrusted = null, tickMs = 10_000 } = {}) {
  const trusted = new Set(deciders.filter(Boolean).map(String));
  let timer = null, ticking = false;

  async function settle(askId, fields) {
    await pool.query(`UPDATE notifications SET metadata = jsonb_set(metadata, '{approval}', COALESCE(metadata->'approval', '{}'::jsonb) || $2::jsonb) WHERE id = $1`,
      [askId, JSON.stringify(fields)]);
  }

  // Opens the approval for one payment ask and returns what the ask records ({ id, requestedAt, expiresAt }), or null
  // when the gateway couldn't take it or had no way to reach the phone (the ask then goes out as a plain push, and
  // stands in the app and in Messages).
  async function request({ title, description, detail = null }) {
    if (!trusted.size) { log.warn?.('[payments] no approving device is configured; the ask goes out as a plain push'); return null; }
    let r;
    try {
      r = unwrap(await gateway.call('plugin.approval.request', {
        pluginId: 'oneiro.payments', title: text(title, 80), description: text(description, 512), ...(detail ? { detail: text(detail, 4000) } : {}),
        severity: 'warning', allowedDecisions: [APPROVE, DENY], timeoutMs: APPROVAL_WINDOW_MS, twoPhase: true,
      }, { timeout: 30_000 }));
    } catch (e) { log.warn?.('[payments] approval request failed:', text(e.message, 200)); return null; }
    if (r?.status !== 'accepted' || !r.id) {
      log.warn?.(`[payments] the gateway could not deliver the approval (${text(JSON.stringify(r), 200)}); the ask goes out as a plain push`);
      return null;
    }
    const at = clock();
    return { id: r.id, requestedAt: at, expiresAt: Number(r.expiresAtMs) || at + APPROVAL_WINDOW_MS, route: r.deliveryRoute || null };
  }

  // Reads back every open approval. A decision from his phone answers the ask; one from anywhere else is ignored and
  // reported. An ask he already answered another way keeps that answer, and its prompt is taken off the phone.
  async function tick() {
    if (ticking) return; ticking = true;
    try {
      const { rows } = await pool.query(`SELECT id, replied_at, metadata FROM notifications WHERE category = 'ask'
        AND metadata->'approval'->>'id' IS NOT NULL AND metadata->'approval'->>'settled' IS NULL ORDER BY id LIMIT 20`);
      for (const a of rows) {
        const ap = a.metadata.approval;
        if (a.replied_at) {
          await settle(a.id, { settled: 'answered-elsewhere' });
          await gateway.call('approval.resolve', { id: ap.id, kind: 'plugin', decision: DENY }, { timeout: 20_000 }).catch(() => {});
          continue;
        }
        const lapsed = clock() > Number(ap.expiresAt || 0) + 60_000;
        let snap = null;
        try { snap = unwrap(await gateway.call('approval.get', { id: ap.id }, { timeout: 20_000 }))?.approval ?? null; }
        catch (e) {   // gone from the gateway can never be decided; anything else is retried until the window lapses
          if (lapsed || /not.?found/i.test(e.message)) await settle(a.id, { settled: 'expired' }); else log.warn?.(`[payments] ask #${a.id}: approval.get failed:`, text(e.message, 160));
          continue;
        }
        if (!snap || snap.status === 'pending') { if (lapsed) await settle(a.id, { settled: 'expired' }); continue; }
        const decision = snap.decision, resolver = snap.resolver || null;
        if (decision !== APPROVE && decision !== DENY) { await settle(a.id, { settled: 'expired', status: snap.status ?? null }); continue; }
        if (resolver?.kind !== 'device' || !trusted.has(String(resolver.id))) {
          const who = resolver ? `${resolver.kind} ${text(resolver.id, 12)}` : 'an unknown client';
          log.warn?.(`[payments] ask #${a.id}: ${decision} came from ${who}, not Quinn's phone; ignored`);
          await settle(a.id, { settled: 'untrusted', decision, resolver });
          try { await onUntrusted?.({ askId: a.id, decision, resolver }); } catch (e) { log.warn?.('[payments] untrusted notice:', text(e.message, 160)); }
          continue;
        }
        await settle(a.id, { settled: decision, resolver, decidedAt: snap.resolvedAtMs ?? clock() });
        log.log?.(`[payments] ask #${a.id}: ${decision === APPROVE ? 'approved' : 'denied'} on Quinn's iPhone`);
        try { await onDecision?.({ askId: a.id, approved: decision === APPROVE }); }
        catch (e) { log.warn?.(`[payments] ask #${a.id}: the decision couldn't reach its agent:`, text(e.message, 200)); }
      }
    } finally { ticking = false; }
  }

  function start() { if (!timer) { timer = setInterval(() => { tick().catch(e => log.warn?.('[payments] tick:', e.message)); }, tickMs); timer.unref?.(); } }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { request, tick, start, stop, deciders: () => [...trusted] };
}
