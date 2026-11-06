// The engine does not run on OpenClaw (removed 2026-11): no CLI call, no gateway port, no ~/.openclaw path, no
// gateway module. A line may still say what was replaced and when; anything that would reach OpenClaw fails the suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVED = new Set(['docs/README-v1.2-archive.md']);   // a historical document, kept as written
const RECORDS = ['evals/openclaw-removal/'];                // the before/after record of the removal itself
const HISTORY = /replaced|removed|until 2026-11|before 2026-11|\(2026-11\)|-era|no openclaw|instead of the openclaw|without openclaw|that dependency/i;
const REACHES = /\.openclaw|bin\/openclaw|openclaw (gateway call|message send|channels\.|models auth|agents add)|OCA_OPENCLAW|['"`]openclaw['"`]/i;

const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n')
  .filter(f => f && !f.startsWith('cortex/') && !f.startsWith('node_modules/') && /\.(js|mjs|cjs|ts|json|sh|swift|md|sql|toml|ya?ml|plist|html)$/.test(f) && existsSync(join(ROOT, f)));

test('nothing in the engine reaches OpenClaw: no CLI, no gateway port, no ~/.openclaw path, no gateway module', () => {
  const offenders = [];
  for (const f of files) {
    if (ARCHIVED.has(f) || RECORDS.some(r => f.startsWith(r)) || f === 'tests/no-openclaw.test.mjs') continue;
    const lines = readFileSync(join(ROOT, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const where = `${f}:${i + 1}: ${line.trim().slice(0, 120)}`;
      if (/:18789\b|\/startupz\b/.test(line)) offenders.push(`gateway port: ${where}`);
      if (/from ['"][./]*gateway\.js['"]|createGateway\(/.test(line)) offenders.push(`gateway module: ${where}`);
      if (/openclaw/i.test(line) && (REACHES.test(line) || !HISTORY.test(line))) offenders.push(where);
    });
  }
  assert.deepEqual(offenders, [], `OpenClaw is still referenced:\n${offenders.join('\n')}`);
});

test('the gateway module and the OpenClaw bridge are gone', () => {
  for (const f of ['gateway.js', 'openclaw-bridge.js', 'tests/gateway.test.mjs']) assert.equal(existsSync(join(ROOT, f)), false, f);
});
