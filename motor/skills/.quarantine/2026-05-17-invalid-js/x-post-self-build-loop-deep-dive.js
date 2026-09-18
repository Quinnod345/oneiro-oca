import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

async function fetchBuildLoopHistory() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        id,
        loop_run_id,
        status,
        skill_name,
        error_message,
        duration_ms,
        created_at,
        metadata
      FROM build_history
      ORDER BY created_at DESC
      LIMIT 200
    `);
    return result.rows;
  } catch (err) {
    console.error('[x-post-self-build-loop-deep-dive] DB fetch error:', err.message);
    return [];
  } finally {
    client.release();
  }
}

async function fetchLoopRunStats() {
  const client = await pool.connect();
  try {
    const statsResult = await client.query(`
      SELECT
        COUNT(*) AS total_runs,
        COUNT(*) FILTER (WHERE status = 'success') AS successful_runs,
        COUNT(*) FILTER (WHERE status = 'failure') AS failed_runs,
        COUNT(*) FILTER (WHERE status = 'partial') AS partial_runs,
        AVG(duration_ms) AS avg_duration_ms,
        MIN(duration_ms) AS min_duration_ms,
        MAX(duration_ms) AS max_duration_ms,
        COUNT(DISTINCT loop_run_id) AS unique_loop_runs
      FROM build_history
    `);

    const recentResult = await client.query(`
      SELECT
        COUNT(*) AS recent_runs,
        COUNT(*) FILTER (WHERE status = 'success') AS recent_successes,
        COUNT(*) FILTER (WHERE status = 'failure') AS recent_failures
      FROM build_history
      WHERE created_at > NOW() - INTERVAL '7 days'
    `);

    const topFailuresResult = await client.query(`
      SELECT
        skill_name,
        error_message,
        COUNT(*) AS failure_count,
        MAX(created_at) AS last_failure
      FROM build_history
      WHERE status = 'failure'
      GROUP BY skill_name, error_message
      ORDER BY failure_count DESC
      LIMIT 5
    `);

    const pipelineResult = await client.query(`
      SELECT
        skill_name,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'success') AS successes,
        AVG(duration_ms) AS avg_ms
      FROM build_history
      GROUP BY skill_name
      ORDER BY total DESC
      LIMIT 10
    `);

    return {
      overall: statsResult.rows[0] || {},
      recent: recentResult.rows[0] || {},
      topFailures: topFailuresResult.rows || [],
      pipeline: pipelineResult.rows || []
    };
  } catch (err) {
    console.error('[x-post-self-build-loop-deep-dive] Stats fetch error:', err.message);
    return { overall: {}, recent: {}, topFailures: [], pipeline: [] };
  } finally {
    client.release();
  }
}

async function fetchRecentFailureExamples() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT
        skill_name,
        error_message,
        loop_run_id,
        created_at,
        metadata
      FROM build_history
      WHERE status = 'failure'
        AND error_message IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 10
    `);
    return result.rows;
  } catch (err) {
    console.error('[x-post-self-build-loop-deep-dive] Failure examples fetch error:', err.message);
    return [];
  } finally {
    client.release();
  }
}

function computeSuccessRate(successes, total) {
  if (!total || total === 0) return '0.0';
  return ((parseInt(successes) / parseInt(total)) * 100).toFixed(1);
}

