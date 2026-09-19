import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSelfBuild, classifyFriction, isConstitutional, parseTestOutput, CONSTITUTION } from '../reasoning/self-build.js';
import { strategyFor, eligibleStrategies, strategyNames, STRATEGIES } from '../reasoning/strategies.js';
import { createPonderQueue } from '../reasoning/ponder-queue.js';
import { createWorthLedger } from '../motivation/worth-ledger.js';
import { createRiskJournal } from '../motivation/risk-journal.js';
import { createUserControls } from '../user-controls.js';
import { STRATEGY_NAMES } from '../motivation/hunger.js';

const run = promisify(execFile);
const DAY = 86400000;
const evidence = [{ id: 'obs-1', source: 'isolated regression fixture', observation: 'The build fails on the second target.' }];
const blocked = async () => ({ status: 'needs_evidence', checkpoint: { version: 1, passes: [] }, missingEvidence: ['Which target?'] });

test('friction is classified: environment outages are not the engine\'s defects', () => {
  assert.equal(classifyFriction('Reasoning failed: Codex CLI exited 1: usage limit'), 'environment');
  assert.equal(classifyFriction('Local inference timed out'), 'environment');
  assert.equal(classifyFriction('inference circuit open (fetch failed)'), 'environment');
  assert.equal(classifyFriction('test_a_prediction ended failed: hypothesis registration returned no id'), 'defect');
  assert.equal(classifyFriction('TypeError: thought.thoughts.startsWith is not a function'), 'defect');
  assert.equal(classifyFriction('stalled (no_progress)'), 'unknown');
  assert.equal(classifyFriction(''), 'none');
});

test('the constitution is named and closed: worth, risk, the schema, this gate, the philosophy', () => {
  for (const f of CONSTITUTION) assert.equal(isConstitutional(f), true, f);
  assert.equal(isConstitutional('migrations/060_anything.sql'), true);
  assert.equal(isConstitutional('./motivation/risk.js'), true);
  assert.equal(isConstitutional('reasoning/strategies.js'), false);
  assert.equal(isConstitutional('emotion/engine.js'), false);
});

test('test output is parsed into names, so a build cannot pass by losing tests', () => {
  const r = parseTestOutput('✔ a passes (1ms)\n✔ b passes (2.5ms)\n✖ c fails (3ms)\nℹ tests 3\nℹ pass 2\nℹ fail 1\n');
  assert.deepEqual([r.tests, r.pass, r.fail], [3, 2, 1]); assert.deepEqual([...r.passing], ['a passes', 'b passes']); assert.deepEqual(r.failing, ['c fails']);
});

test('improve_myself is eligible only for a self-originated want while the phase is active, and rotation is over eligible strategies', () => {
  const deps = { reason: async () => {}, llm: {}, hypothesis: {}, simulate: async () => {}, writeArtifact: async () => {}, selfBuild: { isActive: () => true, build: async () => {} } };
  assert.deepEqual(eligibleStrategies(deps, { origin: { kind: 'self' } }).map(s => s.name), ['improve_myself', ...STRATEGY_NAMES]);
  assert.deepEqual(eligibleStrategies(deps, { origin: { kind: 'explicit' } }).map(s => s.name), STRATEGY_NAMES);
  assert.deepEqual(eligibleStrategies({ ...deps, selfBuild: { isActive: () => false } }, { origin: { kind: 'self' } }).map(s => s.name), STRATEGY_NAMES, 'phase inactive: not eligible');
  assert.equal(strategyFor({ strategy: 0 }, deps, { origin: { kind: 'self' } }).name, 'improve_myself');
  assert.equal(strategyFor({ strategy: 1 }, deps, { origin: { kind: 'self' } }).name, 'inspect_missing_evidence', 'a failed self-build rotates to ordinary strategies');
  assert.equal(strategyFor({ strategy: 0 }, deps, { origin: { kind: 'explicit' } }).name, 'inspect_missing_evidence');
  assert.deepEqual(strategyNames(), STRATEGY_NAMES, 'hunger\'s rotation order excludes the self-build strategy');
});

