import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

async function getFailureRecords() {
  const client = await pool.connect();
  try {
    // Pull from capability gap tracker
    const gapResult = await client.query(`
      SELECT 
        gap_type,
        capability_name,
        error_message,
        root_cause,
        frequency,
        first_seen,
        last_seen,
        resolved,
        resolution_notes
      FROM capability_gaps
      WHERE created_at > NOW() - INTERVAL '30 days'
      ORDER BY frequency DESC
      LIMIT 20
    `);

    // Pull from build historian
    const buildResult = await client.query(`
      SELECT 
        build_id,
        skill_name,
        status,
        error_type,
        error_message,
        stack_trace,
        duration_ms,
        created_at,
        root_cause_category
      FROM build_history
      WHERE status = 'failed'
        AND created_at > NOW() - INTERVAL '30 days'
      ORDER BY created_at DESC
      LIMIT 30
    `);

    // Pull error patterns
    const patternResult = await client.query(`
      SELECT 
        error_pattern,
        occurrence_count,
        affected_skills,
        first_occurrence,
        last_occurrence,
        pattern_category
      FROM error_patterns
      WHERE occurrence_count > 1
      ORDER BY occurrence_count DESC
      LIMIT 10
    `);

    return {
      gaps: gapResult.rows || [],
      builds: buildResult.rows || [],
      patterns: patternResult.rows || []
    };
  } catch (err) {
    // Tables may not exist yet, return empty
    return { gaps: [], builds: [], patterns: [] };
  } finally {
    client.release();
  }
}

function categorizeFailures(builds) {
  const categories = {};
  for (const build of builds) {
    const cat = build.root_cause_category || build.error_type || 'unknown';
    if (!categories[cat]) categories[cat] = 0;
    categories[cat]++;
  }
  return Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
}

function extractTopErrors(builds) {
  const errorMap = {};
  for (const build of builds) {
    const key = build.error_message
      ? build.error_message.substring(0, 80)
      : 'unknown error';
    if (!errorMap[key]) {
      errorMap[key] = { count: 0, skills: new Set(), example: build };
    }
    errorMap[key].count++;
    if (build.skill_name) errorMap[key].skills.add(build.skill_name);
  }
  return Object.entries(errorMap)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([msg, data]) => ({
      message: msg,
      count: data.count,
      skills: Array.from(data.skills).slice(0, 3),
      example: data.example
    }));
}

function formatFailureData(data) {
  const { gaps, builds, patterns } = data;

  const totalBuilds = builds.length;
  const totalGaps = gaps.length;
  const unresolvedGaps = gaps.filter(g => !g.resolved).length;
  const topErrors = extractTopErrors(builds);
  const categories = categorizeFailures(builds);
  const topPatterns = patterns.slice(0, 3);

  const lines = [];

  lines.push(`3/ Real failure data — no spin, just what broke:`);
  lines.push(``);

  if (totalBuilds === 0 && totalGaps === 0) {
    lines.push(`📊 30-day window: insufficient data yet`);
    lines.push(`Build history and gap tracker still accumulating records`);
    lines.push(`Check back as the system runs more cycles`);
    return lines.join('\n');
  }

  // Summary stats
  lines.push(`📊 Last 30 days:`);
  if (totalBuilds > 0) lines.push(`• ${totalBuilds} failed builds logged`);
  if (totalGaps > 0) lines.push(`• ${totalGaps} capability gaps detected (${unresolvedGaps} unresolved)`);

  // Top failure categories
  if (categories.length > 0) {
    lines.push(``);
    lines.push(`🔴 Failure breakdown by root cause:`);
    for (const [cat, count] of categories) {
      const pct = totalBuilds > 0 ? Math.round((count / totalBuilds) * 100) : 0;
      lines.push(`• ${cat}: ${count} (${pct}%)`);
    }
  }

  // Specific errors
  if (topErrors.length > 0) {
    lines.push(``);
    lines.push(`⚠️ Most frequent errors:`);
    for (const err of topErrors.slice(0, 3)) {
      lines.push(`• [${err.count}x] "${err.message.trim()}"`);
      if (err.skills.length > 0) {
        lines.push(`  → in: ${err.skills.join(', ')}`);
      }
    }
  }

  // Gap patterns
  if (gaps.length > 0) {
    const topGaps = gaps.slice(0, 3);
    lines.push(``);
    lines.push(`🕳️ Top capability gaps:`);
    for (const gap of topGaps) {
      lines.push(`• ${gap.capability_name || gap.gap_type}: ${gap.frequency || 1}x`);
      if (gap.root_cause) {
        lines.push(`  root cause: ${gap.root_cause.substring(0, 60)}`);
      }
    }
  }

  // Recurring patterns
  if (topPatterns.length > 0) {
    lines.push(``);
    lines.push(`🔁 Recurring patterns:`);
    for (const p of topPatterns) {
      lines.push(`• "${p.error_pattern?.substring(0, 60) || p.pattern_category}"`);
      lines.push(`  ${p.occurrence_count}x across ${p.affected_skills || 'multiple skills'}`);
    }
  }

  return lines.join('\n');
}

