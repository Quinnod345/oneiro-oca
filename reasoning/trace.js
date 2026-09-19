// The story of a want, assembled from the journals rather than narrated: every attempt with its
// appraisal and outcome, every commitment and how the world settled it, every receipt, every worth
// signal it produced, and the engine's affect at each step. This is the trace the showcase shows.
export function createTrace({ pool }) {
  const num = v => (v === null || v === undefined ? null : Number(v));
  async function affectAt(ts) {
    const { rows } = await pool.query(`SELECT timestamp, valence, arousal, confidence, curiosity, frustration, fear, satisfaction, state_snapshot
      FROM emotional_states WHERE timestamp <= $1 ORDER BY timestamp DESC LIMIT 1`, [ts]);
    const r = rows[0]; if (!r) return null;
    const drives = r.state_snapshot?.drives || {};
    return { at: r.timestamp, valence: num(r.valence), arousal: num(r.arousal), confidence: num(r.confidence), curiosity: num(r.curiosity),
      frustration: num(r.frustration), fear: num(r.fear), joy: num(r.satisfaction),
      drives: Object.fromEntries(Object.entries(drives).map(([k, v]) => [k, num(v?.level)])), selfEfficacy: num(r.state_snapshot?.selfModel?.self_efficacy) };
  }
  async function forChain(chainId) {
    const { rows: [row] } = await pool.query('SELECT id, seed, status, created_at, updated_at, ponder_state FROM thought_chains WHERE id = $1 AND ponder_state IS NOT NULL', [chainId]);
    if (!row) return null;
    const s = row.ponder_state, want = s.want || {};
    const { rows: decisions } = await pool.query('SELECT * FROM risk_decisions WHERE chain_id = $1 ORDER BY created_at', [chainId]);
    const { rows: hyps } = await pool.query(`SELECT id, claim, prediction, confidence, status, prediction_deadline, tested_at, model_update, source_data
      FROM hypotheses WHERE source_data ->> 'want_chain_id' = $1 ORDER BY id`, [String(chainId)]);
    const { rows: signals } = await pool.query(`SELECT id, entity_key, kind, payload, created_at FROM worth_signals
      WHERE payload ->> 'about' LIKE $1 OR entity_key = $2 ORDER BY created_at`, [`chain ${chainId} %`, want.outcomeKey || '']);
    const events = [];
    events.push({ at: row.created_at, kind: 'want_created', detail: { description: want.description, doneWhen: want.doneWhen, origin: s.origin, stakes: want.stakes || null, value: want.value } });
    for (const d of decisions) events.push({ at: d.created_at, kind: 'attempt_appraised', detail: { id: d.id, decision: d.decision, capability: d.capability,
      reversibility: d.proposal?.reversibility, expected: d.appraisal?.expected, reasons: d.appraisal?.reasons, description: d.proposal?.description } });
    for (const d of decisions.filter(d => d.outcome)) events.push({ at: d.resolved_at, kind: 'attempt_observed', detail: { id: d.id, result: d.outcome.result, observation: d.outcome.evidence?.[0]?.observation } });
    for (const h of hyps) {
      events.push({ at: h.source_data?.lifecycle?.generated_at || row.updated_at, kind: 'prediction_committed', detail: { id: h.id, claim: h.claim, prediction: h.prediction, confidence: num(h.confidence), deadline: h.prediction_deadline } });
      if (h.tested_at) events.push({ at: h.tested_at, kind: 'prediction_settled', detail: { id: h.id, status: h.status, how: h.model_update } });
    }
    for (const r of want.receipts || []) events.push({ at: new Date(r.at), kind: 'progress_observed', detail: { receiptId: r.receiptId, progress: r.progress, criterionMet: r.criterionMet, usefulness: r.usefulness ?? null, evidence: r.evidence } });
    for (const c of s.commitments || []) if (c.kind !== 'hypothesis') events.push({ at: new Date(c.at), kind: `${c.kind}_committed`, detail: c });
    for (const w of signals) events.push({ at: w.created_at, kind: 'worth_signal', detail: { entity: w.entity_key, signal: w.kind, ...(w.payload.rating !== undefined ? { rating: w.payload.rating, by: w.payload.by } : {}), ...(w.payload.outcome ? { outcome: w.payload.outcome, progress: w.payload.progress } : {}) } });
    for (const e of (s.evidence || [])) if (/^(prediction|artifact)-/.test(e.id)) events.push({ at: row.updated_at, kind: 'evidence_added', detail: e });
    events.sort((a, b) => new Date(a.at) - new Date(b.at));
    // Affect at each step, and how it moved across the story.
    for (const e of events) e.affect = await affectAt(e.at);
    const first = events.find(e => e.affect)?.affect, last = [...events].reverse().find(e => e.affect)?.affect;
    const shift = first && last ? Object.fromEntries(['valence', 'frustration', 'curiosity', 'fear', 'joy', 'selfEfficacy'].map(k => [k, num(last[k]) - num(first[k])])) : null;
    return { chain_id: row.id, seed: row.seed, status: row.status, want: { description: want.description, doneWhen: want.doneWhen, value: want.value, progress: want.progress, status: want.status,
      strategyIndex: want.strategy, failedAttempts: want.failedAttempts, pricing: want.pricing || null }, lastStrategy: s.lastStrategy || null, stallStreak: s.stallStreak || 0,
      events, affectShift: shift, counts: { attempts: decisions.length, proceeded: decisions.filter(d => d.decision === 'proceed').length, predictions: hyps.length,
        settled: hyps.filter(h => h.tested_at).length, receipts: (want.receipts || []).length, worthSignals: signals.length } };
  }
  return { forChain, affectAt };
}
