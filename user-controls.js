// Controls apply to the deliberate queue, not perception or OS permissions.
// `inference` is which brain the engine thinks with: local (WORK's model, never spends Codex), auto
// (local first, Codex for hard steps and while local is unreachable), cloud (Codex for everything).
export const INFERENCE_MODES = ['local', 'auto', 'cloud'];
// The charter: what the person has fired in advance, by class of action. A granted class acts without asking
// (after `ramp` one-tap approvals of that class); an ungranted class asks for each action. `spend` is bounded
// by a monthly cap; `publish` and `submit` act on the person's own accounts only.
export const CHARTER_CLASSES = ['sign_in', 'publish', 'submit', 'upload', 'spend', 'message', 'destroy'];
export const DEFAULT_CHARTER = {
  sign_in: { granted: true }, publish: { granted: true }, submit: { granted: true }, upload: { granted: true },
  spend: { granted: true, monthlyCap: 500 }, message: { granted: false }, destroy: { granted: false }, ramp: 1,
};
export function normalizeCharter(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('charter is an object of classes');
  const out = { ...DEFAULT_CHARTER };
  for (const [k, v] of Object.entries(value)) {
    if (k === 'ramp') { if (!Number.isInteger(v) || v < 0 || v > 20) throw new Error('charter.ramp is a whole number from 0 to 20'); out.ramp = v; continue; }
    if (!CHARTER_CLASSES.includes(k)) throw new Error(`charter class must be one of ${CHARTER_CLASSES.join(', ')}`);
    if (!v || typeof v !== 'object' || typeof v.granted !== 'boolean') throw new Error(`charter.${k} needs granted: true|false`);
    const c = { granted: v.granted };
    if (k === 'spend') { const cap = v.monthlyCap ?? DEFAULT_CHARTER.spend.monthlyCap; if (!Number.isFinite(cap) || cap < 0 || cap > 100000) throw new Error('charter.spend.monthlyCap is dollars from 0 to 100000'); c.monthlyCap = cap; }
    out[k] = c;
  }
  return out;
}
export function createUserControls(pool) {
  async function get() {
    const { rows } = await pool.query('SELECT settings, updated_at FROM oca_user_controls WHERE id = true');
    if (!rows[0]) throw new Error('User controls unavailable; apply migration 054');
    // askOwner: the engine may message its own person with what it observed it needs. On unless turned off.
    const s = rows[0].settings || {};
    return { askOwner: true, agentSlots: 4, ...s, charter: normalizeCharter(s.charter || {}), updatedAt: rows[0].updated_at };
  }
  async function update(patch) {
    if (!patch || Array.isArray(patch) || typeof patch !== 'object' || !Object.keys(patch).length) throw new Error('Choose a control to update');
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'inference') { if (!INFERENCE_MODES.includes(value)) throw new Error(`inference must be one of ${INFERENCE_MODES.join(', ')}`); continue; }
      // agentSlots: how many deployed agents may be live at once — the person's bound on fan-out.
      if (key === 'agentSlots') { if (!Number.isInteger(value) || value < 0 || value > 32) throw new Error('agentSlots is a whole number from 0 to 32'); continue; }
      if (key === 'charter') { patch.charter = normalizeCharter({ ...((await get()).charter), ...value }); continue; }
      if (!['queuePaused', 'interestDiscovery', 'selfBuild', 'selfBuildAutoMerge', 'askOwner'].includes(key) || typeof value !== 'boolean') throw new Error('Unknown control or invalid value');
    }
    await pool.query('UPDATE oca_user_controls SET settings = settings || $1::jsonb, updated_at = now() WHERE id = true', [JSON.stringify(patch)]);
    return get();
  }
  return { get, update };
}

export function createControlledPonderRunner({ controls, syncInterests, refreshHunger, runNext }) {
  let inFlight = null;
  return function run(id = null) {
    if (inFlight) return Promise.resolve({ busy: true });
    inFlight = controls.get().then(async settings => {
      if (settings.queuePaused) return { paused: true };
      if (settings.interestDiscovery) await syncInterests();
      await refreshHunger();
      if ((await controls.get()).queuePaused) return { paused: true };
      return runNext(id);
    }).then(async result => { await refreshHunger(); return result; }).finally(() => { inFlight = null; });
    return inFlight;
  };
}
