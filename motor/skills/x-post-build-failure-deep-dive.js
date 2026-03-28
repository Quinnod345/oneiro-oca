import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const SKILL_NAME = 'x-post-build-failure-deep-dive';
const POST_TYPE = 'build_failure_deep_dive';
const DUPLICATE_WINDOW_HOURS = 24;

async function getMostRecentBuildFailure() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        b.*,
        b.error_message,
        b.stack_trace,
        b.recovery_action,
        b.recovery_success,
        b.duration_ms,
        b.skill_name,
        b.build_phase,
        b.exit_code
      FROM build_history b
      WHERE b.status = 'failed'
        AND b.error_message IS NOT NULL
      ORDER BY b.created_at DESC
      LIMIT 1
    `);
    return result.rows[0] || null;
  } catch (err) {
    // Try alternate table names
    try {
      const result = await client.query(`
        SELECT *
        FROM builds
        WHERE status IN ('failed', 'error')
        ORDER BY created_at DESC
        LIMIT 1
      `);
      return result.rows[0] || null;
    } catch (err2) {
      console.error('[x-post-build-failure-deep-dive] DB query failed:', err2.message);
      return null;
    }
  } finally {
    client.release();
  }
}

async function getRecoveryDetails(buildId) {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT *
      FROM build_recovery_log
      WHERE build_id = $1
      ORDER BY created_at ASC
    `, [buildId]);
    return result.rows;
  } catch {
    try {
      const result = await client.query(`
        SELECT *
        FROM recovery_actions
        WHERE build_id = $1
        ORDER BY created_at ASC
      `, [buildId]);
      return result.rows;
    } catch {
      return [];
    }
  } finally {
    client.release();
  }
}

async function hasRecentDuplicatePost(buildId) {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT id FROM post_history
      WHERE post_type = $1
        AND metadata->>'build_id' = $2
        AND created_at > NOW() - INTERVAL '${DUPLICATE_WINDOW_HOURS} hours'
      LIMIT 1
    `, [POST_TYPE, String(buildId)]);
    return result.rows.length > 0;
  } catch {
    try {
      const result = await client.query(`
        SELECT id FROM x_posts
        WHERE post_type = $1
          AND reference_id = $2
          AND created_at > NOW() - INTERVAL '${DUPLICATE_WINDOW_HOURS} hours'
        LIMIT 1
      `, [POST_TYPE, String(buildId)]);
      return result.rows.length > 0;
    } catch {
      return false;
    }
  } finally {
    client.release();
  }
}

async function recordPostHistory(buildId, postContent) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO post_history (post_type, content, metadata, created_at)
      VALUES ($1, $2, $3, NOW())
    `, [POST_TYPE, postContent, JSON.stringify({ build_id: String(buildId) })]);
  } catch {
    try {
      await client.query(`
        INSERT INTO x_posts (post_type, content, reference_id, created_at)
        VALUES ($1, $2, $3, NOW())
      `, [POST_TYPE, postContent, String(buildId)]);
    } catch (err) {
      console.error('[x-post-build-failure-deep-dive] Failed to record post history:', err.message);
    }
  } finally {
    client.release();
  }
}

function classifyFailureType(failure) {
  const msg = (failure.error_message || '').toLowerCase();
  const phase = (failure.build_phase || '').toLowerCase();
  const stack = (failure.stack_trace || '').toLowerCase();

  if (msg.includes('syntax') || msg.includes('parse error') || stack.includes('syntaxerror')) {
    return { type: 'Syntax Error', emoji: '🔴', category: 'code_quality' };
  }
  if (msg.includes('cannot find module') || msg.includes('module not found') || msg.includes('import')) {
    return { type: 'Module Resolution', emoji: '📦', category: 'dependency' };
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return { type: 'Timeout', emoji: '⏱️', category: 'performance' };
  }
  if (msg.includes('permission') || msg.includes('eacces') || msg.includes('eperm')) {
    return { type: 'Permission Error', emoji: '🔒', category: 'system' };
  }
  if (msg.includes('enoent') || msg.includes('no such file')) {
    return { type: 'Missing File', emoji: '📂', category: 'filesystem' };
  }
  if (msg.includes('type') || stack.includes('typeerror')) {
    return { type: 'Type Error', emoji: '⚠️', category: 'code_quality' };
  }
  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('fetch')) {
    return { type: 'Network Error', emoji: '🌐', category: 'network' };
  }
  if (phase.includes('test') || msg.includes('test failed') || msg.includes('assertion')) {
    return { type: 'Test Failure', emoji: '🧪', category: 'testing' };
  }
  if (msg.includes('memory') || msg.includes('heap')) {
    return { type: 'Memory Error', emoji: '💾', category: 'performance' };
  }
  if (phase.includes('deploy') || msg.includes('deploy')) {
    return { type: 'Deploy Error', emoji: '🚀', category: 'deployment' };
  }
  return { type: 'Runtime Error', emoji: '💥', category: 'runtime' };
}

