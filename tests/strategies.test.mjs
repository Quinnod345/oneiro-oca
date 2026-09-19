import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, readFile as readText } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STRATEGIES, strategyFor, budgetFor, strategyNames, PREDICTION_METRICS, NUMERIC_METRICS, predictionSchema } from '../reasoning/strategies.js';
import { createWant, recordAttempt, appetite, STRATEGY_NAMES } from '../motivation/hunger.js';
import { createProposal, appraise } from '../motivation/risk.js';
import { createWorthLedger } from '../motivation/worth-ledger.js';
import { createRiskJournal } from '../motivation/risk-journal.js';
import { createPonderQueue } from '../reasoning/ponder-queue.js';

const DAY = 86400000;
const evidence = [{ id: 'obs-1', source: 'isolated regression fixture', observation: 'The build fails on the second target.' }];
const blocked = async () => ({ status: 'needs_evidence', checkpoint: { version: 1, passes: [] }, missingEvidence: ['Which target?'] });
const stalled = async () => ({ status: 'stalled', stopReason: 'no_progress', checkpoint: { version: 1, passes: [{}, {}] } });

test('the registry and hunger agree on rotation order, and rotation skips strategies the runtime cannot provide', () => {
  assert.deepEqual(strategyNames(), STRATEGY_NAMES);
  const w = createWant({ description: 'x', doneWhen: 'y' });
  assert.equal(strategyFor(w, { reason: async () => {} }).name, 'inspect_missing_evidence');
  assert.equal(strategyFor({ ...w, strategy: 1 }, { reason: async () => {} }).name, 'argue_the_premise', 'without an llm, prediction and simulation are skipped');
  assert.equal(strategyFor({ ...w, strategy: 1 }, { reason: async () => {}, llm: {}, hypothesis: {} }).name, 'test_a_prediction');
  assert.equal(strategyFor({ ...w, strategy: 4 }, { reason: async () => {} }).name, 'inspect_missing_evidence', 'wraps around');
});

test('frustration rotates the strategy; a blocked strategy rotates without counting a failure; an interrupted pass stays put', () => {
  let w = createWant({ description: 'x', doneWhen: 'y' });
  w = recordAttempt(w, { result: 'stalled' });
  assert.deepEqual([w.attempts, w.failedAttempts, w.strategy], [1, 1, 1]);
  w = recordAttempt(w, { result: 'blocked' });
  assert.deepEqual([w.attempts, w.failedAttempts, w.strategy], [1, 1, 2]);
  w = recordAttempt(w, { result: 'interrupted' });
  assert.deepEqual([w.attempts, w.failedAttempts, w.strategy], [2, 2, 2]);
  w = recordAttempt(w, { result: 'needs_evidence' });
  assert.deepEqual([w.attempts, w.failedAttempts, w.strategy], [3, 2, 2]);
  assert.equal(appetite(w).strategy, 'imagine_before_acting');
});

test('a prediction the world cannot evaluate is not a prediction: numeric metrics need numeric operators and values', async () => {
  const llm = { messages: { create: async () => ({ content: [{ text: JSON.stringify({ claim: 'x', metric: 'idle_seconds', operator: 'contains', value: '>75', deadline_minutes: 60, confidence: 0.6, why_it_matters: 'y' }) }] }) } };
  const s = STRATEGIES.find(x => x.name === 'test_a_prediction');
  const ctx = { deps: { llm, hypothesis: { form: async () => ({ id: 1 }) }, provider: 't', model: 'm' }, budget: { timeBudgetSeconds: 10 }, chain: { chain_id: 1 }, want: { description: 'w', doneWhen: 'd' }, state: {}, evidence: [], clock: Date.now };
  const r = await s.run(ctx);
  assert.equal(r.status, 'stalled'); assert.equal(r.stopReason, 'unverifiable_prediction_shape');
  // and a prediction about the want's own progress is not about the world: the schema does not offer it
  assert.ok(!PREDICTION_METRICS.includes('want_progress')); assert.ok(!NUMERIC_METRICS.includes('want_progress'));
  assert.ok(!predictionSchema.properties.metric.enum.includes('want_progress'));
});

