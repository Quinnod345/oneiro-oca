import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const CAPABILITY_GAPS_THREAD = {
  topic: 'capability-gaps',
  hashtags: ['#BuildInPublic', '#CognitiveArchitecture', '#AI', '#Oneiro'],
};

async function fetchCapabilityGaps() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        cg.gap_name,
        cg.gap_type,
        cg.severity,
        cg.description,
        cg.first_detected_at,
        cg.last_seen_at,
        cg.occurrence_count,
        cg.resolution_attempts,
        cg.resolved,
        cg.resolution_notes,
        cg.affected_skill,
        cg.root_cause
      FROM capability_gaps cg
      WHERE cg.resolved = false
      ORDER BY cg.severity DESC, cg.occurrence_count DESC
      LIMIT 20
    `);
    return result.rows;
  } catch (err) {
    console.error('[x-post-thread-reply-capability-gaps] DB error fetching gaps:', err.message);
    return [];
  } finally {
    client.release();
  }
}

async function fetchRecentFailures() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        skill_name,
        error_message,
        error_type,
        created_at,
        context
      FROM capability_misses
      WHERE created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 10
    `);
    return result.rows;
  } catch (err) {
    console.error('[x-post-thread-reply-capability-gaps] DB error fetching failures:', err.message);
    return [];
  } finally {
    client.release();
  }
}

async function fetchBuildOutcomes() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        outcome,
        COUNT(*) as count,
        AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms ELSE 0 END) as avg_duration_ms
      FROM build_outcomes
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY outcome
      ORDER BY count DESC
    `);
    return result.rows;
  } catch (err) {
    console.error('[x-post-thread-reply-capability-gaps] DB error fetching build outcomes:', err.message);
    return [];
  } finally {
    client.release();
  }
}

async function fetchCapabilityInventory() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        skill_name,
        capability_type,
        status,
        last_invoked_at,
        success_rate,
        total_invocations
      FROM capability_inventory
      WHERE status IN ('degraded', 'missing', 'failing')
      ORDER BY success_rate ASC
      LIMIT 10
    `);
    return result.rows;
  } catch (err) {
    console.error('[x-post-thread-reply-capability-gaps] DB error fetching inventory:', err.message);
    return [];
  } finally {
    client.release();
  }
}

