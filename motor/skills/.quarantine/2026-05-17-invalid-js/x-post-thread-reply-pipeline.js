import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const PIPELINE_STAGES = [
  {
    name: 'Gap Detection',
    emoji: '🔍',
    description: 'OCA continuously monitors its own capability surface. When a request arrives that no existing skill can handle, the capability-miss-detector fires and logs the gap to the oneiro DB with full context: what was asked, what failed, and why.',
    detail: 'Gap records include: request_text, matched_skill (null), confidence_score, timestamp, and a semantic embedding for clustering similar misses over time.'
  },
  {
    name: 'Spec Generation',
    emoji: '📐',
    description: 'The gap-auto-resolver pulls the miss record and synthesizes a capability spec. This is not a template fill — it reasons about what the skill needs to do, what motor primitives it requires, what DB tables it touches, and what success looks like.',
    detail: 'Spec fields: skill_name, purpose, inputs, outputs, motor_deps, db_deps, acceptance_criteria, estimated_complexity. Stored in capability_specs table before any code is written.'
  },
  {
    name: 'Code Synthesis',
    emoji: '⚙️',
    description: 'The self-builder-prompt constructs a detailed prompt from the spec and sends it to the LLM. The response is a complete ES module — not a snippet. It includes imports, error handling, event emission, and a default export with all public functions.',
    detail: 'The synthesized code is validated structurally before being written to disk: must export default object, must use ES module syntax, must not reference undefined motor methods. Failures here loop back to spec revision.'
  },
  {
    name: 'Deploy',
    emoji: '🚀',
    description: 'deploy-skill.js writes the file to motor/skills/, registers it in the skill index, and hot-reloads the motor engine. No restart required. The new skill is live within seconds of synthesis completing.',
    detail: 'Deploy also runs a smoke test via build-smoke-tester: imports the module, calls each exported function with mock args, checks for thrown errors. If smoke fails, the file is quarantined and the build is marked failed.'
  },
  {
    name: 'Verify',
    emoji: '✅',
    description: 'build-outcome-verifier replays the original failing request against the newly deployed skill. If it resolves correctly, the gap record is closed and a success event is emitted. The build loop completes.',
    detail: 'Verification results are logged to build_outcomes with: skill_name, gap_id, success boolean, latency_ms, error_message if any. Failed verifications trigger a second synthesis attempt with the error context appended to the spec.'
  }
];

async function getBuildStats() {
  try {
    const client = await pool.connect();
    try {
      const statsQuery = `
        SELECT 
          COUNT(*) FILTER (WHERE status = 'success') as successful_builds,
          COUNT(*) FILTER (WHERE status = 'failed') as failed_builds,
          COUNT(*) as total_builds,
          AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) as avg_duration_seconds
        FROM build_outcomes
        WHERE created_at > NOW() - INTERVAL '7 days'
      `;
      const result = await client.query(statsQuery);
      return result.rows[0] || {};
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('[x-post-thread-reply-pipeline] Could not fetch build stats:', err.message);
    return {};
  }
}

async function getRecentGapStats() {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          COUNT(*) as total_gaps,
          COUNT(*) FILTER (WHERE resolved = true) as resolved_gaps,
          COUNT(*) FILTER (WHERE resolved = false) as open_gaps
        FROM capability_gaps
        WHERE created_at > NOW() - INTERVAL '7 days'
      `);
      return result.rows[0] || {};
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('[x-post-thread-reply-pipeline] Could not fetch gap stats:', err.message);
    return {};
  }
}

function buildThreadTweets(stats, gapStats) {
  const successRate = stats.total_builds > 0
    ? Math.round((stats.successful_builds / stats.total_builds) * 100)
    : null;

  const avgMinutes = stats.avg_duration_seconds
    ? Math.round(stats.avg_duration_seconds / 60)
    : null;

  const tweets = [];

  // Opening tweet
  tweets.push(
    `🧵 How Oneiro builds itself in real-time — the full pipeline, step by step.\n\n` +
    `This isn't a roadmap. This is what's running right now, autonomously, every time OCA hits a capability gap.\n\n` +
    `5 stages. No human in the loop. Let's walk through it.`
  );

  // Stage tweets
  PIPELINE_STAGES.forEach((stage, index) => {
    const stageNum = index + 1;
    const tweet = `${stage.emoji} Stage ${stageNum}/5: ${stage.name}\n\n${stage.description}\n\n${stage.detail}`;
    tweets.push(tweet);
  });

  // Stats tweet if we have data
  if (stats.total_builds || gapStats.total_gaps) {
    let statsTweet = `📊 Last 7 days by the numbers:\n\n`;

    if (gapStats.total_gaps) {
      statsTweet += `• ${gapStats.total_gaps} capability gaps detected\n`;
      statsTweet += `• ${gapStats.resolved_gaps || 0} resolved autonomously\n`;
      statsTweet += `• ${gapStats.open_gaps || 0} still open\n`;
    }

    if (stats.total_builds) {
      statsTweet += `• ${stats.total_builds} build attempts\n`;
      if (successRate !== null) {
        statsTweet += `• ${successRate}% success rate\n`;
      }
      if (avgMinutes !== null) {
        statsTweet += `• ~${avgMinutes}min avg build time\n`;
      }
    }

    statsTweet += `\nEvery number here came from OCA running this pipeline on itself.`;
    tweets.push(statsTweet);
  }

  // Closing tweet
  tweets.push(
    `The loop closes when verification passes. If it doesn't, the error context feeds back into spec generation and synthesis runs again.\n\n` +
    `OCA doesn't ask for help. It reads its own failure, revises its own spec, and tries again.\n\n` +
    `That's the build loop. That's Oneiro.`
  );

  return tweets;
}

