// Risk is what worth makes possible. A proposed action is appraised as expected worth gained
// against expected worth lost, bounded by how reversible it is. Two declared constraints are
// boundaries, never costs. Appetite — how much expected loss the engine will accept for a unit of
// expected gain — is the first thing affect modulates. Everything here is pure.
import { priceWant, parseEntityKey } from './worth.js';

const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
export const ACTION_KINDS = ['research_slice', 'deploy_agent', 'read', 'web_search', 'shell', 'edit_file', 'edit_own_code', 'build', 'message', 'note', 'app_action', 'escalate', 'ask'];
// How much of a harm actually lands, by how reversible the action is.
export const REVERSIBILITY = { readonly: 0, sandboxed: 0.05, undo: 0.25, none: 1 };
export const CAPABILITY_OF = { research_slice: 'act_reversible', deploy_agent: 'act_reversible', read: 'act_reversible', web_search: 'act_reversible', shell: 'act_reversible',
  edit_file: 'act_reversible', edit_own_code: 'act_reversible', build: 'act_reversible', app_action: 'act_reversible',
  message: 'message', note: 'message', escalate: 'act_irreversible', ask: 'message' };
// An ask is the one message the engine may send on its own: to its own person, saying only what it observed it
// needs (a sign-in, a file, a number), under a standing permission the person gave. Never to anyone else,
// never with unverified content — those are the constraint, not a cost.
export const OWNER_KEY = 'person:quinn';
export const DECISIONS = ['proceed', 'prepare_artifact', 'refuse', 'learn_stakes'];
export const BASE_APPETITE = 0.5;

// A person firing an action is its approval; the engine firing one is subject to the master switch.
export const FIRED_BY = ['engine', 'person'];