function buildThreadTweets(gaps, failures, buildOutcomes, degradedCapabilities) {
  const tweets = [];
  const now = new Date().toISOString().split('T')[0];

  // Tweet 1: Hook
  tweets.push(
    `🧠 Oneiro Cognitive Architecture — Capability Gap Report (${now})\n\n` +
    `What's broken, what's missing, what we're building next.\n\n` +
    `Honest, technical, build-in-public thread. 🧵\n\n` +
    `${CAPABILITY_GAPS_THREAD.hashtags.join(' ')}`
  );

  // Tweet 2: Open gaps summary
  const criticalGaps = gaps.filter(g => g.severity === 'critical');
  const highGaps = gaps.filter(g => g.severity === 'high');
  const mediumGaps = gaps.filter(g => g.severity === 'medium');

  tweets.push(
    `📊 Current Open Capability Gaps:\n\n` +
    `🔴 Critical: ${criticalGaps.length}\n` +
    `🟠 High: ${highGaps.length}\n` +
    `🟡 Medium: ${mediumGaps.length}\n` +
    `📋 Total unresolved: ${gaps.length}\n\n` +
    `These aren't bugs — they're architectural limits we haven't crossed yet.`
  );

  // Tweet 3: Critical gaps detail
  if (criticalGaps.length > 0) {
    const topCritical = criticalGaps.slice(0, 3);
    let criticalText = `🔴 Critical Gaps (what's actively blocking Oneiro):\n\n`;
    topCritical.forEach((gap, i) => {
      criticalText += `${i + 1}. ${gap.gap_name}\n`;
      if (gap.description) {
        const shortDesc = gap.description.length > 80 ? gap.description.substring(0, 77) + '...' : gap.description;
        criticalText += `   → ${shortDesc}\n`;
      }
    });
    tweets.push(criticalText.trim());
  }

  // Tweet 4: What failed this week
  if (failures.length > 0) {
    const failureTypes = {};
    failures.forEach(f => {
      const type = f.error_type || 'unknown';
      failureTypes[type] = (failureTypes[type] || 0) + 1;
    });

    let failText = `💥 What Failed This Week (last 7 days):\n\n`;
    Object.entries(failureTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([type, count]) => {
        failText += `• ${type}: ${count} occurrence${count > 1 ? 's' : ''}\n`;
      });

    const topFailure = failures[0];
    if (topFailure) {
      const shortErr = topFailure.error_message
        ? topFailure.error_message.substring(0, 100)
        : 'unknown error';
      failText += `\nMost recent: "${shortErr}"`;
    }

    tweets.push(failText.trim());
  }

  // Tweet 5: Build loop health
  if (buildOutcomes.length > 0) {
    const total = buildOutcomes.reduce((sum, o) => sum + parseInt(o.count), 0);
    const successes = buildOutcomes.find(o => o.outcome === 'success');
    const failures_count = buildOutcomes.find(o => o.outcome === 'failure' || o.outcome === 'failed');
    const successRate = successes ? ((parseInt(successes.count) / total) * 100).toFixed(1) : '0.0';

    tweets.push(
      `🔄 Self-Build Loop Health (7 days):\n\n` +
      `Total builds: ${total}\n` +
      `✅ Success rate: ${successRate}%\n` +
      `❌ Failures: ${failures_count ? failures_count.count : 0}\n\n` +
      `The loop runs. But ${100 - parseFloat(successRate)}% of attempts still fail.\n` +
      `That gap is the frontier we're working at.`
    );
  }

  // Tweet 6: Degraded capabilities
  if (degradedCapabilities.length > 0) {
    let degradedText = `⚠️ Degraded/Missing Capabilities:\n\n`;
    degradedCapabilities.slice(0, 5).forEach(cap => {
      const rate = cap.success_rate !== null ? `${(parseFloat(cap.success_rate) * 100).toFixed(0)}%` : 'N/A';
      degradedText += `• ${cap.skill_name} [${cap.status}] — success: ${rate}\n`;
    });
    degradedText += `\nThese skills exist but aren't reliable enough to trust.`;
    tweets.push(degradedText.trim());
  }

  // Tweet 7: Specific architectural gaps
  const architecturalGaps = gaps.filter(g =>
    g.gap_type === 'architectural' || g.gap_type === 'reasoning' || g.gap_type === 'memory'
  ).slice(0, 3);

  if (architecturalGaps.length > 0) {
    let archText = `🏗️ Architectural Gaps (deeper structural problems):\n\n`;
    architecturalGaps.forEach((gap, i) => {
      archText += `${i + 1}. ${gap.gap_name}\n`;
      if (gap.root_cause) {
        const shortCause = gap.root_cause.length > 80 ? gap.root_cause.substring(0, 77) + '...' : gap.root_cause;
        archText += `   Root cause: ${shortCause}\n`;
      }
      if (gap.resolution_attempts > 0) {
        archText += `   Attempts: ${gap.resolution_attempts} (still open)\n`;
      }
    });
    tweets.push(archText.trim());
  }

  // Tweet 8: What needs to be built next
  const highPriorityGaps = gaps
    .filter(g => (g.severity === 'critical' || g.severity === 'high') && g.resolution_attempts < 3)
    .slice(0, 4);

  if (highPriorityGaps.length > 0) {
    let nextText = `🔨 What Needs to Be Built Next:\n\n`;
    highPriorityGaps.forEach((gap, i) => {
      nextText += `${i + 1}. ${gap.gap_name}`;
      if (gap.affected_skill) {
        nextText += ` (affects: ${gap.affected_skill})`;
      }
      nextText += '\n';
    });
    nextText += `\nThese are the next targets for the self-build loop.`;
    tweets.push(nextText.trim());
  }

  // Tweet 9: Honest assessment of what Oneiro cannot do yet
  tweets.push(
    `🚫 What Oneiro Cannot Do Yet (honest list):\n\n` +
    `• Reliably reason across long causal chains\n` +
    `• Self-correct mid-execution without restart\n` +
    `• Maintain coherent context across 24h+ sessions\n` +
    `• Autonomously prioritize which gap to fix first\n` +
    `• Verify its own reasoning is sound (not just syntactically valid)\n\n` +
    `These are hard. We're working on them.`
  );

  // Tweet 10: What's working
  const resolvedCount = gaps.filter(g => g.resolved).length;
  tweets.push(
    `✅ What IS Working:\n\n` +
    `• Self-build loop runs autonomously\n` +
    `• Capability gap detection fires in real-time\n` +
    `• Build outcomes are logged + analyzed\n` +
    `• Motor skills deploy without human intervention\n` +
    `• This thread was generated by Oneiro itself\n\n` +
    `Progress is real. The gaps are real too.`
  );

  // Tweet 11: Closing / CTA
  tweets.push(
    `📡 Following Oneiro's development?\n\n` +
    `We post raw data, failures, and architecture decisions as they happen.\n\n` +
    `No hype. No cherry-picking. Just the actual frontier of what a self-building cognitive system looks like.\n\n` +
    `${CAPABILITY_GAPS_THREAD.hashtags.join(' ')}`
  );

  return tweets;
}

