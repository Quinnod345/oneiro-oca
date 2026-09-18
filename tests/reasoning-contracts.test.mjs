import test from 'node:test';
import assert from 'node:assert/strict';
import { currentEvidence, normalizeEvidence, grounding, createReasoner } from '../reasoning/loop.js';
import { proposalSchema, reviewSchema } from '../reasoning/schemas.js';

const old = { id: 'old', source: 'observed before correction', observation: 'The implementation is absent.' };
const corrected = { id: 'new', source: 'observed after correction', observation: 'The implementation now exists.', supersedes: ['old'] };
test('observed supersession retires old premises without erasing receipt history', () => {
  const all = normalizeEvidence([old, corrected]);
  assert.equal(all.length, 2);
  assert.deepEqual(currentEvidence(all), [corrected]);
  assert.equal(grounding({ claims: [{ statement: old.observation, evidenceIds: ['old'] }] }, currentEvidence(all)).supported, false);
  assert.deepEqual(currentEvidence([corrected]), [corrected], 'correction may refer to an archived observation');
});
test('supersession follows chains and rejects cyclic provenance', () => {
  const latest = { id: 'latest', source: 'later observation', observation: 'A newer correction.', supersedes: ['new'] };
  assert.deepEqual(currentEvidence([old, corrected, latest]), [latest]);
  assert.throws(() => currentEvidence([{ ...old, supersedes: ['new'] }, corrected]), /cycle/);
  assert.throws(() => normalizeEvidence([{ ...old, supersedes: ['old'] }]), /other evidence/);
});
test('reasoning sends transport schemas and never presents superseded premises as current support', async () => {
  const schemas = [];
  const generate = async request => {
    schemas.push(request.schema);
    const payload = JSON.parse(request.prompt);
    assert.deepEqual(payload.evidence, [corrected]);
    if (request.schema === proposalSchema) return JSON.stringify({ action: 'Verify the implemented behavior.', claims: [{ statement: corrected.observation, evidenceIds: ['new'] }], unknowns: [], confidence: 0.8 });
    return JSON.stringify(Object.fromEntries(['skeptic','dreamer','empath'].map(k => [k, { argument: 'The supplied observation supports this next check.', blockers: [], evidenceIds: ['new'], confidence: 0.8 }])));
  };
  const result = await createReasoner({ generate })('Check the correction', { evidence: [old, corrected] });
  assert.equal(result.status, 'converged');
  assert.deepEqual(result.supersededEvidenceIds, ['old']);
  assert.deepEqual(schemas, [proposalSchema, reviewSchema, reviewSchema]);
});
test('local provider forwards strict JSON schema without changing ordinary requests', async () => {
  const previousBackend = process.env.OCA_LLM_BACKEND, previousFetch = globalThis.fetch;
  process.env.OCA_LLM_BACKEND = 'local';
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { default: llm } = await import('../llm.js');
    await llm.messages.create({ messages: [{ role: 'user', content: 'schema fixture' }] }, { responseSchema: proposalSchema });
    await llm.messages.create({ messages: [{ role: 'user', content: 'ordinary fixture' }] });
    assert.deepEqual(requests[0].response_format, { type: 'json_schema', json_schema: { name: 'oca_response', strict: true, schema: proposalSchema } });
    assert.equal(requests[1].response_format, undefined);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBackend === undefined) delete process.env.OCA_LLM_BACKEND;
    else process.env.OCA_LLM_BACKEND = previousBackend;
  }
});
