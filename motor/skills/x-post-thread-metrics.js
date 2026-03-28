import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

async function fetchBuildMetrics() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT
        COUNT(*) AS total_attempts,
        COUNT(*) FILTER (WHERE status = 'success') AS successes,
        COUNT(*) FILTER (WHERE status = 'failure' OR status = 'failed') AS failures,
        COUNT(*) FILTER (WHERE status = 'partial') AS partials,
        MAX(created_at) AS last_build,
        MIN(created_at) AS first_build,
        ROUND(
          COUNT(*) FILTER (WHERE status = 'success')::numeric /
          NULLIF(COUNT(*), 0) * 100, 1
        ) AS success_rate
      FROM build_history
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `);

    const row = result.rows[0];

    const recentResult = await client.query(`
      SELECT status, skill_name, created_at, error_message
      FROM build_history
      ORDER BY created_at DESC
      LIMIT 5
    `);

    const streakResult = await client.query(`
      SELECT status
      FROM build_history
      ORDER BY created_at DESC
      LIMIT 20
    `);

    let currentStreak = 0;
    let streakType = null;
    for (const r of streakResult.rows) {
      if (streakType === null) {
        streakType = r.status === 'success' ? 'success' : 'failure';
      }
      const isSuccess = r.status === 'success';
      if ((streakType === 'success' && isSuccess) || (streakType === 'failure' && !isSuccess)) {
        currentStreak++;
      } else {
        break;
      }
    }

    return {
      totalAttempts: parseInt(row.total_attempts) || 0,
      successes: parseInt(row.successes) || 0,
      failures: parseInt(row.failures) || 0,
      partials: parseInt(row.partials) || 0,
      successRate: parseFloat(row.success_rate) || 0,
      lastBuild: row.last_build,
      firstBuild: row.first_build,
      recentBuilds: recentResult.rows,
      currentStreak,
      streakType
    };
  } finally {
    client.release();
  }
}

async function fetchAllTimeBuildMetrics() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT
        COUNT(*) AS total_attempts,
        COUNT(*) FILTER (WHERE status = 'success') AS successes,
        COUNT(*) FILTER (WHERE status = 'failure' OR status = 'failed') AS failures,
        ROUND(
          COUNT(*) FILTER (WHERE status = 'success')::numeric /
          NULLIF(COUNT(*), 0) * 100, 1
        ) AS success_rate
      FROM build_history
    `);

    const row = result.rows[0];
    return {
      totalAttempts: parseInt(row.total_attempts) || 0,
      successes: parseInt(row.successes) || 0,
      failures: parseInt(row.failures) || 0,
      successRate: parseFloat(row.success_rate) || 0
    };
  } finally {
    client.release();
  }
}

async function fetchTopFailingSkills() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT skill_name, COUNT(*) AS fail_count
      FROM build_history
      WHERE (status = 'failure' OR status = 'failed')
        AND created_at >= NOW() - INTERVAL '30 days'
        AND skill_name IS NOT NULL
      GROUP BY skill_name
      ORDER BY fail_count DESC
      LIMIT 3
    `);
    return result.rows;
  } finally {
    client.release();
  }
}

function formatMetricsPost(metrics, allTime, topFailing) {
  const { totalAttempts, successes, failures, partials, successRate, currentStreak, streakType } = metrics;

  const streakEmoji = streakType === 'success' ? '🔥' : '💀';
  const streakLabel = streakType === 'success' ? 'win streak' : 'fail streak';

  let post = `🧵 3/ Build-in-public: Real numbers, no spin.\n\n`;
  post += `📊 Last 30 days:\n`;
  post += `• Attempts: ${totalAttempts}\n`;
  post += `• ✅ Successes: ${successes}\n`;
  post += `• ❌ Failures: ${failures}\n`;

  if (partials > 0) {
    post += `• ⚠️ Partial: ${partials}\n`;
  }

  post += `• Success rate: ${successRate}%\n\n`;

  if (currentStreak > 1) {
    post += `${streakEmoji} Current ${streakLabel}: ${currentStreak}\n\n`;
  }

  if (allTime && allTime.totalAttempts > totalAttempts) {
    post += `🗂 All-time: ${allTime.totalAttempts} attempts, ${allTime.successRate}% success\n\n`;
  }

  if (topFailing && topFailing.length > 0) {
    post += `🔴 Most-failed skills:\n`;
    for (const skill of topFailing) {
      post += `• ${skill.skill_name}: ${skill.fail_count}x\n`;
    }
    post += `\n`;
  }

  post += `Every failure is logged. Every fix is shipped.\n#buildinpublic #AI #OCA`;

  return post.trim();
}

