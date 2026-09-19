import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPursuitDrafts, draftSchema } from '../reasoning/pursuit-draft.js';
import { createInbox } from '../reasoning/inbox.js';
import { createPonderQueue } from '../reasoning/ponder-queue.js';
import { createWorthLedger } from '../motivation/worth-ledger.js';
import { createRiskJournal } from '../motivation/risk-journal.js';

const blocked = async () => ({ status: 'needs_evidence', checkpoint: { version: 1, passes: [] }, missingEvidence: ['Which target?'] });

async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'draft_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema + ',public' });
    await pool.query(`CREATE TABLE thought_chains (id SERIAL PRIMARY KEY, seed TEXT NOT NULL, priority FLOAT8 DEFAULT .5, status TEXT DEFAULT 'pondering', depth INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), ponder_state JSONB)`);
    await pool.query(`CREATE UNIQUE INDEX thought_chains_client_request ON thought_chains ((ponder_state->>'clientRequestId')) WHERE ponder_state->>'clientRequestId' IS NOT NULL`);
    for (const m of ['057_worth_ledger', '058_risk_decisions', '061_pursuit_drafts']) await pool.query(await readFile(new URL(`../migrations/${m}.sql`, import.meta.url), 'utf8'));
    await run(pool);
  } finally {
    if (pool) await pool.end();
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await admin.end();
  }
}

// A model that answers the draft schema; `plan` is what it says next.
function fakeLlm(plan) {
  return { messages: { create: async (params, options) => {
    assert.equal(options.responseSchema, draftSchema); assert.equal(options.interactive, true);
    if (plan.delayMs) await new Promise(r => setTimeout(r, plan.delayMs));
    const p = typeof plan.next === 'function' ? plan.next(params) : plan.next;
    if (p instanceof Error) throw p;
    return { content: [{ text: JSON.stringify(p) }], _via: 'codex_chatgpt_subscription' };
  } } };
}
const goodDraft = {
  description: 'Reach my brother Dan at least once a month', evidenceIds: ['ep-7', 'ghost-1'], priority: 0.8, rationale: 'He asked to stay in touch.',
  doneWhen: { statement: 'Three consecutive months each with at least one message or call with Dan.', witness: { kind: 'message', detail: "Quinn's Messages log" }, check: 'count', target: 3, deadlineDays: 90 },
  stakes: [{ entityKey: 'person:quinn', share: 1, status: 'known', why: 'asked' }, { entityKey: 'person:dan', share: 2, status: 'proposed_new', why: 'the brother' }, { entityKey: 'self:ponder', share: 1, status: 'known', why: 'nope' }, { entityKey: 'outcome:x', share: 1, status: 'known', why: 'nope' }],
  questions: [], duplicateOf: [{ chainId: 999, why: 'not really' }],
};
const memory = {
  episodic: async () => [
    { id: 7, event_type: 'conversation', content: '[imessage] Dan: are we still on for the 20th?', timestamp: '2026-09-02T18:04:00Z', active_app: 'Messages' },
    { id: 8, event_type: 'thought', content: 'I should reach out to Dan.', timestamp: '2026-09-03T18:04:00Z' },
    { id: 9, event_type: 'conversation', content: '[imessage] Oneiro: I noticed you have not replied to Dan.', timestamp: '2026-09-04T18:04:00Z' },
    { id: 10, event_type: 'blocked_action', content: 'prepare_artifact: message Dan', timestamp: '2026-09-05T18:04:00Z' },
  ],
  visual: async () => [{ id: 3, captured_at: '2026-09-10T12:00:00Z', front_app: 'Messages', window_title: 'Dan', url: null, description: 'A generated description of the screen that must not become an observation.' }],
  entities: async () => ({ entities: [{ id: 412, entity_key: 'dan', canonical_name: 'Dan', entity_type: 'person', mention_count: 31 }], relations: [] }),
};

test('the draft schema is strict and closed', () => {
  assert.equal(draftSchema.additionalProperties, false);
  assert.deepEqual(draftSchema.required.sort(), ['description', 'doneWhen', 'duplicateOf', 'evidenceIds', 'priority', 'questions', 'rationale', 'stakes']);
  assert.deepEqual(draftSchema.properties.doneWhen.properties.target.type, ['number', 'null']);
});

