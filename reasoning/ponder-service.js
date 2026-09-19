import emotion from '../emotion/engine.js';
import { pool, emit } from '../event-bus.js';
import { reason } from './controller.js';
import { createPonderQueue } from './ponder-queue.js';
import { createInterestEngine } from '../motivation/interest-engine.js';
import { createWorthLedger } from '../motivation/worth-ledger.js';
import { createRiskJournal } from '../motivation/risk-journal.js';
import { createUserControls, createControlledPonderRunner } from '../user-controls.js';
import llm, { setInferencePolicy, getInferencePolicy } from '../llm.js';
import hypothesis from '../hypothesis/engine.js';
import { simulate, evaluateSimulation } from '../simulation/engine.js';
import { on } from '../event-bus.js';
import { createSelfBuild } from './self-build.js';
import { runCodex, codexAvailable } from '../codex-cli.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export const userControls = createUserControls(pool);
// Same journal the orchestrator seeds; wants are priced from it and receipts feed it.
export const worthLedger = createWorthLedger({ pool, emit });
// Strategies think locally by default (WORK's Ollama over Tailscale); the pursuit reasoner may use the
// Codex subscription for hard steps. Artifacts land in the engine's own work directory, never in Quinn's data.
const WORK_ROOT = process.env.OCA_PURSUIT_WORK_ROOT || '/Users/quinnodonnell/oneiro/runtime/workspace/pursuit-work';
async function writeArtifact(chainId, { title, body, forWhat, judge, attempt }) {
  const dir = join(WORK_ROOT, String(chainId), 'artifacts');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `strategy-${attempt}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'artifact'}.md`);
  await writeFile(path, `# ${title}

_For:_ ${forWhat}

_Judge by:_ ${judge}

${body}
`, { mode: 0o600 });
  return { path };
}
const strategyDeps = { llm, hypothesis, simulate, evaluateSimulation, writeArtifact,
  provider: process.env.OCA_STRATEGY_PROVIDER || 'local', model: process.env.OCA_STRATEGY_MODEL || process.env.ONEIRO_OCA_THINKER_MODEL || 'qwen-agent',
  // A step that may run on Codex gets at least four minutes; a local-only engine keeps the want's budget.
  callFloorSeconds: () => (getInferencePolicy().mode === 'local' ? 0 : 240) };
// The self-build phase: the engine's wants about itself. Codex when available, the local model otherwise.
const selfBuildRef = { current: null };
strategyDeps.selfBuild = { build: ctx => selfBuildRef.current.build(ctx), isActive: () => selfBuildRef.current?.isActive() === true, permitted: () => selfBuildRef.current.permitted() };
// The risk journal is created below; the queue receives it through this indirection.
const riskRef = { current: null };
// The pursuit reasoner is the hard step: it asks for Codex unless the person set local-only. Fallbacks
// (Codex out → local, local down → Codex under auto) and their rest periods live in llm.js.
export function draftProvider() {
  if (getInferencePolicy().mode === 'local') return { provider: strategyDeps.provider, model: strategyDeps.model };
  return { provider: 'codex', model: process.env.OCA_PURSUIT_MODEL || getInferencePolicy().cloudModel };
}
async function pursuitReason(goal, options) { return reason(goal, { ...options, ...draftProvider() }); }
export { strategyDeps };
// The inference mode is a control, so it survives restarts and a change in the app takes effect at once.
export async function syncInferencePolicy() {
  try { const c = await userControls.get(); if (c.inference) setInferencePolicy({ mode: c.inference }); } catch {}
}
export const ponderQueue = createPonderQueue({ pool, worth: worthLedger, affect: emotion, strategies: strategyDeps,
  risk: { decide: (...a) => riskRef.current.decide(...a), observe: (...a) => riskRef.current.observe(...a), trackRecord: (...a) => riskRef.current.trackRecord(...a) },
  reason: pursuitReason });
// Risk: every proposed action is appraised against worth, journaled, and calibrated on what happened.
// Appetite reads the live affect state; the master switch is the existing autonomous-actions flag.
const envFlag = name => ['1', 'true', 'yes', 'on'].includes(String(process.env[name] || '').trim().toLowerCase());
export const riskJournal = createRiskJournal({ pool, worth: worthLedger, feel: emotion,
  controls: () => ({ autonomousActions: envFlag('OCA_ENABLE_AUTONOMOUS_ACTIONS') || envFlag('ONEIRO_ENABLE_AUTONOMOUS_ACTIONS') }),
  affect: () => { try { return emotion.getState(); } catch { return {}; } } });
