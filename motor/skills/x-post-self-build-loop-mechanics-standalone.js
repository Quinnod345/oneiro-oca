import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

async function fetchLoopMechanicsData() {
  const client = await pool.connect();
  try {
    // Get total capability count
    const capabilityCountResult = await client.query(`
      SELECT COUNT(*) as total
      FROM motor_skills
      WHERE active = true
    `);

    // Get recent loop timing data
    const loopTimingResult = await client.query(`
      SELECT 
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_loop_seconds,
        MIN(EXTRACT(EPOCH FROM (completed_at - started_at))) as min_loop_seconds,
        MAX(EXTRACT(EPOCH FROM (completed_at - started_at))) as max_loop_seconds,
        COUNT(*) as total_loops
      FROM build_runs
      WHERE completed_at IS NOT NULL
        AND started_at > NOW() - INTERVAL '7 days'
    `);

    // Get failure rate
    const failureRateResult = await client.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'failed') as failures,
        COUNT(*) FILTER (WHERE status = 'success') as successes,
        COUNT(*) as total,
        ROUND(
          COUNT(*) FILTER (WHERE status = 'failed')::numeric / NULLIF(COUNT(*), 0) * 100, 1
        ) as failure_rate_pct
      FROM build_runs
      WHERE started_at > NOW() - INTERVAL '7 days'
    `);

    // Get capability miss events — what happens when a capability is missing
    const capabilityMissResult = await client.query(`
      SELECT 
        COUNT(*) as total_misses,
        COUNT(DISTINCT capability_name) as unique_missing_caps,
        AVG(EXTRACT(EPOCH FROM (resolved_at - detected_at))) as avg_resolution_seconds,
        COUNT(*) FILTER (WHERE auto_resolved = true) as auto_resolved_count,
        COUNT(*) FILTER (WHERE auto_resolved = false) as manual_count
      FROM capability_gaps
      WHERE detected_at > NOW() - INTERVAL '7 days'
    `);

    // Get the most recent capability miss details
    const recentMissResult = await client.query(`
      SELECT 
        capability_name,
        trigger_context,
        auto_resolved,
        EXTRACT(EPOCH FROM (resolved_at - detected_at)) as resolution_seconds,
        detected_at
      FROM capability_gaps
      WHERE detected_at > NOW() - INTERVAL '7 days'
      ORDER BY detected_at DESC
      LIMIT 5
    `);

    // Get build loop stage breakdown
    const stageBreakdownResult = await client.query(`
      SELECT 
        stage,
        COUNT(*) as count,
        COUNT(*) FILTER (WHERE outcome = 'failed') as failures,
        AVG(EXTRACT(EPOCH FROM duration)) as avg_duration_seconds
      FROM build_stages
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY stage
      ORDER BY count DESC
    `);

    // Get self-build trigger sources
    const triggerSourceResult = await client.query(`
      SELECT 
        trigger_source,
        COUNT(*) as count
      FROM build_runs
      WHERE started_at > NOW() - INTERVAL '7 days'
      GROUP BY trigger_source
      ORDER BY count DESC
      LIMIT 5
    `);

    return {
      capabilityCount: parseInt(capabilityCountResult.rows[0]?.total || 0),
      loopTiming: loopTimingResult.rows[0] || {},
      failureRate: failureRateResult.rows[0] || {},
      capabilityMisses: capabilityMissResult.rows[0] || {},
      recentMisses: recentMissResult.rows || [],
      stageBreakdown: stageBreakdownResult.rows || [],
      triggerSources: triggerSourceResult.rows || []
    };
  } finally {
    client.release();
  }
}

function composeTweet(data) {
  const {
    capabilityCount,
    loopTiming,
    failureRate,
    capabilityMisses,
    recentMisses,
    stageBreakdown,
    triggerSources
  } = data;

  const avgLoopMin = loopTiming.avg_loop_seconds
    ? (parseFloat(loopTiming.avg_loop_seconds) / 60).toFixed(1)
    : null;
  const minLoopSec = loopTiming.min_loop_seconds
    ? Math.round(parseFloat(loopTiming.min_loop_seconds))
    : null;
  const maxLoopMin = loopTiming.max_loop_seconds
    ? (parseFloat(loopTiming.max_loop_seconds) / 60).toFixed(1)
    : null;

  const failurePct = failureRate.failure_rate_pct
    ? parseFloat(failureRate.failure_rate_pct)
    : null;
  const totalLoops = parseInt(failureRate.total || 0);

  const totalMisses = parseInt(capabilityMisses.total_misses || 0);
  const uniqueMissing = parseInt(capabilityMisses.unique_missing_caps || 0);
  const autoResolved = parseInt(capabilityMisses.auto_resolved_count || 0);
  const avgResolutionMin = capabilityMisses.avg_resolution_seconds
    ? (parseFloat(capabilityMisses.avg_resolution_seconds) / 60).toFixed(1)
    : null;

  // Find the most common failure stage
  const failureStage = stageBreakdown
    .filter(s => s.failures > 0)
    .sort((a, b) => b.failures - a.failures)[0];

  // Find the most recent miss for a concrete example
  const exampleMiss = recentMisses[0];

  // Build the tweet
  const lines = [];

  lines.push(`OCA self-build loop mechanics — actual numbers from the last 7 days:`);
  lines.push(``);

  if (capabilityCount > 0) {
    lines.push(`📦 ${capabilityCount} active capabilities in the motor layer`);
  }

  if (totalLoops > 0 && avgLoopMin) {
    lines.push(`🔄 ${totalLoops} build loops run`);
    lines.push(`⏱ avg loop: ${avgLoopMin}m | fastest: ${minLoopSec}s | slowest: ${maxLoopMin}m`);
  }

  if (failurePct !== null) {
    lines.push(`❌ failure rate: ${failurePct}% (${failureRate.failures}/${totalLoops})`);
  }

  lines.push(``);

  if (totalMisses > 0) {
    lines.push(`What happens when a capability is missing:`);
    lines.push(`→ capability-miss-detector fires`);
    lines.push(`→ gap logged to capability_gaps table`);
    lines.push(`→ gap-auto-resolver attempts build`);

    if (autoResolved > 0 && totalMisses > 0) {
      const autoResolvedPct = Math.round((autoResolved / totalMisses) * 100);
      lines.push(`→ ${autoResolvedPct}% auto-resolved (${autoResolved}/${totalMisses} misses)`);
    }

    if (avgResolutionMin) {
      lines.push(`→ avg time to resolution: ${avgResolutionMin}m`);
    }
  }

  if (exampleMiss) {
    lines.push(``);
    lines.push(`Recent example: "${exampleMiss.capability_name}" was missing`);
    if (exampleMiss.trigger_context) {
      const ctx = exampleMiss.trigger_context.substring(0, 60);
      lines.push(`Context: ${ctx}${exampleMiss.trigger_context.length > 60 ? '...' : ''}`);
    }
    if (exampleMiss.resolution_seconds) {
      const resSec = Math.round(parseFloat(exampleMiss.resolution_seconds));
      lines.push(`Resolved in: ${resSec < 60 ? resSec + 's' : (resSec / 60).toFixed(1) + 'm'} | auto: ${exampleMiss.auto_resolved ? 'yes' : 'no'}`);
    }
  }

  if (failureStage) {
    lines.push(``);
    lines.push(`Most failures happen at stage: ${failureStage.stage} (${failureStage.failures} failures)`);
  }

  lines.push(``);
  lines.push(`The loop doesn't stop when something's missing — it builds what it needs and continues.`);

  const tweet = lines.join('\n');

  // Twitter limit is 280 chars — if over, trim gracefully
  if (tweet.length <= 280) return tweet;

  // Fallback: shorter version
  const shortLines = [];
  shortLines.push(`OCA self-build loop — 7-day mechanics:`);
  shortLines.push(``);
  if (capabilityCount > 0) shortLines.push(`${capabilityCount} active capabilities`);
  if (totalLoops > 0 && avgLoopMin) shortLines.push(`${totalLoops} loops | avg ${avgLoopMin}m each`);
  if (failurePct !== null) shortLines.push(`${failurePct}% failure rate`);
  if (totalMisses > 0 && autoResolved > 0) {
    const pct = Math.round((autoResolved / totalMisses) * 100);
    shortLines.push(`${pct}% of capability misses auto-resolved`);
    if (avgResolutionMin) shortLines.push(`avg resolution: ${avgResolutionMin}m`);
  }
  shortLines.push(``);
  shortLines.push(`Missing capability → detect → build → retry. No human in the loop.`);

  return shortLines.join('\n');
}

async function postToX(tweetText) {
  try {
    // Try peekaboo first for bot-protected flow
    const escapedText = tweetText.replace(/'/g, "'\\''");
    const peekabooResult = await motor.runShellCommand(
      `peekaboo tweet --text '${escapedText}'`
    );
    if (peekabooResult && !peekabooResult.includes('error') && !peekabooResult.includes('Error')) {
      return { method: 'peekaboo', result: peekabooResult };
    }
  } catch (peekabooErr) {
    // Fall through to browser automation
  }

  // Browser automation fallback
  await motor.openUrl('https://twitter.com/compose/tweet');
  await new Promise(r => setTimeout(r, 3000));

  await motor.click({ x: 760, y: 400 });
  await new Promise(r => setTimeout(r, 500));

  await motor.copyToClipboard(tweetText);
  await motor.press(['command', 'v']);
  await new Promise(r => setTimeout(r, 1000));

  // Click Tweet button
  await motor.click({ x: 1150, y: 580 });
  await new Promise(r => setTimeout(r, 2000));

  return { method: 'browser', result: 'posted' };
}

async function run() {
  const startedAt = new Date();

  try {
    emit('skill:start', {
      skill: 'x-post-self-build-loop-mechanics-standalone',
      startedAt
    });

    // Fetch real data
    const data = await fetchLoopMechanicsData();

    // Compose tweet
    const tweetText = composeTweet(data);

    // Post to X
    const postResult = await postToX(tweetText);

    // Log to DB
    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO x_posts (
          skill_name,
          tweet_text,
          post_method,
          metadata,
          posted_at
        ) VALUES ($1, $2, $3, $4, NOW())
      `, [
        'x-post-self-build-loop-mechanics-standalone',
        tweetText,
        postResult.method,
        JSON.stringify({
          capabilityCount: data.capabilityCount,
          totalLoops: parseInt(data.failureRate.total || 0),
          failureRate: data.failureRate.failure_rate_pct,
          totalMisses: parseInt(data.capabilityMisses.total_misses || 0),
          autoResolved: parseInt(data.capabilityMisses.auto_resolved_count || 0)
        })
      ]);
    } finally {
      client.release();
    }

    emit('skill:complete', {
      skill: 'x-post-self-build-loop-mechanics-standalone',
      tweetText,
      postResult,
      data: {
        capabilityCount: data.capabilityCount,
        totalLoops: parseInt(data.failureRate.total || 0),
        failureRate: data.failureRate.failure_rate_pct
      }
    });

    return {
      success: true,
      tweetText,
      postResult,
      data
    };
  } catch (err) {
    emit('skill:error', {
      skill: 'x-post-self-build-loop-mechanics-standalone',
      error: err.message,
      stack: err.stack
    });

    throw err;
  }
}

export default {
  run,
  fetchLoopMechanicsData,
  composeTweet,
  postToX
};