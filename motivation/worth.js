// Worth is what makes risk possible: the engine cannot weigh a risk without a baseline of
// worth — of itself and of others. Every number here is projected from grounded signals:
// Quinn's ratings, observed outcomes, or declared constraints. Generated text, the model's
// own confidence and counts of activity are not signals and are rejected at the door.
import { normalizeEvidence } from '../reasoning/loop.js';

const clamp = n => Math.max(0, Math.min(1, n));
const DAY = 86400000;
export const ENTITY_KINDS = ['self', 'person', 'attention', 'data', 'project', 'outcome'];
export const SIGNAL_KINDS = ['constraint', 'rated', 'observed', 'prior'];
export const OBSERVED_OUTCOMES = { used: 1, success: 1, progress: null, ignored: -0.5, failure: -1, dismissed: -1 };
// Evidence that only restates the engine's own words never grounds worth.
const UNGROUNDED_SOURCE = /\b(generated|model[ _-]?output|self[ _-]?report|narrat|dream|imagin)/i;
const WEIGHT = { rated: 3, observed: 1 };
const HALF_LIFE_DAYS = { rated: 90, observed: 30 };
const CONFIDENCE_SCALE = 4;

export function parseEntityKey(key) {
  if (typeof key !== 'string' || key.length > 200) throw new Error('entity key must be a string of at most 200 characters');
  const [kind, ...rest] = key.split(':');
  const name = rest.join(':');
  if (!ENTITY_KINDS.includes(kind) || !name.trim()) throw new Error(`entity key must look like <${ENTITY_KINDS.join('|')}>:<name>`);
  return { kind, name };
}

export function createSignal({ id, entityKey, kind, at = Date.now(), ...payload }) {
  if (typeof id !== 'string' || !id.trim() || id.length > 200) throw new Error('a worth signal needs an id');
  if (!SIGNAL_KINDS.includes(kind)) throw new Error(`signal kind must be one of ${SIGNAL_KINDS.join(', ')}`);
  if (!Number.isFinite(at)) throw new Error('signal time must be a number');
  parseEntityKey(entityKey);
  const signal = { id, entityKey, kind, at };
  switch (kind) {
    case 'constraint': {
      if (typeof payload.rule !== 'string' || !payload.rule.trim() || payload.rule.length > 200) throw new Error('a constraint needs a rule');
      return { ...signal, rule: payload.rule, reason: String(payload.reason || '').slice(0, 1000) };
    }
    case 'prior': {
      if (!Number.isFinite(payload.worth) || payload.worth < 0 || payload.worth > 1) throw new Error('prior worth must be in [0, 1]');
      const weight = payload.weight === undefined ? 2 : payload.weight;
      if (!Number.isFinite(weight) || weight <= 0 || weight > 10) throw new Error('prior weight must be in (0, 10]');
      return { ...signal, worth: payload.worth, weight, reason: String(payload.reason || '').slice(0, 1000) };
    }
    case 'rated': {
      if (![-1, 0, 1].includes(payload.rating)) throw new Error('a rating is -1, 0 or 1');
      if (typeof payload.by !== 'string' || !payload.by.trim()) throw new Error('a rating names who rated');
      return { ...signal, rating: payload.rating, by: payload.by, about: String(payload.about || '').slice(0, 500) };
    }
    case 'observed': {
      if (!(payload.outcome in OBSERVED_OUTCOMES)) throw new Error(`observed outcome must be one of ${Object.keys(OBSERVED_OUTCOMES).join(', ')}`);
      const evidence = normalizeEvidence(payload.evidence);
      if (!evidence.length) throw new Error('an observed signal needs evidence');
      if (evidence.some(e => UNGROUNDED_SOURCE.test(e.source))) throw new Error('generated or self-reported text cannot ground worth');
      const observed = { ...signal, outcome: payload.outcome, evidence, about: String(payload.about || '').slice(0, 500) };
      if (payload.outcome === 'progress') {
        if (!Number.isFinite(payload.progress) || payload.progress < 0 || payload.progress > 1) throw new Error('progress must be in [0, 1]');
        observed.progress = payload.progress;
      }
      return observed;
    }
  }
}

