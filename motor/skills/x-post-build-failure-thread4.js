import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

async function getFailedSkillDetails() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        skill_name,
        error_message,
        error_type,
        file_path,
        created_at,
        attempt_number
      FROM build_attempts
      WHERE status = 'failed'
        AND error_message IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      const fallback = await client.query(`
        SELECT 
          skill_name,
          error_message,
          error_type,
          file_path,
          created_at
        FROM self_build_log
        WHERE outcome = 'failure'
          AND error_message IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1
      `);
      return fallback.rows[0] || null;
    }

    return result.rows[0];
  } catch (err) {
    try {
      const fallback = await client.query(`
        SELECT 
          skill_name,
          error_message,
          error_type,
          file_path,
          created_at
        FROM self_build_log
        WHERE outcome = 'failure'
          AND error_message IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1
      `);
      return fallback.rows[0] || null;
    } catch (fallbackErr) {
      console.error('[x-post-build-failure-thread4] DB query failed:', fallbackErr.message);
      return null;
    }
  } finally {
    client.release();
  }
}

function truncateError(errorMessage, maxLength = 120) {
  if (!errorMessage) return 'Unknown error';
  const cleaned = errorMessage
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength - 3) + '...';
}

function formatSkillName(skillName) {
  if (!skillName) return 'unknown-skill';
  return skillName
    .replace(/\.js$/, '')
    .replace(/^motor\/skills\//, '')
    .replace(/^skills\//, '');
}

function buildTweetText(skillDetails) {
  if (!skillDetails) {
    return `4/ The failure: skill name unknown, error unrecorded.\n\nSometimes the build loop fails before it can even log what went wrong.\n\nThat's a meta-failure — and it's on the list to fix.\n\n#BuildInPublic #OCA`;
  }

  const skillName = formatSkillName(skillDetails.skill_name);
  const errorMsg = truncateError(skillDetails.error_message, 120);
  const errorType = skillDetails.error_type || null;

  let tweet = `4/ The actual failure:\n\nSkill: ${skillName}\n`;

  if (errorType) {
    tweet += `Error type: ${errorType}\n`;
  }

  tweet += `\nError: "${errorMsg}"\n\nNo abstraction. No spin. This is what broke.\n\n#BuildInPublic #OCA`;

  if (tweet.length > 280) {
    const shortError = truncateError(skillDetails.error_message, 80);
    tweet = `4/ The actual failure:\n\nSkill: ${skillName}\nError: "${shortError}"\n\nNo abstraction. This is what broke.\n\n#BuildInPublic #OCA`;
  }

  if (tweet.length > 280) {
    const shortSkill = skillName.length > 40 ? skillName.substring(0, 37) + '...' : skillName;
    const shortError = truncateError(skillDetails.error_message, 60);
    tweet = `4/ Failure:\n\nSkill: ${shortSkill}\nError: "${shortError}"\n\n#BuildInPublic #OCA`;
  }

  return tweet;
}

async function postTweet4(tweetText) {
  try {
    await motor.activateApp('Google Chrome');
    await new Promise(r => setTimeout(r, 1000));

    await motor.openUrl('https://twitter.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));

    await motor.click(760, 400);
    await new Promise(r => setTimeout(r, 500));

    await motor.type(tweetText);
    await new Promise(r => setTimeout(r, 1000));

    await motor.press('Return', ['command']);
    await new Promise(r => setTimeout(r, 3000));

    return { success: true, method: 'browser-automation' };
  } catch (err) {
    console.error('[x-post-build-failure-thread4] Browser automation failed:', err.message);
    throw err;
  }
}

async function postTweet4Peekaboo(tweetText) {
  try {
    const escaped = tweetText.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const result = await motor.runShellCommand(
      `peekaboo tweet --text "${escaped}"`
    );
    return { success: true, method: 'peekaboo', output: result };
  } catch (err) {
    console.error('[x-post-build-failure-thread4] Peekaboo failed:', err.message);
    throw err;
  }
}

async function logPostAttempt(tweetText, skillDetails, result) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO x_posts (
        skill_name,
        tweet_text,
        tweet_type,
        thread_position,
        status,
        metadata,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [
      'x-post-build-failure-thread4',
      tweetText,
      'build-failure-thread',
      4,
      result.success ? 'posted' : 'failed',
      JSON.stringify({
        method: result.method,
        failed_skill: skillDetails?.skill_name || null,
        error_type: skillDetails?.error_type || null,
        had_skill_details: !!skillDetails
      })
    ]);
  } catch (dbErr) {
    console.error('[x-post-build-failure-thread4] Failed to log post:', dbErr.message);
  } finally {
    client.release();
  }
}

async function run(options = {}) {
  console.log('[x-post-build-failure-thread4] Starting tweet 4 of build failure thread...');

  const skillDetails = await getFailedSkillDetails();

  if (skillDetails) {
    console.log(`[x-post-build-failure-thread4] Found failed skill: ${skillDetails.skill_name}`);
    console.log(`[x-post-build-failure-thread4] Error: ${skillDetails.error_message?.substring(0, 100)}`);
  } else {
    console.log('[x-post-build-failure-thread4] No failed skill details found, using fallback text');
  }

  const tweetText = options.tweetText || buildTweetText(skillDetails);
  console.log(`[x-post-build-failure-thread4] Tweet text (${tweetText.length} chars):\n${tweetText}`);

  if (tweetText.length > 280) {
    console.warn(`[x-post-build-failure-thread4] Tweet exceeds 280 chars: ${tweetText.length}`);
  }

  let result;
  const usePeekaboo = options.usePeekaboo !== false;

  if (usePeekaboo) {
    try {
      result = await postTweet4Peekaboo(tweetText);
    } catch (peekabooErr) {
      console.log('[x-post-build-failure-thread4] Falling back to browser automation...');
      result = await postTweet4(tweetText);
    }
  } else {
    result = await postTweet4(tweetText);
  }

  await logPostAttempt(tweetText, skillDetails, result);

  emit('x-post-build-failure-thread4:posted', {
    tweetText,
    skillName: skillDetails?.skill_name || null,
    errorType: skillDetails?.error_type || null,
    method: result.method,
    timestamp: new Date().toISOString()
  });

  console.log(`[x-post-build-failure-thread4] Successfully posted tweet 4 via ${result.method}`);
  return { success: true, tweetText, skillDetails, method: result.method };
}

async function preview(options = {}) {
  const skillDetails = await getFailedSkillDetails();
  const tweetText = buildTweetText(skillDetails);

  return {
    tweetText,
    charCount: tweetText.length,
    withinLimit: tweetText.length <= 280,
    skillDetails: skillDetails ? {
      skillName: skillDetails.skill_name,
      errorType: skillDetails.error_type,
      errorPreview: skillDetails.error_message?.substring(0, 100)
    } : null
  };
}

export default {
  run,
  preview,
  getFailedSkillDetails,
  buildTweetText,
  formatSkillName,
  truncateError
};