test('budget scales with pressure and stays within the reasoner contract', () => {
  assert.deepEqual(budgetFor({ pressure: 0 }, { timeBudgetSeconds: 60, maxPasses: 3 }), { timeBudgetSeconds: 30, maxPasses: 3 });
  assert.deepEqual(budgetFor({ pressure: 1 }, { timeBudgetSeconds: 60, maxPasses: 3 }), { timeBudgetSeconds: 90, maxPasses: 3 });
  assert.equal(budgetFor({ pressure: 1 }, { timeBudgetSeconds: 180 }).timeBudgetSeconds, 180);
  assert.equal(budgetFor({ pressure: 0 }, { timeBudgetSeconds: 10 }).timeBudgetSeconds, 10);
});

test('thinking is not acting: a read-only engine step and a draft in its own sandbox proceed with the master switch off; exposure does not', () => {
  const lookup = () => null;
  const think = createProposal({ kind: 'read', description: 'reason about the want', serves: ['project:demo'], reversibility: 'readonly' });
  assert.equal(appraise(think, { lookup, controls: { autonomousActions: false } }).decision, 'proceed');
  const draft = createProposal({ kind: 'edit_file', description: 'draft an artifact in the work dir', serves: ['project:demo'], reversibility: 'sandboxed' });
  assert.equal(appraise(draft, { lookup, controls: { autonomousActions: false } }).decision, 'proceed', 'the engine\'s own work directory is not the world');
  assert.equal(appraise(draft, { lookup, controls: { autonomousActions: true } }).decision, 'proceed');
  const edit = createProposal({ kind: 'edit_file', description: 'edit a file with undo', serves: ['project:demo'], reversibility: 'undo' });
  assert.equal(appraise(edit, { lookup, controls: { autonomousActions: false } }).decision, 'prepare_artifact', 'a real reversibility cost waits for the switch');
  const touching = createProposal({ kind: 'read', description: 'read Quinn\'s notes', serves: ['project:demo'], touches: ['data:quinn'], reversibility: 'readonly' });
  assert.equal(appraise(touching, { lookup, controls: { autonomousActions: false } }).decision, 'prepare_artifact', 'exposure keeps the switch in force');
});

async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'strategy_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema + ',public' });
    await pool.query(`CREATE TABLE thought_chains (
      id SERIAL PRIMARY KEY, seed TEXT NOT NULL, priority FLOAT8 DEFAULT .5,
      status TEXT DEFAULT 'pondering', depth INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), ponder_state JSONB)`);
    for (const m of ['057_worth_ledger', '058_risk_decisions']) await pool.query(await readFile(new URL(`../migrations/${m}.sql`, import.meta.url), 'utf8'));
    await run(pool);
  } finally {
    if (pool) await pool.end();
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await admin.end();
  }
}

// A fake local model that answers each strategy's schema.
function fakeLlm(log) {
  return { messages: { create: async (params, options) => {
    log.push({ schema: options?.responseSchema, system: params.system });
    const s = options?.responseSchema;
    if (s?.properties?.metric) return { content: [{ text: JSON.stringify({ claim: 'Typing will pick up within the hour', metric: 'typing_wpm', operator: 'gte', value: 34, deadline_minutes: 60, confidence: 0.6, why_it_matters: 'It shows the person is back at the build.' }) }] };
    if (s?.properties?.title) return { content: [{ text: JSON.stringify({ title: 'Build target checklist', body: 'Step one: pin the failing target. Step two: run its tests alone. Step three: compare the two configs line by line.', what_it_is_for: 'Getting the build green', how_to_judge_it: 'Did following it fix the build?' }) }] };
    return { content: [{ text: '{}' }] };
  } } };
}

