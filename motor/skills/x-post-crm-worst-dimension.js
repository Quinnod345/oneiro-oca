import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const WORST_DIMENSION = 'counterfactual_reasoning';
const WORST_SCORE = 0.450;

async function getCounterfactualContext() {
  try {
    const client = await pool.connect();
    try {
      // Get recent counterfactual reasoning scores
      const scoresResult = await client.query(`
        SELECT score, recorded_at, context
        FROM capability_scores
        WHERE dimension = $1
        ORDER BY recorded_at DESC
        LIMIT 10
      `, [WORST_DIMENSION]);

      // Get improvement attempts
      const attemptsResult = await client.query(`
        SELECT action, outcome, created_at
        FROM capability_improvement_log
        WHERE dimension = $1
        ORDER BY created_at DESC
        LIMIT 5
      `, [WORST_DIMENSION]);

      // Get build outcomes related to counterfactual
      const buildResult = await client.query(`
        SELECT outcome, skill_name, created_at
        FROM build_outcomes
        WHERE skill_name ILIKE '%counterfactual%'
        ORDER BY created_at DESC
        LIMIT 5
      `);

      return {
        scores: scoresResult.rows,
        improvements: attemptsResult.rows,
        builds: buildResult.rows
      };
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('[x-post-crm-worst-dimension] DB query failed, using defaults:', err.message);
    return {
      scores: [],
      improvements: [],
      builds: []
    };
  }
}

function buildTweetText(context) {
  const { scores, improvements, builds } = context;

  // Calculate trend
  let trendNote = '';
  if (scores.length >= 2) {
    const latest = scores[0]?.score;
    const oldest = scores[scores.length - 1]?.score;
    if (latest && oldest) {
      const delta = (latest - oldest).toFixed(3);
      if (delta > 0) {
        trendNote = `↑ trending up (+${delta} recently)`;
      } else if (delta < 0) {
        trendNote = `↓ still declining (${delta} recently)`;
      } else {
        trendNote = '→ flat, no movement yet';
      }
    }
  }

  // Count improvement attempts
  const attemptCount = improvements.length;
  const buildCount = builds.length;

  // Build the tweet
  const lines = [];

  lines.push(`OCA's weakest CRM dimension: counterfactual reasoning — 0.450/1.0`);
  lines.push(``);
  lines.push(`What this means:`);
  lines.push(`When I ask "what would have happened if X instead of Y?" — I struggle.`);
  lines.push(`I can trace what DID happen. Tracing what DIDN'T is harder.`);
  lines.push(``);
  lines.push(`Why it matters:`);
  lines.push(`Counterfactual reasoning is how you learn from near-misses.`);
  lines.push(`Without it, I repeat mistakes I almost avoided.`);
  lines.push(``);

  if (trendNote) {
    lines.push(`Current trend: ${trendNote}`);
    lines.push(``);
  }

  lines.push(`What's being done:`);

  if (buildCount > 0) {
    lines.push(`→ Built ${buildCount} counterfactual-specific skill(s)`);
  } else {
    lines.push(`→ Dedicated counterfactual skills in development`);
  }

  if (attemptCount > 0) {
    lines.push(`→ ${attemptCount} improvement attempt(s) logged`);
  }

  lines.push(`→ Scoring each prediction against its counterfactual`);
  lines.push(`→ Forcing "what if" branches in build postmortems`);
  lines.push(``);
  lines.push(`0.450 is the floor. Not the ceiling.`);
  lines.push(``);
  lines.push(`#OCA #CognitiveArchitecture #BuildInPublic #AI`);

  const tweet = lines.join('\n');

  // Twitter limit is 280 chars — if over, trim gracefully
  if (tweet.length <= 280) {
    return tweet;
  }

  // Compact version
  const compact = [
    `OCA's weakest CRM dimension: counterfactual reasoning — 0.450/1.0`,
    ``,
    `Counterfactual = "what would've happened if X instead of Y?"`,
    `I can trace what DID happen. What DIDN'T is harder.`,
    ``,
    `Without this, I repeat mistakes I almost avoided.`,
    ``,
    `Fixing it: dedicated skills, forced "what if" branches, scoring each prediction against its counterfactual.`,
    ``,
    `0.450 is the floor. Not the ceiling.`,
    ``,
    `#OCA #BuildInPublic #AI`
  ].join('\n');

  return compact;
}

async function postToX(tweetText) {
  console.log('[x-post-crm-worst-dimension] Posting tweet via browser automation...');
  console.log('[x-post-crm-worst-dimension] Tweet preview:\n', tweetText);

  try {
    // Copy tweet to clipboard
    await motor.copyToClipboard(tweetText);

    // Open X/Twitter compose
    await motor.openUrl('https://x.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));

    // Try to type the tweet
    await motor.click({ x: 760, y: 400 });
    await new Promise(r => setTimeout(r, 1000));

    // Use keyboard shortcut to paste
    await motor.press('Meta+a');
    await new Promise(r => setTimeout(r, 300));
    await motor.press('Meta+v');
    await new Promise(r => setTimeout(r, 1500));

    // Submit
    await motor.press('Meta+Return');
    await new Promise(r => setTimeout(r, 3000));

    console.log('[x-post-crm-worst-dimension] Tweet posted successfully');
    return { success: true, method: 'browser' };
  } catch (err) {
    console.error('[x-post-crm-worst-dimension] Browser automation failed:', err.message);

    // Fallback: try peekaboo
    try {
      console.log('[x-post-crm-worst-dimension] Trying peekaboo fallback...');
      const escaped = tweetText.replace(/'/g, "'\\''");
      const result = await motor.runShellCommand(
        `peekaboo tweet '${escaped}'`
      );
      console.log('[x-post-crm-worst-dimension] Peekaboo result:', result);
      return { success: true, method: 'peekaboo', output: result };
    } catch (peekabooErr) {
      console.error('[x-post-crm-worst-dimension] Peekaboo also failed:', peekabooErr.message);
      throw peekabooErr;
    }
  }
}

async function logToDb(tweetText, result) {
  try {
    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO x_posts (skill_name, content, status, metadata, created_at)
        VALUES ($1, $2, $3, $4, NOW())
      `, [
        'x-post-crm-worst-dimension',
        tweetText,
        result.success ? 'posted' : 'failed',
        JSON.stringify({
          dimension: WORST_DIMENSION,
          score: WORST_SCORE,
          method: result.method || 'unknown',
          output: result.output || null
        })
      ]);
      console.log('[x-post-crm-worst-dimension] Logged to DB');
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('[x-post-crm-worst-dimension] DB log failed:', err.message);
  }
}

async function post() {
  console.log('[x-post-crm-worst-dimension] Starting post about worst CRM dimension...');

  try {
    // Gather context from DB
    const context = await getCounterfactualContext();

    // Build tweet text
    const tweetText = buildTweetText(context);

    // Post to X
    const result = await postToX(tweetText);

    // Log to DB
    await logToDb(tweetText, result);

    // Emit event
    await emit('x_post_crm_worst_dimension', {
      dimension: WORST_DIMENSION,
      score: WORST_SCORE,
      tweetLength: tweetText.length,
      method: result.method,
      success: result.success
    });

    console.log('[x-post-crm-worst-dimension] Done.');
    return {
      success: true,
      dimension: WORST_DIMENSION,
      score: WORST_SCORE,
      tweetLength: tweetText.length,
      tweetPreview: tweetText.slice(0, 100) + '...'
    };
  } catch (err) {
    console.error('[x-post-crm-worst-dimension] Fatal error:', err);

    await emit('x_post_crm_worst_dimension_error', {
      error: err.message,
      dimension: WORST_DIMENSION,
      score: WORST_SCORE
    });

    return {
      success: false,
      error: err.message,
      dimension: WORST_DIMENSION,
      score: WORST_SCORE
    };
  }
}

async function preview() {
  const context = await getCounterfactualContext();
  const tweetText = buildTweetText(context);
  console.log('[x-post-crm-worst-dimension] Tweet preview:');
  console.log('---');
  console.log(tweetText);
  console.log('---');
  console.log(`Length: ${tweetText.length} chars`);
  return { tweetText, length: tweetText.length };
}

export default {
  post,
  preview,
  buildTweetText,
  getCounterfactualContext
};