// Asking the person. When the engine observes that a pursuit needs something only its person can give — a
// sign-in in Aside, a file, a number — it asks: a short message composed entirely from what it observed,
// never from model prose, sent only to its own person under their standing permission (the askOwner
// control) and appraised like any other action. Every ask is recorded as a notification the app shows,
// so the phone has it even when no other channel does. Deduplicated per want and need; capped per day.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { OWNER_KEY } from '../motivation/risk.js';

const run = promisify(execFile);
const text = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// What the engine says for each kind of need. Only observed fields are interpolated.
export function composeAsk({ kind, host, want, chainId, detail }) {
  const pursuit = `#${chainId}${want ? ` (${text(want, 60)})` : ''}`;
  switch (kind) {
    case 'sign_in': return `Oneiro needs you: to keep working on ${pursuit} it needs you signed in to ${host} in Aside — it hit the sign-in page there. Sign in once in Aside and it will continue on its own.`;
    case 'open_tab': return `Oneiro needs you: for ${pursuit}, open the page it needs in Aside and leave the tab open — ${text(detail, 120)}. It reads open tabs.`;
    case 'evidence': return `Oneiro needs you: ${pursuit} has waited on something only you can give (${text(detail, 120)}). Open Oneiro → Judge → ${pursuit} to see what.`;
    default: return `Oneiro needs you: ${pursuit} needs ${text(detail, 140) || 'something only you can give'}. Open Oneiro → Judge.`;
  }
}

export function createAsks({ pool, risk, clock = Date.now, log = console,
  imessage = process.env.OCA_OWNER_IMESSAGE || null, notify = true, perDay = 5, dedupeMs = 12 * 3600_000, deliverers = null } = {}) {

  async function init() {
    await pool.query(`CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, message TEXT NOT NULL, category TEXT DEFAULT 'thought',
      priority TEXT DEFAULT 'normal', read BOOLEAN DEFAULT false, reply TEXT, replied_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), metadata JSONB NOT NULL DEFAULT '{}'::jsonb)`);
  }

  // Delivery channels, each best-effort and journaled by name. The notification row is not a channel: it is the record.
  const channels = deliverers || {
    // iMessage to the person's own handle, through Messages on this Mac. Needs OCA_OWNER_IMESSAGE.
    imessage: imessage ? async message => {
      const script = `tell application "Messages"\n  set targetService to 1st account whose service type = iMessage\n  set targetBuddy to participant ${JSON.stringify(imessage)} of targetService\n  send ${JSON.stringify(message)} to targetBuddy\nend tell`;
      await run('osascript', ['-e', script], { timeout: 15000 });
    } : null,
    // A macOS notification, for when the person is at the Mac.
    notification: notify ? async message => {
      await run('osascript', ['-e', `display notification ${JSON.stringify(message.slice(0, 200))} with title "Oneiro needs you"`], { timeout: 5000 });
    } : null,
  };

  async function recent({ chainId = null, hours = 24 } = {}) {
    const { rows } = await pool.query(`SELECT id, message, category, read, reply, replied_at, created_at, metadata FROM notifications
      WHERE category = 'ask' AND created_at > to_timestamp($1 / 1000.0) ${chainId !== null ? 'AND (metadata ->> \'chainId\')::int = $2' : ''} ORDER BY created_at DESC`,
      chainId !== null ? [clock() - hours * 3600_000, chainId] : [clock() - hours * 3600_000]);
    return rows;
  }

  // Ask once per (want, need) per dedupe window, at most perDay a day, only when the gate says proceed.
  async function ask({ chainId, kind, host = '', detail = '', want = '', stakes = [] }) {
    const key = `${kind}:${host || text(detail, 60)}`;
    const { rows: dupes } = await pool.query(`SELECT id FROM notifications WHERE category = 'ask' AND metadata ->> 'key' = $1 AND (metadata ->> 'chainId')::int = $2
      AND created_at > to_timestamp($3 / 1000.0) AND replied_at IS NULL LIMIT 1`, [key, chainId, clock() - dedupeMs]);
    if (dupes.length) return { asked: false, why: 'already asked', id: dupes[0].id };
    const { rows: [{ n }] } = await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE category = 'ask' AND created_at > to_timestamp($1 / 1000.0)`, [clock() - 24 * 3600_000]);
    if (n >= perDay) return { asked: false, why: `daily cap of ${perDay} reached` };
    const message = composeAsk({ kind, host, want, chainId, detail });
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
    if (proceed) {
      for (const [name, send] of Object.entries(channels)) {
        if (!send) continue;
        try { await send(message); delivered.push(name); } catch (e) { failed.push(`${name}: ${text(e.message, 120)}`); }
      }
    }
    const { rows: [row] } = await pool.query(`INSERT INTO notifications (message, category, priority, metadata, created_at) VALUES ($1, 'ask', 'high', $2::jsonb, to_timestamp($3 / 1000.0)) RETURNING id, created_at`,
      [message, JSON.stringify({ chainId, kind, host, detail: text(detail, 300), key, decision: decision?.decision || 'proceed', delivered, failed, at: clock() }), clock()]);
    if (risk && decision?.decision === 'proceed') {
      try { await risk.observe(id, { result: delivered.length ? 'success' : 'failure', evidence: [{ id: `ask-${row.id}`, source: 'ask runtime: delivery result', observation: `Ask #${row.id} ${delivered.length ? `delivered via ${delivered.join(', ')}` : 'recorded but no channel delivered'}${failed.length ? `; failed: ${failed.join('; ')}` : ''}.` }] }); }
      catch (e) { log.warn?.('[asks] outcome not journaled:', e.message); }
    }
    log.log?.(`[asks] #${row.id} for want #${chainId} (${kind}${host ? ` ${host}` : ''}): ${decision?.decision || 'proceed'}; delivered ${delivered.join(', ') || 'nowhere'}${failed.length ? `; failed ${failed.join('; ')}` : ''}`);
    return { asked: proceed, id: row.id, decision: decision?.decision || 'proceed', delivered, failed, message };
  }

  // The person answers (or just clears) an ask from the app.
  async function answer(id, reply = 'done') {
    const { rows } = await pool.query(`UPDATE notifications SET reply = $2, replied_at = to_timestamp($3 / 1000.0), read = true WHERE id = $1 AND category = 'ask' RETURNING id, metadata`, [id, text(reply, 500), clock()]);
    if (!rows[0]) throw new Error('ask not found');
    return rows[0];
  }

  async function open() {
    const { rows } = await pool.query(`SELECT id, message, created_at, metadata FROM notifications WHERE category = 'ask' AND replied_at IS NULL ORDER BY created_at DESC LIMIT 20`);
    return rows.map(r => ({ id: r.id, message: r.message, at: r.created_at, chainId: r.metadata?.chainId ?? null, kind: r.metadata?.kind, host: r.metadata?.host, delivered: r.metadata?.delivered || [] }));
  }

  return { init, ask, answer, open, recent, composeAsk, channels: () => Object.entries(channels).filter(([, f]) => f).map(([n]) => n) };
}