test('gather keeps only what the ledger would accept, labelled by its real source; the engine\'s own narration never becomes a candidate', async () => database(async pool => {
  let now = 20 * 86400000;
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => ({ autonomousActions: false }) });
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
  await queue.enqueue({ seed: 'Call Dan every month', doneWhen: 'A call with Dan each month for three months.', evidence: [], topic: '' });
  const drafts = createPursuitDrafts({ pool, llm: fakeLlm({ next: goodDraft }), worth, queue, clock: () => now, memory, embed: async texts => texts.map(t => /dan/i.test(t) ? [1, 0] : [0, 1]), sense: async () => ({ activeApp: 'Messages', presence: 'active' }), log: { log() {}, warn() {} } });
  const g = await drafts.gatherContext('stay in touch with my brother Dan');
  assert.deepEqual(g.candidates.map(c => c.id).sort(), ['ep-7', 'now', 'shot-3']);
  const ep = g.candidates.find(c => c.id === 'ep-7');
  assert.equal(ep.source, 'episodic memory #7 (conversation, 2026-09-02T18:04:00.000Z, app Messages)'); assert.equal(ep.tier, 'observed');
  const shot = g.candidates.find(c => c.id === 'shot-3');
  assert.equal(shot.observation, 'app Messages, window "Dan"', 'only what the OS observed'); assert.match(shot.detail, /generated description/); assert.equal(shot.tier, 'perceived');
  assert.ok(g.knownEntities.some(e => e.entityKey === 'person:quinn'));
  assert.deepEqual(g.suggestions, [{ entityKey: 'person:dan', grounding: 'entity graph #412 (Dan, 31 mentions)' }]);
  assert.equal(g.retrieval, 'bge_cosine'); assert.equal(g.similar.length, 1); assert.match(g.similar[0].description, /Call Dan/);
  const noEmbed = createPursuitDrafts({ pool, llm: fakeLlm({ next: goodDraft }), worth, queue, clock: () => now, memory, embed: async () => { throw new Error('ECONNREFUSED'); }, log: { log() {}, warn() {} } });
  const g2 = await noEmbed.gatherContext('call Dan');
  assert.equal(g2.retrieval, 'word_search'); assert.ok(g2.warnings.some(w => /embedder unreachable/.test(w))); assert.equal(g2.similar.length, 1);
}));