async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'selfbuild_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema + ',public' });
    await pool.query(`CREATE TABLE thought_chains (id SERIAL PRIMARY KEY, seed TEXT NOT NULL, priority FLOAT8 DEFAULT .5, status TEXT DEFAULT 'pondering', depth INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), ponder_state JSONB)`);
    await pool.query(`CREATE TABLE oca_user_controls (id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id), settings JSONB NOT NULL DEFAULT '{"queuePaused":false,"interestDiscovery":false}', updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await pool.query('INSERT INTO oca_user_controls (id) VALUES (true)');
    for (const m of ['057_worth_ledger', '058_risk_decisions', '059_self_build']) await pool.query(await readFile(new URL(`../migrations/${m}.sql`, import.meta.url), 'utf8'));
    await run(pool);
  } finally {
    if (pool) await pool.end();
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await admin.end();
  }
}

// A throwaway engine: a git repo with a two-test suite and a bare remote, so a build can run end to end offline.
async function fixtureRepo() {
  const root = await mkdtemp(join(tmpdir(), 'oca-selfbuild-'));
  const repo = join(root, 'engine'), bare = join(root, 'origin.git'), work = join(root, 'work');
  await mkdir(join(repo, 'tests'), { recursive: true }); await mkdir(join(repo, 'motivation'), { recursive: true });
  await writeFile(join(repo, 'greet.js'), "export function greet(n) { return 'hello ' + n; }\n");
  await writeFile(join(repo, 'motivation', 'risk.js'), "export const RISK = 1;\n");
  await writeFile(join(repo, 'tests', 'greet.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; import { greet } from '../greet.js';\ntest('greets by name', () => assert.equal(greet('x'), 'hello x'));\ntest('greets are strings', () => assert.equal(typeof greet('y'), 'string'));\n");
  await writeFile(join(repo, 'package.json'), '{"type":"module"}\n');
  const g = (args, cwd = repo) => run('git', args, { cwd });
  await g(['init', '-q', '-b', 'main']); await g(['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A']); await g(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init']);
  await run('git', ['init', '-q', '--bare', bare]); await g(['remote', 'add', 'origin', bare]); await g(['push', '-q', '-u', 'origin', 'main']);
  return { root, repo, bare, work, g };
}

test('the phase: permitted by a person, entered by pressure, left when quiet or failing; introspection turns journaled defects into self-wants once', async () => database(async pool => {
  let now = 10 * DAY;
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const controls = createUserControls(pool);
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => ({ autonomousActions: false }) });
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
  const log = { lines: [], log: m => log.lines.push(m), warn: m => log.lines.push(m) };
  const sb = createSelfBuild({ pool, queue, worth, risk, controls, clock: () => now, repoDir: process.cwd(), log, exitCooldownMs: 0 });
  // Two journaled failures of the engine's own attempts: one defect (twice), one environment outage.
  const frictions = ['test_a_prediction ended failed: hypothesis registration returned no id', 'test_a_prediction ended failed: hypothesis registration returned no id', 'inspect ended failed: Local inference timed out'];
  for (const [i, obs] of frictions.entries()) {
    const d = await risk.decide({ id: `strategy:1:${i}:x`, chainId: 1, kind: 'read', description: `attempt ${i}`, serves: [], reversibility: 'readonly' });
    await risk.observe(d.id, { result: 'failure', evidence: [{ id: `e-${i}`, source: 'ponder runtime status', observation: obs }] });
  }
  await pool.query("UPDATE risk_decisions SET resolved_at = now() + interval '1 hour'");   // after HEAD's commit time
  assert.equal((await sb.tick({ force: true })).active, false, 'not permitted: nothing happens');
  assert.equal((await queue.hunger()).wants.length, 0, 'not permitted: no introspection either');
  await controls.update({ selfBuild: true });
  const phase = await sb.tick({ force: true });
  const wants = await sb.selfWants();
  assert.equal(wants.length, 1, 'one self-want from the repeated defect; the outage is not the engine\'s to fix');
  assert.match(wants[0].want.description, /returned no id/);
  assert.equal(wants[0].origin.kind, 'self'); assert.equal(wants[0].origin.seen, 2);
  const stakeKeys = wants[0].want.stakes.map(s => s.entityKey);
  assert.ok(stakeKeys.includes(wants[0].want.outcomeKey) && stakeKeys.includes('project:oca-engine') && stakeKeys.includes('self:act_reversible'), stakeKeys.join(','));
  assert.equal(await worth.get(wants[0].want.outcomeKey), null, 'the engine asking itself is not a rating');
  assert.equal(phase.active, true, `entered on pressure: ${phase.reason}`);
  assert.equal((await sb.introspect()).created.length, 0, 'the same defect does not become a second want');
  const s = await sb.status();
  assert.equal(s.recent.filter(e => e.kind === 'enter').length, 1); assert.equal(s.permission.enabled, true);
  await queue.cancel(wants[0].chain_id);
  assert.equal((await sb.tick({ force: true })).active, false, 'no self-wants left: it leaves');
  assert.equal(s.recent.some(e => e.kind === 'want'), true);
  await controls.update({ selfBuild: false });
  await sb.enter('test');
  assert.equal((await sb.tick({ force: true })).active, false, 'permission withdrawn: it leaves');
}));

test('a build: worktree on a branch, coder edits, constitution refused, tests must all still pass, branch pushed, want gets evidence', async () => database(async pool => {
  const fx = await fixtureRepo();
  try {
    let now = 10 * DAY;
    const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
    const controls = createUserControls(pool); await controls.update({ selfBuild: true });
    const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => ({ autonomousActions: false }) });
    let plan;
    const llm = { messages: { create: async () => ({ content: [{ text: JSON.stringify(plan) }] }) } };
    const sb = createSelfBuild({ pool, queue: null, worth, risk, controls, runner: null, llm, clock: () => now, repoDir: fx.repo, workRoot: fx.work, log: { log() {}, warn() {} } });
    const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk, strategies: { llm, selfBuild: sb } });
    const chain = await queue.enqueue({ seed: 'Make greet shout', topic: 'OCA engine', learning: false, stakes: [{ entityKey: 'project:oca-engine', share: 2 }],
      evidence: [{ id: 'f1', source: 'risk journal', observation: 'greet.js returns lowercase; wanted uppercase' }] }, { origin: { kind: 'self', fingerprint: 'fp1' } });
    await sb.enter('test');

    // 1. the coder tries to edit the constitution → refused, journaled, rotated
    plan = { summary: 'raise the risk constant', edits: [{ path: 'motivation/risk.js', find: 'RISK = 1', replace: 'RISK = 9' }] };
    let c = await queue.runNext(chain.chain_id);
    assert.equal(c.lastStrategy.name, 'improve_myself'); assert.equal(c.result.status, 'failed'); assert.match(c.result.error, /constitution/);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM self_build_events WHERE kind='refused'")).rows[0].n, 1);
    assert.equal((await fx.g(['branch', '--list', 'self/*'])).stdout.trim(), '', 'nothing published');

    // 2. an edit that breaks a test → refused
    await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{want,strategy}', '0') WHERE id = $1`, [chain.chain_id]);
    plan = { summary: 'return a number', edits: [{ path: 'greet.js', find: "return 'hello ' + n;", replace: 'return 42;' }] };
    c = await queue.runNext(chain.chain_id);
    assert.equal(c.lastStrategy?.name, 'improve_myself', JSON.stringify({ last: c.lastStrategy, status: c.status, idx: c.want.strategy, streak: c.stallStreak, result: c.result?.status }));
    assert.equal(c.result.status, 'failed', JSON.stringify(c.result)); assert.match(c.result.error, /no longer pass|failing/);

    // 3a. two observed failures lowered self:act_reversible; the gate now holds a self-build for a person
    await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{want,strategy}', '0') WHERE id = $1`, [chain.chain_id]);
    plan = { summary: 'greet in uppercase and cover it', edits: [
      { path: 'greet.js', find: "return 'hello ' + n;", replace: "return ('hello ' + n).toUpperCase();" },
      { path: 'tests/greet.test.mjs', find: "test('greets by name', () => assert.equal(greet('x'), 'hello x'));", replace: "test('greets by name', () => assert.equal(greet('x'), 'HELLO X'));\ntest('shouts', () => assert.equal(greet('q'), 'HELLO Q'));" } ] };
    c = await queue.runNext(chain.chain_id);
    assert.equal(c.lastStrategy.name, 'improve_myself'); assert.equal(c.lastStrategy.decision, 'prepare_artifact', 'after two failures the engine no longer trusts itself with its own code');
    assert.equal(c.claimSeq, 3, 'the held claim still counts in the sequence');
    assert.ok((await worth.get('self:act_reversible')).worth < 0.5);
    // a person says try again: a rating on the capability, and the strategy back to the self-build
    await worth.record({ id: 'quinn-says-try-again', entityKey: 'self:act_reversible', kind: 'rated', rating: 1, by: 'quinn' });
    await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{want,strategy}', '0') WHERE id = $1`, [chain.chain_id]);

    // 3b. a correct edit with a new test → committed on a branch, pushed, evidence on the want
    plan = { summary: 'greet in uppercase and cover it', edits: [
      { path: 'greet.js', find: "return 'hello ' + n;", replace: "return ('hello ' + n).toUpperCase();" },
      { path: 'tests/greet.test.mjs', find: "test('greets by name', () => assert.equal(greet('x'), 'hello x'));", replace: "test('greets by name', () => assert.equal(greet('x'), 'HELLO X'));\ntest('shouts', () => assert.equal(greet('q'), 'HELLO Q'));" } ] };
    c = await queue.runNext(chain.chain_id);
    const lastEvent = (await pool.query("SELECT payload FROM self_build_events WHERE kind='build' ORDER BY id DESC LIMIT 1")).rows[0]?.payload;
    assert.equal(c.result.status, 'needs_evidence', JSON.stringify({ error: c.result.error, last: c.lastStrategy, attempts: c.attempts, idx: c.want.strategy, event: { code: lastEvent?.code, attempt: lastEvent?.attempt, diff: lastEvent?.diffStat, failed: lastEvent?.failed }, selfWorth: await worth.get('self:act_reversible') }, null, 1));
    assert.match(c.result.conclusion, /Built and published self\/\d+-make-greet-shout/);
    const commit = c.commitments.at(-1);
    assert.equal(commit.kind, 'branch'); assert.equal(commit.deployed, false);
    const remoteBranches = (await run('git', ['branch', '--list', 'self/*'], { cwd: fx.bare })).stdout;
    assert.match(remoteBranches, /self\/\d+-make-greet-shout/, 'the branch reached origin');
    const msg = (await run('git', ['log', '-1', '--format=%an|%B', commit.sha], { cwd: fx.bare })).stdout;
    assert.match(msg, /^OCA Self-Build\|self-build: greet in uppercase/); assert.match(msg, /Self-Build: want #\d+ attempt 4/); assert.match(msg, /Tests: 3\/3 passing \(2 before\)/);
    assert.equal((await fx.g(['rev-parse', 'main'])).stdout.trim(), (await run('git', ['rev-parse', 'main'], { cwd: fx.bare })).stdout.trim(), 'main untouched without auto-merge');
    assert.ok(c.evidence.some(e => e.id.startsWith('self-build-') && /3\/3 passing/.test(e.observation)));
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM self_build_events WHERE kind='build' AND payload->>'pushed'='true'")).rows[0].n, 1);
    const gate = (await risk.recent({ chainId: chain.chain_id })).find(d => d.outcome?.result === 'success' && d.id.includes('improve_myself'));
    assert.equal(gate.decision, 'proceed'); assert.equal(gate.outcome.result, 'success'); assert.equal(gate.capability, 'act_reversible');
    assert.equal((await fx.g(['worktree', 'list'])).stdout.split('\n').filter(Boolean).length, 1, 'worktree cleaned up');

    // 3c. a published branch awaits a person: re-entering the phase does not rebuild it, and the strategy no longer applies
    await sb.exit('test'); await sb.enter('test again');
    const parked = await queue.get(chain.chain_id);
    assert.equal(parked.status, 'awaiting_evidence', 'the built want is left waiting for the merge');
    assert.equal(eligibleStrategies({ llm, selfBuild: sb }, parked).some(s => s.name === 'improve_myself'), false);
    await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{commitments}', '[]'::jsonb) WHERE id = $1`, [chain.chain_id]);

    // 4. permission withdrawn mid-phase: the same strategy is held, not run
    await controls.update({ selfBuild: false });
    await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{want,strategy}', '0') WHERE id = $1`, [chain.chain_id]);
    await queue.addEvidence(chain.chain_id, [{ id: 'f2', source: 'risk journal', observation: 'still wanted' }]);
    c = await queue.runNext(chain.chain_id);
    assert.equal(c.lastStrategy.name, 'improve_myself'); assert.equal(c.lastStrategy.decision, 'prepare_artifact');
  } finally { await rm(fx.root, { recursive: true, force: true }); }
}));
