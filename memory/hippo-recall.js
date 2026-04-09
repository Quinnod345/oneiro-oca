// OCA HippoRAG Recall — neurobiologically inspired multi-hop memory retrieval
// Implements the hippocampal indexing theory: extract query entities, match to
// knowledge graph, run Personalized PageRank, rank passages by graph proximity.
// Falls back to flat vector recall when the graph is too sparse.

import { pool } from '../event-bus.js';
import llm from '../llm.js';
import entityGraph from './entity-graph.js';
import episodic from './episodic.js';

// ═══════════════════════════════════════════════════
// STEP 1: Extract entities from query (the "hippocampus" receiving a cue)
// ═══════════════════════════════════════════════════

async function extractQueryEntities(query) {
  // Fast path: try regex/heuristic extraction first
  const heuristicEntities = extractEntitiesHeuristic(query);
  if (heuristicEntities.length >= 2) return heuristicEntities;

  // LLM extraction for complex queries
  try {
    const response = await llm.messages.create({
      model: 'claude-sonnet-4-6',
      system: 'Extract named entities and key concepts from the query. Return a JSON array of strings. Only entities, no explanations. Example: ["Quinn", "Logic Pro", "music production"]',
      messages: [{ role: 'user', content: query }],
      max_tokens: 200,
      temperature: 0
    });

    const text = response.content?.[0]?.text || '';
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return [...new Set([...parsed.map(String), ...heuristicEntities])].slice(0, 8);
      }
    }
  } catch {}

  return heuristicEntities;
}

function extractEntitiesHeuristic(query) {
  const entities = [];
  const words = query.split(/\s+/);

  // Capitalized words (likely proper nouns)
  for (const word of words) {
    const clean = word.replace(/[^a-zA-Z0-9'-]/g, '');
    if (clean.length > 1 && clean[0] === clean[0].toUpperCase() && clean[0] !== clean[0].toLowerCase()) {
      entities.push(clean);
    }
  }

  // Known patterns
  const patterns = [
    /\b(?:Quinn|Oneiro|OCA|OpenClaw|EOSAI|InnerEcho)\b/gi,
    /\b(?:Logic Pro|Cursor|Terminal|Xcode|Telegram|Discord|Arc|Dia)\b/gi,
    /\b(?:MacBook|Apple|Swift|Node\.js|PostgreSQL|Claude)\b/gi,
  ];
  for (const pat of patterns) {
    const matches = query.match(pat);
    if (matches) entities.push(...matches);
  }

  return [...new Set(entities)].slice(0, 8);
}

// ═══════════════════════════════════════════════════
// STEP 2-4: Full HippoRAG recall pipeline
// ═══════════════════════════════════════════════════

export async function hippoRecall(query, {
  limit = 10,
  minGraphResults = 3,
  fallbackToVector = true,
  damping = 0.85,
  pprIterations = 15,
} = {}) {
  const t0 = Date.now();

  // Step 1: Extract entities from query
  const queryEntities = await extractQueryEntities(query);

  if (queryEntities.length === 0) {
    if (fallbackToVector) return episodic.recall(query, { limit });
    return [];
  }

  // Step 2: Match query entities to knowledge graph nodes
  const matchedNodes = await entityGraph.matchEntitiesToGraph(queryEntities);

  if (matchedNodes.length === 0) {
    if (fallbackToVector) return episodic.recall(query, { limit });
    return [];
  }

  const seedIds = matchedNodes.map(n => n.id);

  // Step 3: Run Personalized PageRank
  const nodeScores = await entityGraph.personalizedPageRank(seedIds, {
    damping,
    iterations: pprIterations,
  });

  // Step 4: Rank passages by PPR scores
  const graphResults = await entityGraph.rankPassagesByPPR(nodeScores, { limit });

  // If graph results are sparse, blend with vector recall
  if (graphResults.length < minGraphResults && fallbackToVector) {
    try {
      const vectorResults = await episodic.recall(query, { limit: limit - graphResults.length });
      const seenIds = new Set(graphResults.map(r => r.id));

      // Interleave: graph results first (they have multi-hop context), then vector fill
      const blended = [...graphResults];
      for (const vr of vectorResults) {
        if (!seenIds.has(vr.id)) {
          blended.push({ ...vr, ppr_score: 0, recall_method: 'vector_fallback' });
          seenIds.add(vr.id);
        }
        if (blended.length >= limit) break;
      }
      return annotateResults(blended, queryEntities, matchedNodes, t0);
    } catch {
      return annotateResults(graphResults, queryEntities, matchedNodes, t0);
    }
  }

  return annotateResults(graphResults, queryEntities, matchedNodes, t0);
}

function annotateResults(results, queryEntities, matchedNodes, t0) {
  return results.map(r => ({
    ...r,
    recall_method: r.recall_method || 'hippo_ppr',
    _hippo: {
      query_entities: queryEntities,
      matched_nodes: matchedNodes.map(n => ({ id: n.id, name: n.canonical_name, similarity: n.similarity })),
      elapsed_ms: Date.now() - t0
    }
  }));
}

// ═══════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════

export async function getGraphStats() {
  try {
    const { rows: [counts] } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM entities) AS entity_count,
        (SELECT COUNT(*) FROM entities WHERE embedding IS NOT NULL) AS embedded_count,
        (SELECT COUNT(*) FROM entity_relations) AS relation_count,
        (SELECT COUNT(*) FROM entity_mentions) AS mention_count,
        (SELECT AVG(mention_count) FROM entities WHERE mention_count > 0) AS avg_mentions
    `);
    return counts;
  } catch {
    return {};
  }
}

export default { hippoRecall, extractQueryEntities, getGraphStats };
