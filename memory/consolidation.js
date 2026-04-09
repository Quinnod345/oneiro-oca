// OCA Memory Consolidation Engine
// Analogous to sleep-dependent memory processing
// Converts episodic → semantic, detects procedural patterns, prunes
import { pool, emit } from '../event-bus.js';
import episodic from './episodic.js';
import semantic from './semantic.js';
import procedural from './procedural.js';
import { inferLayerFromText, upsertNeuralConnection } from '../neural-connections.js';
import llm from '../llm.js';


function parseConsolidationPayload(rawText) {
  const raw = String(rawText || '').trim();
  const parseAttempts = [];
  const deFenced = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  parseAttempts.push(raw);
  parseAttempts.push(deFenced);
  for (const match of raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1]) parseAttempts.push(match[1].trim());
  }

  const objStart = raw.indexOf('{');
  const objEnd = raw.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) {
    parseAttempts.push(raw.slice(objStart, objEnd + 1));
  }

  const seen = new Set();
  for (const candidate of parseAttempts) {
    if (!candidate) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const sanitized = candidate
      .replace(/^\uFEFF/, '')
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/,\s*([}\]])/g, '$1')
      .trim();
    const variants = candidate === sanitized ? [candidate] : [candidate, sanitized];

    for (const variant of variants) {
      try {
        const parsed = JSON.parse(variant);
        return {
          principles: Array.isArray(parsed?.principles) ? parsed.principles : [],
          procedures: Array.isArray(parsed?.procedures) ? parsed.procedures : [],
          connections: Array.isArray(parsed?.connections) ? parsed.connections : [],
          contradictions: Array.isArray(parsed?.contradictions) ? parsed.contradictions : []
        };
      } catch {
        // continue trying candidates
      }
    }
  }

  return {
    principles: [],
    procedures: [],
    connections: [],
    contradictions: []
  };
}

