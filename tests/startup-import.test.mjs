import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

test('OCA startup graph imports every required runtime module', async () => {
  const ocaModule = await import('../index.js');
  assert.ok(ocaModule.default);
  assert.equal(typeof ocaModule.default.init, 'function');
});

// The loop entrypoint self-starts on import and exits when another instance holds the lock, so it is
// checked in a child process: a clean exit (lock held) or a live start both prove the module graph loads.
test('cognitive-loop.js and its graph load without a missing module or syntax error', async () => {
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `const t = setTimeout(() => process.exit(0), 8000);
     import('${new URL('../cognitive-loop.js', import.meta.url).href}').then(() => {}).catch(e => { console.error('IMPORT FAILED', e.message); process.exit(3); });`],
    { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, OCA_ENABLE_AMBIENT_SIMULATION: '0' } });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  const code = await new Promise(resolve => child.on('exit', resolve));
  assert.notEqual(code, 3, stderr.split('\n').find(l => l.includes('IMPORT FAILED')) || stderr.slice(-400));
});

test('the retired dream and design-build machinery is gone from the runtime graph', async () => {
  for (const file of ['cognitive-loop.js', 'thinker-bridge.js', 'api-routes.js', 'index.js', 'executive/engine.js']) {
    const src = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(!/dream-executor|dream-policy|INSERT INTO dreams|UPDATE dreams/.test(src), `${file} neither imports the executor nor writes dreams`);
    assert.ok(!/design-model\/|design\/emotion-bridge|self_train|deriveTargetProject|thought\.build\b/.test(src), `${file} carries no design-build machinery`);
    assert.ok(!/autonomic\/self-modifier|runAutonomicCycle|UPDATE goals SET progress|processSuccess\((goal|'executive'|'self_train)/.test(src), `${file} neither self-modifies nor credits goals by count`);
  }
  await assert.rejects(import('../autonomic/self-modifier.js'), 'the self-modifier module is gone');
  const thinker = await readFile(new URL('../thinker-bridge.js', import.meta.url), 'utf8');
  assert.ok(!/"dream": \{|"append_dream"/.test(thinker), 'the thinker prompt no longer offers dream fields');
  assert.ok(/ACTIVE WANTS/.test(thinker), 'the thinker prompt carries active wants');
});
