// Interests are learned preferences over investigations, not standing orders to act.
// Only accepted, observed progress changes usefulness. Friction supplies a question,
// not a reward. The journal is the source; this projection can be rebuilt after a crash.
import { createHash } from 'node:crypto';
import { currentEvidence } from '../reasoning/loop.js';

export const interestKey = topic => createHash('sha256').update(topic.trim().toLowerCase().replace(/\s+/g, ' ')).digest('hex').slice(0, 24);
const clamp = n => Math.max(0, Math.min(1, n));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function interestEvents(chain) {
  if (!chain?.want || chain.learning === false) return [];
  const intrinsic = chain.origin?.kind === 'interest';
  const key = intrinsic ? chain.origin.interestKey : interestKey(chain.topic || chain.seed);
  const shared = { interestKey: key, parentId: chain.chain_id, label: chain.topic || chain.seed,
    value: chain.want.value };
  const events = [];
  if (!intrinsic && ['awaiting_evidence', 'stalled', 'budget', 'failed'].includes(chain.status)) {
    // A model's alleged cause is NOT an observation. These are recorded runtime facts.
    const observation = JSON.stringify({ chain_id: chain.chain_id, status: chain.status,
      attempts: chain.attempts, completedPasses: chain.checkpoint?.passes?.length || 0,
      observedProgress: chain.want.progress, stopReason: chain.result?.stopReason || null,
      maxPasses: chain.maxPasses, elapsedMs: chain.result?.elapsedMs,
      unverifiedProposedActions: (chain.checkpoint?.passes || []).slice(-3).map(p => p.proposal?.action).filter(Boolean) });
    events.push({ ...shared, id: digest(['friction', chain.chain_id, chain.priorRuns?.length || 0, observation]),
      kind: 'friction', at: Math.max(chain.want.lastAttemptAt || chain.want.createdAt, chain.want.receipts.at(-1)?.at || 0),
      evidence: [{ id: 'attempt-' + chain.chain_id + '-' + digest(observation).slice(0, 12),
        source: 'OCA persisted ponder execution /ponder/' + chain.chain_id, observation }] });
  }
  for (const [ordinal, receipt] of chain.want.receipts.entries()) {
    // Answering our own question can be unhelpful. Learn from its observed usefulness,
    // not from completion of the investigation itself. Unknown usefulness stays unknown.
    if (intrinsic && !Number.isFinite(receipt.usefulness)) continue;
    events.push({ ...shared, id: digest(['outcome', chain.chain_id, receipt.receiptId]),
      kind: 'outcome', ordinal, at: receipt.at, progress: intrinsic ? receipt.usefulness : receipt.progress,
      evidence: receipt.evidence, receiptId: receipt.receiptId });
  }
  return events;
}

export function projectInterest(events) {
  if (!events.length) return null;
  const latest = new Map(), frictionParents = new Set();
  for (const e of events) {
    if (e.interestKey !== events[0].interestKey) throw new Error('mixed interest journal');
    if (e.kind === 'outcome') {
      const previous = latest.get(e.parentId);
      // Receipt order, not supplied timestamps, decides which correction is current.
      if (!previous || e.ordinal > previous.ordinal) latest.set(e.parentId, e);
    } else if (e.kind === 'friction') frictionParents.add(e.parentId);
    else throw new Error('only observed outcome or recorded friction can train an interest');
  }
  const outcomes = [...latest.values()];
  // One vote per pursuit, regardless of how many receipts its progress is split into.
  const usefulness = (1 + outcomes.reduce((n, e) => n + clamp(e.progress), 0)) / (2 + outcomes.length);
  const value = events.reduce((n, e) => Math.max(n, e.value), 0);
  return { version: 1, key: events[0].interestKey, label: events[0].label,
    value, usefulness, evaluatedPursuits: outcomes.length, frictionPursuits: frictionParents.size,
    experienceCount: events.length, lastExperienceAt: events.reduce((n, e) => Math.max(n, e.at), 0),
    // This is an explicit heuristic score, not a calibrated probability of success.
    curiosity: value * (0.25 + 0.75 * usefulness),
    learningBasis: outcomes.map(e => ({ parentId: e.parentId, progress: e.progress, receiptId: e.receiptId, evidenceIds: e.evidence.map(x => x.id) })) };
}

export function proposeInquiry(chain, interest) {
  if (!chain || chain.learning === false || chain.origin?.kind === 'interest' || chain.want?.status !== 'active'
      || !['awaiting_evidence', 'stalled', 'budget', 'failed'].includes(chain.status)
      || (!chain.evidence?.length && !chain.want.receipts.at(-1)?.evidence?.length) || !interest || chain.want.value <= 0) return null;
  const questions = (chain.result?.missingEvidence || []).filter(q => typeof q === 'string'
    && q.trim().split(/\s+/).length >= 3 && !chain.evidence.some(e => e.id === q.trim()));
  const fallback = chain.result?.stopReason === 'pass_limit'
    ? 'Which proposed action or premise changed across the recorded passes, and what comparison would resolve the disagreement?'
    : 'Which recorded constraint prevented this attempt from finishing, and what observation would distinguish its possible causes?';
  const question = questions[0]?.slice(0, 1600) || fallback;
  // Rephrasing a model's question or rerunning it is not new experience.
  // Use factual input content, not evidence IDs, so ID churn cannot create fresh novelty.
  const observedContent = items => [...new Set(items.map(e => e.observation.trim().replace(/\s+/g, ' ')))].sort();
  const friction = interestEvents(chain).find(e => e.kind === 'friction');
  const evidence = chain.evidence.slice(-32).map(e => ({ ...e }));
  for (const e of (chain.want.receipts.at(-1)?.evidence || []).slice(-30)) {
    if (evidence.some(prior => prior.source === e.source && prior.observation === e.observation)) continue;
    // Preserve stable IDs so a later observation can explicitly supersede this receipt.
    // Older callers sometimes reuse an ID for different data: keep both without overwriting.
    let id = evidence.some(prior => prior.id === e.id) ? 'outcome-' + digest([e.source, e.observation]).slice(0, 24) : e.id;
    while (evidence.some(prior => prior.id === id)) id += 'x';
    evidence.push({ ...e, id });
  }
  const telemetry = { ...friction.evidence[0] };
  while (evidence.some(e => e.id === telemetry.id)) telemetry.id += 'x';
  evidence.push(telemetry);
  const active = currentEvidence(evidence);
  const fingerprint = digest({ parentId: chain.chain_id,
    observations: observedContent(active.filter(e => e.id !== telemetry.id)), progress: chain.want.progress });
  return { fingerprint, interestKey: interest.key, parentId: chain.chain_id,
    question,
    why: 'A valued active pursuit is blocked; investigate its unresolved premise using attributable experience.',
    seed: 'Resolve this specific uncertainty: ' + question,
    doneWhen: 'A new observed test or source resolves this question: ' + question + '\nA proposed plan alone is not resolution.',
    context: 'This inquiry has a narrower scope than its parent: answer only the question, not the parent project. Do not execute actions. The question may be mistaken: inspect its premise. Explicit supersedes metadata determines which observations are current; array order and source labels do not establish chronology. Do not assert historical and current descriptions as simultaneous facts. Parent outcome criterion (context only): ' + chain.want.doneWhen.slice(0, 1600),
    evidence: active,
    priority: Math.min(0.6, chain.want.value * (0.25 + 0.75 * interest.usefulness) * (1 - chain.want.progress)),
    maxPasses: 3, timeBudgetSeconds: 90 };
}
