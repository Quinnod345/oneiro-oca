// Asking the person. When the engine observes that a pursuit needs something only its person can give — a
// sign-in in Aside, a file, a number — it asks: a short message composed entirely from what it observed,
// never from model prose, sent only to its own person under their standing permission (the askOwner
// control) and appraised like any other action. Every ask is recorded as a notification (the Mac app and the
// engine MCP show it), and goes out as a text and a Mac notification. Deduplicated per want and need;
// capped per day.
import { sameThing } from './dedupe.js';
import { OWNER_KEY } from '../motivation/risk.js';
import { approvalLine, reissueAt, RESEND_GAP_MS, RESEND_MAX } from './payment-approvals.js';
import { macNotify } from '../channels/mac-notify.js';
import { parseAppleAsk, appleChangeWords } from '../apple/change-words.js';

const text = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// An ask never has the person hand over a secret: a one-time code, a password, a recovery code, a key or a
// token. Those go only into the page that asks for them, typed by the person in Aside, never into a reply that
// lands in a transcript. An agent's request for one is rewritten into the step the person can safely take.
const SECRET = /\b(?:2fa|two[- ]factor|mfa|otp|totp|one[- ]time (?:pass(?:word|code)?|code)|(?:authenticat(?:or|ion)|verification|security|sign[- ]?in|log[- ]?in|confirmation|access|backup|recovery|sms)\s+codes?|(?:six|6|eight|8)[- ]digit|passcodes?|passwords?|passphrases?|recovery keys?|api keys?|secret keys?|private keys?|access tokens?|auth(?:entication)? tokens?|bearer tokens?|client secrets?|\.p8\b)/i;
const HAND_OVER = /\b(?:send|give|share|provide|tell|text|message|forward|paste|reply with|respond with|dm|email|read (?:me|out))\b|\bwhat(?:'s| is| are) (?:your|the)\b/i;
export function asksForSecret(detail) { const d = String(detail || ''); return SECRET.test(d) && HAND_OVER.test(d); }
export function safeSecretAsk(detail) {
  return `A sign-in wants a code or password. Enter it yourself where it is asked, in Aside, never in a reply; then reply "done". (The agent asked: “${text(detail, 200)}”)`;
}

// What the engine says for each kind of need. Only observed fields are interpolated.
export function composeAsk({ kind, host, want, chainId, detail, agent, payment = false }) {
  const pursuit = `#${chainId}${want ? ` (${text(want, 60)})` : ''}`;
  // Only the texted code approves a payment, so its one instruction is the APPROVE and DENY line that follows it.
  if (payment) return `Oneiro's agent on ${pursuit} asks: ${text(detail, 500)}`;
  switch (kind) {
    case 'question': return `Oneiro's agent on ${pursuit} asks: ${text(detail, 500)} — reply here, or open Oneiro${agent ? ` (agent "${text(agent, 60)}")` : ''}.`;
    case 'notice': return `Oneiro: ${text(detail, 400)}`;
    // A change to the Apple account. Only Quinn, in Terminal, can approve one; nothing in a reply can.
    case 'apple_approval': return `Oneiro needs you: ${text(detail, 500)}`;
    case 'finish': return `Oneiro: ${pursuit}. ${text(detail, 400)} Reply yes to finish it, or not yet to leave it open. Only you can call it done.`;
    case 'sign_in': if (text(detail)) return `Oneiro needs you: for ${pursuit}, finish access to ${host} in Aside — ${text(detail, 300)}. Then reply here and I’ll check the protected page.`;
      return `Oneiro needs you: to keep working on ${pursuit} it needs you signed in to ${host} in Aside — it hit the sign-in page there. Sign in once in Aside and it will continue on its own.`;
    case 'open_tab': return `Oneiro needs you: for ${pursuit}, open the page it needs in Aside and leave the tab open — ${text(detail, 120)}. It reads open tabs.`;
    case 'evidence': return `Oneiro needs you: ${pursuit} has waited on something only you can give (${text(detail, 120)}). Open Oneiro → Judge → ${pursuit} to see what.`;
    default: return `Oneiro needs you: ${pursuit} needs ${text(detail, 140) || 'something only you can give'}. Open Oneiro → Judge.`;
  }
}

export function createAsks({ pool, risk, clock = Date.now, log = console,
  imessage = null,
  notify = true, perDay = Number(process.env.OCA_ASKS_PER_DAY) || 40, dedupeMs = 12 * 3600_000, deliverers = null, approvals = null,
  imessageReady = () => true } = {}) {
  // Payments carry a one-time approval code (payment-approvals.js) that Quinn texts back from his phone.
  let paymentApprovals = approvals;
  const useApprovals = a => { paymentApprovals = a; };

  async function init() {
    await pool.query(`CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, message TEXT NOT NULL, category TEXT DEFAULT 'thought',
      priority TEXT DEFAULT 'normal', read BOOLEAN DEFAULT false, reply TEXT, replied_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), metadata JSONB NOT NULL DEFAULT '{}'::jsonb)`);
    // An open ask written before the secret rule gets the same rewrite, so none is left asking for a code.
    const { rows } = await pool.query(`SELECT id, metadata FROM notifications WHERE category = 'ask' AND replied_at IS NULL AND NOT (metadata ? 'rewritten')`);
    for (const r of rows) {
      const m = r.metadata || {};
      if (!asksForSecret(m.detail)) continue;
      const detail = safeSecretAsk(m.detail);
      await pool.query(`UPDATE notifications SET message = $2, metadata = metadata || $3::jsonb WHERE id = $1`, [r.id,
        composeAsk({ kind: m.kind || 'question', host: m.host || '', chainId: m.chainId, detail, agent: m.agent }),
        JSON.stringify({ detail: text(detail, 300), rewritten: 'secret request', original: text(m.detail, 300) })]);
      log.log?.(`[asks] #${r.id} asked for a secret; it now asks for the step instead`);
    }
  }

  // Delivery channels, each best-effort and journaled by name. The notification row is not a channel: it is the record.
  const channels = deliverers || {
    // iMessage to the person's own handle, from Messages on the work Mac (channels/imessage.js), in the one
    // conversation with Oneiro his phone keeps. When that line is down the text fails and the Mac notification and
    // the app carry the ask. Never through Messages on this Mac, which is signed into his own iCloud account: the
    // text lands in his own thread, where nothing answers it.
    imessage: imessage ? async message => {
      if (!imessageReady()) throw new Error('the work Mac is offline, so texts are paused');
      await imessage.send(message);
    } : null,
    // A macOS notification, for when the person is at the Mac.
    notification: notify ? async message => {
      // While the Oneiro app is listening it posts this itself, opening the ask when tapped (channels/mac-notify.js).
      await macNotify({ title: 'Oneiro needs you', body: message });
    } : null,
  };

  async function recent({ chainId = null, hours = 24 } = {}) {
    const { rows } = await pool.query(`SELECT id, message, category, read, reply, replied_at, created_at, metadata FROM notifications
      WHERE category = 'ask' AND created_at > to_timestamp($1 / 1000.0) ${chainId !== null ? 'AND (metadata ->> \'chainId\')::int = $2' : ''} ORDER BY created_at DESC`,
      chainId !== null ? [clock() - hours * 3600_000, chainId] : [clock() - hours * 3600_000]);
    return rows;
  }

  // Closes every open ask about one subject, so a new ask replaces it rather than piling up beside it. Payments are never
  // closed this way: they are only ever decided. Returns the ids it closed.
  async function closeSubject(subject, { why = 'superseded' } = {}) {
    const { rows } = await pool.query(`UPDATE notifications SET replied_at = to_timestamp($2 / 1000.0), read = true,
      metadata = metadata || jsonb_build_object('closed', jsonb_build_object('why', $3::text, 'at', $2::float8))
      WHERE category = 'ask' AND replied_at IS NULL AND metadata ->> 'subject' = $1 AND NOT (metadata ? 'payment') RETURNING id`, [text(subject, 300), clock(), text(why, 120)]);
    return rows.map(r => r.id);
  }

  // Ask once per (want, need) per dedupe window, at most perDay a day, only when the gate says proceed.
  // payment: { title, description, detail } for a payment. Its text carries a one-time approval code Quinn texts
  // back to decide it, and it's never held back by the daily cap.
  // subject names what the ask is about when its words change from one ask to the next (a new approval code, say). The
  // dedupe keys on it instead of the words, and a new ask about the same (kind, subject) replaces the open one.
  // apple: { why, change, command, approval } when this is a change to the Apple account (apple/growth.js).
  async function ask({ chainId, kind, host = '', detail = '', want = '', stakes = [], sessionKey = null, agent = null, payment = null, subject = null, apple = null }) {
    const original = asksForSecret(detail) ? text(detail, 300) : null;
    if (original) detail = safeSecretAsk(detail);
    const rewrite = original ? { rewritten: 'secret request', original } : {};
    const about = subject ? text(subject, 300) : null;
    const key = about ? `${kind}:subject:${about}` : `${kind}:${host || text(detail, 60)}`;
    if (about) {
      // The same words about the same subject are the same ask; anything newer replaces it, and only the newest stays open.
      const { rows: same } = await pool.query(`SELECT id FROM notifications WHERE category = 'ask' AND replied_at IS NULL AND metadata ->> 'key' = $1 AND metadata ->> 'detail' = $2 LIMIT 1`, [key, text(detail, 300)]);
      if (same.length) return { asked: false, why: 'already asked', id: same[0].id };
      await closeSubject(about);
    }
    const { rows: dupes } = await pool.query(`SELECT id FROM notifications WHERE category = 'ask' AND metadata ->> 'key' = $1 AND (metadata ->> 'chainId')::int IS NOT DISTINCT FROM $2::int
      AND created_at > to_timestamp($3 / 1000.0) AND replied_at IS NULL LIMIT 1`, [key, chainId ?? null, clock() - dedupeMs]);
    if (dupes.length) return { asked: false, why: 'already asked', id: dupes[0].id };
    // The same question in other words is still the same question: join the open one on this want. Payments are
    // exempt, so a yes to one purchase can never stand in for another.
    if (!payment && (kind === 'question' || kind === 'notice')) {
      const { rows: open } = await pool.query(`SELECT id, metadata FROM notifications WHERE category = 'ask' AND replied_at IS NULL
        AND (metadata ->> 'chainId')::int IS NOT DISTINCT FROM $1::int AND NOT (metadata ? 'payment') AND created_at > to_timestamp($2 / 1000.0)`, [chainId ?? null, clock() - 3 * 86400_000]);
      const twin = open.find(r => r.metadata?.kind === kind && sameThing(r.metadata?.detail, detail));
      if (twin) return { asked: false, why: 'already asked', id: twin.id };
    }
    const { rows: [{ n }] } = await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE category = 'ask' AND created_at > to_timestamp($1 / 1000.0)`, [clock() - 24 * 3600_000]);
    const message = composeAsk({ kind, host, want, chainId, detail, agent, payment: !!payment });
    // Past the daily cap the phone stays quiet, but the ask is still recorded: the app shows it, and an agent
    // waiting on it is still answered from there. A question is never dropped.
    if (n >= perDay && !payment) {
      const { rows: [row] } = await pool.query(`INSERT INTO notifications (message, category, priority, metadata, created_at) VALUES ($1, 'ask', 'normal', $2::jsonb, to_timestamp($3 / 1000.0)) RETURNING id`,
        [message, JSON.stringify({ chainId, kind, host, detail: text(detail, 300), key, decision: 'held', held: `daily cap of ${perDay}`, delivered: [], failed: [], at: clock(), ...rewrite, ...(about ? { subject: about } : {}), ...(apple ? { apple } : {}), ...(sessionKey ? { sessionKey, agent } : {}) }), clock()]);
      return { asked: false, id: row.id, why: `daily cap of ${perDay} reached; recorded for the app`, message };
    }
    const id = `ask:${chainId}:${key}:${new Date(clock()).toISOString().slice(0, 13)}`.slice(0, 200);
    let decision = null;
    if (risk) {
      try {
        decision = await risk.decide({ id, chainId, kind: 'ask', description: message.slice(0, 2000), serves: stakes, touches: [], reversibility: 'none',
          recipient: OWNER_KEY, verified: true, firedBy: 'engine' });
      } catch (e) { log.warn?.('[asks] appraisal failed:', e.message); return { asked: false, why: e.message }; }
    }
    const proceed = !decision || decision.decision === 'proceed';
    const delivered = [], failed = [];
    // A payment's text carries its approval code; the stored message and the record never do.
    const issued = proceed && payment && paymentApprovals ? await paymentApprovals.request(payment).catch(e => { log.warn?.('[asks] approval:', e.message); return null; }) : null;
    const approval = issued ? (({ code, ...record }) => record)(issued) : null;
    if (proceed) {
      for (const [name, send] of Object.entries(channels)) {
        if (!send) continue;
        const body = issued && name === 'imessage' ? `${message}\n${approvalLine(issued.code)}` : message;
        try { await send(body); delivered.push(name); } catch (e) { failed.push(`${name}: ${text(e.message, 120)}`); }
      }
      if (issued && !delivered.includes('imessage')) failed.push('approval: the code could not be texted, so this payment cannot be approved until the line is back');
    }
    const { rows: [row] } = await pool.query(`INSERT INTO notifications (message, category, priority, metadata, created_at) VALUES ($1, 'ask', 'high', $2::jsonb, to_timestamp($3 / 1000.0)) RETURNING id, created_at`,
      [message, JSON.stringify({ chainId, kind, host, detail: text(detail, 300), key, decision: decision?.decision || 'proceed', delivered, failed, at: clock(), ...rewrite, ...(about ? { subject: about } : {}), ...(apple ? { apple } : {}),
        ...(payment ? { payment: true } : {}), ...(approval ? { approval } : {}), ...(sessionKey ? { sessionKey, agent } : {}) }), clock()]);
    if (risk && decision?.decision === 'proceed') {
      try { await risk.observe(id, { result: delivered.length ? 'success' : 'failure', evidence: [{ id: `ask-${row.id}`, source: 'ask runtime: delivery result', observation: `Ask #${row.id} ${delivered.length ? `delivered via ${delivered.join(', ')}` : 'recorded but no channel delivered'}${failed.length ? `; failed: ${failed.join('; ')}` : ''}.` }] }); }
      catch (e) { log.warn?.('[asks] outcome not journaled:', e.message); }
    }
    log.log?.(`[asks] #${row.id} for want #${chainId} (${kind}${host ? ` ${host}` : ''}): ${decision?.decision || 'proceed'}; delivered ${delivered.join(', ') || 'nowhere'}${failed.length ? `; failed ${failed.join('; ')}` : ''}`);
    return { asked: proceed, id: row.id, decision: decision?.decision || 'proceed', delivered, failed, message };
  }

  // A fresh code for a payment ask, texted to Quinn: when the text failed to go out, when he asks for it, or once on its
  // own when a window closes while the want is still active. It only ever sends. The new code replaces the old, which
  // dies, and approving still takes him texting it back. The code is in the text and nowhere else, and this never returns it.
  async function issueCode(row, { auto = false } = {}) {
    const m = row.metadata || {}, ap = m.approval || {};
    if (!paymentApprovals) throw new Error('Payment approvals aren\'t running, so no code can be sent.');
    const send = channels.imessage;
    const issued = await paymentApprovals.request({ title: ap.title || 'Payment', description: ap.description || '' });
    const lead = auto ? 'Oneiro: the last code for this payment expired, and it still needs your answer.\n' : '';
    let error = null;
    if (!send) error = 'there is no text line set up here';
    else { try { await send(`${lead}${row.message}\n${approvalLine(issued.code)}`); } catch (e) { error = text(e.message, 160); } }
    const others = (m.failed || []).filter(f => !/^(imessage|approval):/.test(f));
    if (error) {
      // Nobody got this code, so it never goes on record; the last one stands, and trying again needs no wait.
      const failed = [...others, `imessage: ${error}`, 'approval: the code could not be texted, so this payment cannot be approved until the line is back'];
      await pool.query(`UPDATE notifications SET metadata = metadata || $2::jsonb WHERE id = $1`, [row.id, JSON.stringify({ failed, delivered: (m.delivered || []).filter(d => d !== 'imessage') })]);
      return { sent: false, id: row.id, why: `The code couldn't be texted: ${error}. This payment can't be approved until the text goes out.` };
    }
    const { code, ...record } = issued;
    const approval = { ...record, resends: (Number(ap.resends) || 0) + (auto ? 0 : 1), reissues: (Number(ap.reissues) || 0) + (auto ? 1 : 0) };
    await pool.query(`UPDATE notifications SET metadata = metadata || $2::jsonb WHERE id = $1`, [row.id, JSON.stringify({ approval, failed: others, delivered: [...new Set([...(m.delivered || []), 'imessage'])], lastResendAt: clock() })]);
    log.log?.(`[asks] #${row.id}: a new approval code went out${auto ? ' after the last one expired' : ''}`);
    return { sent: true, id: row.id, expiresAt: approval.expiresAt };
  }
  async function resendCode(id) {
    const { rows: [row] } = await pool.query(`SELECT id, message, replied_at, metadata FROM notifications WHERE id = $1 AND category = 'ask'`, [Number(id)]);
    if (!row) throw new Error('That question is gone.');
    if (row.metadata?.payment !== true) throw new Error('Only a payment has a code to send.');
    if (row.replied_at) throw new Error('This payment was already answered, so there is no code to send.');
    const settled = row.metadata?.approval?.settled;
    if (settled && settled !== 'expired') throw new Error('This payment was already decided, so there is no code to send.');
    if (Number(row.metadata?.approval?.resends) >= RESEND_MAX) throw new Error(`That's ${RESEND_MAX} new codes for this payment already. Deny it if you don't want it.`);
    if (clock() - (Number(row.metadata?.lastResendAt) || 0) < RESEND_GAP_MS) throw new Error('A code just went out. Give it a moment before asking for another.');
    return issueCode(row);
  }
  // A window closed. Oneiro asks once more while the want is still active, in the morning if the window closed overnight.
  // It never approves anything: this is only another chance for him to answer.
  async function reissueExpired(id) {
    const { rows: [row] } = await pool.query(`SELECT n.id, n.message, n.replied_at, n.metadata, t.ponder_state AS state FROM notifications n
      LEFT JOIN thought_chains t ON t.id = NULLIF(n.metadata ->> 'chainId', '')::int WHERE n.id = $1 AND n.category = 'ask'`, [Number(id)]);
    const ap = row?.metadata?.approval;
    if (!row || row.replied_at || row.metadata?.payment !== true || ap?.settled !== 'expired') return { reissued: false, why: 'it is not an open, expired payment' };
    if (Number(ap.reissues) >= 1) return { reissued: false, why: 'it was already asked again once' };
    const s = row.state;
    if (s?.want?.status !== 'active' || s.paused || s.archived || s.deleted) return { reissued: false, why: 'its pursuit is no longer active' };
    const at = reissueAt(clock());
    if (at > clock()) {
      if (ap.reissueAt !== at) await pool.query(`UPDATE notifications SET metadata = jsonb_set(metadata, '{approval,reissueAt}', to_jsonb($2::float8)) WHERE id = $1`, [row.id, at]);
      return { reissued: false, waiting: at };
    }
    const r = await issueCode(row, { auto: true });
    return { reissued: r.sent === true, why: r.why };
  }

  // The person answers (or just clears) an ask from the app.
  async function answer(id, reply = 'done') {
    const { rows } = await pool.query(`UPDATE notifications SET reply = $2, replied_at = to_timestamp($3 / 1000.0), read = true WHERE id = $1 AND category = 'ask' RETURNING id, metadata`, [id, text(reply, 500), clock()]);
    if (!rows[0]) throw new Error('ask not found');
    return rows[0];
  }

  // An Apple change on an open ask: its own record, or for an ask written before there was one, what its words say, with
  // the proposal that holds that approval code supplying the plain description when it's still the current one.
  async function appleChanges(rows) {
    const found = new Map();
    for (const r of rows) {
      const own = r.metadata?.apple;
      const parsed = own ? null : parseAppleAsk(r.message);
      if (own || parsed) found.set(r.id, own || { why: parsed.why, change: parsed.why, command: parsed.command, approval: parsed.approval });
    }
    const codes = [...found.values()].filter(a => !a.request && a.change === a.why && a.approval).map(a => a.approval);
    if (!codes.length) return found;
    const { rows: current } = await pool.query(`SELECT kind, why, request, evidence, approval_id FROM apple_proposals WHERE approval_id = ANY($1)`, [codes]).catch(() => ({ rows: [] }));
    for (const a of found.values()) {
      const p = current.find(c => c.approval_id === a.approval);
      if (p && a.change === a.why) a.change = appleChangeWords(p);
    }
    return found;
  }

  async function open() {
    const { rows } = await pool.query(`SELECT id, message, created_at, metadata FROM notifications WHERE category = 'ask' AND replied_at IS NULL ORDER BY created_at DESC LIMIT 20`);
    const apple = await appleChanges(rows);
    // A payment says so, with its phone approval (id, when its window closes, how it settled), so the app can offer
    // Approve and Deny on it, and find it from the approval notification he tapped.
    return rows.map(r => ({ id: r.id, message: r.message, at: r.created_at, chainId: r.metadata?.chainId ?? null, kind: r.metadata?.kind, host: r.metadata?.host, detail: r.metadata?.detail || '', delivered: r.metadata?.delivered || [], failed: r.metadata?.failed || [], sessionKey: r.metadata?.sessionKey || null, agent: r.metadata?.agent || null,
      payment: r.metadata?.payment === true, apple: apple.get(r.id) || null,
      // Whether the code reached his phone, in so many words: the app can't promise a text that never went out.
      codeSent: r.metadata?.payment === true ? (r.metadata?.delivered || []).includes('imessage') && !!r.metadata?.approval : null,
      approval: r.metadata?.approval ? { id: r.metadata.approval.id, expiresAt: r.metadata.approval.expiresAt ?? null, settled: r.metadata.approval.settled ?? null, reissues: Number(r.metadata.approval.reissues) || 0, reissueAt: r.metadata.approval.reissueAt ?? null } : null }));
  }

  return { init, ask, answer, open, recent, closeSubject, composeAsk, useApprovals, resendCode, reissueExpired, channels: () => Object.entries(channels).filter(([, f]) => f).map(([n]) => n) };
}
