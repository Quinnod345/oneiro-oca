import test from 'node:test';
import assert from 'node:assert/strict';
import { parseThought, extractFirstJsonObject } from '../thought-parse.js';

test('a clean object parses; the text alias is normalized to thoughts', () => {
  assert.deepEqual(parseThought('{"thoughts":"hello"}').thought.thoughts, 'hello');
  assert.equal(parseThought('{"thought":"alias"}').thought.thoughts, 'alias');
  assert.equal(parseThought('{"continue_pondering":true}').thought.thoughts, '');
});

test('a local model that answers under message or answer is still heard (self-build want #24)', () => {
  assert.equal(parseThought('{"message":"the battery is low"}').thought.thoughts, 'the battery is low');
  assert.equal(parseThought('{"answer":"forty-two","continue_pondering":"true"}').thought.thoughts, 'forty-two');
  assert.equal(parseThought('{"thoughts":"first","message":"second"}').thought.thoughts, 'first', 'the canonical key still wins');
});

test('valid JSON followed by prose (the live "non-whitespace after JSON" failure) parses the object and ignores the prose', () => {
  const r = parseThought('{"thoughts":"Battery at 5%","feeling":{"feeling":"unease","intensity":0.4}}\n\nI hope this helps! Let me know.');
  assert.equal(r.error, undefined); assert.equal(r.thought.thoughts, 'Battery at 5%'); assert.equal(r.thought.feeling.feeling, 'unease');
});

test('fenced JSON, leading prose, and braces inside strings are handled', () => {
  assert.equal(parseThought('Sure:\n```json\n{"thoughts":"a { brace } inside"}\n```').thought.thoughts, 'a { brace } inside');
  assert.equal(parseThought('{"thoughts":"quote \\" and } inside"}').thought.thoughts, 'quote " and } inside');
  assert.equal(extractFirstJsonObject('x {"a":{"b":1}} y {"c":2}'), '{"a":{"b":1}}');
});

test('non-string thoughts (the live "startsWith is not a function" failure) become a string', () => {
  assert.equal(parseThought('{"thoughts":["one","two"]}').thought.thoughts, 'one two');
  assert.equal(parseThought('{"thoughts":{"text":"nested"}}').thought.thoughts, 'nested');
  assert.equal(parseThought('{"thoughts":42}').thought.thoughts, '42');
  assert.equal(parseThought('{"thoughts":null,"text":"fallback"}').thought.thoughts, 'fallback');
});

test('malformed or absent JSON is an error, never a throw', () => {
  assert.match(parseThought('no json here').error, /no JSON/);
  assert.match(parseThought('{"thoughts": unquoted}').error, /malformed/);
  assert.match(parseThought('{"thoughts":"unterminated').error, /no JSON/);
  assert.match(parseThought('[1,2,3]').error, /no JSON/);
  assert.match(parseThought(null).error, /no JSON/);
});
