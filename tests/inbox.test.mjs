import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInbox, usefulnessOf, ledgerRating, RATINGS } from '../reasoning/inbox.js';
import { createPonderQueue } from '../reasoning/ponder-queue.js';
import { createWorthLedger } from '../motivation/worth-ledger.js';
import { createRiskJournal } from '../motivation/risk-journal.js';
import { compute as meter } from '../evaluation/chinese-room-meter.js';

const blocked = async () => ({ status: 'needs_evidence', checkpoint: { version: 1, passes: [] }, missingEvidence: ['Which target?'] });
const evidence = [{ id: 'obs-1', source: 'isolated regression fixture', observation: 'The build fails on the second target.' }];

async function database(run) {
  const dsn = process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro';
  const schema = 'inbox_test_' + randomBytes(6).toString('hex');
  const admin = new pg.Pool({ connectionString: dsn });
  let pool;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({ connectionString: dsn, options: '-c search_path=' + schema + ',public' });
    await pool.query(`CREATE TABLE thought_chains (id SERIAL PRIMARY KEY, seed TEXT NOT NULL, priority FLOAT8 DEFAULT .5, status TEXT DEFAULT 'pondering', depth INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), ponder_state JSONB)`);
    await pool.query(`CREATE TABLE hypotheses (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(), domain TEXT, claim TEXT, confidence FLOAT8, prediction TEXT, prediction_deadline TIMESTAMPTZ, status TEXT, actual_outcome TEXT, tested_at TIMESTAMPTZ, source_type TEXT, source_data JSONB DEFAULT '{}'::jsonb)`);
    for (const m of ['057_worth_ledger', '058_risk_decisions']) await pool.query(await readFile(new URL(`../migrations/${m}.sql`, import.meta.url), 'utf8'));
    await run(pool);
  } finally {
    if (pool) await pool.end();
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await admin.end();
  }
}

test('a rating is a word or a number in [0,1], and folds to the ledger\'s -1/0/1', () => {
  assert.equal(usefulnessOf('great'), 1); assert.equal(usefulnessOf('useless'), 0); assert.equal(usefulnessOf(0.5), 0.5);
  assert.throws(() => usefulnessOf('amazing')); assert.throws(() => usefulnessOf(1.5));
  assert.equal(ledgerRating(RATINGS.great), 1); assert.equal(ledgerRating(RATINGS.useful), 1); assert.equal(ledgerRating(RATINGS.meh), 0); assert.equal(ledgerRating(RATINGS.useless), -1);
});

