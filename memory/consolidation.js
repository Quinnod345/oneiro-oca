// Review episodes into source-linked proposals. Generation alone cannot teach a fact,
// form a skill, verify causality, contradict a belief, or reward competence.
import { pool } from '../event-bus.js';
import llm from '../llm.js';
import { createEvidenceConsolidator } from './consolidation-candidates.js';

export const consolidate = createEvidenceConsolidator({ pool, generate: async ({ system, evidence }) => {
  const response = await llm.messages.create({
    model: 'claude-sonnet-4-6', system,
    messages: [{ role: 'user', content: JSON.stringify({ episodes: evidence }) }],
    temperature: 0.2, max_tokens: 2048,
  });
  if (response.stop_reason === 'max_tokens') throw new Error('Consolidation output was truncated');
  return response.content?.[0]?.text || '';
} });

export async function history(limit = 10) {
  const { rows } = await pool.query('SELECT * FROM consolidation_log ORDER BY started_at DESC LIMIT $1', [limit]);
  return rows;
}
export default { consolidate, history };
