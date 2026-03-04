// OCA Creative Synthesis — dream states, novel connections, Lovelace layer
import { pool, emit } from '../event-bus.js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function getEmbedding(text) {
  const resp = await openai.embeddings.create({ model: 'text-embedding-3-small', input: text.slice(0, 8000) });
  return resp.data[0].embedding;
}

// Constrained Randomness: connect two distant memory clusters
export async function forceConnection() {
  // Get two random, semantically distant memories
  const { rows: memories } = await pool.query(
    `SELECT id, content, embedding FROM episodic_memory 
     WHERE embedding IS NOT NULL 
     ORDER BY RANDOM() LIMIT 20`
  );
  
  if (memories.length < 2) return null;
  
  // Find the two most distant memories
  let maxDist = 0, a = null, b = null;
  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const dist = cosineDistance(memories[i].embedding, memories[j].embedding);
      if (dist > maxDist) {
        maxDist = dist;
        a = memories[i];
        b = memories[j];
      }
    }
  }
  
  if (!a || !b) return null;
  
  // Force a creative connection
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      system: 'You are a creative synthesis engine. Given two unrelated concepts, find a surprising, meaningful connection between them. Be genuinely creative — don\'t force it if there\'s nothing real, but look for structural similarities, metaphorical links, or practical applications that cross domains. One paragraph.',
      messages: [
        { role: 'user', content: `Concept A: ${a.content.slice(0, 500)}\n\nConcept B: ${b.content.slice(0, 500)}` }
      ],
      temperature: 0.9,
      max_tokens: 200
    });
    
    const connection = response.content[0].text;
    
    // Evaluate novelty
    const connEmb = await getEmbedding(connection);
    const { rows: similar } = await pool.query(
      `SELECT 1 - (embedding <=> $1::vector) as similarity 
       FROM creative_artifacts 
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector LIMIT 1`,
      [JSON.stringify(connEmb)]
    );
    const noveltyScore = similar.length > 0 ? 1 - parseFloat(similar[0].similarity) : 1.0;
    
    // Store artifact
    const { rows: [artifact] } = await pool.query(
      `INSERT INTO creative_artifacts 
       (artifact_type, content, creation_method, source_memories, novelty_score, quality_self_assessment)
       VALUES ('connection', $1, 'constrained_randomness', $2, $3, $4) RETURNING id`,
      [connection, [a.id, b.id], noveltyScore, noveltyScore > 0.5 ? 0.7 : 0.4]
    );
    
    return {
      id: artifact.id,
      memoryA: a.content.slice(0, 100),
      memoryB: b.content.slice(0, 100),
      connection,
      noveltyScore,
      distance: maxDist
    };
  } catch (e) {
    console.error('[creative] connection failed:', e.message);
    return null;
  }
}

function cosineDistance(a, b) {
  if (!a || !b || typeof a === 'string' || typeof b === 'string') return 0;
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    nA += a[i] ** 2;
    nB += b[i] ** 2;
  }
  const sim = dot / (Math.sqrt(nA) * Math.sqrt(nB));
  return 1 - sim;
}

// Cross-Domain Transfer: apply a principle from one domain to another
export async function crossDomainTransfer(sourceDomain, targetDomain) {
  // Get a principle from source domain
  const { rows: principles } = await pool.query(
    `SELECT concept, confidence FROM semantic_memory 
     WHERE category = $1 AND confidence > 0.5
     ORDER BY RANDOM() LIMIT 1`,
    [sourceDomain]
  );
  
  if (principles.length === 0) return null;
  
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      system: 'You are a cross-domain transfer engine. Given a principle from one domain, find how it could apply to a completely different domain. Focus on structural similarities, not surface similarities. Be specific and practical.',
      messages: [
        { role: 'user', content: `Source domain: ${sourceDomain}\nPrinciple: ${principles[0].concept}\n\nTarget domain: ${targetDomain}\n\nHow does this principle transfer?` }
      ],
      temperature: 0.7,
      max_tokens: 200
    });
    
    const transfer = response.content[0].text;
    
    const { rows: [artifact] } = await pool.query(
      `INSERT INTO creative_artifacts 
       (artifact_type, content, creation_method, quality_self_assessment)
       VALUES ('idea', $1, 'cross_domain', 0.5) RETURNING id`,
      [`[${sourceDomain} → ${targetDomain}] ${transfer}`]
    );
    
    return { id: artifact.id, sourcePrinciple: principles[0].concept, transfer };
  } catch (e) {
    return null;
  }
}

// Dream State: unconstrained generation from memory seeds
export async function dream(durationMinutes = 2) {
  const startedAt = new Date();
  
  // Gather seeds — recent important memories
  const { rows: seeds } = await pool.query(
    `SELECT id, content FROM episodic_memory 
     WHERE importance_score > 0.5
     ORDER BY RANDOM() LIMIT 5`
  );
  
  if (seeds.length === 0) return null;
  
  const seedText = seeds.map(s => s.content.slice(0, 200)).join('\n---\n');
  
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      system: 'You are a dream engine. Given memory fragments, generate a dream-like stream of consciousness that recombines them in unexpected ways. Don\'t be literal — let themes morph, let images shift, let unrelated things connect through feeling rather than logic. This is not a summary — it\'s a dream. Write 2-3 paragraphs.',
      messages: [
        { role: 'user', content: `Memory seeds:\n${seedText}` }
      ],
      temperature: 1.0,
      max_tokens: 400
    });
    
    const dreamContent = response.content[0].text;
    
    // Extract novel connections from the dream
    const extractResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      system: 'Extract any novel connections or insights from this dream. List them as brief bullet points. If there are none worth noting, say "none".',
      messages: [
        { role: 'user', content: dreamContent }
      ],
      temperature: 0.3,
      max_tokens: 200
    });
    
    const connectionsRaw = extractResponse.content[0].text;
    const hasNovel = !connectionsRaw.toLowerCase().includes('none');
    const connections = hasNovel ? connectionsRaw.split('\n').filter(l => l.trim().startsWith('-')).map(l => l.trim().slice(2)) : [];
    
    // Store dream
    const { rows: [ep] } = await pool.query(
      `INSERT INTO dream_episodes 
       (seed_memories, dream_content, coherence_score, contains_novel_connections, novel_connections, ended_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id`,
      [seeds.map(s => s.id), dreamContent, 0.4, hasNovel, connections]
    );
    
    await emit('creative_output', 'creative', {
      type: 'dream', id: ep.id, hasNovel, connectionCount: connections.length
    });
    
    return {
      id: ep.id,
      dream: dreamContent,
      novelConnections: connections,
      seeds: seeds.map(s => s.content.slice(0, 80))
    };
  } catch (e) {
    console.error('[creative] dream failed:', e.message);
    return null;
  }
}

// Get novelty trend
export async function noveltyTrend(days = 7) {
  const { rows } = await pool.query(
    `SELECT DATE(created_at) as day, AVG(novelty_score) as avg_novelty, COUNT(*) as count
     FROM creative_artifacts 
     WHERE created_at > NOW() - $1::interval AND novelty_score IS NOT NULL
     GROUP BY DATE(created_at) ORDER BY day`,
    [`${days} days`]
  );
  return rows;
}

export default { forceConnection, crossDomainTransfer, dream, noveltyTrend };
