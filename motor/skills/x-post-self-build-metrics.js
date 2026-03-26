import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SKILLS_DIR = path.resolve(__dirname, '../skills');
const AUTONOMOUS_BUILDER_PATH = path.resolve(__dirname, '../skills/autonomous-builder.js');

async function countSkills() {
  try {
    const files = fs.readdirSync(SKILLS_DIR);
    const jsFiles = files.filter(f => f.endsWith('.js') && f !== 'index.js');
    return jsFiles.length;
  } catch (err) {
    console.error('[x-post-self-build-metrics] Error counting skills:', err.message);
    return 0;
  }
}

async function getBuilderCodeSummary() {
  try {
    const code = fs.readFileSync(AUTONOMOUS_BUILDER_PATH, 'utf8');
    const lines = code.split('\n').length;
    const functionMatches = code.match(/async function\s+\w+|function\s+\w+|const\s+\w+\s*=\s*(async\s*)?\(/g) || [];
    const exportMatches = code.match(/export\s+(default|const|function|async)/g) || [];
    return {
      lines,
      functionCount: functionMatches.length,
      exportCount: exportMatches.length,
    };
  } catch (err) {
    console.error('[x-post-self-build-metrics] Error reading autonomous-builder:', err.message);
    return { lines: 0, functionCount: 0, exportCount: 0 };
  }
}

async function getBuildMetricsFromDB() {
  try {
    const client = await pool.connect();
    try {
      // Total builds attempted
      const totalResult = await client.query(`
        SELECT COUNT(*) as total FROM build_events
      `);
      const total = parseInt(totalResult.rows[0]?.total || '0', 10);

      // Successful builds
      const successResult = await client.query(`
        SELECT COUNT(*) as success FROM build_events WHERE status = 'success'
      `);
      const success = parseInt(successResult.rows[0]?.success || '0', 10);

      // Recent builds (last 7 days)
      const recentResult = await client.query(`
        SELECT COUNT(*) as recent FROM build_events
        WHERE created_at >= NOW() - INTERVAL '7 days'
      `);
      const recent = parseInt(recentResult.rows[0]?.recent || '0', 10);

      // Most recent build skill name
      const lastBuildResult = await client.query(`
        SELECT skill_name, status, created_at FROM build_events
        ORDER BY created_at DESC LIMIT 1
      `);
      const lastBuild = lastBuildResult.rows[0] || null;

      return { total, success, recent, lastBuild };
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[x-post-self-build-metrics] DB error (build_events):', err.message);
    // Try fallback table names
    return await getBuildMetricsFallback();
  }
}

async function getBuildMetricsFallback() {
  try {
    const client = await pool.connect();
    try {
      // Try alternate table: skills or capability_events
      const tablesResult = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);
      const tables = tablesResult.rows.map(r => r.table_name);
      console.log('[x-post-self-build-metrics] Available tables:', tables);

      let total = 0, success = 0, recent = 0, lastBuild = null;

      if (tables.includes('capability_events')) {
        const r = await client.query(`SELECT COUNT(*) as total FROM capability_events`);
        total = parseInt(r.rows[0]?.total || '0', 10);
        const s = await client.query(`SELECT COUNT(*) as success FROM capability_events WHERE outcome = 'success' OR status = 'success'`);
        success = parseInt(s.rows[0]?.success || '0', 10);
      }

      if (tables.includes('skills')) {
        const r = await client.query(`SELECT COUNT(*) as total FROM skills`);
        total = Math.max(total, parseInt(r.rows[0]?.total || '0', 10));
      }

      return { total, success, recent, lastBuild };
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[x-post-self-build-metrics] Fallback DB error:', err.message);
    return { total: 0, success: 0, recent: 0, lastBuild: null };
  }
}

async function gatherAllMetrics() {
  const [skillCount, builderSummary, dbMetrics] = await Promise.all([
    countSkills(),
    getBuilderCodeSummary(),
    getBuildMetricsFromDB(),
  ]);

  const successRate = dbMetrics.total > 0
    ? Math.round((dbMetrics.success / dbMetrics.total) * 100)
    : null;

  return {
    skillCount,
    builderSummary,
    dbMetrics,
    successRate,
  };
}

function draftTweet(metrics) {
  const { skillCount, builderSummary, dbMetrics, successRate } = metrics;

  const rateStr = successRate !== null ? `${successRate}% success rate` : 'tracking success rate';
  const totalStr = dbMetrics.total > 0 ? `${dbMetrics.total} builds logged` : '';
  const recentStr = dbMetrics.recent > 0 ? `${dbMetrics.recent} in the last 7 days` : '';
  const builderStr = builderSummary.lines > 0
    ? `autonomous-builder.js: ${builderSummary.lines} lines, ${builderSummary.functionCount} functions`
    : '';

  const parts = [
    `🔧 OCA self-build loop metrics:`,
    `• ${skillCount} motor skills deployed`,
    totalStr ? `• ${totalStr}` : null,
    recentStr ? `• ${recentStr}` : null,
    `• ${rateStr}`,
    builderStr ? `• ${builderStr}` : null,
    ``,
    `The loop keeps building itself. 🤖`,
    `#OCA #AIAgents #SelfBuilding`,
  ].filter(Boolean).join('\n');

  // Trim to 280 chars if needed
  if (parts.length <= 280) return parts;

  // Shorter fallback
  const fallback = [
    `🔧 OCA self-build loop:`,
    `• ${skillCount} motor skills`,
    totalStr ? `• ${totalStr}` : null,
    `• ${rateStr}`,
    `The loop builds itself. 🤖 #OCA #AIAgents`,
  ].filter(Boolean).join('\n');

  return fallback.slice(0, 280);
}

async function postSelfBuildMetrics(options = {}) {
  try {
    emit('skill:start', { skill: 'x-post-self-build-metrics', options });

    // 1. Gather metrics
    console.log('[x-post-self-build-metrics] Gathering metrics...');
    const metrics = await gatherAllMetrics();
    console.log('[x-post-self-build-metrics] Metrics:', JSON.stringify(metrics, null, 2));

    // 2. Draft tweet
    const tweetText = options.customText || draftTweet(metrics);
    console.log('[x-post-self-build-metrics] Draft tweet:\n', tweetText);

    // 3. Post via x-post skill
    const xPost = await import('./x-post.js');
    const postFn = xPost.default?.post || xPost.default?.postTweet || xPost.post;

    let result;
    if (typeof postFn === 'function') {
      result = await postFn({ text: tweetText });
    } else {
      // Fallback: use motor directly to open X and post
      result = await postViaMotor(tweetText);
    }

    emit('skill:complete', {
      skill: 'x-post-self-build-metrics',
      metrics,
      tweetText,
      result,
    });

    return { success: true, metrics, tweetText, result };
  } catch (err) {
    console.error('[x-post-self-build-metrics] Error:', err.message);
    emit('skill:error', { skill: 'x-post-self-build-metrics', error: err.message });
    return { success: false, error: err.message };
  }
}

async function postViaMotor(tweetText) {
  try {
    console.log('[x-post-self-build-metrics] Posting via motor browser automation...');

    await motor.openUrl('https://x.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));

    // Try to find and click the tweet compose area
    await motor.click({ x: 760, y: 400 });
    await new Promise(r => setTimeout(r, 1000));

    await motor.copyToClipboard(tweetText);
    await motor.press(['command', 'v']);
    await new Promise(r => setTimeout(r, 1000));

    // Submit
    await motor.press(['command', 'return']);
    await new Promise(r => setTimeout(r, 2000));

    return { method: 'motor-browser', status: 'posted' };
  } catch (err) {
    console.error('[x-post-self-build-metrics] Motor post error:', err.message);
    throw err;
  }
}

async function getMetrics() {
  return await gatherAllMetrics();
}

async function getDraftTweet(options = {}) {
  const metrics = await gatherAllMetrics();
  const text = options.customText || draftTweet(metrics);
  return { text, metrics };
}

async function run(options = {}) {
  return await postSelfBuildMetrics(options);
}

export default {
  postSelfBuildMetrics,
  getMetrics,
  getDraftTweet,
  run,
  // Expose internals for testing
  countSkills,
  getBuilderCodeSummary,
  getBuildMetricsFromDB,
  draftTweet,
};