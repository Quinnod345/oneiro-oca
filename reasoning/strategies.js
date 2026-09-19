// Strategies are how a want spends its budget. Each is one bounded attempt that ends in
// observations added to the want, a typed commitment whose outcome will be observed later,
// or nothing. A strategy never satiates a want by itself: only observed progress does.
//
// Rotation is hunger's job — a failed attempt advances `want.strategy` — so frustration changes
// what the engine does next, not just what it says.
import { normalizeEvidence } from './loop.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const text = (v, max = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const SENSOR_METRICS = ['battery_pct', 'charging', 'front_app', 'presence', 'idle_seconds', 'hour', 'typing_wpm', 'cpu_raw', 'memory_pressure_pct', 'thermal', 'app_switches_15min'];
export const PREDICTION_METRICS = [...SENSOR_METRICS, 'want_progress'];
export const NUMERIC_METRICS = ['battery_pct', 'idle_seconds', 'hour', 'typing_wpm', 'cpu_raw', 'memory_pressure_pct', 'app_switches_15min', 'want_progress'];

export const predictionSchema = {
  type: 'object', additionalProperties: false,
  required: ['claim', 'metric', 'operator', 'value', 'deadline_minutes', 'confidence', 'why_it_matters'],
  properties: {
    claim: { type: 'string' }, metric: { type: 'string', enum: PREDICTION_METRICS },
    operator: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains'] },
    value: { type: ['string', 'number', 'boolean'] }, deadline_minutes: { type: 'integer' },
    confidence: { type: 'number' }, why_it_matters: { type: 'string' } } };

export const artifactSchema = {
  type: 'object', additionalProperties: false, required: ['title', 'body', 'what_it_is_for', 'how_to_judge_it'],
  properties: { title: { type: 'string' }, body: { type: 'string' }, what_it_is_for: { type: 'string' }, how_to_judge_it: { type: 'string' } } };

// Budget scales with pressure: a want that matters and has waited gets more time per attempt.
export function budgetFor(motivation, { timeBudgetSeconds = 60, maxPasses = 3 } = {}) {
  const pressure = clamp(motivation?.pressure ?? 0, 0, 1);
  return { timeBudgetSeconds: clamp(Math.round(timeBudgetSeconds * (0.5 + pressure)), 10, 180), maxPasses: clamp(maxPasses, 2, 8) };
}

function wantContext(ctx) {
  const evidence = (ctx.evidence || []).slice(-24).map(e => `- [${e.id}] (${e.source}) ${text(e.observation, 300)}`).join('\n') || '- none yet';
  const last = ctx.state?.result ? `Last conclusion: ${text(ctx.state.result.conclusion, 300)}\nMissing evidence: ${(ctx.state.result.missingEvidence || []).slice(0, 4).map(m => text(m, 160)).join(' | ') || 'none stated'}` : 'No prior conclusion.';
  return `WANT: ${text(ctx.want.description, 600)}\nDONE WHEN: ${text(ctx.want.doneWhen, 400)}\nPROGRESS: ${ctx.want.progress ?? 0}\nOBSERVATIONS:\n${evidence}\n${last}`;
}

