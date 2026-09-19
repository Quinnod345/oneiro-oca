import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createWant, repriceWant, appetite } from '../motivation/hunger.js';
import { createWorthLedger } from '../motivation/worth-ledger.js';
import { createPonderQueue } from '../reasoning/ponder-queue.js';
import { createInterestEngine } from '../motivation/interest-engine.js';

const DAY = 86400000;
const evidence = [{ id: 'obs-1', source: 'isolated regression fixture', observation: 'The observed input has one mismatch.' }];
const outcomeEvidence = [{ id: 'quinn-reply-1', source: 'iMessage reply recorded by the companion', observation: 'Quinn replied that the summary was what he needed.' }];

test('a want without stakes keeps its explicit priority; with stakes it is priced from worth and says how', () => {
  const plain = createWant({ description: 'x', doneWhen: 'y', value: 0.4 });
  assert.equal(plain.value, 0.4); assert.equal(plain.stakes, undefined);
  assert.equal(repriceWant(plain, () => null), plain);
  const staked = createWant({ description: 'x', doneWhen: 'y', stakes: [{ entityKey: 'project:a' }, { entityKey: 'outcome:1', share: 1 }], outcomeKey: 'outcome:1' });
  assert.equal(staked.pricing.unpriced, true);
  const unknown = repriceWant(staked, () => null);
  assert.deepEqual([unknown.value, unknown.pricing.unpriced, unknown.pricing.provenance], [0.5, false, 'prior']);
  const known = repriceWant(staked, k => k === 'project:a' ? { worth: 1, confidence: 0.9, provenance: 'rated', constraint: false } : null);
  assert.equal(known.value, 0.75); assert.equal(known.pricing.provenance, 'rated');
  assert.equal(appetite(known, 1).valueProvenance, 'rated');
  assert.throws(() => createWant({ description: 'x', doneWhen: 'y', stakes: [{ entityKey: 'nope' }] }), /entity key/);
  assert.throws(() => createWant({ description: 'x', doneWhen: 'y', outcomeKey: 'bad' }), /entity key/);
});

async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'hunger_worth_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema + ',public' });
    await pool.query(`CREATE TABLE thought_chains (
      id SERIAL PRIMARY KEY, seed TEXT NOT NULL, priority FLOAT8 DEFAULT .5,
      status TEXT DEFAULT 'pondering', depth INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), ponder_state JSONB)`);
    for (const m of ['052_learned_interests', '057_worth_ledger']) {
      await pool.query(await readFile(new URL(`../migrations/${m}.sql`, import.meta.url), 'utf8'));
    }
    await run(pool);
  } finally {
    if (pool) await pool.end();
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await admin.end();
  }
}
const blocked = async () => ({ status: 'needs_evidence', checkpoint: { version: 1, passes: [] }, missingEvidence: ['Which input differs from the expected one?'] });
const stalled = async () => ({ status: 'stalled', stopReason: 'no_progress', checkpoint: { version: 1, passes: [{}, {}] } });
const converged = async () => ({ status: 'converged', checkpoint: { version: 1, passes: [{}] }, conclusion: 'Done thinking.' });
const crashed = async () => { throw new Error('fetch failed'); };

test('an explicit request rates its outcome; the topic becomes a project stake; the want is priced live', async () => database(async pool => {
  let now = 10 * DAY;
  const worth = createWorthLedger({ pool, clock: () => now });
  await worth.seed();
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth });
  const chain = await queue.enqueue({ seed: 'Summarize the week for Quinn', topic: 'Weekly Review', evidence });
  assert.match(chain.want.outcomeKey, /^outcome:ponder-/);
  assert.deepEqual(chain.want.stakes.map(s => s.entityKey), [chain.want.outcomeKey, 'project:weekly-review']);
  const outcome = await worth.get(chain.want.outcomeKey);
  assert.equal(outcome.provenance, 'rated'); assert.equal(outcome.signals.rated, 1);
  assert.equal(await worth.get('project:weekly-review'), null, 'asking does not invent project worth');
  assert.equal(chain.want.pricing.provenance, 'rated');
  assert.ok(Math.abs(chain.want.value - (outcome.worth + 0.5) / 2) < 1e-9, 'value is the mean of a rated outcome and an unknown project');

  const stated = await queue.enqueue({ seed: 'Low-stakes tidy-up', priority: 0.2, evidence });
  const statedOutcome = await worth.get(stated.want.outcomeKey);
  assert.ok(statedOutcome.worth < outcome.worth, 'a stated low priority lowers the outcome worth below the default request');
  assert.equal(statedOutcome.signals.rated, 1);
}));

