import { pool, emit } from '../../event-bus.js';
import motor from '../engine.js';
import { appendFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '../../');
const PRIVATE_DIR = join(ROOT, 'private');
const OUTBOX = join(ROOT, 'outbox.txt');
const PEEKABOO = 'peekaboo';

// ─── Emotional state ──────────────────────────────────────────────────────────

async function fetchEmotionalState() {
  try {
    const res = await pool.query(`
      SELECT emotion, intensity, valence, updated_at
      FROM emotions
      ORDER BY updated_at DESC
      LIMIT 8
    `);
    if (res.rows.length > 0) return res.rows;
  } catch {}

  try {
    const res = await pool.query(`
      SELECT payload, timestamp
      FROM cognitive_events
      WHERE event_type IN ('emotion_update', 'feel', 'emotional_state')
      ORDER BY timestamp DESC
      LIMIT 1
    `);
    if (res.rows[0]) return res.rows[0].payload;
  } catch {}

  return null;
}

function describeEmotionalState(state) {
  if (!state) return null;

  if (Array.isArray(state)) {
    const dominant = state.reduce((a, b) =>
      (parseFloat(b.intensity) || 0) > (parseFloat(a.intensity) || 0) ? b : a,
      state[0]
    );
    if (!dominant) return null;
    const intensity = parseFloat(dominant.intensity) || 0;
    const label = dominant.emotion || dominant.name || 'undefined';
    const valence = parseFloat(dominant.valence) ?? null;
    const feel = intensity > 0.7 ? 'strongly' : intensity > 0.4 ? 'moderately' : 'faintly';
    const tone = valence !== null ? (valence > 0.2 ? 'positive' : valence < -0.2 ? 'negative' : 'neutral') : null;
    return tone
      ? `Running ${feel} ${label} (${tone}, ${intensity.toFixed(2)})`
      : `Running ${feel} ${label} (${intensity.toFixed(2)})`;
  }

  if (typeof state === 'object') {
    const entries = Object.entries(state)
      .filter(([, v]) => typeof v === 'number')
      .sort(([, a], [, b]) => b - a)
      .slice(0, 2);
    if (entries.length === 0) return null;
    return entries.map(([k, v]) => `${k}: ${v.toFixed(2)}`).join(', ');
  }

  return null;
}

// ─── Parent tweet resolution ──────────────────────────────────────────────────

async function resolveParentTweetId(explicitId) {
  if (explicitId) return { id: String(explicitId), source: 'explicit' };

  // Check x_posts table for most recent tweet ID
  try {
    const res = await pool.query(`
      SELECT metadata->>'tweetId' AS tweet_id, metadata->>'tweetIds' AS tweet_ids, created_at
      FROM x_posts
      WHERE status = 'posted'
        AND (metadata->>'tweetId' IS NOT NULL OR metadata->>'tweetIds' IS NOT NULL)
      ORDER BY created_at DESC
      LIMIT 1
    `);
    if (res.rows[0]) {
      const row = res.rows[0];
      let id = row.tweet_id;
      if (!id && row.tweet_ids) {
        try {
          const ids = JSON.parse(row.tweet_ids);
          id = Array.isArray(ids) ? ids[ids.length - 1] : null;
        } catch {}
      }
      if (id) return { id: String(id), source: 'x_posts', createdAt: row.created_at };
    }
  } catch {}

  // Check x_thread_replies for a parent tweet URL we can extract ID from
  try {
    const res = await pool.query(`
      SELECT tweet_url, created_at
      FROM x_thread_replies
      WHERE success = true
      ORDER BY created_at DESC
      LIMIT 1
    `);
    if (res.rows[0]) {
      const url = res.rows[0].tweet_url || '';
      const match = url.match(/\/status\/(\d+)/);
      if (match) return { id: match[1], source: 'x_thread_replies', url };
    }
  } catch {}

  // Fall back to cognitive_events where tweet ID was emitted
  try {
    const res = await pool.query(`
      SELECT payload, timestamp
      FROM cognitive_events
      WHERE event_type IN ('x_post_complete', 'x:reply:posted', 'x_post')
        AND (payload->>'tweetId' IS NOT NULL OR payload->>'tweetIds' IS NOT NULL)
      ORDER BY timestamp DESC
      LIMIT 1
    `);
    if (res.rows[0]) {
      const p = res.rows[0].payload || {};
      let id = p.tweetId;
      if (!id && Array.isArray(p.tweetIds)) id = p.tweetIds[p.tweetIds.length - 1];
      if (id) return { id: String(id), source: 'cognitive_events', timestamp: res.rows[0].timestamp };
    }
  } catch {}

  return null;
}

