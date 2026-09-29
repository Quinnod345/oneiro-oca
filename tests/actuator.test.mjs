import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { createActuator, isCoursework, guardedConsole, budgetCommitment, YES, NO } from '../reasoning/actuator.js';
import { createAsks } from '../reasoning/asks.js';
import { createPonderQueue } from '../reasoning/ponder-queue.js';
import { createWorthLedger } from '../motivation/worth-ledger.js';
import { createRiskJournal } from '../motivation/risk-journal.js';
import { createProposal, appraise } from '../motivation/risk.js';
import { normalizeCharter, DEFAULT_CHARTER } from '../user-controls.js';

const blocked = async () => ({ status: 'needs_evidence', checkpoint: { version: 1, passes: [] }, missingEvidence: ['x'] });
async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'act_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema + ',public' });
    await pool.query(`CREATE TABLE thought_chains (id SERIAL PRIMARY KEY, seed TEXT NOT NULL, priority FLOAT8 DEFAULT .5, status TEXT DEFAULT 'pondering', depth INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), ponder_state JSONB)`);
    await pool.query(`CREATE TABLE hypotheses (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(), domain TEXT, claim TEXT, confidence FLOAT8, prediction TEXT, prediction_deadline TIMESTAMPTZ, status TEXT, actual_outcome TEXT, tested_at TIMESTAMPTZ, source_type TEXT, source_data JSONB DEFAULT '{}'::jsonb)`);
    for (const m of ['057_worth_ledger', '058_risk_decisions', '063_agent_actions']) await pool.query(await readFile(new URL(`../migrations/${m}.sql`, import.meta.url), 'utf8'));
    await run(pool);
  } finally { if (pool) await pool.end(); await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end(); }
}

test('the charter is normalized: known classes, a ramp, a spend cap; defaults grant acting on the person\'s own accounts and hold messaging and deleting', () => {
  assert.equal(DEFAULT_CHARTER.publish.granted, true); assert.equal(DEFAULT_CHARTER.message.granted, false); assert.equal(DEFAULT_CHARTER.spend.monthlyCap, 500);
  const c = normalizeCharter({ message: { granted: true }, ramp: 0, spend: { granted: true, monthlyCap: 200 } });
  assert.equal(c.message.granted, true); assert.equal(c.ramp, 0); assert.equal(c.spend.monthlyCap, 200); assert.equal(c.publish.granted, true);
  assert.throws(() => normalizeCharter({ launch_rockets: { granted: true } }), /class must be one of/); assert.throws(() => normalizeCharter({ ramp: -1 }));
  assert.ok(YES.test('yes') && YES.test('Yep, do it') && YES.test('ok') && !YES.test('not yet')); assert.ok(NO.test('no') && NO.test("don't") && !NO.test('yes'));
  assert.ok(isCoursework('psu.instructure.com') && isCoursework('yellowdig.app') && isCoursework('www.pearson.com')); assert.ok(!isCoursework('www.instagram.com') && !isCoursework('x.com'));
});

test('a standing permission is the person firing a class in advance: it proceeds without the master switch, and a constraint still refuses', () => {
  const lookup = k => (k === 'project:demo' ? { worth: 0.7, confidence: 0.5, provenance: 'rated', weighable: true } : null);
  const p = createProposal({ kind: 'app_action', description: 'post the carousel', reversibility: 'undo', serves: ['project:demo'], standing: 'publish' });
  assert.equal(appraise(p, { lookup, controls: { autonomousActions: false, charter: { publish: { granted: true } } } }).decision, 'proceed');
  assert.equal(appraise(p, { lookup, controls: { autonomousActions: false, charter: { publish: { granted: false } } } }).decision, 'prepare_artifact', 'ungranted: the master switch still holds it');
  const plain = createProposal({ kind: 'app_action', description: 'post the carousel', reversibility: 'undo', serves: ['project:demo'] });
  assert.equal(appraise(plain, { lookup, controls: { autonomousActions: false, charter: { publish: { granted: true } } } }).decision, 'prepare_artifact', 'no standing named: nothing changes');
});

