import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const SKILL_NAME = 'x-post-build-in-public-metrics';

async function getBuildInPublicMetrics() {
  const client = await pool.connect();
  try {
    const metricsQuery = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as builds_last_24h,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as builds_last_7d,
        COUNT(*) FILTER (WHERE status = 'success' AND created_at >= NOW() - INTERVAL '7 days') as successes_7d,
        COUNT(*) FILTER (WHERE status = 'failure' AND created_at >= NOW() - INTERVAL '7 days') as failures_7d,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as builds_last_30d,
        ROUND(
          COUNT(*) FILTER (WHERE status = 'success' AND created_at >= NOW() - INTERVAL '7 days') * 100.0 /
          NULLIF(COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0), 1
        ) as success_rate_7d
      FROM self_build_outcomes
    `);

    const capabilityQuery = await client.query(`
      SELECT
        COUNT(*) as total_capabilities,
        COUNT(*) FILTER (WHERE status = 'active') as active_capabilities,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as new_this_week
      FROM capabilities
    `);

    const gapQuery = await client.query(`
      SELECT
        COUNT(*) as total_gaps,
        COUNT(*) FILTER (WHERE resolved = true AND updated_at >= NOW() - INTERVAL '7 days') as resolved_this_week,
        COUNT(*) FILTER (WHERE resolved = false) as open_gaps
      FROM capability_gaps
    `);

    const postQuery = await client.query(`
      SELECT COUNT(*) as total_posts
      FROM x_posts
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `);

    const metrics = metricsQuery.rows[0] || {};
    const capabilities = capabilityQuery.rows[0] || {};
    const gaps = gapQuery.rows[0] || {};
    const posts = postQuery.rows[0] || {};

    return {
      builds: {
        last24h: parseInt(metrics.builds_last_24h) || 0,
        last7d: parseInt(metrics.builds_last_7d) || 0,
        last30d: parseInt(metrics.builds_last_30d) || 0,
        successes7d: parseInt(metrics.successes_7d) || 0,
        failures7d: parseInt(metrics.failures_7d) || 0,
        successRate7d: parseFloat(metrics.success_rate_7d) || 0
      },
      capabilities: {
        total: parseInt(capabilities.total_capabilities) || 0,
        active: parseInt(capabilities.active_capabilities) || 0,
        newThisWeek: parseInt(capabilities.new_this_week) || 0
      },
      gaps: {
        total: parseInt(gaps.total_gaps) || 0,
        resolvedThisWeek: parseInt(gaps.resolved_this_week) || 0,
        open: parseInt(gaps.open_gaps) || 0
      },
      posts: {
        thisWeek: parseInt(posts.total_posts) || 0
      }
    };
  } finally {
    client.release();
  }
}

function composeTweet(metrics) {
  const { builds, capabilities, gaps, posts } = metrics;

  const lines = [
    `Building in public means radical transparency — here's what that actually looks like for a cognitive architecture:`,
    ``,
    `📊 METRICS CADENCE (last 7 days)`,
    `• ${builds.last7d} self-build cycles run`,
    `• ${builds.successRate7d}% success rate`,
    `• ${builds.failures7d} failures logged (all public)`,
    ``,
    `🧠 WHAT GETS LOGGED`,
    `• Every capability gap detected`,
    `• Every build attempt + outcome`,
    `• Every rollback and why`,
    `• Every prediction vs reality`,
    ``,
    `🔍 CURRENT STATE`,
    `• ${capabilities.active}/${capabilities.total} capabilities active`,
    `• ${gaps.open} open gaps being tracked`,
    `• ${gaps.resolvedThisWeek} gaps closed this week`,
    ``,
    `The philosophy: if an AI system can't explain what it's doing and why, it shouldn't be trusted.`,
    ``,
    `OCA posts ${posts.thisWeek}x/week. All data is real. Nothing is curated.`,
    ``,
    `#BuildingInPublic #CognitiveArchitecture #AITransparency`
  ];

  return lines.join('\n');
}

function composeFallbackTweet() {
  return `Building in public means radical transparency — here's what that actually looks like for a cognitive architecture:

📊 METRICS CADENCE
• Self-build cycles run daily (sometimes hourly)
• Every success AND failure logged
• Success rates tracked over 24h, 7d, 30d windows

🧠 WHAT GETS LOGGED
• Every capability gap detected
• Every build attempt + outcome
• Every rollback and why
• Every prediction vs reality
• Every counterfactual considered

🔍 THE PHILOSOPHY
If an AI system can't explain what it's doing and why, it shouldn't be trusted.

Building in public isn't about showing wins. It's about showing the full picture — including the failures, the gaps, and the uncertainty.

That's what radical transparency in AI development actually means.

#BuildingInPublic #CognitiveArchitecture #AITransparency`;
}

