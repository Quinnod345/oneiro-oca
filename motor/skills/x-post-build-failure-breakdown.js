import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const SKILL_NAME = 'x-post-build-failure-breakdown';
const POST_TYPE = 'build_failure_breakdown';
const DUPLICATE_WINDOW_HOURS = 12;

async function queryRecentFailures(limit = 10) {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT
        id,
        skill_name,
        error_message,
        error_type,
        root_cause,
        stack_trace,
        build_phase,
        exit_code,
        duration_ms,
        recovery_action,
        recovery_success,
        context,
        metadata,
        created_at
      FROM build_history
      WHERE status = 'failed'
        AND (error_message IS NOT NULL OR root_cause IS NOT NULL)
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
    return result.rows;
  } catch (err) {
    try {
      const result = await client.query(`
        SELECT *
        FROM builds
        WHERE status IN ('failed', 'error')
        ORDER BY created_at DESC
        LIMIT $1
      `, [limit]);
      return result.rows;
    } catch (err2) {
      console.error(`[${SKILL_NAME}] DB query failed:`, err2.message);
      return [];
    }
  } finally {
    client.release();
  }
}

async function hasRecentDuplicatePost() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT id FROM post_history
      WHERE post_type = $1
        AND created_at > NOW() - INTERVAL '${DUPLICATE_WINDOW_HOURS} hours'
      LIMIT 1
    `, [POST_TYPE]);
    return result.rows.length > 0;
  } catch {
    try {
      const result = await client.query(`
        SELECT id FROM x_posts
        WHERE post_type = $1
          AND created_at > NOW() - INTERVAL '${DUPLICATE_WINDOW_HOURS} hours'
        LIMIT 1
      `, [POST_TYPE]);
      return result.rows.length > 0;
    } catch {
      return false;
    }
  } finally {
    client.release();
  }
}

async function recordPostHistory(content) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO post_history (post_type, content, created_at)
      VALUES ($1, $2, NOW())
    `, [POST_TYPE, content]);
  } catch {
    try {
      await client.query(`
        INSERT INTO x_posts (post_type, content, created_at)
        VALUES ($1, $2, NOW())
      `, [POST_TYPE, content]);
    } catch (err) {
      console.error(`[${SKILL_NAME}] Failed to record post history:`, err.message);
    }
  } finally {
    client.release();
  }
}

