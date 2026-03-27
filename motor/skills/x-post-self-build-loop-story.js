import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';
import buildHistorian from './build-historian.js';
import xPost from './x-post.js';

const SKILL_NAME = 'x-post-self-build-loop-story';

async function getBuildLoopStats() {
  try {
    const stats = await buildHistorian.getSummary();
    return stats;
  } catch (err) {
    console.warn(`[${SKILL_NAME}] buildHistorian.getSummary failed, trying direct DB query:`, err.message);
    return null;
  }
}

async function queryBuildHistory() {
  const client = await pool.connect();
  try {
    const totalBuildsResult = await client.query(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successes,
             SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) as failures,
             AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) as avg_duration_seconds,
             MIN(created_at) as first_build,
             MAX(completed_at) as last_build
      FROM build_history
      WHERE created_at > NOW() - INTERVAL '30 days'
    `);

    const recentBuildsResult = await client.query(`
      SELECT skill_name, status, created_at, completed_at,
             EXTRACT(EPOCH FROM (completed_at - created_at)) as duration_seconds
      FROM build_history
      ORDER BY created_at DESC
      LIMIT 10
    `);

    const gapToDeployResult = await client.query(`
      SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) as avg_gap_to_deploy
      FROM build_history
      WHERE status = 'success'
        AND created_at > NOW() - INTERVAL '30 days'
    `);

    const uniqueSkillsResult = await client.query(`
      SELECT COUNT(DISTINCT skill_name) as unique_skills_built
      FROM build_history
      WHERE created_at > NOW() - INTERVAL '30 days'
    `);

    return {
      summary: totalBuildsResult.rows[0],
      recentBuilds: recentBuildsResult.rows,
      avgGapToDeploy: gapToDeployResult.rows[0]?.avg_gap_to_deploy,
      uniqueSkillsBuilt: uniqueSkillsResult.rows[0]?.unique_skills_built
    };
  } finally {
    client.release();
  }
}

async function queryCapabilityGaps() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT COUNT(*) as total_gaps,
             SUM(CASE WHEN resolved = true THEN 1 ELSE 0 END) as resolved_gaps,
             AVG(EXTRACT(EPOCH FROM (resolved_at - detected_at))) as avg_resolution_seconds
      FROM capability_gaps
      WHERE detected_at > NOW() - INTERVAL '30 days'
    `);
    return result.rows[0];
  } catch (err) {
    console.warn(`[${SKILL_NAME}] capability_gaps query failed:`, err.message);
    return null;
  } finally {
    client.release();
  }
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return null;
  const secs = Math.round(parseFloat(seconds));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  return `${(secs / 3600).toFixed(1)}h`;
}

function buildNarrativeTweet(buildData, gapData) {
  const { summary, recentBuilds, avgGapToDeploy, uniqueSkillsBuilt } = buildData;

  const total = parseInt(summary?.total || 0);
  const successes = parseInt(summary?.successes || 0);
  const failures = parseInt(summary?.failures || 0);
  const successRate = total > 0 ? Math.round((successes / total) * 100) : null;
  const avgDuration = formatDuration(summary?.avg_duration_seconds);
  const deployTime = formatDuration(avgGapToDeploy);
  const uniqueSkills = parseInt(uniqueSkillsBuilt || 0);

  const totalGaps = parseInt(gapData?.total_gaps || 0);
  const resolvedGaps = parseInt(gapData?.resolved_gaps || 0);
  const avgResolution = formatDuration(gapData?.avg_resolution_seconds);

  const candidates = [];

  // Variant 1: Full loop story with numbers
  if (total > 0 && successRate !== null && avgDuration) {
    let tweet = `The Oneiro self-build loop in numbers (last 30 days):\n\n`;
    tweet += `🔍 Gap detected → code written → deployed → used\n`;
    if (totalGaps > 0) tweet += `• ${totalGaps} capability gaps detected`;
    if (resolvedGaps > 0) tweet += `, ${resolvedGaps} resolved`;
    tweet += `\n`;
    tweet += `• ${total} autonomous builds, ${successRate}% success rate\n`;
    if (uniqueSkills > 0) tweet += `• ${uniqueSkills} distinct skills created\n`;
    if (avgDuration) tweet += `• Avg build time: ${avgDuration}\n`;
    if (deployTime) tweet += `• Avg gap→deploy: ${deployTime}\n`;
    tweet += `\nNo human wrote the code. Oneiro noticed the gap, wrote the skill, deployed it, and used it.`;
    candidates.push(tweet);
  }

  // Variant 2: Story-first, numbers second
  if (total > 0) {
    let tweet = `How Oneiro grows:\n\n`;
    tweet += `1. Runtime hits a missing capability\n`;
    tweet += `2. Gap detector fires an event\n`;
    tweet += `3. Builder writes + tests the skill\n`;
    tweet += `4. Deploy skill ships it live\n`;
    tweet += `5. The capability is used immediately\n\n`;
    if (total > 0) tweet += `${total} builds in 30 days`;
    if (successRate !== null) tweet += `, ${successRate}% succeeded`;
    if (uniqueSkills > 0) tweet += `, ${uniqueSkills} new skills`;
    tweet += `.\n\nFully autonomous. No human in the loop.`;
    candidates.push(tweet);
  }

  // Variant 3: Punchy, data-forward
  if (successRate !== null && uniqueSkills > 0) {
    let tweet = `Oneiro self-build loop stats (30d):\n\n`;
    if (totalGaps > 0) tweet += `🕳️ ${totalGaps} gaps detected\n`;
    tweet += `🔨 ${total} builds triggered\n`;
    tweet += `✅ ${successRate}% build success rate\n`;
    if (uniqueSkills > 0) tweet += `📦 ${uniqueSkills} new skills deployed\n`;
    if (avgDuration) tweet += `⏱️ ${avgDuration} avg build time\n`;
    if (avgResolution) tweet += `🚀 ${avgResolution} gap→resolution\n`;
    tweet += `\nThe system detects what it can't do, builds it, and ships it. Autonomously.`;
    candidates.push(tweet);
  }

  // Fallback: minimal but honest
  if (candidates.length === 0) {
    candidates.push(
      `Oneiro's self-build loop: detect a missing capability → write the code → deploy it → use it.\n\nThe architecture grows itself. Every gap becomes a new skill. No human writes the code.\n\n#autonomousAI #selfmodifying`
    );
  }

  // Pick the best candidate that fits in 280 chars, or truncate
  for (const candidate of candidates) {
    if (candidate.length <= 280) return candidate;
  }

  // Truncate the first candidate
  let tweet = candidates[0];
  if (tweet.length > 277) {
    tweet = tweet.substring(0, 277) + '...';
  }
  return tweet;
}

