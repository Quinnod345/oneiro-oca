// The root wake helper, run for real against a fake engine and a stub pmset. What matters most: it always lets the Mac
// sleep again, on every path, and it holds the lid only while the engine reports the run alive.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELPER_VERSION } from '../reasoning/overnight.js';

const HELPER = fileURLToPath(new URL('../../scripts/overnight/oneiro-wake-helper.sh', import.meta.url));
const INSTALLER = fileURLToPath(new URL('../../scripts/overnight/install-overnight-helper.sh', import.meta.url));

async function harness(run, { batt = "Now drawing from 'AC Power'", general = ' powermode            0' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'oneiro-helper-'));
  const pmsetLog = join(dir, 'pmset.log');
  await writeFile(join(dir, 'pmset'), `#!/bin/bash
if [ "$1" = "-g" ] && [ "$2" = "batt" ]; then echo ${JSON.stringify(batt)}; exit 0; fi
if [ "$1" = "-g" ]; then echo ${JSON.stringify(general)}; exit 0; fi
echo "$*" >> ${JSON.stringify(pmsetLog)}
`);
  await chmod(join(dir, 'pmset'), 0o755);
  const engine = { posts: [], alive: [], run: () => ({ started: true }), state: () => ({ alive: true, done: false }) };
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', d => { body += d; });
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/oca/night/run') { engine.posts.push(JSON.parse(body)); return res.end(JSON.stringify(engine.run(engine.posts.length))); }
      if (req.url === '/oca/night/alive') { engine.alive.push(Date.now()); return res.end(JSON.stringify(engine.state(engine.alive.length))); }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const logFile = join(dir, 'helper.log');
  const env = { PATH: `${dir}:/usr/bin:/bin`, ONEIRO_ENGINE_URL: `http://127.0.0.1:${server.address().port}`, ONEIRO_OVERNIGHT_LOG: logFile, ONEIRO_OVERNIGHT_POLL: '1', ONEIRO_OVERNIGHT_ALIVE_THRESHOLD: '2', ONEIRO_OVERNIGHT_START_GRACE: '2', ONEIRO_OVERNIGHT_MAX_RUN: '30' };
  const helper = (over = {}) => new Promise(resolve => execFile('/bin/bash', [HELPER], { env: { ...env, ...over } }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  const pmset = () => readFile(pmsetLog, 'utf8').catch(() => '');
  const log = () => readFile(logFile, 'utf8').catch(() => '');
  try { await run({ engine, helper, pmset, log, env, server }); }
  finally { server.closeAllConnections?.(); await new Promise(r => server.close(r)); await rm(dir, { recursive: true, force: true }); }
}
const HOLD = 'disablesleep 1\n', RELEASE = 'disablesleep 0\n';

test('the helper carries the version the engine checks for, and the installer no longer bakes in an app folder', async () => {
  const src = await readFile(HELPER, 'utf8');
  assert.match(src, new RegExp(`oneiro-helper-version: ${HELPER_VERSION}\\b`));
  assert.doesNotMatch(src, /overnight\.request|__USER_SUPPORT__|overnight\.heartbeat/);
  const installer = await readFile(INSTALLER, 'utf8');
  assert.doesNotMatch(installer, /__USER_SUPPORT__|Application Support/);
});

test('on battery it never holds the lid or asks the engine', () => harness(async ({ engine, helper, pmset, log }) => {
  await helper();
  assert.equal(engine.posts.length, 0);
  assert.doesNotMatch(await pmset(), /disablesleep 1/);
  assert.match(await log(), /not on AC power/);
}, { batt: "Now drawing from 'Battery Power'" }));

for (const [name, general] of [['powermode 1', ' powermode            1'], ['lowpowermode 1', ' lowpowermode         1']]) {
  test(`in Low Power Mode, written as ${name}, it does the same`, () => harness(async ({ engine, pmset, helper, log }) => {
    await helper();
    assert.equal(engine.posts.length, 0);
    assert.doesNotMatch(await pmset(), /disablesleep 1/);
    assert.match(await log(), /Low Power Mode/);
  }, { general }));
}
test('High Power mode is not Low Power Mode', () => harness(async ({ engine, helper }) => {
  engine.state = () => ({ alive: false, done: true });
  await helper();
  assert.equal(engine.posts.length, 1);
}, { general: ' powermode            2' }));

test('it asks the engine with the wake trigger, holds the lid while the run is alive, and lets go when it is done', () => harness(async ({ engine, helper, pmset, log }) => {
  engine.state = n => (n < 3 ? { alive: true, done: false } : { alive: false, done: true });
  await helper();
  assert.deepEqual(engine.posts, [{ trigger: 'wake' }]);
  assert.equal(await pmset(), HOLD + RELEASE, 'held first, released once');
  assert.ok(engine.alive.length >= 3);
  assert.match(await log(), /reported the night done/);
}));

test('deadman: the engine stops reporting the run alive and the lid goes', () => harness(async ({ engine, helper, pmset, log }) => {
  engine.state = n => (n < 2 ? { alive: true, done: false } : { alive: false, done: false });
  await helper();
  assert.equal(await pmset(), HOLD + RELEASE);
  assert.match(await log(), /hasn't been reported alive/);
}));

test('deadman: the engine dies mid-run and the lid goes', () => harness(async ({ engine, helper, pmset, log, server }) => {
  engine.state = n => { if (n >= 2) { server.closeAllConnections?.(); server.close(); } return { alive: true, done: false }; };
  await helper();
  assert.equal(await pmset(), HOLD + RELEASE);
  assert.match(await log(), /hasn't been reported alive/);
}));

test('it retries while the engine comes round, and gives up on one that never answers', () => harness(async ({ engine, helper, pmset, log }) => {
  engine.run = n => (n < 2 ? { error: 'starting up' } : { started: true });
  engine.state = () => ({ alive: false, done: true });
  await helper();
  assert.equal(engine.posts.length, 2);
  assert.equal(await pmset(), HOLD + RELEASE);

  const empty = await helper({ ONEIRO_ENGINE_URL: 'http://127.0.0.1:9' });
  assert.equal(empty.error, null);
  assert.match(await log(), /never accepted/);
  assert.match(await pmset(), /disablesleep 0\n$/);
}));

test('a run already going is held for; a night already done, or one the engine declines, lets go at once', () => harness(async ({ engine, helper, pmset, log }) => {
  engine.run = () => ({ started: false, already: true });
  engine.state = n => (n < 2 ? { alive: true, done: false } : { alive: false, done: true });
  await helper();
  assert.ok(engine.alive.length >= 2);

  const seen = engine.alive.length;
  engine.run = () => ({ started: false, done: true });
  await helper();
  assert.equal(engine.alive.length, seen);
  assert.match(await log(), /already ran tonight/);

  engine.run = () => ({ started: false, blocked: 'Low Power Mode is on.' });
  await helper();
  assert.equal(engine.alive.length, seen);
  assert.match(await log(), /declined/);
  assert.match(await pmset(), /disablesleep 0\n$/);
}));

test('the hard cap lets go even while the engine swears it is alive', () => harness(async ({ helper, pmset, log }) => {
  await helper({ ONEIRO_OVERNIGHT_MAX_RUN: '2', ONEIRO_OVERNIGHT_ALIVE_THRESHOLD: '60' });
  assert.equal(await pmset(), HOLD + RELEASE);
  assert.match(await log(), /max run time reached/);
}));

test('killed mid-run, it still lets the Mac sleep', () => harness(async ({ env, pmset }) => {
  const child = spawn('/bin/bash', [HELPER], { env: { ...env, ONEIRO_OVERNIGHT_ALIVE_THRESHOLD: '60' }, stdio: 'ignore' });
  const closed = new Promise(r => child.on('close', r));
  for (let i = 0; i < 50 && !(await pmset()).includes('disablesleep 1'); i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(await pmset(), HOLD);
  await new Promise(r => setTimeout(r, 300));
  child.kill('SIGTERM');
  await closed;
  assert.equal(await pmset(), HOLD + RELEASE);
}));
