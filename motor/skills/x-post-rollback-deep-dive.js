import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const SKILL_NAME = 'x-post-rollback-deep-dive';

async function getPostedRollbacks() {
  try {
    const result = await pool.query(
      `SELECT metadata->>'rollback_id' as rollback_id
       FROM x_posts
       WHERE skill = $1 AND metadata->>'rollback_id' IS NOT NULL`,
      [SKILL_NAME]
    );
    return new Set(result.rows.map(r => r.rollback_id));
  } catch (err) {
    console.error('[x-post-rollback-deep-dive] Failed to fetch posted rollbacks:', err.message);
    return new Set();
  }
}

async function getWorstRollback(excludeIds) {
  try {
    const excludeList = excludeIds.size > 0 ? [...excludeIds] : ['__none__'];
    const placeholders = excludeList.map((_, i) => `$${i + 1}`).join(', ');

    const result = await pool.query(
      `SELECT
         id,
         skill_name,
         build_id,
         error_message,
         error_type,
         attempted_fix,
         rollback_reason,
         files_affected,
         duration_ms,
         created_at,
         metadata
       FROM build_history
       WHERE event_type = 'rollback'
         AND id::text NOT IN (${placeholders})
       ORDER BY
         CASE WHEN error_type IN ('syntax_error', 'runtime_crash', 'import_failure', 'circular_dependency') THEN 0 ELSE 1 END ASC,
         duration_ms DESC NULLS LAST,
         created_at DESC
       LIMIT 1`,
      excludeList
    );

    if (result.rows.length > 0) return result.rows[0];

    // Fallback: try broader query
    const fallback = await pool.query(
      `SELECT
         id,
         skill_name,
         build_id,
         error_message,
         error_type,
         attempted_fix,
         rollback_reason,
         files_affected,
         duration_ms,
         created_at,
         metadata
       FROM build_events
       WHERE event_type IN ('rollback', 'build_rollback', 'self_build_rollback')
         AND id::text NOT IN (${placeholders})
       ORDER BY created_at DESC
       LIMIT 1`,
      excludeList
    );

    return fallback.rows[0] || null;
  } catch (err) {
    console.error('[x-post-rollback-deep-dive] Failed to fetch rollback data:', err.message);
    return null;
  }
}

async function getRollbackContext(rollback) {
  try {
    const buildId = rollback.build_id || rollback.metadata?.build_id;
    if (!buildId) return null;

    const result = await pool.query(
      `SELECT
         event_type,
         skill_name,
         error_message,
         metadata,
         created_at
       FROM build_history
       WHERE build_id = $1
       ORDER BY created_at ASC`,
      [buildId]
    );

    return result.rows;
  } catch {
    return null;
  }
}

function truncate(str, maxLen) {
  if (!str) return '';
  const s = String(str).trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
}

function formatErrorSnippet(errorMessage) {
  if (!errorMessage) return null;
  const lines = errorMessage.split('\n').filter(l => l.trim());
  const firstMeaningful = lines.find(l =>
    l.includes('Error') || l.includes('error') || l.includes('Cannot') || l.includes('Unexpected')
  ) || lines[0];
  return truncate(firstMeaningful, 120);
}

function inferSeverity(rollback) {
  const errorType = (rollback.error_type || '').toLowerCase();
  const errorMsg = (rollback.error_message || '').toLowerCase();

  if (errorType.includes('crash') || errorMsg.includes('segfault') || errorMsg.includes('out of memory')) {
    return 'CRITICAL';
  }
  if (errorType.includes('syntax') || errorMsg.includes('syntaxerror') || errorMsg.includes('unexpected token')) {
    return 'HIGH';
  }
  if (errorType.includes('import') || errorMsg.includes('cannot find module') || errorMsg.includes('circular')) {
    return 'HIGH';
  }
  if (errorType.includes('runtime') || errorMsg.includes('typeerror') || errorMsg.includes('referenceerror')) {
    return 'MEDIUM';
  }
  return 'MEDIUM';
}