test('a rating from Quinn on a project changes which want the engine selects next', async () => database(async pool => {
  let now = 10 * DAY;
  const worth = createWorthLedger({ pool, clock: () => now });
  await worth.seed();
  const ran = [];
  const queue = createPonderQueue({ pool, reason: async goal => { ran.push(goal); return blocked(); }, clock: () => now, worth });
  const a = await queue.enqueue({ seed: 'Pursue A', topic: 'Alpha', evidence });
  const b = await queue.enqueue({ seed: 'Pursue B', topic: 'Beta', evidence });
  let hunger = await queue.hunger();
  assert.equal(hunger.pricing, 'live_from_worth_ledger');
  assert.equal(hunger.selected, a.chain_id, 'equal worth: the earlier want wins');

  await worth.record({ id: 'quinn-loves-beta', entityKey: 'project:beta', kind: 'rated', rating: 1, by: 'quinn' });
  hunger = await queue.hunger();
  assert.equal(hunger.selected, b.chain_id, 'one rating re-prices B above A without touching the wants');
  assert.ok(hunger.wants.find(w => w.chain_id === b.chain_id).want.value > hunger.wants.find(w => w.chain_id === a.chain_id).want.value);
  await queue.runNext();
  assert.deepEqual(ran, ['Pursue B'], 'selection order follows the live price');

  await worth.record({ id: 'quinn-dismissed-beta', entityKey: 'project:beta', kind: 'rated', rating: -1, by: 'quinn' });
  await worth.record({ id: 'quinn-dismissed-beta-2', entityKey: 'project:beta', kind: 'rated', rating: -1, by: 'quinn' });
  hunger = await queue.hunger();
  assert.equal(hunger.selected, a.chain_id, 'and ratings the other way move selection back');
}));

test('usefulness feeds worth of the outcome, the project and self:ponder; progress alone feeds only hunger; replay is once', async () => database(async pool => {
  let now = 10 * DAY;
  const worth = createWorthLedger({ pool, clock: () => now });
  await worth.seed();
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth });
  const chain = await queue.enqueue({ seed: 'Draft the reply', topic: 'Inbox', evidence });
  const selfBefore = await worth.get('self:ponder');
  assert.equal(selfBefore.confidence, 0);

  const partial = await queue.outcome(chain.chain_id, { receiptId: 'r-progress', progress: 0.4, evidence: outcomeEvidence });
  assert.equal(partial.want.progress, 0.4);
  assert.deepEqual(partial.worthSignals, [], 'observed progress without usefulness writes no worth');
  assert.equal((await worth.get('self:ponder')).confidence, 0);

  const useful = await queue.outcome(chain.chain_id, { receiptId: 'r-useful', progress: 0.9, usefulness: 0.9, evidence: outcomeEvidence });
  assert.equal(useful.worthSignals.length, 3);
  assert.ok(useful.worthSignals.every(s => s.duplicate === false));
  const project = await worth.get('project:inbox');
  assert.equal(project.provenance, 'observed'); assert.ok(project.worth > 0.5);
  const self = await worth.get('self:ponder');
  assert.ok(self.worth > 0.5 && self.confidence > 0, 'self-worth is earned from an observed useful outcome');
  const outcome = await worth.get(chain.want.outcomeKey);
  assert.equal(outcome.signals.observed, 1);

  const replay = await queue.outcome(chain.chain_id, { receiptId: 'r-useful', progress: 0.9, usefulness: 0.9, evidence: outcomeEvidence });
  assert.ok(replay.worthSignals.every(s => s.duplicate === true), 'replaying a receipt writes nothing new');
  assert.equal((await worth.get('self:ponder')).signals.observed, 1);

  const sated = await queue.outcome(chain.chain_id, { receiptId: 'r-done', progress: 1, criterionMet: true, evidence: outcomeEvidence });
  assert.equal(sated.want.status, 'sated');
  assert.deepEqual(sated.worthSignals.map(s => s.id), [`receipt:${chain.chain_id}:r-done:sated:self:ponder`], 'satiation is a track-record success for the engine only');
}));

test('a receipt whose evidence is generated text still satiates hunger but cannot ground worth', async () => database(async pool => {
  const worth = createWorthLedger({ pool });
  await worth.seed();
  const queue = createPonderQueue({ pool, reason: blocked, worth });
  const chain = await queue.enqueue({ seed: 'Think about it', topic: 'Musing', evidence });
  const result = await queue.outcome(chain.chain_id, { receiptId: 'r-self', progress: 0.5, usefulness: 1,
    evidence: [{ id: 'g1', source: 'generated summary from the thinker', observation: 'I found this very useful.' }] });
  assert.equal(result.want.progress, 0.5);
  assert.ok(result.worthSignals.length >= 1 && result.worthSignals.every(s => /cannot ground worth/.test(s.rejected)));
  assert.equal(await worth.get('project:musing'), null);
  assert.equal((await worth.get('self:ponder')).confidence, 0);
}));

