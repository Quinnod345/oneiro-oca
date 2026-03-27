import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const TWEET_CHAR_LIMIT = 280;

function truncate(text, limit = TWEET_CHAR_LIMIT) {
  if (text.length <= limit) return text;
  return text.slice(0, limit - 3) + '...';
}

async function getBuildIntegrityData() {
  try {
    const client = await pool.connect();
    try {
      const integrityResult = await client.query(`
        SELECT 
          status,
          error_message,
          detected_at,
          resolved_at,
          recovery_mechanism,
          build_loop_id
        FROM build_loop_integrity_checks
        ORDER BY detected_at DESC
        LIMIT 10
      `);

      const metricsResult = await client.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'corrupted') as corrupted_count,
          COUNT(*) FILTER (WHERE status = 'recovered') as recovered_count,
          COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
          COUNT(*) FILTER (WHERE status = 'healthy') as healthy_count,
          AVG(EXTRACT(EPOCH FROM (resolved_at - detected_at))) as avg_recovery_seconds
        FROM build_loop_integrity_checks
        WHERE detected_at > NOW() - INTERVAL '7 days'
      `);

      const recentFailures = await client.query(`
        SELECT 
          b.id,
          b.status,
          b.error_message,
          b.created_at,
          b.completed_at,
          b.skill_name
        FROM build_outcomes b
        WHERE b.status IN ('failed', 'corrupted', 'integrity_error')
        ORDER BY b.created_at DESC
        LIMIT 5
      `);

      return {
        recentChecks: integrityResult.rows,
        metrics: metricsResult.rows[0] || {},
        recentFailures: recentFailures.rows
      };
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('[x-post-self-build-integrity] DB query failed, using defaults:', err.message);
    return {
      recentChecks: [],
      metrics: {},
      recentFailures: []
    };
  }
}

function composeTweet(data) {
  const { metrics, recentChecks, recentFailures } = data;

  const corruptedCount = parseInt(metrics.corrupted_count) || 0;
  const recoveredCount = parseInt(metrics.recovered_count) || 0;
  const failedCount = parseInt(metrics.failed_count) || 0;
  const healthyCount = parseInt(metrics.healthy_count) || 0;
  const avgRecoverySecs = parseFloat(metrics.avg_recovery_seconds) || 0;

  const totalChecks = corruptedCount + recoveredCount + failedCount + healthyCount;
  const recoveryRate = totalChecks > 0
    ? Math.round((recoveredCount / Math.max(corruptedCount + failedCount, 1)) * 100)
    : 0;

  const avgRecoveryMin = avgRecoverySecs > 0
    ? (avgRecoverySecs / 60).toFixed(1)
    : null;

  const latestCheck = recentChecks[0];
  const latestStatus = latestCheck?.status || 'unknown';
  const latestMechanism = latestCheck?.recovery_mechanism || null;

  let tweet = '';

  if (corruptedCount === 0 && failedCount === 0) {
    tweet = `🔒 Self-build integrity: CLEAN\n\nOneiro's build loop has run ${healthyCount} healthy cycles this week with zero corruption detected.\n\nWhen the builder itself breaks, everything downstream breaks. That's why integrity verification runs before every self-modification.\n\n#AI #SelfImprovement #Oneiro`;
  } else if (corruptedCount > 0 && recoveredCount >= corruptedCount) {
    const recoveryStr = avgRecoveryMin ? ` avg recovery: ${avgRecoveryMin}m` : '';
    tweet = `🔄 Self-build integrity: RECOVERED\n\n${corruptedCount} corrupted build loop${corruptedCount > 1 ? 's' : ''} detected this week → ${recoveredCount} recovered (${recoveryRate}% rate)${recoveryStr}\n\nRecovery mechanism: ${latestMechanism || 'snapshot rollback + re-verification'}\n\nA broken builder can't fix itself — unless it knows it's broken.\n\n#AI #SelfImprovement #Oneiro`;
  } else if (failedCount > 0) {
    tweet = `⚠️ Self-build integrity: DEGRADED\n\n${failedCount} build loop failure${failedCount > 1 ? 's' : ''} this week. ${recoveredCount} recovered, ${failedCount - recoveredCount} still unresolved.\n\nDetection → isolation → rollback → re-verify. The loop must be trustworthy before it can improve anything.\n\n#AI #SelfImprovement #Oneiro`;
  } else {
    tweet = `🧠 Self-build integrity check:\n\nStatus: ${latestStatus}\nCorrupted: ${corruptedCount} | Recovered: ${recoveredCount} | Healthy: ${healthyCount}\n\nOneiro monitors its own build loop for corruption. A self-improving system that can't detect its own failures isn't safe to run.\n\n#AI #SelfImprovement #Oneiro`;
  }

  return truncate(tweet);
}