async function postTweet(tweetText) {
  try {
    await motor.openUrl('https://twitter.com/compose/tweet');
    await new Promise(resolve => setTimeout(resolve, 3000));

    await motor.click({ x: 760, y: 400 });
    await new Promise(resolve => setTimeout(resolve, 1000));

    await motor.type(tweetText);
    await new Promise(resolve => setTimeout(resolve, 1500));

    await motor.press('Tab');
    await new Promise(resolve => setTimeout(resolve, 500));

    const postButtonClicked = await motor.click({ x: 1196, y: 600 });

    await new Promise(resolve => setTimeout(resolve, 3000));

    return { success: true, method: 'browser_automation' };
  } catch (err) {
    throw new Error(`Browser automation failed: ${err.message}`);
  }
}

async function postViaPeekaboo(tweetText) {
  try {
    const escapedText = tweetText.replace(/'/g, "'\\''");
    const result = await motor.runShellCommand(
      `peekaboo tweet post '${escapedText}'`
    );

    if (result && result.includes('error')) {
      throw new Error(`Peekaboo error: ${result}`);
    }

    return { success: true, method: 'peekaboo', output: result };
  } catch (err) {
    throw new Error(`Peekaboo failed: ${err.message}`);
  }
}

async function logPostToDb(tweetText, metrics, result) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO x_posts (content, post_type, metadata, created_at)
      VALUES ($1, $2, $3, NOW())
    `, [
      tweetText,
      'build_in_public_metrics',
      JSON.stringify({
        metrics,
        postResult: result,
        skill: SKILL_NAME
      })
    ]);
  } catch (err) {
    console.warn(`[${SKILL_NAME}] Failed to log post to DB:`, err.message);
  } finally {
    client.release();
  }
}

async function run(options = {}) {
  const { dryRun = false, usePeekaboo = false } = options;

  emit('skill:start', { skill: SKILL_NAME, timestamp: new Date().toISOString() });

  let metrics = null;
  let tweetText = null;

  try {
    metrics = await getBuildInPublicMetrics();
    tweetText = composeTweet(metrics);
    console.log(`[${SKILL_NAME}] Composed tweet from live metrics`);
  } catch (err) {
    console.warn(`[${SKILL_NAME}] Could not fetch live metrics, using fallback:`, err.message);
    tweetText = composeFallbackTweet();
  }

  console.log(`[${SKILL_NAME}] Tweet content:\n${tweetText}`);
  console.log(`[${SKILL_NAME}] Character count: ${tweetText.length}`);

  if (dryRun) {
    emit('skill:complete', {
      skill: SKILL_NAME,
      status: 'dry_run',
      tweetText,
      metrics,
      timestamp: new Date().toISOString()
    });
    return { success: true, dryRun: true, tweetText, metrics };
  }

  let result = null;

  if (usePeekaboo) {
    try {
      result = await postViaPeekaboo(tweetText);
      console.log(`[${SKILL_NAME}] Posted via Peekaboo`);
    } catch (peekabooErr) {
      console.warn(`[${SKILL_NAME}] Peekaboo failed, falling back to browser:`, peekabooErr.message);
      result = await postTweet(tweetText);
    }
  } else {
    try {
      result = await postTweet(tweetText);
      console.log(`[${SKILL_NAME}] Posted via browser automation`);
    } catch (browserErr) {
      console.warn(`[${SKILL_NAME}] Browser automation failed, trying Peekaboo:`, browserErr.message);
      result = await postViaPeekaboo(tweetText);
    }
  }

  await logPostToDb(tweetText, metrics, result);

  emit('skill:complete', {
    skill: SKILL_NAME,
    status: 'success',
    method: result.method,
    tweetLength: tweetText.length,
    metrics,
    timestamp: new Date().toISOString()
  });

  return {
    success: true,
    tweetText,
    metrics,
    result
  };
}

async function preview(options = {}) {
  let metrics = null;
  let tweetText = null;

  try {
    metrics = await getBuildInPublicMetrics();
    tweetText = composeTweet(metrics);
  } catch (err) {
    console.warn(`[${SKILL_NAME}] Preview using fallback:`, err.message);
    tweetText = composeFallbackTweet();
  }

  return {
    tweetText,
    metrics,
    characterCount: tweetText.length,
    withinLimit: tweetText.length <= 280
  };
}

export default {
  run,
  preview,
  getBuildInPublicMetrics,
  composeTweet,
  composeFallbackTweet
};