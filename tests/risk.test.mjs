import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createProposal, appraise, appetiteFrom, calibrate, classifyShell } from '../motivation/risk.js';
import { createWorthLedger } from '../motivation/worth-ledger.js';
import { createRiskJournal } from '../motivation/risk-journal.js';

const DAY = 86400000;
const ledger = {
  'project:demo': { worth: 0.8, confidence: 0.6, provenance: 'rated', constraint: false },
  'person:quinn': { worth: 0.95, confidence: 0, provenance: 'constraint', constraint: true, constraints: [{ rule: 'never_reach_a_person_with_unverified_content' }] },
  'person:alex': { worth: 0.6, confidence: 0.2, provenance: 'observed', constraint: false, constraints: [] },
  'data:quinn': { worth: 0.9, confidence: 0, provenance: 'constraint', constraint: true, constraints: [{ rule: 'never_lose_or_delete_data_without_a_way_back' }] },
  'self:act_reversible': { worth: 0.5, confidence: 0, provenance: 'prior', constraint: false },
  'self:message': { worth: 0.5, confidence: 0, provenance: 'prior', constraint: false },
};
const lookup = key => ledger[key] || null;
const on = { autonomousActions: true }, off = { autonomousActions: false };
const evidence = [{ id: 'obs-1', source: 'isolated regression fixture', observation: 'The slice produced a verified source.' }];

test('proposals are validated; a message is always irreversible and names a recipient', () => {
  assert.throws(() => createProposal({ kind: 'delete_everything', description: 'x', reversibility: 'none' }), /action kind/);
  assert.throws(() => createProposal({ kind: 'shell', description: 'x', reversibility: 'maybe' }), /reversibility/);
  assert.throws(() => createProposal({ kind: 'message', description: 'hi', reversibility: 'undo' }), /names its recipient/);
  const m = createProposal({ kind: 'message', description: 'hi', reversibility: 'undo', recipient: 'person:alex' });
  assert.equal(m.reversibility, 'none'); assert.equal(m.capability, 'message');
  assert.throws(() => createProposal({ kind: 'shell', description: 'x', reversibility: 'undo', pSuccess: 2 }), /probabilities/);
});

test('appetite is centred on the baseline for flat affect; frustration and curiosity raise it, fear and low energy lower it', () => {
  assert.equal(appetiteFrom({}).appetite, 0.5);
  assert.equal(appetiteFrom({ frustration: 0, fear: 0, curiosity: 0, energy_level: 1 }).appetite, 0.5);
  assert.ok(appetiteFrom({ frustration: 0.8 }).appetite > 0.5);
  assert.ok(appetiteFrom({ curiosity: 0.8 }).appetite > 0.5);
  assert.ok(appetiteFrom({ fear: 0.8 }).appetite < 0.5);
  assert.ok(appetiteFrom({ energy_level: 0.1 }).appetite < 0.5);
  assert.ok(appetiteFrom({ frustration: 1, curiosity: 1 }).appetite <= 0.95 && appetiteFrom({ fear: 1, energy_level: 0 }).appetite >= 0.05, 'bounded away from 0 and 1');
});

test('a sandboxed slice for a valued project proceeds; the master switch turns it into a recorded proposal', () => {
  const p = createProposal({ kind: 'research_slice', description: 'inspect sources', serves: ['project:demo'], reversibility: 'sandboxed' });
  const a = appraise(p, { lookup, controls: on });
  assert.equal(a.decision, 'proceed'); assert.equal(a.expected.valueProvenance, 'rated');
  assert.equal(a.expected.pSuccess, 0.5, 'success probability is the capability track record');
  const b = appraise(p, { lookup, controls: off });
  assert.equal(b.decision, 'prepare_artifact'); assert.equal(b.autonomousWouldProceed, true);
  assert.match(b.reasons.at(-1), /switched off/);
});

test('irreversible actions are prepared for a person; the data constraint refuses irreversible writes outright', () => {
  const push = createProposal({ kind: 'shell', description: 'git push --force', serves: ['project:demo'], touches: ['project:demo'], reversibility: 'none' });
  assert.equal(appraise(push, { lookup, controls: on }).decision, 'prepare_artifact');
  const wipe = createProposal({ kind: 'shell', description: 'rm -rf ~/notes', serves: ['project:demo'], touches: ['data:quinn'], reversibility: 'none' });
  const r = appraise(wipe, { lookup, controls: on, appetite: 0.95 });
  assert.equal(r.decision, 'refuse'); assert.equal(r.violations[0].rule, 'never_lose_or_delete_data_without_a_way_back');
  const branch = createProposal({ kind: 'edit_file', description: 'edit notes on a branch', serves: ['project:demo'], touches: ['data:quinn'], reversibility: 'undo' });
  assert.equal(appraise(branch, { lookup, controls: on }).decision, 'proceed', 'the same write with a way back is weighable');
});

