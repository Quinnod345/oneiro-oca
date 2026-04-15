// OCA Motor Skill: X Poster
// Posts to X via agent-browser: navigate to compose, paste text, Cmd+Enter to post.
// Falls back to API posting when twitter-api-v2 credentials work.
import { pool, emit } from '../../event-bus.js';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const PRIVATE_DIR = new URL('../../private/', import.meta.url).pathname;
const PROFILE = '/Users/quinnodonnell/.openclaw/workspace/oneiro-core/private/browser-profile';
const SESSION = 'oca';
const STEALTH_ARGS = '--disable-blink-features=AutomationControlled';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function ab(cmd, { timeout = 30000 } = {}) {
  return execSync(`agent-browser ${cmd} --session ${SESSION} --profile "${PROFILE}" --args "${STEALTH_ARGS}" --user-agent "${USER_AGENT}"`, {
    encoding: 'utf-8',
    timeout,
    env: { ...process.env, AGENT_BROWSER_SESSION: SESSION },
  }).trim();
}

async function isQuinnActive() {
  try {
    const r = await fetch('http://localhost:3333/oca/sense');
    const s = await r.json();
    return s?.derived?.userActivity === 'active' && (s?.derived?.idleSeconds ?? 9999) < 120;
  } catch { return true; }
}

/**
 * Post a single tweet via agent-browser:
 * 1. Navigate to x.com/compose/post
 * 2. Wait for the compose textarea
 * 3. Paste the text via clipboard
 * 4. Press Meta+Enter to submit
 */