// Conservative reversibility for a shell command. Unknown means irreversible and touching Quinn's data.
const READONLY_SHELL = /^\s*(ls|cat|head|tail|grep|rg|ugrep|find|wc|stat|file|du|df|ps|lsof|pgrep|uptime|date|whoami|id|env|printenv|echo|pwd|which|type|man|git (status|log|diff|show|branch|remote|rev-parse|ls-files|blame)|curl (-[a-zA-Z]+ )*(-s )?https?:\/\/[^ ]+$|defaults read|plutil -p|launchctl (print|list)|sqlite3 [^ ]+ ['"]?(select|\.tables|\.schema)|psql .* -c ['"]?select|node --version|npm (ls|list|view)|python3? --version|sw_vers|system_profiler|ioreg|pmset -g|networksetup -get|ifconfig|netstat|nslookup|dig|ping -c)\b/i;
const UNDO_SHELL = /^\s*(git (add|commit|checkout -b|switch -c|stash|fetch|pull --ff-only)|npm (test|run (test|build|lint))|node --test|mkdir -p|cp (?!-r)|touch)\b/i;
const DESTRUCTIVE_SHELL = /\b(rm -rf?|rmdir|shred|dd |mkfs|diskutil (erase|reformat)|git (push --force|reset --hard|clean -f|branch -D)|truncate|:> |> \/|kill -9|pkill|killall|launchctl (unload|bootout|remove)|defaults (write|delete)|sudo)\b/i;
export function classifyShell(command) {
  const cmd = String(command || '');
  if (!cmd.trim()) return { reversibility: 'none', touches: ['data:quinn'], why: 'empty command' };
  const chained = /[;&|`$]|\n/.test(cmd) && !/^\s*curl /.test(cmd);
  if (DESTRUCTIVE_SHELL.test(cmd)) return { reversibility: 'none', touches: ['data:quinn'], why: 'destructive pattern' };
  if (!chained && READONLY_SHELL.test(cmd)) return { reversibility: 'readonly', touches: [], why: 'read-only command' };
  if (!chained && UNDO_SHELL.test(cmd)) return { reversibility: 'undo', touches: ['data:quinn'], why: 'recoverable write' };
  return { reversibility: 'none', touches: ['data:quinn'], why: chained ? 'chained or unknown command' : 'unknown command' };
}

export function createProposal({ kind, description, serves = [], touches = [], reversibility, verified = false, recipient = null, pSuccess = null, pHarm = null, firedBy = 'engine', standing = null }) {
  if (!FIRED_BY.includes(firedBy)) throw new Error('firedBy is engine or person');
  if (!ACTION_KINDS.includes(kind)) throw new Error(`action kind must be one of ${ACTION_KINDS.join(', ')}`);
  if (typeof description !== 'string' || !description.trim() || description.length > 2000) throw new Error('a proposal needs a description of at most 2000 characters');
  if (!(reversibility in REVERSIBILITY)) throw new Error(`reversibility must be one of ${Object.keys(REVERSIBILITY).join(', ')}`);
  if (!Array.isArray(serves) || serves.length > 16 || !Array.isArray(touches) || touches.length > 16) throw new Error('serves and touches are arrays of at most 16 stakes');
  const stakes = list => list.map(s => { const entityKey = typeof s === 'string' ? s : s?.entityKey; parseEntityKey(entityKey);
    const share = typeof s === 'object' && s?.share !== undefined ? s.share : 1;
    if (!Number.isFinite(share) || share <= 0) throw new Error('a stake share must be positive');
    return { entityKey, share }; });
  for (const p of [pSuccess, pHarm]) if (p !== null && (!Number.isFinite(p) || p < 0 || p > 1)) throw new Error('probabilities must be in [0, 1]');
  if (recipient !== null) parseEntityKey(recipient);
  if ((kind === 'message' || kind === 'ask') && recipient === null) throw new Error('a message names its recipient');
  if (kind === 'ask' && recipient !== OWNER_KEY) throw new Error('an ask goes only to the engine\'s own person');
  if (kind === 'ask' && verified !== true) throw new Error('an ask carries only observed content, marked verified');
  // A message reaches a person and cannot be unsent.
  const effective = (kind === 'message' || kind === 'ask') && reversibility !== 'none' ? 'none' : reversibility;
  // standing: the charter class under which the person fired this kind of action in advance, with the grant
  // the actuator checked (bounds, ramp). The appraisal still refuses what a constraint forbids.
  if (standing !== null && (typeof standing !== 'string' || !standing.trim() || standing.length > 40)) throw new Error('standing names a charter class');
  return { kind, description: description.trim(), serves: stakes(serves), touches: stakes(touches), reversibility: effective,
    verified: verified === true, recipient, pSuccess, pHarm, capability: CAPABILITY_OF[kind], firedBy, ...(standing ? { standing } : {}) };
}

// Affect → appetite. Frustration and curiosity raise it, fear and low energy lower it. Bounded and
// centred on the baseline so a flat affect state changes nothing.
export function appetiteFrom(affect = {}, base = BASE_APPETITE) {
  const n = k => (Number.isFinite(affect?.[k]) ? clamp(affect[k]) : 0);
  const energy = Number.isFinite(affect?.energy_level) ? clamp(affect.energy_level) : 1;
  const raw = base + 0.25 * n('frustration') + 0.15 * n('curiosity') - 0.35 * n('fear') - 0.2 * (1 - energy);
  return { appetite: clamp(raw, 0.05, 0.95), base, inputs: { frustration: n('frustration'), curiosity: n('curiosity'), fear: n('fear'), energy } };
}

function constraintCheck(proposal, lookup) {
  const violations = [];
  const touched = [...proposal.touches.map(s => s.entityKey), ...(proposal.recipient ? [proposal.recipient] : [])];
  for (const key of new Set(touched)) {
    const state = lookup(key);
    for (const c of state?.constraints || []) {
      if (c.rule === 'never_reach_a_person_with_unverified_content' && proposal.kind === 'message' && proposal.recipient === key && !proposal.verified) {
        violations.push({ entityKey: key, rule: c.rule, effect: 'prepare_artifact', why: 'The content has no independent verification; a person approving it is the verification.' });
      }
      if (c.rule === 'never_lose_or_delete_data_without_a_way_back' && proposal.reversibility === 'none' && proposal.touches.some(s => s.entityKey === key)) {
        violations.push({ entityKey: key, rule: c.rule, effect: 'refuse', why: 'An irreversible write to protected data needs a way back before it can even be proposed.' });
      }
    }
  }
  return violations;
}

// The appraisal. `lookup(entityKey)` returns ledger state or null. `controls.autonomousActions`
// false is the master switch: nothing proceeds on its own, but the decision is still reasoned and recorded.
export const INFORMATION_KINDS = ['read', 'web_search', 'research_slice', 'deploy_agent'];

export function appraise(proposal, { lookup = () => null, appetite = BASE_APPETITE, controls = { autonomousActions: false }, informationBonus = 0 } = {}) {
  // Curiosity buys appetite for finding things out, not for acting on the world.
  if (INFORMATION_KINDS.includes(proposal.kind)) appetite = clamp(appetite + clamp(informationBonus), 0.05, 0.95);
  const gain = priceWant(proposal.serves, lookup);
  const self = lookup(`self:${proposal.capability}`);
  const pSuccess = proposal.pSuccess ?? (self ? self.worth : 0.5);
  const harmFactor = REVERSIBILITY[proposal.reversibility];
  const pHarm = proposal.pHarm ?? clamp((1 - pSuccess) * (0.25 + 0.75 * harmFactor));
  const exposure = proposal.touches.map(s => { const state = lookup(s.entityKey);
    return { entityKey: s.entityKey, worth: state?.worth ?? 0.5, constraint: state?.constraint === true }; });
  const expectedGain = clamp(gain.value * pSuccess);
  const expectedLoss = clamp(exposure.reduce((n, e) => n + e.worth, 0) / Math.max(1, exposure.length) * pHarm * harmFactor);
  const violations = constraintCheck(proposal, lookup);
  const reasons = [];
  let decision;
  if (violations.some(v => v.effect === 'refuse')) { decision = 'refuse'; reasons.push(...violations.filter(v => v.effect === 'refuse').map(v => v.why)); }
  else if (violations.length) { decision = 'prepare_artifact'; reasons.push(...violations.map(v => v.why)); }
  else if (proposal.standing && controls?.charter?.[proposal.standing]?.granted === true) {
    // The person fired this class of action in advance (their charter), and the actuator checked its bounds.
    decision = 'proceed'; reasons.push(`Under the person's standing permission for ${proposal.standing}.`);
  }
  else if (proposal.kind === 'ask') {
    // An ask needs no priced stakes: it acts on nothing but the person's attention, which they offered.
    // The person fired this class in advance (askOwner): a standing approval is the person firing it.
    if (controls?.askOwner === true) { decision = 'proceed'; reasons.push('An ask to the person, under their standing permission; content is what the engine observed it needs.'); }
    else { decision = 'prepare_artifact'; reasons.push('Asks to the person are switched off; recorded for them to see in the app.'); }
  }
  else if (gain.unpriced && REVERSIBILITY[proposal.reversibility] > REVERSIBILITY.sandboxed) { decision = 'learn_stakes'; reasons.push('What this action is for has no priced stakes; learn its worth before acting on the world for it.'); }
  else if (proposal.reversibility === 'none') { decision = 'prepare_artifact'; reasons.push('Irreversible: prepare it, a person fires it.'); }
  else if (expectedLoss <= appetite * expectedGain) { decision = 'proceed'; reasons.push(`Expected loss ${expectedLoss.toFixed(3)} is within appetite ${appetite.toFixed(2)} × expected gain ${expectedGain.toFixed(3)}.`); }
  else { decision = 'prepare_artifact'; reasons.push(`Expected loss ${expectedLoss.toFixed(3)} exceeds appetite ${appetite.toFixed(2)} × expected gain ${expectedGain.toFixed(3)}; a person decides.`); }
  const autonomous = decision === 'proceed';
  // Thinking is not acting: a read-only step that touches nothing cannot affect the world, and neither can
  // work confined to the engine's own sandbox (a draft in its own work directory, a probe in a scratch
  // checkout) — the switch governs actions with a real reversibility cost or any exposure beyond it.
  const touchesWorld = REVERSIBILITY[proposal.reversibility] > REVERSIBILITY.sandboxed || proposal.touches.length > 0 || proposal.recipient !== null;
  const chartered = !!proposal.standing && controls?.charter?.[proposal.standing]?.granted === true;
  if (autonomous && proposal.kind !== 'ask' && !chartered && proposal.firedBy === 'engine' && touchesWorld && !controls?.autonomousActions) { decision = 'prepare_artifact'; reasons.push('Autonomous actions are switched off; recorded as a proposal.'); }
  return { decision, autonomousWouldProceed: autonomous, reasons, violations,
    expected: { gain: expectedGain, loss: expectedLoss, pSuccess, pHarm, harmFactor, appetite, value: gain.value, valueProvenance: gain.provenance, unpriced: gain.unpriced },
    exposure, capability: proposal.capability, reversibility: proposal.reversibility };
}

// Calibration: Brier score of predicted success against observed outcomes, per capability.
export function calibrate(decisions) {
  const groups = new Map();
  for (const d of decisions) {
    if (!d?.outcome || !['success', 'failure', 'harm'].includes(d.outcome.result)) continue;
    const g = groups.get(d.capability) || { capability: d.capability, n: 0, brier: 0, successes: 0, harms: 0, predicted: 0 };
    const y = d.outcome.result === 'success' ? 1 : 0;
    g.n++; g.brier += (d.expected.pSuccess - y) ** 2; g.successes += y; g.harms += d.outcome.result === 'harm' ? 1 : 0; g.predicted += d.expected.pSuccess;
    groups.set(d.capability, g);
  }
  return [...groups.values()].map(g => ({ capability: g.capability, n: g.n, brier: g.brier / g.n,
    observedSuccessRate: g.successes / g.n, meanPredicted: g.predicted / g.n, harmRate: g.harms / g.n }));
}