test('the actuator: granted classes proceed after the ramp; ungranted classes and every payment ask; a yes fires that one action, a no refuses; coursework is never submitted; outcomes are observed', async () => database(async pool => {
  let now = 40 * 86400000;
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  let charter = normalizeCharter({ ramp: 1, message: { granted: false } });
  const controls = { get: async () => ({ askOwner: true, autonomousActions: false, charter }) };
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => controls.get() });
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
  const sent = [];
  const asks = createAsks({ pool, risk, clock: () => now, log: { log() {}, warn() {} }, deliverers: { push: async m => { sent.push(m); } } }); await asks.init();
  const act = createActuator({ pool, risk, asks, controls, queue, clock: () => now, log: { log() {}, warn() {} } }); await act.init();
  const chain = await queue.enqueue({ seed: 'Launch InnerEcho on Instagram', doneWhen: 'the carousel is live', stakes: [{ entityKey: 'person:quinn', share: 1 }] }, { origin: { kind: 'explicit', by: 'quinn' } });
  const id = chain.chain_id;
  // 1. the first publish asks once (ramp); the ask is a real push with the exact question
  const a1 = await act.authorize({ chainId: id, class: 'publish', host: 'www.instagram.com', description: 'post the 5-slide carousel' });
  assert.equal(a1.decision, 'ask'); assert.ok(a1.askId); assert.match(a1.question, /^Oneiro wants to post the 5-slide carousel on www\.instagram\.com\. OK\? Reply yes or no\.$/); assert.equal(sent.length, 1);
  // not yet answered: still waiting
  assert.equal((await act.authorize({ chainId: id, class: 'publish', host: 'www.instagram.com', description: 'post the 5-slide carousel', approval: a1.askId })).decision, 'ask');
  // Quinn says yes → that action proceeds; its success completes the ramp
  await asks.answer(a1.askId, 'yes go ahead');
  const a2 = await act.authorize({ chainId: id, class: 'publish', host: 'www.instagram.com', description: 'post the 5-slide carousel', approval: a1.askId });
  assert.equal(a2.decision, 'proceed'); assert.equal(a2.approvedBy, a1.askId);
  await act.observe({ actionId: a2.actionId, result: 'success', observation: 'post live at instagram.com/p/abc' });
  // 2. the next publish needs nobody
  const a3 = await act.authorize({ chainId: id, class: 'publish', host: 'x.com', description: 'post the founder note' });
  assert.equal(a3.decision, 'proceed'); assert.equal(sent.length, 1, 'no second ask');
  const journal = (await risk.recent({ chainId: id })).find(x => x.id === `act:${a2.actionId}`);
  assert.equal(journal.decision, 'proceed'); assert.equal(journal.outcome.result, 'success');
  // 3. an ungranted class asks for each action; a no refuses
  const m1 = await act.authorize({ chainId: id, class: 'message', host: 'www.instagram.com', description: 'DM @someone about a collaboration' });
  assert.equal(m1.decision, 'ask'); await asks.answer(m1.askId, 'no');
  assert.equal((await act.authorize({ chainId: id, class: 'message', host: 'www.instagram.com', description: 'DM @someone about a collaboration', approval: m1.askId })).decision, 'refuse');
  // 4. spend: every payment asks, even well inside the cap; his yes fires that one payment; past the cap the question says so
  charter = normalizeCharter({ ramp: 0, spend: { granted: true, monthlyCap: 50 } });
  const s0 = await act.authorize({ chainId: id, class: 'spend', host: 'ads.x.com', description: 'boost the post for a day', cost: 30 });
  assert.equal(s0.decision, 'ask'); assert.match(s0.question, /\(cost \$30\.00\)\. Are you sure you want to go through with this\? Reply yes or no\.$/);
  assert.match((await act.recent()).find(r => r.id === s0.actionId).why, /every payment waits for Quinn's yes/);
  await asks.answer(s0.askId, 'yes');
  const s1 = await act.authorize({ chainId: id, class: 'spend', host: 'ads.x.com', description: 'boost the post for a day', cost: 30, approval: s0.askId });
  assert.equal(s1.decision, 'proceed'); await act.observe({ actionId: s1.actionId, result: 'success', observation: 'boost scheduled' });
  const s2 = await act.authorize({ chainId: id, class: 'spend', host: 'ads.x.com', description: 'boost it again', cost: 30 });
  assert.equal(s2.decision, 'ask'); assert.match((await act.recent()).find(r => r.id === s2.actionId).why, /past the \$50 cap/);
  assert.equal((await act.authorize({ chainId: id, class: 'spend', host: 'ads.x.com', description: 'no cost stated' })).decision, 'ask', 'a spend must state its cost');
  assert.equal(await act.monthSpend(), 30);
  // 5. coursework: never, whatever the charter says
  charter = normalizeCharter({ ramp: 0, submit: { granted: true }, publish: { granted: true } });
  const q = await act.authorize({ chainId: id, class: 'submit', host: 'psu.instructure.com', description: 'submit the quiz' });
  assert.equal(q.decision, 'refuse'); assert.match(q.why, /course or assessment site/);
  assert.equal((await act.authorize({ chainId: id, class: 'publish', host: 'yellowdig.app', description: 'post a discussion reply' })).decision, 'refuse');
  // 6. no pursuit, no action
  assert.equal((await act.authorize({ chainId: 9999, class: 'submit', host: 'example.com', description: 'save the settings' })).decision, 'refuse');
  // 7. an outcome is recorded once
  await assert.rejects(act.observe({ actionId: a2.actionId, result: 'success' }), /no proceeding action/);
}));