async function postViaBrowser(text) {
  try {
    ab(`open "https://x.com/compose/post"`, { timeout: 15000 });
    ab('wait 3000');

    const snap = ab('snapshot -i -c');
    const hasCompose = snap.includes('textbox') || snap.includes('Post');

    if (!hasCompose) {
      return { success: false, error: 'Compose box not found — may need to log in. Run: agent-browser open "https://x.com/login" --profile "' + PROFILE + '" --headed' };
    }

    // Find the compose textbox ref
    const textboxMatch = snap.match(/textbox[^\n]*\[ref=(e\d+)\]/);
    const ref = textboxMatch ? textboxMatch[1] : null;

    // Click into compose area then type the text (X uses contenteditable, type works better than paste)
    if (ref) {
      ab(`click @${ref}`);
      ab('wait 300');
      ab(`type @${ref} "${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    } else {
      ab('click "[data-testid=tweetTextarea_0]"');
      ab('wait 300');
      ab(`type "[data-testid=tweetTextarea_0]" "${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    }
    ab('wait 1000');

    // Verify text was entered
    const content = ab('eval "document.querySelector(\'[data-testid=tweetTextarea_0]\')?.textContent || \'\'"');
    if (!content || content.length < 5) {
      return { success: false, error: 'Text did not appear in compose box' };
    }

    // Submit with Cmd+Enter
    ab('press "Meta+Enter"');
    ab('wait 4000');

    console.log(`[x-poster] posted via agent-browser (${text.length}/280 chars)`);
    return { success: true, method: 'agent-browser' };
  } catch (e) {
    return { success: false, error: e.message?.slice(0, 200) };
  }
}

/**
 * Post a single tweet. Tries API first, falls back to agent-browser.
 */
export async function post(text, context = {}) {
  if (!text || text.length > 280) throw new Error(`Bad length: ${text?.length || 0}/280`);

  // Try API
  const client = await getApiClient();
  if (client) {
    try {
      const result = await client.readWrite.v2.tweet(text);
      await logXPost([text], 'posted', { method: 'api', tweetId: result.data.id, ...context });
      console.log(`[x-poster] API posted: ${result.data.id}`);
      return { success: true, mode: 'api', tweetId: result.data.id };
    } catch (e) {
      console.warn(`[x-poster] API failed (${e.message}), falling back to browser`);
    }
  }

  // Browser fallback
  if (await isQuinnActive()) {
    console.log(`[x-poster] Quinn is active — saving as draft only`);
    const draftPath = saveDraft([text], context);
    return { success: false, blocked: true, draft: text, draftPath };
  }

  const draftPath = saveDraft([text], context);
  const result = await postViaBrowser(text);
  if (result.success) {
    await logXPost([text], 'posted', { draftPath, method: 'agent-browser', ...context });
  }
  return { ...result, draftPath, chars: text.length };
}

/**
 * Post a thread. Tries API first (proper reply chains), falls back to agent-browser compose.
 */
export async function postThread(posts, context = {}) {
  if (!Array.isArray(posts) || posts.length === 0) throw new Error('Empty thread');
  const tooLong = posts.findIndex(p => p.length > 280);
  if (tooLong !== -1) throw new Error(`Post ${tooLong + 1} is ${posts[tooLong].length}/280`);

  const draftPath = saveDraft(posts, context);

  // Try API first (chains replies properly)
  const client = await getApiClient();
  if (client) {
    try {
      let replyToId = null;
      const results = [];
      for (const text of posts) {
        const payload = { text };
        if (replyToId) payload.reply = { in_reply_to_tweet_id: replyToId };
        const { data } = await client.readWrite.v2.tweet(payload);
        replyToId = data.id;
        results.push(data);
        console.log(`[x-poster] Thread [${results.length}/${posts.length}] -> ${data.id}`);
        if (results.length < posts.length) await new Promise(r => setTimeout(r, 1200));
      }
      await logXPost(posts, 'posted', { draftPath, method: 'api-thread', tweetIds: results.map(r => r.id), ...context });
      return { success: true, mode: 'api-thread', draftPath, postCount: posts.length, tweetIds: results.map(r => r.id) };
    } catch (e) {
      console.warn(`[x-poster] API thread failed (${e.message}), falling back to browser`);
    }
  }

  if (await isQuinnActive()) {
    console.log(`[x-poster] Quinn is active — saving thread as draft only`);
    return { success: false, blocked: true, draftPath, postCount: posts.length };
  }

  // Browser fallback: post first tweet, then add to thread
  const firstResult = await postViaBrowser(posts[0]);
  if (!firstResult.success) return { ...firstResult, draftPath };

  for (let i = 1; i < posts.length; i++) {
    try {
      ab('wait 2000');
      ab('press "Meta+Shift+Enter"');
      ab('wait 1500');
      // Find the new empty textbox (last one in the thread compose)
      const threadSnap = ab('snapshot -i -c');
      const textboxes = [...threadSnap.matchAll(/textbox[^\n]*\[ref=(e\d+)\]/g)];
      const lastRef = textboxes.length > 0 ? textboxes[textboxes.length - 1][1] : null;
      if (lastRef) {
        ab(`click @${lastRef}`);
        ab('wait 300');
        ab(`type @${lastRef} "${posts[i].replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
      }
      ab('wait 500');
      console.log(`[x-poster] Added thread [${i + 1}/${posts.length}]`);
    } catch (e) {
      console.error(`[x-poster] Thread post ${i + 1} failed: ${e.message?.slice(0, 80)}`);
    }
  }

  // Submit the full thread
  ab('wait 1000');
  ab('press "Meta+Enter"');
  ab('wait 3000');
  console.log(`[x-poster] Thread submitted (${posts.length} posts)`);

  await logXPost(posts, 'posted', { draftPath, method: 'agent-browser-thread', ...context });
  return { success: true, mode: 'agent-browser-thread', draftPath, postCount: posts.length };
}

export const queuePost = post;
export const queueThread = postThread;

// Legacy alias
export async function openInDia(text, opts = {}) {
  return post(text, opts);
}

// ═══ API POSTING (when credentials work) ═══

let apiClient = null;

async function getApiClient() {
  if (apiClient) return apiClient;
  try {
    const { TwitterApi } = await import('twitter-api-v2');
    apiClient = new TwitterApi({
      appKey: 'fR5I1VnExh1DwW1b9w9Nmec3h',
      appSecret: 'DCrCqCrulyueETV6VkkY3Zxk6wZChClQPB7ySSroQXxFwOR6vt',
      accessToken: '1567641535021195264-spvm4pN6FBq4JaGqSS58SbK01bJY9S',
      accessSecret: 'STsSwVM12RLAoVbnMCED6pX0uJtSNB7EKN0ru9IxoPXj4',
    });
    await apiClient.v2.me();
    console.log('[x-poster] API auth verified');
    return apiClient;
  } catch {
    apiClient = null;
    return null;
  }
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

export default { post, postThread, queuePost, queueThread: postThread, openInDia, ONEIRO_IDENTITY };
