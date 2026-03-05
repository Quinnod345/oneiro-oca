// OCA Reasoning Controller
// Structured pipeline: propose -> critique -> revise -> verify
import deliberation from '../deliberation/engine.js';
import metacognition from '../metacognition/engine.js';
import { emit } from '../event-bus.js';

function estimateConfidence(text) {
  const t = String(text || '').toLowerCase();
  let score = 0.5;
  if (/\bdefinitely\b|\bcertain\b|\bstrong evidence\b/.test(t)) score += 0.2;
  if (/\bprobably\b|\blikely\b/.test(t)) score += 0.1;
  if (/\bmaybe\b|\bunclear\b|\buncertain\b|\binsufficient\b/.test(t)) score -= 0.15;
  if (/\brisk\b|\bunknown\b|\bassumption\b/.test(t)) score -= 0.08;
  return Math.max(0.05, Math.min(0.95, score));
}

export async function reason(goal, {
  context = '',
  stakes = 'medium',
  timeBudgetSeconds = 45,
  minConfidence = 0.55,
} = {}) {
  const startedAt = Date.now();

  const proposal = await deliberation.quickCheck(
    'builder',
    `Goal: ${goal}\nPropose the best next action with concrete rationale.`,
    context
  );

  const critique = await deliberation.quickCheck(
    'skeptic',
    `Critique this proposal and identify failure modes:\n${proposal}`,
    context
  );

  const revision = await deliberation.quickCheck(
    'builder',
    `Revise the proposal to address this critique:\n${critique}\n\nOriginal proposal:\n${proposal}`,
    context
  );

  const verification = await deliberation.quickCheck(
    'empath',
    `Verify user impact and practical clarity of this revised plan:\n${revision}`,
    context
  );

  const confidence = (
    estimateConfidence(proposal)
    + estimateConfidence(revision)
    + estimateConfidence(verification)
  ) / 3;

  const shouldExecute = confidence >= minConfidence;
  const conclusion = shouldExecute
    ? revision
    : `${revision}\n\nVerification indicates low confidence; gather more evidence before execution.`;

  const steps = [
    { stage: 'propose', output: proposal, confidence: estimateConfidence(proposal) },
    { stage: 'critique', output: critique, confidence: estimateConfidence(critique) },
    { stage: 'revise', output: revision, confidence: estimateConfidence(revision) },
    { stage: 'verify', output: verification, confidence: estimateConfidence(verification) },
  ];

  const traceId = await metacognition.traceReasoning(goal, steps, conclusion);
  const result = {
    mode: 'reasoning_controller',
    traceId,
    stakes,
    steps,
    confidence,
    shouldExecute,
    conclusion,
    elapsedMs: Date.now() - startedAt,
    timeBudgetSeconds,
  };

  await emit('reasoning_trace_created', 'reasoning', {
    traceId,
    goal,
    confidence,
    shouldExecute,
    stakes
  }, { priority: 0.5 });

  return result;
}

export async function evaluate(traceId, {
  wasCorrect,
  errorStep = null,
  errorType = null,
  lesson = null,
} = {}) {
  await metacognition.evaluateTrace(traceId, !!wasCorrect, errorStep, errorType, lesson);
  return { traceId, evaluated: true };
}

export default { reason, evaluate };
