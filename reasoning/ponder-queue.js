// Durable wants and scoped inquiries. A lease fences checkpoint writes after a crash.
// Pondering prepares a reviewable answer; only observed outcomes can satiate the want.
import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { normalizeEvidence, currentEvidence } from './loop.js';
import { defaultTimeBudgetSeconds } from './budget.js';
import { createWant, appetite, recordAttempt, recordOutcome, repriceWant } from '../motivation/hunger.js';
import { strategyFor, budgetFor, eligibleStrategies } from './strategies.js';
import { CAPABILITY_OF } from '../motivation/risk.js';

const slug = text => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

// `worth` is the ledger (optional). Without it, wants keep their explicit priority as value.
// `affect` (optional) is the emotion engine: frustration shortens strategy patience, fear raises the
// confidence a conclusion must reach, and observed progress on a want is felt.
// `strategies` are the runtime dependencies strategies may use (llm, hypothesis, simulate, writeArtifact, provider,
// model); `risk` is the risk journal that appraises each attempt. Without them only the reasoner strategy is available.
export function createPonderQueue({ pool, reason, clock = Date.now, worth = null, affect = null, strategies = {}, risk = null }) {
  const strategyDeps = { reason, ...strategies };
  const patience = () => { try { return affect?.strategyPatience?.() ?? 3; } catch { return 3; } };
  const rotationFor = state => eligibleStrategies(strategyDeps, state).map(s => s.name);
  const snapshot = row => row ? { chain_id: row.id, seed: row.seed, status: row.status, depth: row.depth,
    updated_at: row.updated_at, ...row.ponder_state, hunger: appetite(row.ponder_state?.want, clock(), { patience: patience(), strategies: rotationFor(row.ponder_state) }) } : null;
  // Live pricing: one ledger read for every stake named by the given rows, then a pure re-price.
  async function reprice(rows) {
    if (!worth) return rows;
    const keys = [...new Set(rows.flatMap(r => (r.ponder_state?.want?.stakes || []).map(s => s.entityKey)))];
    if (!keys.length) return rows;
    const { rows: states } = await pool.query('SELECT key, state FROM worth_entities WHERE key = ANY($1)', [keys]);
    const byKey = new Map(states.map(r => [r.key, r.state]));
    // The stored state stays on the row: claims compare-and-swap against what is in the database,
    // while ordering and the run itself use the live price.
    return rows.map(r => r.ponder_state?.want?.stakes
      ? { ...r, stored_state: r.stored_state || r.ponder_state, ponder_state: { ...r.ponder_state, want: repriceWant(r.ponder_state.want, k => byKey.get(k) || null, clock()) } } : r);
  }
  async function get(id, client = pool) {
    const { rows } = await client.query('SELECT * FROM thought_chains WHERE id = $1 AND ponder_state IS NOT NULL', [id]);
    return snapshot((await reprice(rows))[0]);
  }
  // Worth signals are best-effort side effects of observed events; a ledger error never blocks the want.
  async function signal(input) {
    if (!worth) return null;
    try { return await worth.record(input); }
    catch (e) { console.warn('[ponder] worth signal not recorded:', e.message); return { rejected: e.message }; }
  }
  async function enqueue({ seed, context = '', evidence = [], priority = 0.7, doneWhen, topic = '', learning = true,
    maxPasses = 3, timeBudgetSeconds = defaultTimeBudgetSeconds, clientRequestId = null, stakes = null, continuous = false } = {}, { client = pool, origin = { kind: 'explicit' } } = {}) {
    if (typeof seed !== 'string' || !seed.trim() || seed.length > 12000) throw new Error('seed must be a non-empty string of at most 12000 characters');
    if (typeof context !== 'string' || context.length > 20000) throw new Error('context must be a string of at most 20000 characters');
    if (typeof topic !== 'string' || topic.length > 160) throw new Error('topic must be a string of at most 160 characters');
    if (typeof learning !== 'boolean') throw new Error('learning must be a boolean');
    if (!Number.isInteger(maxPasses) || maxPasses < 2 || maxPasses > 8) throw new Error('maxPasses must be in [2, 8]');
    if (!Number.isFinite(timeBudgetSeconds) || timeBudgetSeconds <= 0 || timeBudgetSeconds > 180) throw new Error('timeBudgetSeconds must be in (0, 180]');
    // What this want is for: its own outcome, the named project (from the topic), and any stakes the caller declares.
    const outcomeKey = worth ? `outcome:ponder-${randomUUID()}` : null;
    const declared = worth ? [{ entityKey: outcomeKey, share: 1 }, ...(slug(topic) ? [{ entityKey: `project:${slug(topic)}`, share: 1 }] : []),
      ...(Array.isArray(stakes) ? stakes : [])].filter((s, i, all) => all.findIndex(x => x?.entityKey === s?.entityKey) === i) : null;
    let want = createWant({ description: seed, doneWhen: doneWhen || 'An observed outcome satisfies this request; a proposal alone is not completion.',
      value: priority, stakes: declared, outcomeKey, now: clock() });
    if (worth) {
      // A person asking for this is a grounded rating of its outcome. The engine asking itself is not.
      if (origin.kind === 'explicit') {
        await signal({ id: `request:${outcomeKey}`, entityKey: outcomeKey, kind: 'rated', rating: 1, by: origin.by || 'quinn', about: seed.slice(0, 500) });
        if (priority !== 0.7) await signal({ id: `request-priority:${outcomeKey}`, entityKey: outcomeKey, kind: 'prior', worth: priority, weight: 4, reason: 'Priority stated with the request.' });
      }
      want = (await reprice([{ ponder_state: { want } }]))[0].ponder_state.want;
    }
    const state = { version: 1, context, topic: topic.trim(), learning, origin, evidence: normalizeEvidence(evidence), maxPasses, timeBudgetSeconds,
      checkpoint: null, result: null, attempts: 0, want, createdAt: clock(), priorRuns: [], continuous: continuous === true };
    if (clientRequestId !== null) {
      if (typeof clientRequestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(clientRequestId)) throw new Error('Invalid client request ID');
      state.clientRequestId = clientRequestId;
      // Stakes join the fingerprint only when supplied, so requests saved before stakes existed still match on retry.
      state.inputFingerprint = createHash('sha256').update(JSON.stringify({seed, context, topic:state.topic, learning, evidence:state.evidence, maxPasses, timeBudgetSeconds, priority, doneWhen:want.doneWhen,
        ...(Array.isArray(stakes) ? { stakes } : {})})).digest('hex');
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
  // A continuous want is never left idle: while it waits on evidence, the engine keeps a research
  // slice working on it (see pursuit-work.keepWorking). A person turns it on or off.
  async function setContinuous(id, on) {
    const { rowCount } = await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{continuous}', $2::jsonb), updated_at = NOW()
      WHERE id = $1 AND ponder_state IS NOT NULL`, [id, JSON.stringify(on === true)]);
    if (!rowCount) throw new Error('ponder chain not found');
    return get(id);
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
    const priced = await reprice(rows);
    const pat = patience();
    priced.sort((a, b) => Number(a.ponder_state.origin?.kind === 'interest') - Number(b.ponder_state.origin?.kind === 'interest')
      || appetite(b.ponder_state.want, clock(), { patience: pat }).pressure - appetite(a.ponder_state.want, clock(), { patience: pat }).pressure || a.id - b.id);
    for (const row of priced) {
      if (row.ponder_state.origin?.kind === 'interest') {
        const parent = await get(row.ponder_state.origin.parentChainId);
        if (!parent || parent.want.status !== 'active') { await cancel(row.id); continue; }
      }
      const lease = randomUUID();
      // `attempts` counts claims since the evidence last changed (deadline retries are capped on it in SQL);
      // `unfinishedClaims` counts claims that never saved a result — the crash loop guard.
      // `claimSeq` never rewinds (a held attempt rolls `attempts` back), so every appraisal and every
      // artifact of this chain gets a fresh identity and a held strategy is re-appraised next time.
      let state = { ...row.ponder_state, lease, leaseUntil: clock() + 240000, attempts: row.ponder_state.attempts + 1,
        claimSeq: (row.ponder_state.claimSeq || 0) + 1, unfinishedClaims: (row.ponder_state.unfinishedClaims || 0) + 1 };
      const claimed = await pool.query(
        `UPDATE thought_chains SET status = 'running', ponder_state = $1::jsonb, updated_at = NOW()
         WHERE id = $2 AND ponder_state = $3::jsonb AND
         (status = 'pondering' OR status = 'budget' OR (status = 'running' AND (ponder_state->>'leaseUntil')::float8 < $4)) RETURNING id`,
        [JSON.stringify(state), row.id, JSON.stringify(row.stored_state || row.ponder_state), clock()]);
      if (!claimed.rowCount) continue;
      if (state.unfinishedClaims > 3) {
        state.result = { status: 'failed', error: 'Crash/retry budget exhausted; inspect the chain before resuming.' };
        await save(row.id, lease, { ...state, unfinishedClaims: 0 }, 'failed'); return get(row.id);
      }
      try {
        const motivation = appetite(state.want, clock(), { patience: pat, strategies: rotationFor(state) });
        let minConfidence = 0.55;
        try { minConfidence = affect?.verificationThreshold?.(0.55) ?? 0.55; } catch {}
        // Which strategy this attempt spends its budget on, and whether the engine may run it.
        const strategy = strategyFor(state.want, strategyDeps, state);
        const budget = budgetFor(motivation, { timeBudgetSeconds: state.timeBudgetSeconds, maxPasses: state.maxPasses });
        let gate = null;
        if (risk) {
          try {
            // A self-build edit touches the engine's own project; the person's phase permission is its switch.
            const selfBuild = strategy.kind === 'self_build';
            const permitted = selfBuild ? (await strategyDeps.selfBuild.permitted()).enabled : undefined;
            // What the engine expects of this step is its record on this strategy, not a constant.
            let record = null;
            if (risk.trackRecord) record = await risk.trackRecord({ strategy: strategy.name, capability: CAPABILITY_OF[strategy.actionKind] }).catch(() => null);
            gate = await risk.decide({ id: `strategy:${row.id}:${state.claimSeq}:${strategy.name}`, chainId: row.id, kind: strategy.actionKind, firedBy: 'engine',
              description: `${strategy.name} for want #${row.id}: ${strategy.describe(state.want)}`, serves: state.want.stakes || [],
              touches: selfBuild ? ['project:oca-engine'] : [], reversibility: strategy.reversibility, pSuccess: record?.pSuccess ?? null },
              selfBuild ? { controls: { autonomousActions: permitted } } : {});
          } catch (e) { console.warn('[ponder] strategy appraisal unavailable:', e.message); }
        }
        if (gate && gate.decision !== 'proceed') {
          // Not allowed this time: rotate to the next strategy without counting a failure, keep the row pending.
          state = { ...state, want: recordAttempt(state.want, { result: 'blocked', now: clock() }), attempts: state.attempts - 1, unfinishedClaims: 0,
            lastStrategy: { name: strategy.name, decision: gate.decision, reasons: gate.reasons, at: clock() } };
          await save(row.id, lease, { ...state, lease: null, leaseUntil: 0 }, 'pondering');
          console.log(`[ponder] ${gate.decision} ${strategy.name} for want #${row.id}; rotating`);
          return get(row.id);
        }
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
        const reasonOptions = { context: header + taskContext, minConfidence,
          evidence: selectedEvidence, maxPasses: budget.maxPasses, timeBudgetSeconds: budget.timeBudgetSeconds,
          checkpoint: state.checkpoint,
          onCheckpoint: async checkpoint => { state = { ...state, checkpoint }; await save(row.id, lease, state); } };
        const result = await strategy.run({ chain: { chain_id: row.id, seed: row.seed }, want: state.want, motivation, state, evidence: current,
          budget, reasonOptions, deps: strategyDeps, clock });
        // Observations a strategy produced join the want's evidence (never rewriting an existing id).
        let evidence = state.evidence;
        for (const e of normalizeEvidence(result.evidence || [])) if (!evidence.some(x => x.id === e.id)) evidence = [...evidence, e];
        const commitments = result.commitment ? [...(state.commitments || []), { ...result.commitment, strategy: strategy.name, attempt: state.attempts, at: clock() }] : state.commitments;
        state = { ...state, evidence, commitments, result: { ...result, strategy: strategy.name, budget, evidenceCoverage: coverage, contextTruncated: taskContext.length < state.context.length },
          checkpoint: result.checkpoint ?? null, lastStrategy: { name: strategy.name, decision: 'proceed', status: result.status, at: clock() },
          want: recordAttempt(state.want, { result: result.status === 'budget' && result.stopReason === 'deadline' && result.checkpoint?.draft ? 'interrupted' : result.status, now: clock() }) };
        if (gate) risk.observe(gate.id, { result: ['stalled', 'budget', 'failed'].includes(result.status) ? 'failure' : 'success',
          evidence: [{ id: `${gate.id}:run`, source: 'ponder runtime status', observation: `${strategy.name} ended ${result.status}${result.stopReason ? ` (${result.stopReason})` : ''}${result.error ? `: ${String(result.error).slice(0, 200)}` : ''}` }] }).catch(() => {});
        let status = ({ converged: 'ready', needs_evidence: 'awaiting_evidence', stalled: 'stalled', budget: 'budget', failed: 'failed' })[result.status] || 'failed';
        // A stall rotates the strategy, and a different strategy is a different attempt, not repetition:
        // the want stays claimable until every strategy has stalled on the same evidence.
        const rotating = ['stalled', 'failed'].includes(result.status);   // budget keeps its retry contract
        const stallStreak = rotating ? (state.stallStreak || 0) + 1 : ['needs_evidence', 'converged'].includes(result.status) ? 0 : (state.stallStreak || 0);
        state = { ...state, stallStreak, unfinishedClaims: 0 };
        // A full rotation is one attempt per strategy this want can use; only then does it wait for evidence.
        if (rotating && stallStreak < eligibleStrategies(strategyDeps, state).length) status = 'pondering';
        await save(row.id, lease, state, status);
        // The reasoner ran and did not get there: an observed failure of the engine's own pondering.
        // Converging is not a success (a plan satiates nothing); a transport failure is not a failure of thought.
        if (['stalled', 'budget'].includes(result.status)) {
          await signal({ id: `attempt:${row.id}:${state.attempts}:${result.status}`, entityKey: 'self:ponder', kind: 'observed', outcome: 'failure',
            about: `chain ${row.id} attempt ${state.attempts}`, evidence: [{ id: `attempt-${row.id}-${state.attempts}`, source: 'ponder runtime status',
              observation: `Attempt ${state.attempts} ended ${result.status} (${result.stopReason || 'no stop reason'}) after ${result.checkpoint?.passes?.length || 0} passes.` }] });
        }
        return get(row.id);
      } catch (e) {
        if (e.code === 'LEASE_LOST') return get(row.id);
        state = { ...state, unfinishedClaims: 0, result: { status: 'failed', error: e.message },
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
      return { status: 'pondering', state: { ...s, evidence: merged, checkpoint: null, attempts: 0, stallStreak: 0,
        priorRuns: [...s.priorRuns, { checkpoint: s.checkpoint, result: s.result, at: clock() }] } };
    }, { guard });
  }
  async function retry(id) {
    return mutate(id, row => {
      const s = row.ponder_state;
      if (row.status === 'pondering') return { status: row.status, state: s };   // already queued (a rotation kept it claimable)
      if (!['failed', 'budget'].includes(row.status)) throw new Error('only an interrupted or failed attempt can retry unchanged evidence');
      if (s.attempts >= 3 || (s.checkpoint?.passes?.length || 0) >= s.maxPasses) throw new Error('attempt/pass budget exhausted; supply new evidence or rescope');
      return { status: 'pondering', state: s };
    });
  }
  // `park`: the receipt is progress noted while the world still owes the rest (a merge awaiting its quiet
  // period); the want keeps its evidence but waits instead of pondering again.
  async function outcome(id, receipt, { park = false } = {}) {
    const before = await get(id);
    if (!before) throw new Error('ponder chain not found');
    const chain = await mutate(id, row => {
      const want = recordOutcome(row.ponder_state.want, { ...receipt, now: clock() });
      const s = row.ponder_state;
      if (want.status === 'sated') return { status: 'resolved', state: { ...s, want } };
      // Observed progress is new evidence about the situation: it joins the want's evidence and reopens pondering.
      const saved = want.receipts.find(r => r.receiptId === receipt.receiptId);
      const fresh = saved && !s.want.receipts.some(r => r.receiptId === saved.receiptId);
      if (!fresh) return { status: row.status === 'resolved' ? 'ready' : row.status, state: { ...s, want } };
      let evidence = s.evidence;
      for (const e of saved.evidence) {
        const item = { ...e, id: evidence.some(x => x.id === e.id && !isDeepStrictEqual(x, e)) ? `receipt-${saved.receiptId}-${e.id}`.slice(0, 100) : e.id };
        if (!evidence.some(x => x.id === item.id)) evidence = [...evidence, item];
      }
      // A correction to a resolved want leaves its reviewable answer standing ('ready'); anything still open reponders.
      if (row.status === 'resolved') return { status: 'ready', state: { ...s, want, evidence } };
      if (park) return { status: 'awaiting_evidence', state: { ...s, want, evidence, checkpoint: null, attempts: 0, stallStreak: 0 } };
      return { status: 'pondering', state: { ...s, want, evidence, checkpoint: null, attempts: 0, stallStreak: 0,
        priorRuns: [...s.priorRuns, { checkpoint: s.checkpoint, result: s.result, at: clock() }] } };
    });
    const saved = chain.want.receipts.find(r => r.receiptId === receipt.receiptId);
    // A real outcome scores the predictions the engine committed to for this want (A7: prediction vs baseline).
    if (saved && !before.want.receipts.some(r => r.receiptId === saved.receiptId) && strategyDeps.evaluateSimulation) {
      for (const c of (chain.commitments || []).filter(c => c.kind === 'simulation' && !c.scoredBy)) {
        try {
          const score = await strategyDeps.evaluateSimulation(c.id, saved.evidence.map(e => e.observation).join(' | ').slice(0, 2000));
          await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{commitments}', $2::jsonb) WHERE id = $1`,
            [id, JSON.stringify((chain.commitments || []).map(x => x === c ? { ...x, scoredBy: saved.receiptId, accuracy: score?.accuracy ?? null } : x))]);
        } catch (e) { console.warn('[ponder] simulation scoring:', e.message); }
      }
    }
    if (saved && !before.want.receipts.some(r => r.receiptId === saved.receiptId)) {
      try { affect?.feelProgress?.({ value: chain.want.value, progressDelta: Math.max(0, saved.progress - (before.want.progress || 0)),
        sated: chain.want.status === 'sated', usefulness: Number.isFinite(saved.usefulness) ? saved.usefulness : null }); } catch {}
    }
    if (worth && saved && chain.want.stakes) {
      // Progress feeds hunger. Observed usefulness feeds worth: of the outcome, of what it was for,
      // and of the engine's own pondering. Idempotent per receipt and entity.
      const targets = [...new Set([chain.want.outcomeKey, ...chain.want.stakes.map(s => s.entityKey), 'self:ponder'].filter(Boolean))];
      const worthSignals = [];
      for (const entityKey of targets) {
        if (Number.isFinite(saved.usefulness)) {
          worthSignals.push(await signal({ id: `receipt:${id}:${saved.receiptId}:usefulness:${entityKey}`, entityKey, kind: 'observed', outcome: 'progress',
            progress: saved.usefulness, about: `chain ${id} receipt ${saved.receiptId}`, evidence: saved.evidence }));
        } else if (saved.criterionMet && entityKey === 'self:ponder') {
          worthSignals.push(await signal({ id: `receipt:${id}:${saved.receiptId}:sated:${entityKey}`, entityKey, kind: 'observed', outcome: 'success',
            about: `chain ${id} satisfied by receipt ${saved.receiptId}`, evidence: saved.evidence }));
        }
      }
      return { ...chain, worthSignals: worthSignals.filter(Boolean).map(r => r.rejected ? { rejected: r.rejected } : { id: r.signal.id, duplicate: r.duplicate }) };
    }
    return chain;
  }
  async function cancel(id) {
    return mutate(id, row => ({ status: 'cancelled', state: { ...row.ponder_state, lease: randomUUID(), want: { ...row.ponder_state.want, status: 'cancelled' } } }), { allowRunning: true });
  }
  // A committed prediction was settled by an observation: the result is evidence on the want, and the
  // commitment is marked so it cannot feed twice. Unverifiable evaluations add nothing.
  async function settlePrediction({ id, status, confirmed, evaluation, modelUpdate }) {
    const { rows } = await pool.query(`SELECT id, ponder_state FROM thought_chains WHERE ponder_state IS NOT NULL
      AND ponder_state #>> '{want,status}' = 'active' AND ponder_state -> 'commitments' @> $1::jsonb LIMIT 1`,
      [JSON.stringify([{ kind: 'hypothesis', id: Number(id) }])]);
    const row = rows[0]; if (!row) return null;
    const commitment = (row.ponder_state.commitments || []).find(c => c.kind === 'hypothesis' && Number(c.id) === Number(id));
    if (!commitment || commitment.settled) return null;
    const settled = (row.ponder_state.commitments || []).map(c => c === commitment ? { ...c, settled: status, confirmed, at: clock() } : c);
    await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{commitments}', $2::jsonb) WHERE id = $1`, [row.id, JSON.stringify(settled)]);
    if (!evaluation?.verifiable) {
      // No evidence about the world — but a want parked on a prediction nobody could judge is parked on nothing.
      // It re-ponders on the next strategy with the unjudged prediction on its record, instead of waiting forever.
      const note = `prediction #${id} ${status} unevaluated: ${String(evaluation?.reason || 'its metric was never observed').slice(0, 300)}`;
      const reopened = await mutate(row.id, r => r.status !== 'awaiting_evidence' ? { status: r.status, state: r.ponder_state }
        : { status: 'pondering', state: { ...r.ponder_state, checkpoint: null, attempts: 0, stallStreak: 0,
            want: { ...r.ponder_state.want, strategy: (r.ponder_state.want.strategy || 0) + 1 },
            priorRuns: [...(r.ponder_state.priorRuns || []), { checkpoint: r.ponder_state.checkpoint, result: { status: 'failed', error: note }, at: clock() }] } })
        .then(c => c.status === 'pondering', () => false);
      return { chain_id: row.id, added: false, status, reopened };
    }
    const observation = `Prediction #${id} ${confirmed ? 'held' : 'failed'}: ${String(evaluation.reason || modelUpdate || '').slice(0, 600)}`;
    try {
      await addEvidence(row.id, [{ id: `prediction-${id}`, source: 'structured hypothesis evaluation against an observed metric', observation }]);
      return { chain_id: row.id, added: true, confirmed };
    } catch (e) { return { chain_id: row.id, added: false, error: e.message }; }
  }

  // Wants saved before stakes existed get an outcome entity so they can be priced. An explicit request
  // was a grounded rating by the person who asked; a child inherits its parent's stakes. Idempotent.
  async function adoptLegacyWants() {
    if (!worth) return { adopted: 0 };
    const { rows } = await pool.query(`SELECT id, seed, priority, ponder_state FROM thought_chains WHERE ponder_state IS NOT NULL
      AND ponder_state #>> '{want,status}' = 'active' AND ponder_state #> '{want,stakes}' IS NULL ORDER BY id`);
    let adopted = 0;
    for (const row of rows.sort((a, b) => (a.ponder_state.origin?.kind === 'interest') - (b.ponder_state.origin?.kind === 'interest'))) {
      const state = row.ponder_state, origin = state.origin || { kind: 'explicit' };
      const outcomeKey = `outcome:ponder-legacy-${row.id}`;
      let stakes = [{ entityKey: outcomeKey, share: 1 }];
      if (slug(state.topic)) stakes.push({ entityKey: `project:${slug(state.topic)}`, share: 1 });
      if (origin.kind === 'interest' && origin.parentChainId) {
        const parent = await get(origin.parentChainId);
        for (const st of parent?.want?.stakes || []) if (!stakes.some(x => x.entityKey === st.entityKey)) stakes.push({ ...st });
      } else {
        await signal({ id: `request:${outcomeKey}`, entityKey: outcomeKey, kind: 'rated', rating: 1, by: origin.by || 'quinn', about: row.seed.slice(0, 500) });
        if (Number.isFinite(row.priority) && row.priority !== 0.7) {
          await signal({ id: `request-priority:${outcomeKey}`, entityKey: outcomeKey, kind: 'prior', worth: row.priority, weight: 4, reason: 'Priority stated with the request.' });
        }
      }
      const want = { ...state.want, version: 2, outcomeKey, stakes, pricing: { value: state.want.value, provenance: 'priority', unpriced: true } };
      const { rowCount } = await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{want}', $2::jsonb), updated_at = NOW()
        WHERE id = $1 AND ponder_state #> '{want,stakes}' IS NULL`, [row.id, JSON.stringify(want)]);
      adopted += rowCount;
    }
    // Wants that stalled before strategies existed stalled on one strategy only: under rotation they are claimable.
    const { rowCount: reopened } = await pool.query(`UPDATE thought_chains SET status = 'pondering',
      ponder_state = ponder_state || '{"stallStreak": 1}'::jsonb, updated_at = NOW()
      WHERE ponder_state IS NOT NULL AND status = 'stalled' AND ponder_state #>> '{want,status}' = 'active' AND ponder_state -> 'stallStreak' IS NULL`);
    return { adopted, reopened };
  }
  async function hunger() {
    const { rows } = await pool.query(`SELECT * FROM thought_chains WHERE ponder_state IS NOT NULL
      AND ponder_state #>> '{want,status}' = 'active' ORDER BY priority DESC, id LIMIT 100`);
    const wants = (await reprice(rows)).map(snapshot).sort((a, b) => b.hunger.pressure - a.hunger.pressure);
    return { wants, pressure: wants[0]?.hunger.pressure || 0, selected: wants[0]?.chain_id || null,
      pricing: worth ? 'live_from_worth_ledger' : 'explicit_priority' };
  }
  return { enqueue, get, findRequest, runNext, addEvidence, retry, outcome, cancel, hunger, adoptLegacyWants, settlePrediction, setContinuous };
}
