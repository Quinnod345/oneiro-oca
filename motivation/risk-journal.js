// Durable risk decisions. Appraise → journal → observe → calibrate, and every observed outcome
// becomes a grounded signal on the engine's own capability worth.
import { isDeepStrictEqual } from 'node:util';
import { createProposal, appraise, appetiteFrom, calibrate } from './risk.js';

const row = r => r ? { id: r.id, chainId: r.chain_id, capability: r.capability, decision: r.decision, proposal: r.proposal,
  ...r.appraisal, outcome: r.outcome, createdAt: r.created_at, resolvedAt: r.resolved_at } : null;

export function createRiskJournal({ pool, worth = null, clock = Date.now, controls = null, affect = null, feel = null }) {
  const feelSafe = (fn) => { if (!feel) return; try { fn(feel); } catch {} };
  async function lookupFor(proposal) {
    const keys = [...new Set([...proposal.serves, ...proposal.touches].map(s => s.entityKey).concat(proposal.recipient ? [proposal.recipient] : [], [`self:${proposal.capability}`]))];
    if (!worth || !keys.length) return () => null;
    const { rows } = await pool.query('SELECT key, state FROM worth_entities WHERE key = ANY($1)', [keys]);
    const byKey = new Map(rows.map(r => [r.key, r.state]));
    return key => byKey.get(key) || null;
  }
  async function currentAppetite() {
    const state = typeof affect === 'function' ? await affect() : affect;
    return appetiteFrom(state || {});
  }
  async function currentControls() {
    const c = typeof controls === 'function' ? await controls() : controls;
    return { autonomousActions: c?.autonomousActions === true };
  }

  // Appraise and record. Idempotent on id: the same id with a different proposal is an error.
  async function decide({ id, chainId = null, ...input }, { controls: controlsOverride = null } = {}) {
    if (typeof id !== 'string' || !id.trim() || id.length > 200) throw new Error('a risk decision needs an id');
    const proposal = createProposal(input);
    const { rows: existing } = await pool.query('SELECT * FROM risk_decisions WHERE id = $1', [id]);
    if (existing[0]) {
      if (!isDeepStrictEqual(existing[0].proposal, JSON.parse(JSON.stringify(proposal)))) throw new Error('decision id already names a different proposal');
      return { ...row(existing[0]), duplicate: true };
    }
    const [lookup, { appetite }, ctl] = [await lookupFor(proposal), await currentAppetite(),
      controlsOverride ? { autonomousActions: controlsOverride.autonomousActions === true } : await currentControls()];
    let informationBonus = 0;
    feelSafe(f => { informationBonus = f.informationAppetiteBonus?.() || 0; });
    const appraisal = appraise(proposal, { lookup, appetite, controls: ctl, informationBonus });
    const { rows } = await pool.query(`INSERT INTO risk_decisions (id, chain_id, capability, decision, proposal, appraisal, created_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7) ON CONFLICT (id) DO NOTHING RETURNING *`,
      [id, chainId, proposal.capability, appraisal.decision, JSON.stringify(proposal), JSON.stringify(appraisal), new Date(clock())]);
    if (!rows[0]) return decide({ id, chainId, ...input }, { controls: controlsOverride });
    // Being held back from something worth doing, or not knowing its worth, is felt.
    feelSafe(f => f.feelBlocked?.({ decision: appraisal.decision, expectedGain: appraisal.expected.gain }));
    return { ...row(rows[0]), duplicate: false };
  }

  // Attach what actually happened. Success and failure are track-record signals on the capability;
  // harm additionally lowers the touched entities. Evidence must be grounded or the ledger refuses it.
  async function observe(id, { result, evidence, note = '' }) {
    if (!['success', 'failure', 'harm', 'not_attempted'].includes(result)) throw new Error('result must be success, failure, harm or not_attempted');
    const { rows } = await pool.query(`UPDATE risk_decisions SET outcome = $2::jsonb, resolved_at = $3 WHERE id = $1 AND outcome IS NULL RETURNING *`,
      [id, JSON.stringify({ result, evidence, note: String(note).slice(0, 1000), at: clock() }), new Date(clock())]);
    if (!rows[0]) {
      const { rows: prior } = await pool.query('SELECT * FROM risk_decisions WHERE id = $1', [id]);
      if (!prior[0]) throw new Error('risk decision not found');
      return { ...row(prior[0]), duplicate: true, worthSignals: [] };
    }
    const decision = row(rows[0]);
    feelSafe(f => f.feelOutcome?.({ result, expectedGain: decision.expected?.gain, expectedLoss: decision.expected?.loss, pSuccess: decision.expected?.pSuccess }));
    const worthSignals = [];
    if (worth && result !== 'not_attempted') {
      const record = async input => { try { const r = await worth.record(input); worthSignals.push({ id: r.signal.id, duplicate: r.duplicate }); }
        catch (e) { worthSignals.push({ rejected: e.message }); } };
      await record({ id: `risk:${id}:${decision.capability}`, entityKey: `self:${decision.capability}`, kind: 'observed',
        outcome: result === 'success' ? 'success' : 'failure', about: decision.proposal.description.slice(0, 500), evidence });
      if (result === 'harm') for (const s of decision.proposal.touches) {
        await record({ id: `risk:${id}:harm:${s.entityKey}`, entityKey: s.entityKey, kind: 'observed', outcome: 'failure', about: `harmed by: ${decision.proposal.description.slice(0, 400)}`, evidence });
      }
    }
    return { ...decision, worthSignals };
  }

  async function get(id) {
    const { rows } = await pool.query('SELECT * FROM risk_decisions WHERE id = $1', [id]);
    return row(rows[0]);
  }
  // Self-knowledge that learns. The engine's expected success for a step is its observed record on that
  // kind of step (decision ids end in the strategy's name), shrunk toward the capability's worth while the
  // record is thin. An expectation that moves with the record can beat the base rate; a constant never will.
  async function trackRecord({ strategy, capability, limit = 40, priorWeight = 8 }) {
    if (typeof strategy !== 'string' || !/^[a-z_]{1,64}$/.test(strategy) || typeof capability !== 'string') throw new Error('a track record names a strategy and a capability');
    const { rows } = await pool.query(`SELECT outcome->>'result' AS result FROM risk_decisions
      WHERE capability = $1 AND id LIKE $2 AND decision = 'proceed' AND outcome IS NOT NULL AND outcome->>'result' IN ('success', 'failure', 'harm')
      ORDER BY resolved_at DESC LIMIT $3`, [capability, `%:${strategy}`, limit]);
    const n = rows.length, wins = rows.filter(r => r.result === 'success').length;
    const { rows: self } = await pool.query('SELECT state FROM worth_entities WHERE key = $1', [`self:${capability}`]);
    const prior = Number.isFinite(self[0]?.state?.worth) ? self[0].state.worth : 0.5;
    return { pSuccess: Math.min(0.95, Math.max(0.05, (priorWeight * prior + wins) / (priorWeight + n))), n, wins, prior, strategy, capability };
  }
  async function recent({ limit = 50, chainId = null } = {}) {
    const { rows } = await pool.query(`SELECT * FROM risk_decisions ${chainId !== null ? 'WHERE chain_id = $2' : ''} ORDER BY created_at DESC LIMIT $1`,
      chainId !== null ? [limit, chainId] : [limit]);
    return rows.map(row);
  }
  async function status() {
    const { rows } = await pool.query('SELECT * FROM risk_decisions WHERE outcome IS NOT NULL ORDER BY created_at DESC LIMIT 500');
    const { rows: counts } = await pool.query('SELECT decision, COUNT(*)::int AS n FROM risk_decisions GROUP BY decision');
    const { rows: open } = await pool.query("SELECT COUNT(*)::int AS n FROM risk_decisions WHERE decision = 'proceed' AND outcome IS NULL");
    return { appetite: await currentAppetite(), controls: await currentControls(), decisions: Object.fromEntries(counts.map(c => [c.decision, c.n])),
      awaitingOutcome: open[0].n, calibration: calibrate(rows.map(row)),
      policy: { reversible: 'proceed_within_appetite', irreversible: 'prepare_artifact', constraints: 'boundaries_never_costs', selfWorth: 'observed_outcomes_only' } };
  }
  return { decide, observe, get, recent, status, trackRecord, appetite: currentAppetite };
}
