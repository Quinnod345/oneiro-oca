// Every payment waits for Quinn's yes, and only Quinn can give it. Each payment ask carries a one-time code bound to that
// one request; he approves by texting "APPROVE <code>" (or "DENY <code>") from his own phone, in the Oneiro conversation
// in Messages. The engine reads that reply from the work Mac's Messages database, where a message counts as his only if
// Messages received it from his handle — nothing running on this Mac, where agents run, can produce one. So an agent
// can never approve its own payment, even though it can read the engine's tables: the code alone approves nothing.
//
// The code is stored only as a hash. The first answer wins. An approval stays open ten minutes; after that, or once he
// has answered the ask another way, it is settled and the code is dead. A decision for another request, a reused code,
// or a late one is refused, and he is told when it comes from a text he sent. When a window closes while the want is
// still active, the engine asks once more with a new code (asks.js reissueExpired), in the morning if it closed overnight.
// A new code only reopens the question: nothing here ever approves on its own.
//
// This replaced the OpenClaw gateway's plugin approvals and iPhone push (2026-11): the phone app is retired, and
// Messages on his phone is now the one place a payment is decided.
import { createHash, randomInt } from 'node:crypto';

const text = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const APPROVAL_WINDOW_MS = 600_000;
export const APPROVE = 'allow-once';
export const DENY = 'deny';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I: a code read off a lock screen is typed right
export const hashCode = code => createHash('sha256').update(`oca-payment:${String(code).toUpperCase()}`).digest('hex');
export function newCode() { let c = ''; for (let i = 0; i < 6; i++) c += ALPHABET[randomInt(ALPHABET.length)]; return c; }
// "approve K7Q2MX", "Approve k7q2mx.", "DENY K7Q2MX" — the verb and the code, nothing else decides.
export function parseDecision(message) {
  const m = String(message || '').trim().match(/^(approve|deny)\s+([A-Za-z0-9]{6})\b[.!]?$/i);
  return m ? { approved: m[1].toLowerCase() === 'approve', code: m[2].toUpperCase() } : null;
}
// How often he can ask for a new code from the app, so a stuck button can't flood his phone.
export const RESEND_MAX = 5;
export const RESEND_GAP_MS = 30_000;
// When an expired approval may ask again: now in the day, 8 am after a window that closed overnight (10 pm to 8 am).
export function reissueAt(now = Date.now()) {
  const d = new Date(now), h = d.getHours();
  if (h >= 8 && h < 22) return now;
  const morning = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (h >= 22 ? 1 : 0), 8, 0, 0, 0);
  return morning.getTime();
}
export function approvalLine(code) { return `Reply APPROVE ${code} to pay, or DENY ${code}. (Expires in 10 minutes.)`; }

export function createPaymentApprovals({ pool, clock = Date.now, log = console, onDecision = null, onRefused = null, onExpired = null, tickMs = 30_000, windowMs = APPROVAL_WINDOW_MS } = {}) {
  let timer = null, ticking = false;

  async function settle(askId, fields) {
    await pool.query(`UPDATE notifications SET metadata = jsonb_set(metadata, '{approval}', COALESCE(metadata->'approval', '{}'::jsonb) || $2::jsonb) WHERE id = $1`,
      [askId, JSON.stringify(fields)]);
  }

  // A new approval for one payment ask: the record the ask stores (no code in it) and the code for the text to him.
  async function request({ title, description }) {
    const code = newCode(), at = clock();
    const record = { id: `pay:${hashCode(code).slice(0, 16)}`, codeHash: hashCode(code), requestedAt: at, expiresAt: at + windowMs, route: 'imessage',
      title: text(title, 120), description: text(description, 500) };
    return { ...record, code };
  }

  // A decision Quinn texted. `from` is what the Messages reader verified: his handle, received on the work Mac.
  async function decide({ approved, code, from, via = 'Messages', at = clock() }) {
    const h = hashCode(code);
    const { rows } = await pool.query(`SELECT id, replied_at, metadata FROM notifications WHERE category = 'ask' AND metadata->'approval'->>'codeHash' = $1 LIMIT 1`, [h]);
    const a = rows[0];
    const refuse = async why => { log.warn?.(`[payments] ${approved ? 'APPROVE' : 'DENY'} ${String(code).slice(0, 2)}…: ${why}`); try { await onRefused?.({ askId: a?.id ?? null, why }); } catch {} return { ok: false, why }; };
    if (!a) return refuse('no payment is waiting on that code');
    const ap = a.metadata.approval;
    if (ap.settled) return refuse(`that payment was already ${ap.settled === APPROVE ? 'approved' : ap.settled === DENY ? 'denied' : ap.settled}`);
    if (a.replied_at) { await settle(a.id, { settled: 'answered-elsewhere' }); return refuse('that payment was already answered another way'); }
    if (at > Number(ap.expiresAt || 0)) { await settle(a.id, { settled: 'expired' }); return refuse('that code has expired; the payment was not made'); }
    const decision = approved ? APPROVE : DENY;
    await settle(a.id, { settled: decision, resolver: { kind: 'imessage', id: text(from, 80), via }, decidedAt: at });
    log.log?.(`[payments] ask #${a.id}: ${approved ? 'approved' : 'denied'} by Quinn in ${via}`);
    try { await onDecision?.({ askId: a.id, approved }); }
    catch (e) { log.warn?.(`[payments] ask #${a.id}: the decision couldn't reach its agent:`, text(e.message, 200)); }
    return { ok: true, askId: a.id, approved };
  }

  // Open approvals past their window, or answered some other way, are settled so their codes are dead.
  async function tick() {
    if (ticking) return; ticking = true;
    try {
      const { rows } = await pool.query(`SELECT id, replied_at, metadata FROM notifications WHERE category = 'ask'
        AND metadata->'approval'->>'codeHash' IS NOT NULL AND metadata->'approval'->>'settled' IS NULL ORDER BY id LIMIT 50`);
      for (const a of rows) {
        if (a.replied_at) await settle(a.id, { settled: 'answered-elsewhere' });
        else if (clock() > Number(a.metadata.approval.expiresAt || 0)) {
          await settle(a.id, { settled: 'expired' });
          await onExpired?.({ askId: a.id }).catch?.(e => log.warn?.(`[payments] ask #${a.id}: couldn't ask again:`, text(e.message, 200)));
        }
      }
      // A re-ask held for the morning.
      if (onExpired) {
        const { rows: held } = await pool.query(`SELECT id FROM notifications WHERE category = 'ask' AND replied_at IS NULL
          AND metadata->'approval'->>'settled' = 'expired' AND (metadata->'approval'->>'reissueAt')::float8 <= $1 ORDER BY id LIMIT 20`, [clock()]);
        for (const a of held) await onExpired({ askId: a.id }).catch(e => log.warn?.(`[payments] ask #${a.id}: couldn't ask again:`, text(e.message, 200)));
      }
    } finally { ticking = false; }
  }

  function start() { if (!timer) { timer = setInterval(() => { tick().catch(e => log.warn?.('[payments] tick:', e.message)); }, tickMs); timer.unref?.(); } }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { request, decide, tick, start, stop };
}
