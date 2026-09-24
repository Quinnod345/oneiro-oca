import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMeasured, updateReadme, START, END } from '../evaluation/readme-table.js';

const report = {
  ran_at: '2026-09-24T19:00:00.000Z',
  mechanism: { tests: 263, pass: 262, fail: 1 },
  scorecard: {
    composite: null, evidence_coverage: 0.444,
    components: {
      grounding: { score: 1, n: 25, status: 'measured' },
      prediction: { score: 0, n: 4879, status: 'measured', diagnostics: { all: { n: 4879, brier: 0.2094, base_rate_brier: 0.194, skill: 0 } } },
      creativity: { score: null, n: null, status: 'insufficient_evidence' },
    },
  },
};

test('the Measured block says what the last run showed, dated, and nothing more', () => {
  const b = renderMeasured(report);
  assert.ok(b.startsWith(START) && b.endsWith(END));
  for (const s of ['**Last run: 2026-09-24.**', '262/263 passing, **1 failing**', '| grounding | 1.000 | 25 | measured |',
    '| creativity | — | — | insufficient evidence |', 'Evidence coverage 44%', 'Composite: none yet', 'Brier 0.209 against 0.194', 'over 4879 predictions']) assert.ok(b.includes(s), s);
  const broken = renderMeasured({ ran_at: '2026-09-24T00:00:00Z', mechanism: null, scorecard: { error: 'no database' } });
  assert.ok(broken.includes('Mechanism suite not run.') && broken.includes('Scorecard unavailable: no database.'), 'a failed run says so rather than keeping old numbers');
});

test('the block replaces only what sits between the markers; without them the README is left alone', () => {
  const readme = `# Engine\n\n## Measured\n\nintro\n\n${START}\nold table\n${END}\n\nafter\n`;
  const one = updateReadme(readme, renderMeasured(report));
  assert.equal(one.replaced, true);
  assert.ok(one.text.startsWith('# Engine\n\n## Measured\n\nintro\n\n') && one.text.endsWith('\n\nafter\n'));
  assert.ok(!one.text.includes('old table'));
  assert.equal(updateReadme(one.text, renderMeasured(report)).text, one.text, 'running twice changes nothing');
  assert.deepEqual(updateReadme('# no markers\n', 'x'), { text: '# no markers\n', replaced: false });
});
