import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

async function getBuildData() {
  const client = await pool.connect();
  try {
    const totalResult = await client.query(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as successes,
             SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) as failures
      FROM build_outcomes
    `);

    const recentResult = await client.query(`
      SELECT outcome, skill_name, error_message, created_at
      FROM build_outcomes
      ORDER BY created_at DESC
      LIMIT 10
    `);

    const streakResult = await client.query(`
      SELECT outcome
      FROM build_outcomes
      ORDER BY created_at DESC
      LIMIT 20
    `);

    const hourlyResult = await client.query(`
      SELECT 
        DATE_TRUNC('hour', created_at) as hour,
        COUNT(*) as total,
        SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as successes
      FROM build_outcomes
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY DATE_TRUNC('hour', created_at)
      ORDER BY hour DESC
      LIMIT 6
    `);

    const total = parseInt(totalResult.rows[0]?.total || 0);
    const successes = parseInt(totalResult.rows[0]?.successes || 0);
    const failures = parseInt(totalResult.rows[0]?.failures || 0);
    const successRate = total > 0 ? ((successes / total) * 100).toFixed(1) : '0.0';

    const recentOutcomes = recentResult.rows;
    const streakOutcomes = streakResult.rows.map(r => r.outcome);

    let currentStreak = 0;
    let streakType = streakOutcomes[0] || 'unknown';
    for (const outcome of streakOutcomes) {
      if (outcome === streakType) {
        currentStreak++;
      } else {
        break;
      }
    }

    const hourlyData = hourlyResult.rows;

    return {
      total,
      successes,
      failures,
      successRate,
      recentOutcomes,
      currentStreak,
      streakType,
      hourlyData
    };
  } finally {
    client.release();
  }
}

function buildTweetText(data) {
  const { total, successes, failures, successRate, recentOutcomes, currentStreak, streakType, hourlyData } = data;

  const recentEmojis = recentOutcomes.slice(0, 8).map(r => r.outcome === 'success' ? '✅' : '❌').join('');

  const streakEmoji = streakType === 'success' ? '🔥' : '💀';
  const streakLabel = streakType === 'success' ? 'success streak' : 'failure streak';

  let hourlyLine = '';
  if (hourlyData.length > 0) {
    const latestHour = hourlyData[0];
    const hourTotal = parseInt(latestHour.total);
    const hourSuccesses = parseInt(latestHour.successes);
    const hourRate = hourTotal > 0 ? ((hourSuccesses / hourTotal) * 100).toFixed(0) : '0';
    hourlyLine = `\nLast hour: ${hourSuccesses}/${hourTotal} (${hourRate}% pass rate)`;
  }

  const tweet = `3/ Real build data, no filter:

📊 All-time: ${total} builds
✅ ${successes} passed (${successRate}%)
❌ ${failures} failed

Recent: ${recentEmojis}

${streakEmoji} Current ${streakLabel}: ${currentStreak}${hourlyLine}

This is what self-modification looks like in practice.`;

  return tweet;
}

async function findLatestThreadTweet() {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT tweet_url, tweet_id
        FROM x_posts
        WHERE thread_tag = 'build-in-public-thread'
        ORDER BY created_at DESC
        LIMIT 1
      `);
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[x-post-thread-tweet3-build-data] Error finding thread tweet:', err.message);
    return null;
  }
}

