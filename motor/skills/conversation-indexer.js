// conversation-indexer.js — pipes every conversation turn, tool result, and 
// system event into the OCA psyche (moments table with embeddings).
// This makes ALL AI activity searchable via /recall from any mind or session.

import { feel, embed, pool } from './core.js';

// Ensure the conversation_log table exists for raw turn storage
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversation_log (
      id          SERIAL PRIMARY KEY,
      timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source      TEXT NOT NULL,           -- 'quinn', 'oneiro', 'tool', 'system', 'trader', 'crypto'
      channel     TEXT,                    -- 'telegram', 'openclaw', 'robinhood', 'crypto', etc
      content     TEXT NOT NULL,
      metadata    JSONB DEFAULT '{}',
      embedding   VECTOR(1536),
      moment_id   INTEGER REFERENCES moments(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_convlog_ts ON conversation_log (timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_convlog_source ON conversation_log (source);
    CREATE INDEX IF NOT EXISTS idx_convlog_embedding ON conversation_log
      USING hnsw (embedding vector_cosine_ops)
      WHERE embedding IS NOT NULL;
  `);
}

// Index a single turn. Deduplication via content hash so replays don't double-insert.
export async function indexTurn({ source, channel, content, metadata = {}, feeling = null, intensity = 0.5 }) {
  if (!content || content.trim().length < 3) return;

  try {
    await ensureSchema();

    // Dedup: skip if identical content from same source within 60s
    const { rows: existing } = await pool.query(
      `SELECT id FROM conversation_log 
       WHERE source = $1 AND content = $2 AND timestamp > NOW() - INTERVAL '60 seconds'
       LIMIT 1`,
      [source, content.trim()]
    );
    if (existing.length > 0) return;

    // Build a rich text for embedding: source + content + metadata summary
    const embedText = [
      `[${source}${channel ? ' via ' + channel : ''}]`,
      content.trim(),
      metadata.tool ? `tool: ${metadata.tool}` : null,
      metadata.result ? `result: ${String(metadata.result).slice(0, 200)}` : null,
    ].filter(Boolean).join(' — ');

    const emb = await embed(embedText);

    // Store raw turn
    const { rows } = await pool.query(
      `INSERT INTO conversation_log (source, channel, content, metadata, embedding)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [source, channel || null, content.trim(), JSON.stringify(metadata), JSON.stringify(emb)]
    );

    // Also store as a moment (appears in /recall results)
    const feelingStr = feeling || (source === 'quinn' ? 'receiving-quinn' : source === 'oneiro' ? 'responding' : 'observing');
    const momentId = await feel(
      embedText,
      feelingStr,
      intensity,
      'conversation',
      { source, channel, log_id: rows[0].id, ...metadata }
    );

    // Back-link
    if (momentId) {
      await pool.query(`UPDATE conversation_log SET moment_id = $1 WHERE id = $2`, [momentId, rows[0].id]);
    }
  } catch (e) {
    // Never crash the main process over indexing
    console.error('[conv-indexer] error:', e.message?.slice(0, 80));
  }
}

// Index a tool call result
export async function indexToolCall({ tool, input, output, source = 'oneiro', channel = null }) {
  const summary = `Used tool ${tool}: ${JSON.stringify(input).slice(0, 150)} → ${String(output).slice(0, 300)}`;
  await indexTurn({
    source,
    channel,
    content: summary,
    metadata: { tool, input, output_preview: String(output).slice(0, 300) },
    feeling: 'tool-execution',
    intensity: 0.3,
  });
}

// Index a trading decision/action
export async function indexTrade({ system, action, symbol, amount, result, chain = null }) {
  const content = `[${system}] ${action} ${symbol || ''} ${amount ? '$' + Number(amount).toFixed(2) : ''} ${chain ? 'on ' + chain : ''} — ${result ? 'success' : 'attempted'}`;
  await indexTurn({
    source: system,
    channel: 'trading',
    content,
    metadata: { action, symbol, amount, chain, result },
    feeling: result ? 'trade-executed' : 'trade-attempted',
    intensity: 0.6,
  });
}

// Search conversation history (wraps recall but searches conversation_log specifically)
export async function searchConversations(query, { limit = 10, source = null } = {}) {
  try {
    const emb = await embed(query);
    const sourceFilter = source ? 'AND source = $3' : '';
    const params = source ? [JSON.stringify(emb), limit, source] : [JSON.stringify(emb), limit];
    const { rows } = await pool.query(
      `SELECT id, timestamp, source, channel, content, metadata,
              1 - (embedding <=> $1) as relevance
       FROM conversation_log
       WHERE embedding IS NOT NULL ${sourceFilter}
       ORDER BY embedding <=> $1
       LIMIT $2`,
      params
    );
    return rows;
  } catch { return []; }
}

export default { indexTurn, indexToolCall, indexTrade, searchConversations };
