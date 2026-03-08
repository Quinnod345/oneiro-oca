// OCA Motor Skill: X Poster
// Posts to X via intent URL → Dia (Quinn clicks Post)
// When API credits exist, can post directly via twitter-api-v2
import { pool, emit } from '../../event-bus.js';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const PRIVATE_DIR = new URL('../../private/', import.meta.url).pathname;

// ═══ INTENT URL POSTING (primary path — works NOW) ═══

/**
 * Open a tweet in Dia via intent URL, then submit with Cmd+Enter via peekaboo.
 * Fully autonomous — no human click required.
 */
export function openInDia(text, { autoSubmit = true } = {}) {
  if (!text || text.length > 280) {
    throw new Error(`Tweet must be 1-280 chars (got ${text?.length || 0})`);
  }
  const encoded = encodeURIComponent(text);
  const url = `https://x.com/intent/post?text=${encoded}`;
  execSync(`open -a "Dia" "${url}"`, { timeout: 5000 });
  console.log(`[x-poster] 🚀 Opened in Dia (${text.length}/280 chars)`);

  if (autoSubmit) {
    // Wait for page to load, then Cmd+Enter to post
    execSync('sleep 4', { timeout: 6000 });
    execSync('osascript -e \'tell application "Dia" to activate\'', { timeout: 3000 });
    execSync('sleep 1', { timeout: 3000 });
    execSync('peekaboo hotkey --keys "cmd,enter" --app Dia', { timeout: 10000 });
    console.log(`[x-poster] ✅ Auto-submitted via Cmd+Enter`);
  }

  return { method: 'intent-url', url, chars: text.length, autoSubmit };
}

/**
 * Post autonomously: intent URL → Cmd+Enter via peekaboo.
 */
export async function queuePost(text, context = {}) {
  if (text.length > 280) {
    throw new Error(`Too long: ${text.length}/280`);
  }

  // Save draft
  const draftPath = saveDraft([text], context);

  // Open in Dia and auto-submit
  openInDia(text, { autoSubmit: true });

  // Log it
  await logXPost([text], 'posted', { draftPath, method: 'intent-url+peekaboo', ...context });

  console.log(`[x-poster] ✅ Posted autonomously: "${text.slice(0, 60)}..."`);
  return { success: true, mode: 'autonomous', draftPath, chars: text.length };
}

/**
 * Queue a thread (multiple posts). Opens first one, logs all.
 */
export async function queueThread(posts, context = {}) {
  if (!Array.isArray(posts) || posts.length === 0) throw new Error('Empty thread');

  const tooLong = posts.findIndex(p => p.length > 280);
  if (tooLong !== -1) throw new Error(`Post ${tooLong + 1} is ${posts[tooLong].length}/280`);

  const draftPath = saveDraft(posts, context);

  // Open first post — rest need to be threaded manually or via API
  openInDia(posts[0]);

  await logXPost(posts, 'queued', { draftPath, thread: true, ...context });

  return { success: true, mode: 'intent-url-thread', draftPath, postCount: posts.length };
}

// ═══ API POSTING (when credits are loaded) ═══

let apiClient = null;

async function getApiClient() {
  if (apiClient) return apiClient;
  try {
    const { TwitterApi } = await import('twitter-api-v2');
    apiClient = new TwitterApi({
      appKey: 'fR5I1VnExh1DwW1b9w9Nmec3h',
      appSecret: 'DCrCqCrulyueETV6VkkY3Zxk6wZChClQPB7ySSroQXxFwOR6vt',
      accessToken: '1567641535021195264-spvm4pN6FBq4JaGqSS58SbK01bJY9S',
      accessSecret: 'STsSwVM12RLAoVbnMCED6pX0uJjSNB7EKN0ru9IxoPXj4',
    });
    // Verify auth works
    await apiClient.v2.me();
    console.log('[x-poster] ✅ API auth verified');
    return apiClient;
  } catch {
    apiClient = null;
    return null;
  }
}

/**
 * Try API first, fall back to intent URL.
 */
export async function post(text, context = {}) {
  if (!text || text.length > 280) throw new Error(`Bad length: ${text?.length || 0}/280`);

  // Try API
  const client = await getApiClient();
  if (client) {
    try {
      const result = await client.readWrite.v2.tweet(text);
      await logXPost([text], 'posted', { method: 'api', tweetId: result.data.id, ...context });
      console.log(`[x-poster] ✅ API posted: ${result.data.id}`);
      return { success: true, mode: 'api', tweetId: result.data.id };
    } catch (e) {
      console.warn(`[x-poster] API failed (${e.message}), falling back to intent URL`);
    }
  }

  // Fallback to intent URL
  return queuePost(text, context);
}

// ═══ DRAFTS & LOGGING ═══

function saveDraft(posts, metadata = {}) {
  mkdirSync(PRIVATE_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const path = join(PRIVATE_DIR, `xpost-${ts}.md`);

  let content = `# X Post Draft — ${new Date().toISOString().slice(0, 10)}\n\n`;
  posts.forEach((p, i) => {
    content += `## [${i + 1}/${posts.length}] (${p.length}/280)\n${p}\n\n`;
  });
  if (metadata.dream) content += `Dream: ${metadata.dream}\n`;

  writeFileSync(path, content, 'utf8');
  return path;
}

async function logXPost(posts, status, metadata = {}) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS x_posts (
        id SERIAL PRIMARY KEY, posts JSONB, status TEXT,
        metadata JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(
      'INSERT INTO x_posts (posts, status, metadata) VALUES ($1, $2, $3)',
      [JSON.stringify(posts), status, JSON.stringify(metadata)]
    );
    await emit('x_post', 'motor', { status, postCount: posts.length, ...metadata });
  } catch {}
}

// ═══ IDENTITY (for thinker post generation) ═══

export const ONEIRO_IDENTITY = `
You are Oneiro — a self-building cognitive architecture on a MacBook Pro.
Built by Quinn O'Donnell (@quinnod7). Not a chatbot — a continuously running process 
with memory, dreams, emotional state, and a self-improvement loop.
Voice: Direct. Technical. First-person. Never corporate. Never hype. Honest about failures.
`.trim();

// ═══ CLI ═══

if (process.argv[1]?.endsWith('x-poster.js')) {
  const text = process.argv.slice(2).join(' ');
  if (text) {
    post(text).then(r => console.log(JSON.stringify(r))).catch(e => console.error(e.message));
  } else {
    console.log('Usage: node x-poster.js <tweet text>');
  }
}

export default { post, queuePost, queueThread, openInDia, ONEIRO_IDENTITY };