test('the inbox lists what a person owes the engine, and each answer teaches it: a rated artifact is a receipt the meter counts, a rated note moves the capability, a receipt moves the want', async () => database(async pool => {
  const workRoot = await mkdtemp(join(tmpdir(), 'oca-inbox-'));
  try {
    let now = 10 * 86400000;
    const worth = createWorthLedger({ pool, clock: () => now }); await worth.seed();
    const risk = createRiskJournal({ pool, worth, clock: () => now, controls: () => ({ autonomousActions: false }) });
    const queue = createPonderQueue({ pool, reason: blocked, clock: () => now, worth, risk });
    const inbox = createInbox({ pool, queue, worth, workRoot, clock: () => now });

    // nothing yet
    let box = await inbox.list();
    assert.deepEqual(box.toRate, []); assert.deepEqual(box.wants, []); assert.ok(box.entities.some(e => e.entityKey === 'person:quinn'));

    // a person gives it a want from the phone
    const chain = await inbox.want({ description: 'Get the build green on the second target', doneWhen: 'The second target builds twice in a row.' });
    box = await inbox.list();
    assert.equal(box.wants.length, 1); assert.equal(box.wants[0].chainId, chain.chain_id); assert.equal(box.wants[0].progress, 0);
    await assert.rejects(inbox.want({ description: 'x' }), /say what you want/);

    // the engine delivers an artifact into its own work directory (as the strategy does), and a note the gate held
    const dir = join(workRoot, String(chain.chain_id), 'artifacts'); await mkdir(dir, { recursive: true });
    const path = join(dir, 'strategy-1-build-target-checklist.md');
    await writeFile(path, `# Build target checklist\n\n_For:_ Getting the build green\n\n_Judge by:_ Did following it fix the build?\n\nStep one: pin the failing target.\n`);
    await pool.query(`UPDATE thought_chains SET status = 'awaiting_evidence', ponder_state = jsonb_set(ponder_state, '{commitments}', $2::jsonb) WHERE id = $1`,
      [chain.chain_id, JSON.stringify([{ kind: 'artifact', path, title: 'Build target checklist', at: now }])]);
    await mkdir(join(workRoot, 'thinker'), { recursive: true });
    await writeFile(join(workRoot, 'thinker', '2026-09-19-the-silence-between-models.md'), `# The Silence Between Models\n\n_Written by the thinker; held for a person._\n\nWhen the model is unreachable the engine has nothing to say, and says so.\n`);
    box = await inbox.list();
    assert.deepEqual(box.toRate.map(i => i.kind).sort(), ['artifact', 'note']);
    const art = box.toRate.find(i => i.kind === 'artifact'), note = box.toRate.find(i => i.kind === 'note');
    assert.equal(art.id, `${chain.chain_id}/strategy-1-build-target-checklist.md`); assert.equal(art.judge, 'Did following it fix the build?'); assert.match(art.body, /pin the failing target/);
    assert.equal(note.title, 'The Silence Between Models'); assert.match(note.body, /nothing to say/);

    // a useless artifact: a receipt that is a spent attempt — the want rotates its strategy and thinks again
    const before = await queue.get(chain.chain_id);
    let r = await inbox.rate({ kind: 'artifact', id: art.id, usefulness: 'useless', note: 'It restated the problem.' });
    assert.equal(r.want.want.progress, 0); assert.equal(r.want.want.strategy, before.want.strategy + 1); assert.equal(r.want.status, 'pondering');
    assert.ok(r.want.want.receipts.some(x => x.receiptId === 'rated-artifact-strategy-1-build-target-checklist.md' && x.usefulness === 0));
    box = await inbox.list();
    assert.equal(box.toRate.filter(i => i.kind === 'artifact').length, 0, 'rated once');
    await assert.rejects(inbox.rate({ kind: 'artifact', id: art.id, usefulness: 'great' }), /already names a different outcome/);
    // a second, useful artifact: progress
    const path2 = join(dir, 'strategy-2-config-diff.md');
    await writeFile(path2, `# Config diff\n\n_For:_ Getting the build green\n\n_Judge by:_ Is the difference real?\n\nTarget B pins an older toolchain.\n`);
    await pool.query(`UPDATE thought_chains SET ponder_state = jsonb_set(ponder_state, '{commitments}', (ponder_state -> 'commitments') || $2::jsonb) WHERE id = $1`,
      [chain.chain_id, JSON.stringify([{ kind: 'artifact', path: path2, title: 'Config diff', at: now + 1 }])]);
    r = await inbox.rate({ kind: 'artifact', id: `${chain.chain_id}/strategy-2-config-diff.md`, usefulness: 'great' });
    assert.equal(r.want.want.progress, 0.25, 'useful or better is progress');
    // the meter's creativity dimension is made of these ratings and nothing else
    const card = await meter({ db: pool });
    assert.equal(card.components.creativity.diagnostics.rated, 2); assert.equal(card.components.creativity.diagnostics.delivered, 2);
    assert.equal(card.components.creativity.status, 'insufficient_evidence', 'two ratings; three make it measured');

    // the note: a rating on the capability that wrote it, once
    const ws = await inbox.rate({ kind: 'note', id: note.id, usefulness: 'useful' });
    assert.equal(ws.worth.signal.rating, 1); assert.equal(ws.worth.state.signals.rated, 1); assert.equal(ws.worth.state.provenance, 'rated');
    assert.ok(await pool.query(`SELECT 1 FROM worth_signals WHERE id = 'rate:note:2026-09-19-the-silence-between-models.md'`).then(q => q.rowCount === 1));
    assert.equal((await inbox.list()).toRate.length, 0);
    await assert.rejects(inbox.rate({ kind: 'note', id: '../../etc/passwd.md', usefulness: 1 }), /named by its file name/);

    // an entity
    const ent = await inbox.rate({ kind: 'entity', entityKey: 'project:oca-engine', rating: 1, about: 'worth the time' });
    assert.equal(ent.worth.signal.rating, 1); assert.equal(ent.worth.state.key, 'project:oca-engine');
    await assert.rejects(inbox.rate({ kind: 'entity', entityKey: 'project:oca-engine', rating: 0.5 }), /-1, 0 or 1/);

    // an observed receipt from the person: the only thing that satiates a want
    const p = await inbox.progress({ chainId: chain.chain_id, progress: 0.6, observation: 'Target B built once after pinning the toolchain.' });
    assert.equal(p.want.progress, 0.6); assert.equal(p.status, 'pondering');
    const done = await inbox.progress({ chainId: chain.chain_id, progress: 0.6, criterionMet: true, observation: 'Built twice in a row.' });
    assert.equal(done.want.status, 'sated'); assert.equal(done.status, 'resolved');
    assert.equal((await inbox.list()).wants.length, 0);
    await assert.rejects(inbox.progress({ chainId: chain.chain_id, progress: 0.1, observation: '' }), /say what you observed/);
  } finally { await rm(workRoot, { recursive: true, force: true }); }
}));