riskRef.current = riskJournal;
export const selfBuild = createSelfBuild({ pool, queue: ponderQueue, worth: worthLedger, risk: riskJournal, controls: userControls,
  runner: codexAvailable() ? runCodex : null, llm, provider: strategyDeps.provider, model: strategyDeps.model, inferenceMode: () => getInferencePolicy().mode });
selfBuildRef.current = selfBuild;

// A prediction the engine committed to for a want, settled by the world, becomes evidence on that want.
on('hypothesis_tested', async ev => {
  try {
    const settled = await ponderQueue.settlePrediction(ev?.payload || ev || {});
    if (settled?.added) console.log(`[oca] prediction #${(ev?.payload || ev).id} settled ${settled.confirmed ? 'held' : 'failed'} → evidence on want #${settled.chain_id}`);
  } catch (e) { console.warn('[oca] prediction settlement:', e.message); }
});

// Legacy wants are priced once, on first use, so nothing the loop selects is unpriced by accident.
let adoption = null;
export const adoptLegacyWants = () => adoption ||= ponderQueue.adoptLegacyWants().then(r => { if (r.adopted || r.reopened) console.log(`[oca] adopted ${r.adopted} legacy want(s) into the worth ledger; reopened ${r.reopened} stalled for strategy rotation`); return r; })
  .catch(e => { console.warn('[oca] legacy want adoption:', e.message); adoption = null; return { adopted: 0, error: e.message }; });

// Tonic affect is a projection of the journals. Refreshed with hunger, at most once a minute.
let lastGroundingAt = 0, groundingState = null;
export const groundingStatus = () => groundingState;
export async function refreshGrounding() {
  if (Date.now() - lastGroundingAt < 60000) return groundingState;
  lastGroundingAt = Date.now();
  try {
    const [{ entities: self }, risk, hunger, person] = await Promise.all([
      worthLedger.list({ kind: 'self' }), riskJournal.status(), ponderQueue.hunger(),
      pool.query("SELECT max(created_at) AS at FROM worth_signals WHERE kind = 'rated' OR (kind = 'observed' AND payload->>'about' LIKE 'chain %')")]);
    const total = Object.values(risk.decisions || {}).reduce((a, b) => a + b, 0);
    const wants = hunger.wants || [];
    const at = person.rows[0]?.at ? new Date(person.rows[0].at).getTime() : null;
    groundingState = emotion.ground({
      selfWorth: self.map(e => ({ worth: e.worth, confidence: e.confidence })),
      calibration: risk.calibration,
      decisions: { proceed: risk.decisions?.proceed || 0, total },
      hunger: { pressure: hunger.pressure, unpricedShare: wants.length ? wants.filter(w => w.hunger?.unpriced).length / wants.length : 0,
        awaitingEvidenceShare: wants.length ? wants.filter(w => w.status === 'awaiting_evidence').length / wants.length : 0 },
      hoursSincePersonSignal: at ? (Date.now() - at) / 3600000 : null });
  } catch (e) { console.warn('[oca] affect grounding:', e.message); }
  return groundingState;
}
export const interestEngine = createInterestEngine({ pool, queue: ponderQueue });
let lastInterestSync = 0;
let interestState = { lastSyncAt: null, error: null, result: null };
export const interestStatus = () => ({ ...interestState });
async function syncInterests() {
  if (Date.now() - lastInterestSync < 60000) return;
  lastInterestSync = Date.now();
  try {
    const result = await interestEngine.sync();
    interestState = { lastSyncAt: Date.now(), error: null, result };
    if (result.originated) console.log('[oca] self-originated inquiry:', result.originated.chain_id, 'from want', result.originated.parentChainId);
  } catch (e) {
    interestState = { ...interestState, error: e.message };
    console.error('[oca] interest learning:', e.message);
  }
}
export async function refreshHunger() {
  await syncInferencePolicy();
  await adoptLegacyWants();
  await selfBuild.tick().catch(e => console.warn('[self-build] tick:', e.message));
  await refreshGrounding();
  const state = await ponderQueue.hunger();
  const selected = state.wants.find(w => w.chain_id === state.selected);
  emotion.setMotivationalState({ ...selected?.hunger, pressure: state.pressure, selected: state.selected });
  return state;
}
export const runPendingPonder = createControlledPonderRunner({ controls: userControls,
  syncInterests, refreshHunger, runNext: id => ponderQueue.runNext(id) });
