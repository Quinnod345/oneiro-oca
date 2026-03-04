// OCA Memory Consolidation Engine
// Analogous to sleep-dependent memory processing
// Converts episodic → semantic, detects procedural patterns, prunes
import { pool } from '../event-bus.js';
import episodic from './episodic.js';
import semantic from './semantic.js';
import procedural from './procedural.js';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Run a full consolidation cycle
export async function consolidate() {
  const startedAt = new Date();
  console.log('[consolidation] starting cycle...');
  
  let episodesReviewed = 0, semanticCreated = 0, proceduralUpdated = 0, episodesPruned = 0;
  
  // 1. REPLAY: Get unconsolidated episodic memories
  const { rows: rawEpisodes } = await pool.query(
    `SELECT * FROM episodic_memory 
     WHERE consolidation_status = 'raw'
     ORDER BY importance_score DESC
     LIMIT 100`
  );
  episodesReviewed = rawEpisodes.length;
  
  if (rawEpisodes.length === 0) {
    console.log('[consolidation] nothing to consolidate');
    return { episodesReviewed: 0, semanticCreated: 0, proceduralUpdated: 0, episodesPruned: 0 };
  }
  
  // 2. EXTRACT PATTERNS: Use LLM to find patterns across episodes
  const episodeSummaries = rawEpisodes.slice(0, 30).map(e => 
    `[${e.timestamp}] (${e.event_type}) ${e.content.slice(0, 200)} [valence:${e.emotional_valence}, surprise:${e.surprise_magnitude}]`
  ).join('\n');
  
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6-20250514',
      system: `You are a memory consolidation engine. Given a list of episodic memories, extract:
1. PRINCIPLES: General knowledge/rules that can be abstracted (e.g., "Quinn prefers direct communication")
2. PROCEDURES: Repeated action patterns that could become automatic skills (e.g., "when seeing error X, do Y")
3. CONNECTIONS: Causal links between events (e.g., "high typing speed correlates with frustration")

You MUST respond in valid JSON only, no other text:
{
  "principles": [{"concept": "...", "category": "...", "evidence_episodes": [ids], "confidence": 0.0-1.0}],
  "procedures": [{"trigger": {...}, "actions": [...], "domain": "..."}],
  "connections": [{"cause": "...", "effect": "...", "mechanism": "...", "confidence": 0.0-1.0}]
}`,
      messages: [
        { role: 'user', content: episodeSummaries }
      ],
      temperature: 0.3,
      max_tokens: 1024
    });
    
    const extracted = JSON.parse(response.content[0].text);
    
    // 3. ABSTRACT: Create semantic memories from principles
    if (extracted.principles) {
      for (const p of extracted.principles) {
        const result = await semantic.learn(p.concept, {
          category: p.category,
          sourceType: 'abstraction',
          sourceEpisodes: p.evidence_episodes || [],
          confidence: p.confidence || 0.5
        });
        if (result.action === 'created') semanticCreated++;
      }
    }
    
    // 4. SKILL FORMATION: Create procedural memories
    if (extracted.procedures) {
      for (const proc of extracted.procedures) {
        try {
          await procedural.learn(proc.trigger, proc.actions, { domain: proc.domain });
          proceduralUpdated++;
        } catch (e) {
          // might fail on invalid trigger patterns, that's ok
        }
      }
    }
    
    // 5. CAUSAL LINKS: Store in world model
    if (extracted.connections) {
      for (const conn of extracted.connections) {
        await pool.query(
          `INSERT INTO world_model (domain, entity, state, transition_rules)
           VALUES ('causal', $1, $2, $3)
           ON CONFLICT (domain, entity) DO UPDATE SET
             transition_rules = world_model.transition_rules || $3,
             updated_at = NOW()`,
          [conn.cause, JSON.stringify({ effect: conn.effect }), JSON.stringify([conn])]
        );
      }
    }
  } catch (e) {
    console.error('[consolidation] extraction failed:', e.message);
  }
  
  // 6. MARK REVIEWED
  const reviewedIds = rawEpisodes.map(e => e.id);
  await pool.query(
    `UPDATE episodic_memory SET consolidation_status = 'reviewed' WHERE id = ANY($1)`,
    [reviewedIds]
  );
  
  // 7. REFRESH IMPORTANCE
  await episodic.refreshImportance(200);
  
  // 8. PRUNE
  const pruneResult = await episodic.prune(0.1, '90 days');
  episodesPruned = pruneResult.pruned;
  
  // Log
  await pool.query(
    `INSERT INTO consolidation_log (completed_at, episodes_reviewed, semantic_created, procedural_updated, episodes_pruned, notes)
     VALUES (NOW(), $1, $2, $3, $4, $5)`,
    [episodesReviewed, semanticCreated, proceduralUpdated, episodesPruned, 
     `Reviewed ${episodesReviewed} episodes, extracted ${semanticCreated} principles`]
  );
  
  const elapsed = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
  console.log(`[consolidation] done in ${elapsed}s: ${episodesReviewed} reviewed, ${semanticCreated} semantic, ${proceduralUpdated} procedural, ${episodesPruned} pruned`);
  
  return { episodesReviewed, semanticCreated, proceduralUpdated, episodesPruned };
}

// Get consolidation history
export async function history(limit = 10) {
  const { rows } = await pool.query(
    'SELECT * FROM consolidation_log ORDER BY started_at DESC LIMIT $1', [limit]
  );
  return rows;
}

export default { consolidate, history };