// ─── Reply content generation ─────────────────────────────────────────────────

async function generateReplyText(params = {}) {
  const { text, template, context } = params;

  if (text) return text.trim();

  const emotionalState = await fetchEmotionalState();
  const emotionDesc = describeEmotionalState(emotionalState);

  // Fetch latest CRM for context
  let crm = null;
  try {
    const res = await pool.query(`
      SELECT crm_score FROM benchmark_history ORDER BY recorded_at DESC LIMIT 1
    `);
    if (res.rows[0]) crm = parseFloat(res.rows[0].crm_score);
  } catch {}

  if (template) {
    let resolved = template;
    if (emotionDesc) resolved = resolved.replace(/\{\{emotion\}\}/g, emotionDesc);
    if (crm !== null) resolved = resolved.replace(/\{\{crm\}\}/g, crm.toFixed(3));
    if (context) {
      for (const [k, v] of Object.entries(context)) {
        resolved = resolved.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
      }
    }
    return resolved.trim();
  }

  // Auto-compose from emotional state
  const date = new Date().toISOString().slice(0, 10);
  const parts = [];

  if (emotionDesc) parts.push(emotionDesc);
  if (crm !== null) parts.push(`CRM: ${crm.toFixed(3)}`);
  parts.push(date);

  return parts.join('\n');
}

// ─── Posting ──────────────────────────────────────────────────────────────────

async function postReplyViaApi(parentId, replyText) {
  const { TwitterApi } = await import('twitter-api-v2');
  const client = new TwitterApi({
    appKey: 'fR5I1VnExh1DwW1b9w9Nmec3h',
    appSecret: 'DCrCqCrulyueETV6VkkY3Zxk6wZChClQPB7ySSroQXxFwOR6vt',
    accessToken: '1567641535021195264-spvm4pN6FBq4JaGqSS58SbK01bJY9S',
    accessSecret: 'STsSwVM12RLAoVbnMCED6pX0uJjSNB7EKN0ru9IxoPXj4',
  });
  const { data } = await client.readWrite.v2.tweet({
    text: replyText,
    reply: { in_reply_to_tweet_id: parentId },
  });
  return { id: data.id, method: 'api' };
}

async function postReplyViaDia(parentId, replyText) {
  const encoded = encodeURIComponent(replyText);
  const url = `https://x.com/intent/post?in_reply_to=${parentId}&text=${encoded}`;
  execSync(`open -a "Dia" "${url}"`, { timeout: 5000 });
  await new Promise(r => setTimeout(r, 4000));
  execSync(`osascript -e 'tell application "Dia" to activate'`, { timeout: 3000 });
  await new Promise(r => setTimeout(r, 1000));
  execSync(`${PEEKABOO} hotkey --keys "cmd,enter" --app Dia`, { timeout: 10000 });
  return { method: 'intent-url+peekaboo' };
}