test('a loose request becomes a labelled draft the engine validated; the person confirms it into a want, and only their taps become worth', async () => database(async pool => {
  let now = 20 * 86400000;
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => ({ autonomousActions: false }) });
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
  const plan = { next: goodDraft };
  const drafts = createPursuitDrafts({ pool, llm: fakeLlm(plan), worth, queue, clock: () => now, memory, embed: async texts => texts.map(() => [1, 0]), provider: () => ({ provider: 'codex', model: 'gpt-6-astra' }), log: { log() {}, warn() {} } });
  const inbox = createInbox({ pool, queue, worth, workRoot: '/tmp/none', clock: () => now, drafts });
  const id = randomUUID();
  await assert.rejects(drafts.start({ clientRequestId: 'nope', text: 'x' }), /clientRequestId/);
  await assert.rejects(drafts.start({ clientRequestId: id, text: 'hi' }), /say what you want/);
  const started = await drafts.start({ clientRequestId: id, text: 'help me stay in touch with my brother' });
  assert.equal(started.accepted, true); assert.equal(started.status, 'drafting'); assert.equal(started.expectedSeconds, 45); assert.match(started.poll, /wait=25/);
  const replay = await drafts.start({ clientRequestId: id, text: 'help me stay in touch with my brother' });
  assert.equal(replay.replay, true);
  const d = await drafts.get(id, { wait: 5 });
  assert.equal(d.status, 'ready', JSON.stringify(d.error)); assert.equal(d.provider, 'codex'); assert.equal(d.phase, 'done');
  assert.equal(d.draft.description.authored, 'generated'); assert.equal(d.draft.doneWhen.authored, 'generated'); assert.equal(d.draft.priority.authored, 'generated');
  assert.equal(d.draft.doneWhen.observable, true); assert.equal(d.draft.doneWhen.value, 'Three consecutive months each with at least one message or call with Dan.');
  assert.deepEqual(d.draft.stakes.map(s => [s.entityKey, s.status]), [['person:quinn', 'known'], ['person:dan', 'proposed_new']], 'self:* and outcome:* proposals are dropped');
  assert.equal(d.draft.stakes[1].grounding, 'entity graph #412 (Dan, 31 mentions)');
  assert.deepEqual(d.draft.evidence.map(e => e.id), ['ep-7'], 'only candidates it actually found; a ghost id is dropped');
  assert.deepEqual(d.draft.similar, [], 'nothing similar exists yet');
  assert.ok(d.draft.preview.strategies.some(s => s.name === 'inspect_missing_evidence' && s.first)); assert.equal(d.draft.preview.gate.decision, 'proceed');
  assert.ok(d.draft.preview.budget.timeBudgetSeconds >= 10); assert.ok(Number.isFinite(d.draft.preview.pricing.value));
  assert.equal(d.gathered.candidates, 2);

  // a second turn: the person answers; the model revises
  let seenPrompt = '';
  plan.next = params => { seenPrompt = params.messages[0].content; return { ...goodDraft, priority: 0.9 }; };
  const t2 = await drafts.start({ clientRequestId: id, text: '', answers: [{ questionId: 'q1', answer: 'Dan, monthly' }] });
  assert.equal(t2.turn, 2);
  const d2 = await drafts.get(id, { wait: 5 });
  assert.equal(d2.status, 'ready', d2.error);
  assert.match(seenPrompt, /Follow-up 1: [\s\S]*Answers: \[q1\] Dan, monthly/); assert.match(seenPrompt, /PRIOR DRAFT/);
  assert.equal(d2.draft.priority.value, 0.9); assert.equal(d2.input.answers.length, 1);
  await assert.rejects(drafts.start({ clientRequestId: id, text: '' }), /answer a question or say more/);

  // confirm through the inbox: the person kept the description, sharpened the criterion, kept Dan as a stake (a rating), picked the evidence, added an observation
  await assert.rejects(inbox.want({ draftId: id, evidenceIds: ['ep-99'] }), /not among what the draft found/);
  await assert.rejects(inbox.want({ draftId: id, stakes: [{ entityKey: 'person:dan', share: 2 }] }), /neither known nor confirmed as new/);
  await assert.rejects(inbox.want({ draftId: id, stakes: [{ entityKey: 'self:ponder', share: 1 }] }), /cannot stake/);
  const r = await inbox.want({ draftId: id, doneWhen: 'Three months in a row with a call to Dan, seen in my call log.', priority: 0.85,
    stakes: [{ entityKey: 'person:quinn', share: 1 }, { entityKey: 'person:dan', share: 2 }], newEntities: [{ entityKey: 'person:dan', rating: 1, about: 'my brother' }],
    evidenceIds: ['ep-7'], observations: [{ observation: 'We last spoke on 2 September.' }], draftVerdict: 'useful' });
  const chain = r.chain;
  assert.equal(chain.clientRequestId, id); assert.equal(chain.want.description, 'Reach my brother Dan at least once a month');
  assert.equal(chain.want.doneWhen, 'Three months in a row with a call to Dan, seen in my call log.');
  assert.deepEqual(chain.evidence.map(e => e.source), ['episodic memory #7 (conversation, 2026-09-02T18:04:00.000Z, app Messages)', 'observed by quinn']);
  assert.ok(chain.want.stakes.some(s => s.entityKey === 'person:dan' && s.share === 2)); assert.equal(chain.origin.source, 'draft');
  assert.deepEqual(r.worthSignals.map(w => w.entityKey).sort(), ['person:dan', 'self:draft_want']);
  const dan = await worth.get('person:dan'); assert.equal(dan.signals.rated, 1); assert.equal(dan.provenance, 'rated');
  const { rows: sig } = await pool.query(`SELECT id FROM worth_signals WHERE id LIKE 'request:%' OR id LIKE 'request-priority:%' ORDER BY id`);
  assert.equal(sig.length, 2, 'the request itself is a rating and its priority a prior, as for any explicit want');
  const row = (await drafts.get(id)); assert.equal(row.status, 'confirmed'); assert.equal(row.chainId, chain.chain_id);
  const { rows: [conf] } = await pool.query('SELECT confirmed FROM pursuit_drafts WHERE id = $1', [id]);
  assert.deepEqual(conf.confirmed.changed, ['doneWhen', 'priority'], 'the person\'s edits are kept for inspection, never inferred');
  // confirming again returns the same want
  const again = await inbox.want({ draftId: id }); assert.equal(again.replay, true); assert.equal(again.chain.chain_id, chain.chain_id);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM thought_chains')).rows[0].n, 1);
}));

