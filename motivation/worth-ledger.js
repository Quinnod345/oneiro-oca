// Durable worth: an immutable signal journal projected into per-entity state.
// Same shape as the interest engine — idempotent inserts, projection from the journal,
// shared advisory lock — so two daemon instances cannot count a signal twice.
import { isDeepStrictEqual } from 'node:util';
import { createSignal, projectWorth, priceWant, seedSignals, parseEntityKey } from './worth.js';

const rowState = row => ({ ...row.state, updatedAt: row.updated_at });

export function createWorthLedger({ pool, clock = Date.now, emit = null }) {
  async function reproject(client, key, now) {
    const { rows } = await client.query('SELECT payload FROM worth_signals WHERE entity_key = $1 ORDER BY created_at, id', [key]);
    const state = projectWorth(key, rows.map(r => r.payload), now);
    await client.query(`INSERT INTO worth_entities (key, state, updated_at) VALUES ($1, $2::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`, [key, JSON.stringify(state)]);
    return state;
  }

  // Records one grounded signal. A replayed id is a no-op; the same id naming a different
  // signal is an error, never a silent overwrite.
  async function record(input) {
    const signal = createSignal({ at: clock(), ...input });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()), hashtext('oca-worth-ledger-v1'))");
      const { rows: existing } = await client.query('SELECT payload FROM worth_signals WHERE id = $1', [signal.id]);
      if (existing[0]) {
        // JSONB reorders keys, so compare structurally; time of recording is not part of identity.
        const { at: _a, ...saved } = existing[0].payload, { at: _b, ...fresh } = signal;
        if (!isDeepStrictEqual(saved, fresh)) throw new Error('signal id already names a different signal');
        const state = await reproject(client, signal.entityKey, clock());
        await client.query('COMMIT');
        return { signal: existing[0].payload, state, duplicate: true };
      }
      await client.query('INSERT INTO worth_signals (id, entity_key, kind, payload) VALUES ($1, $2, $3, $4::jsonb)',
        [signal.id, signal.entityKey, signal.kind, JSON.stringify(signal)]);
      const state = await reproject(client, signal.entityKey, clock());
      await client.query('COMMIT');
      if (emit) await emit('worth_update', 'worth', { signal, state }).catch(() => {});
      return { signal, state, duplicate: false };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async function seed() {
    let inserted = 0;
    for (const signal of seedSignals(clock())) {
      const { seededAt: _s, ...s } = signal;
      const result = await record(s);
      if (!result.duplicate) inserted++;
    }
    return { inserted, total: seedSignals().length };
  }

  async function get(key) {
    parseEntityKey(key);
    const { rows } = await pool.query('SELECT state, updated_at FROM worth_entities WHERE key = $1', [key]);
    return rows[0] ? rowState(rows[0]) : null;
  }

  async function list({ kind = null } = {}) {
    const { rows } = await pool.query(`SELECT state, updated_at FROM worth_entities
      ${kind ? "WHERE state->>'kind' = $1" : ''} ORDER BY (state->>'constraint')::boolean DESC, (state->>'worth')::float8 DESC, key`, kind ? [kind] : []);
    return { entities: rows.map(rowState),
      policy: { source: 'immutable_signal_journal', weighs: 'ratings_and_observed_outcomes_only',
        rejects: 'generated_text_model_confidence_activity_counts', constraints: 'never_weighed' } };
  }

  async function price(stakes) {
    const keys = [...new Set((stakes || []).map(s => s?.entityKey).filter(Boolean))];
    const { rows } = keys.length ? await pool.query('SELECT key, state FROM worth_entities WHERE key = ANY($1)', [keys]) : { rows: [] };
    const byKey = new Map(rows.map(r => [r.key, r.state]));
    return priceWant(stakes, key => byKey.get(key) || null);
  }

  // Re-projection makes time decay visible without a new signal.
  async function refresh() {
    const { rows } = await pool.query('SELECT DISTINCT entity_key FROM worth_signals');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()), hashtext('oca-worth-ledger-v1'))");
      for (const { entity_key } of rows) await reproject(client, entity_key, clock());
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    return { refreshed: rows.length };
  }

  return { record, seed, get, list, price, refresh };
}
