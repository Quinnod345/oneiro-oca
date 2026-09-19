// Controls apply to the deliberate queue, not perception or OS permissions.
// `inference` is which brain the engine thinks with: local (WORK's model, never spends Codex), auto
// (local first, Codex for hard steps and while local is unreachable), cloud (Codex for everything).
export const INFERENCE_MODES = ['local', 'auto', 'cloud'];
export function createUserControls(pool) {
  async function get() {
    const { rows } = await pool.query('SELECT settings, updated_at FROM oca_user_controls WHERE id = true');
    if (!rows[0]) throw new Error('User controls unavailable; apply migration 054');
    // askOwner: the engine may message its own person with what it observed it needs. On unless turned off.
    return { askOwner: true, ...rows[0].settings, updatedAt: rows[0].updated_at };
  }
  async function update(patch) {
    if (!patch || Array.isArray(patch) || typeof patch !== 'object' || !Object.keys(patch).length) throw new Error('Choose a control to update');
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'inference') { if (!INFERENCE_MODES.includes(value)) throw new Error(`inference must be one of ${INFERENCE_MODES.join(', ')}`); continue; }
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