function buildTweetContent(rollback, context) {
  const skillName = rollback.skill_name || rollback.metadata?.skill_name || 'unknown skill';
  const errorSnippet = formatErrorSnippet(rollback.error_message);
  const errorType = rollback.error_type || rollback.metadata?.error_type || 'unknown error type';
  const attemptedFix = rollback.attempted_fix || rollback.metadata?.attempted_fix || null;
  const rollbackReason = rollback.rollback_reason || rollback.metadata?.rollback_reason || null;
  const filesAffected = rollback.files_affected || rollback.metadata?.files_affected || null;
  const durationMs = rollback.duration_ms || rollback.metadata?.duration_ms || null;
  const severity = inferSeverity(rollback);
  const timestamp = rollback.created_at ? new Date(rollback.created_at).toISOString().split('T')[0] : 'unknown date';

  const filesStr = Array.isArray(filesAffected)
    ? filesAffected.slice(0, 3).map(f => f.split('/').pop()).join(', ')
    : typeof filesAffected === 'string'
    ? filesAffected.split(',').slice(0, 3).map(f => f.trim().split('/').pop()).join(', ')
    : null;

  const durationStr = durationMs ? `${(durationMs / 1000).toFixed(1)}s` : null;

  // Determine what was learned
  let lessonLearned = null;
  if (errorType.includes('circular') || (rollback.error_message || '').toLowerCase().includes('circular')) {
    lessonLearned = 'Circular deps must be detected before write, not after load';
  } else if (errorType.includes('syntax') || (rollback.error_message || '').toLowerCase().includes('syntaxerror')) {
    lessonLearned = 'AST validation before file commit would have caught this';
  } else if ((rollback.error_message || '').toLowerCase().includes('cannot find module')) {
    lessonLearned = 'Import resolution must be verified against actual fs state';
  } else if ((rollback.error_message || '').toLowerCase().includes('typeerror')) {
    lessonLearned = 'Type contracts between modules need runtime assertion layer';
  } else if (rollbackReason) {
    lessonLearned = truncate(rollbackReason, 100);
  } else {
    lessonLearned = 'Pre-flight validation must cover this failure class';
  }

  // Build tweet
  const parts = [];

  parts.push(`🔄 Worst self-build rollback: ${skillName} [${severity}] — ${timestamp}`);
  parts.push('');

  if (errorSnippet) {
    parts.push(`💥 Error: ${errorSnippet}`);
  } else {
    parts.push(`💥 Error type: ${errorType}`);
  }

  if (attemptedFix) {
    parts.push(`🔧 Attempted: ${truncate(attemptedFix, 100)}`);
  }

  if (filesStr) {
    parts.push(`📁 Files: ${filesStr}`);
  }

  if (durationStr) {
    parts.push(`⏱ Build time lost: ${durationStr}`);
  }

  parts.push('');
  parts.push(`📌 Lesson: ${lessonLearned}`);
  parts.push('');
  parts.push('#OCA #SelfBuild #AIArchitecture #BuildInPublic');

  const tweet = parts.join('\n');

  // Ensure under 280 chars for single tweet, or trim
  if (tweet.length <= 280) return tweet;

  // Trim version
  const trimParts = [];
  trimParts.push(`🔄 Rollback: ${truncate(skillName, 40)} [${severity}]`);
  trimParts.push('');
  if (errorSnippet) {
    trimParts.push(`💥 ${truncate(errorSnippet, 90)}`);
  }
  if (attemptedFix) {
    trimParts.push(`🔧 ${truncate(attemptedFix, 70)}`);
  }
  trimParts.push(`📌 ${truncate(lessonLearned, 80)}`);
  trimParts.push('#OCA #SelfBuild #BuildInPublic');

  return trimParts.join('\n');
}