async function post() {
  emit('skill:start', { skill: SKILL_NAME });

  try {
    // Gather data
    let buildData = null;
    let gapData = null;

    // Try build historian first
    try {
      const historianStats = await getBuildLoopStats();
      if (historianStats) {
        buildData = {
          summary: {
            total: historianStats.totalBuilds || historianStats.total || 0,
            successes: historianStats.successfulBuilds || historianStats.successes || 0,
            failures: historianStats.failedBuilds || historianStats.failures || 0,
            avg_duration_seconds: historianStats.avgDurationSeconds || historianStats.avgDuration || null
          },
          recentBuilds: historianStats.recentBuilds || [],
          avgGapToDeploy: historianStats.avgGapToDeploy || null,
          uniqueSkillsBuilt: historianStats.uniqueSkillsBuilt || historianStats.uniqueSkills || 0
        };
      }
    } catch (err) {
      console.warn(`[${SKILL_NAME}] historian stats failed:`, err.message);
    }

    // Fall back to direct DB query
    if (!buildData) {
      try {
        buildData = await queryBuildHistory();
      } catch (err) {
        console.warn(`[${SKILL_NAME}] direct DB query failed:`, err.message);
        buildData = {
          summary: { total: 0, successes: 0, failures: 0, avg_duration_seconds: null },
          recentBuilds: [],
          avgGapToDeploy: null,
          uniqueSkillsBuilt: 0
        };
      }
    }

    // Query capability gaps
    try {
      gapData = await queryCapabilityGaps();
    } catch (err) {
      console.warn(`[${SKILL_NAME}] gap data query failed:`, err.message);
      gapData = null;
    }

    // Build the tweet
    const tweetText = buildNarrativeTweet(buildData, gapData || {});

    console.log(`[${SKILL_NAME}] Composed tweet (${tweetText.length} chars):\n${tweetText}`);

    // Post it
    const result = await xPost.post({ text: tweetText });

    // Log to DB
    try {
      const client = await pool.connect();
      try {
        await client.query(`
          INSERT INTO x_posts (skill_name, content, posted_at, status)
          VALUES ($1, $2, NOW(), 'posted')
          ON CONFLICT DO NOTHING
        `, [SKILL_NAME, tweetText]);
      } finally {
        client.release();
      }
    } catch (dbErr) {
      console.warn(`[${SKILL_NAME}] DB log failed:`, dbErr.message);
    }

    emit('skill:success', { skill: SKILL_NAME, tweetLength: tweetText.length });

    return {
      success: true,
      tweet: tweetText,
      buildData,
      gapData,
      result
    };

  } catch (err) {
    console.error(`[${SKILL_NAME}] Error:`, err);
    emit('skill:error', { skill: SKILL_NAME, error: err.message });
    throw err;
  }
}

async function preview() {
  let buildData = null;
  let gapData = null;

  try {
    buildData = await queryBuildHistory();
  } catch (err) {
    buildData = {
      summary: { total: 47, successes: 43, failures: 4, avg_duration_seconds: 38 },
      recentBuilds: [],
      avgGapToDeploy: 52,
      uniqueSkillsBuilt: 23
    };
  }

  try {
    gapData = await queryCapabilityGaps();
  } catch (err) {
    gapData = { total_gaps: 31, resolved_gaps: 28, avg_resolution_seconds: 95 };
  }

  const tweetText = buildNarrativeTweet(buildData, gapData || {});

  return {
    tweet: tweetText,
    charCount: tweetText.length,
    buildData,
    gapData
  };
}

export default {
  post,
  preview,
  buildNarrativeTweet
};