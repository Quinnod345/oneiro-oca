import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJudgeNotifier, judgeMessage, JUDGE_TITLE } from '../reasoning/judge-notifier.js';

const silent = { log() {}, warn() {} };

test('a push when something new lands in Judge: never the backlog, never twice, and not lost when a push fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'judge-'));
  try {
    const statePath = join(dir, 'state', 'judge-notified.json');
    let toRate = [{ kind: 'artifact', id: '27/landing.md', title: 'Landing page copy' }, { kind: 'note', id: 'n1.md', title: 'Why trials stall' }];
    const pushed = [];
    let failing = false;
    const push = async p => { if (failing) throw new Error('gateway down'); pushed.push(p); };
    const make = () => createJudgeNotifier({ list: async () => ({ toRate }), push, statePath, log: silent });

    // 1. the first run records what is already waiting, and pushes nothing
    const n = make();
    assert.deepEqual(await n.tick(), []); assert.equal(pushed.length, 0);

    // 2. one new item: one push, named by its title
    toRate = [{ kind: 'artifact', id: '27/faq.md', title: 'Instagram FAQ carousel' }, ...toRate];
    assert.equal((await n.tick()).length, 1);
    assert.deepEqual(pushed.at(-1), { title: JUDGE_TITLE, body: 'A deliverable is waiting: Instagram FAQ carousel' });
    assert.equal((await n.tick()).length, 0, 'nothing new, nothing sent');

    // 3. several at once: one push that counts them
    toRate = [{ kind: 'note', id: 'n2.md', title: 'Pricing thoughts' }, { kind: 'note', id: 'n3.md', title: 'Retention' }, ...toRate];
    await n.tick();
    assert.equal(pushed.length, 2); assert.match(pushed.at(-1).body, /^2 new things to judge, starting with Pricing thoughts$/);

    // 4. a restart remembers what was announced
    const again = make();
    assert.deepEqual(await again.tick(), []); assert.equal(pushed.length, 2);

    // 5. a failed push is retried next pass, not dropped
    toRate = [{ kind: 'note', id: 'n4.md', title: 'Churn' }, ...toRate];
    failing = true; assert.deepEqual(await again.tick(), []);
    failing = false; assert.equal((await again.tick()).length, 1);
    assert.equal(pushed.at(-1).body, 'A note is waiting: Churn');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the push body names one item, or counts several', () => {
  assert.equal(judgeMessage([{ kind: 'note', id: 'x.md', title: '' }]), 'A note is waiting: x.md');
  assert.match(judgeMessage([{ kind: 'artifact', title: 'A' }, { kind: 'note', title: 'B' }, { kind: 'note', title: 'C' }]), /^3 new things to judge, starting with A$/);
});
