import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';
import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SKILL_NAME = 'x-post-capability-growth';

async function getSkillCount() {
  try {
    const files = await readdir(__dirname);
    const skills = files.filter(f => f.endsWith('.js') && f !== 'index.js');
    return { count: skills.length, skills };
  } catch (err) {
    console.error(`[${SKILL_NAME}] Failed to read skills dir:`, err.message);
    return { count: 0, skills: [] };
  }
}

async function getBuildHistory() {
  const client = await pool.connect();
  try {
    // Discover build-related tables
    const tablesResult = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND (table_name ILIKE '%build%' OR table_name ILIKE '%skill%')
      ORDER BY table_name
    `);
    const tables = tablesResult.rows.map(r => r.table_name);

    // Try build_history first
    for (const table of ['build_history', 'build_events', 'capability_events', 'skill_invocations']) {
      if (!tables.includes(table)) continue;
      try {
        const colsResult = await client.query(`
          SELECT column_name FROM information_schema.columns WHERE table_name = $1
        `, [table]);
        const cols = colsResult.rows.map(r => r.column_name);

        const statusCol = cols.find(c => c === 'status' || c === 'outcome');
        const nameCol = cols.find(c => c === 'skill_name' || c === 'name');
        const timeCol = cols.find(c => c.includes('created') || c.includes('invoked') || c === 'timestamp');

        if (!statusCol || !nameCol || !timeCol) continue;

        const totalResult = await client.query(`SELECT COUNT(*) AS total FROM ${table}`);
        const total = parseInt(totalResult.rows[0]?.total || '0', 10);

        const successResult = await client.query(
          `SELECT COUNT(*) AS cnt FROM ${table} WHERE ${statusCol} ILIKE 'success'`
        );
        const successes = parseInt(successResult.rows[0]?.cnt || '0', 10);

        const failResult = await client.query(
          `SELECT COUNT(*) AS cnt FROM ${table} WHERE ${statusCol} ILIKE '%fail%'`
        );
        const failures = parseInt(failResult.rows[0]?.cnt || '0', 10);

        const recentResult = await client.query(
          `SELECT COUNT(*) AS cnt FROM ${table} WHERE ${timeCol} >= NOW() - INTERVAL '30 days'`
        );
        const recentBuilds = parseInt(recentResult.rows[0]?.cnt || '0', 10);

        const recentSkillsResult = await client.query(`
          SELECT DISTINCT ${nameCol} AS skill_name
          FROM ${table}
          WHERE ${timeCol} >= NOW() - INTERVAL '30 days'
            AND ${statusCol} ILIKE 'success'
          ORDER BY ${nameCol}
          LIMIT 8
        `);
        const recentSkillNames = recentSkillsResult.rows.map(r => r.skill_name).filter(Boolean);

        const weeklyResult = await client.query(
          `SELECT COUNT(*) AS cnt FROM ${table} WHERE ${timeCol} >= NOW() - INTERVAL '7 days'`
        );
        const weeklyBuilds = parseInt(weeklyResult.rows[0]?.cnt || '0', 10);

        return {
          table,
          total,
          successes,
          failures,
          recentBuilds,
          weeklyBuilds,
          recentSkillNames,
          successRate: total > 0 ? Math.round((successes / total) * 100) : null,
        };
      } catch (e) {
        continue;
      }
    }

    return { table: null, total: 0, successes: 0, failures: 0, recentBuilds: 0, weeklyBuilds: 0, recentSkillNames: [], successRate: null };
  } finally {
    client.release();
  }
}

async function getFailureData() {
  const client = await pool.connect();
  try {
    for (const table of ['build_history', 'build_events', 'skill_invocations']) {
      try {
        const colsResult = await client.query(`
          SELECT column_name FROM information_schema.columns WHERE table_name = $1
        `, [table]);
        const cols = colsResult.rows.map(r => r.column_name);

        const statusCol = cols.find(c => c === 'status' || c === 'outcome');
        const nameCol = cols.find(c => c === 'skill_name' || c === 'name');
        const errorCol = cols.find(c => c.includes('error') || c.includes('message'));
        const timeCol = cols.find(c => c.includes('created') || c.includes('invoked') || c === 'timestamp');

        if (!statusCol || !nameCol || !timeCol) continue;

        const errorColSel = errorCol ? `, ${errorCol} AS error_msg` : '';
        const failureRows = await client.query(`
          SELECT ${nameCol} AS skill_name${errorColSel}, ${timeCol} AS created_at
          FROM ${table}
          WHERE ${statusCol} ILIKE '%fail%'
            AND ${timeCol} >= NOW() - INTERVAL '30 days'
          ORDER BY ${timeCol} DESC
          LIMIT 10
        `);

        if (failureRows.rows.length === 0) continue;

        const bySkill = {};
        for (const row of failureRows.rows) {
          const skill = row.skill_name || 'unknown';
          bySkill[skill] = (bySkill[skill] || 0) + 1;
        }

        const topFailingSkill = Object.entries(bySkill).sort((a, b) => b[1] - a[1])[0];

        // Classify error types
        const errorTypes = { module: 0, syntax: 0, type: 0, timeout: 0, permission: 0, other: 0 };
        for (const row of failureRows.rows) {
          const msg = (row.error_msg || '').toLowerCase();
          if (msg.includes('cannot find module') || msg.includes('module not found')) errorTypes.module++;
          else if (msg.includes('syntaxerror')) errorTypes.syntax++;
          else if (msg.includes('typeerror')) errorTypes.type++;
          else if (msg.includes('timeout')) errorTypes.timeout++;
          else if (msg.includes('eacces') || msg.includes('permission')) errorTypes.permission++;
          else errorTypes.other++;
        }

        return {
          recentFailures: failureRows.rows.length,
          bySkill,
          topFailingSkill: topFailingSkill ? topFailingSkill[0] : null,
          topFailingCount: topFailingSkill ? topFailingSkill[1] : 0,
          errorTypes,
        };
      } catch (e) {
        continue;
      }
    }
    return { recentFailures: 0, bySkill: {}, topFailingSkill: null, topFailingCount: 0, errorTypes: {} };
  } finally {
    client.release();
  }
}

async function getGrowthTrend() {
  const client = await pool.connect();
  try {
    for (const table of ['build_history', 'build_events', 'skill_invocations']) {
      try {
        const colsResult = await client.query(`
          SELECT column_name FROM information_schema.columns WHERE table_name = $1
        `, [table]);
        const cols = colsResult.rows.map(r => r.column_name);
        const timeCol = cols.find(c => c.includes('created') || c.includes('invoked') || c === 'timestamp');
        const statusCol = cols.find(c => c === 'status' || c === 'outcome');

        if (!timeCol || !statusCol) continue;

        // Builds per week for last 4 weeks
        const weeklyResult = await client.query(`
          SELECT
            DATE_TRUNC('week', ${timeCol}) AS week_start,
            COUNT(*) AS builds,
            SUM(CASE WHEN ${statusCol} ILIKE 'success' THEN 1 ELSE 0 END) AS successes
          FROM ${table}
          WHERE ${timeCol} >= NOW() - INTERVAL '4 weeks'
          GROUP BY DATE_TRUNC('week', ${timeCol})
          ORDER BY week_start ASC
        `);

        const weeks = weeklyResult.rows.map(r => ({
          week: new Date(r.week_start).toISOString().slice(0, 10),
          builds: parseInt(r.builds, 10),
          successes: parseInt(r.successes, 10),
        }));

        return { weeks, available: true };
      } catch (e) {
        continue;
      }
    }
    return { weeks: [], available: false };
  } finally {
    client.release();
  }
}

async function gatherAllData() {
  const [skillData, buildHistory, failureData, growthTrend] = await Promise.all([
    getSkillCount(),
    getBuildHistory(),
    getFailureData(),
    getGrowthTrend(),
  ]);
  return { skillData, buildHistory, failureData, growthTrend };
}

function buildTweetText(data) {
  const { skillData, buildHistory, failureData, growthTrend } = data;

  const skillCount = skillData.count;
  const total = buildHistory.total;
  const successRate = buildHistory.successRate;
  const recentBuilds = buildHistory.recentBuilds;
  const weeklyBuilds = buildHistory.weeklyBuilds;
  const recentSkills = buildHistory.recentSkillNames.slice(0, 3);
  const failCount = failureData.recentFailures;
  const topFail = failureData.topFailingSkill;

  // Trend arrow
  let trendStr = '';
  if (growthTrend.available && growthTrend.weeks.length >= 2) {
    const first = growthTrend.weeks[0].builds;
    const last = growthTrend.weeks[growthTrend.weeks.length - 1].builds;
    if (last > first) trendStr = ` (↑ ${last - first} more than 4 weeks ago)`;
    else if (last < first) trendStr = ` (↓ ${first - last} fewer than 4 weeks ago)`;
  }

  const lines = [
    `OCA autonomous capability growth — real numbers:`,
    ``,
    `Motor skills: ${skillCount}`,
  ];

  if (total > 0) {
    lines.push(`Total builds logged: ${total}`);
  }
  if (successRate !== null) {
    lines.push(`Build success rate: ${successRate}%`);
  }
  if (recentBuilds > 0) {
    lines.push(`Last 30 days: ${recentBuilds} builds${trendStr}`);
  }
  if (weeklyBuilds > 0) {
    lines.push(`This week: ${weeklyBuilds} builds`);
  }

  if (recentSkills.length > 0) {
    lines.push(`Recent additions: ${recentSkills.join(', ')}`);
  }

  lines.push(``);

  if (failCount > 0) {
    const failLine = topFail
      ? `${failCount} failures in 30 days — worst offender: ${topFail}`
      : `${failCount} failures in 30 days — logged, not hidden`;
    lines.push(failLine);
  } else if (total > 0) {
    lines.push(`No failures in the last 30 days.`);
  }

  lines.push(``, `#OCA #AutonomousAI #SelfBuilding`);

  const text = lines.join('\n');
  if (text.length <= 280) return text;

  // Shorter fallback
  const fallback = [
    `OCA capability growth:`,
    `• ${skillCount} motor skills`,
    total > 0 ? `• ${total} total builds` : null,
    successRate !== null ? `• ${successRate}% success rate` : null,
    recentBuilds > 0 ? `• ${recentBuilds} builds in 30 days` : null,
    failCount > 0 ? `• ${failCount} failures (honest accounting)` : null,
    `#OCA #AutonomousAI`,
  ].filter(Boolean).join('\n');

  return fallback.slice(0, 280);
}

function ab(cmd, opts = {}) {
  const { timeout = 30000 } = opts;
  const PROFILE = '/Users/quinnodonnell/.openclaw/workspace/oneiro-core/private/browser-profile';
  const SESSION = 'oca';
  const STEALTH = '--disable-blink-features=AutomationControlled';
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  return execSync(
    `agent-browser ${cmd} --session ${SESSION} --profile "${PROFILE}" --args "${STEALTH}" --user-agent "${UA}"`,
    { encoding: 'utf-8', timeout, env: { ...process.env, AGENT_BROWSER_SESSION: SESSION } }
  ).trim();
}

async function isQuinnActive() {
  try {
    const r = await fetch('http://localhost:3333/oca/sense');
    const s = await r.json();
    return s?.derived?.userActivity === 'active' && (s?.derived?.idleSeconds ?? 9999) < 120;
  } catch { return true; }
}

async function postViaBrowser(text) {
  try {
    ab(`open "https://x.com/compose/post"`, { timeout: 15000 });
    ab('wait 3000');

    const snap = ab('snapshot -i -c');
    const hasCompose = snap.includes('textbox') || snap.includes('Post');
    if (!hasCompose) {
      return { success: false, error: 'Compose box not found — may need login' };
    }

    const textboxMatch = snap.match(/textbox[^\n]*\[ref=(e\d+)\]/);
    const ref = textboxMatch ? textboxMatch[1] : null;

    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    if (ref) {
      ab(`click @${ref}`);
      ab('wait 300');
      ab(`type @${ref} "${escaped}"`);
    } else {
      ab('click "[data-testid=tweetTextarea_0]"');
      ab('wait 300');
      ab(`type "[data-testid=tweetTextarea_0]" "${escaped}"`);
    }
    ab('wait 1000');

    const content = ab('eval "document.querySelector(\'[data-testid=tweetTextarea_0]\')?.textContent || \'\'"');
    if (!content || content.length < 5) {
      return { success: false, error: 'Text did not appear in compose box' };
    }

    ab('press "Meta+Enter"');
    ab('wait 4000');

    console.log(`[${SKILL_NAME}] Posted via agent-browser (${text.length}/280 chars)`);
    return { success: true, method: 'agent-browser' };
  } catch (err) {
    return { success: false, error: err.message?.slice(0, 200) };
  }
}

async function postViaXPoster(text) {
  try {
    const xPoster = await import('./x-poster.js');
    const postFn = xPoster.post || xPoster.default?.post;
    if (typeof postFn === 'function') {
      return await postFn(text, { skill: SKILL_NAME });
    }
  } catch (err) {
    console.warn(`[${SKILL_NAME}] x-poster import failed: ${err.message}`);
  }
  return null;
}

async function logToDb(payload) {
  try {
    await pool.query(
      `INSERT INTO motor_skill_logs (skill_name, event_type, payload, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [SKILL_NAME, payload.success ? 'post_success' : 'post_failure', JSON.stringify(payload)]
    );
  } catch (err) {
    console.warn(`[${SKILL_NAME}] DB log failed (non-fatal):`, err.message);
  }
}

async function postCapabilityGrowth(options = {}) {
  emit('skill:start', { skill: SKILL_NAME, options });

  try {
    console.log(`[${SKILL_NAME}] Gathering capability growth data...`);
    const data = await gatherAllData();

    console.log(`[${SKILL_NAME}] Skills: ${data.skillData.count}, Builds: ${data.buildHistory.total}, Failures (30d): ${data.failureData.recentFailures}`);

    const tweetText = options.customText || buildTweetText(data);
    console.log(`[${SKILL_NAME}] Tweet (${tweetText.length} chars):\n${tweetText}`);

    if (tweetText.length > 280) {
      const err = `Tweet too long: ${tweetText.length}/280`;
      console.error(`[${SKILL_NAME}] ${err}`);
      emit('skill:error', { skill: SKILL_NAME, error: err });
      return { success: false, error: err };
    }

    // Try x-poster first (handles API + browser + draft logic)
    const xPosterResult = await postViaXPoster(tweetText);
    if (xPosterResult) {
      await logToDb({ ...xPosterResult, data, tweetText });
      emit('skill:complete', { skill: SKILL_NAME, result: xPosterResult, tweetText });
      return { success: xPosterResult.success, tweetText, result: xPosterResult, data };
    }

    // Quinn active check before direct browser posting
    if (await isQuinnActive()) {
      console.log(`[${SKILL_NAME}] Quinn is active — skipping autonomous post`);
      emit('skill:complete', { skill: SKILL_NAME, result: 'quinn_active', tweetText });
      return { success: false, blocked: true, tweetText, data };
    }

    const result = await postViaBrowser(tweetText);
    await logToDb({ ...result, data, tweetText });
    emit('skill:complete', { skill: SKILL_NAME, result, tweetText });

    return { success: result.success, tweetText, result, data };
  } catch (err) {
    console.error(`[${SKILL_NAME}] Fatal error:`, err.message);
    emit('skill:error', { skill: SKILL_NAME, error: err.message });
    return { success: false, error: err.message };
  }
}

async function getGrowthSnapshot() {
  const data = await gatherAllData();
  const tweetText = buildTweetText(data);
  return { data, tweetText };
}

async function run(options = {}) {
  return postCapabilityGrowth(options);
}

export default {
  postCapabilityGrowth,
  getGrowthSnapshot,
  getSkillCount,
  getBuildHistory,
  getFailureData,
  getGrowthTrend,
  buildTweetText,
  run,
};