// Exact persisted production actions, replayed only in this test's isolated PostgreSQL schema.
const instagramFailures = JSON.parse(await readFile(new URL('./fixtures/instagram-retry-actions.json', import.meta.url), 'utf8'));
const requestOf = a => ({ chainId: a.chain_id, class: a.class, host: a.host, url: a.url, control: a.control, description: a.description });
async function storedAction(pool, a) {
  await pool.query(`INSERT INTO agent_actions (id, chain_id, class, host, url, control, description, decision, why, outcome, observation, created_at, observed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
  [a.id, a.chain_id, a.class, a.host, a.url, a.control, a.description, a.decision, a.why, a.outcome, a.observation, a.created_at, a.observed_at]);
}
const silent = { log() {}, warn() {} };
function retryHarness(pool) {
  const h = { asks: [], decisions: [], observations: [], reads: [], page: null, judge: null, charter: normalizeCharter({ ramp: 0 }) };
  h.options = { pool, controls: { get: async () => ({ charter: h.charter }) }, log: silent,
    asks: { ask: async a => { h.asks.push(a); return { id: 55 }; } },
    risk: { decide: async p => { h.decisions.push(p); return { decision: h.riskDecision || 'proceed', reasons: ['test risk refusal'] }; }, observe: async (id, o) => { h.observations.push({ id, ...o }); } },
    aside: { readPage: async source => { h.reads.push(source); if (!h.page) throw new Error('offline'); return h.page; } },
    llm: { messages: { create: async req => {
      const input = JSON.parse(req.messages[0].content);
      if (h.judge) return JSON.stringify(h.judge(input));
      return JSON.stringify({ relation: 'equivalent', recovered: !!input.recovery && input.recovery.text.includes('SUPPORTED RECOVERY:'), recoveryQuote: input.recovery?.text.split('\n').find(s => s.startsWith('SUPPORTED RECOVERY:')) || '', reason: 'fixture comparison' });
    } } } };
  h.act = () => createActuator(h.options);
  return h;
}

test('stored Instagram failures suppress equivalent commits across prompts, IDs, Continue, transport recovery and controller recreation', async () => database(async pool => {
  const h = retryHarness(pool);
  await storedAction(pool, instagramFailures[0]);
  const candidate = requestOf(instagramFailures[1]);
  for (const description of [candidate.description, `${candidate.description} Continue.`, `${candidate.description} Transport recovered; use a new tab and supported mobile route.`, 'Continue: change @getinnerecho website/profile link to exactly https://apps.apple.com/app/apple-store/id6683282892?mt=8&ct=ie_ig_202610&pt=127324920']) {
    const result = await h.act().authorize({ ...candidate, description });
    assert.equal(result.decision, 'refuse');
    assert.match(result.why, /47e442c3-1e3e-4815-bef8-a7abe84797c8/);
    assert.match(result.why, /mobile|Instagram mobile app/);
    assert.notEqual(result.actionId, instagramFailures[0].id);
  }
  await storedAction(pool, instagramFailures[1]);
  assert.equal((await h.act().authorize(candidate)).decision, 'refuse');
  assert.equal(h.decisions.length, 0, 'not a fresh risk appraisal or a commitment');
  assert.equal(h.asks.length, 0, 'retry suppression is not a permission ask');
  const rows = await h.act().recent();
  assert.equal(rows.filter(a => a.decision === 'proceed').length, 2, 'only the two stored historical attempts');
  assert.ok(rows.some(a => a.why.includes('Retry suppressed after')));
}));

test('terminal failure evidence survives noisy logs in persistence, risk evidence, and planner summaries', async () => database(async pool => {
  const { actionSummary, terminalObservation, actionObservation } = await import('../reasoning/action-retries.js');
  const h = retryHarness(pool);
  for (const fixture of instagramFailures) {
    const act = h.act();
    const a = await act.authorize({ ...requestOf(fixture), chainId: fixture.id === instagramFailures[0].id ? 81 : 82 });
    assert.equal(a.decision, 'proceed');
    await act.observe({ actionId: a.actionId, result: 'failure', observation: 'tool log noise '.repeat(400) + fixture.observation });
    const row = (await act.recent()).find(r => r.id === a.actionId);
    assert.match(actionObservation(row.observation).detail, /Editing your links is only available on mobile/);
    assert.match(h.observations.at(-1).evidence[0].observation, /mobile/);
    assert.match(h.observations.at(-1).evidence[0].source, new RegExp(a.actionId));
    assert.ok(h.observations.at(-1).evidence[0].source.includes(fixture.url));
    assert.match(actionSummary(row), /mobile/);
    assert.ok(actionSummary(row).includes(a.actionId) && actionSummary(row).includes(fixture.url));
    assert.match(terminalObservation(fixture.observation), /mobile/);
  }
}));

test('an external Meta app-account prerequisite stays a failed action without becoming an act_reversible defect', async () => database(async pool => {
  const h = retryHarness(pool);
  const meta = h.act();
  const candidate = { chainId: 83, class: 'submit', host: 'adsmanager.facebook.com', url: 'https://adsmanager.facebook.com/adsmanager/manage/campaigns',
    description: 'Save the existing unpublished InnerEcho app promotion draft' };
  assert.equal((await meta.authorize(candidate)).decision, 'ask', 'Meta\'s ads console waits for Quinn\'s yes, whatever the charter grants');
  // The attempt Quinn approved, replayed as stored, then observed failing on Meta's prerequisite.
  const action = { actionId: randomUUID() };
  await storedAction(pool, { id: action.actionId, chain_id: candidate.chainId, class: candidate.class, host: candidate.host, url: candidate.url, control: '', description: candidate.description,
    decision: 'proceed', why: 'approved by Quinn (ask #55)', outcome: null, observation: null, created_at: new Date(), observed_at: null });
  await meta.observe({ actionId: action.actionId, result: 'failure', observation: 'BLOCKED: Meta needs App Store ID 6683282892 connected as a valid `application_id` for this ad account. InnerEcho: Mental Health is not connected to your ad account. Missing or Invalid Field in Promoted Objects (#1815437).' });
  const stored = (await meta.recent()).find(a => a.id === action.actionId);
  assert.equal(stored.outcome, 'failure', 'the action remains failed so an equivalent commit cannot repeat');
  assert.equal(h.observations.at(-1).result, 'not_attempted', 'an external account prerequisite does not lower the engine capability record');
  assert.match(h.observations.at(-1).note, /External app\/account prerequisite/);
  assert.equal((await h.act().authorize(candidate)).decision, 'refuse', 'retry suppression still sees the failed action');

  const runtime = h.act();
  const engineFailure = await runtime.authorize({ ...candidate, chainId: 84, host: 'example.com', url: 'https://example.com/settings', description: 'Save the existing account settings' });
  await runtime.observe({ actionId: engineFailure.actionId, result: 'failure', observation: 'BLOCKED: actuator returned an invalid response schema.' });
  assert.equal(h.observations.at(-1).result, 'failure', 'engine defects remain capability failures');
}));

test('target-specific recovery is read independently, consumed once, and cannot bypass charter or risk', async () => database(async pool => {
  await storedAction(pool, instagramFailures[0]);
  const h = retryHarness(pool), candidate = requestOf(instagramFailures[1]);
  const quote = 'SUPPORTED RECOVERY: The @getinnerecho website link editor is now enabled on this supported route; the campaign URL has not been saved.';
  const retryEvidence = { source: candidate.url, quote };
  assert.equal((await h.act().authorize({ ...candidate, retryEvidence })).decision, 'refuse', 'unavailable source');
  h.page = { url: candidate.url, text: 'The existing browser transport recovered and the profile page is readable.' };
  assert.equal((await h.act().authorize({ ...candidate, retryEvidence })).decision, 'refuse', 'invented quote');
  assert.equal((await h.act().authorize({ ...candidate, retryEvidence: { ...retryEvidence, quote: h.page.text } })).decision, 'refuse', 'observed transport recovery is not editing capability');
  h.page = { url: candidate.url, text: quote };
  h.charter = normalizeCharter({ ramp: 0, submit: { granted: false } });
  assert.equal((await h.act().authorize({ ...candidate, retryEvidence })).decision, 'ask', 'evidence does not grant permission');
  h.charter = normalizeCharter({ ramp: 0 }); h.riskDecision = 'refuse';
  assert.equal((await h.act().authorize({ ...candidate, retryEvidence })).decision, 'refuse', 'risk still refuses');
  h.riskDecision = 'proceed';
  const concurrent = await Promise.all([h.act().authorize({ ...candidate, retryEvidence }), h.act().authorize({ ...candidate, retryEvidence })]);
  assert.deepEqual(concurrent.map(r => r.decision).sort(), ['proceed', 'refuse'], 'only one durable recovery claim across controllers');
  const permitted = concurrent.find(r => r.decision === 'proceed');
  await h.act().observe({ actionId: permitted.actionId, result: 'failure', observation: instagramFailures[1].observation });
  assert.equal((await h.act().authorize({ ...candidate, retryEvidence })).decision, 'refuse', 'observation survives recreation and observe');
  h.page.text += '\nDifferent tab ID and updated clock.';
  assert.equal((await h.act().authorize({ ...candidate, retryEvidence })).decision, 'refuse', 'unrelated page changes cannot reuse the same recovery fact');
}));

test('genuinely distinct targets, operations and desired values remain eligible; omitted identity and changed routes do not', async () => database(async pool => {
  await storedAction(pool, instagramFailures[0]);
  const h = retryHarness(pool), candidate = requestOf(instagramFailures[1]);
  for (const a of [
    { ...candidate, url: 'https://www.instagram.com/differentaccount/', description: candidate.description.replaceAll('@getinnerecho', '@differentaccount') },
    { ...candidate, class: 'publish' },
    { ...candidate, description: 'Change @getinnerecho bio to a concise introduction to InnerEcho.' },
    { ...candidate, description: candidate.description.replace('ct=ie_ig_202610', 'ct=ie_ig_202611') },
  ]) assert.equal((await h.act().authorize(a)).decision, 'proceed');
  for (const a of [
    { ...candidate, description: 'Continue the requested update on this profile.' },
    { ...candidate, url: 'https://www.instagram.com/accounts/edit/' },
    { ...candidate, control: 'Save profile in a new tab' },
    { ...candidate, description: `${candidate.description} Use https://mobile.example/ as a new route.` },
  ]) assert.equal((await h.act().authorize(a)).decision, 'refuse');
}));