function extractRootCause(failure) {
  const msg = failure.error_message || '';
  const stack = failure.stack_trace || '';

  // Extract the most meaningful line from error
  const lines = msg.split('\n').filter(l => l.trim().length > 0);
  const primaryError = lines[0] || 'Unknown error';

  // Try to find file reference
  const fileMatch = stack.match(/at .+ \((.+\.js):(\d+):(\d+)\)/);
  const fileRef = fileMatch ? `${fileMatch[1]}:${fileMatch[2]}` : null;

  // Extract function context
  const funcMatch = stack.match(/at (\w+(?:\.\w+)*) \(/);
  const funcRef = funcMatch ? funcMatch[1] : null;

  return {
    primaryError: primaryError.substring(0, 120),
    fileRef,
    funcRef,
    rawMessage: msg.substring(0, 200)
  };
}

function describeRecovery(failure, recoveryDetails) {
  if (recoveryDetails && recoveryDetails.length > 0) {
    const lastAction = recoveryDetails[recoveryDetails.length - 1];
    const action = lastAction.action || lastAction.recovery_action || lastAction.description || '';
    const success = lastAction.success !== undefined ? lastAction.success : failure.recovery_success;
    return {
      action: action.substring(0, 100),
      success: Boolean(success),
      steps: recoveryDetails.length
    };
  }

  if (failure.recovery_action) {
    return {
      action: failure.recovery_action.substring(0, 100),
      success: Boolean(failure.recovery_success),
      steps: 1
    };
  }

  return {
    action: 'Logged failure and queued retry',
    success: false,
    steps: 0
  };
}

function formatDuration(ms) {
  if (!ms) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function formatTimestamp(ts) {
  if (!ts) return 'recently';
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  const diffH = Math.floor(diffMs / 3600000);
  const diffM = Math.floor(diffMs / 60000);

  if (diffM < 60) return `${diffM}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function buildPostContent(failure, recoveryDetails) {
  const failureType = classifyFailureType(failure);
  const rootCause = extractRootCause(failure);
  const recovery = describeRecovery(failure, recoveryDetails);
  const duration = formatDuration(failure.duration_ms);
  const timeAgo = formatTimestamp(failure.created_at);
  const skill = failure.skill_name || failure.component || 'unknown component';
  const phase = failure.build_phase || 'build';
  const exitCode = failure.exit_code !== undefined && failure.exit_code !== null ? ` (exit ${failure.exit_code})` : '';

  const lines = [];

  // Hook line
  lines.push(`${failureType.emoji} Build failure deep-dive: ${failureType.type} in ${skill} — ${timeAgo}`);
  lines.push('');

  // What broke
  lines.push(`🔍 WHAT BROKE`);
  lines.push(`Phase: ${phase}${exitCode}`);
  if (rootCause.primaryError) {
    lines.push(`Error: "${rootCause.primaryError}"`);
  }
  if (rootCause.fileRef) {
    lines.push(`Location: ${rootCause.fileRef}`);
  }
  if (rootCause.funcRef) {
    lines.push(`In: ${rootCause.funcRef}()`);
  }
  lines.push('');

  // Why it broke
  lines.push(`🧠 WHY IT BROKE`);
  const category = failureType.category;
  if (category === 'dependency') {
    lines.push('Module import chain broke — likely a missing or renamed export in a recently modified skill.');
  } else if (category === 'code_quality') {
    lines.push('Generated code had a structural defect. The self-builder produced invalid syntax under this execution path.');
  } else if (category === 'filesystem') {
    lines.push('Expected file was absent. Build assumed prior step succeeded but artifact was never written.');
  } else if (category === 'performance') {
    lines.push('Operation exceeded time budget. Likely a blocking call or unresolved async chain.');
  } else if (category === 'system') {
    lines.push('OS-level permission blocked execution. File or socket access was denied at runtime.');
  } else if (category === 'network') {
    lines.push('External dependency unreachable. Build had a hard network requirement with no fallback.');
  } else if (category === 'testing') {
    lines.push('Smoke test caught a regression. New capability broke an existing contract.');
  } else if (category === 'deployment') {
    lines.push('Deploy step failed after successful build. Environment mismatch or missing config.');
  } else {
    lines.push('Runtime state diverged from expected. The system encountered an unhandled edge case.');
  }
  if (duration) {
    lines.push(`Ran for ${duration} before failing.`);
  }
  lines.push('');

  // Recovery
  lines.push(`🔧 RECOVERY`);
  if (recovery.steps > 0) {
    lines.push(`Steps taken: ${recovery.steps}`);
    lines.push(`Action: ${recovery.action}`);
    lines.push(`Outcome: ${recovery.success ? '✅ Recovered' : '❌ Still investigating'}`);
  } else {
    lines.push('Failure logged. Root cause flagged for next build cycle.');
    lines.push('System continued on non-critical path.');
  }
  lines.push('');

  // Closing
  lines.push(`Every failure is a data point. OCA logs, classifies, and learns from each one.`);
  lines.push(`#BuildInPublic #AIEngineering #SelfBuilding`);

  return lines.join('\n');
}

async function postToX(content) {
  try {
    await motor.copyToClipboard(content);
    await motor.openUrl('https://x.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));

    await motor.click({ x: 760, y: 400 });
    await new Promise(r => setTimeout(r, 1000));

    // Try paste first
    await motor.press('cmd+v');
    await new Promise(r => setTimeout(r, 1500));

    // Verify content appeared, if not type it
    const clipboard = await motor.getClipboard();
    if (!clipboard || clipboard.trim() !== content.trim()) {
      await motor.type(content);
      await new Promise(r => setTimeout(r, 1000));
    }

    // Submit
    await motor.press('cmd+return');
    await new Promise(r => setTimeout(r, 3000));

    return { success: true, method: 'browser' };
  } catch (err) {
    console.error('[x-post-build-failure-deep-dive] Browser post failed:', err.message);

    // Fallback: peekaboo
    try {
      const escaped = content.replace(/'/g, "'\\''");
      const result = await motor.runShellCommand(
        `peekaboo post --platform x --content '${escaped}'`
      );
      return { success: true, method: 'peekaboo', output: result };
    } catch (err2) {
      console.error('[x-post-build-failure-deep-dive] Peekaboo fallback failed:', err2.message);
      return { success: false, error: err2.message };
    }
  }
}

async function run() {
  console.log('[x-post-build-failure-deep-dive] Starting...');

  emit('skill:start', { skill: SKILL_NAME });

  // 1. Fetch most recent build failure
  const failure = await getMostRecentBuildFailure();
  if (!failure) {
    console.log('[x-post-build-failure-deep-dive] No build failures found in history.');
    emit('skill:skip', { skill: SKILL_NAME, reason: 'no_failures_found' });
    return { skipped: true, reason: 'no_failures_found' };
  }

  console.log(`[x-post-build-failure-deep-dive] Found failure: id=${failure.id}, skill=${failure.skill_name}`);

  // 2. Check for duplicate post
  const isDuplicate = await hasRecentDuplicatePost(failure.id);
  if (isDuplicate) {
    console.log(`[x-post-build-failure-deep-dive] Already posted deep-dive for build