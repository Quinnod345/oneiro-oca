import test from 'node:test';
import assert from 'node:assert/strict';

test('OCA startup graph imports every required runtime module', async () => {
  const ocaModule = await import('../index.js');
  assert.ok(ocaModule.default);
  assert.equal(typeof ocaModule.default.init, 'function');
});