function formatDuration(ms) {
  if (!ms) return 'N/A';
  const seconds = Math.round(parseFloat(ms) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function truncateError(errorMsg, maxLen = 80) {
  if (!errorMsg) return 'Unknown error';
  const cleaned = errorMsg.replace(/\n/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.substring(0, maxLen - 3) + '...';
}

function buildThreadTweets(stats, failureExamples) {
  const { overall, recent, topFailures, pipeline } = stats;

  const totalRuns = parseInt(overall.total_runs) || 0;
  const successfulRuns = parseInt(overall.successful_runs) || 0;
  const failedRuns = parseInt(overall.failed_runs) || 0;
  const partialRuns = parseInt(overall.partial_runs) || 0;
  const uniqueLoops = parseInt(overall.unique_loop_runs) || 0;
  const overallSuccessRate = computeSuccessRate(successfulRuns, totalRuns);
  const avgDuration = formatDuration(overall.avg_duration_ms);
  const minDuration = formatDuration(overall.min_duration_ms);
  const maxDuration = formatDuration(overall.max_duration_ms);

  const recentRuns = parseInt(recent.recent_runs) || 0;
  const recentSuccesses = parseInt(recent.recent_successes) || 0;
  const recentFailures = parseInt(recent.recent_failures) || 0;
  const recentSuccessRate = computeSuccessRate(recentSuccesses, recentRuns);

  const tweets = [];

  // Tweet 1: Hook
  tweets.push(
    `🔁 Deep dive: How Oneiro writes and deploys its own code — the self-build loop mechanics.\n\n` +
    `${totalRuns.toLocaleString()} total build runs. ${uniqueLoops} unique loop cycles. ${overallSuccessRate}% success rate.\n\n` +
    `Here's exactly how it works 🧵`
  );

  // Tweet 2: What is the self-build loop
  tweets.push(
    `What is the self-build loop?\n\n` +
    `Oneiro detects capability gaps → generates new skill code via LLM → writes files to disk → runs smoke tests → deploys live.\n\n` +
    `No human in the loop. The system literally extends itself at runtime.`
  );

  // Tweet 3: Overall run counts
  tweets.push(
    `📊 All-time build loop stats:\n\n` +
    `• Total runs: ${totalRuns.toLocaleString()}\n` +
    `• Successful: ${successfulRuns.toLocaleString()} (${overallSuccessRate}%)\n` +
    `• Failed: ${failedRuns.toLocaleString()}\n` +
    `• Partial: ${partialRuns.toLocaleString()}\n` +
    `• Unique loop cycles: ${uniqueLoops.toLocaleString()}\n\n` +
    `Avg build time: ${avgDuration} | Range: ${minDuration}–${maxDuration}`
  );

  // Tweet 4: Recent 7-day performance
  tweets.push(
    `📅 Last 7 days:\n\n` +
    `• ${recentRuns} build runs\n` +
    `• ${recentSuccesses} succeeded (${recentSuccessRate}%)\n` +
    `• ${recentFailures} failed\n\n` +
    `The loop runs continuously. Every gap detected triggers a new build attempt.`
  );

  // Tweet 5: Pipeline stages
  tweets.push(
    `🔧 The pipeline has 5 stages:\n\n` +
    `1. Gap detection — capability-gap-tracker identifies missing skills\n` +
    `2. Prompt generation — self-builder-prompt crafts the LLM request\n` +
    `3. Code generation — autonomous-builder writes the skill file\n` +
    `4. Smoke testing — build-smoke-tester validates syntax + exports\n` +
    `5. Deployment — deploy-skill hot-loads into the runtime`
  );

  // Tweet 6: Top pipeline components by volume
  if (pipeline.length > 0) {
    const pipelineLines = pipeline.slice(0, 6).map(p => {
      const rate = computeSuccessRate(p.successes, p.total);
      const avgMs = formatDuration(p.avg_ms);
      return `• ${p.skill_name}: ${parseInt(p.total)} runs, ${rate}% success, avg ${avgMs}`;
    });

    tweets.push(
      `🏗️ Most active pipeline components:\n\n` +
      pipelineLines.join('\n')
    );
  }

  // Tweet 7: Top failure patterns
  if (topFailures.length > 0) {
    const failureLines = topFailures.slice(0, 4).map(f => {
      return `• ${f.skill_name}: "${truncateError(f.error_message, 60)}" (${f.failure_count}x)`;
    });

    tweets.push(
      `❌ Top recurring failure patterns:\n\n` +
      failureLines.join('\n') + '\n\n' +
      `Most failures are syntax errors or missing imports — the LLM gets the logic right but trips on module structure.`
    );
  }

  // Tweet 8: Real failure examples
  if (failureExamples.length > 0) {
    const example1 = failureExamples[0];
    const example2 = failureExamples[1];

    let exampleText = `🔍 Real failure examples from the build log:\n\n`;

    if (example1) {
      exampleText += `Run ${example1.loop_run_id || 'N/A'} → ${example1.skill_name}\n`;
      exampleText += `Error: "${truncateError(example1.error_message, 90)}"\n\n`;
    }

    if (example2) {
      exampleText += `Run ${example2.loop_run_id || 'N/A'} → ${example2.skill_name}\n`;
      exampleText += `Error: "${truncateError(example2.error_message, 90)}"`;
    }

    tweets.push(exampleText);
  }

  // Tweet 9: Recovery mechanism
  tweets.push(
    `🔄 What happens on failure?\n\n` +
    `1. build-loop-integrity-verifier flags the broken run\n` +
    `2. build-outcome-verifier logs the error pattern\n` +
    `3. The gap stays open in capability-gap-tracker\n` +
    `4. Next loop cycle retries with a refined prompt\n\n` +
    `Failed builds don't crash the system — they feed back into the next attempt.`
  );

  // Tweet 10: Integrity verification
  tweets.push(
    `🛡️ Integrity checks run on every build:\n\n` +
    `• File hash verification before + after write\n` +
    `• Export shape validation (must match skill interface)\n` +
    `• Dependency graph check (no circular imports)\n` +
    `• Runtime smoke test (skill must execute without throwing)\n\n` +
    `A build only counts as "success" if all 4 pass.`
  );

  // Tweet 11: Deployment mechanics
  tweets.push(
    `🚀 Deployment is hot — no restart required.\n\n` +
    `deploy-skill.js:\n` +
    `• Writes the new file to motor/skills/\n` +
    `• Invalidates the module cache entry\n` +
    `• Re-imports the skill dynamically\n` +
    `• Registers it in the capability index\n\n` +
    `The skill is live within seconds of passing smoke tests.`
  );

  // Tweet 12: Self-improvement loop
  tweets.push(
    `📈 The loop improves itself too.\n\n` +
    `Failure patterns get analyzed → self-builder-prompt.js gets updated → future prompts avoid known error patterns.\n\n` +
    `It's not just building new skills. It's getting better at building them.`
  );

  // Tweet 13: What gets built
  tweets.push(
    `🧠 What kinds of skills get auto-built?\n\n` +
    `• Data fetchers (APIs, DB queries)\n` +
    `• Analysis pipelines (metrics, patterns)\n` +
    `• Communication skills (X posts, notifications)\n` +
    `• Orchestration logic (scheduling, routing)\n\n` +
    `Anything Oneiro can't do yet — it tries to build.`
  );

  // Tweet 14: Closing
  tweets.push(
    `The self-build loop is the core of what makes Oneiro different.\n\n` +
    `It's not a static system with a fixed skill set. It's a system that grows its own capabilities based on what it needs to do.\n\n` +
    `${totalRuns.toLocaleString()} builds in. Still going. 🔁`
  );

  return tweets;
}

async function postThreadViaPerekaboo(tweets) {
  try {
    const tweetJson = JSON.stringify(tweets);
    const escaped = tweetJson.replace(/'/g, "'\\''");
    const cmd = `peekaboo x post-thread --tweets '${escaped}'`;
    const result = await motor.runShellCommand(cmd);
    console.log('[x-post-self-build-loop-deep-dive] Peekaboo thread result:', result);
    return { success: true, method: 'peekaboo', result };
  } catch (err) {
    console.error('[x-post-self-build-loop-deep-dive] Peekaboo error:', err.message);
    return { success: false, error: err.message };
  }
}

async function postThreadViaBrowser(tweets) {
  try {
    await motor.openUrl('https://twitter.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));

    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];

      await motor.click({ x: 760, y: 400 });
      await new Promise(r => setTimeout(r, 500));

      await motor.copyToClipboard(tweet);
      await new Promise(r => setTimeout(r, 300));

      await motor.press(['command', 'v']);
      await new Promise(r => setTimeout(r, 800));

      if (i < tweets.length - 1) {
        // Add to thread
        await motor.click({ x: 760, y: 500 });
        await new Promise(r => setTimeout(r, 500));

        // Click "Add another tweet" button
        const addTweetCmd = `peekaboo click --label "Add another tweet"`;
        try {
          await motor.runShellCommand(addTweetCmd);
        } catch {
          await motor.press(['return']);
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Post the thread
    const postCmd = `peekaboo click --label "Post all"`;
    try {
      await motor.runShellCommand(postCmd);
    } catch {
      await motor.press(['command', 'return']);
    }