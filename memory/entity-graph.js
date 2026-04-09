// OCA Entity Graph — persistent entities and relations
import { pool } from '../event-bus.js';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'while', 'for', 'to', 'of',
  'in', 'on', 'at', 'by', 'with', 'from', 'is', 'are', 'was', 'were', 'be', 'this',
  'that', 'these', 'those', 'it', 'its', 'my', 'your', 'our', 'their'
]);

function canonicalEntityKey(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function extractEntityCandidates(text) {
  const input = String(text || '');
  if (!input) return [];

  const candidates = new Set();

  // Quoted spans are often concrete entities.
  for (const match of input.matchAll(/"([^"]{2,80})"/g)) {
    candidates.add(match[1].trim());
  }

  // Title/camel case-ish words or pairs.
  for (const match of input.matchAll(/\b([A-Z][a-zA-Z0-9._-]{2,}(?:\s+[A-Z][a-zA-Z0-9._-]{2,})?)\b/g)) {
    candidates.add(match[1].trim());
  }

  // app/file-like tokens
  for (const match of input.matchAll(/\b([a-zA-Z0-9._-]{3,}\.(?:js|ts|tsx|md|sql|json|py|sh))\b/g)) {
    candidates.add(match[1].trim());
  }

  // Keep concise and filter obvious stopwords.
  return [...candidates]
    .map(c => c.replace(/\s+/g, ' ').trim())
    .filter(c => c.length >= 3 && c.length <= 80)
    .filter(c => !STOPWORDS.has(c.toLowerCase()))
    .slice(0, 20);
}

function inferEntityType(name) {
  const v = String(name || '');
  if (/\.(js|ts|tsx|md|sql|json|py|sh)$/i.test(v)) return 'file';
  if (/chrome|cursor|terminal|xcode|notion|safari|discord|telegram/i.test(v)) return 'app';
  if (/quinn|oneiro/i.test(v)) return 'person';
  if (/project|repo|architecture|system|engine|model/i.test(v)) return 'project';
  return 'concept';
}

export async function upsertEntity(name, {
  entityType = null,
  confidence = 0.5,
  aliases = [],
  metadata = {},
} = {}) {
  const canonicalName = String(name || '').trim();
  const entityKey = canonicalEntityKey(canonicalName);
  if (!entityKey) return null;

  const { rows: [row] } = await pool.query(
    `INSERT INTO entities
     (entity_key, canonical_name, entity_type, aliases, confidence, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (entity_key) DO UPDATE SET
       updated_at = NOW(),
       last_seen = NOW(),
       confidence = GREATEST(entities.confidence, $5),
       aliases = (
         SELECT ARRAY(
           SELECT DISTINCT x
           FROM unnest(COALESCE(entities.aliases, '{}'::text[]) || COALESCE($4, '{}'::text[])) AS x
           WHERE x IS NOT NULL AND x <> ''
         )
       ),
       metadata = COALESCE(entities.metadata, '{}'::jsonb) || $6::jsonb
     RETURNING *`,
    [
      entityKey,
      canonicalName,
      entityType || inferEntityType(canonicalName),
      aliases,
      Math.max(0, Math.min(1, Number(confidence) || 0.5)),
      JSON.stringify(metadata || {}),
    ]
  );

  return row || null;
}

async function ensureEntityByKey(entityKey, fallbackName = null) {
  const { rows: [existing] } = await pool.query(
    'SELECT * FROM entities WHERE entity_key = $1',
    [entityKey]
  );
  if (existing) return existing;
  return upsertEntity(fallbackName || entityKey, { confidence: 0.4 });
}

export async function upsertRelation(subjectEntityKey, relationType, objectEntityKey, {
  confidence = 0.5,
  metadata = {},
} = {}) {
  if (!subjectEntityKey || !relationType || !objectEntityKey) return null;

  const subject = await ensureEntityByKey(subjectEntityKey, subjectEntityKey);
  const object = await ensureEntityByKey(objectEntityKey, objectEntityKey);
  if (!subject?.id || !object?.id || subject.id === object.id) return null;

  const { rows: [row] } = await pool.query(
    `INSERT INTO entity_relations
     (subject_entity_id, relation_type, object_entity_id, confidence, metadata)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (subject_entity_id, relation_type, object_entity_id) DO UPDATE SET
       updated_at = NOW(),
       last_seen = NOW(),
       confidence = GREATEST(entity_relations.confidence, $4),
       evidence_count = entity_relations.evidence_count + 1,
       metadata = COALESCE(entity_relations.metadata, '{}'::jsonb) || $5::jsonb
     RETURNING *`,
    [
      subject.id,
      relationType,
      object.id,
      Math.max(0, Math.min(1, Number(confidence) || 0.5)),
      JSON.stringify(metadata || {}),
    ]
  );

  return row || null;
}

