// The inbox: what the engine has for a person, and what a person gives back. Reading it is free. Every
// action here is a rating or a receipt — the only signals that teach the engine anything: a rated artifact
// or note moves the worth of the capability that made it, an observed receipt moves a want, and the
// Chinese Room Meter's creativity dimension is made of nothing but these.
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

export function createInbox({ pool, queue, worth, workRoot, clock = Date.now, log = console }) {
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

  function wantsOf(rows) {
    return rows.map(row => { const w = row.state.want, r = row.state.result || {};
      return { kind: 'want', chainId: row.id, description: text(w.description, 400), doneWhen: text(w.doneWhen, 300), progress: w.progress || 0,
        status: row.status, strategy: w.strategy, origin: row.state.origin?.kind || 'explicit', updatedAt: row.updated_at,
        conclusion: text(r.conclusion, 400), missing: (r.missingEvidence || []).slice(0, 3).map(m => text(m, 200)), receipts: (w.receipts || []).length }; });
  }

  async function entities() {
    const { rows } = await pool.query(`SELECT key, state FROM worth_entities ORDER BY key`);
    return rows.filter(r => !/^outcome:ponder-/.test(r.key)).map(r => ({ kind: 'entity', entityKey: r.key, worth: r.state?.worth ?? null, confidence: r.state?.confidence ?? null, rated: r.state?.rated ?? 0, observed: r.state?.observed ?? 0 }));
  }

  async function list() {
    const rows = await activeWants();
    const [a, n, e] = await Promise.all([artifacts(rows), notes(), entities()]);
    return { at: clock(), toRate: [...a, ...n].sort((x, y) => (y.at || 0) - (x.at || 0)), wants: wantsOf(rows), entities: e };
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
    if (input.kind === 'artifact') return { kind: 'artifact', id: input.id, want: await rateArtifact(input) };
    if (input.kind === 'note') return { kind: 'note', id: input.id, worth: await rateNote(input) };
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

  async function want({ description, doneWhen, priority = 0.7, topic = '', by = 'quinn' }) {
    if (typeof description !== 'string' || description.trim().length < 5) throw new Error('say what you want');
    return queue.enqueue({ seed: description.trim(), doneWhen: typeof doneWhen === 'string' && doneWhen.trim() ? doneWhen.trim() : undefined,
      priority: Number.isFinite(Number(priority)) ? Math.max(0.1, Math.min(1, Number(priority))) : 0.7, topic: text(topic, 160), learning: false },
      { origin: { kind: 'explicit', by } });
  }

  return { list, rate, progress, want, artifacts: async () => artifacts(await activeWants()), notes };
}
