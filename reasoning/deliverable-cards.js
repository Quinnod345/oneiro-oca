// A deliverable that is something to act on: a mail draft or a calendar block an agent left. The person edits the card
// and presses its one action; the press goes through the same code as the night's cards (cardActions in
// overnight-cards.js), so a mail card only ever opens a draft for them to send, a calendar card checks for a duplicate
// and adds the event only on that press, and an automated address is refused. Nothing here runs without a press.
//
// POST /oca/pursuits/:id/deliverables/:name/card   the person's edit
// POST /oca/pursuits/:id/deliverables/:name/act    the press
// GET  /oca/card-accounts                          the accounts a card may act from
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { Router } from 'express';
import { cardActions, isAutomatedSender } from './overnight-cards.js';
import { cardMarkdown, normalizeCard } from './deliverables.js';

const plain = (message, status = 400) => Object.assign(new Error(message), { status });
const validName = s => /^[A-Za-z0-9._-]{1,120}$/.test(String(s)) && !String(s).includes('..');

/** What stops this card's action right now, in plain words, or null. Pure. */
export function cardProblem(card, now = Date.now()) {
  if (card?.kind === 'mail_draft') {
    const robot = (card.to || []).find(isAutomatedSender);
    if (robot) return `${robot} is an automated address, where a reply reaches a robot or posts publicly. Change who it goes to before opening it.`;
    if (!card.threadId && !(card.to || []).length) return 'Say who this goes to before opening it.';
  }
  if (card?.kind === 'calendar_block' && new Date(card.start).getTime() <= now) return 'That time has passed. Pick a time that is still ahead.';
  return null;
}

/** A pursuit's card in the shape the shared press takes. Pure. */
export function pressable(card, account, checkAccounts = []) {
  if (card.kind === 'mail_draft') return { kind: 'mail_draft', title: card.subject, body: card.body, payload: { account, threadId: card.threadId || null, to: card.to, subject: card.subject } };
  const end = new Date(new Date(card.start).getTime() + card.durationMinutes * 60_000).toISOString();
  return { kind: 'calendar_block', title: card.title, body: card.notes || '', payload: { account, start: card.start, end, checkAccounts } };
}

export function createDeliverableCards({ pool, channel, accounts = async () => [], clock = Date.now, log = console } = {}) {
  const actions = cardActions({ channel });
  const pressing = new Set();

  // One read-modify-write of a commitment, under the row's lock so a press and an agent's new brief can't cross.
  async function change(chainId, name, f) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [row] } = await client.query(`SELECT ponder_state -> 'commitments' AS commitments FROM thought_chains WHERE id = $1 FOR UPDATE`, [chainId]);
      const commitments = row?.commitments || [];
      const at = commitments.findIndex(c => c.kind === 'artifact' && basename(c.path || '') === name);
      if (at < 0) throw plain('This pursuit delivered no such thing.', 404);
      commitments[at] = await f(commitments[at]);
      await client.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{commitments}', $2::jsonb) WHERE id = $1`, [chainId, JSON.stringify(commitments)]);
      await client.query('COMMIT');
      return commitments[at];
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }
  const named = (chainId, name) => {
    const id = Number(chainId);
    if (!Number.isInteger(id) || id < 1 || !validName(name)) throw plain('A deliverable is named by its pursuit and file name.');
    return id;
  };
  const view = c => ({ deliverableKind: c.deliverableKind || 'brief', card: c.card || null, cardState: c.cardState || null, cardProblem: c.card ? cardProblem(c.card, clock()) : null });

  // The person's edit. What the press then acts on, and what the file says too.
  async function edit(chainId, name, fields = {}) {
    const id = named(chainId, name);
    const c = await change(id, name, async c => {
      if (!c.card) throw plain('This one is a brief: there is no card to edit.');
      if (c.cardState?.status === 'done') throw plain('That was already done, so the card is closed.', 409);
      const allowed = c.card.kind === 'mail_draft' ? ['to', 'subject', 'body', 'account'] : ['title', 'start', 'durationMinutes', 'notes', 'calendar', 'account'];
      const next = normalizeCard({ ...c.card, ...Object.fromEntries(allowed.filter(k => fields[k] !== undefined).map(k => [k, fields[k]])) });
      if (!next) throw plain(c.card.kind === 'mail_draft' ? 'A mail draft needs a subject and some words.' : 'A calendar block needs a title and a time.');
      const md = await readFile(c.path, 'utf8').catch(() => null);
      if (md !== null && md.includes(cardMarkdown(c.card))) await writeFile(c.path, md.replace(cardMarkdown(c.card), () => cardMarkdown(next)));
      return { ...c, card: next, edited: true, cardState: null };
    });
    return view(c);
  }

  // The press. One at a time per card: a double press does nothing the second time.
  async function act(chainId, name) {
    const id = named(chainId, name), key = `${id}/${name}`;
    if (pressing.has(key)) throw plain('That is already happening.', 409);
    pressing.add(key);
    try {
      const { rows: [row] } = await pool.query(`SELECT ponder_state -> 'commitments' AS commitments FROM thought_chains WHERE id = $1`, [id]);
      const c = (row?.commitments || []).find(x => x.kind === 'artifact' && basename(x.path || '') === name);
      if (!c) throw plain('This pursuit delivered no such thing.', 404);
      if (!c.card) throw plain('This one is a brief: read it, keep it and rate it.');
      if (c.cardState?.status === 'done') return { ok: true, line: c.cardState.line, ...view(c) };
      const problem = cardProblem(c.card, clock());
      if (problem) throw plain(problem);
      const list = (await accounts()).map(a => a.account);
      if (!list.length) throw plain('No personal Google account is connected and switched on. Connect one in Integrations, then press again.');
      const account = c.card.account || list[0];
      if (!list.includes(account)) throw plain(`${account} isn't a connected personal account. Pick another, or connect it in Integrations.`);
      let done;
      try { done = await actions.carryOut(pressable(c.card, account, list)); }
      catch (e) {
        log.warn?.(`[cards] ${key}: ${String(e.message).slice(0, 200)}`);
        done = { ok: false, why: String(e.message).slice(0, 300) };
      }
      const cardState = done.ok || done.duplicate ? { status: 'done', line: done.ok ? done.line : done.why, at: clock() } : { status: 'ready', error: done.why, at: clock() };
      const saved = await change(id, name, x => ({ ...x, cardState }));
      return { ok: done.ok, line: done.ok ? done.line : null, error: done.ok ? null : done.why, ...view(saved) };
    } finally { pressing.delete(key); }
  }

  const router = Router();
  const route = h => async (req, res) => { try { res.json(await h(req)); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };
  router.post('/oca/pursuits/:id/deliverables/:name/card', route(req => edit(req.params.id, req.params.name, req.body || {})));
  router.post('/oca/pursuits/:id/deliverables/:name/act', route(req => act(req.params.id, req.params.name)));
  router.get('/oca/card-accounts', route(async () => ({ accounts: (await accounts()).map(a => ({ account: a.account, label: a.label || null })) })));
  return { edit, act, view, router };
}
