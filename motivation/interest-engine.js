// Transactional experience -> interest -> self-originated inquiry adapter.
// Reads current ponder records only. It never mines old dreams or executes proposed actions.
import { interestEvents, interestKey, projectInterest, proposeInquiry } from './interests.js';
const DAY = 86400000;
const chainFrom = row => ({ chain_id: row.id, seed: row.seed, status: row.status, ...row.ponder_state });

export function createInterestEngine({ pool, queue, clock = Date.now }) {
  async function list() {
    const { rows } = await pool.query(`SELECT i.state,
      (SELECT COUNT(*)::int FROM interest_pursuits p JOIN thought_chains c ON c.id = p.chain_id
        WHERE p.interest_key = i.key AND c.ponder_state #>> '{want,status}' = 'active') AS active_inquiries
      FROM motivational_interests i ORDER BY (i.state->>'curiosity')::float8 DESC, i.key`);
    return { interests: rows.map(r => ({ ...r.state, activeInquiries: r.active_inquiries })),
      policy: { maxPerDay: 3, maxPerParent: 3, maxActivePerInterest: 1, cooldownHours: 6,
        execution: 'review_only', learning: 'observed_outcomes_not_generated_text' } };
  }

  async function sync({ originate = true } = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Shared across daemon instances, held only during local DB work (never inference).
      const { rows: [lock] } = await client.query("SELECT pg_try_advisory_xact_lock(hashtext(current_schema()), hashtext('oca-interest-engine-v1')) AS held");
      if (!lock.held) { await client.query('ROLLBACK'); return { busy: true }; }
      const { rows } = await client.query('SELECT id, seed, status, ponder_state FROM thought_chains WHERE ponder_state IS NOT NULL ORDER BY id');
      const chains = rows.map(chainFrom), changedKeys = new Set();
      let ingested = 0;
      for (const chain of chains) {
        for (const event of interestEvents(chain)) {
          const inserted = await client.query(`INSERT INTO interest_experiences (id, interest_key, parent_chain_id, payload)
            VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (id) DO NOTHING`,
          [event.id, event.interestKey, event.parentId, JSON.stringify(event)]);
          if (inserted.rowCount) { ingested++; changedKeys.add(event.interestKey); }
        }
      }
      for (const key of changedKeys) {
        const { rows: journal } = await client.query('SELECT payload FROM interest_experiences WHERE interest_key = $1 ORDER BY created_at, id', [key]);
        const state = projectInterest(journal.map(r => r.payload));
        await client.query(`INSERT INTO motivational_interests (key, state) VALUES ($1,$2::jsonb)
          ON CONFLICT (key) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`, [key, JSON.stringify(state)]);
      }
      let originated = null, suppression = null;
      if (originate) {
        const { rows: interests } = await client.query('SELECT key, state FROM motivational_interests');
        const index = new Map(interests.map(r => [r.key, r.state]));
        const candidates = chains.map(c => proposeInquiry(c, index.get(interestKey(c.topic || c.seed))))
          .filter(Boolean).sort((a, b) => b.priority - a.priority || a.parentId - b.parentId);
        const { rows: pursuits } = await client.query(`SELECT p.*, c.ponder_state #>> '{want,status}' AS want_status
          FROM interest_pursuits p JOIN thought_chains c ON c.id = p.chain_id`);
        const since = clock() - DAY;
        if (chains.some(c => c.origin?.kind !== 'interest' && ['pondering', 'running'].includes(c.status))) suppression = 'explicit_work_first';
        else if (pursuits.filter(p => new Date(p.created_at).getTime() > since).length >= 3) suppression = 'daily_budget';
        else for (const candidate of candidates) {
          const history = pursuits.filter(p => p.interest_key === candidate.interestKey);
          if (pursuits.some(p => p.fingerprint === candidate.fingerprint)) { suppression = 'unchanged_evidence'; continue; }
          if (pursuits.filter(p => p.parent_chain_id === candidate.parentId).length >= 3) { suppression = 'parent_budget'; continue; }
          if (history.some(p => p.want_status === 'active')) { suppression = 'inquiry_already_active'; continue; }
          if (history.some(p => new Date(p.created_at).getTime() > clock() - 6 * 3600000)) { suppression = 'interest_cooldown'; continue; }
          // Lock the parent while creating the child so cancellation cannot leave an orphan.
          const { rows: [parent] } = await client.query('SELECT id, seed, status, ponder_state FROM thought_chains WHERE id = $1 FOR UPDATE', [candidate.parentId]);
          const current = parent && proposeInquiry(chainFrom(parent), index.get(candidate.interestKey));
          if (!current || current.fingerprint !== candidate.fingerprint) { suppression = 'parent_changed'; continue; }
          const origin = { kind: 'interest', interestKey: candidate.interestKey,
            parentChainId: candidate.parentId, fingerprint: candidate.fingerprint, question: current.question, why: candidate.why };
          const child = await queue.enqueue({ ...current, topic: parent.ponder_state.topic || parent.seed.slice(0, 160) }, { client, origin });
          await client.query(`INSERT INTO interest_pursuits (fingerprint, interest_key, parent_chain_id, chain_id, created_at)
            VALUES ($1,$2,$3,$4,$5)`, [candidate.fingerprint, candidate.interestKey, candidate.parentId, child.chain_id, new Date(clock())]);
          originated = { chain_id: child.chain_id, ...origin }; suppression = null; break;
        }
      }
      await client.query('COMMIT');
      return { ingested, originated, suppression };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }
  return { list, sync };
}