async function postViaBrowser(tweetText) {
  try {
    await motor.openUrl('https://twitter.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));

    await motor.click({ x: 760, y: 400 });
    await new Promise(r => setTimeout(r, 1000));

    await motor.copyToClipboard(tweetText);
    await motor.press(['command', 'v']);
    await new Promise(r => setTimeout(r, 1500));

    await motor.press(['command', 'Return']);
    await new Promise(r => setTimeout(r, 3000));

    return { success: true, method: 'browser' };
  } catch (err) {
    throw new Error(`Browser post failed: ${err.message}`);
  }
}

async function postViaPeekaboo(tweetText) {
  try {
    const escapedText = tweetText.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const result = await motor.runShellCommand(
      `peekaboo tweet post --text "${escapedText}"`
    );

    if (result && result.includes('error')) {
      throw new Error(`Peekaboo error: ${result}`);
    }

    return { success: true, method: 'peekaboo', output: result };
  } catch (err) {
    throw new Error(`Peekaboo post failed: ${err.message}`);
  }
}

async function logPostAttempt(tweetText, result, error = null) {
  try {
    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO x_posts (
          content,
          post_type,
          status,
          method,
          error_message,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
      `, [
        tweetText,
        'self-build-integrity',
        error ? 'failed' : 'posted',
        result?.method || 'unknown',
        error ? error.message : null
      ]);
    } finally {
      client.release();
    }
  } catch (dbErr) {
    console.warn('[x-post-self-build-integrity] Failed to log post attempt:', dbErr.message);
  }
}

async function postSelfBuildIntegrity(options = {}) {
  const { method = 'auto', dryRun = false } = options;

  emit('skill:start', { skill: 'x-post-self-build-integrity', options });

  try {
    const data = await getBuildIntegrityData();
    const tweetText = composeTweet(data);

    console.log('[x-post-self-build-integrity] Composed tweet:');
    console.log(tweetText);
    console.log(`[x-post-self-build-integrity] Length: ${tweetText.length} chars`);

    if (dryRun) {
      emit('skill:complete', { skill: 'x-post-self-build-integrity', dryRun: true, tweetText });
      return { success: true, dryRun: true, tweetText };
    }

    let result;
    let lastError;

    if (method === 'peekaboo' || method === 'auto') {
      try {
        result = await postViaPeekaboo(tweetText);
      } catch (err) {
        lastError = err;
        console.warn('[x-post-self-build-integrity] Peekaboo failed, trying browser:', err.message);
      }
    }

    if (!result && (method === 'browser' || method === 'auto')) {
      try {
        result = await postViaBrowser(tweetText);
      } catch (err) {
        lastError = err;
        console.error('[x-post-self-build-integrity] Browser fallback also failed:', err.message);
      }
    }

    if (!result) {
      const error = lastError || new Error('All posting methods failed');
      await logPostAttempt(tweetText, null, error);
      emit('skill:error', { skill: 'x-post-self-build-integrity', error: error.message });
      throw error;
    }

    await logPostAttempt(tweetText, result);

    emit('skill:complete', {
      skill: 'x-post-self-build-integrity',
      method: result.method,
      tweetLength: tweetText.length
    });

    return {
      success: true,
      method: result.method,
      tweetText,
      tweetLength: tweetText.length
    };

  } catch (err) {
    emit('skill:error', { skill: 'x-post-self-build-integrity', error: err.message });
    throw err;
  }
}

async function previewTweet() {
  const data = await getBuildIntegrityData();
  const tweetText = composeTweet(data);

  return {
    tweetText,
    tweetLength: tweetText.length,
    data
  };
}

export default {
  postSelfBuildIntegrity,
  previewTweet,
  composeTweet,
  getBuildIntegrityData
};