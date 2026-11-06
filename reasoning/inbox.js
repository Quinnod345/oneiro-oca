// The inbox: what the engine has for a person, and what a person gives back. Reading it is free. Every
// action here is a rating or a receipt — the only signals that teach the engine anything: a rated artifact
// or note moves the worth of the capability that made it, an observed receipt moves a want, and the
// Chinese Room Meter's creativity dimension is made of nothing but these.
import { words, overlap, jaccard } from './dedupe.js';
import { YES } from './actuator.js';
import { STRATEGY_NAMES } from '../motivation/hunger.js';
import { cardMarkdown, currentReceipt, liveVerdict, previewOf, ratedId, splitFooter, verdictsOf } from './deliverables.js';
import { agentNameFromTask } from './agent-names.js';
import { cardProblem } from './deliverable-cards.js';
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
  const { body, footer } = splitFooter(m ? m[4] : md);
  return m ? { title: m[1], forWhat: m[2], judge: m[3], body, footer } : { title: '', forWhat: '', judge: '', body, footer };
}
function parseNote(md) {
  const m = String(md).match(/^# (.*)\n\n_([^\n]*)_\n\n([\s\S]*)$/);
  return m ? { title: m[1], meta: m[2], body: m[3].trim() } : { title: '', meta: '', body: String(md).trim() };
}

const verdictWord = u => Object.entries(RATINGS).find(([, v]) => v === u)?.[0] || null;
// The card is shown as a card, so the words around it don't repeat it. The file and the export keep the whole thing.
const withoutCard = (body, c) => (c.card ? String(body).replace(cardMarkdown(c.card), '').trim() : body);
const cardFields = (c, now) => ({ deliverableKind: c.deliverableKind || 'brief', card: c.card || null, cardState: c.cardState || null, cardProblem: c.card ? cardProblem(c.card, now) : null });

export function createInbox({ pool, queue, worth, workRoot, clock = Date.now, log = console, drafts = null, asks = null, agents = null, passWaitMs = 60_000, passPollMs = 1_000 }) {
  const safeName = s => /^[A-Za-z0-9._-]{1,120}$/.test(String(s)) && !String(s).includes('..');
  // The finish watch (reasoning/finish-watch.js) hears about verdicts and owns "looks done" questions.
  let finish = null;
  const useFinish = f => { finish = f; };

  // Who made each deliverable: its summary is the row's preview and its name is how the panel credits it. A note, or a
  // file left from before there were runs, has none and is previewed from its own words.
  async function runsOf(chainIds) {
    const { rows } = await pool.query(`SELECT id, kind, task, report FROM agent_deployments WHERE chain_id = ANY($1)`, [chainIds]).catch(() => ({ rows: [] }));
    return new Map(rows.map(r => [String(r.id), r]));
  }
  const creditOf = (c, footer, runs) => {
    const r = runs.get(String(c.agentId));
    const agent = r ? (agents?.nameOf?.(r) ?? agentNameFromTask(r.task, { kind: r.kind })) : footer ? `${footer.kind.charAt(0).toUpperCase()}${footer.kind.slice(1)} agent` : null;
    const at = Number(c.at) ? new Date(Number(c.at)).toISOString() : footer?.at || null;
    return agent ? { agent, at } : null;
  };
  const previewFor = (body, c, runs) => previewOf(runs.get(String(c.agentId))?.report?.summary) || previewOf(withoutCard(body, c));

  async function activeWants() {
    const { rows } = await pool.query(`SELECT id, status, updated_at, ponder_state AS state FROM thought_chains
      WHERE ponder_state IS NOT NULL AND ponder_state #>> '{want,status}' = 'active' AND ponder_state -> 'archived' IS NULL AND ponder_state -> 'deleted' IS NULL ORDER BY updated_at DESC LIMIT 60`);
    return rows;
  }

  // Deliverables the engine drafted for a want, with the person's verdict still owed.
  async function artifacts(rows) {
    const out = [], runs = await runsOf(rows.map(r => r.id));
    for (const row of rows) {
      const want = row.state.want;
      for (const c of (row.state.commitments || []).filter(c => c.kind === 'artifact' && c.path)) {
        const name = basename(c.path);
        if (liveVerdict(want, name)) continue;
        let md = ''; try { md = await readFile(c.path, 'utf8'); } catch { continue; }   // gone: nothing to rate
        const a = parseArtifact(md);
        out.push({ kind: 'artifact', id: `${row.id}/${name}`, chainId: row.id, title: a.title || c.title || name, forWhat: a.forWhat, judge: a.judge,
          excerpt: previewFor(a.body, c, runs), from: creditOf(c, a.footer, runs), body: withoutCard(a.body, c).slice(0, 12000), bodyCut: withoutCard(a.body, c).length > 12000, want: text(want.description, 200), at: c.at || null, path: c.path, ...cardFields(c, clock()) });
      }
    }
    return out;
  }

  // Each note's verdict as it stands now, from the journal: a changed one replaces the last, a taken-back one has none.
  async function noteVerdicts() {
    const { rows } = await pool.query(`SELECT id, payload FROM worth_signals WHERE id LIKE 'rate:note:%' ORDER BY created_at, id`);
    const replaced = new Set(rows.map(r => r.payload?.supersedes).filter(Boolean));
    const out = new Map();
    for (const r of rows) {
      const name = r.id.slice('rate:note:'.length).split('~')[0];
      const entry = out.get(name) || { count: 0 };
      entry.count++;
      if (!replaced.has(r.id)) Object.assign(entry, { signal: r.payload, id: r.id, live: r.payload?.retraction !== true });
      out.set(name, entry);
    }
    return out;
  }
  // The thinker's writing, kept when the gate held it from the person's notes. A verdict on it can be changed.
  async function notes() {
    const dir = join(workRoot, 'thinker');
    let names = []; try { names = (await readdir(dir)).filter(n => n.endsWith('.md')); } catch { return []; }
    const rated = await noteVerdicts();
    const out = [];
    for (const name of names.sort().reverse().slice(0, 40)) {
      if (rated.get(name)?.live) continue;
      const path = join(dir, name);
      const [md, st] = await Promise.all([readFile(path, 'utf8').catch(() => ''), stat(path).catch(() => null)]);
      const n = parseNote(md);
      out.push({ kind: 'note', id: name, title: n.title || name.replace(/\.md$/, ''), body: n.body.slice(0, 12000), at: st ? st.mtimeMs : null, path });
    }
    return out;
  }

  // The agents on a want, live ones first, as the app shows them: kind, status, the question if waiting, the session to open.
  const agentOf = a => ({ id: a.id, kind: a.kind, name: a.name, status: a.status, task: text(a.task, 200), question: a.question || null, askId: a.askId || null, sessionKey: a.sessionKey, displayName: a.displayName, turns: a.turns, summary: text(a.report?.summary, 300), stream: a.stream || null, updatedAt: a.updatedAt });
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
        status: row.status, strategy: w.strategy, finishWatch: row.state.finishWatch ? { status: row.state.finishWatch.status || null, evidence: text(row.state.finishWatch.evidence, 400) || null } : null, origin: row.state.origin?.kind || 'explicit', updatedAt: row.updated_at,
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
      // A card to act on is never folded into something else: each one is its own decision.
      const g = i.card ? null : groups.find(g => g.head.kind === i.kind && !g.head.card && (i.kind !== 'artifact' || g.head.chainId === i.chainId) && same(g.head, i));
      if (g) g.rest.push(i); else groups.push({ head: i, rest: [] });
    }
    return groups.map(g => (g.rest.length ? { ...g.head, similar: g.rest.map(r => ({ kind: r.kind, id: r.id, title: r.title })) } : g.head));
  }

  async function list() {
    const rows = await activeWants();
    const [a, n, e, open, byWant, gone, recent] = await Promise.all([artifacts(rows), notes(), entities(), asks ? asks.open().catch(() => []) : [], agentsByWant(), dismissed().catch(() => new Set()), judged(rows).catch(() => [])]);
    const toRate = collapse([...a, ...n].filter(i => !gone.has(`${i.kind}:${i.id}`)).sort((x, y) => (y.at || 0) - (x.at || 0)));
    // Each question names the agents parked on it, so the app can answer them in their own threads.
    const parked = new Map();
    if (open.length) {
      const { rows: waiting } = await pool.query(`SELECT id, ask_id FROM agent_deployments WHERE ask_id = ANY($1) AND status = 'waiting_person'`, [open.map(a => a.id)]).catch(() => ({ rows: [] }));
      for (const w of waiting) { if (!parked.has(w.ask_id)) parked.set(w.ask_id, []); parked.get(w.ask_id).push(w.id); }
    }
    return { at: clock(), toRate, judged: recent, wants: wantsOf(rows, byWant), entities: e, asks: open.map(a => ({ ...a, agentIds: parked.get(a.id) || [] })), agentSlots: agents ? await agents.slots().catch(() => null) : null, agentsLive: agents ? await agents.liveCount().catch(() => 0) : 0 };
  }

  // What was judged lately and can still be changed from Judge: newest first, deliverables and notes alike.
  async function judged(rows, limit = 12) {
    const out = [];
    for (const row of rows) {
      const want = row.state.want;
      for (const c of (row.state.commitments || []).filter(c => c.kind === 'artifact' && c.path)) {
        const name = basename(c.path), v = liveVerdict(want, name);
        if (v) out.push({ kind: 'artifact', id: `${row.id}/${name}`, chainId: row.id, title: text(c.title || name, 160), verdict: verdictWord(v.usefulness), at: v.at || null, changed: verdictsOf(want, name).length > 1, path: c.path });
      }
    }
    for (const [name, entry] of await noteVerdicts()) {
      if (!entry.live) continue;
      const about = text(entry.signal?.about, 160).split(' — ')[0];
      const u = entry.signal?.usefulness;
      out.push({ kind: 'note', id: name, title: about || name.replace(/\.md$/, ''), verdict: verdictWord(u) || (entry.signal?.rating > 0 ? 'useful' : entry.signal?.rating < 0 ? 'useless' : 'meh'), at: entry.signal?.at || null, changed: entry.count > 1 });
    }
    return out.sort((x, y) => (Number(y.at) || 0) - (Number(x.at) || 0)).slice(0, limit);
  }

  // A person's verdict on a deliverable: a receipt on its want. "Useful" or better is progress; anything
  // less is a spent attempt, so the want rotates its strategy and thinks again. A verdict can be changed: the new one
  // replaces the old receipt (which stays on record, marked replaced), and the old one's effect is undone first.
  async function rateArtifact({ id, usefulness, note = '', by = 'quinn' }) {
    const [chainStr, name] = String(id).split('/');
    const chainId = Number(chainStr);
    if (!Number.isInteger(chainId) || chainId < 1 || !safeName(name)) throw new Error('an artifact is named by want id and file name');
    const chain = await queue.get(chainId);
    if (!chain) throw new Error('want not found');
    const c = (chain.commitments || []).find(c => c.kind === 'artifact' && basename(c.path || '') === name);
    if (!c) throw new Error('this want delivered no such artifact');
    const u = usefulnessOf(usefulness), cur = chain.want.progress || 0;
    const prior = currentReceipt(chain.want, name);
    if (prior && prior.usefulness === u) return chain;   // the same verdict again changes nothing
    // Progress is measured from where it stood before the verdict being replaced.
    const base = prior ? Math.max(0, cur - Math.max(0, prior.progress - (prior.effect?.progressBefore ?? prior.progress))) : cur;
    const progress = u >= RATINGS.useful ? Math.max(base, Math.min(0.9, base + 0.25)) : base;
    const receiptId = prior ? `${ratedId(name)}~${verdictsOf(chain.want, name).length + 1}` : ratedId(name);
    const word = Object.entries(RATINGS).find(([, v]) => v === u)?.[0] || 'numeric';
    return whenFree(() => queue.outcome(chainId, { receiptId, progress, usefulness: u, criterionMet: false, ...(prior ? { supersedes: prior.receiptId } : {}),
      evidence: [{ id: `artifact-rated-${name}${prior ? `-${verdictsOf(chain.want, name).length + 1}` : ''}`.slice(0, 100), source: `a person's rating of the delivered artifact`,
        observation: `${by} ${prior ? 'changed their verdict on' : 'rated'} "${text(c.title || name, 120)}" ${u.toFixed(2)} (${word})${note ? `: ${text(note, 500)}` : ''}` }] }));
  }
  // A verdict usually sets off a short pass, so the next verdict on the same pursuit often arrives while it runs. Rating
  // two briefs in a row is the normal path, so it waits a little for the chain instead of failing the press.
  async function whenFree(act) {
    const deadline = Date.now() + passWaitMs;
    for (;;) {
      try { return await act(); }
      catch (e) {
        if (e.code !== 'chain_busy' || Date.now() >= deadline) throw e;
        await new Promise(ok => setTimeout(ok, passPollMs));
      }
    }
  }
  // Take a verdict back with nothing in its place: the deliverable returns to Judge, and the want to where it stood before
  // that verdict. The old receipt stays on record, marked replaced.
  async function reopenArtifact({ id, by = 'quinn' }) {
    const [chainStr, name] = String(id).split('/');
    const chainId = Number(chainStr);
    if (!Number.isInteger(chainId) || chainId < 1 || !safeName(name)) throw new Error('an artifact is named by want id and file name');
    const chain = await queue.get(chainId);
    if (!chain) throw new Error('want not found');
    const prior = liveVerdict(chain.want, name);
    if (!prior) throw new Error('There is no verdict on this to take back.');
    const n = verdictsOf(chain.want, name).length + 1;
    const c = (chain.commitments || []).find(c => c.kind === 'artifact' && basename(c.path || '') === name);
    return whenFree(() => queue.outcome(chainId, { receiptId: `${ratedId(name)}~${n}`, progress: Number(prior.effect?.progressBefore ?? chain.want.progress) || 0, criterionMet: false, supersedes: prior.receiptId, reopened: true,
      evidence: [{ id: `artifact-reopened-${name}-${n}`.slice(0, 100), source: `a person's rating of the delivered artifact`, observation: `${by} took back their verdict on "${text(c?.title || name, 120)}"` }] }, { park: true }));
  }
  async function reopenNote({ id, by = 'quinn' }) {
    if (!safeName(id) || !id.endsWith('.md')) throw new Error('a note is named by its file name');
    const entry = (await noteVerdicts()).get(id);
    if (!entry?.live) throw new Error('There is no verdict on this to take back.');
    return worth.record({ id: `rate:note:${id}~${entry.count + 1}`, entityKey: 'self:message', kind: 'rated', rating: 0, by, supersedes: entry.id, retraction: true, about: entry.signal?.about || id });
  }
  async function reopen({ kind, id, by = 'quinn' } = {}) {
    if (kind === 'artifact') {
      const want = await reopenArtifact({ id, by });
      return { kind, id, want, reopened: true };
    }
    if (kind === 'note') { await reopenNote({ id, by }); return { kind, id, reopened: true }; }
    throw new Error('take back a verdict on an artifact or a note');
  }
  // What a verdict did to its want, in the terms the app tells the person.
  function effectOf(before, after) {
    const b = before?.want || {}, a = after?.want || {};
    const names = STRATEGY_NAMES;
    return { progressBefore: b.progress || 0, progressAfter: a.progress || 0, rotated: (a.strategy || 0) > (b.strategy || 0),
      strategyBefore: names[(b.strategy || 0) % names.length], strategyAfter: names[(a.strategy || 0) % names.length],
      unrotated: (a.strategy || 0) < (b.strategy || 0), chainId: after?.chain_id ?? null };
  }

  // A person's verdict on the thinker's writing: a rating on the capability that wrote it.
  async function rateNote({ id, usefulness, note = '', by = 'quinn' }) {
    if (!safeName(id) || !id.endsWith('.md')) throw new Error('a note is named by its file name');
    const path = join(workRoot, 'thinker', id);
    const md = await readFile(path, 'utf8').catch(() => null);
    if (md === null) throw new Error('note not found');
    const u = usefulnessOf(usefulness), n = parseNote(md);
    const prior = (await noteVerdicts()).get(id);
    if (prior?.live && prior.signal?.usefulness === u) return worth.get('self:message');   // the same verdict again changes nothing
    // A changed verdict is a new signal: the last one stays in the journal and stops counting.
    return worth.record({ id: prior ? `rate:note:${id}~${prior.count + 1}` : `rate:note:${id}`, entityKey: 'self:message', kind: 'rated', rating: ledgerRating(u), by, usefulness: u,
      ...(prior ? { supersedes: prior.id } : {}), about: `${text(n.title || id, 120)}${note ? ` — ${text(note, 300)}` : ''}` });
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
    if (input.kind === 'artifact') {
      const before = await queue.get(Number(String(input.id).split('/')[0])).catch(() => null);
      const want = await rateArtifact(input); await settleSimilar();
      // A Useful or Great may mean the finish line is met. Asking is the most it does; the person decides.
      const finishPrompt = finish && usefulnessOf(input.usefulness) >= RATINGS.useful ? await finish.onVerdict(want.chain_id).catch(e => { log.warn?.('[inbox] finish watch:', e.message); return null; }) : null;
      return { kind: 'artifact', id: input.id, want, effect: effectOf(before, want), ...(finishPrompt ? { finishPrompt } : {}) };
    }
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
    // "Yes, it's finished" arrives here. It's often pressed right after the verdict that set a pass off.
    return whenFree(() => queue.outcome(id, receipt));
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
  async function answerAsk({ id, reply, via = 'the app', fromPhone = false }) {
    if (!asks) throw new Error('asks are not available');
    // An answer is the person's words. Clearing an ask without answering it is dismissAsk, which says nothing for them.
    if (typeof reply !== 'string' || !reply.trim()) throw new Error('Say what your answer is, or dismiss the question instead.');
    // Only the code texted back from the phone can approve a payment. Anything reaching this from the app or a local
    // process may deny one and nothing else, so a typed yes can't close the ask or reach a waiting agent.
    if (!fromPhone) {
      const { rows: [held] } = await pool.query(`SELECT metadata FROM notifications WHERE id = $1`, [Number(id)]);
      if (held?.metadata?.payment && !/^\s*(no|deny|denied)\s*$/i.test(reply)) throw new Error('A payment is only approved from your phone, by texting its code back. Nothing here can approve one. You can deny it.');
    }
    const row = await asks.answer(Number(id), reply);
    // "Looks done, confirm?" belongs to the finish watch: a yes finishes the pursuit, anything else leaves it open.
    if (row.metadata?.kind === 'finish' && finish) return { ...row, finish: await finish.answered(row, reply, { via }) };
    if (!agents) return row;
    const { rows } = await pool.query(`SELECT id FROM agent_deployments WHERE ask_id = $1 AND status IN ('waiting_person', 'standing', 'running', 'done') ORDER BY created_at`, [Number(id)]);
    for (const d of rows) await agents.relay(d.id, reply, { via }).catch(e => log.warn?.('[inbox] relay to agent:', e.message));
    // Only a payment Quinn approved with its code (payment-approvals.js) is carried out; a typed yes is not that.
    if (rows.length || !row.metadata?.payment || !YES.test(reply) || row.metadata?.approval?.settled !== 'allow-once') return row;
    return { ...row, followUp: await carryOut(row) };
  }

  // A yes to a held payment whose agent is gone (it ended, failed, or was lost in a restart) still gets acted on: a
  // fresh executor does exactly the action that was held, once, citing the approval. Without this, an answer that
  // came after the agent left changed nothing, and nobody said so.
  async function carryOut(ask) {
    const { rows: [action] } = await pool.query(`SELECT class, host, url, description, cost FROM agent_actions WHERE ask_id = $1 ORDER BY created_at DESC LIMIT 1`, [ask.id]);
    const chainId = Number(ask.metadata?.chainId);
    if (!action || !chainId) return { started: false, why: 'the held action is not on record, so there is nothing to carry out' };
    const task = `Quinn approved ask #${ask.id} after the agent that asked had ended. Carry out the action he approved, once, `
      + `and nothing beyond it (any check written into it protects his intent; a difference that doesn't change his outcome is not a reason to stop): a ${action.class} on ${action.host || action.url || 'the site it names'}`
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
  // Clearing a question without answering it: it leaves Judge, and nothing is said to any agent on the person's
  // behalf (an agent parked on it stays parked until it is answered from its page or stopped). A payment can't be
  // dismissed: it is denied, or approved from the phone.
  async function dismissAsk({ id, by = 'quinn' }) {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 1) throw new Error('name the question to dismiss');
    const { rows: [a] } = await pool.query(`SELECT id, replied_at, metadata FROM notifications WHERE id = $1 AND category = 'ask'`, [n]);
    if (!a) throw new Error('ask not found');
    if (a.metadata?.payment === true) throw new Error('A payment can’t be dismissed. Deny it here, or approve it from your phone.');
    if (a.replied_at) return { id: n, dismissed: false, why: 'it was already answered' };
    await pool.query(`UPDATE notifications SET replied_at = to_timestamp($2 / 1000.0), read = true,
      metadata = metadata || jsonb_build_object('dismissed', jsonb_build_object('by', $3::text, 'at', $2::float8)) WHERE id = $1`, [n, clock(), text(by, 60)]);
    // Dismissing "looks done" is a not-yet: nothing is finished, and its agents may carry on.
    if (a.metadata?.kind === 'finish' && finish) await finish.decline(Number(a.metadata.chainId)).catch(e => log.warn?.('[inbox] finish decline:', e.message));
    const waiting = (await pool.query(`SELECT id FROM agent_deployments WHERE ask_id = $1 AND status = 'waiting_person'`, [n]).catch(() => ({ rows: [] }))).rows.map(r => r.id);
    return { id: n, dismissed: true, agentsStillWaiting: waiting };
  }

  // Everything a pursuit delivered, rated or not: where each lives, and the person's current verdict.
  async function deliverables(chainId) {
    const id = Number(chainId);
    const chain = await queue.get(id);
    if (!chain) throw new Error('want not found');
    const out = [], runs = await runsOf([id]);
    for (const c of (chain.commitments || []).filter(c => c.kind === 'artifact' && c.path)) {
      const name = basename(c.path);
      const v = liveVerdict(chain.want, name);
      let md = null; try { md = await readFile(c.path, 'utf8'); } catch {}
      const a = md === null ? null : parseArtifact(md);
      out.push({ id: `${id}/${name}`, chainId: id, name, title: a?.title || c.title || name, path: c.path, at: c.at || null, agentId: c.agentId || null, source: c.source || c.strategy || null,
        exists: md !== null, excerpt: a ? previewFor(a.body, c, runs) : '', from: a ? creditOf(c, a.footer, runs) : null,
        verdict: v ? (Object.entries(RATINGS).find(([, x]) => x === v.usefulness)?.[0] || null) : null, usefulness: v?.usefulness ?? null, ratedAt: v?.at ?? null,
        changed: v ? verdictsOf(chain.want, name).length > 1 : false, ...cardFields(c, clock()) });
    }
    return out.sort((x, y) => (Number(y.at) || 0) - (Number(x.at) || 0));
  }
  // One deliverable's words, parsed: title, what it is for, how to judge it, and the body.
  async function deliverable(id) {
    const [chainStr, name] = String(id).split('/');
    const chainId = Number(chainStr);
    if (!Number.isInteger(chainId) || chainId < 1 || !safeName(name)) throw new Error('a deliverable is named by want id and file name');
    const found = (await deliverables(chainId)).find(d => d.name === name);
    if (!found) throw new Error('this pursuit delivered no such thing');
    const md = await readFile(found.path, 'utf8').catch(() => null);
    if (md === null) throw new Error('The file is gone from the engine’s work folder.');
    const a = parseArtifact(md);
    const c = ((await queue.get(chainId))?.commitments || []).find(x => x.kind === 'artifact' && basename(x.path || '') === name) || {};
    return { ...found, forWhat: a.forWhat, judge: a.judge, body: withoutCard(a.body, c), markdown: md };
  }
  return { useFinish, list, rate, reopen, dismiss, dismissAsk, deliverables, deliverable, progress, want, continuous, answerAsk, artifacts: async () => artifacts(await activeWants()), notes };
}
