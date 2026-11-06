import test from 'node:test';
import assert from 'node:assert/strict';
import { agentNameFromTask, cleanWrittenName, writeAgentName } from '../reasoning/agent-names.js';

test('an agent\'s fallback name is the first clause, cleanly shortened, with the engine\'s openings and plumbing gone', () => {
  const cases = [
    ['Start with the first step Quinn confirmed when he made this pursuit: check current prices and reviews for beginner piano method books', 'Check current prices and reviews for beginner'],
    ["Something is already waiting on Quinn's answer on this pursuit, so do not redo or restate it: Cancellation source correct; runtime verification", 'Cancellation source correct'],
    ['In ~/InnerEcho, check existing issues and unfinished branches for purchase-cancellation handling.', 'Check existing issues and unfinished branches'],
    ['Advance the completed duplicate AI-request fix at commit 2eeae9d on fix/ai-request-dedup-20261006 through integration review.', 'Advance the completed duplicate AI-request fix'],
    ['Recover the saved artifacts from the failed October 6 run 9d5c34f5-793a-495e-a654-219199161234.', 'Recover the saved artifacts from the failed'],
    ['Retrieve the brief\nThen deliver', 'Retrieve the brief'],
  ];
  for (const [task, want] of cases) assert.equal(agentNameFromTask(task), want);
  assert.equal(agentNameFromTask('', { kind: 'research' }), 'Research agent');
  assert.equal(agentNameFromTask(''), 'Agent');
  // Never a mid-word cut: every word of the name is a whole word of the task.
  const long = 'Supercalifragilisticexpialidocious antidisestablishmentarianism floccinaucinihilipilification pneumonoultramicroscopicsilicovolcanoconiosis';
  for (const w of agentNameFromTask(long).split(' ')) assert.ok(long.includes(w));
  // Nothing ends on a dangling word.
  assert.doesNotMatch(agentNameFromTask('Check the prices of the books of the people in the town of the river'), /\b(of|the|in)$/);
});

test('a written name is checked before it is kept, and a model that fails leaves the fallback standing', async () => {
  assert.equal(cleanWrittenName('"Find book prices."'), 'Find book prices');
  assert.equal(cleanWrittenName('compare cancellation flows\nextra'), 'Compare cancellation flows');
  assert.equal(cleanWrittenName('Inspect ~/InnerEcho source'), null);
  assert.equal(cleanWrittenName('Fix OCA settlement'), null);
  assert.equal(cleanWrittenName('Check 2eeae9d3 fix'), null);
  assert.equal(cleanWrittenName('This is far too many words to be any kind of a short name'), null);
  assert.equal(await writeAgentName({ llm: { messages: { create: async () => { throw new Error('no'); } } }, task: 't' }), null);
  assert.equal(await writeAgentName({ llm: null, task: 't' }), null);
  let asked;
  const name = await writeAgentName({ llm: { messages: { create: async m => { asked = m; return { content: [{ text: 'Find book prices' }] }; } } }, task: 'Check prices', want: 'Learn piano' });
  assert.equal(name, 'Find book prices'); assert.equal(asked.provider, 'codex'); assert.match(asked.messages[0].content, /Check prices/);
});