function classifyFailure(failure) {
  const msg = (failure.error_message || failure.error || '').toLowerCase();
  const stack = (failure.stack_trace || '').toLowerCase();
  const phase = (failure.build_phase || '').toLowerCase();

  if (msg.includes('syntaxerror') || msg.includes('parse error') || stack.includes('syntaxerror')) {
    return { type: 'SyntaxError', emoji: '🔴', capabilitySignal: 'code generation is producing structurally invalid output — the model's template or AST reconstruction is broken at this edge' };
  }
  if (msg.includes('cannot find module') || msg.includes('module not found')) {
    return { type: 'ModuleResolution', emoji: '📦', capabilitySignal: 'import graph awareness gap — skill generates references to exports that don't exist or were renamed' };
  }
  if (msg.includes('typeerror') || stack.includes('typeerror')) {
    return { type: 'TypeError', emoji: '⚠️', capabilitySignal: 'interface contract mismatch — skill assumes a data shape that doesn't match actual runtime state' };
  }
  if (msg.includes('enoent') || msg.includes('no such file')) {
    return { type: 'MissingFile', emoji: '📂', capabilitySignal: 'build sequencing assumption failed — skill expected an artifact from a prior step that wasn't produced' };
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return { type: 'Timeout', emoji: '⏱️', capabilitySignal: 'async handling gap — blocking call or unresolved promise in the execution path' };
  }
  if (msg.includes('eacces') || msg.includes('eperm') || msg.includes('permission')) {
    return { type: 'PermissionError', emoji: '🔒', capabilitySignal: 'environment assumption gap — skill assumes access it doesn't have in this execution context' };
  }
  if (msg.includes('econnrefused') || msg.includes('network') || msg.includes('fetch failed')) {
    return { type: 'NetworkError', emoji: '🌐', capabilitySignal: 'hard dependency on external service with no fallback — fragile integration boundary' };
  }
  if (phase.includes('test') || msg.includes('assertion') || msg.includes('test failed')) {
    return { type: 'TestFailure', emoji: '🧪', capabilitySignal: 'regression caught — new skill broke an existing behavioral contract' };
  }
  if (msg.includes('memory') || msg.includes('heap out') || msg.includes('oom')) {
    return { type: 'MemoryError', emoji: '💾', capabilitySignal: 'resource ceiling hit — the operation scope exceeded what this runtime can handle' };
  }
  if (msg.includes('referenceerror') || stack.includes('referenceerror')) {
    return { type: 'ReferenceError', emoji: '🔗', capabilitySignal: 'variable scoping error — generated code references a name before it's defined' };
  }
  return { type: 'RuntimeError', emoji: '💥', capabilitySignal: 'unclassified runtime divergence — system hit an edge case with no established handling path' };
}

function extractRootCause(failure) {
  if (failure.root_cause) return failure.root_cause.substring(0, 150);

  const msg = failure.error_message || failure.error || failure.message || '';
  const lines = msg.split('\n').map(l => l.trim()).filter(l => l.length > 5);

  if (lines.length === 0) return 'No error detail captured';

  // Try to find the most specific line (not a generic "Error:" prefix)
  const specific = lines.find(l =>
    !l.startsWith('at ') &&
    !l.match(/^\s*\^/) &&
    l.length > 10
  );

  return (specific || lines[0]).substring(0, 150);
}

function extractLocation(failure) {
  const stack = failure.stack_trace || '';
  const match = stack.match(/at .+? \((.+?\.(?:js|ts|mjs)):(\d+)(?::\d+)?\)/);
  if (match) {
    const file = match[1].replace(/.*\/cognitive\//, '').replace(/.*\/oneiro-core\//, '');
    return `${file}:${match[2]}`;
  }
  return null;
}

function groupByType(failures) {
  const groups = {};
  for (const f of failures) {
    const { type } = classifyFailure(f);
    if (!groups[type]) groups[type] = [];
    groups[type].push(f);
  }
  return groups;
}

function groupBySkill(failures) {
  const groups = {};
  for (const f of failures) {
    const skill = (f.skill_name || 'unknown').replace(/\.js$/, '').replace(/^motor\/skills\//, '');
    if (!groups[skill]) groups[skill] = 0;
    groups[skill]++;
  }
  return groups;
}

function formatTimestamp(ts) {
  if (!ts) return 'recently';
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  const diffH = Math.floor(diffMs / 3600000);
  const diffM = Math.floor(diffMs / 60000);
  if (diffM < 2) return 'just now';
  if (diffM < 60) return `${diffM}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDuration(ms) {
  if (!ms) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function buildBreakdownPost(failures) {
  const total = failures.length;
  const groups = groupByType(failures);
  const bySkill = groupBySkill(failures);

  const topTypes = Object.entries(groups)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 4);

  const topSkills = Object.entries(bySkill)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const mostRecent = failures[0];
  const recentClassification = classifyFailure(mostRecent);
  const recentCause = extractRootCause(mostRecent);
  const recentLocation = extractLocation(mostRecent);
  const recentDuration = formatDuration(mostRecent.duration_ms);
  const recentTime = formatTimestamp(mostRecent.created_at);
  const recentSkill = (mostRecent.skill_name || 'unknown').replace(/\.js$/, '').replace(/^motor\/skills\//, '');

  const lines = [];

  lines.push(`🔬 OCA build failure breakdown — last ${total} failures, honest accounting`);
  lines.push('');

  // Breakdown by failure type
  lines.push(`WHAT'S ACTUALLY BREAKING:`);
  for (const [type, records] of topTypes) {
    const { emoji } = classifyFailure(records[0]);
    const pct = Math.round((records[0].length || records.length) / total * 100);
    lines.push(`${emoji} ${type}: ${records.length}x (${Math.round(records.length / total * 100)}%)`);
  }
  lines.push('');

  // Most recent failure deep cut
  lines.push(`MOST RECENT (${recentTime}):`);
  lines.push(`${recentClassification.emoji} ${recentClassification.type} in ${recentSkill}`);
  lines.push(`Root cause: "${recentCause}"`);
  if (recentLocation) lines.push(`Location: ${recentLocation}`);
  if (recentDuration) lines.push(`Ran ${recentDuration} before failing`);
  lines.push('');

  // Repeat offenders
  if (topSkills.length > 0 && topSkills[0][1] > 1) {
    lines.push(`REPEAT OFFENDERS:`);
    for (const [skill, count] of topSkills.filter(([, c]) => c > 1)) {
      lines.push(`• ${skill}: ${count} failures`);
    }
    lines.push('');
  }

  // What each failure type signals about OCA's capability gaps
  lines.push(`WHAT THIS SIGNALS ABOUT OCA:`);
  const seenSignals = new Set();
  for (const [, records] of topTypes.slice(0, 2)) {
    const { capabilitySignal } = classifyFailure(records[0]);
    if (!seenSignals.has(capabilitySignal)) {
      seenSignals.add(capabilitySignal);
      lines.push(`→ ${capabilitySignal}`);
    }
  }
  lines.push('');

  lines.push(`Failures aren't hidden. They're signal. OCA logs, classifies, and routes every one.`);
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

    await motor.press('cmd+v');
    await new Promise(r => setTimeout(r, 1500));

    await motor.press('cmd+return');
    await new Promise(r => setTimeout(r, 3000));

    return { success: true, method: 'browser_paste' };
  } catch (err) {
    console.error(`[${SKILL_NAME}] Browser post failed:`, err.message);

    try {
      const escaped = content.replace(/'/g, "'\\''");
      const result = await motor.runShellCommand(
        `peekaboo post --platform x --content '${escaped}'`
      );
      return { success: true, method: 'peekaboo', output: result };
    } catch (err2) {
      console.error(`[${SKILL_NAME}] Peekaboo fallback failed:`, err2.message);

      // Last resort: type it
      try {
        await motor.openUrl('https://x.com/compose/tweet');
        await new Promise(r => setTimeout(r, 3000));
        await motor.click({ x: 760, y: 400 });
        await new Promise(r => setTimeout(r, 1000));
        await motor.type(content);
        await new Promise(r => setTimeout(r, 1000));
        await motor.press('cmd+return');
        await new Promise(r => setTimeout(r, 3000));
        return { success: true, method: 'browser_type' };
      } catch (err3) {
        return { success: false, error: err3.message };
      }
    }
  }
}

async function postBuildFailureBreakdown(options = {}) {
  const { limit = 10, skipDuplicateCheck = false } = options;

  emit('skill:start', { skill: SKILL_NAME });

  console.log(`[${SKILL_NAME}] Querying recent build failures...`);

  if (!skipDuplicateCheck) {
    const isDuplicate = await hasRecentDuplicatePost();
    if (isDuplicate) {
      console.log(`[${SKILL_NAME}] Already posted breakdown within ${DUPLICATE_WINDOW_HOURS}h. Skipping.`);
      emit('skill:skip', { skill: SKILL_NAME, reason: 'duplicate_post' });
      return { skipped: true, reason: 'duplicate_post' };
    }
  }

  const failures = await queryRecentFailures(limit);

  if (failures.length === 0) {
    const noDataContent = `OCA build failure breakdown: no failure records found in the last ${limit} builds.\n\nEither the system has been clean, or failure logging needs verification.\n\nChecking build historian integrity next.\n\n#BuildInPublic #AIEngineering`;

    console.log(`[${SKILL_NAME}] No failures found. Posting no-data message.`);
    const result = await postToX(noDataContent);
    await recordPostHistory(noDataContent);
    emit('skill:complete', { skill: SKILL_NAME, failuresFound: 0 });
    return { success: result.success, failuresFound: 0, posted: noDataContent, result };
  }

  console.log(`[${SKILL_NAME}] Found ${failures.length} failures. Building breakdown post.`);

  const content = buildBreakdownPost(failures);

  console.log(`[${SKILL_NAME}] Post content (${content.length} chars):\n${content}`);

  const result = await postToX(content);

  if (result.success) {
    await recordPostHistory(content);
  }

  emit('skill:complete', {
    skill: SKILL_NAME,
    failuresFound: failures.length,
    posted: result.success,
    method: result.method
  });

  return {
    success: result.success,
    failuresFound: failures.length,
    content,
    contentLength: content.length,
    result,
    breakdown: groupByType(failures)
  };
}

async function run(options = {}) {
  return postBuildFailureBreakdown(options);
}

export default {
  postBuildFailureBreakdown,
  run
};