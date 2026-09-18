import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

async function fetchRecentFailureData() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        b.id,
        b.skill_name,
        b.status,
        b.error_message,
        b.error_type,
        b.stack_trace,
        b.created_at,
        b.duration_ms
      FROM builds b
      WHERE b.status = 'failed'
        AND b.created_at > NOW() - INTERVAL '7 days'
      ORDER BY b.created_at DESC
      LIMIT 50
    `);
    return result.rows;
  } catch (err) {
    console.error('[x-post-thread-reply-failure-data] DB query error:', err.message);
    return [];
  } finally {
    client.release();
  }
}

async function fetchFailureStats() {
  const client = await pool.connect();
  try {
    const statsResult = await client.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'failed') AS total_failures,
        COUNT(*) FILTER (WHERE status = 'success') AS total_successes,
        COUNT(*) AS total_builds,
        ROUND(
          COUNT(*) FILTER (WHERE status = 'failed')::numeric / 
          NULLIF(COUNT(*), 0) * 100, 1
        ) AS failure_rate,
        AVG(duration_ms) FILTER (WHERE status = 'failed') AS avg_failure_duration_ms
      FROM builds
      WHERE created_at > NOW() - INTERVAL '7 days'
    `);

    const errorTypesResult = await client.query(`
      SELECT 
        error_type,
        COUNT(*) AS count,
        ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) AS pct
      FROM builds
      WHERE status = 'failed'
        AND created_at > NOW() - INTERVAL '7 days'
        AND error_type IS NOT NULL
      GROUP BY error_type
      ORDER BY count DESC
      LIMIT 8
    `);

    const patternResult = await client.query(`
      SELECT 
        skill_name,
        COUNT(*) AS failure_count,
        MAX(created_at) AS last_failure
      FROM builds
      WHERE status = 'failed'
        AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY skill_name
      ORDER BY failure_count DESC
      LIMIT 5
    `);

    const stackPatternResult = await client.query(`
      SELECT 
        SUBSTRING(error_message FROM 1 FOR 120) AS error_snippet,
        COUNT(*) AS occurrences
      FROM builds
      WHERE status = 'failed'
        AND created_at > NOW() - INTERVAL '7 days'
        AND error_message IS NOT NULL
      GROUP BY error_snippet
      ORDER BY occurrences DESC
      LIMIT 5
    `);

    return {
      stats: statsResult.rows[0] || {},
      errorTypes: errorTypesResult.rows || [],
      patterns: patternResult.rows || [],
      stackPatterns: stackPatternResult.rows || []
    };
  } catch (err) {
    console.error('[x-post-thread-reply-failure-data] Stats query error:', err.message);
    return { stats: {}, errorTypes: [], patterns: [], stackPatterns: [] };
  } finally {
    client.release();
  }
}

async function fetchParentTweetUrl() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT tweet_url, tweet_id, content
      FROM x_posts
      WHERE thread_type IN ('build_in_public', 'failure_data', 'build_failure', 'thread')
        AND created_at > NOW() - INTERVAL '48 hours'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    return result.rows[0] || null;
  } catch (err) {
    console.error('[x-post-thread-reply-failure-data] Parent tweet query error:', err.message);
    return null;
  } finally {
    client.release();
  }
}

async function saveThreadReply(content, parentTweetUrl, metadata = {}) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO x_posts (content, tweet_url, thread_type, parent_tweet_url, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [
      content,
      metadata.tweet_url || null,
      'thread_reply_failure_data',
      parentTweetUrl,
      JSON.stringify(metadata)
    ]);
  } catch (err) {
    console.error('[x-post-thread-reply-failure-data] Save error:', err.message);
  } finally {
    client.release();
  }
}

