import test from 'node:test';
import assert from 'node:assert/strict';
import { setInferencePolicy, getInferencePolicy, resolveProvider, INFERENCE_MODES } from '../llm.js';

test('the inference mode routes a step: local never reaches Codex, cloud sends local steps to Codex, auto leaves the ask alone', () => {
  assert.deepEqual(INFERENCE_MODES, ['local', 'auto', 'cloud']);
  const codex = getInferencePolicy().codexAvailable;
  setInferencePolicy({ mode: 'local' });
  assert.equal(resolveProvider('codex'), 'local'); assert.equal(resolveProvider('local'), 'local'); assert.equal(resolveProvider('openai'), 'openai');
  setInferencePolicy({ mode: 'cloud' });
  assert.equal(resolveProvider('local'), codex ? 'codex' : 'local', 'cloud without a Codex binary still thinks locally');
  assert.equal(resolveProvider('codex'), 'codex');
  setInferencePolicy({ mode: 'auto' });
  assert.equal(resolveProvider('local'), 'local'); assert.equal(resolveProvider('codex'), 'codex'); assert.equal(resolveProvider('nonsense'), 'local');
  assert.throws(() => setInferencePolicy({ mode: 'fast' }), /inference mode must be one of/);
  assert.equal(getInferencePolicy().mode, 'auto', 'a bad mode changes nothing');
});

test('the cloud model and effort are validated and default to gpt-6-astra at high', () => {
  const p = getInferencePolicy();
  assert.equal(p.cloudModel, process.env.OCA_CODEX_MODEL || process.env.ONEIRO_CODEX_MODEL || 'gpt-6-astra');
  assert.equal(p.cloudEffort, process.env.OCA_CODEX_REASONING_EFFORT || process.env.ONEIRO_CODEX_REASONING_EFFORT || 'high');
  setInferencePolicy({ cloudModel: 'gpt-6-astra', cloudEffort: 'XHIGH' });
  assert.equal(getInferencePolicy().cloudEffort, 'xhigh');
  setInferencePolicy({ cloudModel: 'rm -rf /', cloudEffort: 'turbo' });
  assert.equal(getInferencePolicy().cloudModel, 'gpt-6-astra'); assert.equal(getInferencePolicy().cloudEffort, 'xhigh');
  setInferencePolicy({ cloudEffort: 'high' });
  assert.deepEqual(Object.keys(getInferencePolicy().stats.calls).sort(), ['anthropic', 'codex', 'local', 'openai']);
});
