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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeEpisodeIds(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0))];
}

async function computeWeightedConfidence(conceptId, fallbackEvidence = 1, fallbackContradictions = 0) {
  const { rows: [evidence] } = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN supports THEN weight ELSE 0 END), 0) as support_weight,
       COALESCE(SUM(CASE WHEN supports = false THEN weight ELSE 0 END), 0) as oppose_weight
     FROM semantic_evidence
     WHERE concept_id = $1`,
    [conceptId]
  );

  const { rows: [contra] } = await pool.query(
    `SELECT COALESCE(SUM(weight), 0) as contradiction_weight
     FROM semantic_contradictions
     WHERE concept_id = $1 AND resolved = false`,
    [conceptId]
  );

  const supportWeight = Number(evidence?.support_weight ?? 0);
  const opposeWeight = Number(evidence?.oppose_weight ?? 0) + Number(contra?.contradiction_weight ?? 0);

  if (supportWeight <= 0 && opposeWeight <= 0) {
    const fallback = fallbackEvidence / Math.max(1, fallbackEvidence + fallbackContradictions);
    return clamp(fallback, 0.01, 0.99);
  }

  const confidence = supportWeight / Math.max(0.0001, supportWeight + opposeWeight);
  return clamp(confidence, 0.01, 0.99);
}

// Store or update a semantic memory
export async function learn(concept, {
  category = null,
  sourceType = 'abstraction',
  sourceEpisodes = [],
  confidence = 0.5,
  causalLinks = [],
  evidenceWeight = 1.0,
  evidenceText = null,
  metadata = {},
} = {}) {
  sourceEpisodes = normalizeEpisodeIds(sourceEpisodes);
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
    
    await pool.query(
      `UPDATE semantic_memory SET 
         evidence_count = $1, source_episodes = $2,
         last_confirmed = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [newEvidence, newEpisodes, ex.id]
    );

    await pool.query(
      `INSERT INTO semantic_evidence (concept_id, episode_id, source_type, weight, supports, evidence_text, metadata)
       VALUES ($1, $2, $3, $4, true, $5, $6)`,
      [
        ex.id,
        sourceEpisodes?.[0] || null,
        sourceType,
        clamp(Number(evidenceWeight) || 1, 0.05, 5),
        evidenceText || concept,
        JSON.stringify(metadata || {}),
      ]
    );

    const weightedConfidence = await computeWeightedConfidence(ex.id, newEvidence, ex.contradiction_count);
    await pool.query(
      `UPDATE semantic_memory SET
         confidence = $1,
         last_weighted_update = NOW(),
         updated_at = NOW()
       WHERE id = $2`,
      [weightedConfidence, ex.id]
    );

    await emit('semantic_reinforced', 'semantic', {
      conceptId: ex.id,
      concept: ex.concept,
      confidence: weightedConfidence,
      evidenceWeight
    }, { priority: 0.45 });
    
    return { id: ex.id, action: 'reinforced', concept: ex.concept, confidence: weightedConfidence };
  }
  
  // Create new semantic memory
  const { rows } = await pool.query(
    `INSERT INTO semantic_memory (concept, category, source_type, source_episodes, confidence, causal_links, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7::vector) RETURNING id`,
    [concept, category, sourceType, sourceEpisodes, confidence, JSON.stringify(causalLinks), JSON.stringify(embedding)]
  );

  await pool.query(
    `INSERT INTO semantic_evidence (concept_id, episode_id, source_type, weight, supports, evidence_text, metadata)
     VALUES ($1, $2, $3, $4, true, $5, $6)`,
    [
      rows[0].id,
      sourceEpisodes?.[0] || null,
      sourceType,
      clamp(Number(evidenceWeight) || 1, 0.05, 5),
      evidenceText || concept,
      JSON.stringify(metadata || {}),
    ]
  );

  const weightedConfidence = await computeWeightedConfidence(rows[0].id, 1, 0);
  await pool.query(
    `UPDATE semantic_memory SET confidence = $1, last_weighted_update = NOW(), updated_at = NOW() WHERE id = $2`,
    [weightedConfidence, rows[0].id]
  );
  
  await emit('semantic_created', 'semantic', {
    conceptId: rows[0].id,
    concept,
    confidence: weightedConfidence,
    category
  }, { priority: 0.45 });

  return { id: rows[0].id, action: 'created', concept, confidence: weightedConfidence };
}