// Run a full consolidation cycle
export async function consolidate() {
  const startedAt = new Date();
  console.log('[consolidation] starting cycle...');
  
  let episodesReviewed = 0, semanticCreated = 0, proceduralUpdated = 0, contradictionUpdates = 0, episodesPruned = 0;
  
  // 1. REPLAY: Get unconsolidated episodic memories (larger batch for faster backlog processing)
  const BATCH_SIZE = 200;
  const LLM_SAMPLE_SIZE = 20; // send summaries of these to LLM; mark all BATCH_SIZE as reviewed
  const { rows: rawEpisodes } = await pool.query(
    `SELECT * FROM episodic_memory 
     WHERE consolidation_status = 'raw'
     ORDER BY importance_score DESC
     LIMIT $1`,
    [BATCH_SIZE]
  );
  episodesReviewed = rawEpisodes.length;
  
  if (rawEpisodes.length === 0) {
    console.log('[consolidation] nothing to consolidate');
    return { episodesReviewed: 0, semanticCreated: 0, proceduralUpdated: 0, episodesPruned: 0 };
  }
  
  // 2. EXTRACT PATTERNS: Sample representative episodes for LLM analysis
  // Take highest importance ones for LLM, mark entire batch as reviewed
  const sampled = rawEpisodes.slice(0, LLM_SAMPLE_SIZE);
  const episodeSummaries = sampled.map(e => 
    `[${e.timestamp}] (${e.event_type}) ${e.content.slice(0, 200)} [valence:${e.emotional_valence}, surprise:${e.surprise_magnitude}]`
  ).join('\n');
  
  try {
    const response = await llm.messages.create({
      model: 'claude-sonnet-4-6',
      system: `You are a memory consolidation engine. Given episodic memories, extract durable knowledge.

RESPOND IN VALID JSON ONLY. Keep evidence_episodes as short numeric IDs only. Be concise.
{
  "principles": [{"concept": "one sentence", "category": "short_tag", "confidence": 0.0-1.0}],
  "procedures": [{"trigger": {"key":"value"}, "actions": ["step1"], "domain": "tag"}],
  "connections": [{"cause": "short", "effect": "short", "mechanism": "short", "confidence": 0.5}],
  "contradictions": [{"concept": "short", "contradicts": "short", "reason": "short", "confidence": 0.5}]
}

Extract 3-8 principles, 0-3 procedures, 0-3 connections. DO NOT include long evidence arrays. Keep total response under 800 tokens.`,
      messages: [
        { role: 'user', content: episodeSummaries }
      ],
      temperature: 0.3,
      max_tokens: 2048
    });
    
    const rawText = response.content?.[0]?.text || '';
    const extracted = parseConsolidationPayload(rawText);

    if (extracted.principles.length === 0 && extracted.procedures.length === 0 && extracted.connections.length === 0) {
      console.log('[consolidation] LLM returned no extractable patterns. Raw response (first 300 chars):', rawText.slice(0, 300));
    } else {
      console.log(`[consolidation] extracted: ${extracted.principles.length} principles, ${extracted.procedures.length} procedures, ${extracted.connections.length} connections, ${extracted.contradictions.length} contradictions`);
    }

    // 3. ABSTRACT: Create semantic memories from principles
    if (extracted.principles) {
      for (const p of extracted.principles) {
        try {
          const result = await semantic.learn(p.concept, {
            category: p.category,
            sourceType: 'abstraction',
            sourceEpisodes: p.evidence_episodes || [],
            confidence: p.confidence || 0.5
          });
          if (result.action === 'created' || result.action === 'updated') semanticCreated++;
        } catch (e) {
          console.error('[consolidation] semantic.learn failed:', e.message?.slice(0, 100));
        }
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
        try {
        const causalEdge = [{
          from: conn.cause,
          to: conn.effect,
          mechanism: conn.mechanism || null,
          confidence: conn.confidence ?? null,
          created_at: new Date().toISOString(),
          source: 'consolidation'
        }];
        await pool.query(
          `INSERT INTO world_model (domain, entity, state, transition_rules, causal_graph_edges)
           VALUES ('causal', $1, $2, $3, $4)
           ON CONFLICT (domain, entity) DO UPDATE SET
             transition_rules = world_model.transition_rules || $3,
             causal_graph_edges = world_model.causal_graph_edges || $4,
             updated_at = NOW()`,
          [
            conn.cause,
            JSON.stringify({ effect: conn.effect }),
            JSON.stringify([conn]),
            JSON.stringify(causalEdge)
          ]
        );

        // Also persist as a live neural connection for topology visualization.
        await upsertNeuralConnection({
          fromLayer: inferLayerFromText(conn.cause),
          toLayer: inferLayerFromText(conn.effect),
          connectionType: 'consolidation',
          strengthDelta: (conn.confidence || 0.5) * 0.08,
          baseStrength: Math.max(0.2, (conn.confidence || 0.5) * 0.5),
          label: `${String(conn.cause || '').slice(0, 70)} → ${String(conn.effect || '').slice(0, 70)}`,
          metadata: {
            mechanism: conn.mechanism || null,
            confidence: conn.confidence ?? null,
            source: 'consolidation',
          }
        });
        } catch (e) {
          console.error('[consolidation] connection storage failed:', e.message?.slice(0, 100));
        }
      }
    }

    // 6. CONTRADICTIONS: Update semantic truth maintenance
    if (extracted.contradictions) {
      for (const contradiction of extracted.contradictions) {
        try {
          const conceptText = contradiction.concept || contradiction.claim;
          if (!conceptText) continue;
          const [target] = await semantic.query(conceptText, { limit: 1, minConfidence: 0 });
          if (!target?.id) continue;

          let contradictingConceptId = null;
          if (contradiction.contradicts) {
            const [contra] = await semantic.query(contradiction.contradicts, { limit: 1, minConfidence: 0 });
            contradictingConceptId = contra?.id || null;
          }

          await semantic.contradict(
            target.id,
            contradiction.reason || 'Consolidation contradiction',
            {
              contradictingConceptId,
              episodeId: Number.isFinite(Number(contradiction.evidence_episodes?.[0]))
                ? Number(contradiction.evidence_episodes?.[0])
                : null,
              weight: Math.max(0.1, Math.min(3, contradiction.confidence || 1)),
            }
          );
          contradictionUpdates++;
          // CRM Fix 5: discovering a belief is wrong creates genuine surprise
          await emit('perception_update', 'consolidation', {
            channel: 'internal', event: 'contradiction_discovered',
            concept: contradiction.concept, reason: contradiction.reason
          }, { priority: 0.5 }).catch(() => {});
        } catch {
          // Keep consolidation resilient even on malformed contradiction payloads.
        }
      }
    }
  } catch (e) {
    console.error('[consolidation] extraction failed:', e.message);
    // DO NOT mark as reviewed when extraction fails -- leave as raw for retry
    await pool.query(
      `INSERT INTO consolidation_log (completed_at, episodes_reviewed, semantic_created, procedural_updated, episodes_pruned, notes)
       VALUES (NOW(), $1, 0, 0, 0, $2)`,
      [episodesReviewed, `Extraction failed: ${e.message?.slice(0, 200)}`]
    );
    const elapsed = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
    console.log(`[consolidation] FAILED in ${elapsed}s: ${episodesReviewed} episodes left as raw for retry`);
    return { episodesReviewed, semanticCreated: 0, proceduralUpdated: 0, episodesPruned: 0, failed: true };
  }

  // QUALITY GATE: only mark as reviewed if we actually extracted something
  const extracted_anything = semanticCreated > 0 || proceduralUpdated > 0 || contradictionUpdates > 0;
  const reviewedIds = rawEpisodes.map(e => e.id);

  if (extracted_anything) {
    // Mark as 'consolidated' -- genuine knowledge was extracted
    await pool.query(
      `UPDATE episodic_memory SET consolidation_status = 'consolidated' WHERE id = ANY($1)`,
      [reviewedIds]
    );
  } else {
    // LLM returned valid but empty -- mark as reviewed (not consolidated)
    await pool.query(
      `UPDATE episodic_memory SET consolidation_status = 'reviewed' WHERE id = ANY($1)`,
      [reviewedIds]
    );
    console.log('[consolidation] warning: LLM returned no patterns from', episodesReviewed, 'episodes');
  }
  
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
     `Reviewed ${episodesReviewed} episodes, extracted ${semanticCreated} principles, contradiction_updates=${contradictionUpdates}`]
  );
  
  const elapsed = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
  console.log(`[consolidation] done in ${elapsed}s: ${episodesReviewed} reviewed, ${semanticCreated} semantic, ${proceduralUpdated} procedural, ${contradictionUpdates} contradiction updates, ${episodesPruned} pruned`);
  
  return { episodesReviewed, semanticCreated, proceduralUpdated, contradictionUpdates, episodesPruned };
}

// Get consolidation history
export async function history(limit = 10) {
  const { rows } = await pool.query(
    'SELECT * FROM consolidation_log ORDER BY started_at DESC LIMIT $1', [limit]
  );
  return rows;
}

export default { consolidate, history };
