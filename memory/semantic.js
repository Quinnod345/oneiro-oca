// OCA Semantic Memory — abstracted knowledge and principles
import { pool, emit } from '../event-bus.js';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getEmbedding(text) {
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000)
  });
  return resp.data[0].embedding;
}

// Store or update a semantic memory
export async function learn(concept, { category = null, sourceType = 'abstraction', sourceEpisodes = [], confidence = 0.5, causalLinks = [] } = {}) {
  const embedding = await getEmbedding(concept);
  
  // Check for existing similar concept
  const { rows: existing } = await pool.query(
    `SELECT id, concept, evidence_count, contradiction_count, confidence, source_episodes
     FROM semantic_memory 
     WHERE embedding <=> $1::vector < 0.12
     ORDER BY embedding <=> $1::vector 
     LIMIT 1`,
    [JSON.stringify(embedding)]
  );
  
  if (existing.length > 0) {
    // Reinforce existing knowledge
    const ex = existing[0];
    const newEpisodes = [...new Set([...(ex.source_episodes || []), ...sourceEpisodes])];
    const newEvidence = ex.evidence_count + 1;
    const newConfidence = Math.min(0.99, newEvidence / (newEvidence + ex.contradiction_count));
    
    await pool.query(
      `UPDATE semantic_memory SET 
         evidence_count = $1, confidence = $2, source_episodes = $3,
         last_confirmed = NOW(), updated_at = NOW()
       WHERE id = $4`,
      [newEvidence, newConfidence, newEpisodes, ex.id]
    );
    
    return { id: ex.id, action: 'reinforced', concept: ex.concept, confidence: newConfidence };
  }
  
  // Create new semantic memory
  const { rows } = await pool.query(
    `INSERT INTO semantic_memory (concept, category, source_type, source_episodes, confidence, causal_links, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7::vector) RETURNING id`,
    [concept, category, sourceType, sourceEpisodes, confidence, JSON.stringify(causalLinks), JSON.stringify(embedding)]
  );
  
  return { id: rows[0].id, action: 'created', concept, confidence };
}

// Contradict a semantic memory (evidence against it)
export async function contradict(conceptId, reason = '') {
  const { rows: [mem] } = await pool.query(
    `UPDATE semantic_memory SET 
       contradiction_count = contradiction_count + 1,
       confidence = GREATEST(0.01, evidence_count::float / (evidence_count + contradiction_count + 1)),
       last_contradicted = NOW(), updated_at = NOW()
     WHERE id = $1 RETURNING id, concept, confidence, evidence_count, contradiction_count`,
    [conceptId]
  );
  return mem;
}

// Query semantic memory
export async function query(searchText, { limit = 5, category = null, minConfidence = 0 } = {}) {
  const embedding = await getEmbedding(searchText);
  
  let where = 'WHERE confidence >= $2';
  const params = [JSON.stringify(embedding), minConfidence];
  let idx = 3;
  
  if (category) {
    where += ` AND category = $${idx}`;
    params.push(category);
    idx++;
  }
  
  const { rows } = await pool.query(
    `SELECT id, concept, category, confidence, evidence_count, contradiction_count,
            source_type, causal_links, 1 - (embedding <=> $1::vector) as similarity
     FROM semantic_memory ${where}
     ORDER BY embedding <=> $1::vector LIMIT $${idx}`,
    [...params, limit]
  );
  
  // Update access
  if (rows.length > 0) {
    await pool.query(
      'UPDATE semantic_memory SET access_count = access_count + 1, last_accessed = NOW() WHERE id = ANY($1)',
      [rows.map(r => r.id)]
    );
  }
  
  return rows;
}

// Abstraction: derive semantic memory from episodic memories
export async function abstractFromEpisodes(episodeIds, concept, category = null) {
  return await learn(concept, {
    category,
    sourceType: 'abstraction',
    sourceEpisodes: episodeIds,
    confidence: Math.min(0.9, 0.3 + episodeIds.length * 0.1)
  });
}

// Get all knowledge in a category
export async function getCategory(category, limit = 50) {
  const { rows } = await pool.query(
    `SELECT id, concept, confidence, evidence_count, contradiction_count
     FROM semantic_memory WHERE category = $1 ORDER BY confidence DESC LIMIT $2`,
    [category, limit]
  );
  return rows;
}

// Stats
export async function stats() {
  const { rows: [s] } = await pool.query(`
    SELECT COUNT(*) as total,
           AVG(confidence) as avg_confidence,
           SUM(evidence_count) as total_evidence,
           SUM(contradiction_count) as total_contradictions,
           COUNT(DISTINCT category) as categories
    FROM semantic_memory
  `);
  return s;
}

export default { learn, contradict, query, abstractFromEpisodes, getCategory, stats };
