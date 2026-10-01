// The inbox: what the engine has for a person, and what a person gives back. Reading it is free. Every
// action here is a rating or a receipt — the only signals that teach the engine anything: a rated artifact
// or note moves the worth of the capability that made it, an observed receipt moves a want, and the
// Chinese Room Meter's creativity dimension is made of nothing but these.
import { words, overlap, jaccard } from './dedupe.js';
import { YES } from './actuator.js';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

const text = (v, max = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const clamp01 = n => Math.max(0, Math.min(1, Number(n)));
// A person's rating in words, and the number the ledger and the meter take.
export const RATINGS = { useless: 0, meh: 0.34, useful: 0.67, great: 1 };
export function usefulnessOf(value) {
  if (typeof value === 'string' && value in RATINGS) return RATINGS[value];
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`a rating is useless, meh, useful, great, or a number in [0, 1]`);
  return n;
}
// The ledger takes -1, 0, 1; a usefulness in [0,1] folds to that.
export const ledgerRating = u => u >= RATINGS.useful ? 1 : u < RATINGS.meh ? -1 : 0;

function parseArtifact(md) {
  const m = String(md).match(/^# (.*)\n\n_For:_ (.*)\n\n_Judge by:_ (.*)\n\n([\s\S]*)$/);
  return m ? { title: m[1], forWhat: m[2], judge: m[3], body: m[4].trim() } : { title: '', forWhat: '', judge: '', body: String(md).trim() };
}
function parseNote(md) {
  const m = String(md).match(/^# (.*)\n\n_([^\n]*)_\n\n([\s\S]*)$/);
  return m ? { title: m[1], meta: m[2], body: m[3].trim() } : { title: '', meta: '', body: String(md).trim() };
}

export function createInbox({ pool, queue, worth, workRoot, clock = Date.now, log = console, drafts = null, asks = null, agents = null }) {
  const safeName = s => /^[A-Za-z0-9._-]{1,120}$/.test(String(s)) && !String(s).includes('..');

  async function activeWants() {
    const { rows } = await pool.query(`SELECT id, status, updated_at, ponder_state AS state FROM thought_chains
      WHERE ponder_state IS NOT NULL AND ponder_state #>> '{want,status}' = 'active' ORDER BY updated_at DESC LIMIT 60`);
    return rows;
  }

  // Deliverables the engine drafted for a want, with the person's verdict still owed.
  async function artifacts(rows) {
    const out = [];
    for (const row of rows) {
      const want = row.state.want, receipts = want.receipts || [];
      for (const c of (row.state.commitments || []).filter(c => c.kind === 'artifact' && c.path)) {
        const name = basename(c.path);
        if (receipts.some(r => r.receiptId === `rated-artifact-${name}`)) continue;
        let md = ''; try { md = await readFile(c.path, 'utf8'); } catch { continue; }   // gone: nothing to rate
        const a = parseArtifact(md);
        out.push({ kind: 'artifact', id: `${row.id}/${name}`, chainId: row.id, title: a.title || c.title || name, forWhat: a.forWhat, judge: a.judge,
          body: a.body.slice(0, 12000), want: text(want.description, 200), at: c.at || null, path: c.path });
      }
    }
    return out;
  }

  // The thinker's writing, kept when the gate held it from the person's notes; rated once.
  async function notes() {
    const dir = join(workRoot, 'thinker');
    let names = []; try { names = (await readdir(dir)).filter(n => n.endsWith('.md')); } catch { return []; }
    const { rows } = await pool.query(`SELECT id FROM worth_signals WHERE id LIKE 'rate:note:%'`);
    const rated = new Set(rows.map(r => r.id.slice('rate:note:'.length)));
    const out = [];
    for (const name of names.sort().reverse().slice(0, 40)) {
      if (rated.has(name)) continue;
      const path = join(dir, name);
      const [md, st] = await Promise.all([readFile(path, 'utf8').catch(() => ''), stat(path).catch(() => null)]);
      const n = parseNote(md);
      out.push({ kind: 'note', id: name, title: n.title || name.replace(/\.md$/, ''), body: n.body.slice(0, 12000), at: st ? st.mtimeMs : null, path });
    }
    return out;
  }

  // The agents on a want, live ones first, as the app shows them: kind, status, the question if waiting, the session to open.
  const agentOf = a => ({ id: a.id, kind: a.kind, status: a.status, task: text(a.task, 200), question: a.question || null, askId: a.askId || null, sessionKey: a.sessionKey, displayName: a.displayName, turns: a.turns, summary: text(a.report?.summary, 300), stream: a.stream || null, updatedAt: a.updatedAt });
  async function agentsByWant() {
    if (!agents) return new Map();
    const all = await agents.list({ limit: 200 }).catch(() => []);
    const m = new Map();
    for (const a of all) { if (!m.has(a.chainId)) m.set(a.chainId, []); const l = m.get(a.chainId); if (l.length < 12) l.push(agentOf(a)); }
    return m;
  }
  function wantsOf(rows, byWant = new Map()) {
    return rows.map(row => { const w = row.state.want, r = row.state.result || {};
      return { kind: 'want', chainId: row.id, agents: byWant.get(row.id) || [], description: text(w.description, 400), doneWhen: text(w.doneWhen, 300), progress: w.progress || 0,
        status: row.status, strategy: w.strategy, origin: row.state.origin?.kind || 'explicit', updatedAt: row.updated_at,
        continuous: row.state.continuous === true, continuity: row.state.continuity || null, researchActive: row.state.researchActive === true,
        needs: (row.state.needs || []).map(n => ({ kind: n.kind, host: n.host, at: n.at })),
        conclusion: text(r.conclusion, 400), missing: (r.missingEvidence || []).slice(0, 3).map(m => text(m, 200)), receipts: (w.receipts || []).length }; });
  }

  async function entities() {
    const { rows } = await pool.query(`SELECT key, state FROM worth_entities ORDER BY key`);
    return rows.filter(r => !/^outcome:ponder-/.test(r.key)).map(r => ({ kind: 'entity', entityKey: r.key, worth: r.state?.worth ?? null, confidence: r.state?.confidence ?? null, rated: r.state?.rated ?? 0, observed: r.state?.observed ?? 0 }));
  }

  // Items set aside without a verdict: duplicates, or work on something Quinn has closed. A dismissal is not a
  // rating, so it teaches the ledger nothing; it only takes the item out of Judge.
  let dismissReady = null;
  function ensureDismissed() {
    dismissReady ??= pool.query(`CREATE TABLE IF NOT EXISTS inbox_dismissed (kind TEXT NOT NULL, id TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
      by TEXT NOT NULL DEFAULT 'quinn', at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (kind, id))`).catch(e => { dismissReady = null; throw e; });
    return dismissReady;
  }
  async function dismissed() {
    await ensureDismissed();
    const { rows } = await pool.query(`SELECT kind, id FROM inbox_dismissed`);
    return new Set(rows.map(r => `${r.kind}:${r.id}`));
  }
  async function dismiss({ kind, id, reason = '', by = 'quinn' }) {
    if (!['artifact', 'note'].includes(kind) || typeof id !== 'string' || !id) throw new Error('dismiss an artifact or a note by its id');
    await ensureDismissed();
    await pool.query(`INSERT INTO inbox_dismissed (kind, id, reason, by) VALUES ($1, $2, $3, $4) ON CONFLICT (kind, id) DO NOTHING`, [kind, id, text(reason, 300), text(by, 60)]);
    return { kind, id, dismissed: true };
  }

  // Near-copies collapse into their newest version: the same title, or largely the same body (deliverables only
  // within one want). Judge shows one card; the others ride along as `similar` and leave with its verdict.
  function collapse(items) {
    const cache = new Map(), w = (i, f) => { const k = `${i.kind}:${i.id}:${f}`; if (!cache.has(k)) cache.set(k, words(f === 'title' ? i.title : String(i.body || '').slice(0, 4000))); return cache.get(k); };
    const same = (x, y) => (overlap(w(x, 'title'), w(y, 'title')) >= 0.6 && w(x, 'title').size >= 2)
      || (String(x.body || '').length > 200 && String(y.body || '').length > 200 && jaccard(w(x, 'body'), w(y, 'body')) >= 0.4);
    const groups = [];
    for (const i of items) {
      const g = groups.find(g => g.head.kind === i.kind && (i.kind !== 'artifact' || g.head.chainId === i.chainId) && same(g.head, i));
      if (g) g.rest.push(i); else groups.push({ head: i, rest: [] });
    }
    return groups.map(g => (g.rest.length ? { ...g.head, similar: g.rest.map(r => ({ kind: r.kind, id: r.id, title: r.title })) } : g.head));
  }

  async function list() {
    const rows = await activeWants();
    const [a, n, e, open, byWant, gone] = await Promise.all([artifacts(rows), notes(), entities(), asks ? asks.open().catch(() => []) : [], agentsByWant(), dismissed().catch(() => new Set())]);
    const toRate = collapse([...a, ...n].filter(i => !gone.has(`${i.kind}:${i.id}`)).sort((x, y) => (y.at || 0) - (x.at || 0)));
    return { at: clock(), toRate, wants: wantsOf(rows, byWant), entities: e, asks: open, agentSlots: agents ? await agents.slots().catch(() => null) : null, agentsLive: agents ? await agents.liveCount().catch(() => 0) : 0 };
  }

  // A person's verdict on a deliverable: a receipt on its want. "Useful" or better is progress; anything
  // less is a spent attempt, so the want rotates its strategy and thinks again.
  async function rateArtifact({ id, usefulness, note = '', by = 'quinn' }) {
    const [chainStr, name] = String(id).split('/');
    const chainId = Number(chainStr);
    if (!Number.isInteger(chainId) || chainId < 1 || !safeName(name)) throw new Error('an artifact is named by want id and file name');
    const chain = await queue.get(chainId);
    if (!chain) throw new Error('want not found');
    const c = (chain.commitments || []).find(c => c.kind === 'artifact' && basename(c.path || '') === name);
    if (!c) throw new Error('this want delivered no such artifact');
    const u = usefulnessOf(usefulness), cur = chain.want.progress || 0;
    const progress = u >= RATINGS.useful ? Math.max(cur, Math.min(0.9, cur + 0.25)) : cur;
    return queue.outcome(chainId, { receiptId: `rated-artifact-${name}`, progress, usefulness: u, criterionMet: false,
      evidence: [{ id: `artifact-rated-${name}`.slice(0, 100), source: `a person's rating of the delivered artifact`,
        observation: `${by} rated "${text(c.title || name, 120)}" ${u.toFixed(2)} (${Object.entries(RATINGS).find(([, v]) => v === u)?.[0] || 'numeric'})${note ? `: ${text(note, 500)}` : ''}` }] });
  }

  // A person's verdict on the thinker's writing: a rating on the capability that wrote it.
  async function rateNote({ id, usefulness, note = '', by = 'quinn' }) {
    if (!safeName(id) || !id.endsWith('.md')) throw new Error('a note is named by its file name');
    const path = join(workRoot, 'thinker', id);
    const md = await readFile(path, 'utf8').catch(() => null);
    if (md === null) throw new Error('note not found');
    const u = usefulnessOf(usefulness), n = parseNote(md);
    return worth.record({ id: `rate:note:${id}`, entityKey: 'self:message', kind: 'rated', rating: ledgerRating(u), by, about: `${text(n.title || id, 120)}${note ? ` — ${text(note, 300)}` : ''}` });
  }

  async function rateEntity({ entityKey, rating, about = '', by = 'quinn' }) {
    const r = Number(rating);
    if (![-1, 0, 1].includes(r)) throw new Error('an entity rating is -1, 0 or 1');
    return worth.record({ id: `rate:${randomUUID()}`, entityKey, kind: 'rated', rating: r, by, about: text(about, 500) });
  }

  async function rate(input = {}) {
    // A verdict on a card covers its near-copies too: they leave Judge with it, dismissed, not rated.
    const similar = input.kind === 'artifact' || input.kind === 'note'
      ? ((await list().catch(() => ({ toRate: [] }))).toRate.find(i => i.kind === input.kind && i.id === input.id)?.similar || []) : [];
    const settleSimilar = async () => { for (const s of similar) await dismiss({ kind: s.kind, id: s.id, reason: `a near-copy of ${input.kind} ${input.id}, which was rated`, by: input.by || 'quinn' }).catch(() => {}); };
    if (input.kind === 'artifact') { const want = await rateArtifact(input); await settleSimilar(); return { kind: 'artifact', id: input.id, want }; }
    if (input.kind === 'note') { const worth = await rateNote(input); await settleSimilar(); return { kind: 'note', id: input.id, worth }; }
    if (input.kind === 'entity') return { kind: 'entity', entityKey: input.entityKey, worth: await rateEntity(input) };
    throw new Error('rate an artifact, a note, or an entity');
  }

  // A person's observed receipt on a want — the only thing that satiates it.
  async function progress({ chainId, progress, criterionMet = false, observation, usefulness = null, by = 'quinn' }) {
    const id = Number(chainId);
    if (!Number.isInteger(id) || id < 1) throw new Error('a receipt names its want');
    if (typeof observation !== 'string' || observation.trim().length < 3) throw new Error('say what you observed');
    const p = clamp01(progress);
    const receipt = { receiptId: `person-${by}-${new Date(clock()).toISOString().slice(0, 16)}-${Math.random().toString(36).slice(2, 6)}`,
      progress: criterionMet ? 1 : p, criterionMet: criterionMet === true,
      evidence: [{ id: `person-${Date.now().toString(36)}`, source: `observed by ${by}`, observation: text(observation, 1000) }] };
    if (usefulness !== null && usefulness !== undefined) receipt.usefulness = usefulnessOf(usefulness);
    return queue.outcome(id, receipt);
  }

  // A want from a person: by hand, or by confirming a draft the engine wrote (then the drafter owns the
  // rules — evidence must be what it found, new stakes are the person's rating, the draft id is the request id).
  async function want(body = {}) {
    if (body.draftId) { if (!drafts) throw new Error('drafting is not available'); return drafts.confirm(body); }
    const { description, doneWhen, priority = 0.7, topic = '', by = 'quinn', clientRequestId = null, continuous = true } = body;
    if (typeof description !== 'string' || description.trim().length < 5) throw new Error('say what you want');
    return queue.enqueue({ seed: description.trim(), doneWhen: typeof doneWhen === 'string' && doneWhen.trim() ? doneWhen.trim() : undefined,
      priority: Number.isFinite(Number(priority)) ? Math.max(0.1, Math.min(1, Number(priority))) : 0.7, topic: text(topic, 160), learning: false, clientRequestId, continuous: continuous !== false },
      { origin: { kind: 'explicit', by } });
  }
  // "There should always be an agent working on it." On: the engine keeps a research slice on the want while it
  // waits; off: it waits for the person like any other want.
  async function continuous({ chainId, on }) {
    const id = Number(chainId);
    if (!Number.isInteger(id) || id < 1) throw new Error('name the want');
    return queue.setContinuous(id, on === true);
  }

  // Answering an ask also puts the answer in the session of every agent waiting on it, so each continues. That
  // includes an agent that joined an ask the engine raised for it, such as a held payment, which names no session.
  async function answerAsk({ id, reply = 'done', via = 'the app' }) {
    if (!asks) throw new Error('asks are not available');
    const row = await asks.answer(Number(id), reply);
    if (!agents) return row;
    const { rows } = await pool.query(`SELECT id FROM agent_deployments WHERE ask_id = $1 AND status IN ('waiting_person', 'standing', 'running', 'done') ORDER BY created_at`, [Number(id)]);
    for (const d of rows) await agents.relay(d.id, reply, { via }).catch(e => log.warn?.('[inbox] relay to agent:', e.message));
    if (rows.length || !row.metadata?.payment || !YES.test(reply)) return row;
    return { ...row, followUp: await carryOut(row) };
  }

  // A yes to a held payment whose agent is gone (it ended, failed, or was lost in a restart) still gets acted on: a
  // fresh executor does exactly the action that was held, once, citing the approval. Without this, an answer that
  // came after the agent left changed nothing, and nobody said so.
  async function carryOut(ask) {
    const { rows: [action] } = await pool.query(`SELECT class, host, url, description, cost FROM agent_actions WHERE ask_id = $1 ORDER BY created_at DESC LIMIT 1`, [ask.id]);
    const chainId = Number(ask.metadata?.chainId);
    if (!action || !chainId) return { started: false, why: 'the held action is not on record, so there is nothing to carry out' };
    const task = `Quinn approved ask #${ask.id} after the agent that asked had ended. Do exactly the action he approved, once, `
      + `and nothing else: a ${action.class} on ${action.host || action.url || 'the site it names'}`
      + `${Number(action.cost) > 0 ? ` costing $${Number(action.cost).toFixed(2)}` : ''}, passing approval=${ask.id}. The action: ${action.description}`;
    try {
      const d = await agents.deploy(chainId, { kind: 'executor', task, firedBy: 'person' });
      if (!d?.id) return { started: false, why: d?.why || d?.decision || 'no agent could start' };
      log.log?.(`[inbox] ask #${ask.id} was approved after its agent ended; executor ${String(d.id).slice(0, 8)} carries it out`);
      return { started: true, agent: d.id };
    } catch (e) {
      log.warn?.(`[inbox] ask #${ask.id} was approved, but no agent could carry it out:`, e.message);
      return { started: false, why: e.message };
    }
  }
  return { list, rate, dismiss, progress, want, continuous, answerAsk, artifacts: async () => artifacts(await activeWants()), notes };
}
