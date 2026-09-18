// Durable risk decisions. Appraise → journal → observe → calibrate, and every observed outcome
// becomes a grounded signal on the engine's own capability worth.
import { isDeepStrictEqual } from 'node:util';
import { createProposal, appraise, appetiteFrom, calibrate } from './risk.js';

const row = r => r ? { id: r.id, chainId: r.chain_id, capability: r.capability, decision: r.decision, proposal: r.proposal,
  ...r.appraisal, outcome: r.outcome, createdAt: r.created_at, resolvedAt: r.resolved_at } : null;

export function createRiskJournal({ pool, worth = null, clock = Date.now, controls = null, affect = null }) {
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
    const appraisal = appraise(proposal, { lookup, appetite, controls: ctl });
    const { rows } = await pool.query(`INSERT INTO risk_decisions (id, chain_id, capability, decision, proposal, appraisal, created_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7) ON CONFLICT (id) DO NOTHING RETURNING *`,
      [id, chainId, proposal.capability, appraisal.decision, JSON.stringify(proposal), JSON.stringify(appraisal), new Date(clock())]);
    if (!rows[0]) return decide({ id, chainId, ...input }, { controls: controlsOverride });
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
  return { decide, observe, get, recent, status, appetite: currentAppetite };
}