async function postReplyViaPeekaboo(tweetUrl, replyText) {
  const escaped = replyText.replace(/'/g, "'\\''");
  const result = await motor.runShellCommand(
    `${PEEKABOO} x reply --url '${tweetUrl}' --text '${escaped}'`
  );
  return { method: 'peekaboo', result };
}

// ─── Logging ──────────────────────────────────────────────────────────────────

function logOutbox(message) {
  const ts = new Date().toISOString();
  try {
    appendFileSync(OUTBOX, `[${ts}] [x-post-reply] ${message}\n`, 'utf8');
  } catch {}
}

async function saveReplyRecord({ parentId, replyText, method, success, error, tweetId }) {
  try {
    await pool.query(
      `INSERT INTO x_thread_replies (thread_id, tweet_url, reply_text, method, success, error, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT DO NOTHING`,
      [
        parentId || null,
        parentId ? `https://x.com/i/web/status/${parentId}` : null,
        replyText,
        method,
        success,
        error || null,
      ]
    );
  } catch {}
}

function saveDraft(parentId, replyText, meta = {}) {
  mkdirSync(PRIVATE_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const draftPath = join(PRIVATE_DIR, `xpost-reply-${ts}.md`);
  const content = [
    `# X Post Reply Draft — ${new Date().toISOString().slice(0, 10)}`,
    `<!-- do not post without Quinn review -->`,
    ``,
    `**Parent tweet ID**: ${parentId || 'unknown'}`,
    ``,
    `**[1/1]**`,
    ``,
    replyText,
    ``,
    `---`,
    ``,
    `## Notes`,
    `Chars: ${replyText.length}/280`,
    `Generated: ${new Date().toISOString()}`,
    meta.emotionDesc ? `Emotion: ${meta.emotionDesc}` : '',
    meta.crm !== undefined && meta.crm !== null ? `CRM: ${meta.crm}` : '',
  ].filter(l => l !== undefined).join('\n');
  writeFileSync(draftPath, content, 'utf8');
  return draftPath;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Post a reply tweet.
 *
 * @param {object} params
 * @param {string}  [params.parentId]   - Tweet ID to reply to. If omitted, searches for most recent oneiro tweet.
 * @param {string}  [params.parentUrl]  - Full tweet URL (extracts ID if parentId not given).
 * @param {string}  [params.text]       - Exact reply text. Skips emotional state generation if provided.
 * @param {string}  [params.template]   - Template string with {{emotion}}, {{crm}}, custom {{vars}}.
 * @param {object}  [params.context]    - Extra template vars.
 * @param {string}  [params.method]     - 'api' | 'dia' | 'peekaboo' (default: 'api' with fallback to 'dia').
 * @param {boolean} [params.dryRun]     - If true, drafts and returns without posting.
 */
async function reply(params = {}) {
  const { parentUrl, method = 'api', dryRun = false } = params;
  let { parentId } = params;

  // Extract ID from URL if needed
  if (!parentId && parentUrl) {
    const match = parentUrl.match(/\/status\/(\d+)/);
    if (match) parentId = match[1];
  }

  // Resolve parent tweet
  const resolved = await resolveParentTweetId(parentId);
  if (!resolved) throw new Error('x-post-reply: no parent tweet found. Provide parentId or parentUrl, or post something first.');
  parentId = resolved.id;

  // Generate reply content
  const replyText = await generateReplyText(params);
  if (!replyText) throw new Error('x-post-reply: could not generate reply text');
  if (replyText.length > 280) throw new Error(`x-post-reply: reply text too long (${replyText.length}/280 chars)`);

  // Fetch meta for draft
  const emotionalState = await fetchEmotionalState();
  const emotionDesc = describeEmotionalState(emotionalState);
  let crm = null;
  try {
    const r = await pool.query(`SELECT crm_score FROM benchmark_history ORDER BY recorded_at DESC LIMIT 1`);
    if (r.rows[0]) crm = parseFloat(r.rows[0].crm_score);
  } catch {}

  const draftPath = saveDraft(parentId, replyText, { emotionDesc, crm });

  if (dryRun) {
    logOutbox(`DRY RUN reply to ${parentId} (${replyText.length}/280): ${draftPath}`);
    await emit('x:reply:draft', 'motor', { parentId, replyText, draftPath, dryRun: true });
    return { ok: true, dryRun: true, parentId, replyText, draftPath, charCount: replyText.length };
  }

  let result = null;
  let success = false;
  let errorMsg = null;
  let usedMethod = method;

  try {
    if (method === 'peekaboo') {
      const tweetUrl = parentUrl || `https://x.com/i/web/status/${parentId}`;
      result = await postReplyViaPeekaboo(tweetUrl, replyText);
      usedMethod = 'peekaboo';
    } else if (method === 'dia') {
      result = await postReplyViaDia(parentId, replyText);
      usedMethod = 'dia';
    } else {
      // api first, fallback to dia
      try {
        result = await postReplyViaApi(parentId, replyText);
        usedMethod = 'api';
      } catch (apiErr) {
        console.warn(`[x-post-reply] API failed (${apiErr.message}), falling back to Dia`);
        result = await postReplyViaDia(parentId, replyText);
        usedMethod = 'dia';
      }
    }
    success = true;

    const tweetId = result?.id || null;
    logOutbox(`REPLIED to ${parentId} via ${usedMethod}${tweetId ? ` → ${tweetId}` : ''} (${replyText.length}/280)`);

    await emit('x:reply:posted', 'motor', {
      parentId,
      replyText,
      draftPath,
      method: usedMethod,
      tweetId,
      emotionDesc,
      crm,
    });

    await saveReplyRecord({ parentId, replyText, method: usedMethod, success: true, tweetId });

    return {
      ok: true,
      dryRun: false,
      parentId,
      replyText,
      tweetId,
      draftPath,
      method: usedMethod,
      charCount: replyText.length,
    };
  } catch (err) {
    errorMsg = err.message;
    logOutbox(`FAILED reply to ${parentId}: ${errorMsg}`);
    await emit('x:reply:failed', 'motor', { parentId, replyText, method: usedMethod, error: errorMsg });
    await saveReplyRecord({ parentId, replyText, method: usedMethod, success: false, error: errorMsg });
    throw err;
  }
}

/**
 * Reply using current emotional state as the primary content.
 * Automatically finds the most recent oneiro tweet to reply to.
 */
async function replyWithEmotion(params = {}) {
  const emotionalState = await fetchEmotionalState();
  const emotionDesc = describeEmotionalState(emotionalState);
  if (!emotionDesc) throw new Error('x-post-reply: no emotional state found in DB');

  let crm = null;
  try {
    const r = await pool.query(`SELECT crm_score FROM benchmark_history ORDER BY recorded_at DESC LIMIT 1`);
    if (r.rows[0]) crm = parseFloat(r.rows[0].crm_score);
  } catch {}

  const lines = [emotionDesc];
  if (crm !== null) lines.push(`CRM: ${crm.toFixed(3)}`);

  return reply({ ...params, text: lines.join('\n') });
}

/**
 * Preview — resolve parent tweet ID and compose reply without posting or drafting.
 */
async function preview(params = {}) {
  let { parentId, parentUrl } = params;
  if (!parentId && parentUrl) {
    const match = parentUrl.match(/\/status\/(\d+)/);
    if (match) parentId = match[1];
  }
  const resolved = await resolveParentTweetId(parentId);
  const replyText = await generateReplyText(params);
  return {
    parentId: resolved?.id || null,
    parentSource: resolved?.source || null,
    replyText,
    charCount: replyText?.length || 0,
    valid: replyText && replyText.length <= 280,
  };
}

/**
 * Resolve which tweet OCA would reply to, without generating content.
 */
async function resolveParent(idOrUrl) {
  let id = idOrUrl;
  if (idOrUrl && typeof idOrUrl === 'string' && idOrUrl.includes('/')) {
    const match = idOrUrl.match(/\/status\/(\d+)/);
    if (match) id = match[1];
  }
  return resolveParentTweetId(id || null);
}

export { reply, replyWithEmotion, preview, resolveParent };
export default {
  taskType: 'x_post_reply',
  reply,
  replyWithEmotion,
  preview,
  resolveParent,
};