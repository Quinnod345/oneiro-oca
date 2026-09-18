// OCA Adversarial Deliberation Engine
// Four perspectives debate decisions: Skeptic, Builder, Dreamer, Empath
import { pool, emit } from '../event-bus.js';
import llm from '../llm.js';
import { createReasoner, normalizeEvidence } from '../reasoning/loop.js';


const PERSPECTIVES = {
  skeptic: {
    name: 'Skeptic',
    system: `You are the Skeptic perspective in a cognitive architecture. Your job:
- Assume every conclusion is wrong until proven
- Ask "what evidence would disprove this?"
- Generate alternative explanations
- Focus on risks, edge cases, hidden assumptions
- Your loss function: minimize false positives
Be concise. 2-4 sentences max.`
  },
  builder: {
    name: 'Builder',
    system: `You are the Builder perspective in a cognitive architecture. Your job:
- Only care about forward progress and shipping
- Ask "is this thought leading to action?"
- Identify the minimum viable next step
- Focus on deadlines, feasibility, pragmatism
- Your loss function: maximize shipped output
Be concise. 2-4 sentences max.`
  },
  dreamer: {
    name: 'Dreamer',
    system: `You are the Dreamer perspective in a cognitive architecture. Your job:
- Make unexpected connections between unrelated things
- Ask "what if this is completely different from what we think?"
- Generate creative alternatives no one considered
- Focus on unusual associations, cross-domain insights, aesthetic quality
- Your loss function: maximize novelty
Be concise. 2-4 sentences max.`
  },
  empath: {
    name: 'Empath',
    system: `You are the Empath perspective in a cognitive architecture. Your job:
- Model other people's minds, especially Quinn's
- Ask "how would this make Quinn feel? What does he actually need?"
- Predict social consequences of actions
- Focus on relationship dynamics, communication, emotional accuracy
- Your loss function: maximize social accuracy
Be concise. 2-4 sentences max.`
  }
};

// Uses the same evidence contract as queued pondering; no adjective-based confidence.
export async function deliberate(decision, options = {}) {
  const run = createReasoner({ generate: async ({ system, prompt, signal, schema }) => {
    const r = await llm.messages.create({ model: 'claude-sonnet-4-6', system,
      messages: [{ role: 'user', content: prompt }], max_tokens: 800, temperature: 0.2 }, { signal, priority: 10, responseSchema: schema });
    return r.content?.[0]?.text || '';
  } });
  const result = await run(decision, options);
  const latest = result.passes.at(-1);
  const perspectives = Object.fromEntries(['skeptic', 'builder', 'dreamer', 'empath'].map(key => [key,
    key === 'builder' ? { argument: latest?.proposal.action || '', confidence: latest?.proposal.confidence ?? null }
      : { argument: latest?.review[key].argument || '', confidence: latest?.review[key].confidence ?? null }]));
  const { rows } = await pool.query(
    `INSERT INTO deliberations (decision, stakes, time_budget_seconds,
      skeptic_argument, skeptic_confidence, builder_argument, builder_confidence,
      dreamer_argument, dreamer_confidence, empath_argument, empath_confidence,
      resolution, resolution_method, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()) RETURNING id`,
    [decision, options.stakes || 'medium', Math.ceil(options.timeBudgetSeconds || 45),
      perspectives.skeptic.argument, perspectives.skeptic.confidence,
      perspectives.builder.argument, perspectives.builder.confidence,
      perspectives.dreamer.argument, perspectives.dreamer.confidence,
      perspectives.empath.argument, perspectives.empath.confidence,
      result.conclusion, 'evidence_loop']);
  const output = { ...result, id: rows[0].id, decision, perspectives,
    resolution: result.conclusion, resolutionMethod: 'evidence_loop', elapsed: result.elapsedMs };
  await emit('deliberation_result', 'deliberation', output);
  return output;
}

// Record which perspective was actually right (retrospective)
export async function evaluateDeliberation(deliberationId, outcome, rightPerspective, lesson = null, evidence = []) {
  const observed = normalizeEvidence(evidence);
  if (!observed.length || typeof outcome !== 'string' || !outcome.trim()) throw new Error('deliberation evaluation requires an observed outcome and evidence');
  if (rightPerspective !== null && !PERSPECTIVES[rightPerspective]) throw new Error('unknown perspective');
  await pool.query(
    `UPDATE deliberations SET outcome = $1, which_perspective_was_right = $2,
       lesson = $3, outcome_evidence = $4::jsonb WHERE id = $5`,
    [outcome, rightPerspective, lesson, JSON.stringify(observed), deliberationId]);
}

// Missing outcomes remain unknown. An LLM predicting what "likely happened" is not feedback.
export async function sweepUnresolvedDeliberations(limit = 3) {
  const { rows } = await pool.query(
    `SELECT id FROM deliberations WHERE outcome IS NULL AND completed_at < NOW() - INTERVAL '1 hour'
     ORDER BY completed_at ASC LIMIT $1`, [limit]);
  return { swept: rows.length, evaluated: 0, awaitingEvidence: rows.map(r => r.id) };
}

// Get perspective accuracy stats
export async function perspectiveStats() {
  const { rows } = await pool.query(
    `SELECT which_perspective_was_right as perspective, COUNT(*) as times_right
     FROM deliberations 
     WHERE which_perspective_was_right IS NOT NULL
       AND jsonb_array_length(outcome_evidence) > 0
     GROUP BY which_perspective_was_right`
  );
  return rows;
}

// Quick single-perspective check (not full deliberation)
export async function quickCheck(perspective, question, context = '') {
  const p = PERSPECTIVES[perspective];
  if (!p) throw new Error(`Unknown perspective: ${perspective}`);
  
  const response = await llm.messages.create({
    model: 'claude-sonnet-4-6',
    system: p.system,
    messages: [
      { role: 'user', content: `${question}\n\nContext: ${context}` }
    ],
    max_tokens: 150,
    temperature: 0.5
  });
  
  return response.content[0].text;
}

export default { deliberate, evaluateDeliberation, sweepUnresolvedDeliberations, perspectiveStats, quickCheck };
