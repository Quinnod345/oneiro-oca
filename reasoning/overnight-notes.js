// The knowledge base: a folder of plain markdown that belongs to the person. The night only ever adds to it.
//
// The rules that keep their words safe:
// - A note Oneiro didn't create, or one the person has edited, keeps every byte: additions go after the existing bytes,
//   untouched and undecoded, so even a note in an odd encoding survives. Nothing here deletes a note or rewrites its body.
// - Every write is a temp file in the same folder plus a rename, so a reader never sees half a note.
// - A note is re-read just before the rename. If it changed since the addition was staged, the rename doesn't happen
//   and the words stay queued for the next pass.
// - A note touched in the last two minutes is left alone: the person may be typing in it.
// - An unreadable note is refused, never treated as empty.
// - Model-supplied paths stay inside the vault, even through a symlinked folder.
import { createHash, randomBytes } from 'node:crypto';
import { lstat, link, mkdir, open, readdir, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { clip } from './clip.js';

export const RECENT_EDIT_MS = 2 * 60_000;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Relative, ends in .md, no dot-segments or hidden parts, a sensible depth and length. The only shape accepted.
export function safeNotePath(path) {
  const p = String(path ?? '').trim();
  if (!p || p.length > 160 || p.startsWith('/') || p.includes('\\') || p.includes('\0') || !p.toLowerCase().endsWith('.md')) return null;
  const parts = p.split('/');
  if (parts.length > 4 || parts.some(x => !x || x === '.' || x === '..' || x.startsWith('.'))) return null;
  return p;
}

export function slug(text, max = 60) {
  return String(text ?? '').normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '').toLowerCase() || 'note';
}

const HIDDEN_DIRS = new Set(['node_modules']);
// What's in the vault, for the write-up to merge into. Unreadable notes come back separately so a caller can say so.
export async function listNotes(root, { limit = 400 } = {}) {
  const files = [], unreadable = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (e) { if (e.code === 'ENOENT') return; unreadable.push(relative(root, dir) || '.'); return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= limit) return;
      if (entry.name.startsWith('.') || HIDDEN_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        try { const head = (await readFile(full, 'utf8')).slice(0, 2000); files.push({ path: relative(root, full).split(sep).join('/'), title: head.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(entry.name, '.md') }); }
        catch { unreadable.push(relative(root, full).split(sep).join('/')); }
      }
    }
  }
  await walk(root);
  return { files, unreadable };
}

// Find where a note may live, refusing anything that resolves outside the vault.
async function resolveInside(root, path) {
  await mkdir(root, { recursive: true });
  const realRoot = await realpath(root);
  const dest = join(realRoot, path);
  await mkdir(dirname(dest), { recursive: true });
  const realDir = await realpath(dirname(dest));
  if (realDir !== realRoot && !realDir.startsWith(realRoot + sep)) throw Object.assign(new Error(`${path} points outside the knowledge base`), { refused: true });
  return dest;
}

// Add words to a note, creating it if it isn't there. Returns { ok: true, created, path } or { ok: false, why, retry }.
// `ownWrites` (path → mtimeMs) lets one run add to a note twice without mistaking its own write for the person's.
// `hooks.staged` runs between staging and the final check, so a test can edit the note at the worst moment.
export async function addToNote({ root, path, title, addition, now = Date.now(), ownWrites = new Map(), recentEditMs = RECENT_EDIT_MS, hooks = {} }) {
  const safe = safeNotePath(path);
  if (!safe) return { ok: false, why: `"${clip(path, 80)}" isn't a safe place for a note`, retry: false };
  let dest;
  try { dest = await resolveInside(root, safe); }
  catch (e) { return { ok: false, why: e.refused ? e.message : `couldn't reach ${safe}: ${e.message}`, retry: !e.refused }; }

  const tmp = join(dirname(dest), `.${basename(dest)}.oneiro-${randomBytes(5).toString('hex')}.tmp`);
  for (let attempt = 0; attempt < 2; attempt++) {
    let before = null, mode = 0o644;
    try {
      const info = await lstat(dest);
      if (!info.isFile()) return { ok: false, why: `${safe} isn't a plain file, so it was left alone`, retry: false };
      const known = ownWrites.get(safe);
      if (known !== info.mtimeMs && now - info.mtimeMs < recentEditMs) return { ok: false, why: `${safe} was edited in the last couple of minutes, so it was left alone`, retry: true };
      before = await readFile(dest);
      mode = info.mode & 0o777;
    } catch (e) {
      if (e.code !== 'ENOENT') return { ok: false, why: `couldn't read ${safe} (${e.code || e.message}), so it was left alone`, retry: true };
    }
    const lead = before === null ? Buffer.from(`# ${String(title || basename(safe, '.md')).replace(/\s+/g, ' ').trim()}\n\n`)
      : before.length === 0 || before[before.length - 1] === 0x0a ? Buffer.from('\n') : Buffer.from('\n\n');
    const bytes = Buffer.concat([before ?? Buffer.alloc(0), lead, Buffer.from(`${String(addition).trim()}\n`)]);
    try {
      const fh = await open(tmp, 'wx', mode);
      try { await fh.writeFile(bytes); await fh.sync(); } finally { await fh.close(); }
      await hooks.staged?.(dest);
      if (before === null) {
        // link fails if the person created this note a moment ago, where a rename would overwrite it.
        try { await link(tmp, dest); }
        catch (e) { if (e.code === 'EEXIST') { await unlink(tmp).catch(() => {}); continue; } throw e; }
        await unlink(tmp).catch(() => {});
      } else {
        const current = await readFile(dest).catch(() => null);
        if (current === null || sha(current) !== sha(before)) { await unlink(tmp).catch(() => {}); return { ok: false, why: `${safe} changed while Oneiro was writing, so your version was kept`, retry: true }; }
        await rename(tmp, dest);
      }
      ownWrites.set(safe, (await stat(dest)).mtimeMs);
      return { ok: true, created: before === null, path: safe };
    } catch (e) {
      await unlink(tmp).catch(() => {});
      return { ok: false, why: `couldn't write ${safe}: ${e.message}`, retry: true };
    }
  }
  return { ok: false, why: `${safe} kept changing while Oneiro was writing, so it was left alone`, retry: true };
}

// A new note that must not land on an existing one (a saved brief): the name gets a number if it is taken.
export async function createNote({ root, folder, name, title, body }) {
  for (let n = 1; n <= 50; n++) {
    const path = `${folder}/${name}${n > 1 ? `-${n}` : ''}.md`;
    let exists = false;
    try { await lstat(join(root, path)); exists = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (exists) continue;
    const r = await addToNote({ root, path, title, addition: body });
    if (r.ok && r.created) return r;
    if (!r.ok) throw new Error(r.why);
  }
  throw new Error(`too many notes named ${name} already`);
}