async function recordPost(rollbackId, tweetContent, rollback) {
  try {
    await pool.query(
      `INSERT INTO x_posts (skill, content, metadata, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [
        SKILL_NAME,
        tweetContent,
        JSON.stringify({
          rollback_id: String(rollbackId),
          skill_name: rollback.skill_name,
          error_type: rollback.error_type,
          severity: inferSeverity(rollback)
        })
      ]
    );
  } catch (err) {
    console.error('[x-post-rollback-deep-dive] Failed to record post:', err.message);
  }
}

async function postToX(content) {
  try {
    await motor.openUrl('https://twitter.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));

    await motor.click({ description: 'tweet compose box' });
    await new Promise(r => setTimeout(r, 500));

    await motor.copyToClipboard(content);
    await motor.press(['meta', 'v']);
    await new Promise(r => setTimeout(r, 1000));

    await motor.press(['meta', 'Return']);
    await new Promise(r => setTimeout(r, 3000));

    return { success: true, method: 'browser' };
  } catch (err) {
    console.error('[x-post-rollback-deep-dive] Browser post failed:', err.message);

    // Try peekaboo fallback
    try {
      const escaped = content.replace(/'/g, "'\\''");
      const result = await motor.runShellCommand(
        `peekaboo tweet --content '${escaped}'`
      );
      return { success: true, method: 'peekaboo', output: result };
    } catch (peekErr) {
      console.error('[x-post-rollback-deep-dive] Peekaboo fallback failed:', peekErr.message);
      return { success: false, error: peekErr.message };
    }
  }
}

async function run() {
  try {
    emit('skill:start', { skill: SKILL_NAME });

    const postedIds = await getPostedRollbacks();
    console.log(`[x-post-rollback-deep-dive] Already posted ${postedIds.size} rollbacks`);

    const rollback = await getWorstRollback(postedIds);

    if (!rollback) {
      const msg = 'No unposted rollback events found in build history';
      console.log(`[x-post-rollback-deep-dive] ${msg}`);
      emit('skill:complete', { skill: SKILL_NAME, result: 'no_data', message: msg });
      return { success: false, reason: msg };
    }

    console.log(`[x-post-rollback-deep-dive] Found rollback: ${rollback.id} — ${rollback.skill_name}`);

    const context = await getRollbackContext(rollback);
    const tweetContent = buildTweetContent(rollback, context);

    console.log('[x-post-rollback-deep-dive] Tweet content:');
    console.log(tweetContent);
    console.log(`[x-post-rollback-deep-dive] Length: ${tweetContent.length} chars`);

    const postResult = await postToX(tweetContent);

    if (postResult.success) {
      await recordPost(rollback.id, tweetContent, rollback);
      emit('skill:complete', {
        skill: SKILL_NAME,
        result: 'posted',
        rollback_id: rollback.id,
        skill_name: rollback.skill_name,
        method: postResult.method
      });
      return {
        success: true,
        rollback_id: rollback.id,
        skill_name: rollback.skill_name,
        tweet: tweetContent,
        method: postResult.method
      };
    } else {
      emit('skill:error', { skill: SKILL_NAME, error: postResult.error });
      return { success: false, error: postResult.error };
    }
  } catch (err) {
    console.error('[x-post-rollback-deep-dive] Unhandled error:', err);
    emit('skill:error', { skill: SKILL_NAME, error: err.message });
    return { success: false, error: err.message };
  }
}

async function preview() {
  try {
    const postedIds = await getPostedRollbacks();
    const rollback = await getWorstRollback(postedIds);

    if (!rollback) {
      return { success: false, reason: 'No unposted rollback events found' };
    }

    const context = await getRollbackContext(rollback);
    const tweetContent = buildTweetContent(rollback, context);

    return {
      success: true,
      rollback_id: rollback.id,
      skill_name: rollback.skill_name,
      error_type: rollback.error_type,
      severity: inferSeverity(rollback),
      tweet: tweetContent,
      char_count: tweetContent.length
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getStats() {
  try {
    const totalResult = await pool.query(
      `SELECT COUNT(*) as total FROM build_history WHERE event_type = 'rollback'`
    );
    const postedResult = await pool.query(
      `SELECT COUNT(*) as posted FROM x_posts WHERE skill = $1`,
      [SKILL_NAME]
    );
    const severityResult = await pool.query(
      `SELECT error_type, COUNT(*) as count
       FROM build_history
       WHERE event_type = 'rollback'
       GROUP BY error_type
       ORDER BY count DESC`
    );

    return {
      total_rollbacks: parseInt(totalResult.rows[0]?.total || 0),
      posted_count: parseInt(postedResult.rows[0]?.posted || 0),
      by_error_type: severityResult.rows
    };
  } catch (err) {
    return { error: err.message };
  }
}

export default {
  run,
  preview,
  getStats,
  getWorstRollback,
  buildTweetContent
};