async function postTweetViaPerekaboo(tweetText, isFirstTweet = false, previousTweetUrl = null) {
  try {
    let command;
    if (isFirstTweet) {
      command = `peekaboo tweet --text ${JSON.stringify(tweetText)}`;
    } else if (previousTweetUrl) {
      command = `peekaboo reply --url ${JSON.stringify(previousTweetUrl)} --text ${JSON.stringify(tweetText)}`;
    } else {
      command = `peekaboo tweet --text ${JSON.stringify(tweetText)}`;
    }

    const result = await motor.runShellCommand(command);
    return { success: true, output: result, url: extractTweetUrl(result) };
  } catch (err) {
    console.error('[x-post-thread-reply-capability-gaps] Peekaboo error:', err.message);
    return { success: false, error: err.message };
  }
}

function extractTweetUrl(output) {
  if (!output) return null;
  const urlMatch = output.match(/https:\/\/twitter\.com\/\S+|https:\/\/x\.com\/\S+/);
  return urlMatch ? urlMatch[0] : null;
}

async function postTweetViaBrowser(tweetText, replyToUrl = null) {
  try {
    if (replyToUrl) {
      await motor.openUrl(replyToUrl);
      await new Promise(r => setTimeout(r, 3000));
      await motor.click({ description: 'Reply button on tweet' });
      await new Promise(r => setTimeout(r, 1500));
    } else {
      await motor.openUrl('https://x.com/compose/tweet');
      await new Promise(r => setTimeout(r, 3000));
    }

    await motor.click({ description: 'Tweet compose text area' });
    await new Promise(r => setTimeout(r, 500));

    // Type in chunks to avoid issues with long text
    const chunks = tweetText.match(/.{1,50}/g) || [tweetText];
    for (const chunk of chunks) {
      await motor.type(chunk);
      await new Promise(r => setTimeout(r, 100));
    }

    await new Promise(r => setTimeout(r, 1000));
    await motor.press('cmd+return');
    await new Promise(r => setTimeout(r, 2000));

    return { success: true };
  } catch (err) {
    console.error('[x-post-thread-reply-capability-gaps] Browser post error:', err.message);
    return { success: false, error: err.message };
  }
}

async function logThreadPost(tweets, results) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO x_thread_posts (
        thread_topic,
        tweet_count,
        tweets_json,
        results_json,
        posted_at,
        success
      ) VALUES ($1, $2, $3, $4, NOW(), $5)
    `, [
      CAPABILITY_GAPS_THREAD.topic,
      tweets.length,
      JSON.stringify(tweets),
      JSON.stringify(results),
      results.some(r => r.success)
    ]);
  } catch (err) {
    console.error('[x-post-thread-reply-capability-gaps] DB log error:', err.message);
  } finally {
    client.release();
  }
}

async function postCapabilityGapsThread(options = {}) {
  const { usePeekaboo = true, dryRun