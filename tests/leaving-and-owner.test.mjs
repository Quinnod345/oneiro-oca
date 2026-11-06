// Things a person other than the author would trip over: whose name the agents hear, what a failed chat turn says, and
// that a payment can't be approved from anywhere but the phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { plainTurnFailure, createAgentHost } from '../agent-host/index.js';
import { composeDeliverable } from '../reasoning/deliverables.js';
import { createInbox } from '../reasoning/inbox.js';
import { waitingOnModel } from '../reasoning/board.js';
import { chatWords, providerNotice } from '../reasoning/agents.js';

test('agents hear the configured owner, or "the person" when nobody is configured', async () => {
  process.env.OCA_LOCAL_CONFIG = '/nonexistent/local.json';
  const { forOwner, ownerName } = await import('../reasoning/local-config.js');
  try {
    delete process.env.OCA_OWNER_NAME;
    assert.equal(ownerName(), 'the person');
    assert.equal(forOwner("ask Quinn's approval"), "ask the person's approval");
    process.env.OCA_OWNER_NAME = 'Ana';
    assert.equal(forOwner('ask Quinn'), 'ask Ana');
    assert.equal(forOwner('Quinnsville'), 'Quinnsville', 'only the name, not a word that starts with it');
  } finally { delete process.env.OCA_OWNER_NAME; delete process.env.OCA_LOCAL_CONFIG; }
});

test('a turn that got no reply says why, in words a person can act on', () => {
  assert.match(plainTurnFailure('You have hit your usage limit'), /usage limit/);
  assert.match(plainTurnFailure('401 Unauthorized'), /codex login/);
  assert.match(plainTurnFailure('stream disconnected before completion'), /online/);
  assert.match(plainTurnFailure('', 'lost'), /restarted/);
  assert.match(plainTurnFailure('something odd'), /something odd/);
  assert.match(plainTurnFailure(''), /Send it again/);
});

test("the thread's latest turn decides: a later success clears a failure, and stopping one isn't a failure", async () => {
  let rows = [{ status: 'error', error: 'usage limit', completed_at: new Date(0) }];
  const pool = { query: async () => ({ rows }) };
  const stub = { kind: 'codex', init: async () => {}, available: async () => true };
  const host = createAgentHost({ pool, codex: stub, t3: { kind: 't3', init: async () => {} } });
  assert.match((await host.lastFailure('s')).why, /usage limit/);
  rows = [{ status: 'ok', error: null }];
  assert.equal(await host.lastFailure('s'), null);
  rows = [{ status: 'interrupted', error: 'interrupted' }];
  assert.equal(await host.lastFailure('s'), null);
  rows = [];
  assert.equal(await host.lastFailure('s'), null);
});

test('a payment can only be denied from the app: a typed yes neither closes it nor reaches an agent', async () => {
  const answered = [];
  const pool = { query: async sql => (/FROM notifications/.test(sql) ? { rows: [{ metadata: { payment: true } }] } : { rows: [] }) };
  const asks = { answer: async (id, reply) => { answered.push(reply); return { id, metadata: { payment: true } }; } };
  const inbox = createInbox({ pool, queue: {}, worth: {}, workRoot: '/tmp/none', asks });
  for (const reply of ['yes', 'APPROVE ABC234', 'allow-once']) await assert.rejects(inbox.answerAsk({ id: 1, reply }), /only approved from your phone/);
  assert.deepEqual(answered, []);
  await inbox.answerAsk({ id: 1, reply: 'no' });
  assert.deepEqual(answered, ['no']);
  await inbox.answerAsk({ id: 1, reply: 'APPROVE ABC234', via: 'Messages', fromPhone: true });
  assert.deepEqual(answered, ['no', 'APPROVE ABC234'], 'the phone path still reaches the real gate');
});

test("a pursuit whose review couldn't reach a model is waiting, not stuck", () => {
  const row = error => ({ status: 'failed', state: { result: { error } } });
  assert.equal(waitingOnModel(row('fetch failed')), true);
  assert.equal(waitingOnModel(row('artifact unavailable: inference circuit open (fetch failed); retry after 54s')), true);
  assert.equal(waitingOnModel({ status: 'pondering', state: { result: { error: 'fetch failed' } } }), true);
  assert.equal(waitingOnModel(row('connect ECONNREFUSED 127.0.0.1:11434')), true);
  assert.equal(waitingOnModel(row('the plan contradicts itself')), false);
  assert.equal(waitingOnModel({ status: 'running', state: { result: { error: 'fetch failed' } } }), false);
});

test("a provider's trouble reads as what happened and what comes next, with nothing to answer", () => {
  for (const why of ['stream disconnected before completion', 'You exceeded your current quota, please add credits']) {
    assert.match(providerNotice(why), /agents are paused\. They try again on their own in an hour\.$/);
    assert.doesNotMatch(providerNotice(why), /Deployments|stream|credits/);
  }
});

test('exported chats read as what was said, whoever owns the install', () => {
  for (const prefix of ['[Quinn, via Oneiro] ', '[the person, via Oneiro] ', '[Ana, via the pursuit conversation] ']) assert.equal(chatWords({ role: 'user', text: `${prefix}How long?` }), 'How long?');
  assert.equal(chatWords({ role: 'user', text: 'typed straight into the thread' }), 'typed straight into the thread');
});

test('with the owner named Quinn, what agents hear is unchanged', async () => {
  process.env.OCA_OWNER_NAME = 'Quinn';
  const { forOwner } = await import('../reasoning/local-config.js');
  try { assert.equal(forOwner("[Quinn, via Oneiro] ask Quinn's approval"), "[Quinn, via Oneiro] ask Quinn's approval"); }
  finally { delete process.env.OCA_OWNER_NAME; }
});
