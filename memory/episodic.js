// OCA Episodic Memory — raw experiences
import { pool, emit } from '../event-bus.js';
import OpenAI from 'openai';
import { readFileSync } from 'fs';

const apiKey = process.env.OPENAI_API_KEY || (() => {
  try {
    const envFile = readFileSync('/Users/quinnodonnell/.openclaw/workspace/oneiro-core/.env', 'utf-8');
    return envFile.match(/OPENAI_API_KEY="?([^"\n]+)"?/)?.[1];
  } catch { return undefined; }
})();
const openai = new OpenAI({ apiKey });

async function getEmbedding(text) {
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000)
  });
  return resp.data[0].embedding;
}

// Store a new episodic memory
export async function store({
  eventType,
  content,
  activeApp = null,
  activeWindow = null,
  userPresence = 'unknown',
  userActivity = null,
  visualHash = null,
  audioState = {},
  hidMetrics = {},
  interoceptive = {},
  participants = [],
  emotionalState = {},
  emotionalValence = 0,
  emotionalArousal = 0,
  prediction = null,
  actualOutcome = null,
  surpriseMagnitude = 0,
  importanceScore = 0.5
} = {}) {
  const embedding = await getEmbedding(content);
  
  const { rows } = await pool.query(
    `INSERT INTO episodic_memory 
     (event_type, content, active_app, active_window, user_presence, user_activity,
      visual_hash, audio_state, hid_metrics, interoceptive,
      participants, emotional_state, emotional_valence, emotional_arousal,
      prediction, actual_outcome, surprise_magnitude, importance_score, embedding)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::vector)
     RETURNING id, timestamp`,
    [eventType, content, activeApp, activeWindow, userPresence, userActivity,
     visualHash, JSON.stringify(audioState), JSON.stringify(hidMetrics), JSON.stringify(interoceptive),
     participants, JSON.stringify(emotionalState), emotionalValence, emotionalArousal,
     prediction, actualOutcome, surpriseMagnitude, importanceScore, JSON.stringify(embedding)]
  );
  
  await emit('memory_store', 'episodic_memory', {
    id: rows[0].id, eventType, content: content.slice(0, 200), importanceScore
  });
  
  return rows[0];
}

// Recall memories by similarity
export async function recall(query, { limit = 5, minImportance = 0, eventType = null, since = null } = {}) {
  const embedding = await getEmbedding(query);
  
  let whereClause = 'WHERE importance_score >= $2';
  const params = [JSON.stringify(embedding), minImportance];
  let paramIdx = 3;
  
  if (eventType) {
    whereClause += ` AND event_type = $${paramIdx}`;
    params.push(eventType);
    paramIdx++;
  }
  if (since) {
    whereClause += ` AND timestamp > $${paramIdx}`;
    params.push(since);
    paramIdx++;
  }
  
  const { rows } = await pool.query(
    `SELECT *, 1 - (embedding <=> $1::vector) as similarity
     FROM episodic_memory 
     ${whereClause}
     ORDER BY embedding <=> $1::vector
     LIMIT $${paramIdx}`,
    [...params, limit]
  );
  
  // Update access counts
  if (rows.length > 0) {
    const ids = rows.map(r => r.id);
    await pool.query(
      `UPDATE episodic_memory SET access_count = access_count + 1, last_accessed = NOW() WHERE id = ANY($1)`,
      [ids]
    );
  }
  
  return rows.map(r => ({
    ...r,
    embedding: undefined // don't return raw embedding
  }));
}

// Get recent memories chronologically
export async function recent(limit = 20, eventType = null) {
  const where = eventType ? 'WHERE event_type = $2' : '';
  const params = eventType ? [limit, eventType] : [limit];
  const { rows } = await pool.query(
    `SELECT id, timestamp, event_type, content, emotional_valence, emotional_arousal,
            surprise_magnitude, importance_score, active_app, participants,
            consolidation_status
     FROM episodic_memory ${where}
     ORDER BY timestamp DESC LIMIT $1`,
    params
  );
  return rows;
}

// Compute importance score dynamically
export function computeImportance(episode) {
  const base = 0.3;
  const surpriseBonus = (episode.surprise_magnitude || 0) * 0.3;
  const emotionBonus = Math.abs(episode.emotional_arousal || 0) * 0.2;
  const accessBonus = Math.log(1 + (episode.access_count || 0)) * 0.05;
  const daysSinceAccess = episode.last_accessed 
    ? (Date.now() - new Date(episode.last_accessed).getTime()) / 86400000 
    : 999;
  const decayPenalty = Math.exp(-(episode.decay_rate || 0.1) * daysSinceAccess) - 1; // negative
  
  return Math.max(0, Math.min(1, base + surpriseBonus + emotionBonus + accessBonus + decayPenalty));
}

// Update importance scores (run periodically)
export async function refreshImportance(batchSize = 100) {
  const { rows } = await pool.query(
    `SELECT id, surprise_magnitude, emotional_arousal, access_count, 
            last_accessed, decay_rate, importance_score
     FROM episodic_memory 
     WHERE consolidation_status != 'archived'
     ORDER BY last_accessed ASC NULLS FIRST
     LIMIT $1`,
    [batchSize]
  );
  
  let updated = 0;
  for (const ep of rows) {
    const newImportance = computeImportance(ep);
    if (Math.abs(newImportance - ep.importance_score) > 0.05) {
      await pool.query(
        'UPDATE episodic_memory SET importance_score = $1 WHERE id = $2',
        [newImportance, ep.id]
      );
      updated++;
    }
  }
  return { reviewed: rows.length, updated };
}

// Prune low-importance memories
export async function prune(importanceThreshold = 0.1, maxAge = '90 days') {
  const { rows } = await pool.query(
    `DELETE FROM episodic_memory 
     WHERE importance_score < $1 
       AND timestamp < NOW() - $2::interval
       AND consolidation_status IN ('raw', 'reviewed')
     RETURNING id`,
    [importanceThreshold, maxAge]
  );
  return { pruned: rows.length };
}

// Stats
export async function stats() {
  const { rows: [s] } = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE consolidation_status = 'raw') as raw,
      COUNT(*) FILTER (WHERE consolidation_status = 'consolidated') as consolidated,
      AVG(importance_score) as avg_importance,
      AVG(surprise_magnitude) FILTER (WHERE surprise_magnitude > 0) as avg_surprise,
      MIN(timestamp) as oldest,
      MAX(timestamp) as newest
    FROM episodic_memory
  `);
  return s;
}

export default { store, recall, recent, refreshImportance, prune, stats };