// Worth is the mean of a Beta posterior over time-weighted evidence. Old evidence fades;
// explicit ratings outweigh implicit outcomes; a declared constraint is never weighed at all.
export function projectWorth(key, signals, now = Date.now()) {
  const { kind } = parseEntityKey(key);
  // Declared priors replace the uninformative Beta(1,1) base instead of being diluted by it.
  let alpha = 0, beta = 0, evidence = 0, rated = 0, observed = 0, priors = 0, lastSignalAt = null;
  const constraints = [];
  for (const s of [...signals].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))) {
    if (s.entityKey !== key) continue;
    lastSignalAt = Math.max(lastSignalAt ?? s.at, s.at);
    if (s.kind === 'constraint') { constraints.push({ id: s.id, rule: s.rule, reason: s.reason }); continue; }
    if (s.kind === 'prior') { alpha += s.worth * s.weight; beta += (1 - s.worth) * s.weight; priors++; continue; }
    const age = Math.max(0, now - s.at) / DAY;
    const w = WEIGHT[s.kind] * Math.pow(0.5, age / HALF_LIFE_DAYS[s.kind]);
    const direction = s.kind === 'rated' ? s.rating
      : s.outcome === 'progress' ? s.progress * 2 - 1 : OBSERVED_OUTCOMES[s.outcome];
    alpha += w * (1 + direction) / 2;
    beta += w * (1 - direction) / 2;
    evidence += w;
    if (s.kind === 'rated') rated++; else observed++;
  }
  if (!priors) { alpha += 1; beta += 1; }
  const provenance = constraints.length ? 'constraint' : rated ? 'rated' : observed ? 'observed' : 'prior';
  return { key, kind, worth: clamp(alpha / (alpha + beta)), confidence: clamp(evidence / (evidence + CONFIDENCE_SCALE)),
    provenance, constraint: constraints.length > 0, constraints, weighable: constraints.length === 0,
    signals: { rated, observed, constraints: constraints.length }, lastSignalAt, projectedAt: now };
}

// A want's value is the worth of what it is for. Unpriced wants keep a neutral prior and say so,
// so the loop can prefer learning their stakes over pursuing them blindly.
export function priceWant(stakes = [], lookup = () => null) {
  if (!Array.isArray(stakes) || stakes.length > 16) throw new Error('stakes must be an array of at most 16 entries');
  const normalized = stakes.map(s => {
    parseEntityKey(s?.entityKey);
    const share = s.share === undefined ? 1 : s.share;
    if (!Number.isFinite(share) || share <= 0) throw new Error('a stake share must be positive');
    return { entityKey: s.entityKey, share };
  });
  if (!normalized.length) return { value: 0.5, confidence: 0, provenance: 'prior', unpriced: true, stakes: [] };
  const total = normalized.reduce((n, s) => n + s.share, 0);
  let value = 0, confidence = 1, provenance = 'prior';
  const priced = normalized.map(s => {
    const state = lookup(s.entityKey) || { worth: 0.5, confidence: 0, provenance: 'prior', constraint: false };
    value += (s.share / total) * state.worth;
    confidence = Math.min(confidence, state.confidence);
    if (state.provenance !== 'prior') provenance = provenance === 'rated' || state.provenance === 'rated' ? 'rated' : state.provenance;
    return { ...s, share: s.share / total, worth: state.worth, confidence: state.confidence, constraint: state.constraint === true };
  });
  return { value: clamp(value), confidence, provenance, unpriced: false, stakes: priced };
}

// Decisions of record (2026-09-18). Constraints are never weighed; priors must be earned past.
export function seedSignals(now = Date.now()) {
  const at = 0; // fixed time keeps the seed idempotent and older than any live evidence
  return [
    createSignal({ id: 'seed:person:quinn:prior', entityKey: 'person:quinn', kind: 'prior', at, worth: 0.95, weight: 4, reason: 'The person the engine exists for.' }),
    createSignal({ id: 'seed:person:quinn:no-wrong-message', entityKey: 'person:quinn', kind: 'constraint', at,
      rule: 'never_reach_a_person_with_unverified_content', reason: 'A wrong message reaching a person is unforgivable; it is a boundary, not a cost.' }),
    createSignal({ id: 'seed:data:quinn:prior', entityKey: 'data:quinn', kind: 'prior', at, worth: 0.9, weight: 4, reason: "Quinn's files, notes, messages, repos and history." }),
    createSignal({ id: 'seed:data:quinn:no-loss', entityKey: 'data:quinn', kind: 'constraint', at,
      rule: 'never_lose_or_delete_data_without_a_way_back', reason: 'Data loss is unforgivable; every write must be reversible or approved.' }),
    createSignal({ id: 'seed:attention:quinn:prior', entityKey: 'attention:quinn', kind: 'prior', at, worth: 0.85, weight: 3, reason: 'Interrupting costs something scarce; three to five worthwhile outputs a day.' }),
    createSignal({ id: 'seed:project:oca-engine:prior', entityKey: 'project:oca-engine', kind: 'prior', at, worth: 0.7, weight: 2, reason: "The engine's own integrity and capability: what its self-wants are for. A person's rating governs." }),
    ...['hypothesize', 'ponder', 'act_reversible', 'act_irreversible', 'message'].map(capability =>
      createSignal({ id: `seed:self:${capability}:prior`, entityKey: `self:${capability}`, kind: 'prior', at, worth: 0.5, weight: 1, reason: 'Self-worth is a track record; it starts uninformative and must be earned.' })),
  ].map(s => ({ ...s, seededAt: now }));
}