test('rotation changes what runs: each strategy spends one attempt, produces a commitment or evidence, and is journaled and felt', async () => database(async pool => {
  let now = 10 * DAY;
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const felt = [];
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => ({ autonomousActions: false }),
    feel: { feelBlocked: e => felt.push(['blocked', e.decision]), feelOutcome: e => felt.push(['outcome', e.result]), informationAppetiteBonus: () => 0 } });
  const ran = [], log = [];
  const formed = [];
  const hypothesis = { form: async (domain, claim, prediction, opts) => { formed.push({ domain, claim, prediction, opts }); return { id: 41, action: 'created', claim }; } };
  const simulate = async (description, initialState, actions) => ({ id: 7, quality: 'generated_prediction', expected_outcome: 'The build passes once the target is pinned.', risks: ['config drift'], predicted_states: [{ step: 1, state: 'pinned', confidence: 0.6 }], branch_points: [] });
  const workDir = await mkdtemp(join(tmpdir(), 'oca-artifacts-'));
  const writeArtifact = async (chainId, a) => { const path = join(workDir, `${chainId}-${a.attempt}.md`); await (await import('node:fs/promises')).writeFile(path, a.body); return { path }; };
  const reason = async (goal, opts) => { ran.push(goal.slice(0, 40)); return stalled(); };
  const queue = createPonderQueue({ pool, reason, clock: () => now, worth, risk,
    strategies: { llm: fakeLlm(log), hypothesis, simulate, writeArtifact, provider: 'test', model: 'fake' } });
  const chain = await queue.enqueue({ seed: 'Get the build green', topic: 'Build', evidence, doneWhen: 'CI is green on both targets.' });

  // 1. inspect_missing_evidence (reasoner) — stalls → rotate
  let c = await queue.runNext(chain.chain_id);
  assert.equal(c.lastStrategy.name, 'inspect_missing_evidence'); assert.equal(c.result.status, 'stalled'); assert.equal(c.want.strategy, 1);
  assert.equal(c.status, 'pondering', 'a stall rotates and stays claimable: the next strategy is a different attempt');
  assert.deepEqual(ran, ['Get the build green']);
  // 2. test_a_prediction — a typed commitment about the want
  c = await queue.runNext(chain.chain_id);
  assert.equal(c.lastStrategy.name, 'test_a_prediction'); assert.equal(c.status, 'awaiting_evidence');
  assert.equal(formed.length, 1); assert.equal(formed[0].opts.sourceData.evaluation.metric, 'typing_wpm'); assert.equal(formed[0].opts.sourceData.want_chain_id, chain.chain_id);
  assert.deepEqual(c.commitments.map(x => x.kind), ['hypothesis']);
  assert.match(c.result.conclusion, /Prediction #41/);
  // awaiting_evidence is not a failure: the strategy index stays, so give it evidence to move on
  assert.equal(c.want.strategy, 1);
  c = await queue.addEvidence(chain.chain_id, [{ id: 'obs-2', source: 'isolated regression fixture', observation: 'Target B uses the stale config.' }]);
  // the reasoner (index 1 → prediction again) would repeat; push the strategy forward by a failure of the same kind
  await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{want,strategy}', '2') WHERE id = $1`, [chain.chain_id]);
  // 3. imagine_before_acting — needs a proposed step; the last conclusion is the prediction text, so it simulates that
  c = await queue.runNext(chain.chain_id);
  assert.equal(c.lastStrategy.name, 'imagine_before_acting'); assert.equal(c.status, 'awaiting_evidence');
  assert.deepEqual(c.commitments.map(x => x.kind), ['hypothesis', 'simulation']);
  assert.equal(await queue.runNext(chain.chain_id), null, 'a want awaiting evidence does not run again on its own');
  await queue.addEvidence(chain.chain_id, [{ id: 'obs-3', source: 'isolated regression fixture', observation: 'Pinning the target made no difference.' }]);
  await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{want,strategy}', '3') WHERE id = $1`, [chain.chain_id]);
  // 4. argue_the_premise — the reasoner is asked to falsify the criterion; convergence is downgraded to a sharper question
  c = await queue.runNext(chain.chain_id);
  assert.equal(c.lastStrategy.name, 'argue_the_premise'); assert.match(ran.at(-1), /^Assume this cannot be satisfied/);
  assert.equal(c.result.status, 'stalled', 'the stub reasoner stalls, which rotates on its own');
  assert.equal(c.want.strategy, 4); assert.equal(c.status, 'pondering');
  // 5. propose_an_artifact — sandboxed, engine-fired, switch off → still proceeds: a draft in its own work directory is not the world
  c = await queue.runNext(chain.chain_id);
  assert.equal(c.lastStrategy.name, 'propose_an_artifact'); assert.equal(c.lastStrategy.decision, 'proceed');
  assert.equal(c.status, 'awaiting_evidence', 'delivered; only a person\'s rating moves the want');
  assert.deepEqual(c.commitments.map(x => x.kind), ['hypothesis', 'simulation', 'artifact']);
  assert.ok(c.evidence.some(e => e.id.startsWith('artifact-') && /generated/.test(e.source)), 'the delivery is evidence marked generated and unrated');
  const journal = await risk.recent({ chainId: chain.chain_id });
  assert.equal(journal.length, 5, 'every attempt is a risk decision');
  assert.deepEqual(journal.map(d => d.decision).sort(), ['proceed', 'proceed', 'proceed', 'proceed', 'proceed']);
  assert.ok(journal.filter(d => d.outcome).length >= 4, 'run strategies carry their outcome');
  // self-knowledge that learns: the expectation for a strategy is its own record, shrunk toward the capability's worth
  const rec = await risk.trackRecord({ strategy: 'inspect_missing_evidence', capability: 'act_reversible' });
  assert.equal(rec.n, 1); assert.equal(rec.wins, 0, 'the stub reasoner stalled: a failure on the record');
  assert.ok(rec.pSuccess < rec.prior, `${rec.pSuccess} should sit below the prior ${rec.prior}`);
  const fresh = await risk.trackRecord({ strategy: 'never_ran', capability: 'act_reversible' });
  assert.equal(fresh.n, 0); assert.equal(fresh.pSuccess, fresh.prior, 'no record: the capability\'s worth is the expectation');
  assert.ok(journal.every(d => Number.isFinite(d.proposal.pSuccess)), 'every strategy appraisal carried its record as the expectation');
  await assert.rejects(risk.trackRecord({ strategy: 'x; drop', capability: 'act_reversible' }));
  void felt;
  await rm(workDir, { recursive: true, force: true });
}));

