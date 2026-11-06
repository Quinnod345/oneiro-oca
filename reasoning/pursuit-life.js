// A pursuit's life after it starts: pause and resume it, archive and restore it, delete it softly, export it, and read
// what it delivered.
//
// Pause stops a pursuit's work without closing it: its live agents are stopped (their threads, reports and briefs are
// kept), and the engine starts nothing new on it until it is resumed. The person can still send an agent by hand.
// Archive hides a pursuit from the map and the lists; it is reversible, and an archived pursuit that was still open is
// paused too, so nothing works on what nobody can see. Export writes a pursuit out as a folder of plain markdown.
//
// Delete hides a pursuit everywhere and stops its work, and nothing is erased: it can be brought back from Recently
// deleted for 30 days, and the row stays on record after that. There is no hard delete of a pursuit anywhere.
//
// The flags live in the pursuit's own state (ponder_state.paused, .archived, .deleted): the planner, the reasoning queue
// and the continuity sweep skip a paused pursuit, and the map and lists leave out an archived or deleted one.
//
// POST /oca/pursuits/:id/pause | resume | archive | restore | delete | undelete
// GET  /oca/pursuits/deleted             what can still be brought back
// GET  /oca/pursuits/exportable          every pursuit's id, for exporting everything
// GET  /oca/pursuits/:id/export          { folder, files: [{ path, content }] }
// GET  /oca/pursuits/:id/deliverables    every deliverable with its current verdict
// GET  /oca/pursuits/:id/deliverables/:name   one deliverable's words
// POST /oca/inbox/asks/:id/dismiss       clear a question without answering it
import { Router } from 'express';