async function generateJson(ctx, { system, prompt, schema, maxTokens = 600 }) {
  const response = await ctx.deps.llm.messages.create({ provider: ctx.deps.provider, model: ctx.deps.model, system,
    messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0.2 },
    { priority: 10, responseSchema: schema, signal: AbortSignal.timeout(ctx.budget.timeBudgetSeconds * 1000) });
  const raw = String(response.content?.[0]?.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(raw);
}

export const STRATEGIES = [
  {
    name: 'inspect_missing_evidence', kind: 'reasoning', actionKind: 'read', reversibility: 'readonly',
    available: deps => typeof deps.reason === 'function',
    describe: () => 'Review the current observations and state the next verifiable step.',
    async run(ctx) { return ctx.deps.reason(ctx.chain.seed, ctx.reasonOptions); },
  },
  {
    name: 'test_a_prediction', kind: 'hypothesis', actionKind: 'read', reversibility: 'readonly',
    available: deps => !!deps.llm && !!deps.hypothesis,
    describe: () => 'Commit to one falsifiable prediction about this want that the world will settle by a deadline.',
    async run(ctx) {
      let p;
      try {
        p = await generateJson(ctx, { schema: predictionSchema,
          system: `You form one falsifiable prediction that would move this want forward if it held. Metrics you may use: ${PREDICTION_METRICS.join(', ')}. ` +
            `Numeric metrics (${NUMERIC_METRICS.join(', ')}) take gt/gte/lt/lte with a number; the others take eq/neq/contains with a string. ` +
            `"want_progress" is this want's observed progress in [0,1]. Use a short deadline (5-1440 minutes) and honest confidence in [0.05,0.95]. Say why it matters to the want. Respond with JSON only.`,
          prompt: wantContext(ctx) });
      } catch (e) { return { status: 'failed', error: `prediction unavailable: ${text(e.message, 160)}` }; }
      const minutes = clamp(Number(p.deadline_minutes) || 60, 5, 1440), confidence = clamp(Number(p.confidence) || 0.5, 0.05, 0.95);
      if (!PREDICTION_METRICS.includes(p.metric) || !text(p.claim)) return { status: 'stalled', stopReason: 'no_usable_prediction' };
      // A prediction that cannot be evaluated is not a prediction: numeric metrics take numeric operators and values.
      const numeric = NUMERIC_METRICS.includes(p.metric);
      if (numeric && (!['gt', 'gte', 'lt', 'lte'].includes(p.operator) || !Number.isFinite(Number(p.value)))) return { status: 'stalled', stopReason: 'unverifiable_prediction_shape' };
      if (!numeric && !['eq', 'neq', 'contains'].includes(p.operator)) return { status: 'stalled', stopReason: 'unverifiable_prediction_shape' };
      if (numeric) p.value = Number(p.value);
      const deadline = new Date(ctx.clock() + minutes * 60000).toISOString();
      const formed = await ctx.deps.hypothesis.form('pursuit', text(p.claim, 500), `${p.metric} ${p.operator} ${JSON.stringify(p.value)} by ${deadline}`, {
        testType: 'structured', confidence, deadline,
        sourceData: { evaluation: { metric: p.metric, operator: p.operator, value: p.value }, want_chain_id: ctx.chain.chain_id, strategy: 'test_a_prediction', why: text(p.why_it_matters, 300) } });
      const id = Number(formed?.id ?? formed);
      if (!Number.isFinite(id)) return { status: 'failed', error: 'hypothesis registration returned no id' };
      return { status: 'needs_evidence', conclusion: `Prediction #${id}: ${text(p.claim, 200)} (${p.metric} ${p.operator} ${JSON.stringify(p.value)} by ${deadline})`,
        missingEvidence: [`Observation settling prediction #${id} (${p.metric}) by ${deadline}`],
        commitment: { kind: 'hypothesis', id, metric: p.metric, deadline } };
    },
  },
  {
    name: 'imagine_before_acting', kind: 'simulation', actionKind: 'read', reversibility: 'readonly',
    available: deps => !!deps.simulate,
    describe: () => 'Simulate the next proposed step before anyone takes it; the real outcome will score the simulation.',
    async run(ctx) {
      const action = text(ctx.state?.result?.conclusion, 400);
      if (!action) return { status: 'stalled', stopReason: 'nothing_proposed_to_simulate' };
      const sim = await ctx.deps.simulate(`Next step for want #${ctx.chain.chain_id}: ${action}`,
        { want: text(ctx.want.description, 300), progress: ctx.want.progress ?? 0, observations: (ctx.evidence || []).slice(-8).map(e => text(e.observation, 200)) },
        [action], { purpose: 'decision' });
      if (!sim || sim.quality !== 'generated_prediction' || !sim.id) return { status: 'failed', error: sim?.reason || 'simulation unavailable' };
      return { status: 'needs_evidence',
        conclusion: `Simulation #${sim.id} predicts: ${text(sim.expected_outcome, 300)}${sim.risks?.length ? ` Risks: ${sim.risks.slice(0, 3).map(r => text(r, 80)).join('; ')}` : ''}`,
        missingEvidence: [`The observed outcome of "${text(action, 120)}", to score simulation #${sim.id}`],
        commitment: { kind: 'simulation', id: sim.id, action } };
    },
  },
  {
    name: 'argue_the_premise', kind: 'deliberation', actionKind: 'read', reversibility: 'readonly',
    available: deps => typeof deps.reason === 'function',
    describe: () => 'Assume the criterion cannot be met as stated and find the premise most likely to be wrong.',
    async run(ctx) {
      const goal = `Assume this cannot be satisfied as stated: "${text(ctx.want.doneWhen, 300)}". Name the single premise most likely to be wrong and the one observation that would settle it. Do not propose actions on the world.`;
      const r = await ctx.deps.reason(goal, { ...ctx.reasonOptions, context: wantContext(ctx).slice(0, 12000), checkpoint: null });
      const status = r.status === 'converged' ? 'needs_evidence' : r.status;   // a sharper question is not completion
      return { ...r, status, conclusion: r.conclusion ? `Premise under doubt: ${text(r.conclusion, 400)}` : '', checkpoint: null };
    },
  },
  {
    name: 'propose_an_artifact', kind: 'creation', actionKind: 'edit_file', reversibility: 'sandboxed',
    available: deps => !!deps.llm && typeof deps.writeArtifact === 'function',
    describe: () => 'Draft a concrete deliverable for this want into the engine\'s own work directory; only a person\'s rating makes it count.',
    async run(ctx) {
      let a;
      try {
        a = await generateJson(ctx, { schema: artifactSchema, maxTokens: 1200,
          system: 'Produce one concrete, useful deliverable for this want: a draft, a checklist, a comparison, a plan with exact steps. Plain prose, no filler. Say what it is for and how a person should judge it. Respond with JSON only.',
          prompt: wantContext(ctx) });
      } catch (e) { return { status: 'failed', error: `artifact unavailable: ${text(e.message, 160)}` }; }
      if (!text(a.title) || text(a.body).length < 40) return { status: 'stalled', stopReason: 'no_usable_artifact' };
      const seq = ctx.state.claimSeq ?? ctx.state.attempts;
      const written = await ctx.deps.writeArtifact(ctx.chain.chain_id, { title: text(a.title, 120), body: String(a.body).slice(0, 20000), forWhat: text(a.what_it_is_for, 300), judge: text(a.how_to_judge_it, 300), attempt: seq });
      return { status: 'needs_evidence', conclusion: `Artifact delivered: ${text(a.title, 120)} (${written.path})`,
        missingEvidence: [`A person's rating of the artifact "${text(a.title, 80)}" (usefulness in [0,1])`],
        evidence: [{ id: `artifact-${ctx.chain.chain_id}-${seq}`, source: 'artifact delivered by the engine (unrated; generated)', observation: `${text(a.title, 120)} — ${text(a.what_it_is_for, 200)}; judge by: ${text(a.how_to_judge_it, 200)}; at ${written.path}` }],
        commitment: { kind: 'artifact', path: written.path, title: text(a.title, 120) } };
    },
  },
];

// A want about the engine itself, pursued in the self-build phase: change the code on a branch, prove it
// with the tests, publish the branch. Only eligible for self-originated wants while the phase is active.
STRATEGIES.unshift({
  name: 'improve_myself', kind: 'self_build', actionKind: 'edit_own_code', reversibility: 'undo',
  available: deps => !!deps.selfBuild,
  // Not while a branch it already built awaits a person's merge: the next change would be a guess.
  applies: (state, deps) => state?.origin?.kind === 'self' && deps.selfBuild?.isActive?.() === true
    && !(state?.commitments || []).some(c => c.kind === 'branch' && !c.merged),
  describe: () => 'Change my own code on a branch in a private worktree, prove it with my tests, and publish the branch.',
  async run(ctx) { return ctx.deps.selfBuild.build(ctx); },
});

// The strategy a want is on, over the strategies the runtime can provide and that apply to this want.
// Rotation order is fixed; the index counts only eligible strategies so rotation never skips a beat.
export function eligibleStrategies(deps = {}, state = null) {
  return STRATEGIES.filter(s => s.available(deps) && (!s.applies || s.applies(state, deps)));
}
export function strategyFor(want, deps = {}, state = null) {
  const list = eligibleStrategies(deps, state);
  if (!list.length) return STRATEGIES.find(s => s.name === 'inspect_missing_evidence');
  return list[Math.max(0, want?.strategy || 0) % list.length];
}

export function strategyNames() { return STRATEGIES.filter(s => s.name !== 'improve_myself').map(s => s.name); }
export { normalizeEvidence };