test('unknown outcomes and transient failures require observed non-completion and recovery; historical blockers are not hidden by newer transport failure', async () => database(async pool => {
  const h = retryHarness(pool), candidate = { chainId: 92, class: 'submit', host: 'example.com', url: 'https://example.com/settings', control: 'Save', description: 'Save the account notification settings' };
  const initial = await h.act().authorize(candidate);
  assert.equal(initial.decision, 'proceed');
  assert.equal((await h.act().authorize(candidate)).decision, 'refuse', 'unknown outcome must be verified');
  await h.act().observe({ actionId: initial.actionId, result: 'failure', observation: 'Connection reset; outcome unknown.' });
  assert.equal((await h.act().authorize(candidate)).decision, 'refuse');
  const quote = 'SUPPORTED RECOVERY: The account notification settings still show the old value, the save request did not reach the server, and the connection works now.';
  h.page = { url: candidate.url, text: quote };
  const retry = await h.act().authorize({ ...candidate, retryEvidence: { source: candidate.url, quote } });
  assert.equal(retry.decision, 'proceed', 'one bounded transient retry');
  await h.act().observe({ actionId: retry.actionId, result: 'success', observation: 'The account settings now show the requested value.' });
  assert.equal((await h.act().authorize({ ...candidate, retryEvidence: { source: candidate.url, quote } })).decision, 'refuse', 'cannot consume the recovery again after success');
  await storedAction(pool, instagramFailures[0]);
  await storedAction(pool, { ...instagramFailures[1], observation: 'Aside runtime disposed; no page result.' });
  h.page = { url: instagramFailures[0].url, text: 'The transport is restored and the requested campaign URL has not been saved.' };
  h.judge = ({ previous, recovery }) => ({ relation: 'equivalent', recovered: !!recovery && previous.observation.includes('runtime disposed'), recoveryQuote: recovery?.text || '' });
  assert.equal((await h.act().authorize({ ...requestOf(instagramFailures[1]), retryEvidence: { source: h.page.url, quote: h.page.text } })).decision, 'refuse', 'older mobile blocker still applies');
}));