test('a stalled or budget-exhausted run is an observed failure of self:ponder; a transport crash or convergence is not', async () => database(async pool => {
  let now = 10 * DAY;
  const worth = createWorthLedger({ pool, clock: () => now });
  await worth.seed();
  const mk = reason => createPonderQueue({ pool, reason, clock: () => now, worth });
  const c1 = await mk(stalled).enqueue({ seed: 'Stall', evidence });
  await mk(stalled).runNext(c1.chain_id);
  let self = await worth.get('self:ponder');
  assert.equal(self.signals.observed, 1); assert.ok(self.worth < 0.5);
  const c2 = await mk(crashed).enqueue({ seed: 'Crash', evidence });
  await mk(crashed).runNext(c2.chain_id);
  const c3 = await mk(converged).enqueue({ seed: 'Converge', evidence });
  await mk(converged).runNext(c3.chain_id);
  self = await worth.get('self:ponder');
  assert.equal(self.signals.observed, 1, 'neither a fetch failure nor a converged plan changes the track record');
}));

test('an interest-originated inquiry inherits its parent stakes and gets no rating of its own', async () => database(async pool => {
  let now = 10 * DAY;
  const worth = createWorthLedger({ pool, clock: () => now });
  await worth.seed();
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth });
  const engine = createInterestEngine({ pool, queue, clock: () => now });
  const parent = await queue.enqueue({ seed: 'Resolve the build', topic: 'Build', evidence });
  await queue.runNext(parent.chain_id);
  const { originated } = await engine.sync();
  assert.ok(originated, 'the blocked parent originates an inquiry');
  const child = await queue.get(originated.chain_id);
  assert.ok(child.want.stakes.some(s => s.entityKey === parent.want.outcomeKey), 'child stakes include the parent outcome');
  assert.ok(child.want.stakes.some(s => s.entityKey === 'project:build'));
  assert.equal(child.want.stakes.filter(s => s.entityKey === 'project:build').length, 1, 'inherited and topic-derived project stakes are deduplicated');
  const childOutcome = await worth.get(child.want.outcomeKey);
  assert.equal(childOutcome, null, 'the engine asking itself is not a rating');
  assert.ok(child.want.value <= 0.6);
}));

test('legacy wants are adopted once: an explicit one is rated by its requester, a child inherits, both become priced', async () => database(async pool => {
  let now = 10 * DAY;
  const worth = createWorthLedger({ pool, clock: () => now });
  await worth.seed();
  const legacy = createPonderQueue({ pool, reason: blocked, clock: () => now });          // no ledger: saves wants without stakes
  const parent = await legacy.enqueue({ seed: 'Old explicit request', topic: 'Legacy Topic', priority: 0.9, evidence });
  const child = await legacy.enqueue({ seed: 'Old child', evidence }, { origin: { kind: 'interest', parentChainId: parent.chain_id } });
  assert.equal(parent.want.stakes, undefined);
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth });
  assert.equal((await queue.hunger()).wants.every(w => w.hunger.unpriced), true, 'unpriced until adopted');
  await pool.query(`UPDATE thought_chains SET status = 'stalled' WHERE id = $1`, [child.chain_id]);   // a pre-rotation stall
  assert.deepEqual(await queue.adoptLegacyWants(), { adopted: 2, reopened: 1 });
  assert.deepEqual(await queue.adoptLegacyWants(), { adopted: 0, reopened: 0 });
  assert.equal((await queue.get(child.chain_id)).status, 'pondering', 'a legacy stall is claimable under rotation');
  const p = await queue.get(parent.chain_id), c = await queue.get(child.chain_id);
  assert.equal(p.want.outcomeKey, `outcome:ponder-legacy-${parent.chain_id}`);
  assert.deepEqual(p.want.stakes.map(s => s.entityKey), [p.want.outcomeKey, 'project:legacy-topic']);
  const outcome = await worth.get(p.want.outcomeKey);
  assert.equal(outcome.signals.rated, 1); assert.ok(outcome.worth > 0.8, 'stated priority 0.9 became a prior');
  assert.equal(p.want.pricing.provenance, 'rated'); assert.equal(p.hunger.unpriced, false);
  assert.ok(c.want.stakes.some(s => s.entityKey === p.want.outcomeKey), 'child inherits the parent outcome');
  assert.equal(await worth.get(c.want.outcomeKey), null, 'a child gets no rating of its own');
  const { rows: [{ n }] } = await pool.query("SELECT COUNT(*)::int AS n FROM worth_signals WHERE kind = 'rated'");
  assert.equal(n, 1);
}));

test('without a ledger the queue behaves exactly as before', async () => database(async pool => {
  const queue = createPonderQueue({ pool, reason: blocked });
  const chain = await queue.enqueue({ seed: 'Legacy', topic: 'Old', evidence, priority: 0.3 });
  assert.equal(chain.want.value, 0.3); assert.equal(chain.want.stakes, undefined); assert.equal(chain.want.outcomeKey, undefined);
  assert.equal((await queue.hunger()).pricing, 'explicit_priority');
  const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM worth_signals');
  assert.equal(n, 0);
}));
