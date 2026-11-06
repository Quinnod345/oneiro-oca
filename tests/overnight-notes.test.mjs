// The knowledge base belongs to the person. The night only adds to it, atomically, and steps back from anything they
// are touching. Real files in a scratch folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addToNote, createNote, listNotes, safeNotePath, slug } from '../reasoning/overnight-notes.js';

async function vault(run) {
  const root = await mkdtemp(join(tmpdir(), 'oneiro-vault-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
// Pretend a note was last touched long enough ago to be safe to add to.
const settle = (p, ago = 3_600_000) => utimes(p, new Date(Date.now() - ago), new Date(Date.now() - ago));
const leftovers = async root => (await readdir(root, { recursive: true })).filter(f => f.includes('.tmp'));

test('a model-supplied path stays inside the vault', () => {
  for (const ok of ['a.md', 'work/oneiro.md', 'people/ana smith.md']) assert.equal(safeNotePath(ok), ok);
  for (const bad of ['../x.md', '/etc/x.md', 'a/../../x.md', 'a/./x.md', 'a//x.md', 'a.txt', '', '.hidden.md', 'a/.git/x.md', 'a\\b.md', 'a/b/c/d/e.md', `${'x'.repeat(200)}.md`, 'x\0.md']) assert.equal(safeNotePath(bad), null, JSON.stringify(bad));
  assert.equal(slug('The Lease, Signing: Friday!'), 'the-lease-signing-friday');
});

test('a new note is created with its title and nothing is left behind', () => vault(async root => {
  const r = await addToNote({ root, path: 'projects/lease.md', title: 'Lease', addition: '## 5 Nov\n\n- Moved to Friday.' });
  assert.deepEqual([r.ok, r.created], [true, true]);
  assert.equal(await readFile(join(root, 'projects/lease.md'), 'utf8'), '# Lease\n\n## 5 Nov\n\n- Moved to Friday.\n');
  assert.deepEqual(await leftovers(root), []);
}));

test("the person's words keep every byte: additions go after them, even in an encoding that isn't UTF-8", () => vault(async root => {
  const path = join(root, 'mine.md');
  const theirs = Buffer.concat([Buffer.from('# My note\n\nCaf'), Buffer.from([0xe9]), Buffer.from(' with Ana, latin-1 and no final newline')]);
  await writeFile(path, theirs);
  await chmod(path, 0o600);
  await settle(path);
  const r = await addToNote({ root, path: 'mine.md', title: 'ignored', addition: '## 5 Nov\n\n- New.' });
  assert.deepEqual([r.ok, r.created], [true, false]);
  const after = await readFile(path);
  assert.deepEqual(after.subarray(0, theirs.length), theirs, 'the prefix is byte for byte what they wrote');
  assert.match(after.subarray(theirs.length).toString(), /^\n\n## 5 Nov\n\n- New\.\n$/);
  assert.equal((await stat(path)).mode & 0o777, 0o600, 'its permissions too');
}));

test('an edit that lands between staging and the swap wins: the night stands back and keeps the person\'s version', () => vault(async root => {
  const path = join(root, 'note.md');
  await writeFile(path, 'original\n');
  await settle(path);
  const r = await addToNote({ root, path: 'note.md', title: 'Note', addition: '- night words', hooks: { staged: async dest => { await writeFile(dest, 'original\nthe person just typed this\n'); } } });
  assert.equal(r.ok, false);
  assert.equal(r.retry, true);
  assert.match(r.why, /your version was kept/);
  assert.equal(await readFile(path, 'utf8'), 'original\nthe person just typed this\n');
  assert.deepEqual(await leftovers(root), []);
}));

test('a note the person deletes mid-write is not brought back', () => vault(async root => {
  const path = join(root, 'note.md');
  await writeFile(path, 'original\n');
  await settle(path);
  const r = await addToNote({ root, path: 'note.md', title: 'Note', addition: '- night words', hooks: { staged: async dest => { await rm(dest); } } });
  assert.equal(r.ok, false);
  await assert.rejects(readFile(path));
}));

test('a note the person creates in the same moment is not overwritten', () => vault(async root => {
  let once = true;
  const r = await addToNote({ root, path: 'new.md', title: 'New', addition: '- night words', hooks: { staged: async dest => { if (once) { once = false; await writeFile(dest, 'I made this first\n'); await settle(dest); } } } });
  assert.deepEqual([r.ok, r.created], [true, false]);
  const text = await readFile(join(root, 'new.md'), 'utf8');
  assert.ok(text.startsWith('I made this first\n'), text);
  assert.match(text, /- night words/);
}));

test('a note touched in the last couple of minutes is left alone, but a run can add to its own note twice', () => vault(async root => {
  const path = join(root, 'typing.md');
  await writeFile(path, 'still typing\n');
  const r = await addToNote({ root, path: 'typing.md', title: 'T', addition: '- x' });
  assert.equal(r.ok, false);
  assert.match(r.why, /edited in the last couple of minutes/);
  assert.equal(await readFile(path, 'utf8'), 'still typing\n');

  const ownWrites = new Map();
  assert.equal((await addToNote({ root, path: 'mine.md', title: 'M', addition: '- one', ownWrites })).ok, true);
  assert.equal((await addToNote({ root, path: 'mine.md', title: 'M', addition: '- two', ownWrites })).ok, true);
  assert.match(await readFile(join(root, 'mine.md'), 'utf8'), /- one\n\n- two\n/);
}));

test('an unreadable note is refused, never treated as empty', { skip: process.getuid?.() === 0 }, () => vault(async root => {
  const path = join(root, 'locked.md');
  await writeFile(path, 'secret words\n');
  await settle(path);
  await chmod(path, 0o000);
  try {
    const r = await addToNote({ root, path: 'locked.md', title: 'L', addition: '- x' });
    assert.equal(r.ok, false);
    assert.match(r.why, /couldn't read locked\.md/);
    const listed = await listNotes(root);
    assert.deepEqual(listed.unreadable, ['locked.md']);
  } finally { await chmod(path, 0o644); }
  assert.equal(await readFile(path, 'utf8'), 'secret words\n');
}));

test('a symlinked folder or note can\'t carry a write out of the vault', () => vault(async root => {
  const outside = await mkdtemp(join(tmpdir(), 'oneiro-outside-'));
  try {
    await writeFile(join(outside, 'target.md'), 'outside\n');
    await symlink(outside, join(root, 'link'));
    const r = await addToNote({ root, path: 'link/escape.md', title: 'E', addition: '- x' });
    assert.equal(r.ok, false);
    assert.match(r.why, /outside the knowledge base/);
    await assert.rejects(readFile(join(outside, 'escape.md')));
    await symlink(join(outside, 'target.md'), join(root, 'alias.md'));
    const s = await addToNote({ root, path: 'alias.md', title: 'E', addition: '- x' });
    assert.equal(s.ok, false);
    assert.equal(await readFile(join(outside, 'target.md'), 'utf8'), 'outside\n');
  } finally { await rm(outside, { recursive: true, force: true }); }
}));

test('nothing else in the vault is touched: other notes, attachments, an .obsidian folder', () => vault(async root => {
  await mkdir(join(root, '.obsidian'));
  await writeFile(join(root, '.obsidian/workspace.json'), '{"a":1}');
  await writeFile(join(root, 'photo.png'), 'not really a png');
  await writeFile(join(root, 'other.md'), '# Other\n');
  const before = (await stat(join(root, 'other.md'))).mtimeMs;
  await addToNote({ root, path: 'new.md', title: 'New', addition: '- x' });
  assert.equal(await readFile(join(root, '.obsidian/workspace.json'), 'utf8'), '{"a":1}');
  assert.equal(await readFile(join(root, 'photo.png'), 'utf8'), 'not really a png');
  assert.equal((await stat(join(root, 'other.md'))).mtimeMs, before);
  const { files } = await listNotes(root);
  assert.deepEqual(files.map(f => [f.path, f.title]).sort(), [['new.md', 'New'], ['other.md', 'Other']], 'hidden folders and attachments aren\'t notes');
}));

test('a brief lands on a new name and never on an existing note', () => vault(async root => {
  const a = await createNote({ root, folder: 'Briefs', name: 'lease', title: 'Lease', body: 'first' });
  const b = await createNote({ root, folder: 'Briefs', name: 'lease', title: 'Lease', body: 'second' });
  assert.deepEqual([a.path, b.path], ['Briefs/lease.md', 'Briefs/lease-2.md']);
  assert.match(await readFile(join(root, 'Briefs/lease.md'), 'utf8'), /first/);
}));
