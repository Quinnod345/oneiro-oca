import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

async function getMostRecentFailure() {
  const client = await pool.connect();
  try {
    // Try build_history table first
    const buildResult = await client.query(`
      SELECT 
        id,
        skill_name,
        status,
        error_message,
        error_stack,
        created_at,
        metadata,
        duration_ms,
        attempt_number,
        resolution
      FROM build_history
      WHERE status IN ('failed', 'error', 'crash', 'timeout')
      ORDER BY created_at DESC
      LIMIT 1
    `).catch(() => ({ rows: [] }));

    if (buildResult.rows.length > 0) {
      return { source: 'build_history', data: buildResult.rows[0] };
    }

    // Try capability_gaps table
    const gapResult = await client.query(`
      SELECT 
        id,
        gap_type,
        description,
        severity,
        detected_at,
        resolved_at,
        resolution_notes,
        root_cause,
        metadata
      FROM capability_gaps
      WHERE severity IN ('critical', 'high', 'error')
      ORDER BY detected_at DESC
      LIMIT 1
    `).catch(() => ({ rows: [] }));

    if (gapResult.rows.length > 0) {
      return { source: 'capability_gaps', data: gapResult.rows[0] };
    }

    // Try events table for failure events
    const eventResult = await client.query(`
      SELECT 
        id,
        type,
        payload,
        created_at
      FROM events
      WHERE type ILIKE '%fail%' 
         OR type ILIKE '%error%' 
         OR type ILIKE '%crash%'
      ORDER BY created_at DESC
      LIMIT 1
    `).catch(() => ({ rows: [] }));

    if (eventResult.rows.length > 0) {
      return { source: 'events', data: eventResult.rows[0] };
    }

    // Try build_outcomes table
    const outcomeResult = await client.query(`
      SELECT *
      FROM build_outcomes
      WHERE outcome IN ('failed', 'error', 'rejected')
      ORDER BY created_at DESC
      LIMIT 1
    `).catch(() => ({ rows: [] }));

    if (outcomeResult.rows.length > 0) {
      return { source: 'build_outcomes', data: outcomeResult.rows[0] };
    }

    return null;
  } finally {
    client.release();
  }
}

async function getCapabilityGapContext() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        gap_type,
        description,
        severity,
        detected_at,
        root_cause,
        resolution_notes,
        metadata
      FROM capability_gaps
      ORDER BY detected_at DESC
      LIMIT 5
    `).catch(() => ({ rows: [] }));

    return result.rows;
  } finally {
    client.release();
  }
}

async function getBuildHistoryContext() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        skill_name,
        status,
        error_message,
        created_at,
        duration_ms,
        attempt_number
      FROM build_history
      ORDER BY created_at DESC
      LIMIT 10
    `).catch(() => ({ rows: [] }));

    return result.rows;
  } finally {
    client.release();
  }
}