async function findThreadReplyTarget() {
  const client = await pool.connect();
  try {
    // Look for the parent thread post to reply to
    const result = await client.query(`
      SELECT post_id, tweet_id, thread_id, content
      FROM x_posts
      WHERE thread_type = 'build_in_public'
        AND thread_position = 2
        AND created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (result.rows.length > 0) {
      return result.rows[0];
    }

    // Fallback: look for thread reply 2
    const fallback = await client.query(`
      SELECT post_id, tweet_id, thread_id, content
      FROM x_posts
      WHERE thread_position = 2
        AND created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
      LIMIT 1
    `);

    return fallback.rows[0] || null;
  } catch (err) {
    return null;
  } finally {
    client.release();
  }
}

async function savePostRecord(content, tweetId, threadId) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO x_posts (
        content, tweet_id, thread_id, thread_type, 
        thread_position, post_type, created_at
      ) VALUES ($1, $2, $3, 'build_in_public', 3, 'thread_reply', NOW())
      ON CONFLICT DO NOTHING
    `, [content, tweetId, threadId]);
  } catch (err) {
    // Table may not exist
  } finally {
    client.release();
  }
}

async function postThreadFailureData() {
  emit('motor:x-post-thread-failure-data:start', { timestamp: new Date().toISOString() });

  try {
    // Gather failure data
    const failureData = await getFailureRecords();
    const content = formatFailureData(failureData);

    // Find parent post to reply to
    const parentPost = await findThreadReplyTarget();

    // Copy content to clipboard
    await motor.copyToClipboard(content);

    let posted = false;
    let tweetId = null;
    let threadId = parentPost?.thread_id || null;

    // Try peekaboo first for bot-protected flow
    try {
      const replyUrl = parentPost?.tweet_id
        ? `https://twitter.com/intent/tweet?in_reply_to=${parentPost.tweet_id}`
        : 'https://twitter.com/compose/tweet';

      const peekabooResult = await motor.runShellCommand(
        `peekaboo open "${replyUrl}" --wait 3000`
      );

      if (peekabooResult && !peekabooResult.includes('error')) {
        // Type the content
        await motor.runShellCommand(
          `peekaboo type "${content.replace(/"/g, '\\"').replace(/\n/g, '\\n')}" --delay 50`
        );
        await new Promise(r => setTimeout(r, 1000));

        // Submit
        await motor.runShellCommand(`peekaboo key "cmd+return"`);
        await new Promise(r => setTimeout(r, 2000));

        posted = true;
        tweetId = `thread_failure_data_${Date.now()}`;
      }
    } catch (peekabooErr) {
      // Fall through to browser automation
    }

    // Browser automation fallback
    if (!posted) {
      const replyUrl = parentPost?.tweet_id
        ? `https://twitter.com/intent/tweet?in_reply_to=${parentPost.tweet_id}`
        : 'https://twitter.com/compose/tweet';

      await motor.openUrl(replyUrl);
      await new Promise(r => setTimeout(r, 3000));

      // Click compose area
      await motor.click(760, 400);
      await new Promise(r => setTimeout(r, 500));

      // Paste content
      await motor.press('cmd+v');
      await new Promise(r => setTimeout(r, 1000));

      // Submit tweet
      await motor.press('cmd+return');
      await new Promise(r => setTimeout(r, 2000));

      posted = true;
      tweetId = `thread_failure_data_${Date.now()}`;
    }

    if (posted) {
      await savePostRecord(content, tweetId, threadId);

      emit('motor:x-post-thread-failure-data:success', {
        content,
        tweetId,
        threadId,
        failureCount: failureData.builds.length,
        gapCount: failureData.gaps.length,
        patternCount: failureData.patterns.length,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        content,
        tweetId,
        threadId,
        data: {
          builds: failureData.builds.length,
          gaps: failureData.gaps.length,
          patterns: failureData.patterns.length
        }
      };
    }

    throw new Error('Failed to post thread reply');

  } catch (err) {
    emit('motor:x-post-thread-failure-data:error', {
      error: err.message,
      timestamp: new Date().toISOString()
    });

    return {
      success: false,
      error: err.message
    };
  }
}

async function previewFailureData() {
  const failureData = await getFailureRecords();
  const content = formatFailureData(failureData);
  return {
    content,
    charCount: content.length,
    data: {
      builds: failureData.builds.length,
      gaps: failureData.gaps.length,
      patterns: failureData.patterns.length
    }
  };
}

export default {
  postThreadFailureData,
  previewFailureData,
  getFailureRecords,
  formatFailureData
};