test('unavailable or ungrounded semantic comparison fails closed without a permission ask', async () => database(async pool => {
  await storedAction(pool, instagramFailures[0]);
  const h = retryHarness(pool), candidate = { ...requestOf(instagramFailures[1]), description: 'Apply the requested profile change from earlier.' };
  h.judge = () => ({ relation: 'distinct', candidateQuote: 'a quote that never appeared in the request', previousQuote: instagramFailures[0].description });
  assert.equal((await h.act().authorize(candidate)).decision, 'refuse');
  h.options.llm = null;
  assert.equal((await h.act().authorize(candidate)).decision, 'refuse');
  assert.equal(h.asks.length, 0);
}));

test('simultaneous authorizations with a single database connection claim only one equivalent action', { timeout: 10000 }, async () => database(async pool => {
  const single = new pg.Pool({ ...pool.options, max: 1 });
  try {
    const h = retryHarness(single);
    const candidate = { chainId: 93, class: 'submit', host: 'example.com', url: 'https://example.com/settings', description: 'Save the account notification settings' };
    const results = await Promise.all(Array.from({ length: 12 }, () => h.act().authorize(candidate)));
    assert.equal(results.filter(r => r.decision === 'proceed').length, 1);
    assert.equal(results.filter(r => r.decision === 'refuse').length, 11);
    assert.equal(h.asks.length, 0);
  } finally { await single.end(); }
}));