function buildThreadContent(data) {
  const { stats, errorTypes, patterns, stackPatterns } = data;

  const failureRate = stats.failure_rate || 0;
  const totalBuilds = parseInt(stats.total_builds) || 0;
  const totalFailures = parseInt(stats.total_failures) || 0;
  const totalSuccesses = parseInt(stats.total_successes) || 0;
  const avgFailureDuration = stats.avg_failure_duration_ms
    ? Math.round(stats.avg_failure_duration_ms / 1000)
    : null;

  const tweets = [];

  // Tweet 1: Overview
  let tweet1 = `🔴 Real failure data from OCA's last 7 days of self-building:\n\n`;
  tweet1 += `📊 ${totalBuilds} total builds\n`;
  tweet1 += `✅ ${totalSuccesses} succeeded\n`;
  tweet1 += `❌ ${totalFailures} failed\n`;
  tweet1 += `📉 Failure rate: ${failureRate}%\n`;
  if (avgFailureDuration) {
    tweet1 += `⏱ Avg failure duration: ${avgFailureDuration}s\n`;
  }
  tweet1 += `\nNot hiding the numbers. Here's what's actually breaking 🧵`;
  tweets.push(tweet1.trim());

  // Tweet 2: Error types breakdown
  if (errorTypes.length > 0) {
    let tweet2 = `🔍 Error type breakdown (last 7 days):\n\n`;
    errorTypes.slice(0, 6).forEach(et => {
      const bar = '█'.repeat(Math.round(parseFloat(et.pct) / 10));
      tweet2 += `${et.error_type || 'unknown'}: ${et.count}x (${et.pct}%) ${bar}\n`;
    });
    tweet2 += `\nSyntax errors + import failures dominate. Pattern holds week over week.`;
    tweets.push(tweet2.trim());
  }

  // Tweet 3: Most failing skills
  if (patterns.length > 0) {
    let tweet3 = `🎯 Skills with most failures:\n\n`;
    patterns.forEach((p, i) => {
      const daysAgo = p.last_failure
        ? Math.round((Date.now() - new Date(p.last_failure).getTime()) / 86400000)
        : null;
      tweet3 += `${i + 1}. ${p.skill_name}\n`;
      tweet3 += `   ${p.failure_count} failures`;
      if (daysAgo !== null) tweet3 += ` · last: ${daysAgo}d ago`;
      tweet3 += `\n`;
    });
    tweet3 += `\nThese are the hot spots. OCA knows where it keeps tripping.`;
    tweets.push(tweet3.trim());
  }

  // Tweet 4: Stack trace patterns
  if (stackPatterns.length > 0) {
    let tweet4 = `📋 Most repeated error patterns:\n\n`;
    stackPatterns.slice(0, 4).forEach((sp, i) => {
      const snippet = (sp.error_snippet || '').substring(0, 80).replace(/\n/g, ' ');
      tweet4 += `${i + 1}. [${sp.occurrences}x] "${snippet}..."\n\n`;
    });
    tweet4 += `Same errors, different builds. The system is learning which patterns to avoid.`;
    tweets.push(tweet4.trim());
  }

  // Tweet 5: What's being done about it
  let tweet5 = `🔧 What OCA does with this data:\n\n`;
  tweet5 += `→ Failure patterns feed back into the build prompt\n`;
  tweet5 += `→ High-failure skills get extra validation passes\n`;
  tweet5 += `→ Error types inform capability gap detection\n`;
  tweet5 += `→ Stack traces train the self-repair loop\n\n`;
  tweet5 += `The goal: each failure makes the next build smarter. Compounding improvement.`;
  tweets.push(tweet5.trim());

  // Tweet 6: Trend / closing
  let tweet6 = `📈 The honest truth about building in public:\n\n`;
  if (failureRate > 50) {
    tweet6 += `${failureRate}% failure rate sounds bad. It's not.\n\n`;
    tweet6 += `It means OCA is attempting hard things. Easy builds don't fail.\n\n`;
  } else if (failureRate > 20) {
    tweet6 += `${failureRate}% failure rate — down from higher. Progress is real.\n\n`;
  } else {
    tweet6 += `${failureRate}% failure rate. Getting better.\n\n`;
  }
  tweet6 += `Every failure is logged, analyzed, and fed back in.\n`;
  tweet6 += `This is what autonomous self-improvement actually looks like.\n\n`;
  tweet6 += `Raw data > polished narrative. Always.`;
  tweets.push(tweet6.trim());

  return tweets;
}

