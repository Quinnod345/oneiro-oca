import { Router } from 'express';
import { simulationQuality, simulationGrounding } from './simulation/forward.js';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createUserControls } from './user-controls.js';
import { capabilities, diagnostics, validateInput } from './user-capabilities.js';

// Dependencies are injected to exercise the real API against a private test schema.
export function createUserWorkspace({ pool, queue, runPending, operations, llmStatus }) {
  const router = Router(), controls = createUserControls(pool);
  const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(400).json({ error: e.message }); } };
  const id = req => { const n = Number(req.params.id); if (!Number.isSafeInteger(n) || n < 1) throw new Error('Invalid pursuit ID'); return n; };
  router.get('/oca/ui/capabilities', (_req, res) => res.json({ capabilities, diagnostics }));
  router.get('/oca/ui/controls', wrap(async (_req, res) => res.json({ ...await controls.get(), model: llmStatus(),
    permissions: { autonomousActions: /^(1|true|yes)$/i.test(process.env.OCA_ENABLE_AUTONOMOUS_ACTIONS || process.env.ONEIRO_ENABLE_AUTONOMOUS_ACTIONS || ''),
      dreamExecution: /^(1|true|yes)$/i.test(process.env.OCA_ENABLE_DREAM_EXECUTION || process.env.ONEIRO_ENABLE_DREAM_EXECUTION || '') } })));
  router.patch('/oca/ui/controls', wrap(async (req, res) => res.json(await controls.update(req.body))));
  router.get('/oca/ui/pursuits', wrap(async (req, res) => {
    const offset = Math.max(0, Math.min(100000, Number(req.query.offset) || 0));
    const filter = ['active', 'closed', 'all'].includes(req.query.filter) ? req.query.filter : 'active';
    const q = String(req.query.q || '').slice(0, 200);
    const { rows } = await pool.query(`SELECT id AS chain_id, seed, status, depth, priority, updated_at,
      (ponder_state->'want') - 'receipts' AS want, ponder_state->'origin' AS origin,
      ponder_state->'result'->>'conclusion' AS conclusion,
      jsonb_array_length(COALESCE(ponder_state->'evidence','[]'::jsonb)) AS evidence_count,
      count(*) OVER()::int AS total
      FROM thought_chains WHERE ponder_state IS NOT NULL AND seed ILIKE $1
      AND ($2 = 'all' OR ($2 = 'closed') = (status IN ('resolved','cancelled')))
      ORDER BY updated_at DESC, id DESC LIMIT 30 OFFSET $3`, [`%${q}%`, filter, offset]);
    const {rows:[summary]} = await pool.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status IN ('awaiting_evidence','budget','stalled','failed'))::int AS "needsAttention"
      FROM thought_chains WHERE ponder_state IS NOT NULL AND seed ILIKE $1
      AND ($2 = 'all' OR ($2 = 'closed') = (status IN ('resolved','cancelled')))`, [`%${q}%`, filter]);
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
    concepts: `SELECT id, concept AS title, 'remembered' AS status FROM semantic_memory ORDER BY id DESC LIMIT 100`,
    intentions: `SELECT id, intention AS title, status FROM prospective_memory WHERE status IN ('pending','triggered') ORDER BY id DESC LIMIT 100`,
  };
  router.get('/oca/ui/records/:kind', wrap(async (req, res) => {
    if (!Object.hasOwn(recordQueries, req.params.kind)) return res.status(404).json({ error: 'Unknown record collection' });
    const { rows } = await pool.query(recordQueries[req.params.kind]);
    res.json({ items: rows, note: 'Most recent 100 records. The title and status identify what you are selecting.' });
  }));
  // Explicit lexical search: never compare fallback vectors against a different embedding space.
  // No model request or learning signal is needed to browse recorded words.
  router.get('/oca/ui/memory-search', wrap(async (req, res) => {
    const kind = req.query.kind, q = String(req.query.q || '').trim();
    if (!['experience', 'knowledge'].includes(kind)) return res.status(400).json({ error: 'Choose experiences or knowledge' });
    if (!q || q.length > 300) return res.status(400).json({ error: 'Enter between 1 and 300 characters to search' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '5s'");
      const document = kind === 'experience' ? 'content' : 'concept';
      const fields = kind === 'experience'
        ? 'id, timestamp, event_type, content, active_app, user_presence, consolidation_status'
        : 'id, created_at, concept, category, source_type, source_episodes, confidence';
      const table = kind === 'experience' ? 'episodic_memory' : 'semantic_memory';
      const { rows } = await client.query(`SELECT ${fields} FROM ${table}
        WHERE to_tsvector('simple', ${document}) @@ plainto_tsquery('simple', $1)
        ORDER BY ts_rank_cd(to_tsvector('simple', ${document}), plainto_tsquery('simple', $1)) DESC, id DESC LIMIT 20`, [q]);
      await client.query('COMMIT');
      res.json({ results: rows, query: q, retrieval: 'word_search', limit: 20,
        note: 'Matching recorded words, newest first within relevance. This is not semantic similarity or independent verification. Showing up to 20 matches.' });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
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
        ? `SELECT ${episodeColumns} FROM episodic_memory WHERE id=$1`
        : 'SELECT id, created_at, updated_at, concept, category, source_type, source_episodes, confidence, evidence_count, contradiction_count FROM semantic_memory WHERE id=$1', [recordId]);
      if (!record) {
        await client.query('COMMIT');
        return res.status(404).json({ error: 'Original memory record is no longer available. The search result may be stale.' });
      }
      let sources = [], missingSourceIds = [], evidence = [], evidenceTotal = 0;
      const allSourceIds = [...new Set((record.source_episodes || []).filter(n => Number.isSafeInteger(n) && n > 0))];
      const sourceIds = allSourceIds.slice(0, 30);
      if (kind === 'knowledge') {
        if (sourceIds.length) {
          ({ rows: sources } = await client.query(`SELECT ${episodeColumns} FROM episodic_memory WHERE id=ANY($1::int[]) ORDER BY timestamp, id`, [sourceIds]));
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
