import { pool, emit } from '../../event-bus.js';
import motor from '../engine.js';
import fs from 'fs/promises';
import path from 'path';

const AUDIT_FILE = 'private/build-loop-audit.md';
const GAP_DEPLOY_WINDOW_MS = 10 * 60 * 1000;

async function queryGapDetections() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT id, type, data, created_at
      FROM events
      WHERE type = 'gap_detected'
        AND created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
    `);
    return result.rows;
  } finally {
    client.release();
  }
}

async function queryDeploysNear(timestamp) {
  const client = await pool.connect();
  try {
    const windowStart = new Date(new Date(timestamp).getTime() - GAP_DEPLOY_WINDOW_MS);
    const windowEnd = new Date(new Date(timestamp).getTime() + GAP_DEPLOY_WINDOW_MS);
    const result = await client.query(`
      SELECT id, type, data, created_at
      FROM events
      WHERE type IN ('deploy_started', 'deploy_completed', 'build_deployed')
        AND created_at BETWEEN $1 AND $2
      ORDER BY created_at ASC
      LIMIT 1
    `, [windowStart.toISOString(), windowEnd.toISOString()]);
    return result.rows;
  } finally {
    client.release();
  }
}

async function findUnresolvedGaps() {
  const gaps = await queryGapDetections();
  const unresolved = [];

  for (const gap of gaps) {
    const nearbyDeploys = await queryDeploysNear(gap.created_at);
    if (nearbyDeploys.length === 0) {
      unresolved.push({ ...gap, resolvedBy: null });
    } else {
      unresolved.push({ ...gap, resolvedBy: nearbyDeploys[0] });
    }
  }

  return unresolved;
}

async function writeAuditReport(gaps) {
  const now = new Date().toISOString();
  const unresolved = gaps.filter(g => !g.resolvedBy);
  const resolved = gaps.filter(g => g.resolvedBy);

  let md = `# Build Loop Integrity Audit\n\nGenerated: ${now}\n\n`;
  md += `**Total gap detections (last 24h):** ${gaps.length}  \n`;
  md += `**Unresolved (no deploy within ±10min):** ${unresolved.length}  \n`;
  md += `**Resolved:** ${resolved.length}  \n\n`;

  if (unresolved.length > 0) {
    md += `## Unresolved Gaps\n\n`;
    for (const gap of unresolved) {
      const data = typeof gap.data === 'string' ? JSON.parse(gap.data) : (gap.data || {});
      md += `### Gap at ${gap.created_at}\n`;
      md += `- **Event ID:** ${gap.id}\n`;
      md += `- **Type:** ${gap.type}\n`;
      if (data.capability) md += `- **Capability:** ${data.capability}\n`;
      if (data.description) md += `- **Description:** ${data.description}\n`;
      if (data.gap) md += `- **Gap:** ${data.gap}\n`;
      md += `- **No matching deploy found within ±10 minutes**\n\n`;
    }
  } else {
    md += `## Unresolved Gaps\n\nNone — all detected gaps have matching deploys.\n\n`;
  }

  if (resolved.length > 0) {
    md += `## Resolved Gaps\n\n`;
    for (const gap of resolved) {
      const data = typeof gap.data === 'string' ? JSON.parse(gap.data) : (gap.data || {});
      md += `### Gap at ${gap.created_at}\n`;
      md += `- **Event ID:** ${gap.id}\n`;
      if (data.capability) md += `- **Capability:** ${data.capability}\n`;
      md += `- **Resolved by deploy:** ${gap.resolvedBy.id} at ${gap.resolvedBy.created_at}\n\n`;
    }
  }

  await fs.writeFile(AUDIT_FILE, md, 'utf8');
  return { unresolvedCount: unresolved.length, resolvedCount: resolved.length, total: gaps.length };
}

async function verify() {
  try {
    const gaps = await findUnresolvedGaps();
    const summary = await writeAuditReport(gaps);
    const broken = summary.unresolvedCount > 0;

    if (broken) {
      await emit('build_loop_integrity_failure', {
        unresolvedGaps: summary.unresolvedCount,
        total: summary.total,
        auditFile: AUDIT_FILE,
        timestamp: new Date().toISOString(),
      });

      await motor.showNotification(
        'Build Loop Broken',
        `${summary.unresolvedCount} gap(s) detected with no matching deploy. See ${AUDIT_FILE}`
      );
    } else {
      await emit('build_loop_integrity_ok', {
        total: summary.total,
        resolved: summary.resolvedCount,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      ok: !broken,
      ...summary,
      auditFile: AUDIT_FILE,
    };
  } catch (err) {
    await emit('build_loop_integrity_error', {
      error: err.message,
      timestamp: new Date().toISOString(),
    });
    throw err;
  }
}

async function checkPipelineHealth() {
  const result = await verify();
  return result;
}

async function getLastAudit() {
  try {
    const content = await fs.readFile(AUDIT_FILE, 'utf8');
    return { content, path: AUDIT_FILE };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { content: null, path: AUDIT_FILE, message: 'No audit file yet' };
    }
    throw err;
  }
}

async function clearAudit() {
  try {
    await fs.unlink(AUDIT_FILE);
    return { cleared: true };
  } catch (err) {
    if (err.code === 'ENOENT') return { cleared: false, message: 'Nothing to clear' };
    throw err;
  }
}

export default {
  verify,
  checkPipelineHealth,
  getLastAudit,
  clearAudit,
};