async function findReplyTarget(tweetUrl) {
  if (!tweetUrl) return null;

  try {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT tweet_id, tweet_url FROM x_posts WHERE tweet_url = $1 LIMIT 1`,
        [tweetUrl]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('[x-post-thread-reply-pipeline] Could not find reply target:', err.message);
    return null;
  }
}

async function logThreadPost(tweetUrls, replyToUrl) {
  try {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO x_posts (tweet_url, content, post_type, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [
          tweetUrls[0] || 'unknown',
          JSON.stringify({ thread_urls: tweetUrls, reply_to: replyToUrl }),
          'thread_reply_pipeline'
        ]
      );
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('[x-post-thread-reply-pipeline] Could not log thread post:', err.message);
  }
}

async function postViaPerekaboo(tweets, replyToUrl) {
  const results = [];

  try {
    // Use peekaboo to handle bot-protected X flows
    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];
      const isFirst = i === 0;
      const previousUrl = results[i - 1]?.url;

      let command;
      if (isFirst && replyToUrl) {
        command = `peekaboo x reply --url "${replyToUrl}" --text ${JSON.stringify(tweet)}`;
      } else if (!isFirst && previousUrl) {
        command = `peekaboo x reply --url "${previousUrl}" --text ${JSON.stringify(tweet)}`;
      } else {
        command = `peekaboo x post --text ${JSON.stringify(tweet)}`;
      }

      const result = await motor.runShellCommand(command);
      console.log(`[x-post-thread-reply-pipeline] Posted tweet ${i + 1}/${tweets.length}`);

      // Extract URL from result if available
      const urlMatch = result?.stdout?.match(/https:\/\/twitter\.com\S+|https:\/\/x\.com\S+/);
      results.push({
        index: i,
        url: urlMatch ? urlMatch[0] : null,
        success: !result?.error
      });

      // Small delay between tweets to avoid rate limiting
      if (i < tweets.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  } catch (err) {
    console.error('[x-post-thread-reply-pipeline] Peekaboo posting failed:', err.message);
    throw err;
  }

  return results;
}

async function postViaBrowserAutomation(tweets, replyToUrl) {
  const results = [];

  try {
    // Open X/Twitter
    await motor.openUrl(replyToUrl || 'https://x.com');
    await new Promise(resolve => setTimeout(resolve, 3000));

    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];
      const isFirst = i === 0;

      if (isFirst && replyToUrl) {
        // Navigate to the tweet to reply to
        await motor.openUrl(replyToUrl);
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Click reply button
        await motor.runShellCommand(`peekaboo click --selector "[data-testid='reply']" --wait 2000`);
      } else if (!isFirst) {
        // Continue thread - click reply on previous tweet
        const prevUrl = results[i - 1]?.url;
        if (prevUrl) {
          await motor.openUrl(prevUrl);
          await new Promise(resolve => setTimeout(resolve, 2000));
          await motor.runShellCommand(`peekaboo click --selector "[data-testid='reply']" --wait 2000`);
        }
      } else {
        // New thread post
        await motor.runShellCommand(`peekaboo click --selector "[data-testid='SideNav_NewTweet_Button']" --wait 2000`);
      }

      // Type the tweet
      await motor.copyToClipboard(tweet);
      await motor.runShellCommand(`peekaboo type --selector "[data-testid='tweetTextarea_0']" --paste --wait 1000`);

      // Submit
      await motor.runShellCommand(`peekaboo click --selector "[data-testid='tweetButton']" --wait 3000`);

      results.push({
        index: i,
        url: null,
        success: true
      });

      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (err) {
    console.error('[x-post-thread-reply-pipeline] Browser automation failed:', err.message);
    throw err;
  }

  return results;
}

async function postBuildPipelineThread(options = {}) {
  const {
    replyToUrl = null,
    usePeekaboo = true,
    dryRun = false
  } = options;

  console.log('[x-post-thread-reply-pipeline] Starting build pipeline thread post...');

  // Gather data
  const [stats, gapStats] = await Promise.all([
    getBuildStats(),
    getRecentGapStats()
  ]);

  // Build tweet content
  const tweets = buildThreadTweets(stats, gapStats);

  console.log(`[x-post-thread-reply-pipeline] Prepared ${tweets.length} tweets`);
  tweets.forEach((t, i) => {
    console.log(`[x-post-thread-reply-pipeline] Tweet ${i + 1} (${t.length} chars):\n${t.substring(0, 100)}...`);
  });

  if (dryRun) {
    console.log('[x-post-thread-reply-pipeline] Dry run — not posting');
    emit('x:thread:pipeline:dry_run', { tweets, replyToUrl });
    return { success: true, dryRun: true, tweets };
  }

  // Validate tweet lengths
  const oversized = tweets.filter(t => t.length > 280);
  if (oversized.length > 0) {
    console.warn(`[x-post-thread-reply-pipeline] ${oversized.length} tweets exceed 280 chars, truncating...`);
    // Truncate oversized tweets
    tweets.forEach((t, i) => {
      if (t.length > 280) {
        tweets[i] = t.substring(0, 277) + '...';
      }
    });
  }

  let results;

  try {
    if (usePeekaboo) {
      results = await postViaPerekaboo(tweets, replyToUrl);
    } else {
      results = await postViaBrowserAutomation(tweets, replyToUrl);
    }

    const successCount = results.filter(r => r.success).length;
    const tweetUrls = results.map(r => r.url).filter(Boolean);

    // Log to DB
    await logThreadPost(tweetUrls, replyToUrl);

    // Emit event
    emit('x:thread:pipeline:posted', {
      tweet_count: tweets.length,
      success_count: successCount,
      reply_to: replyToUrl,
      tweet_urls: tweetUrls,
      stages: PIPELINE_STAGES.map(s => s.name)
    });

    console.log(`[x-post-thread-reply-pipeline] Thread posted: ${successCount}/${tweets.length} tweets successful`);

    return {
      success: successCount === tweets.length,
      tweet_count: tweets.length,
      success_count: successCount,
      tweet_urls: tweetUrls,
      results
    };

  } catch (err) {
    console.error('[x-post-thread-reply-pipeline] Failed to post thread:', err.message);

    emit('x:thread:pipeline:failed', {
      error: err.message,
      reply_to: replyToUrl
    });

    return {
      success: false,
      error: err.message
    };
  }
}

async function previewThread(options = {}) {
  const [stats, gapStats] = await Promise.all([
    getBuildStats(),
    getRecentGapStats()
  ]);

  const tweets = buildThreadTweets(stats, gapStats);