const line = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const iso = v => { if (v === null || v === undefined || v === '') return null; const t = v instanceof Date ? v.getTime() : Number.isFinite(Number(v)) ? Number(v) : Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const slug = s => line(s, 200).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'pursuit';
const pct = n => `${Math.round((Number(n) || 0) * 100)}%`;
export const DELETE_KEEP_MS = 30 * 86_400_000;
const WITNESS_WORDS = { person: 'a person', message: 'a message', test: 'a test', repo: 'a repository', file: 'a file', sensor: 'a sensor', calendar: 'a calendar', other: 'something else' };

/** A pursuit as a folder of markdown files. Pure: the rows in, the files out. */
export function exportPursuit({ row, runs = [], deliverables = [], now = Date.now() }) {
  const s = row.state || {}, want = s.want || {}, fl = s.finishLine || null;
  // Its name where it has one, the same name the app shows; its first sentence otherwise.
  const asked = line(want.description || row.seed, 200);
  const title = line(s.continuity?.board?.headline, 200) || asked;
  const folder = `pursuit-${row.id}-${slug(title)}`;
  const files = [];
  const verdictWord = d => (d.verdict ? d.verdict.charAt(0).toUpperCase() + d.verdict.slice(1) : 'Not rated yet');
  const finish = [`**Done when:** ${line(want.doneWhen || s.doneWhen, 500) || '(not stated)'}`];
  if (fl?.witness?.detail) finish.push(`**Who or what shows it:** ${line(fl.witness.detail, 200)} (${WITNESS_WORDS[fl.witness.kind] || 'other'})`);
  if (Number.isFinite(fl?.target)) finish.push(`**Target:** ${fl.target}`);
  if (fl?.firstStep) finish.push(`**First step:** ${line(fl.firstStep, 300)}`);
  const status = want.status === 'sated' ? 'Finished' : want.status === 'cancelled' ? 'Cancelled' : s.paused ? 'Paused' : 'Open';
  const work = runs.filter(r => r.kind !== 'talker');
  const delivered = deliverables.filter(d => d.markdown);
  files.push({ path: 'README.md', content: `# ${title}

Pursuit #${row.id} · ${status}${s.archived ? ' · archived' : ''} · exported ${new Date(now).toISOString().slice(0, 10)}
${title === asked ? '' : `\nAsked for: ${asked}\n`}
## Finish line

${finish.join('\n\n')}

## Where it stands

Measured progress: ${pct(want.progress)} from ${(want.receipts || []).length} receipt${(want.receipts || []).length === 1 ? '' : 's'}.${s.continuity?.board?.progress ? `\n\n${line(s.continuity.board.progress, 400)}` : ''}

## Deliverables

${delivered.length ? delivered.map(d => `- [${line(d.title, 120)}](deliverables/${d.name}) — ${verdictWord(d)}`).join('\n') : 'Nothing delivered yet.'}

## Agents

${work.length ? `${work.length} run${work.length === 1 ? '' : 's'}: ${work.filter(r => r.status === 'done').length} finished, ${work.filter(r => r.status === 'failed').length} failed, ${work.filter(r => r.status === 'cancelled').length} stopped. Each one is in [agents.md](agents.md).` : 'No agent has worked on it yet.'}

What it knows is in [evidence.md](evidence.md).
` });
  for (const d of delivered) files.push({ path: `deliverables/${d.name}`, content: d.markdown });
  files.push({ path: 'agents.md', content: `# Agents on pursuit #${row.id}\n\n${work.length ? work.map(r => {
    const report = r.report || {};
    const sources = (report.evidence || []).filter(e => e?.source).map(e => `  - ${line(e.source, 300)}: ${line(e.observation, 300)}`).join('\n');
    return `## ${line(r.kind, 20)} · ${line(r.status, 20)} · ${iso(r.created_at)?.slice(0, 16).replace('T', ' ') || ''}

**Asked to:** ${line(r.task, 1200)}

${report.summary ? `**What came back:** ${line(report.summary, 2000)}` : r.error ? `**Why it stopped:** ${line(r.error, 600)}` : r.question ? `**It asked:** ${line(r.question, 600)}` : '_No report._'}${sources ? `\n\n**Sources:**\n${sources}` : ''}`;
  }).join('\n\n') : 'No agent has worked on it yet.'}\n` });
  const evidence = s.evidence || [];
  files.push({ path: 'evidence.md', content: `# What pursuit #${row.id} knows\n\n${evidence.length ? evidence.map(e => `- ${line(e.observation, 800)}\n  _${line(e.source, 300)}_`).join('\n') : 'Nothing recorded yet.'}\n` });
  return { folder, files };
}

export function createPursuitLife({ pool, inbox = null, agents = null, pursuitWork = null, asks = null, clock = Date.now, log = console } = {}) {
  const chainRow = async id => (await pool.query(`SELECT id, seed, status, updated_at, ponder_state AS state FROM thought_chains WHERE id = $1 AND ponder_state IS NOT NULL`, [Number(id)])).rows[0] || null;
  const need = async id => { const n = Number(id); if (!Number.isInteger(n) || n < 1) throw new Error('name the pursuit'); const r = await chainRow(n); if (!r) throw new Error('pursuit not found'); return r; };
  const view = row => ({ chainId: row.id, status: row.status, wantStatus: row.state?.want?.status || null, paused: row.state?.paused || null, archived: row.state?.archived || null, deleted: row.state?.deleted || null });

  // Stop what is running on it now; every stopped agent keeps its thread, report and brief.
  async function stopLive(id) {
    const stopped = [];
    for (const d of await agents?.list({ chainId: id, live: true }).catch(() => []) ?? []) {
      if (d.kind === 'talker') continue;
      try { await agents.cancel(d.id); stopped.push(d.id); } catch (e) { log.warn?.(`[pursuit-life] #${id} stop ${String(d.id).slice(0, 8)}:`, e.message); }
    }
    await pursuitWork?.cancel?.(id).catch?.(() => {});
    return stopped;
  }

  async function pause(id, { by = 'quinn', why = 'paused by the person' } = {}) {
    const row = await need(id);
    if (row.state?.want?.status !== 'active') throw new Error('Only an open pursuit can be paused.');
    if (!row.state.paused) {
      await pool.query(`UPDATE thought_chains SET ponder_state = ponder_state || jsonb_build_object('paused', $2::jsonb), updated_at = now() WHERE id = $1`,
        [row.id, JSON.stringify({ at: clock(), by: line(by, 40), why: line(why, 120) })]);
    }
    const stopped = await stopLive(row.id);
    log.log?.(`[pursuit-life] #${row.id} paused; ${stopped.length} agent(s) stopped`);
    return { ...view(await chainRow(row.id)), stopped };
  }
  async function resume(id) {
    const row = await need(id);
    await pool.query(`UPDATE thought_chains SET ponder_state = ponder_state - 'paused', updated_at = now() WHERE id = $1`, [row.id]);
    return view(await chainRow(row.id));
  }
  async function archive(id, { by = 'quinn' } = {}) {
    const row = await need(id);
    let stopped = [];
    if (row.state?.want?.status === 'active' && !row.state.paused) stopped = (await pause(row.id, { by, why: 'archived' })).stopped;
    await pool.query(`UPDATE thought_chains SET ponder_state = ponder_state || jsonb_build_object('archived', $2::jsonb) WHERE id = $1`, [row.id, JSON.stringify({ at: clock(), by: line(by, 40) })]);
    return { ...view(await chainRow(row.id)), stopped };
  }
  // Restoring brings it back as it was: a pause that came with the archive goes with it; one the person set stays.
  async function restore(id) {
    const row = await need(id);
    const pausedByArchive = row.state?.paused?.why === 'archived';
    await pool.query(`UPDATE thought_chains SET ponder_state = (ponder_state - 'archived')${pausedByArchive ? ` - 'paused'` : ''} WHERE id = $1`, [row.id]);
    return view(await chainRow(row.id));
  }
  // A name a person gives is theirs: no review replaces it (reasoning/board.js keeps it).
  async function rename(id, title) {
    const row = await need(id);
    const name = line(title, 80);
    if (!name) throw new Error('Give it a name first.');
    await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{continuity}', COALESCE(ponder_state -> 'continuity', '{}'::jsonb)
      || jsonb_build_object('board', COALESCE(ponder_state #> '{continuity,board}', '{}'::jsonb) || $2::jsonb)) WHERE id = $1`, [row.id, JSON.stringify({ headline: name, namedBy: 'person' })]);
    return view(await chainRow(row.id));
  }
  // Soft delete. Its agents stop, what it asked is closed (a payment can't be approved for a pursuit nobody can see), and
  // it leaves every list. The row, its files and its history stay.
  async function remove(id, { by = 'quinn' } = {}) {
    const row = await need(id);
    if (row.state?.standing === 'self') throw new Error('This is Oneiro\'s own standing pursuit, so it can\'t be deleted. Pause it instead.');
    if (row.state?.deleted) return { ...view(row), stopped: [], recoverUntil: Number(row.state.deleted.at) + DELETE_KEEP_MS };
    let stopped = [];
    if (row.state?.want?.status === 'active' && !row.state.paused) stopped = (await pause(row.id, { by, why: 'deleted' })).stopped;
    else if (row.state?.want?.status === 'active') stopped = await stopLive(row.id);
    const at = clock();
    await pool.query(`UPDATE thought_chains SET ponder_state = ponder_state || jsonb_build_object('deleted', $2::jsonb) WHERE id = $1`, [row.id, JSON.stringify({ at, by: line(by, 40), recoverUntil: at + DELETE_KEEP_MS })]);
    for (const a of (await asks?.open().catch(() => []) ?? []).filter(a => Number(a.chainId) === row.id)) {
      await asks.answer(a.id, a.payment ? 'no' : 'The pursuit was deleted.').catch(e => log.warn?.(`[pursuit-life] #${row.id} ask #${a.id}:`, e.message));
    }
    log.log?.(`[pursuit-life] #${row.id} deleted (soft); ${stopped.length} agent(s) stopped`);
    return { ...view(await chainRow(row.id)), stopped, recoverUntil: at + DELETE_KEEP_MS };
  }
  // Brought back as it was: a pause the delete brought goes with it; one the person set stays.
  async function undelete(id) {
    const row = await need(id);
    const pausedByDelete = row.state?.paused?.why === 'deleted';
    await pool.query(`UPDATE thought_chains SET ponder_state = (ponder_state - 'deleted')${pausedByDelete ? ` - 'paused'` : ''} WHERE id = $1`, [row.id]);
    return view(await chainRow(row.id));
  }
  async function deleted() {
    const { rows } = await pool.query(`SELECT id, seed, status, updated_at, ponder_state AS state FROM thought_chains WHERE ponder_state -> 'deleted' IS NOT NULL
      AND (ponder_state #>> '{deleted,at}')::float8 > $1 ORDER BY (ponder_state #>> '{deleted,at}')::float8 DESC LIMIT 200`, [clock() - DELETE_KEEP_MS]);
    return rows.map(r => ({ chainId: r.id, title: line(r.state?.continuity?.board?.headline || r.state?.want?.description || r.seed, 300), status: r.status, deletedAt: Number(r.state.deleted.at), recoverUntil: Number(r.state.deleted.at) + DELETE_KEEP_MS }));
  }
  // Every pursuit a person could read, archived ones too. Export-everything walks these one at a time.
  async function exportable() {
    const { rows } = await pool.query(`SELECT id FROM thought_chains WHERE ponder_state IS NOT NULL AND ponder_state ? 'want' AND ponder_state -> 'deleted' IS NULL ORDER BY id`);
    return rows.map(r => r.id);
  }
  async function deliverablesWithWords(id) {
    if (!inbox) return [];
    const list = await inbox.deliverables(id).catch(() => []);
    const out = [];
    for (const d of list) out.push(d.exists ? await inbox.deliverable(d.id).catch(() => d) : d);
    return out;
  }
  async function exportOne(id) {
    const row = await need(id);
    const { rows: runs } = await pool.query(`SELECT * FROM agent_deployments WHERE chain_id = $1 ORDER BY created_at ASC LIMIT 300`, [row.id]).catch(() => ({ rows: [] }));
    return exportPursuit({ row, runs, deliverables: await deliverablesWithWords(row.id), now: clock() });
  }

  const router = Router();
  const route = h => async (req, res) => { try { res.json(await h(req)); } catch (e) { res.status(/not found/.test(e.message) ? 404 : 400).json({ error: e.message }); } };
  router.post('/oca/pursuits/:id/pause', route(req => pause(req.params.id, { by: req.body?.by || 'quinn' })));
  router.post('/oca/pursuits/:id/resume', route(req => resume(req.params.id)));
  router.post('/oca/pursuits/:id/archive', route(req => archive(req.params.id, { by: req.body?.by || 'quinn' })));
  router.post('/oca/pursuits/:id/restore', route(req => restore(req.params.id)));
  router.post('/oca/pursuits/:id/rename', route(req => rename(req.params.id, req.body?.title)));
  router.post('/oca/pursuits/:id/delete', route(req => remove(req.params.id, { by: req.body?.by || 'quinn' })));
  router.post('/oca/pursuits/:id/undelete', route(req => undelete(req.params.id)));
  router.get('/oca/pursuits/deleted', route(async () => ({ items: await deleted() })));
  router.get('/oca/pursuits/exportable', route(async () => ({ ids: await exportable() })));
  router.get('/oca/pursuits/:id/export', route(req => exportOne(req.params.id)));
  router.get('/oca/pursuits/:id/deliverables', route(async req => ({ items: inbox ? await inbox.deliverables(req.params.id) : [] })));
  router.get('/oca/pursuits/:id/deliverables/:name', route(req => { if (!inbox) throw new Error('deliverables are not available'); return inbox.deliverable(`${Number(req.params.id)}/${req.params.name}`); }));
  router.post('/oca/inbox/asks/:id/dismiss', route(req => { if (!inbox) throw new Error('asks are not available'); return inbox.dismissAsk({ id: req.params.id, by: req.body?.by || 'quinn' }); }));
  return { pause, resume, archive, restore, rename, remove, undelete, deleted, exportable, export: exportOne, router };
}
