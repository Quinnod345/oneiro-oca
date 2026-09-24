#!/usr/bin/env node
// The public benchmark: anyone with this repo and a Postgres can run it and get the same two things —
//   1. the mechanism suite: every behavioral contract as an isolated test (worth, hunger, risk, affect, strategies);
//   2. the scorecard: each Chinese Room Meter dimension measured from the journals against its stated baseline,
//      or the exact evidence it still needs.
// Usage: node scripts/benchmark.mjs [--no-tests] [--json out.json] [--no-readme]
// A run to the default path also rewrites README.md's Measured block (evaluation/readme-table.js), so the README
// always shows the last run and its date rather than numbers someone once typed in.
import { spawn } from 'node:child_process';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const noTests = args.includes('--no-tests');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : join(root, 'evaluation', 'results', 'latest.json');
// Only the canonical run speaks for the README: a run to a custom path is someone's experiment.
const writeReadme = !args.includes('--no-readme') && !args.includes('--json');

async function runTests() {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--test', 'tests/'], { cwd: root, env: { ...process.env, OCA_ENABLE_AMBIENT_SIMULATION: '0' } });
    let out = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    child.on('exit', code => {
      const n = k => Number((out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1] || 0);
      resolve({ exitCode: code, tests: n('tests'), pass: n('pass'), fail: n('fail'), failing: [...out.matchAll(/^✖ (.+?) \(/gm)].map(m => m[1]).slice(0, 20) });
    });
  });
}

async function scorecard() {
  try {
    const { compute } = await import(join(root, 'evaluation', 'chinese-room-meter.js'));
    const s = await compute();
    const { pool } = await import(join(root, 'event-bus.js'));
    // The orchestrator's work, week over week, from the same journals (evaluation/operations.js).
    try { const { createOperations } = await import(join(root, 'evaluation', 'operations.js')); operationsReport = await createOperations({ pool }).measure(); }
    catch (e) { operationsReport = { error: e.message }; }
    await pool.end().catch(() => {});
    return s;
  } catch (e) { return { error: `scorecard unavailable: ${e.message}`, hint: 'Set DATABASE_URL to a Postgres with the OCA schema (npm run migrate).' }; }
}

let operationsReport = null;
const started = Date.now();
const tests = noTests ? null : await runTests();
const card = await scorecard();
const report = { benchmark_version: 1, ran_at: new Date().toISOString(), node: process.version, mechanism: tests, scorecard: card, operations: operationsReport, duration_ms: Date.now() - started };
await mkdir(dirname(jsonOut), { recursive: true });
await writeFile(jsonOut, JSON.stringify(report, null, 2) + '\n');
let readmeNote = '';
if (writeReadme) {
  const { renderMeasured, updateReadme } = await import(join(root, 'evaluation', 'readme-table.js'));
  const path = join(root, 'README.md');
  const r = updateReadme(await readFile(path, 'utf8'), renderMeasured(report));
  if (r.replaced) { await writeFile(path, r.text); readmeNote = 'README.md Measured block updated'; }
  else readmeNote = 'README.md has no measured markers; left unchanged';
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`OCA benchmark — ${report.ran_at}`);
if (tests) console.log(`mechanism suite: ${tests.pass}/${tests.tests} passing${tests.fail ? ` — FAILING: ${tests.failing.join('; ')}` : ''}`);
if (card.error) console.log(card.error, '\n ', card.hint);
else {
  console.log(`scorecard ${card.evaluation_version}: coverage ${(card.evidence_coverage * 100).toFixed(0)}% | composite ${card.composite ?? 'null (not all dimensions measured)'} | partial mean ${card.partial_mean?.toFixed(3) ?? '-'}`);
  for (const [k, v] of Object.entries(card.components)) {
    console.log(`  ${pad(k, 14)} ${pad(v.status, 22)} ${v.score == null ? '  -  ' : v.score.toFixed(3)}  n=${pad(v.n ?? '-', 6)} ${String(v.detail).slice(0, 96)}`);
  }
  console.log(`  ${card.interpretation}`);
}
if (operationsReport && !operationsReport.error) {
  const o = operationsReport, pct = r => (r == null ? '—' : `${Math.round(r * 100)}%`);
  console.log(`operations: went wrong ${pct(o.thisWeek.rates.wentWrong)} this week vs ${pct(o.lastWeek.rates.wentWrong)} (n=${o.thisWeek.counted}/${o.lastWeek.counted}); productive ${pct(o.thisWeek.rates.productive)}; fixes merged ${o.fixes.merged}, holding ${o.fixes.holding}/${o.fixes.matured}`);
}
console.log(`written: ${jsonOut}`);
if (readmeNote) console.log(readmeNote);
process.exit(tests?.fail ? 1 : 0);