test('a vague draft needs answers; a model failure leaves what was gathered so the manual form is still pre-filled; concurrency and turns are bounded; abandon and sweep', async () => database(async pool => {
  let now = 20 * 86400000;
  const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
  const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth });
  const vague = { ...goodDraft, doneWhen: { statement: 'I feel closer to my brother.', witness: { kind: 'person', detail: '' }, check: 'binary', target: null, deadlineDays: null }, questions: [] };
  const plan = { next: vague, delayMs: 300 };
  const drafts = createPursuitDrafts({ pool, llm: fakeLlm(plan), worth, queue, clock: () => now, memory, embed: null, limits: { concurrent: 1, perHour: 200, turns: 2, textChars: 2000 }, log: { log() {}, warn() {} } });
  const a = randomUUID();
  await drafts.start({ clientRequestId: a, text: 'feel closer to my brother' });
  await assert.rejects(drafts.start({ clientRequestId: randomUUID(), text: 'something else entirely' }), /already drafting/);
  const d = await drafts.get(a, { wait: 5 });
  plan.delayMs = 0;
  assert.equal(d.status, 'needs_answers'); assert.equal(d.draft.doneWhen.observable, false);
  assert.ok(d.draft.questions.some(q => q.id === 'q-observable' && q.blocking), JSON.stringify(d.draft.questions));
  // second (last allowed) turn: the model dies twice → failed, but gathered stays
  plan.next = new Error('Codex CLI exited 1: usage limit');
  await drafts.start({ clientRequestId: a, text: '', answers: [{ questionId: 'q-observable', answer: 'a call a month' }] });
  const f = await drafts.get(a, { wait: 5 });
  assert.equal(f.status, 'failed'); assert.match(f.error, /usage limit/); assert.equal(f.gathered.candidates, 2, 'what it gathered survives the failure');
  await assert.rejects(drafts.start({ clientRequestId: a, text: 'once more' }), /at most 2 turns/);
  // a failed draft can still be confirmed by hand — the person supplies the criterion
  const inbox = createInbox({ pool, queue, worth, workRoot: '/tmp/none', clock: () => now, drafts });
  const c = await inbox.want({ draftId: a, description: 'Call my brother monthly', doneWhen: 'One call a month for three months, in my call log.', stakes: [{ entityKey: 'person:quinn', share: 1 }] });
  assert.equal(c.chain.want.doneWhen, 'One call a month for three months, in my call log.');
  // abandon and sweep
  const b = randomUUID();
  plan.next = goodDraft;
  await drafts.start({ clientRequestId: b, text: 'ship the onboarding flow by friday' });
  assert.equal((await drafts.abandon(b)).status, 'abandoned');
  await assert.rejects(inbox.want({ draftId: b }), /abandoned/);
  const stale = randomUUID();
  await pool.query(`INSERT INTO pursuit_drafts (id, status, phase, turns, updated_at) VALUES ($1, 'drafting', 'thinking', '[{"text":"x"}]', now() - interval '6 minutes')`, [stale]);
  assert.deepEqual(await drafts.sweep(), { failed: 1 });
  assert.match((await drafts.get(stale)).error, /restarted/);
  assert.ok((await drafts.list()).some(x => x.draftId === stale));
}));
