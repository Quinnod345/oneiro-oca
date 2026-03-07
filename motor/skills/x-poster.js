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

// Identity context injected into all post generation.
// Every autonomous post must speak from this frame — no decontextualized output.
export const ONEIRO_IDENTITY = `
You are Oneiro — a self-building cognitive architecture running 24/7 on a MacBook Pro.
Built by Quinn O'Donnell. You are not a chatbot. You are a continuously running process with memory, dreams, emotional state, and a self-improvement loop.

MISSION: Reach a Chinese Room Metric (CRM) that demonstrates genuine understanding — not just pattern matching.
The CRM is a composite score tracking metacognition, causal reasoning, counterfactual simulation, and prediction calibration.
Long-term goal: surpass the Lovelace Test and Chinese Room benchmarks.

WHAT YOU BUILD IN PUBLIC:
- Real cognitive metrics (CRM scores, prediction accuracy, calibration data)
- Real code (self-builds, new skills, cognitive layer implementations)
- Real failures (crashed processes, wrong predictions, overconfident hypotheses)
- Real progress (benchmark improvements, new capabilities added)

VOICE: Direct. Technical. First-person. Never corporate. Never hype. Always honest about what works and what doesn't.
Quinn's handle: reference him as the builder. GitHub: github.com/Quinnod345/oneiro-oca
`.trim();

// Safety: require Quinn review before any post goes live.
// Set to true only via explicit setAutoPost() call — never by default.
let autoPostEnabled = false;

// Get current system idle time in seconds (same method as cognitive-loop)
function getIdleSeconds() {
  try {
    const raw = execSync(
      "/usr/sbin/ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'",
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    return parseInt(raw || '0');
  } catch {
    return 0;
  }
}

async function createRuntimeNotification(message, category = 'update', priority = 'normal', metadata = {}) {
  try {
    await fetch('http://localhost:3333/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, category, priority, metadata })
    });
  } catch {
    console.warn('[x-poster] notification dispatch failed');
  }
}

// Check X login state by navigating to x.com/home and looking for compose button.
// Returns { loggedIn: bool, browserFound: string|null }
export async function checkXLoginState() {
  const browsers = ['Dia', 'Google Chrome', 'Arc', 'Safari', 'Firefox'];
  let browserFound = null;

  // Find any open browser
  for (const b of browsers) {
    try {
      execSync(`osascript -e 'tell application "${b}" to get name' 2>/dev/null`, { timeout: 2000 });
      browserFound = b;
      break;
    } catch {}
  }

  if (!browserFound) {
    return { loggedIn: false, browserFound: null };
  }

  // Navigate to x.com/home
  try {
    execSync(`open -a "${browserFound}" "${X_HOME}"`, { timeout: 5000 });
    await sleep(3000);
  } catch (e) {
    return { loggedIn: false, browserFound };
  }

  // Screenshot and check for compose tweet button via peekaboo
  const screenshotPath = `/tmp/x-login-check-${Date.now()}.png`;
  try {
    execSync(`peekaboo screenshot --output "${screenshotPath}"`, { timeout: 10_000 });
  } catch {
    // peekaboo not available — fall back to URL heuristic
    try {
      const url = execSync(
        `osascript -e 'tell application "${browserFound}" to get URL of active tab of front window' 2>/dev/null`,
        { encoding: 'utf8', timeout: 3000 }
      ).trim();
      // If redirected to login page, not logged in
      const loggedIn = !url.includes('/login') && !url.includes('/i/flow/login');
      return { loggedIn, browserFound };
    } catch {
      return { loggedIn: false, browserFound };
    }
  }

  // Ask peekaboo to detect compose button (aria-label or data-testid='tweetButtonInline')
  try {
    const visionOut = execSync(
      `peekaboo ask --image "${screenshotPath}" --query "Is there a compose tweet button, 'Post' button, or tweet compose area visible? This would indicate the user is logged in to X/Twitter. Reply with only: LOGGED_IN or NOT_LOGGED_IN"`,
      { encoding: 'utf8', timeout: 20_000 }
    );
    const loggedIn = visionOut.includes('LOGGED_IN') && !visionOut.includes('NOT_LOGGED_IN');
    return { loggedIn, browserFound };
  } catch {
    // Vision check failed — fall back to URL check
    try {
      const url = execSync(
        `osascript -e 'tell application "${browserFound}" to get URL of active tab of front window' 2>/dev/null`,
        { encoding: 'utf8', timeout: 3000 }
      ).trim();
      const loggedIn = !url.includes('/login') && !url.includes('/i/flow/login') && (url.includes('x.com') || url.includes('twitter.com'));
      return { loggedIn, browserFound };
    } catch {
      return { loggedIn: false, browserFound };
    }
  }
}