test('route aliases, unrelated recovery sources, changed metadata and missing model evidence cannot reopen a failure', async () => database(async pool => {
  await storedAction(pool, instagramFailures[0]);
  const h = retryHarness(pool), candidate = requestOf(instagramFailures[1]);
  for (const host of ['instagram.com', 'm.instagram.com', 'WWW.INSTAGRAM.COM']) {
    assert.equal((await h.act().authorize({ ...candidate, host, url: candidate.url.replace('www.instagram.com', host) })).decision, 'refuse');
  }
  const quote = 'SUPPORTED RECOVERY: The @getinnerecho website link editor is enabled and the desired campaign URL is not yet saved.';
  h.page = { url: 'https://unrelated.example/recovery', text: quote };
  assert.equal((await h.act().authorize({ ...candidate, retryEvidence: { source: h.page.url, quote } })).decision, 'refuse');
  h.page.url = candidate.url;
  h.judge = () => ({ relation: 'equivalent', recovered: true, recoveryQuote: 'A fabricated supported editing route observation.' });
  assert.equal((await h.act().authorize({ ...candidate, retryEvidence: { source: h.page.url, quote } })).decision, 'refuse');
  h.options.llm = null;
  assert.equal((await h.act().authorize({ ...candidate, retryEvidence: { source: h.page.url, quote } })).decision, 'refuse');
  assert.equal(h.asks.length, 0);
}));

