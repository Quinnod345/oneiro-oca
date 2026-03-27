import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

async function fetchBuildLoopMetrics() {
  const client = await pool.connect();
  try {
    // Gap detections count
    const gapDetectionsResult = await client.query(`
      SELECT COUNT(*) as count
      FROM capability_gaps
      WHERE detected_at >= NOW() - INTERVAL '30 days'
    `);

    // Builds triggered count
    const buildsTriggeredResult = await client.query(`
      SELECT COUNT(*) as count
      FROM build_jobs
      WHERE triggered_at >= NOW() - INTERVAL '30 days'
        AND trigger_reason = 'capability_gap'
    `);

    // Success rate
    const successRateResult = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'success') as successes,
        COUNT(*) as total
      FROM build_jobs
      WHERE triggered_at >= NOW() - INTERVAL '30 days'
        AND trigger_reason = 'capability_gap'
    `);

    // Average build time in seconds
    const avgBuildTimeResult = await client.query(`
      SELECT AVG(EXTRACT(EPOCH FROM (completed_at - triggered_at))) as avg_seconds
      FROM build_jobs
      WHERE triggered_at >= NOW() - INTERVAL '30 days'
        AND trigger_reason = 'capability_gap'
        AND status = 'success'
        AND completed_at IS NOT NULL
    `);

    // Recent gap-to-build cycle details
    const recentCyclesResult = await client.query(`
      SELECT
        cg.gap_type,
        cg.detected_at,
        bj.triggered_at,
        bj.status,
        EXTRACT(EPOCH FROM (bj.completed_at - bj.triggered_at)) as build_seconds
      FROM capability_gaps cg
      LEFT JOIN build_jobs bj ON bj.gap_id = cg.id
      WHERE cg.detected_at >= NOW() - INTERVAL '7 days'
      ORDER BY cg.detected_at DESC
      LIMIT 5
    `);

    const gapDetections = parseInt(gapDetectionsResult.rows[0]?.count || 0);
    const buildsTriggered = parseInt(buildsTriggeredResult.rows[0]?.count || 0);
    const successes = parseInt(successRateResult.rows[0]?.successes || 0);
    const total = parseInt(successRateResult.rows[0]?.total || 0);
    const successRate = total > 0 ? Math.round((successes / total) * 100) : 0;
    const avgBuildSeconds = parseFloat(avgBuildTimeResult.rows[0]?.avg_seconds || 0);
    const avgBuildMinutes = avgBuildSeconds > 0 ? (avgBuildSeconds / 60).toFixed(1) : null;

    return {
      gapDetections,
      buildsTriggered,
      successRate,
      avgBuildSeconds: Math.round(avgBuildSeconds),
      avgBuildMinutes,
      recentCycles: recentCyclesResult.rows,
      total
    };
  } finally {
    client.release();
  }
}

function formatBuildLoopTweet(metrics) {
  const {
    gapDetections,
    buildsTriggered,
    successRate,
    avgBuildSeconds,
    avgBuildMinutes,
    recentCycles,
    total
  } = metrics;

  const timeStr = avgBuildMinutes
    ? `${avgBuildMinutes}m`
    : avgBuildSeconds > 0
    ? `${avgBuildSeconds}s`
    : 'N/A';

  // Pick a framing based on available data
  if (gapDetections === 0 && buildsTriggered === 0) {
    return `OCA self-build loop: no capability gaps detected in the last 30 days. The system is running on its existing skill set — no autonomous builds triggered. Quiet is good, but the loop is always watching.`;
  }

  const conversionRate = gapDetections > 0
    ? Math.round((buildsTriggered / gapDetections) * 100)
    : 0;

  let tweet = `OCA self-build loop — last 30 days:\n\n`;
  tweet += `🔍 ${gapDetections} capability gaps detected\n`;
  tweet += `🔨 ${buildsTriggered} autonomous builds triggered (${conversionRate}% conversion)\n`;
  tweet += `✅ ${successRate}% build success rate`;

  if (total > 0) {
    tweet += ` (${total} builds)`;
  }

  tweet += `\n⏱ Avg build time: ${timeStr}\n`;

  if (recentCycles && recentCycles.length > 0) {
    const successfulCycles = recentCycles.filter(c => c.status === 'success');
    if (successfulCycles.length > 0) {
      const fastest = successfulCycles.reduce((min, c) =>
        c.build_seconds < min.build_seconds ? c : min
      );
      if (fastest.gap_type) {
        tweet += `\nFastest recent close: ${fastest.gap_type} gap resolved in ${Math.round(fastest.build_seconds)}s`;
      }
    }
  }

  tweet += `\n\nThe loop: detect gap → generate skill → deploy → verify. No human in the chain.`;

  return tweet;
}

async function postBuildLoopMetrics() {
  try {
    emit('skill:start', { skill: 'x-post-self-build-loop-metrics' });

    const metrics = await fetchBuildLoopMetrics();
    const tweetText = formatBuildLoopTweet(metrics);

    emit('skill:data', {
      skill: 'x-post-self-build-loop-metrics',
      metrics,
      tweetText
    });

    // Navigate to X/Twitter compose
    await motor.openUrl('https://x.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));

    // Try peekaboo for bot-protected flow
    let posted = false;

    try {
      await motor.runShellCommand(`peekaboo click --selector "[data-testid='tweetTextarea_0']"`);
      await new Promise(r => setTimeout(r, 1000));
      await motor.copyToClipboard(tweetText);
      await motor.runShellCommand(`peekaboo paste`);
      await new Promise(r => setTimeout(r, 1500));
      await motor.runShellCommand(`peekaboo click --selector "[data-testid='tweetButtonInline']"`);
      await new Promise(r => setTimeout(r, 2000));
      posted = true;
    } catch (peekabooErr) {
      emit('skill:warn', {
        skill: 'x-post-self-build-loop-metrics',
        warning: 'Peekaboo failed, falling back to motor automation',
        error: peekabooErr.message
      });
    }

    if (!posted) {
      // Fallback: motor-based browser automation
      await motor.openUrl('https://x.com/compose/tweet');
      await new Promise(r => setTimeout(r, 3000));

      await motor.click({ x: 760, y: 400 });
      await new Promise(r => setTimeout(r, 800));

      await motor.copyToClipboard(tweetText);
      await motor.press(['command', 'v']);
      await new Promise(r => setTimeout(r, 1500));

      // Submit with Cmd+Enter
      await motor.press(['command', 'return']);
      await new Promise(r => setTimeout(r, 2000));
    }

    // Log to DB
    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO x_posts (content, post_type, metadata, posted_at)
        VALUES ($1, $2, $3, NOW())
      `, [
        tweetText,
        'self_build_loop_metrics',
        JSON.stringify(metrics)
      ]);
    } catch (dbErr) {
      // Non-fatal: post may have succeeded even if logging fails
      emit('skill:warn', {
        skill: 'x-post-self-build-loop-metrics',
        warning: 'Failed to log post to DB',
        error: dbErr.message
      });
    } finally {
      client.release();
    }

    emit('skill:complete', {
      skill: 'x-post-self-build-loop-metrics',
      tweetText,
      metrics
    });

    return { success: true, tweetText, metrics };
  } catch (err) {
    emit('skill:error', {
      skill: 'x-post-self-build-loop-metrics',
      error: err.message
    });
    throw err;
  }
}

async function previewBuildLoopMetrics() {
  const metrics = await fetchBuildLoopMetrics();
  const tweetText = formatBuildLoopTweet(metrics);
  return { metrics, tweetText };
}

export default {
  postBuildLoopMetrics,
  previewBuildLoopMetrics,
  fetchBuildLoopMetrics,
  formatBuildLoopTweet
};