import test from 'node:test';
import assert from 'node:assert/strict';
import { doneWhenShape, composeDoneWhen, looksObservable, WITNESS_KINDS } from '../motivation/done-when.js';

test('an observable criterion names a witness; a wish does not', () => {
  const good = doneWhenShape({ statement: 'Three consecutive months each with at least one message or call with Dan.', witness: { kind: 'message', detail: "Quinn's own Messages log" }, check: 'count', target: 3 });
  assert.equal(good.observable, true, good.why);
  const wish = doneWhenShape({ statement: 'I feel closer to my brother.', witness: { kind: 'person', detail: '' } });
  assert.equal(wish.observable, false); assert.match(wish.why, /witness needs a detail/);
  const mind = doneWhenShape({ statement: 'I understand the build system better.', witness: { kind: 'other', detail: '' }, check: 'binary' });
  assert.equal(mind.observable, false);
  assert.ok(mind.problems.some(p => /state of mind/.test(p)), mind.problems.join(' | '));
});

test('counts and thresholds need a target; deadlines are whole days; witness kinds are closed', () => {
  assert.equal(doneWhenShape({ statement: 'The suite is green twenty times in a row.', witness: { kind: 'test', detail: 'node --test tests/' }, check: 'count' }).observable, false);
  assert.equal(doneWhenShape({ statement: 'The suite is green twenty times in a row.', witness: { kind: 'test', detail: 'node --test tests/' }, check: 'count', target: 20 }).observable, true);
  assert.equal(doneWhenShape({ statement: 'Typing speed reaches 60 wpm.', witness: { kind: 'sensor', detail: 'typing_wpm' }, check: 'threshold', target: 60, deadlineDays: 1.5 }).observable, false);
  assert.equal(doneWhenShape({ statement: 'Typing speed reaches 60 wpm.', witness: { kind: 'sensor', detail: 'typing_wpm' }, check: 'threshold', target: 60, deadlineDays: 14 }).observable, true);
  assert.equal(doneWhenShape({ statement: 'x', witness: { kind: 'vibes', detail: 'y' } }).observable, false);
  assert.deepEqual(WITNESS_KINDS, ['person', 'message', 'test', 'repo', 'file', 'sensor', 'calendar', 'other']);
});

test('composeDoneWhen keeps a given statement and otherwise writes one from the parts', () => {
  assert.equal(composeDoneWhen({ statement: '  The build is green.  ', witness: { kind: 'test', detail: 'CI' } }), 'The build is green.');
  assert.equal(composeDoneWhen({ witness: { kind: 'message', detail: 'the Messages log' }, check: 'count', target: 3, deadlineDays: 90 }), 'the Messages log shows at least 3 of them within 90 days.');
  assert.equal(composeDoneWhen({ witness: { kind: 'sensor', detail: 'typing_wpm' }, check: 'threshold', target: 60 }), 'typing_wpm shows a value at or past 60.');
  assert.equal(composeDoneWhen({ witness: { kind: 'repo', detail: 'main' }, deadlineDays: 1 }), 'main shows it is done within 1 day.');
  assert.equal(composeDoneWhen({}), 'a person shows it is done.');
});

test('a bare sentence is judged by the words that are there', () => {
  assert.equal(looksObservable('The second target builds green twenty runs in a row.').observable, true);
  assert.equal(looksObservable('I message Dan at least once a month for three months.').observable, true);
  assert.equal(looksObservable('I feel better about CI.').observable, false);
  assert.equal(looksObservable('Try to understand the pipeline.').observable, false);
  assert.equal(looksObservable('').observable, false);
  assert.equal(looksObservable('done').observable, false);
});