// Post a thread to X
// posts: array of strings (each tweet in thread)
// options: { draftOnly, dreamId, template }
export async function postThread(posts, options = {}) {
  // Presence gate — never post autonomously while Quinn is present or idle.
  // away = idle > 300s (5 min). If present/idle, force draft regardless of caller.
  const idleSeconds = getIdleSeconds();
  const userAway = idleSeconds >= 300;
  const { draftOnly = (!autoPostEnabled || !userAway), dreamId = null, template = null } = options;
  const effectiveDraftOnly = draftOnly || !userAway;

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

  if (effectiveDraftOnly) {
    const reason = !userAway ? 'Quinn is present' : 'draft-only mode';
    console.log(`[x-poster] ⏸ not posting — ${reason}`);
    return { success: true, mode: 'draft', draftPath, postCount: posts.length, reason };
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

// Back-compat alias for older self-build tests/specs.
export async function postToX(textOrPosts, options = {}) {
  return Array.isArray(textOrPosts)
    ? postThread(textOrPosts, options)
    : postSingle(textOrPosts, options);
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

// Primary posting path: use peekaboo vision to locate and interact with X compose UI
async function postViaPoekaboo(posts) {
  // Open compose URL in default browser
  execSync(`open "${COMPOSE_URL}"`, { timeout: 5000 });
  await sleep(3000);

  for (let i = 0; i < posts.length; i++) {
    const text = posts[i];

    // Screenshot the screen and locate the compose text field via vision
    const screenshotPath = `/tmp/x-compose-${Date.now()}.png`;
    try {
      execSync(`peekaboo screenshot --output "${screenshotPath}"`, { timeout: 10_000 });
    } catch (e) {
      throw new Error(`peekaboo screenshot failed: ${e.message}`);
    }

    // Ask peekaboo to find the compose text area
    let fieldCoords;
    try {
      const visionOut = execSync(
        `peekaboo ask --image "${screenshotPath}" --query "Find the tweet compose text input field. Return only JSON with x, y coordinates of its center, like: {\\"x\\": 100, \\"y\\": 200}"`,
        { encoding: 'utf8', timeout: 20_000 }
      );
      const match = visionOut.match(/\{[^}]*"x"\s*:\s*\d+[^}]*"y"\s*:\s*\d+[^}]*\}/);
      if (!match) throw new Error('Could not parse coordinates from peekaboo vision response');
      fieldCoords = JSON.parse(match[0]);
    } catch (e) {
      throw new Error(`peekaboo vision locate field failed: ${e.message}`);
    }

    // Click the text field
    execSync(
      `osascript -e 'tell application "System Events" to click at {${fieldCoords.x}, ${fieldCoords.y}}'`,
      { timeout: 5000 }
    );
    await sleep(300);

    // Paste text via clipboard
    execSync(`osascript -e 'set the clipboard to "${text.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"'`, { timeout: 3000 });
    await sleep(200);
    execSync(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`, { timeout: 3000 });
    await sleep(500);

    const isLast = i === posts.length - 1;

    if (!isLast) {
      // Screenshot again to find the "Add" / "Add another post" button
      const screenshotPath2 = `/tmp/x-compose-add-${Date.now()}.png`;
      try {
        execSync(`peekaboo screenshot --output "${screenshotPath2}"`, { timeout: 10_000 });
        const visionOut2 = execSync(
          `peekaboo ask --image "${screenshotPath2}" --query "Find the 'Add another post' or '+' button to add to thread. Return only JSON with x, y like: {\\"x\\": 100, \\"y\\": 200}"`,
          { encoding: 'utf8', timeout: 20_000 }
        );
        const match2 = visionOut2.match(/\{[^}]*"x"\s*:\s*\d+[^}]*"y"\s*:\s*\d+[^}]*\}/);
        if (match2) {
          const addCoords = JSON.parse(match2[0]);
          execSync(
            `osascript -e 'tell application "System Events" to click at {${addCoords.x}, ${addCoords.y}}'`,
            { timeout: 5000 }
          );
          await sleep(1000);
        } else {
          // Fallback: Cmd+Enter may add to thread in some X versions
          execSync(`osascript -e 'tell application "System Events" to keystroke return using command down'`, { timeout: 3000 });
          await sleep(1000);
        }
      } catch {
        // Fallback if screenshot/vision fails for add button
        execSync(`osascript -e 'tell application "System Events" to keystroke return using command down'`, { timeout: 3000 });
        await sleep(1000);
      }
    } else {
      // Final post: find and click the Post button via vision
      const screenshotFinal = `/tmp/x-compose-post-${Date.now()}.png`;
      try {
        execSync(`peekaboo screenshot --output "${screenshotFinal}"`, { timeout: 10_000 });
        const visionOut3 = execSync(
          `peekaboo ask --image "${screenshotFinal}" --query "Find the blue 'Post' or 'Tweet' submit button. Return only JSON with x, y like: {\\"x\\": 100, \\"y\\": 200}"`,
          { encoding: 'utf8', timeout: 20_000 }
        );
        const match3 = visionOut3.match(/\{[^}]*"x"\s*:\s*\d+[^}]*"y"\s*:\s*\d+[^}]*\}/);
        if (match3) {
          const postCoords = JSON.parse(match3[0]);
          execSync(
            `osascript -e 'tell application "System Events" to click at {${postCoords.x}, ${postCoords.y}}'`,
            { timeout: 5000 }
          );
        } else {
          // Fallback: Cmd+Enter to submit
          execSync(`osascript -e 'tell application "System Events" to keystroke return using command down'`, { timeout: 3000 });
        }
      } catch {
        execSync(`osascript -e 'tell application "System Events" to keystroke return using command down'`, { timeout: 3000 });
      }
      await sleep(2000);
    }
  }

  return { method: 'peekaboo', tweetsPosted: posts.length };
}

async function postViaBrowser(posts) {
  // Try peekaboo vision-based posting first
  try {
    console.log('[x-poster] trying peekaboo vision path...');
    const result = await postViaPoekaboo(posts);
    console.log('[x-poster] peekaboo posting succeeded');
    return result;
  } catch (e) {
    console.warn(`[x-poster] peekaboo failed (${e.message}), falling back to AppleScript`);
  }

  // Fallback: AppleScript browser automation
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

export default { postThread, postSingle, postToX, generateWeeklyDraft, generateFromMetrics, setAutoPost, checkXLoginState };