test('when every strategy has stalled on the same evidence the want waits; new evidence resets the streak', async () => database(async pool => {
  const worth = createWorthLedger({ pool }); await worth.seed();
  const queue = createPonderQueue({ pool, reason: stalled, worth, strategies: { llm: { messages: { create: async () => { throw new Error('model down'); } } }, hypothesis: { form: async () => 1 }, simulate: async () => null } });
  const chain = await queue.enqueue({ seed: 'Stuck', evidence });
  const seen = [];
  for (let i = 0; i < 6; i++) { const c = await queue.runNext(chain.chain_id); if (!c) { seen.push(null); break; } seen.push([c.lastStrategy.name, c.status]); }
  const last = seen.filter(Boolean).at(-1);
  assert.equal(last[1], 'stalled', 'after a full rotation without progress the want is stalled');
  assert.ok(seen.filter(Boolean).length >= 3 && seen.filter(Boolean).length <= 5, `ran ${seen.filter(Boolean).length} strategies before waiting`);
  assert.equal(await queue.runNext(chain.chain_id), null);
  await queue.addEvidence(chain.chain_id, [{ id: 'obs-new', source: 'isolated regression fixture', observation: 'A new fact.' }]);
  const again = await queue.runNext(chain.chain_id);
  assert.ok(again && again.status === 'pondering', 'new evidence lets the rotation start over');
}));