async function composeAndPost(postText) {
  try {
    await motor.openUrl('https://x.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));

    await motor.click({ x: 760, y: 400 });
    await new Promise(r => setTimeout(r, 1000));

    await motor.copyToClipboard(postText);
    await new Promise(r => setTimeout(r, 500));

    await motor.press('cmd+v');
    await new Promise(r => setTimeout(r, 1500));

    await motor.click({ x: 1150, y: 580 });
    await new Promise(r => setTimeout(r, 3000));

    return { success: true, method: 'browser' };
  } catch (err) {
    return { success: false, error: err.message, method: 'browser' };
  }
}

async function postThreadMetrics(options = {}) {
  const { dryRun = false, usePeekaboo = false } = options;

  emit('skill:start', { skill: 'x-post-thread-metrics', timestamp: new Date() });

  let metrics, allTime, topFailing;

  try {
    metrics = await fetchBuildMetrics();
    allTime = await fetchAllTimeBuildMetrics();
    topFailing = await fetchTopFailingSkills();
  } catch (err) {
    emit('skill:error', { skill: 'x-post-thread-metrics', error: err.message });
    return {
      success: false,
      error: `Failed to fetch build metrics: ${err.message}`
    };
  }

  const postText = formatMetricsPost(metrics, allTime, topFailing);

  emit('skill:data', {
    skill: 'x-post-thread-metrics',
    metrics,
    allTime,
    topFailing,
    postText
  });

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      postText,
      metrics,
      allTime,
      topFailing
    };
  }

  let result;

  if (usePeekaboo) {
    try {
      const escaped = postText.replace(/'/g, "'\\''");
      const cmd = `peekaboo x post '${escaped}'`;
      const output = await motor.runShellCommand(cmd);
      result = { success: true, method: 'peekaboo', output };
    } catch (err) {
      result = { success: false, error: err.message, method: 'peekaboo' };
    }
  } else {
    result = await composeAndPost(postText);
  }

  if (result.success) {
    emit('skill:complete', {
      skill: 'x-post-thread-metrics',
      postText,
      metrics,
      method: result.method
    });

    try {
      const client = await pool.connect();
      try {
        await client.query(`
          INSERT INTO x_posts (content, skill_name, post_type, created_at)
          VALUES ($1, $2, $3, NOW())
        `, [postText, 'x-post-thread-metrics', 'thread-metrics']);
      } finally {
        client.release();
      }
    } catch (dbErr) {
      // Non-fatal: log but don't fail
      emit('skill:warning', { skill: 'x-post-thread-metrics', warning: `DB log failed: ${dbErr.message}` });
    }
  } else {
    emit('skill:error', {
      skill: 'x-post-thread-metrics',
      error: result.error,
      method: result.method
    });
  }

  return {
    ...result,
    postText,
    metrics,
    allTime,
    topFailing
  };
}

async function getMetricsSummary() {
  try {
    const metrics = await fetchBuildMetrics();
    const allTime = await fetchAllTimeBuildMetrics();
    const topFailing = await fetchTopFailingSkills();
    return { success: true, metrics, allTime, topFailing };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function previewPost(options = {}) {
  return postThreadMetrics({ ...options, dryRun: true });
}

export default {
  postThreadMetrics,
  getMetricsSummary,
  previewPost,
  fetchBuildMetrics,
  fetchAllTimeBuildMetrics,
  fetchTopFailingSkills,
  formatMetricsPost
};