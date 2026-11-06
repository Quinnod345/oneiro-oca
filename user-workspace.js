import { Router } from 'express';
import { simulationQuality, simulationGrounding } from './simulation/forward.js';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createUserControls } from './user-controls.js';
import { capabilities, diagnostics, validateInput } from './user-capabilities.js';

// Dependencies are injected to exercise the real API against a private test schema.
export function createUserWorkspace({ pool, queue, runPending, operations, llmStatus, applyInference = null }) {
  const router = Router(), controls = createUserControls(pool);
  const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(400).json({ error: e.message }); } };
  const id = req => { const n = Number(req.params.id); if (!Number.isSafeInteger(n) || n < 1) throw new Error('Invalid pursuit ID'); return n; };
  router.get('/oca/ui/capabilities', (_req, res) => res.json({ capabilities, diagnostics }));
  router.get('/oca/ui/controls', wrap(async (_req, res) => res.json({ ...await controls.get(), model: llmStatus(),
    permissions: { autonomousActions: /^(1|true|yes)$/i.test(process.env.OCA_ENABLE_AUTONOMOUS_ACTIONS || process.env.ONEIRO_ENABLE_AUTONOMOUS_ACTIONS || ''),
      dreamExecution: /^(1|true|yes)$/i.test(process.env.OCA_ENABLE_DREAM_EXECUTION || process.env.ONEIRO_ENABLE_DREAM_EXECUTION || '') } })));
  router.patch('/oca/ui/controls', wrap(async (req, res) => {
    const next = await controls.update(req.body);
    if (req.body?.inference !== undefined && applyInference) applyInference(next.inference);
    res.json(next);
  }));
  router.get('/oca/ui/pursuits', wrap(async (req, res) => {
    const offset = Math.max(0, Math.min(100000, Number(req.query.offset) || 0));
    // Archived pursuits (reasoning/pursuit-life.js) are listed only under their own filter.
    // Deleted ones (soft, recoverable) are read from /oca/pursuits/deleted and appear under no filter here.
    const filter = ['active', 'closed', 'all', 'archived'].includes(req.query.filter) ? req.query.filter : 'active';
    const q = String(req.query.q || '').slice(0, 200);
    const { rows } = await pool.query(`SELECT id AS chain_id, seed, status, depth, priority, updated_at,
      ponder_state #>> '{continuity,board,headline}' AS headline, (ponder_state->'want') - 'receipts' AS want, ponder_state->'origin' AS origin,
      ponder_state->'result'->>'conclusion' AS conclusion,
      jsonb_array_length(COALESCE(ponder_state->'evidence','[]'::jsonb)) AS evidence_count,
      ponder_state->'paused' AS paused, ponder_state->'archived' AS archived,
      count(*) OVER()::int AS total
      FROM thought_chains WHERE ponder_state IS NOT NULL AND ponder_state->'deleted' IS NULL AND seed ILIKE $1
      AND (($2 = 'archived') = (ponder_state->'archived' IS NOT NULL))
      AND ($2 IN ('all', 'archived') OR ($2 = 'closed') = (status IN ('resolved','cancelled')))
      ORDER BY updated_at DESC, id DESC LIMIT 30 OFFSET $3`, [`%${q}%`, filter, offset]);
    const {rows:[summary]} = await pool.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status IN ('awaiting_evidence','budget','stalled','failed'))::int AS "needsAttention"
      FROM thought_chains WHERE ponder_state IS NOT NULL AND ponder_state->'deleted' IS NULL AND seed ILIKE $1
      AND (($2 = 'archived') = (ponder_state->'archived' IS NOT NULL))
      AND ($2 IN ('all', 'archived') OR ($2 = 'closed') = (status IN ('resolved','cancelled')))`, [`%${q}%`, filter]);
    res.json({ items: rows, ...summary, offset });
  }));
  router.post('/oca/ui/pursuits/:id/run', wrap(async (req, res) => {
    const chain = await queue.get(id(req));
    if (!chain) return res.status(404).json({ error: 'Pursuit not found' });
    if ((await controls.get()).queuePaused) return res.status(409).json({ error: 'Queue is paused. Resume it in Controls first.' });
    if (chain.status !== 'pondering') return res.status(409).json({ error: 'This pursuit is not queued. Add evidence or retry an interrupted pass first.' });
    // Queue ownership stays with the service; this response is acceptance, not completion.
    void runPending(chain.chain_id).catch(e => console.error('[workspace] ponder:', e.message));
    res.status(202).json({ accepted: true, chain_id: chain.chain_id });
  }));
  const recordQueries = {
    hypotheses: `SELECT id, claim AS title, status FROM hypotheses ORDER BY id DESC LIMIT 100`,
    experiments: `SELECT id, cause_description AS title, status FROM causal_experiments ORDER BY id DESC LIMIT 100`,
    simulations: `SELECT id, description AS title, 'prediction' AS status FROM simulations ORDER BY id DESC LIMIT 100`,
    concepts: `SELECT id, concept AS title, 'remembered' AS status FROM semantic_memory WHERE forgotten_at IS NULL ORDER BY id DESC LIMIT 100`,
    intentions: `SELECT id, intention AS title, status FROM prospective_memory WHERE status IN ('pending','triggered') ORDER BY id DESC LIMIT 100`,
  };
  router.get('/oca/ui/records/:kind', wrap(async (req, res) => {
    if (!Object.hasOwn(recordQueries, req.params.kind)) return res.status(404).json({ error: 'Unknown record collection' });
    const { rows } = await pool.query(recordQueries[req.params.kind]);
    res.json({ items: rows, note: 'Most recent 100 records. The title and status identify what you are selecting.' });
  }));
  // ── MEMORY ── browse, word search, exact inspection, forget and restore.
  // Forgetting is a soft delete (migrations/070_memory_forget.sql): forgotten_at is set, every listing here and the
  // engine's recall paths skip the record, and restore clears the column so Undo brings it back exactly as it was.
  const NARRATION_FILTER = `event_type <> ALL(ARRAY['cognitive_cycle','thought','system','blocked_action','deliberation_block']) AND event_type NOT LIKE 'ponder\\_%'`;
// A summary it generated about its own state: its mood readings, battery, cycles and errors. Not something it learned about
// anyone or anything, so it sits behind "Show engine notes" with the rest. The app holds the same list (EWMemoryItem).
const SELF_SUMMARY_FILTER = `NOT (source_type = 'abstraction' AND concept ~* '(valence|arousal|surprise|battery|cognitive|goal count|\\mcycles?\\M|\\mboot|hunger|attention level|activation level|typing speed|alertness|\\msystem\\M|embedding|inference|latency|thinker|working memory|heartbeat|the engine|http [0-9]{3})')`;
  const memoryKinds = {
    experience: { table: 'episodic_memory', document: 'content', time: 'timestamp',
      fields: 'id, timestamp, timestamp AS recorded_at, event_type, event_type AS origin, content, active_app, user_presence, consolidation_status' },
    knowledge: { table: 'semantic_memory', document: 'concept', time: 'created_at',
      fields: 'id, created_at, created_at AS recorded_at, concept, category, source_type, source_type AS origin, source_episodes, confidence, contradiction_count' },
  };
  const memoryKind = (raw, { all = false } = {}) => {
    const kind = String(raw ?? '');
    if (all && kind === 'all') return ['experience', 'knowledge'];
    return Object.hasOwn(memoryKinds, kind) ? [kind] : null;
  };
  async function readMemory(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '5s'");
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }
  const newestFirst = (a, b) => new Date(b.recorded_at) - new Date(a.recorded_at) || b.id - a.id;
  // Browsing needs no query: the Memory page opens on the newest experiences and claims instead of an empty box.
  router.get('/oca/ui/memory-recent', wrap(async (req, res) => {
    const kinds = memoryKind(req.query.kind ?? 'all', { all: true });
    if (!kinds) return res.status(400).json({ error: 'Choose experiences, knowledge or all' });
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20));
    let before = null;
    if (req.query.before !== undefined) {
      before = new Date(String(req.query.before));
      if (Number.isNaN(before.getTime())) return res.status(400).json({ error: 'Invalid "before" time' });
    }
    // Mixed browsing gives each kind an equal share; the busy experience stream would otherwise bury every claim.
    const share = kinds.length > 1 ? Math.ceil(limit / kinds.length) : limit;
    // The engine's own running commentary ("Cycle 12 [alert]…", pursuit passes, boot lines) outnumbers everything a
    // person cares about by a thousand to one. It stays out of the browse unless they ask for it: narration=1.
    const withNarration = req.query.narration === '1';
    const results = await readMemory(async client => {
      const rows = [];
      for (const kind of kinds) {
        const m = memoryKinds[kind];
        const quiet = withNarration ? '' : kind === 'experience' ? `AND ${NARRATION_FILTER}` : kind === 'knowledge' ? `AND ${SELF_SUMMARY_FILTER}` : '';
        const { rows: found } = await client.query(`SELECT '${kind}' AS kind, ${m.fields} FROM ${m.table}
          WHERE forgotten_at IS NULL AND ($1::timestamptz IS NULL OR ${m.time} < $1) ${quiet}
          ORDER BY ${m.time} DESC, id DESC LIMIT $2`, [before, share]);
        rows.push(...found);
      }
      return rows.sort(newestFirst).slice(0, limit);
    });
    res.json({ results, kind: kinds.length > 1 ? 'all' : kinds[0], limit, retrieval: 'recent',
      // Paging only within one kind: a mixed page's oldest time would skip the other kind's records.
      next: kinds.length === 1 && results.length === limit ? results.at(-1).recorded_at : null,
      note: 'The newest stored records, newest first. Recorded, not independently verified.' });
  }));
  // Explicit lexical search: never compare fallback vectors against a different embedding space.
  // No model request or learning signal is needed to browse recorded words.
  router.get('/oca/ui/memory-search', wrap(async (req, res) => {
    const kinds = memoryKind(req.query.kind, { all: true }), q = String(req.query.q || '').trim();
    if (!kinds) return res.status(400).json({ error: 'Choose experiences, knowledge or all' });
    if (!q || q.length > 300) return res.status(400).json({ error: 'Enter between 1 and 300 characters to search' });
    const results = await readMemory(async client => {
      const rows = [];
      for (const kind of kinds) {
        const m = memoryKinds[kind];
        const { rows: found } = await client.query(`SELECT '${kind}' AS kind, ${m.fields},
          ts_rank_cd(to_tsvector('simple', ${m.document}), plainto_tsquery('simple', $1)) AS rank FROM ${m.table}
          WHERE forgotten_at IS NULL AND to_tsvector('simple', ${m.document}) @@ plainto_tsquery('simple', $1)
          ORDER BY rank DESC, id DESC LIMIT 20`, [q]);
        rows.push(...found);
      }
      return rows.sort((a, b) => b.rank - a.rank || (a.kind === b.kind ? b.id - a.id : newestFirst(a, b))).slice(0, 20);
    });
    res.json({ results, query: q, retrieval: 'word_search', limit: 20,
      note: 'Matching recorded words, newest first within relevance. This is not semantic similarity or independent verification. Showing up to 20 matches.' });
  }));
  // Exact source inspection must not do another similarity search, count a recall,
  // or imply that a stored claim has been independently checked.
  router.get('/oca/ui/memory/:kind/:id', wrap(async (req, res) => {
    const kind = req.params.kind, recordId = Number(req.params.id);
    if (!['experience', 'knowledge'].includes(kind)) return res.status(404).json({ error: 'Unknown memory collection' });
    if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(recordId) || recordId < 1) return res.status(400).json({ error: 'Invalid memory ID' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const episodeColumns = 'id, timestamp, event_type, content, active_app, user_presence, user_activity, prediction, actual_outcome, consolidation_status';
      const { rows: [record] } = await client.query(kind === 'experience'
        ? `SELECT ${episodeColumns}, forgotten_at FROM episodic_memory WHERE id=$1`
        : 'SELECT id, created_at, updated_at, concept, category, source_type, source_episodes, confidence, evidence_count, contradiction_count, forgotten_at FROM semantic_memory WHERE id=$1', [recordId]);
      if (!record) {
        await client.query('COMMIT');
        return res.status(404).json({ error: 'Original memory record is no longer available. The search result may be stale.' });
      }
      if (record.forgotten_at) {
        await client.query('COMMIT');
        return res.status(410).json({ error: 'You asked Oneiro to forget this memory. Restore it from Recently forgotten on the Memory page to read it again.', forgotten: true });
      }
      delete record.forgotten_at;
      let sources = [], missingSourceIds = [], evidence = [], evidenceTotal = 0;
      const allSourceIds = [...new Set((record.source_episodes || []).filter(n => Number.isSafeInteger(n) && n > 0))];
      const sourceIds = allSourceIds.slice(0, 30);
      if (kind === 'knowledge') {
        if (sourceIds.length) {
          // A forgotten source experience is reported as missing, never shown.
          ({ rows: sources } = await client.query(`SELECT ${episodeColumns} FROM episodic_memory WHERE id=ANY($1::int[]) AND forgotten_at IS NULL ORDER BY timestamp, id`, [sourceIds]));
          missingSourceIds = sourceIds.filter(id => !sources.some(source => source.id === id));
        }
        ({ rows: evidence } = await client.query('SELECT id, episode_id, source_type, supports, evidence_text, observed_at FROM semantic_evidence WHERE concept_id=$1 ORDER BY observed_at DESC, id DESC LIMIT 30', [recordId]));
        const { rows: [count] } = await client.query('SELECT count(*)::int AS total FROM semantic_evidence WHERE concept_id=$1', [recordId]);
        evidenceTotal = count.total;
      }
      await client.query('COMMIT');
      res.json({ kind, record, sources, missingSourceIds, sourceTotal: allSourceIds.length,
        evidence, evidenceTotal, verification: 'not_independently_verified',
        note: 'These are stored records and their recorded sources, not an independent verification. A generated claim, confidence score or recorded outcome description is not proof it happened.' });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }));
  // Forget is a soft delete with an audit row; restore is its Undo. Both are idempotent, so a retried tap is harmless.
  // The audit row keeps no copy of the memory's text.
  async function setForgotten(req, res, forget) {
    const [kind] = memoryKind(req.params.kind) || [], recordId = Number(req.params.id);
    if (!kind) return res.status(404).json({ error: 'Unknown memory collection' });
    if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(recordId) || recordId < 1 || recordId > 2147483647) return res.status(400).json({ error: 'Invalid memory ID' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) || null : null;
    const { table } = memoryKinds[kind];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [row] } = await client.query(`SELECT id, forgotten_at FROM ${table} WHERE id=$1 FOR UPDATE`, [recordId]);
      if (!row) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'That memory is no longer stored. The list may be out of date; refresh it.' });
      }
      const changed = forget ? row.forgotten_at === null : row.forgotten_at !== null;
      let forgottenAt = row.forgotten_at;
      if (changed) {
        ({ rows: [{ forgotten_at: forgottenAt }] } = await client.query(
          `UPDATE ${table} SET forgotten_at=${forget ? 'now()' : 'NULL'} WHERE id=$1 RETURNING forgotten_at`, [recordId]));
        await client.query('INSERT INTO memory_forget_log(kind, record_id, action, reason) VALUES($1,$2,$3,$4)',
          [kind, recordId, forget ? 'forget' : 'restore', reason]);
      }
      await client.query('COMMIT');
      res.json({ kind, id: recordId, forgotten: forgottenAt !== null, forgottenAt, changed,
        message: forget
          ? (changed ? 'Forgotten. It no longer shows up in recall. Undo brings it back.' : 'This memory was already forgotten.')
          : (changed ? 'Restored. It shows up in recall again.' : 'This memory was not forgotten, so nothing changed.') });
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }
  router.post('/oca/ui/memory/:kind/:id/forget', wrap((req, res) => setForgotten(req, res, true)));
  router.post('/oca/ui/memory/:kind/:id/restore', wrap((req, res) => setForgotten(req, res, false)));
  // Recently forgotten records, so a memory can be restored after the Undo moment has passed.
  router.get('/oca/ui/memory-forgotten', wrap(async (_req, res) => {
    const results = await readMemory(async client => {
      const rows = [];
      for (const kind of Object.keys(memoryKinds)) {
        const m = memoryKinds[kind];
        const { rows: found } = await client.query(`SELECT '${kind}' AS kind, ${m.fields}, forgotten_at FROM ${m.table}
          WHERE forgotten_at IS NOT NULL ORDER BY forgotten_at DESC, id DESC LIMIT 30`);
        rows.push(...found);
      }
      return rows.sort((a, b) => new Date(b.forgotten_at) - new Date(a.forgotten_at) || b.id - a.id).slice(0, 30);
    });
    res.json({ results, note: 'Forgotten memories stay out of recall until you restore them.' });
  }));
  router.get('/oca/ui/consolidation-candidates', wrap(async (_req, res) => {
    const { rows } = await pool.query(`SELECT id, review_id, kind, status, payload, evidence, created_at
      FROM consolidation_candidates ORDER BY created_at DESC, id DESC LIMIT 30`);
    res.json({ items: rows, verification: 'unverified_candidates_only',
      note: 'Generated proposals with cited episode excerpts. Not accepted facts, proven skills or causal outcomes.' });
  }));
  router.get('/oca/ui/conventions', wrap(async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM cohabitation_conventions WHERE active=true ORDER BY version DESC LIMIT 1');
    res.json({ current: rows[0] || null, message: rows.length ? 'Current recorded agreements' : 'No agreements recorded yet' });
  }));
  router.get('/oca/ui/activity', wrap(async (_req, res) => {
    const { rows } = await pool.query(`SELECT id, timestamp, event_type, source_layer,
      left(payload::text, 1000) AS detail FROM cognitive_events ORDER BY timestamp DESC LIMIT 60`);
    res.json({ items: rows });
  }));
  router.get('/oca/ui/jobs', wrap(async (_req, res) => {
    const { rows } = await pool.query(`SELECT id, kind, title, status, error, created_at, updated_at,
      CASE WHEN kind='imagine' THEN jsonb_build_object('quality',result->'quality','expected_outcome',result->'expected_outcome','risks',result->'risks','predicted_states',result->'predicted_states') END AS quality_result
      FROM oca_user_jobs ORDER BY created_at DESC LIMIT 30`);
    res.json({ items: rows.map(({quality_result, ...row}) => ({...row, result_quality: row.kind === 'imagine' && row.status === 'completed' ? simulationQuality(quality_result) : null})) });
  }));
  router.get('/oca/ui/jobs/:id', wrap(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM oca_user_jobs WHERE id = $1', [req.params.id]);
    const row = rows[0];
    res.status(row ? 200 : 404).json(row ? {...row,
      result_quality: row.kind === 'imagine' && row.status === 'completed' ? simulationQuality(row.result) : null,
      grounding: row.kind === 'imagine' && simulationQuality(row.result) === 'generated_prediction' ? simulationGrounding(row.result, row.input) : null
    } : { error: 'Operation not found' });
  }));
  let active = false;
  async function drain() {
    if (active) return;
    active = true;
    try {
      while (true) {
        const { rows } = await pool.query(`UPDATE oca_user_jobs SET status='running', updated_at=now()
          WHERE id=(SELECT id FROM oca_user_jobs WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`);
        const job = rows[0]; if (!job) break;
        try {
          const result = await operations[job.kind](job.input);
          if (result?.error) throw new Error(result.error);
          await pool.query("UPDATE oca_user_jobs SET status='completed', result=$2::jsonb, updated_at=now() WHERE id=$1", [job.id, JSON.stringify(result ?? { message: 'No result returned', empty: true })]);
        } catch (e) {
          await pool.query("UPDATE oca_user_jobs SET status='failed', error=$2, updated_at=now() WHERE id=$1", [job.id, e.message]);
        }
      }
    } finally {
      active = false;
      // An insert may have committed while the last empty claim was returning.
      const { rows } = await pool.query("SELECT 1 FROM oca_user_jobs WHERE status='queued' LIMIT 1");
      if (rows.length) setImmediate(() => { void drain().catch(e => console.error('[workspace] job wake:', e.message)); });
    }
  }
  router.post('/oca/ui/jobs', wrap(async (req, res) => {
    const { kind, input = {}, title, clientRequestId = null } = req.body || {};
    if (!Object.hasOwn(operations, kind)) throw new Error('Unknown operation');
    if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 32000) throw new Error('Invalid operation input');
    validateInput(kind, input);
    if (clientRequestId !== null && (typeof clientRequestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(clientRequestId))) throw new Error('Invalid client request ID');
    const jobId = clientRequestId || randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('oca-user-job-admission'))");
      const existing = await client.query('SELECT id,kind,input,status FROM oca_user_jobs WHERE id=$1', [jobId]);
      if (existing.rows[0]) {
        await client.query('COMMIT');
        if (existing.rows[0].kind !== kind || !isDeepStrictEqual(existing.rows[0].input, input)) return res.status(409).json({error:'An earlier version of this request is already saved. Open its result before starting a different operation.'});
        return res.json({id:jobId,status:existing.rows[0].status});
      }
      const { rows: pending } = await client.query("SELECT count(*)::int AS count FROM oca_user_jobs WHERE status IN ('queued','running')");
      if (pending[0].count >= 4) {
        await client.query('COMMIT');
        return res.status(429).json({ error: 'Four operations are already pending. Wait for a result before starting another.' });
      }
      await client.query('INSERT INTO oca_user_jobs(id,kind,title,input) VALUES($1,$2,$3,$4::jsonb)', [jobId,kind,String(title || kind).slice(0,200),JSON.stringify(input)]);
      await client.query('COMMIT');
    } catch(e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
    res.status(202).json({ id: jobId, status: 'queued' });
    void drain().catch(e => console.error('[workspace] operation runner:', e.message));
  }));
  // A restart must not silently repeat a user mutation or claim it completed.
  async function recover() {
    await pool.query("UPDATE oca_user_jobs SET status='interrupted', error='Engine restarted before a result was saved. Inspect the affected data before running again.', updated_at=now() WHERE status IN ('queued','running')");
  }
  return { router, recover, drain };
}
