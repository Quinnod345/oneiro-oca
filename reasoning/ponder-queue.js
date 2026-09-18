// Durable wants and scoped inquiries. A lease fences checkpoint writes after a crash.
// Pondering prepares a reviewable answer; only observed outcomes can satiate the want.
import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { normalizeEvidence, currentEvidence } from './loop.js';
import { defaultTimeBudgetSeconds } from './budget.js';
import { createWant, appetite, recordAttempt, recordOutcome } from '../motivation/hunger.js';

export function createPonderQueue({ pool, reason, clock = Date.now }) {
  const snapshot = row => row ? { chain_id: row.id, seed: row.seed, status: row.status, depth: row.depth,
    updated_at: row.updated_at, ...row.ponder_state, hunger: appetite(row.ponder_state?.want, clock()) } : null;
  async function get(id, client = pool) {
    const { rows } = await client.query('SELECT * FROM thought_chains WHERE id = $1 AND ponder_state IS NOT NULL', [id]);
    return snapshot(rows[0]);
  }
  async function enqueue({ seed, context = '', evidence = [], priority = 0.7, doneWhen, topic = '', learning = true,
    maxPasses = 3, timeBudgetSeconds = defaultTimeBudgetSeconds, clientRequestId = null } = {}, { client = pool, origin = { kind: 'explicit' } } = {}) {
    if (typeof seed !== 'string' || !seed.trim() || seed.length > 12000) throw new Error('seed must be a non-empty string of at most 12000 characters');
    if (typeof context !== 'string' || context.length > 20000) throw new Error('context must be a string of at most 20000 characters');
    if (typeof topic !== 'string' || topic.length > 160) throw new Error('topic must be a string of at most 160 characters');
    if (typeof learning !== 'boolean') throw new Error('learning must be a boolean');
    if (!Number.isInteger(maxPasses) || maxPasses < 2 || maxPasses > 8) throw new Error('maxPasses must be in [2, 8]');
    if (!Number.isFinite(timeBudgetSeconds) || timeBudgetSeconds <= 0 || timeBudgetSeconds > 180) throw new Error('timeBudgetSeconds must be in (0, 180]');
    const want = createWant({ description: seed, doneWhen: doneWhen || 'An observed outcome satisfies this request; a proposal alone is not completion.', value: priority, now: clock() });
    const state = { version: 1, context, topic: topic.trim(), learning, origin, evidence: normalizeEvidence(evidence), maxPasses, timeBudgetSeconds,
      checkpoint: null, result: null, attempts: 0, want, createdAt: clock(), priorRuns: [] };
    if (clientRequestId !== null) {
      if (typeof clientRequestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(clientRequestId)) throw new Error('Invalid client request ID');
      state.clientRequestId = clientRequestId;
      state.inputFingerprint = createHash('sha256').update(JSON.stringify({seed, context, topic:state.topic, learning, evidence:state.evidence, maxPasses, timeBudgetSeconds, priority, doneWhen:want.doneWhen})).digest('hex');
    }
    const { rows } = await client.query(
      `INSERT INTO thought_chains (seed, priority, status, ponder_state) VALUES ($1,$2,'pondering',$3::jsonb) ${clientRequestId ? "ON CONFLICT ((ponder_state->>'clientRequestId')) WHERE ponder_state->>'clientRequestId' IS NOT NULL DO NOTHING" : ''} RETURNING *`,
      [seed, priority, JSON.stringify(state)]);
    if (!rows[0] && clientRequestId) {
      const { rows: existing } = await client.query("SELECT * FROM thought_chains WHERE ponder_state->>'clientRequestId'=$1", [clientRequestId]);
      if (existing[0]?.ponder_state.inputFingerprint !== state.inputFingerprint) throw new Error('An earlier version of this request is already saved. Open it from Pursuits before starting a different one.');
      return snapshot(existing[0]);
    }
    return snapshot(rows[0]);
  }
  async function findRequest(clientRequestId) {
    const { rows } = await pool.query("SELECT * FROM thought_chains WHERE ponder_state->>'clientRequestId'=$1", [clientRequestId]);
    return snapshot(rows[0]);
  }
  async function save(id, lease, state, status = 'running') {
    const { rowCount } = await pool.query(
      `UPDATE thought_chains SET ponder_state = $1::jsonb, status = $2,
         depth = $3, updated_at = NOW() WHERE id = $4 AND ponder_state->>'lease' = $5`,
      [JSON.stringify(state), status, state.checkpoint?.passes?.length || 0, id, lease]);
    if (!rowCount) throw Object.assign(new Error('ponder lease lost; stale result was not committed'), { code: 'LEASE_LOST' });
  }
  async function runNext(id = null) {
    // SQL selects only pending work or expired claims. CAS below resolves racing workers.
    const { rows } = await pool.query(
      `SELECT * FROM thought_chains WHERE ponder_state IS NOT NULL AND NOT COALESCE((ponder_state->>'researchActive')::boolean,false) AND
       (status = 'pondering' OR (status = 'running' AND (ponder_state->>'leaseUntil')::float8 < $1)
        OR (status = 'budget' AND ponder_state #>> '{result,stopReason}' = 'deadline'
          AND (ponder_state->>'attempts')::int < 3
          AND jsonb_array_length(COALESCE(ponder_state #> '{checkpoint,passes}', '[]'::jsonb)) < (ponder_state->>'maxPasses')::int
          AND (jsonb_typeof(ponder_state #> '{checkpoint,draft}') = 'object'
            OR jsonb_array_length(COALESCE(ponder_state #> '{checkpoint,passes}', '[]'::jsonb)) > 0)))
       AND ($2::int IS NULL OR id = $2)
       ORDER BY (COALESCE(ponder_state #>> '{origin,kind}', 'explicit') = 'interest'), priority DESC, created_at ASC LIMIT 100`, [clock(), id]);
    rows.sort((a, b) => Number(a.ponder_state.origin?.kind === 'interest') - Number(b.ponder_state.origin?.kind === 'interest')
      || appetite(b.ponder_state.want, clock()).pressure - appetite(a.ponder_state.want, clock()).pressure || a.id - b.id);
    for (const row of rows) {
      if (row.ponder_state.origin?.kind === 'interest') {
        const parent = await get(row.ponder_state.origin.parentChainId);
        if (!parent || parent.want.status !== 'active') { await cancel(row.id); continue; }
      }
      const lease = randomUUID();
      let state = { ...row.ponder_state, lease, leaseUntil: clock() + 240000, attempts: row.ponder_state.attempts + 1 };
      const claimed = await pool.query(
        `UPDATE thought_chains SET status = 'running', ponder_state = $1::jsonb, updated_at = NOW()
         WHERE id = $2 AND ponder_state = $3::jsonb AND
         (status = 'pondering' OR status = 'budget' OR (status = 'running' AND (ponder_state->>'leaseUntil')::float8 < $4)) RETURNING id`,
        [JSON.stringify(state), row.id, JSON.stringify(row.ponder_state), clock()]);
      if (!claimed.rowCount) continue;
      if (state.attempts > 3) {
        state.result = { status: 'failed', error: 'Crash/retry budget exhausted; inspect the chain before resuming.' };
        await save(row.id, lease, state, 'failed'); return get(row.id);
      }
      try {
        const motivation = appetite(state.want, clock());
        // Keep motivational context inside the reasoner's 24k contract even for large requests.
        const { description: _description, doneWhen, ...pressure } = motivation;
        const prior = state.result ? { conclusion: String(state.result.conclusion || '').slice(0, 1000),
          missingEvidence: (state.result.missingEvidence || []).slice(0, 6).map(x => String(x).slice(0, 200)) } : null;
        const header = `Motivation: ${JSON.stringify({ ...pressure, doneWhen: doneWhen?.slice(0, 1000) })}\nPrevious outcome: ${JSON.stringify(prior)}\n`;
        const current = currentEvidence(state.evidence, { maxItems: Infinity });
        const selectedEvidence = current.slice(-64);
        const coverage = { total: state.evidence.length, current: current.length, reviewed: selectedEvidence.length,
          omitted: Math.max(0, current.length - selectedEvidence.length) };
        const coverageNote = coverage.omitted ? `Evidence coverage: only the newest ${coverage.reviewed} of ${coverage.current} current observations are in this review. Older observations remain in the saved pursuit; do not imply exhaustive review. Research work can inspect the complete pursuit.json.\n` : '';
        const taskContext = coverageNote + state.context.slice(0, Math.max(0, 24000 - header.length - coverageNote.length));
        const result = await reason(row.seed, { context: header + taskContext,
          evidence: selectedEvidence, maxPasses: state.maxPasses, timeBudgetSeconds: state.timeBudgetSeconds,
          checkpoint: state.checkpoint,
          onCheckpoint: async checkpoint => { state = { ...state, checkpoint }; await save(row.id, lease, state); } });
        state = { ...state, result: { ...result, evidenceCoverage: coverage, contextTruncated: taskContext.length < state.context.length }, checkpoint: result.checkpoint,
          want: recordAttempt(state.want, { result: result.status, now: clock() }) };
        const status = ({ converged: 'ready', needs_evidence: 'awaiting_evidence', stalled: 'stalled', budget: 'budget', failed: 'failed' })[result.status] || 'failed';
        await save(row.id, lease, state, status);
        return get(row.id);
      } catch (e) {
        if (e.code === 'LEASE_LOST') return get(row.id);
        state = { ...state, result: { status: 'failed', error: e.message },
          want: recordAttempt(state.want, { result: 'failed', now: clock() }) };
        await save(row.id, lease, state, 'failed');
        return get(row.id);
      }
    }
    return null;
  }
  async function mutate(id, change, { allowRunning = false, guard = null } = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM thought_chains WHERE id = $1 AND ponder_state IS NOT NULL FOR UPDATE', [id]);
      const row = rows[0];
      if (!row) throw new Error('ponder chain not found');
      if (row.status === 'running' && !allowRunning) throw new Error('ponder chain is running; wait for its current pass');
      if (guard) await guard(client);
      const next = change(row);
      await client.query('UPDATE thought_chains SET status = $1, ponder_state = $2::jsonb, updated_at = NOW() WHERE id = $3', [next.status, JSON.stringify(next.state), id]);
      if (['sated', 'cancelled'].includes(next.state.want.status)) {
        // Closing a scope revokes even running investigations and fences their leases.
        await client.query(`UPDATE thought_chains SET status = 'cancelled', updated_at = NOW(),
          ponder_state = jsonb_set(jsonb_set(ponder_state, '{want,status}', '"cancelled"'), '{lease}', to_jsonb($2::text))
          WHERE ponder_state #>> '{origin,kind}' = 'interest'
          AND ponder_state #>> '{origin,parentChainId}' = $1
          AND ponder_state #>> '{want,status}' = 'active'`, [String(id), randomUUID()]);
      }
      await client.query('COMMIT');
      // The mutation still owns this connection until finally. Acquiring a
      // second one here can deadlock acknowledgements when the pool is full.
      return await get(id, client);
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }
  async function addEvidence(id, evidence, { guard = null } = {}) {
    const incoming = normalizeEvidence(evidence);
    if (!incoming.length) throw new Error('supply at least one new observation');
    return mutate(id, row => {
      if (['sated', 'cancelled'].includes(row.ponder_state.want.status)) throw new Error('closed want cannot resume');
      const s = row.ponder_state, merged = [...s.evidence];
      for (const e of incoming) {
        const prior = merged.find(x => x.id === e.id);
        if (prior && !isDeepStrictEqual(prior, e)) throw new Error('an evidence ID cannot be rewritten');
        if (!prior) merged.push(e);
      }
      if (merged.length === s.evidence.length) return { status: row.status, state: s };
      currentEvidence(merged, { maxItems: Infinity });
      return { status: 'pondering', state: { ...s, evidence: merged, checkpoint: null, attempts: 0,
        priorRuns: [...s.priorRuns, { checkpoint: s.checkpoint, result: s.result, at: clock() }] } };
    }, { guard });
  }
  async function retry(id) {
    return mutate(id, row => {
      const s = row.ponder_state;
      if (!['failed', 'budget'].includes(row.status)) throw new Error('only an interrupted or failed attempt can retry unchanged evidence');
      if (s.attempts >= 3 || (s.checkpoint?.passes?.length || 0) >= s.maxPasses) throw new Error('attempt/pass budget exhausted; supply new evidence or rescope');
      return { status: 'pondering', state: s };
    });
  }
  async function outcome(id, receipt) {
    return mutate(id, row => {
      const want = recordOutcome(row.ponder_state.want, { ...receipt, now: clock() });
      return { status: want.status === 'sated' ? 'resolved' : row.status === 'resolved' ? 'ready' : row.status, state: { ...row.ponder_state, want } };
    });
  }
  async function cancel(id) {
    return mutate(id, row => ({ status: 'cancelled', state: { ...row.ponder_state, lease: randomUUID(), want: { ...row.ponder_state.want, status: 'cancelled' } } }), { allowRunning: true });
  }
  async function hunger() {
    const { rows } = await pool.query(`SELECT * FROM thought_chains WHERE ponder_state IS NOT NULL
      AND ponder_state #>> '{want,status}' = 'active' ORDER BY priority DESC, id LIMIT 100`);
    const wants = rows.map(snapshot).sort((a, b) => b.hunger.pressure - a.hunger.pressure);
    return { wants, pressure: wants[0]?.hunger.pressure || 0, selected: wants[0]?.chain_id || null };
  }
  return { enqueue, get, findRequest, runNext, addEvidence, retry, outcome, cancel, hunger };
}