test('with the switch on, the artifact strategy writes into the work directory and the delivery is evidence marked generated and unrated', async () => database(async pool => {
  let now = 10 * DAY;
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => ({ autonomousActions: true }) });
  const workDir = await mkdtemp(join(tmpdir(), 'oca-artifacts-'));
  const writeArtifact = async (chainId, a) => { const path = join(workDir, `${chainId}-${a.attempt}.md`); await (await import('node:fs/promises')).writeFile(path, `# ${a.title}\n${a.body}`); return { path }; };
  const queue = createPonderQueue({ pool, reason: stalled, clock: () => now, worth, risk, strategies: { llm: fakeLlm([]), writeArtifact, provider: 'test', model: 'fake' } });
  const chain = await queue.enqueue({ seed: 'Get the build green', topic: 'Build', evidence });
  // With only the reasoner, argue and artifact available, the index counts those three: artifact is 2.
  await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{want,strategy}', '2') WHERE id = $1`, [chain.chain_id]);
  const c = await queue.runNext(chain.chain_id);
  assert.equal(c.lastStrategy.name, 'propose_an_artifact'); assert.equal(c.status, 'awaiting_evidence');
  const delivered = c.evidence.find(e => e.id.startsWith('artifact-'));
  assert.ok(delivered && /generated/.test(delivered.source) && /unrated/.test(delivered.source));
  assert.match(await readText(c.commitments[0].path, 'utf8'), /Build target checklist/);
  await assert.rejects(worth.record({ id: 'x', entityKey: 'project:build', kind: 'observed', outcome: 'used', evidence: [delivered] }), /cannot ground worth/, 'a delivery cannot earn worth by itself');
  await rm(workDir, { recursive: true, force: true });
}));

test('a committed prediction settled by the world becomes evidence on its want exactly once; an unjudgeable one adds nothing but re-opens the want', async () => database(async pool => {
  const queue = createPonderQueue({ pool, reason: stalled, strategies: { llm: fakeLlm([]), hypothesis: { form: async () => ({ id: 99 }) } } });
  const chain = await queue.enqueue({ seed: 'Predict', evidence });
  await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{want,strategy}', '1') WHERE id = $1`, [chain.chain_id]);
  const c = await queue.runNext(chain.chain_id);
  assert.deepEqual(c.commitments.map(x => x.id), [99]);
  assert.equal(await queue.settlePrediction({ id: 98, status: 'confirmed', confirmed: true, evaluation: { verifiable: true, reason: 'x' } }), null, 'unknown prediction');
  const held = await queue.settlePrediction({ id: 99, status: 'confirmed', confirmed: true, evaluation: { verifiable: true, reason: 'metric=want_progress observed=0.5 operator=gte expected=0.34' } });
  assert.deepEqual([held.chain_id, held.added, held.confirmed], [chain.chain_id, true, true]);
  const after = await queue.get(chain.chain_id);
  assert.ok(after.evidence.some(e => e.id === 'prediction-99' && /held/.test(e.observation)));
  assert.equal(after.status, 'pondering', 'new evidence reopens pondering');
  assert.equal(await queue.settlePrediction({ id: 99, status: 'confirmed', confirmed: true, evaluation: { verifiable: true } }), null, 'settled once');
  const q2 = createPonderQueue({ pool, reason: stalled, strategies: { llm: fakeLlm([]), hypothesis: { form: async () => ({ id: 100 }) } } });
  const c2 = await q2.enqueue({ seed: 'Predict again', evidence });
  await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{want,strategy}', '1') WHERE id = $1`, [c2.chain_id]);
  await q2.runNext(c2.chain_id);
  const parked = await q2.get(c2.chain_id);
  assert.equal(parked.status, 'awaiting_evidence'); const strategyBefore = parked.want.strategy;
  const expired = await q2.settlePrediction({ id: 100, status: 'expired', confirmed: null, evaluation: { verifiable: false, reason: 'metric_not_observed:want_progress' } });
  assert.deepEqual([expired.added, expired.status, expired.reopened], [false, 'expired', true]);
  const after2 = await q2.get(c2.chain_id);
  assert.ok(!after2.evidence.some(e => e.id === 'prediction-100'), 'nothing about the world was learned');
  assert.equal(after2.status, 'pondering', 'but the want is no longer parked on a prediction nobody could judge');
  assert.equal(after2.want.strategy, strategyBefore + 1, 'the next strategy, not the same prediction again');
  assert.match(after2.priorRuns.at(-1).result.error, /prediction #100 expired unevaluated: metric_not_observed/);
}));