test('Apple and Meta consoles always ask; every payment asks; a daily budget counts what it commits through the month, and lowering it asks nothing', async () => database(async pool => {
  const now = Date.parse('2026-09-28T12:00:00');   // local noon; September has 30 days, so 3 days are left
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const charter = normalizeCharter({ ramp: 0, publish: { granted: true }, submit: { granted: true }, spend: { granted: true, monthlyCap: 500 } });
  const controls = { get: async () => ({ askOwner: true, autonomousActions: false, charter }) };
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => controls.get() });
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
  const sent = [];
  const asks = createAsks({ pool, risk, clock: () => now, log: silent, deliverers: { push: async m => { sent.push(m); } } }); await asks.init();
  let external = 0, externalFails = false;
  const act = createActuator({ pool, risk, asks, controls, queue, clock: () => now, log: silent,
    externalSpend: async () => { if (externalFails) throw new Error('broker offline'); return external; } }); await act.init();
  const id = (await queue.enqueue({ seed: 'Grow InnerEcho', doneWhen: 'a profitable month', stakes: [{ entityKey: 'person:quinn', share: 1 }] }, { origin: { kind: 'explicit', by: 'quinn' } })).chain_id;
  const why = async r => (await act.recent()).find(x => x.id === r.actionId).why;

  assert.equal(guardedConsole('appstoreconnect.apple.com').owner, 'Apple'); assert.equal(guardedConsole('app.searchads.apple.com').owner, 'Apple');
  assert.equal(guardedConsole('www.facebook.com', 'https://www.facebook.com/adsmanager/manage').owner, 'Meta'); assert.equal(guardedConsole('www.facebook.com', 'https://www.facebook.com/getinnerecho'), null);
  assert.equal(guardedConsole('ads.x.com').always, false); assert.equal(guardedConsole('www.instagram.com'), null); assert.equal(guardedConsole('apps.apple.com'), null);

  // 1. Apple: a granted class still asks, and says why; signing in is not a commitment
  const p = await act.authorize({ chainId: id, class: 'publish', host: 'appstoreconnect.apple.com', url: 'https://appstoreconnect.apple.com/apps/1/distribution', description: 'save new promotional text' });
  assert.equal(p.decision, 'ask'); assert.match(await why(p), /Apple's console/); assert.match(p.question, /save new promotional text on appstoreconnect\.apple\.com/);
  const done = async r => { assert.equal(r.decision, 'proceed', r.why); await act.observe({ actionId: r.actionId, result: 'success', observation: 'done' }); return r; };
  await done(await act.authorize({ chainId: id, class: 'sign_in', host: 'appstoreconnect.apple.com', description: 'sign in to App Store Connect' }));
  // 2. Meta: even a costed spend under the cap asks; an ordinary page is not the ads console
  assert.equal((await act.authorize({ chainId: id, class: 'spend', host: 'adsmanager.facebook.com', description: 'publish the InnerEcho campaign', cost: 40 })).decision, 'ask');
  assert.equal((await act.authorize({ chainId: id, class: 'submit', host: 'www.facebook.com', url: 'https://www.facebook.com/adsmanager/manage/campaigns', description: 'save the campaign draft' })).decision, 'ask');
  await done(await act.authorize({ chainId: id, class: 'publish', host: 'www.facebook.com', url: 'https://www.facebook.com/getinnerecho', description: 'post the launch note to the page' }));
  // 3. other ad consoles: an uncosted save asks; a costed spend asks too, like every payment, and his yes fires it
  const x = await act.authorize({ chainId: id, class: 'submit', host: 'ads.x.com', description: 'save the campaign settings' });
  assert.equal(x.decision, 'ask'); assert.match(await why(x), /ad console/);
  const approved = async request => { const q = await act.authorize(request); assert.equal(q.decision, 'ask', 'a payment asks first'); await asks.answer(q.askId, 'yes'); return done(await act.authorize({ ...request, approval: q.askId })); };
  await approved({ chainId: id, class: 'spend', host: 'ads.x.com', description: 'boost the post for a day', cost: 30 });
  // 4. a daily budget commits its increase for every day left, today included
  assert.deepEqual(budgetCommitment({ dailyBudget: 20, now }), { daysLeft: 3, increase: 20, committed: 60 });
  assert.deepEqual(budgetCommitment({ dailyBudget: 15, previousDailyBudget: 20, now }), { daysLeft: 3, increase: 0, committed: 0 });
  const b = await approved({ chainId: id, class: 'spend', host: 'ads.x.com', description: 'raise the daily budget', dailyBudget: 20, previousDailyBudget: 10 });
  assert.equal(Number((await act.recent()).find(r => r.id === b.actionId).cost), 30);
  const lower = await act.authorize({ chainId: id, class: 'spend', host: 'ads.x.com', description: 'lower the daily budget', dailyBudget: 5, previousDailyBudget: 20 });
  await done(lower);   // a lower budget commits nothing new
  // 5. spend outside the engine (the Apple broker) counts against the same cap; unreadable means ask
  external = 430;
  const big = await act.authorize({ chainId: id, class: 'spend', host: 'ads.x.com', description: 'raise another daily budget', dailyBudget: 15 });
  assert.equal(big.decision, 'ask'); assert.match(await why(big), /\$45\.00 would take this month's spend to \$535\.00, past the \$500 cap/);
  assert.match(big.question, /a daily budget of \$15\.00, \$45\.00 committed through the end of the month/);
  assert.equal(await act.monthSpend(), 490);
  externalFails = true;
  const blind = await act.authorize({ chainId: id, class: 'spend', host: 'ads.x.com', description: 'boost one more post', cost: 5 });
  assert.equal(blind.decision, 'ask'); assert.match(await why(blind), /could not be read/);
}));