export async function recordMention(entityId, sourceType, sourceId, mentionText, {
  context = {},
  confidence = 0.5,
} = {}) {
  if (!entityId || !sourceType) return null;
  const { rows: [row] } = await pool.query(
    `INSERT INTO entity_mentions
     (entity_id, source_type, source_id, mention_text, context, confidence)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [entityId, sourceType, sourceId, mentionText || null, JSON.stringify(context || {}), Math.max(0, Math.min(1, Number(confidence) || 0.5))]
  );
  return row || null;
}

export async function ingestText(text, {
  sourceType = 'episode',
  sourceId = null,
  metadata = {},
} = {}) {
  const candidates = extractEntityCandidates(text);
  if (candidates.length === 0) return { entities: 0, relations: 0 };

  const entities = [];
  for (const candidate of candidates) {
    const row = await upsertEntity(candidate, { metadata, confidence: 0.55 });
    if (row) {
      entities.push(row);
      await recordMention(row.id, sourceType, sourceId, candidate, {
        context: { text: String(text).slice(0, 280) },
        confidence: 0.55,
      });
    }
  }

  // Co-occurrence relation for entities observed in same evidence.
  let relations = 0;
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i];
      const b = entities[j];
      await upsertRelation(a.entity_key, 'co_occurs_with', b.entity_key, { confidence: 0.5, metadata: { sourceType, sourceId } });
      await upsertRelation(b.entity_key, 'co_occurs_with', a.entity_key, { confidence: 0.5, metadata: { sourceType, sourceId } });
      relations += 2;
    }
  }

  return { entities: entities.length, relations };
}

export async function searchEntities(query = '', {
  type = null,
  limit = 20,
  offset = 0,
} = {}) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 20));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const q = String(query || '').trim();

  if (!q) {
    const { rows } = await pool.query(
      `SELECT *
       FROM entities
       WHERE ($1::text IS NULL OR entity_type = $1)
       ORDER BY confidence DESC, last_seen DESC
       LIMIT $2 OFFSET $3`,
      [type, safeLimit, safeOffset]
    );
    return rows;
  }

  const pattern = `%${q}%`;
  const { rows } = await pool.query(
    `SELECT *
     FROM entities
     WHERE ($1::text IS NULL OR entity_type = $1)
       AND (
         canonical_name ILIKE $2
         OR entity_key ILIKE $2
         OR EXISTS (
           SELECT 1 FROM unnest(aliases) a WHERE a ILIKE $2
         )
       )
     ORDER BY confidence DESC, last_seen DESC
     LIMIT $3 OFFSET $4`,
    [type, pattern, safeLimit, safeOffset]
  );
  return rows;
}

export async function relationsForEntity(entityKey, { limit = 50 } = {}) {
  if (!entityKey) return [];
  const safeLimit = Math.max(1, Math.min(300, Number(limit) || 50));
  const { rows } = await pool.query(
    `SELECT
       r.id,
       r.relation_type,
       r.confidence,
       r.evidence_count,
       r.last_seen,
       s.entity_key as subject_key,
       s.canonical_name as subject_name,
       o.entity_key as object_key,
       o.canonical_name as object_name
     FROM entity_relations r
     JOIN entities s ON s.id = r.subject_entity_id
     JOIN entities o ON o.id = r.object_entity_id
     WHERE s.entity_key = $1
     ORDER BY r.confidence DESC, r.last_seen DESC
     LIMIT $2`,
    [entityKey, safeLimit]
  );
  return rows;
}

export async function contextForText(text, { limit = 8 } = {}) {
  const candidates = extractEntityCandidates(text).slice(0, Math.max(1, limit));
  if (candidates.length === 0) return { entities: [], relations: [] };

  const entities = [];
  for (const c of candidates) {
    const [match] = await searchEntities(c, { limit: 1 });
    if (match) entities.push(match);
  }

  const dedup = new Map(entities.map(e => [e.entity_key, e]));
  const unique = [...dedup.values()].slice(0, limit);
  const relations = [];
  for (const e of unique.slice(0, 3)) {
    const rels = await relationsForEntity(e.entity_key, { limit: 6 });
    relations.push(...rels);
  }

  return { entities: unique, relations: relations.slice(0, 20) };
}

// ═══════════════════════════════════════════════════
// HIPPORAG: Personalized PageRank on entity graph
// ═══════════════════════════════════════════════════

export async function matchEntitiesToGraph(entityNames, { limit = 3 } = {}) {
  if (!entityNames || entityNames.length === 0) return [];

  const matched = [];
  for (const name of entityNames) {
    // First try exact match
    const { rows: exact } = await pool.query(
      `SELECT id, entity_key, canonical_name, mention_count
       FROM entities WHERE LOWER(entity_key) = LOWER($1) OR LOWER(canonical_name) = LOWER($1)
       LIMIT 1`,
      [name]
    );
    if (exact.length > 0) {
      matched.push({ ...exact[0], match_type: 'exact', similarity: 1.0 });
      continue;
    }

    // Then try embedding similarity
    try {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI();
      const resp = await openai.embeddings.create({ model: 'text-embedding-3-small', input: name });
      const embedding = resp.data[0].embedding;

      const { rows: similar } = await pool.query(
        `SELECT id, entity_key, canonical_name, mention_count,
                1 - (embedding <=> $1::vector) AS similarity
         FROM entities WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector LIMIT $2`,
        [JSON.stringify(embedding), limit]
      );
      if (similar.length > 0 && similar[0].similarity > 0.5) {
        matched.push({ ...similar[0], match_type: 'embedding' });
      }
    } catch {}
  }
  return matched;
}

export async function personalizedPageRank(seedNodeIds, {
  damping = 0.85,
  iterations = 15,
  tolerance = 0.0001,
  maxNodes = 500,
} = {}) {
  if (!seedNodeIds || seedNodeIds.length === 0) return new Map();

  // Load the subgraph: entities reachable within 2 hops from seeds
  const { rows: relations } = await pool.query(
    `WITH hop1 AS (
       SELECT DISTINCT object_entity_id AS eid FROM entity_relations WHERE subject_entity_id = ANY($1)
       UNION
       SELECT DISTINCT subject_entity_id FROM entity_relations WHERE object_entity_id = ANY($1)
     ),
     hop2 AS (
       SELECT DISTINCT r.object_entity_id AS eid FROM entity_relations r
         JOIN hop1 ON r.subject_entity_id = hop1.eid
       UNION
       SELECT DISTINCT r.subject_entity_id FROM entity_relations r
         JOIN hop1 ON r.object_entity_id = hop1.eid
     ),
     all_nodes AS (
       SELECT unnest($1::int[]) AS eid
       UNION SELECT eid FROM hop1
       UNION SELECT eid FROM hop2
     )
     SELECT r.subject_entity_id AS src, r.object_entity_id AS dst, COALESCE(r.weight, 1.0) AS weight
     FROM entity_relations r
     WHERE r.subject_entity_id IN (SELECT eid FROM all_nodes)
        AND r.object_entity_id IN (SELECT eid FROM all_nodes)
     LIMIT $2`,
    [seedNodeIds, maxNodes * 10]
  );

  // Build adjacency list
  const adj = new Map(); // nodeId -> [{target, weight}]
  const allNodes = new Set();
  for (const r of relations) {
    allNodes.add(r.src);
    allNodes.add(r.dst);
    if (!adj.has(r.src)) adj.set(r.src, []);
    if (!adj.has(r.dst)) adj.set(r.dst, []);
    adj.get(r.src).push({ target: r.dst, weight: Number(r.weight) || 1 });
    adj.get(r.dst).push({ target: r.src, weight: Number(r.weight) || 1 }); // undirected
  }

  // Compute out-degree weights for normalization
  const outWeight = new Map();
  for (const [node, edges] of adj) {
    outWeight.set(node, edges.reduce((s, e) => s + e.weight, 0));
  }

  // Node specificity: rarer entities get higher seed weight
  const { rows: specificityRows } = await pool.query(
    `SELECT id, COALESCE(mention_count, 1) AS mc FROM entities WHERE id = ANY($1)`,
    [seedNodeIds]
  );
  const specificity = new Map();
  let totalSpec = 0;
  for (const r of specificityRows) {
    const spec = 1 / Math.log(2 + (Number(r.mc) || 0));
    specificity.set(r.id, spec);
    totalSpec += spec;
  }

  // Initialize scores: seeds get specificity-weighted probability
  const scores = new Map();
  for (const node of allNodes) scores.set(node, 0);
  for (const seedId of seedNodeIds) {
    const spec = specificity.get(seedId) || (1 / seedNodeIds.length);
    scores.set(seedId, totalSpec > 0 ? spec / totalSpec : 1 / seedNodeIds.length);
  }

  // Iterate PPR
  for (let iter = 0; iter < iterations; iter++) {
    const newScores = new Map();
    for (const node of allNodes) newScores.set(node, 0);

    // Teleport: with probability (1-damping), jump back to a seed
    for (const seedId of seedNodeIds) {
      const spec = specificity.get(seedId) || (1 / seedNodeIds.length);
      const teleport = (1 - damping) * (totalSpec > 0 ? spec / totalSpec : 1 / seedNodeIds.length);
      newScores.set(seedId, (newScores.get(seedId) || 0) + teleport);
    }

    // Propagate: with probability damping, follow edges
    for (const [node, edges] of adj) {
      const nodeScore = scores.get(node) || 0;
      if (nodeScore < 1e-10) continue;
      const totalOut = outWeight.get(node) || 1;
      for (const edge of edges) {
        const contribution = damping * nodeScore * (edge.weight / totalOut);
        newScores.set(edge.target, (newScores.get(edge.target) || 0) + contribution);
      }
    }

    // Check convergence
    let maxDiff = 0;
    for (const node of allNodes) {
      maxDiff = Math.max(maxDiff, Math.abs((newScores.get(node) || 0) - (scores.get(node) || 0)));
      scores.set(node, newScores.get(node) || 0);
    }
    if (maxDiff < tolerance) break;
  }

  return scores;
}

export async function rankPassagesByPPR(nodeScores, { limit = 10 } = {}) {
  if (!nodeScores || nodeScores.size === 0) return [];

  // Get top-scored nodes
  const topNodes = [...nodeScores.entries()]
    .filter(([, score]) => score > 0.001)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);

  if (topNodes.length === 0) return [];

  const nodeIds = topNodes.map(([id]) => id);

  // Map nodes to episodic memories via entity_mentions
  const { rows: mentions } = await pool.query(
    `SELECT em.entity_id, em.source_type, em.source_id
     FROM entity_mentions em
     WHERE em.entity_id = ANY($1) AND em.source_type = 'episode'`,
    [nodeIds]
  );

  // Score each episode: sum of its entities' PPR scores
  const episodeScores = new Map();
  for (const m of mentions) {
    const nodeScore = nodeScores.get(m.entity_id) || 0;
    const current = episodeScores.get(m.source_id) || 0;
    episodeScores.set(m.source_id, current + nodeScore);
  }

  if (episodeScores.size === 0) return [];

  // Fetch the top-scored episodes
  const topEpisodes = [...episodeScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  const episodeIds = topEpisodes.map(([id]) => id);
  const { rows: episodes } = await pool.query(
    `SELECT id, timestamp, event_type, content, emotional_valence, emotional_arousal,
            surprise_magnitude, importance_score, active_app, participants
     FROM episodic_memory WHERE id = ANY($1)`,
    [episodeIds]
  );

  // Attach PPR scores and sort
  const scoreMap = new Map(topEpisodes);
  return episodes
    .map(ep => ({ ...ep, ppr_score: scoreMap.get(ep.id) || 0, embedding: undefined }))
    .sort((a, b) => b.ppr_score - a.ppr_score);
}

export default {
  upsertEntity, upsertRelation, recordMention, ingestText,
  searchEntities, relationsForEntity, contextForText,
  extractEntityCandidates, canonicalEntityKey,
  matchEntitiesToGraph, personalizedPageRank, rankPassagesByPPR
};
