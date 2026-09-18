// Provider/persistence adapter for the evidence-bound loop. See docs/evidence-loop.md.
import llm from '../llm.js';
import metacognition from '../metacognition/engine.js';
import { emit } from '../event-bus.js';
import { createReasoner, normalizeEvidence } from './loop.js';

const reasonerFor = options => createReasoner({ generate: async ({ system, prompt, signal, schema }) => {
  const response = await llm.messages.create({ model: options.model || 'claude-sonnet-4-6', provider: options.provider, system,
    messages: [{ role: 'user', content: prompt }], max_tokens: 800, temperature: 0.2 }, { signal, priority: 10, responseSchema: schema });
  return response.content?.[0]?.text || '';
} });

export async function reason(goal, options = {}) {
  const result = await reasonerFor(options)(goal, options);
  const traceId = await metacognition.traceReasoning(goal, result.steps, result.conclusion || result.error || result.status);
  await emit('reasoning_trace_created', 'reasoning', { traceId, goal, status: result.status,
    confidence: result.confidence, confidenceKind: result.confidenceKind, shouldExecute: result.shouldExecute,
    stakes: options.stakes || 'medium' }, { priority: 0.5 });
  return { ...result, traceId, stakes: options.stakes || 'medium' };
}

export async function evaluate(traceId, { wasCorrect, evidence, errorStep = null, errorType = null, lesson = null } = {}) {
  const observed = normalizeEvidence(evidence);
  if (typeof wasCorrect !== 'boolean' || !observed.length) throw new Error('evaluation requires a boolean outcome and observed evidence');
  await metacognition.evaluateTrace(traceId, wasCorrect, errorStep, errorType,
    JSON.stringify({ lesson, evidence: observed }));
  return { traceId, evaluated: true, evidence: observed };
}
export default { reason, evaluate };
