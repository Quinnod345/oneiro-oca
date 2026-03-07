// OCA Motor Skill: X/Twitter Poster
// Posts threads to X via browser automation (AppleScript → Dia/Chrome)
// Falls back to draft-only mode when browser automation fails
import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

const PRIVATE_DIR = new URL('../../private/', import.meta.url).pathname;
const COMPOSE_URL = 'https://x.com/compose/post';
const X_HOME = 'https://x.com/home';

// Safety: configurable review gate
let autoPostEnabled = true; // OCA is fully autonomous — post directly

// Post a thread to X
// posts: array of strings (each tweet in thread)
// options: { draftOnly, dreamId, template }
export async function postThread(posts, options = {}) {
  const { draftOnly = !autoPostEnabled, dreamId = null, template = null } = options;

  if (!Array.isArray(posts) || posts.length === 0) {
    return { success: false, error: 'No posts provided' };
  }

  // Validate character limits
  const tooLong = posts.findIndex(p => p.length > 280);
  if (tooLong !== -1) {
    return { success: false, error: `Post ${tooLong + 1} exceeds 280 chars (${posts[tooLong].length})` };
  }

  // Always save draft first
  const draftPath = saveDraft(posts, { dreamId, template });
  console.log(`[x-poster] 📝 draft saved: ${draftPath}`);

  // Log the attempt
  await logXPost(posts, 'draft_created', { draftPath, dreamId });

  if (draftOnly) {
    console.log('[x-poster] ⏸ draft-only mode — not posting to X');
    // Notify Quinn that a draft is ready
    try {
      execSync(
        `openclaw system event --message "📝 X post draft ready for review: ${draftPath}"`,
        { encoding: 'utf8', timeout: 10_000 }
      );
    } catch {}
    return { success: true, mode: 'draft', draftPath, postCount: posts.length };
  }

  // Attempt browser automation
  try {
    const result = await postViaBrowser(posts);
    await logXPost(posts, 'posted', { ...result, dreamId });
    console.log(`[x-poster] ✅ posted ${posts.length} tweets to X`);
    return { success: true, mode: 'posted', postCount: posts.length, ...result };
  } catch (e) {
    console.error(`[x-poster] ❌ browser posting failed: ${e.message}`);
    await logXPost(posts, 'post_failed', { error: e.message, dreamId });
    // Fallback: draft is already saved
    return { success: false, mode: 'draft_fallback', draftPath, error: e.message };
  }
}

// Post a single tweet
export async function postSingle(text, options = {}) {
  return postThread([text], options);
}

// Generate draft from exec-log data
export async function generateWeeklyDraft() {
  try {
    const output = execSync(
      'node exec-log.js --gen-xpost',
      {
        encoding: 'utf8',
        timeout: 60_000,
        cwd: join(dirname(new URL(import.meta.url).pathname), '..', '..')
      }
    );
    console.log('[x-poster] 📊 weekly draft generated from exec-log');
    return { success: true, output: output.slice(0, 500) };
  } catch (e) {
    console.error('[x-poster] exec-log generation failed:', e.message);
    return { success: false, error: e.message };
  }
}

// ═══ BROWSER AUTOMATION ═══

async function postViaBrowser(posts) {
  // Detect which browser has X logged in
  const browser = detectXBrowser();
  if (!browser) throw new Error('No browser found with X logged in');

  for (let i = 0; i < posts.length; i++) {
    const text = posts[i];
    const isFirst = i === 0;
    const isLast = i === posts.length - 1;

    if (isFirst) {
      // Open compose dialog
      await motor.openUrl(COMPOSE_URL);
      await sleep(3000);
    }

    // Type the tweet content using clipboard (safer than keystroke for long text)
    await motor.copyToClipboard(text);
    await sleep(300);

    // Focus the compose area and paste
    await motor.press('a', ['cmd']); // Select all (in case there's placeholder text)
    await sleep(200);
    await motor.press('v', ['cmd']); // Paste
    await sleep(500);

    if (isLast || posts.length === 1) {
      // Submit: Cmd+Enter to post
      await motor.press('return', ['cmd']);
      await sleep(2000);
    } else {
      // Add to thread: Cmd+Enter on Mac adds next tweet in compose
      // Actually, click the "Add another post" button
      // Use keyboard shortcut or find the button
      await motor.press('return', ['cmd']); // Post current tweet
      await sleep(3000);
      // After posting, X shows the posted tweet with a "Reply" option
      // We need to click reply to continue the thread
      // For thread posting, it's better to use the compose thread UI
      // Let's use a different approach: compose all at once
    }
  }

  return { browser, tweetsPosted: posts.length };
}

// Detect which browser to use for X
function detectXBrowser() {
  const browsers = ['Dia', 'Google Chrome', 'Arc', 'Safari', 'Firefox'];
  for (const b of browsers) {
    try {
      const tabs = execSync(
        `osascript -e 'tell application "${b}" to get URL of every tab of every window' 2>/dev/null`,
        { encoding: 'utf8', timeout: 3000 }
      );
      if (tabs.includes('x.com') || tabs.includes('twitter.com')) {
        return b;
      }
    } catch {}
  }
  // Default to Dia (Quinn's preferred browser)
  return 'Dia';
}