// Contradict a semantic memory (evidence against it)
export async function contradict(conceptId, reason = '', {
  contradictingConceptId = null,
  episodeId = null,
  weight = 1.0,
  contradictionSetId = null,
} = {}) {
  let setId = contradictionSetId;
  if (!setId && contradictingConceptId) {
    const { rows: [newSet] } = await pool.query(
      `INSERT INTO contradiction_sets (label, description)
       VALUES ($1, $2)
       RETURNING id`,
      [`Concept ${conceptId} contradiction`, reason || 'Auto-generated contradiction set']
    );
    setId = newSet?.id || null;
    if (setId) {
      await pool.query(
        `INSERT INTO contradiction_set_members (contradiction_set_id, concept_id, role)
         VALUES ($1, $2, 'claim')
         ON CONFLICT (contradiction_set_id, concept_id) DO NOTHING`,
        [setId, conceptId]
      );
      await pool.query(
        `INSERT INTO contradiction_set_members (contradiction_set_id, concept_id, role)
         VALUES ($1, $2, 'counterclaim')
         ON CONFLICT (contradiction_set_id, concept_id) DO NOTHING`,
        [setId, contradictingConceptId]
      );
    }
  }

  await pool.query(
    `INSERT INTO semantic_contradictions
     (concept_id, contradicting_concept_id, contradiction_set_id, episode_id, reason, weight)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [conceptId, contradictingConceptId, setId, episodeId, reason || null, clamp(Number(weight) || 1, 0.05, 5)]
  );

  await pool.query(
    `INSERT INTO semantic_evidence (concept_id, episode_id, source_type, weight, supports, evidence_text, metadata)
     VALUES ($1, $2, 'contradiction', $3, false, $4, $5)`,
    [conceptId, episodeId, clamp(Number(weight) || 1, 0.05, 5), reason || 'contradiction', JSON.stringify({ contradiction_set_id: setId })]
  );

  const { rows: [base] } = await pool.query(
    `SELECT evidence_count, contradiction_count FROM semantic_memory WHERE id = $1`,
    [conceptId]
  );
  const weightedConfidence = await computeWeightedConfidence(
    conceptId,
    Number(base?.evidence_count || 1),
    Number(base?.contradiction_count || 1) + 1
  );

  const { rows: [mem] } = await pool.query(
    `UPDATE semantic_memory SET 
       contradiction_count = contradiction_count + 1,
       confidence = $2,
       last_contradicted = NOW(),
       last_weighted_update = NOW(),
       updated_at = NOW()
     WHERE id = $1 RETURNING id, concept, confidence, evidence_count, contradiction_count`,
    [conceptId, weightedConfidence]
  );

  await emit('semantic_contradicted', 'semantic', {
    conceptId,
    contradictionSetId: setId,
    confidence: mem?.confidence || weightedConfidence,
    reason
  }, { priority: 0.5 });

  return mem;
}

// Query semantic memory
export async function query(searchText, {
  limit = 5,
  category = null,
  minConfidence = 0,
  includeContradictions = false
} = {}) {
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

  if (!includeContradictions || rows.length === 0) return rows;

  const { rows: contraRows } = await pool.query(
    `SELECT concept_id, contradicting_concept_id, contradiction_set_id, reason, weight, created_at
     FROM semantic_contradictions
     WHERE concept_id = ANY($1) AND resolved = false
     ORDER BY created_at DESC`,
    [rows.map(r => r.id)]
  );
  const byConcept = new Map();
  for (const row of contraRows) {
    if (!byConcept.has(row.concept_id)) byConcept.set(row.concept_id, []);
    byConcept.get(row.concept_id).push(row);
  }

  return rows.map(row => ({
    ...row,
    contradictions: byConcept.get(row.id) || []
  }));
}

// Abstraction: derive semantic memory from episodic memories
export async function abstractFromEpisodes(episodeIds, concept, category = null) {
  return await learn(concept, {
    category,
    sourceType: 'abstraction',
    sourceEpisodes: episodeIds,
    confidence: Math.min(0.9, 0.3 + episodeIds.length * 0.1),
    evidenceWeight: Math.min(3, 0.8 + (episodeIds.length * 0.2))
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
  const { rows: [evidence] } = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN supports THEN weight ELSE 0 END), 0) as support_weight,
      COALESCE(SUM(CASE WHEN supports = false THEN weight ELSE 0 END), 0) as oppose_weight
    FROM semantic_evidence
  `);
  const { rows: [sets] } = await pool.query(`
    SELECT COUNT(*) as active_contradiction_sets
    FROM contradiction_sets
    WHERE status = 'active'
  `);

  return {
    ...s,
    support_weight: evidence?.support_weight || 0,
    oppose_weight: evidence?.oppose_weight || 0,
    active_contradiction_sets: parseInt(sets?.active_contradiction_sets || 0)
  };
}

export async function decayStaleConcepts(limit = 200) {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
  const { rows } = await pool.query(
    `WITH candidates AS (
       SELECT id,
              confidence,
              decay_rate,
              EXTRACT(EPOCH FROM (NOW() - COALESCE(last_accessed, updated_at))) / 86400.0 as days_idle
       FROM semantic_memory
       WHERE COALESCE(last_accessed, updated_at) < NOW() - INTERVAL '12 hours'
         AND COALESCE(last_decay_at, NOW() - INTERVAL '7 days') < NOW() - INTERVAL '6 hours'
       ORDER BY COALESCE(last_accessed, updated_at) ASC
       LIMIT $1
     )
     UPDATE semantic_memory sm
     SET confidence = GREATEST(0.01, sm.confidence * POWER(1 - GREATEST(0.001, LEAST(0.2, c.decay_rate)), GREATEST(1.0, c.days_idle))),
         last_decay_at = NOW(),
         updated_at = NOW()
     FROM candidates c
     WHERE sm.id = c.id
     RETURNING sm.id, sm.confidence`,
    [safeLimit]
  );
  return { decayed: rows.length };
}

export async function getContradictions(conceptId, limit = 20) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 20));
  const { rows } = await pool.query(
    `SELECT *
     FROM semantic_contradictions
     WHERE concept_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [conceptId, safeLimit]
  );
  return rows;
}

export default {
  learn,
  contradict,
  query,
  abstractFromEpisodes,
  getCategory,
  stats,
  decayStaleConcepts,
  getContradictions
};