async function logTweetToDb(tweetText, tweetUrl) {
  try {
    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO x_posts (content, tweet_url, thread_tag, tweet_type, created_at)
        VALUES ($1, $2, $3, $4, NOW())
      `, [tweetText, tweetUrl || '', 'build-in-public-thread', 'thread-tweet3-build-data']);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[x-post-thread-tweet3-build-data] Error logging tweet to db:', err.message);
  }
}

async function postTweet3(options = {}) {
  try {
    emit('skill:start', { skill: 'x-post-thread-tweet3-build-data' });

    const buildData = await getBuildData();
    const tweetText = buildTweetText(buildData);

    console.log('[x-post-thread-tweet3-build-data] Tweet text:');
    console.log(tweetText);
    console.log('[x-post-thread-tweet3-build-data] Character count:', tweetText.length);

    if (options.dryRun) {
      console.log('[x-post-thread-tweet3-build-data] Dry run mode, skipping post');
      return { success: true, dryRun: true, tweetText, buildData };
    }

    const parentTweet = await findLatestThreadTweet();

    let posted = false;
    let tweetUrl = null;

    if (parentTweet && parentTweet.tweet_url) {
      console.log('[x-post-thread-tweet3-build-data] Replying to:', parentTweet.tweet_url);

      try {
        const peekabooResult = await motor.runShellCommand(
          `peekaboo tweet-reply --url "${parentTweet.tweet_url}" --text ${JSON.stringify(tweetText)}`
        );

        if (peekabooResult && peekabooResult.includes('http')) {
          const urlMatch = peekabooResult.match(/https:\/\/twitter\.com\/\S+|https:\/\/x\.com\/\S+/);
          tweetUrl = urlMatch ? urlMatch[0] : null;
          posted = true;
          console.log('[x-post-thread-tweet3-build-data] Posted via peekaboo reply:', tweetUrl);
        }
      } catch (peekabooErr) {
        console.error('[x-post-thread-tweet3-build-data] Peekaboo reply failed:', peekabooErr.message);
      }
    }

    if (!posted) {
      console.log('[x-post-thread-tweet3-build-data] Attempting direct browser post');

      try {
        await motor.openUrl('https://x.com/compose/tweet');
        await new Promise(r => setTimeout(r, 3000));

        await motor.copyToClipboard(tweetText);
        await motor.press(['cmd', 'v']);
        await new Promise(r => setTimeout(r, 1000));

        await motor.press(['cmd', 'Return']);
        await new Promise(r => setTimeout(r, 2000));

        posted = true;
        console.log('[x-post-thread-tweet3-build-data] Posted via browser automation');
      } catch (browserErr) {
        console.error('[x-post-thread-tweet3-build-data] Browser automation failed:', browserErr.message);
      }
    }

    if (!posted) {
      try {
        const peekabooResult = await motor.runShellCommand(
          `peekaboo tweet --text ${JSON.stringify(tweetText)}`
        );

        if (peekabooResult) {
          const urlMatch = peekabooResult.match(/https:\/\/twitter\.com\/\S+|https:\/\/x\.com\/\S+/);
          tweetUrl = urlMatch ? urlMatch[0] : null;
          posted = true;
          console.log('[x-post-thread-tweet3-build-data] Posted via peekaboo standalone:', tweetUrl);
        }
      } catch (peekabooErr) {
        console.error('[x-post-thread-tweet3-build-data] Peekaboo standalone failed:', peekabooErr.message);
      }
    }

    if (posted) {
      await logTweetToDb(tweetText, tweetUrl);

      emit('skill:success', {
        skill: 'x-post-thread-tweet3-build-data',
        tweetUrl,
        buildData: {
          total: buildData.total,
          successRate: buildData.successRate,
          currentStreak: buildData.currentStreak,
          streakType: buildData.streakType
        }
      });

      return {
        success: true,
        tweetText,
        tweetUrl,
        buildData
      };
    } else {
      throw new Error('All posting methods failed');
    }
  } catch (err) {
    console.error('[x-post-thread-tweet3-build-data] Error:', err.message);

    emit('skill:error', {
      skill: 'x-post-thread-tweet3-build-data',
      error: err.message
    });

    return {
      success: false,
      error: err.message
    };
  }
}

async function previewTweet3() {
  try {
    const buildData = await getBuildData();
    const tweetText = buildTweetText(buildData);

    return {
      success: true,
      tweetText,
      characterCount: tweetText.length,
      buildData
    };
  } catch (err) {
    console.error('[x-post-thread-tweet3-build-data] Preview error:', err.message);
    return {
      success: false,
      error: err.message
    };
  }
}

export default {
  postTweet3,
  previewTweet3,
  getBuildData,
  buildTweetText
};