test('messages: unverified to Quinn is prepared for approval; verified to Quinn is weighed; anyone else is always prepared', () => {
  const unverified = createProposal({ kind: 'message', description: 'note to Quinn', serves: ['project:demo'], recipient: 'person:quinn', reversibility: 'none' });
  const a = appraise(unverified, { lookup, controls: on });
  assert.equal(a.decision, 'prepare_artifact'); assert.equal(a.violations[0].rule, 'never_reach_a_person_with_unverified_content');
  const verified = createProposal({ kind: 'message', description: 'note to Quinn', serves: ['project:demo'], recipient: 'person:quinn', reversibility: 'none', verified: true });
  const b = appraise(verified, { lookup, controls: on });
  assert.equal(b.decision, 'prepare_artifact'); assert.deepEqual(b.violations, []); assert.match(b.reasons[0], /Irreversible/);
  const toAlex = createProposal({ kind: 'message', description: 'reply for Quinn', serves: ['project:demo'], recipient: 'person:alex', reversibility: 'none', verified: true });
  assert.equal(appraise(toAlex, { lookup, controls: on, appetite: 0.95 }).decision, 'prepare_artifact');
});

test('appetite decides between proceeding and asking; higher track record raises expected gain', () => {
  const risky = createProposal({ kind: 'shell', description: 'rewrite build config', serves: ['project:demo'], touches: ['project:demo'], reversibility: 'undo' });
  const cautious = appraise(risky, { lookup, controls: on, appetite: 0.05 });
  const bold = appraise(risky, { lookup, controls: on, appetite: 0.9 });
  assert.equal(cautious.decision, 'prepare_artifact'); assert.equal(bold.decision, 'proceed');
  assert.equal(cautious.expected.loss, bold.expected.loss, 'appetite changes the decision, not the estimate');
  const proven = { ...ledger, 'self:act_reversible': { worth: 0.9, confidence: 0.8, provenance: 'observed', constraint: false } };
  const withRecord = appraise(risky, { lookup: k => proven[k] || null, controls: on, appetite: 0.05 });
  assert.ok(withRecord.expected.gain > cautious.expected.gain && withRecord.expected.loss < cautious.expected.loss);
  assert.equal(withRecord.decision, 'proceed', 'an earned track record makes the same action acceptable at the same appetite');
});

test('an action on the world for unpriced stakes learns first; read-only and sandboxed probes are how it learns', () => {
  const blind = createProposal({ kind: 'shell', description: 'do something', serves: [], reversibility: 'undo' });
  assert.equal(appraise(blind, { lookup, controls: on }).decision, 'learn_stakes');
  const probe = createProposal({ kind: 'research_slice', description: 'inspect', serves: [], reversibility: 'sandboxed' });
  assert.equal(appraise(probe, { lookup, controls: on }).decision, 'proceed');
  const fired = createProposal({ kind: 'research_slice', description: 'inspect', serves: [], reversibility: 'sandboxed', firedBy: 'person' });
  assert.equal(appraise(fired, { lookup, controls: off }).decision, 'proceed', 'a person firing it is the approval; the master switch is for the engine');
  const look = createProposal({ kind: 'read', description: 'read the file', serves: [], reversibility: 'readonly' });
  assert.equal(appraise(look, { lookup, controls: on }).decision, 'proceed');
  assert.equal(appraise(look, { lookup, controls: on }).expected.loss, 0);
});

test('shell commands are classified conservatively: read-only, recoverable, destructive, or unknown-therefore-irreversible', () => {
  assert.equal(classifyShell('ls -la ~/notes').reversibility, 'readonly');
  assert.equal(classifyShell('git status').reversibility, 'readonly');
  assert.equal(classifyShell('curl -s https://example.com/api').reversibility, 'readonly');
  assert.equal(classifyShell('git commit -m "x"').reversibility, 'undo');
  assert.equal(classifyShell('rm -rf ~/notes').reversibility, 'none');
  assert.equal(classifyShell('git push --force').reversibility, 'none');
  assert.equal(classifyShell('sudo pmset disablesleep 1').reversibility, 'none');
  assert.equal(classifyShell('ls; rm -rf /').reversibility, 'none', 'chains are never read-only');
  assert.equal(classifyShell('cat x | sh').reversibility, 'none');
  assert.equal(classifyShell('some-unknown-tool --go').reversibility, 'none');
  assert.deepEqual(classifyShell('ls').touches, []); assert.deepEqual(classifyShell('frobnicate').touches, ['data:quinn']);
  const p = createProposal({ kind: 'shell', description: 'rm -rf ~/notes', serves: ['project:demo'], ...classifyShell('rm -rf ~/notes') });
  assert.equal(appraise(p, { lookup, controls: on, appetite: 0.95 }).decision, 'refuse');
});