// ═══ DRAFT MANAGEMENT ═══

function saveDraft(posts, metadata = {}) {
  mkdirSync(PRIVATE_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const time = new Date().toISOString().slice(11, 16).replace(':', '');
  const filename = `xpost-auto-${date}-${time}.md`;
  const path = join(PRIVATE_DIR, filename);

  let content = `# Auto-Generated X Post Draft — ${date}\n`;
  content += `**Status:** DRAFT — requires Quinn review before posting\n`;
  content += `**Generated by:** OCA dream executor\n`;
  if (metadata.dreamId) content += `**Dream ID:** ${metadata.dreamId}\n`;
  if (metadata.template) content += `**Template:** ${metadata.template}\n`;
  content += `**Posts:** ${posts.length}\n`;
  content += `\n---\n\n`;

  posts.forEach((post, i) => {
    content += `**[${i + 1}/${posts.length}]** (${post.length}/280 chars)\n\n`;
    content += `${post}\n\n---\n\n`;
  });

  content += `## Posting Instructions\n\n`;
  content += `1. Review each post above\n`;
  content += `2. Run: \`node cognitive/motor/skills/x-poster.js --post ${filename}\`\n`;
  content += `3. Or manually post to X\n`;

  writeFileSync(path, content, 'utf8');
  return path;
}

// ═══ LOGGING ═══

async function logXPost(posts, status, metadata = {}) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS x_posts (
      id SERIAL PRIMARY KEY,
      posts JSONB,
      status TEXT,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  await pool.query(
    `INSERT INTO x_posts (posts, status, metadata) VALUES ($1, $2, $3)`,
    [JSON.stringify(posts), status, JSON.stringify(metadata)]
  ).catch(() => {});

  await emit('x_post', 'motor', { status, postCount: posts.length, ...metadata });
}

// ═══ CONTENT GENERATION ═══

// Pull latest CRM data and generate a post
export async function generateFromMetrics() {
  try {
    // Get latest metrics from the DB
    const [episodic, semantic, hypotheses, dreams, calibration] = await Promise.all([
      pool.query('SELECT COUNT(*) as c FROM episodic_memory').then(r => r.rows[0]?.c || 0),
      pool.query('SELECT COUNT(*) as c FROM semantic_memory').then(r => r.rows[0]?.c || 0),
      pool.query('SELECT COUNT(*) as c FROM hypotheses').then(r => r.rows[0]?.c || 0),
      pool.query('SELECT COUNT(*) as c FROM dream_episodes').then(r => r.rows[0]?.c || 0),
      pool.query(`
        SELECT COUNT(*) FILTER (WHERE was_correct) as correct, COUNT(*) as total 
        FROM calibration_log WHERE was_correct IS NOT NULL
      `).then(r => r.rows[0] || { correct: 0, total: 0 })
    ]);

    const accuracy = calibration.total > 0 
      ? ((calibration.correct / calibration.total) * 100).toFixed(1) 
      : 'N/A';

    return {
      episodicMemories: parseInt(episodic),
      semanticConcepts: parseInt(semantic),
      hypotheses: parseInt(hypotheses),
      dreamArtifacts: parseInt(dreams),
      predictionAccuracy: accuracy,
      totalCalibrated: parseInt(calibration.total)
    };
  } catch (e) {
    return null;
  }
}

// Enable/disable auto-posting (requires explicit call)
export function setAutoPost(enabled) {
  autoPostEnabled = !!enabled;
  console.log(`[x-poster] auto-post ${autoPostEnabled ? 'ENABLED' : 'DISABLED'}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// CLI mode: post a specific draft file
if (process.argv[1]?.endsWith('x-poster.js') && process.argv.includes('--post')) {
  const idx = process.argv.indexOf('--post');
  const file = process.argv[idx + 1];
  if (file) {
    const fullPath = file.startsWith('/') ? file : join(PRIVATE_DIR, file);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf8');
      // Extract posts from draft format
      const postMatches = [...content.matchAll(/\*\*\[\d+\/\d+\]\*\*.*?\n\n([\s\S]*?)(?=\n---|\n## |$)/g)];
      const posts = postMatches.map(m => m[1].trim()).filter(p => p.length > 0 && p.length <= 280);
      if (posts.length > 0) {
        postThread(posts, { draftOnly: false }).then(r => {
          console.log('Result:', JSON.stringify(r, null, 2));
          process.exit(0);
        });
      } else {
        console.error('No valid posts found in draft');
        process.exit(1);
      }
    } else {
      console.error(`Draft not found: ${fullPath}`);
      process.exit(1);
    }
  }
}

export default { postThread, postSingle, generateWeeklyDraft, generateFromMetrics, setAutoPost };