function formatTimestamp(ts) {
  if (!ts) return 'unknown time';
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

function buildPostmortemTweet(failure, gapContext, buildContext) {
  if (!failure) {
    // Synthesize from available context
    const recentFails = buildContext.filter(b => 
      ['failed', 'error', 'crash', 'timeout'].includes(b.status)
    );
    
    if (recentFails.length === 0) {
      return generateSyntheticPostmortem(gapContext);
    }

    const f = recentFails[0];
    return buildFromBuildHistory(f, buildContext);
  }

  if (failure.source === 'build_history') {
    return buildFromBuildHistory(failure.data, buildContext);
  }

  if (failure.source === 'capability_gaps') {
    return buildFromCapabilityGap(failure.data, gapContext);
  }

  if (failure.source === 'events') {
    return buildFromEvent(failure.data, gapContext);
  }

  if (failure.source === 'build_outcomes') {
    return buildFromBuildOutcome(failure.data, buildContext);
  }

  return generateSyntheticPostmortem(gapContext);
}

function buildFromBuildHistory(data, buildContext) {
  const skillName = data.skill_name || data.name || 'unknown skill';
  const errorMsg = data.error_message || data.error || '';
  const status = data.status || 'failed';
  const ts = formatTimestamp(data.created_at);
  const duration = data.duration_ms ? `${Math.round(data.duration_ms / 1000)}s` : null;
  const attempt = data.attempt_number || 1;
  const resolution = data.resolution || '';

  // Determine root cause category
  let rootCause = 'unknown';
  let rootCauseDetail = '';
  
  if (errorMsg) {
    const errLower = errorMsg.toLowerCase();
    if (errLower.includes('syntax') || errLower.includes('parse')) {
      rootCause = 'syntax error';
      rootCauseDetail = 'malformed code generation';
    } else if (errLower.includes('timeout')) {
      rootCause = 'timeout';
      rootCauseDetail = 'execution exceeded time limit';
    } else if (errLower.includes('import') || errLower.includes('module')) {
      rootCause = 'module resolution failure';
      rootCauseDetail = 'dependency not found or misconfigured';
    } else if (errLower.includes('permission') || errLower.includes('eacces')) {
      rootCause = 'permission denied';
      rootCauseDetail = 'filesystem access blocked';
    } else if (errLower.includes('network') || errLower.includes('econnrefused')) {
      rootCause = 'network failure';
      rootCauseDetail = 'connection refused or unreachable';
    } else if (errLower.includes('undefined') || errLower.includes('null')) {
      rootCause = 'null reference';
      rootCauseDetail = 'unexpected undefined value in execution path';
    } else if (errLower.includes('memory') || errLower.includes('heap')) {
      rootCause = 'memory exhaustion';
      rootCauseDetail = 'heap overflow during execution';
    } else {
      rootCause = 'runtime error';
      rootCauseDetail = truncate(errorMsg, 60);
    }
  }

  // Count recent failures for pattern
  const recentFailCount = buildContext.filter(b => 
    ['failed', 'error', 'crash'].includes(b.status) &&
    b.skill_name === skillName
  ).length;

  const lines = [];
  lines.push(`POSTMORTEM: ${skillName}`);
  lines.push('');
  lines.push(`What broke: Build ${status} ${ts}`);
  
  if (duration) {
    lines.push(`Duration before failure: ${duration}`);
  }
  
  if (attempt > 1) {
    lines.push(`Attempt #${attempt} — repeated failure`);
  }

  lines.push('');
  lines.push(`Root cause: ${rootCause}`);
  
  if (rootCauseDetail) {
    lines.push(`→ ${rootCauseDetail}`);
  }

  if (recentFailCount > 1) {
    lines.push(`Pattern: ${recentFailCount} failures on this skill`);
  }

  lines.push('');
  
  if (resolution) {
    lines.push(`Resolution: ${truncate(resolution, 80)}`);
  } else {
    lines.push('Resolution: queued for gap analysis + rebuild');
  }

  lines.push('');
  lines.push('#OCA #BuildInPublic #AIEngineering');

  const tweet = lines.join('\n');
  return tweet.length <= 280 ? tweet : compressTweet(lines);
}

function buildFromCapabilityGap(data, gapContext) {
  const gapType = data.gap_type || 'capability gap';
  const description = data.description || '';
  const severity = data.severity || 'unknown';
  const ts = formatTimestamp(data.detected_at);
  const rootCause = data.root_cause || '';
  const resolution = data.resolution_notes || '';
  const resolvedAt = data.resolved_at;

  const lines = [];
  lines.push(`POSTMORTEM: ${gapType}`);
  lines.push('');
  lines.push(`What broke: ${severity} capability gap detected ${ts}`);
  
  if (description) {
    lines.push(`→ ${truncate(description, 80)}`);
  }

  lines.push('');
  
  if (rootCause) {
    lines.push(`Root cause: ${truncate(rootCause, 100)}`);
  } else {
    lines.push('Root cause: missing skill coverage in motor layer');
  }

  lines.push('');
  
  if (resolvedAt) {
    lines.push(`Resolved: ${formatTimestamp(resolvedAt)}`);
    if (resolution) {
      lines.push(`→ ${truncate(resolution, 80)}`);
    }
  } else {
    lines.push('Status: unresolved — gap persists in capability map');
    if (resolution) {
      lines.push(`Attempted: ${truncate(resolution, 60)}`);
    }
  }

  // Add context from other gaps
  const criticalGaps = gapContext.filter(g => g.severity === 'critical' && g.gap_type !== gapType);
  if (criticalGaps.length > 0) {
    lines.push(`${criticalGaps.length} other critical gaps active`);
  }

  lines.push('');
  lines.push('#OCA #BuildInPublic #AIEngineering');

  const tweet = lines.join('\n');
  return tweet.length <= 280 ? tweet : compressTweet(lines);
}

function buildFromEvent(data, gapContext) {
  const eventType = data.type || 'unknown event';
  const payload = data.payload || {};
  const ts = formatTimestamp(data.created_at);

  const errorMsg = payload.error || payload.message || payload.reason || '';
  const skillName = payload.skill || payload.name || payload.component || '';
  const resolution = payload.resolution || payload.fix || '';

  const lines = [];
  lines.push(`POSTMORTEM: ${eventType}`);
  lines.push('');
  lines.push(`What broke: failure event fired ${ts}`);
  
  if (skillName) {
    lines.push(`Component: ${skillName}`);
  }

  if (errorMsg) {
    lines.push(`→ ${truncate(errorMsg, 80)}`);
  }

  lines.push('');
  lines.push('Root cause: runtime failure propagated to event bus');

  if (gapContext.length > 0) {
    const related = gapContext.find(g => 
      skillName && g.description && g.description.toLowerCase().includes(skillName.toLowerCase())
    );
    if (related) {
      lines.push(`Related gap: ${truncate(related.gap_type, 50)}`);
    }
  }

  lines.push('');
  
  if (resolution) {
    lines.push(`Resolution: ${truncate(resolution, 80)}`);
  } else {
    lines.push('Resolution: event logged, root cause under investigation');
  }

  lines.push('');
  lines.push('#OCA #BuildInPublic #AIEngineering');

  const tweet = lines.join('\n');
  return tweet.length <= 280 ? tweet : compressTweet(lines);
}

function buildFromBuildOutcome(data, buildContext) {
  const outcome = data.outcome || 'failed';
  const skillName = data.skill_name || data.name || 'unknown';
  const ts = formatTimestamp(data.created_at);
  const reason = data.reason || data.error || data.notes || '';

  const lines = [];
  lines.push(`POSTMORTEM: build outcome — ${outcome}`);
  lines.push('');
  lines.push(`What broke: ${skillName} ${ts}`);
  
  if (reason) {
    lines.push(`→ ${truncate(reason, 80)}`);
  }

  lines.push('');
  lines.push('Root cause: build verification rejected output');
  lines.push('→ output failed smoke test or integrity check');

  lines.push('');
  lines.push('Resolution: skill queued for regeneration with tighter spec');

  lines.push('');
  lines.push('#OCA #BuildInPublic #AIEngineering');

  const tweet = lines.join('\n');
  return tweet.length <= 280 ? tweet : compressTweet(lines);
}

function generateSyntheticPostmortem(gapContext) {
  // No real failure data — generate from gap context or use honest fallback
  if (gapContext.length > 0) {
    const gap = gapContext[0];
    return buildFromCapabilityGap(gap, gapContext);
  }

  const lines = [
    'POSTMORTEM: no recent failures in build log',
    '',
    'What broke: capability gap detection found no critical failures',
    '→ either the system is healthy or logging is incomplete',
    '',
    'Root cause: gap log coverage may be partial',
    '→ not all runtime errors surface to persistent storage',
    '',
    'Resolution: expanding error capture surface across motor layer',
    '→ every failure should leave a trace',
    '',
    '#OCA #BuildInPublic #AIEngineering'
  ];

  return lines.join('\n');
}

function compressTweet(lines) {
  // Remove empty lines first, then truncate
  const compressed = lines.filter(l => l !== '').join('\n');
  if (compressed.length <= 280) return compressed;
  
  // Hard truncate with ellipsis before hashtags
  const hashtagLine = '#OCA #BuildInPublic #AIEngineering';
  const maxBody = 280 - hashtagLine.length - 2;
  return compressed.substring(0, maxBody) + '\n' + hashtagLine;
}

async function postToX(tweetText) {
  try {
    // Try peekab