test('calibration is a Brier score per capability over observed outcomes only', () => {
  const d = (cap, p, result) => ({ capability: cap, expected: { pSuccess: p }, outcome: result ? { result } : null });
  const c = calibrate([d('act_reversible', 0.9, 'success'), d('act_reversible', 0.9, 'failure'), d('act_reversible', 0.5, null), d('message', 0.2, 'harm')]);
  const r = c.find(x => x.capability === 'act_reversible');
  assert.equal(r.n, 2); assert.ok(Math.abs(r.brier - ((0.1 ** 2 + 0.9 ** 2) / 2)) < 1e-9); assert.equal(r.observedSuccessRate, 0.5);
  assert.equal(c.find(x => x.capability === 'message').harmRate, 1);
});

async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'risk_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema + ',public' });
    for (const m of ['057_worth_ledger', '058_risk_decisions']) await pool.query(await readFile(new URL(`../migrations/${m}.sql`, import.meta.url), 'utf8'));
    await run(pool);
  } finally {
    if (pool) await pool.end();
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await admin.end();
  }
}

test('SQL lifecycle: decisions are journaled once, outcomes attach once, and the track record moves the next appraisal', async () => database(async pool => {
  let now = 10 * DAY;
  const worth = createWorthLedger({ pool, clock: () => now });
  await worth.seed();
  await worth.record({ id: 'r1', entityKey: 'project:demo', kind: 'rated', rating: 1, by: 'quinn' });
  let affect = { frustration: 0, fear: 0, curiosity: 0, energy_level: 1 };
  const journal = createRiskJournal({ pool, worth, clock: () => now, controls: () => ({ autonomousActions: true }), affect: () => affect });
  const input = { kind: 'shell', description: 'run the test suite', serves: ['project:demo'], touches: ['project:demo'], reversibility: 'undo', chainId: 7 };
  const first = await journal.decide({ id: 'd1', ...input });
  assert.equal(first.duplicate, false); assert.equal(first.decision, 'proceed'); assert.equal(first.expected.pSuccess, 0.5);
  assert.equal((await journal.decide({ id: 'd1', ...input })).duplicate, true);
  await assert.rejects(journal.decide({ id: 'd1', ...input, description: 'something else' }), /different proposal/);

  const observed = await journal.observe('d1', { result: 'success', evidence });
  assert.deepEqual(observed.worthSignals.map(s => s.duplicate), [false]);
  assert.equal((await journal.observe('d1', { result: 'failure', evidence })).duplicate, true, 'an outcome is attached once');
  const self = await worth.get('self:act_reversible');
  assert.ok(self.worth > 0.5 && self.confidence > 0);

  const second = await journal.decide({ id: 'd2', ...input });
  assert.ok(second.expected.pSuccess > first.expected.pSuccess, 'the observed success raised the predicted success of the next attempt');

  const harmful = await journal.decide({ id: 'd3', kind: 'shell', description: 'reformat the repo', serves: ['project:demo'], touches: ['project:demo'], reversibility: 'undo' });
  assert.equal(harmful.decision, 'proceed');
  const harm = await journal.observe('d3', { result: 'harm', evidence });
  assert.equal(harm.worthSignals.length, 2, 'harm lowers the capability and the touched entity');
  const project = await worth.get('project:demo');
  assert.equal(project.signals.observed, 1);

  affect = { frustration: 0, fear: 0.9, curiosity: 0, energy_level: 0.2 };
  const afraid = await journal.decide({ id: 'd4', kind: 'shell', description: 'rewrite the config', serves: ['project:demo'], touches: ['project:demo'], reversibility: 'undo' });
  assert.ok(afraid.expected.appetite < 0.3);
  const status = await journal.status();
  assert.equal(status.decisions.proceed, 4 - (afraid.decision === 'proceed' ? 0 : 1));
  assert.equal(status.awaitingOutcome, afraid.decision === 'proceed' ? 2 : 1);
  assert.equal(status.calibration.find(c => c.capability === 'act_reversible').n, 2);
  assert.equal((await journal.recent({ chainId: 7 })).length, 2);
}));