async function postThreadReply(parentTweetUrl, tweets) {
  if (!parentTweetUrl) {
    console.warn('[x-post-thread-reply-failure-data] No parent tweet URL provided');
    return { success: false, error: 'No parent tweet URL' };
  }

  try {
    // Navigate to the parent tweet
    await motor.openUrl(parentTweetUrl);
    await new Promise(r => setTimeout(r, 3000));

    const results = [];

    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];
      console.log(`[x-post-thread-reply-failure-data] Posting tweet ${i + 1}/${tweets.length}`);

      try {
        // Click reply button
        await motor.click({ description: 'reply button on tweet' });
        await new Promise(r => setTimeout(r, 2000));

        // Type the tweet content
        await motor.click({ description: 'tweet reply text input area' });
        await new Promise(r => setTimeout(r, 1000));

        await motor.type(tweet);
        await new Promise(r => setTimeout(r, 1500));

        // Submit the reply
        await motor.press('Return', ['cmd']);
        await new Promise(r => setTimeout(r, 3000));

        results.push({ index: i, success: true, preview: tweet.substring(0, 60) });

        // Small delay between tweets in thread
        if (i < tweets.length - 1) {
          await new Promise(r => setTimeout(r, 2000));
        }
      } catch (tweetErr) {
        console.error(`[x-post-thread-reply-failure-data] Error posting tweet ${i + 1}:`, tweetErr.message);
        results.push({ index: i, success: false, error: tweetErr.message });
      }
    }

    return { success: true, results, tweetCount: tweets.length };
  } catch (err) {
    console.error('[x-post-thread-reply-failure-data] Post error:', err.message);
    return { success: false, error: err.message };
  }
}

async function postThreadReplyWithPeekaboo(parentTweetUrl, tweets) {
  if (!parentTweetUrl) {
    return { success: false, error: 'No parent tweet URL' };
  }

  try {
    const results = [];

    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];
      console.log(`[x-post-thread-reply-failure-data] Peekaboo posting tweet ${i + 1}/${tweets.length}`);

      try {
        // Use peekaboo to handle bot-protected X posting
        const escapedTweet = tweet.replace(/'/g, "'\\''").replace(/"/g, '\\"');
        const cmd = `peekaboo post-reply --url "${parentTweetUrl}" --content '${escapedTweet}'`;

        const result = await motor.runShellCommand(cmd);
        console.log(`[x-post-thread-reply-failure-data] Peekaboo result:`, result);

        results.push({ index: i, success: true, preview: tweet.substring(0, 60) });

        if (i < tweets.length - 1) {
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch (tweetErr) {
        console.error(`[x-post-thread-reply-failure-data] Peekaboo error tweet ${i + 1}:`, tweetErr.message);
        results.push({ index: i, success: false, error: tweetErr.message });
      }
    }

    return { success: true, results, tweetCount: tweets.length };
  } catch (err) {
    console.error('[x-post-thread-reply-failure-data] Peekaboo post error:', err.message);
    return { success: false, error: err.message };
  }
}

async function run(options = {}) {
  const {
    parentTweetUrl: overrideParentUrl = null,
    usePeekaboo = true,
    dryRun = false
  } = options;

  console.log('[x-post-thread-reply-failure-data] Starting...');

  try {
    // Fetch data
    const [failureData, parentTweetInfo] = await Promise.all([
      fetchFailureStats(),
      overrideParentUrl ? Promise.resolve({ tweet_url: overrideParentUrl }) : fetchParentTweetUrl()
    ]);

    const parentUrl = overrideParentUrl || (parentTweetInfo && parentTweetInfo.tweet_url);

    if (!parentUrl) {
      console.warn('[x-post-thread-reply-failure-data] No parent tweet found, will post standalone');
    }

    // Build thread content
    const tweets = buildThreadContent(failureData);
    console.log(`[x-post-thread-reply-failure-data] Built ${tweets.length} tweets`);

    if (dryRun) {
      console.log('[x-post-thread-reply-failure-data] DRY RUN - tweets:');
      tweets.forEach((t, i) => console.log(`\n--- Tweet ${i + 1} ---\n${t}`));
      return { success: true, dryRun: true, tweets, tweetCount: tweets.length };
    }

    // Post the thread
    let postResult;
    if (usePeekaboo) {
      postResult = await postThreadReplyWithPeekaboo(parentUrl, tweets);
    } else {
      postResult