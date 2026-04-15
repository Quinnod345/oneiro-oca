// OCA Diagnostic Log — in-memory ring buffer for errors, warnings, and system events.
// Exposes recent diagnostics to the API and thinker so the system can self-diagnose.

const MAX_ENTRIES = 200;
const buffer = [];
let sequenceId = 0;

function push(level, source, message, metadata = null) {
  const entry = {
    seq: ++sequenceId,
    ts: new Date().toISOString(),
    level,
    source,
    message: String(message).slice(0, 500),
    metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : null,
  };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  return entry;
}

export function error(source, message, metadata) { return push('error', source, message, metadata); }
export function warn(source, message, metadata)  { return push('warn', source, message, metadata); }
export function info(source, message, metadata)  { return push('info', source, message, metadata); }

export function recent(limit = 50, { level = null, source = null, since = null } = {}) {
  let entries = buffer;
  if (level)  entries = entries.filter(e => e.level === level);
  if (source) entries = entries.filter(e => e.source === source);
  if (since)  entries = entries.filter(e => e.ts >= since);
  return entries.slice(-limit);
}

export function summary() {
  const last5min = new Date(Date.now() - 5 * 60000).toISOString();
  const recentEntries = buffer.filter(e => e.ts >= last5min);
  const errors = recentEntries.filter(e => e.level === 'error');
  const warns  = recentEntries.filter(e => e.level === 'warn');

  const sourceCounts = {};
  for (const e of errors) {
    sourceCounts[e.source] = (sourceCounts[e.source] || 0) + 1;
  }

  return {
    total_buffered: buffer.length,
    errors_5min: errors.length,
    warns_5min: warns.length,
    error_sources: sourceCounts,
    latest_error: errors.length > 0 ? errors[errors.length - 1] : null,
    oldest_buffered: buffer.length > 0 ? buffer[0].ts : null,
  };
}

export function thinkerDigest() {
  const last10min = new Date(Date.now() - 10 * 60000).toISOString();
  const recentErrors = buffer.filter(e => e.level === 'error' && e.ts >= last10min);
  const recentWarns  = buffer.filter(e => e.level === 'warn' && e.ts >= last10min);

  if (recentErrors.length === 0 && recentWarns.length === 0) return '  all clear';

  const lines = [];
  const deduped = new Map();
  for (const e of recentErrors) {
    const key = `${e.source}:${e.message.slice(0, 80)}`;
    const existing = deduped.get(key);
    if (existing) { existing.count++; }
    else { deduped.set(key, { ...e, count: 1 }); }
  }
  for (const [, e] of deduped) {
    lines.push(`  [ERROR] ${e.source}: ${e.message.slice(0, 120)}${e.count > 1 ? ` (x${e.count})` : ''}`);
  }
  for (const w of recentWarns.slice(-5)) {
    lines.push(`  [WARN] ${w.source}: ${w.message.slice(0, 120)}`);
  }
  return lines.join('\n');
}

export default { error, warn, info, recent, summary, thinkerDigest };
