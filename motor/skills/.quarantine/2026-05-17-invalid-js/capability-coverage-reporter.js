import { pool, emit } from '../../event-bus.js';

const REPORT_EVENT = 'capability:coverage:report';
const NEVER_USED_THRESHOLD_DAYS = 30;
const RECENT_FAILURE_THRESHOLD_DAYS = 7;
const LOW_SUCCESS_RATE_THRESHOLD = 0.5;

async function getSkillInvocationHistory() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT
        skill_name,
        COUNT(*) AS total_invocations,
        SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS successes,
        SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) AS failures,
        MAX(invoked_at) AS last_invoked_at,
        MAX(CASE WHEN outcome = 'failure' THEN invoked_at END) AS last_failed_at,
        MIN(invoked_at) AS first_invoked_at
      FROM skill_invocations
      GROUP BY skill_name
      ORDER BY skill_name ASC
    `);
    return result.rows;
  } finally {
    client.release();
  }
}

async function getRegisteredSkills() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT skill_name, registered_at, file_path, description
      FROM registered_skills
      ORDER BY skill_name ASC
    `);
    return result.rows;
  } finally {
    client.release();
  }
}

async function getRecentFailures(days = RECENT_FAILURE_THRESHOLD_DAYS) {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT
        skill_name,
        invoked_at,
        error_message,
        context
      FROM skill_invocations
      WHERE outcome = 'failure'
        AND invoked_at >= NOW() - INTERVAL '${days} days'
      ORDER BY invoked_at DESC
    `);
    return result.rows;
  } finally {
    client.release();
  }
}

function computeNeverUsedSkills(registeredSkills, invocationMap) {
  return registeredSkills
    .filter(skill => !invocationMap.has(skill.skill_name))
    .map(skill => ({
      skill_name: skill.skill_name,
      registered_at: skill.registered_at,
      file_path: skill.file_path,
      description: skill.description || null,
      reason: 'never_invoked'
    }));
}

function computeZeroCoverageSkills(registeredSkills, invocationMap) {
  const zeroCoverage = [];
  for (const skill of registeredSkills) {
    const inv = invocationMap.get(skill.skill_name);
    if (!inv) {
      zeroCoverage.push({
        skill_name: skill.skill_name,
        registered_at: skill.registered_at,
        file_path: skill.file_path,
        total_invocations: 0,
        successes: 0,
        failures: 0,
        success_rate: null,
        reason: 'zero_coverage'
      });
    } else if (Number(inv.total_invocations) === 0) {
      zeroCoverage.push({
        skill_name: skill.skill_name,
        registered_at: skill.registered_at,
        file_path: skill.file_path,
        total_invocations: 0,
        successes: 0,
        failures: 0,
        success_rate: null,
        reason: 'zero_coverage'
      });
    }
  }
  return zeroCoverage;
}

function computeRecentlyFailedSkills(invocationHistory, recentFailures) {
  const recentFailureMap = new Map();
  for (const failure of recentFailures) {
    if (!recentFailureMap.has(failure.skill_name)) {
      recentFailureMap.set(failure.skill_name, []);
    }
    recentFailureMap.get(failure.skill_name).push({
      invoked_at: failure.invoked_at,
      error_message: failure.error_message || null,
      context: failure.context || null
    });
  }

  const result = [];
  for (const [skill_name, failures] of recentFailureMap.entries()) {
    const histEntry = invocationHistory.find(h => h.skill_name === skill_name);
    const total = histEntry ? Number(histEntry.total_invocations) : 0;
    const successes = histEntry ? Number(histEntry.successes) : 0;
    const totalFailures = histEntry ? Number(histEntry.failures) : failures.length;
    const successRate = total > 0 ? successes / total : 0;

    result.push({
      skill_name,
      total_invocations: total,
      successes,
      failures: totalFailures,
      success_rate: total > 0 ? parseFloat(successRate.toFixed(4)) : null,
      recent_failure_count: failures.length,
      recent_failures: failures.slice(0, 5),
      last_failed_at: histEntry?.last_failed_at || null
    });
  }

  return result.sort((a, b) => b.recent_failure_count - a.recent_failure_count);
}

function computeLowSuccessRateSkills(invocationHistory, threshold = LOW_SUCCESS_RATE_THRESHOLD) {
  return invocationHistory
    .filter(inv => {
      const total = Number(inv.total_invocations);
      const successes = Number(inv.successes);
      if (total === 0) return false;
      const rate = successes / total;
      return rate < threshold;
    })
    .map(inv => {
      const total = Number(inv.total_invocations);
      const successes = Number(inv.successes);
      const failures = Number(inv.failures);
      return {
        skill_name: inv.skill_name,
        total_invocations: total,
        successes,
        failures,
        success_rate: parseFloat((successes / total).toFixed(4)),
        last_invoked_at: inv.last_invoked_at,
        last_failed_at: inv.last_failed_at
      };
    })
    .sort((a, b) => a.success_rate - b.success_rate);
}

function computeStaleSkills(invocationHistory, days = NEVER_USED_THRESHOLD_DAYS) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return invocationHistory
    .filter(inv => {
      const lastInvoked = inv.last_invoked_at ? new Date(inv.last_invoked_at) : null;
      return lastInvoked && lastInvoked < cutoff;
    })
    .map(inv => ({
      skill_name: inv.skill_name,
      total_invocations: Number(inv.total_invocations),
      last_invoked_at: inv.last_invoked_at,
      days_since_last_use: Math.floor((Date.now() - new Date(inv.last_invoked_at).getTime()) / (24 * 60 * 60 * 1000))
    }))
    .sort((a, b) => b.days_since_last_use - a.days_since_last_use);
}

function buildSummary(report) {
  return {
    total_registered_skills: report.registered_skills_count,
    total_skills_with_history: report.skills_with_history_count,
    never_used_count: report.never_used_skills.length,
    zero_coverage_count: report.zero_coverage_skills.length,
    recently_failed_count: report.recently_failed_skills.length,
    low_success_rate_count: report.low_success_rate_skills.length,
    stale_skills_count: report.stale_skills.length,
    health_score: computeHealthScore(report)
  };
}

function computeHealthScore(report) {
  const total = report.registered_skills_count;
  if (total === 0) return 1.0;

  const problemSkills = new Set([
    ...report.never_used_skills.map(s => s.skill_name),
    ...report.recently_failed_skills.map(s => s.skill_name),
    ...report.low_success_rate_skills.map(s => s.skill_name)
  ]);

  const healthyCount = total - problemSkills.size;
  return parseFloat(Math.max(0, healthyCount / total).toFixed(4));
}

async function generateReport(options = {}) {
  const {
    neverUsedThresholdDays = NEVER_USED_THRESHOLD_DAYS,
    recentFailureThresholdDays = RECENT_FAILURE_THRESHOLD_DAYS,
    lowSuccessRateThreshold = LOW_SUCCESS_RATE_THRESHOLD,
    emitEvent = true
  } = options;

  try {
    const [registeredSkills, invocationHistory, recentFailures] = await Promise.all([
      getRegisteredSkills(),
      getSkillInvocationHistory(),
      getRecentFailures(recentFailureThresholdDays)
    ]);

    const invocationMap = new Map(invocationHistory.map(inv => [inv.skill_name, inv]));

    const neverUsedSkills = computeNeverUsedSkills(registeredSkills, invocationMap);
    const zeroCoverageSkills = computeZeroCoverageSkills(registeredSkills, invocationMap);
    const recentlyFailedSkills = computeRecentlyFailedSkills(invocationHistory, recentFailures);
    const lowSuccessRateSkills = computeLowSuccessRateSkills(invocationHistory, lowSuccessRateThreshold);
    const staleSkills = computeStaleSkills(invocationHistory, neverUsedThresholdDays);

    const report = {
      generated_at: new Date().toISOString(),
      config: {
        never_used_threshold_days: neverUsedThresholdDays,
        recent_failure_threshold_days: recentFailureThresholdDays,
        low_success_rate_threshold: lowSuccessRateThreshold
      },
      registered_skills_count: registeredSkills.length,
      skills_with_history_count: invocationHistory.length,
      never_used_skills: neverUsedSkills,
      zero_coverage_skills: zeroCoverageSkills,
      recently_failed_skills: recentlyFailedSkills,
      low_success_rate_skills: lowSuccessRateSkills,
      stale_skills: staleSkills,
      all_skills_summary: invocationHistory.map(inv => ({
        skill_name: inv.skill_name,
        total_invocations: Number(inv.total_invocations),
        successes: Number(inv.successes),
        failures: Number(inv.failures),
        success_rate: Number(inv.total_invocations) > 0
          ? parseFloat((Number(inv.successes) / Number(inv.total_invocations)).toFixed(4))
          : null,
        last_invoked_at: inv.last_invoked_at,
        last_failed_at: inv.last_failed_at,
        first_invoked_at: inv.first_invoked_at
      }))
    };

    report.summary = buildSummary(report);

    if (emitEvent) {
      await emit(REPORT_EVENT, {
        report,
        timestamp: report.generated_at
      });
    }

    return report;
  } catch (error) {
    const errorReport = {
      generated_at: new Date().toISOString(),
      error: true,
      error_message: error.message,
      stack: error.stack
    };

    if (emitEvent) {
      await emit('capability:coverage:report:error', {
        error: error.message,
        timestamp: errorReport.generated_at
      });
    }

    throw error;
  }
}

async function getNeverUsedSkills(options = {}) {
  const { thresholdDays = NEVER_USED_THRESHOLD_DAYS } = options;
  const [registeredSkills, invocationHistory] = await Promise.all([
    getRegisteredSkills(),
    getSkillInvocationHistory()
  ]);
  const invocationMap = new Map(invocationHistory.map(inv => [inv.skill_name, inv]));
  return computeNeverUsedSkills(registeredSkills, invocationMap);
}

async function getRecentlyFailedSkills(options = {}) {
  const { days = RECENT_FAILURE_THRESHOLD_DAYS } = options;
  const [invocationHistory, recentFailures] = await Promise.all([
    getSkillInvocationHistory(),
    getRecentFailures(days)
  ]);
  return computeRecentlyFailedSkills(invocationHistory, recentFailures);
}

async function getZeroCoverageSkills() {
  const [registeredSkills, invocationHistory] = await Promise.all([
    getRegisteredSkills(),
    getSkillInvocationHistory()
  ]);
  const invocationMap = new Map(invocationHistory.map(inv => [inv.skill_name, inv]));
  return computeZeroCoverageSkills(registeredSkills, invocationMap);
}

async function getLowSuccessRateSkills(options = {}) {
  const { threshold = LOW_SUCCESS_RATE_THRESHOLD } = options;
  const invocationHistory = await getSkillInvocationHistory();
  return computeLowSuccessRateSkills(invocationHistory, threshold);
}

async function getStaleSkills(options = {}) {
  const { days = NEVER_USED_THRESHOLD_DAYS } = options;
  const invocationHistory = await getSkillInvocationHistory();
  return computeStaleSkills(invocationHistory, days);
}

async function recordInvocation(skillName, outcome, options = {}) {
  const { errorMessage = null, context = null } = options;
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO skill_invocations (skill_name, outcome, error_message, context, invoked_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, [skillName, outcome, errorMessage, context ? JSON.stringify(context) : null]);

    await emit('skill:invocation:recorded', {
      skill_name: skillName,
      outcome,
      timestamp: new Date().toISOString()
    });
  } finally {
    client.release();
  }
}

async function registerSkill(skillName, options = {}) {
  const { filePath = null, description = null } = options;
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO registered_skills (skill_name, file_path, description, registered_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (skill_name) DO UPDATE
        SET file_path = EXCLUDED.file_path,
            description = EXCLUDED.description
    `, [skillName, filePath, description]);

    await emit('skill:registered', {
      skill_name: skillName,
      file_path: filePath,
      timestamp: new Date().toISOString()
    });
  } finally {
    client.release();
  }
}

async function getSkillStats(skillName) {
  const client = await pool.