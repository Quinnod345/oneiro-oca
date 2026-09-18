import emotion from '../emotion/engine.js';
import { pool, emit } from '../event-bus.js';
import { reason } from './controller.js';
import { createPonderQueue } from './ponder-queue.js';
import { createInterestEngine } from '../motivation/interest-engine.js';
import { createWorthLedger } from '../motivation/worth-ledger.js';
import { createRiskJournal } from '../motivation/risk-journal.js';
import { createUserControls, createControlledPonderRunner } from '../user-controls.js';
export const userControls = createUserControls(pool);
// Same journal the orchestrator seeds; wants are priced from it and receipts feed it.
export const worthLedger = createWorthLedger({ pool, emit });
export const ponderQueue = createPonderQueue({ pool, worth: worthLedger, reason: (goal, options) => reason(goal, { ...options,
  provider: 'codex', model: process.env.OCA_PURSUIT_MODEL || 'gpt-6-astra' }) });
// Risk: every proposed action is appraised against worth, journaled, and calibrated on what happened.
// Appetite reads the live affect state; the master switch is the existing autonomous-actions flag.
const envFlag = name => ['1', 'true', 'yes', 'on'].includes(String(process.env[name] || '').trim().toLowerCase());
export const riskJournal = createRiskJournal({ pool, worth: worthLedger,
  controls: () => ({ autonomousActions: envFlag('OCA_ENABLE_AUTONOMOUS_ACTIONS') || envFlag('ONEIRO_ENABLE_AUTONOMOUS_ACTIONS') }),
  affect: () => { try { return emotion.getState(); } catch { return {}; } } });
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
  const state = await ponderQueue.hunger();
  const selected = state.wants.find(w => w.chain_id === state.selected);
  emotion.setMotivationalState({ ...selected?.hunger, pressure: state.pressure, selected: state.selected });
  return state;
}
export const runPendingPonder = createControlledPonderRunner({ controls: userControls,
  syncInterests, refreshHunger, runNext: id => ponderQueue.runNext(id) });
