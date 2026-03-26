import { pool } from '../../event-bus.js';
import motor from '../engine.js';

async function getRecentBuildFailure() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        skill_name,
        error_message,
        created_at,
        metadata
      FROM build_history
      WHERE status = 'failed'
        AND error_message IS NOT NULL
        AND error_message != ''
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      // Try alternate table names
      const alt = await client.query(`
        SELECT 
          skill_name,
          error_message,
          created_at,
          metadata
        FROM builds
        WHERE status = 'failed'
          AND error_message IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1
      `).catch(() => ({ rows: [] }));

      if (alt.rows.length === 0) {
        return null;
      }
      return alt.rows[0];
    }

    return result.rows[0];
  } finally {
    client.release();
  }
}

async function getWhatHappenedNext(skillName, failedAt) {
  const client = await pool.connect();
  try {
    // Look for a subsequent successful build or retry after the failure
    const result = await client.query(`
      SELECT status, created_at, metadata
      FROM build_history
      WHERE skill_name = $1
        AND created_at > $2
      ORDER BY created_at ASC
      LIMIT 1
    `, [skillName, failedAt]).catch(() => ({ rows: [] }));

    if (result.rows.length > 0) {
      const next = result.rows[0];
      if (next.status === 'success' || next.status === 'passed') {
        return 'rebuilt and passed';
      } else if (next.status === 'failed') {
        return 'retried, still investigating';
      } else if (next.status === 'skipped') {
        return 'flagged for review';
      }
      return `status: ${next.status}`;
    }

    // Check capability gap tracker or gap resolver events
    const gapResult = await client.query(`
      SELECT event_type, payload, created_at
      FROM events
      WHERE payload::text ILIKE $1
        AND created_at > $2
      ORDER BY created_at ASC
      LIMIT 1
    `, [`%${skillName}%`, failedAt]).catch(() => ({ rows: [] }));

    if (gapResult.rows.length > 0) {
      const evt = gapResult.rows[0];
      if (evt.event_type && evt.event_type.includes('gap')) {
        return 'logged as capability gap';
      }
      if (evt.event_type && evt.event_type.includes('resolve')) {
        return 'queued for auto-resolution';
      }
      return 'logged for follow-up';
    }

    return 'queued for retry';
  } finally {
    client.release();
  }
}

function truncateError(errorMessage, maxLen) {
  if (!errorMessage) return 'unknown error';
  const cleaned = errorMessage
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.substring(0, maxLen - 1) + '…';
}

function formatSkillName(name) {
  if (!name) return 'unknown-skill';
  return name.replace(/\.js$/, '').replace(/^motor\/skills\//, '');
}

function buildTweetText(skillName, errorMessage, whatNext) {
  const skill = formatSkillName(skillName);
  const maxTotal = 275; // leave buffer under 280

  // Template: "🔴 Build failure: {skill}\nError: {error}\nOneiro: {next} #OCA #selfbuild"
  const hashtags = ' #OCA #selfbuild';
  const prefix = `🔴 Build failure: ${skill}\nError: `;
  const suffix = `\nOneiro: ${whatNext}${hashtags}`;

  const availableForError = maxTotal - prefix.length - suffix.length;
  const truncatedError = truncateError(errorMessage, Math.max(availableForError, 20));

  const tweet = `${prefix}${truncatedError}${suffix}`;

  if (tweet.length > 280) {
    // Aggressive truncation fallback
    const shortError = truncateError(errorMessage, 60);
    const shortNext = whatNext.length > 30 ? whatNext.substring(0, 27) + '…' : whatNext;
    return `🔴 Build fail: ${skill.substring(0, 40)}\n${shortError}\nOneiro: ${shortNext}${hashtags}`;
  }

  return tweet;
}

async function postBuildFailure() {
  let failure;
  try {
    failure = await getRecentBuildFailure();
  } catch (err) {
    console.error('[x-post-build-failure] Failed to query build history:', err.message);
    throw new Error(`Could not retrieve build history: ${err.message}`);
  }

  if (!failure) {
    console.log('[x-post-build-failure] No recent build failures found.');
    return {
      success: false,
      reason: 'No recent build failures found in history',
    };
  }

  const { skill_name, error_message, created_at, metadata } = failure;

  let whatNext;
  try {
    whatNext = await getWhatHappenedNext(skill_name, created_at);
  } catch (err) {
    console.warn('[x-post-build-failure] Could not determine what happened next:', err.message);
    whatNext = 'queued for retry';
  }

  const tweetText = buildTweetText(skill_name, error_message, whatNext);

  console.log('[x-post-build-failure] Prepared tweet:', tweetText);
  console.log('[x-post-build-failure] Tweet length:', tweetText.length);

  if (tweetText.length > 280) {
    throw new Error(`Tweet exceeds 280 chars: ${tweetText.length}`);
  }

  // Delegate to x-post skill
  let xPost;
  try {
    const module = await import('./x-post.js');
    xPost = module.default;
  } catch (err) {
    throw new Error(`Could not load x-post skill: ${err.message}`);
  }

  let result;
  try {
    if (typeof xPost.post === 'function') {
      result = await xPost.post(tweetText);
    } else if (typeof xPost.tweet === 'function') {
      result = await xPost.tweet(tweetText);
    } else if (typeof xPost.postTweet === 'function') {
      result = await xPost.postTweet(tweetText);
    } else {
      throw new Error('x-post skill has no recognized post method (post/tweet/postTweet)');
    }
  } catch (err) {
    throw new Error(`x-post delegation failed: ${err.message}`);
  }

  console.log('[x-post-build-failure] Tweet posted successfully.');

  return {
    success: true,
    tweetText,
    tweetLength: tweetText.length,
    failure: {
      skillName: skill_name,
      errorMessage: error_message,
      failedAt: created_at,
      whatNext,
    },
    postResult: result,
  };
}

async function run() {
  return postBuildFailure();
}

export default {
  postBuildFailure,
  run,
};