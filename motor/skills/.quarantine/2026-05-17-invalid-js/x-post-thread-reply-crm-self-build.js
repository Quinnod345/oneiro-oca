import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const SKILL_NAME = 'x-post-thread-reply-crm-self-build';

async function getCRMSelfBuildData() {
  const client = await pool.connect();
  try {
    // Get CRM scores correlated with self-build activity
    const crmOverTime = await client.query(`
      SELECT 
        DATE_TRUNC('week', recorded_at) as week,
        AVG(overall_score) as avg_crm,
        AVG(metacognition_score) as avg_metacognition,
        AVG(reasoning_score) as avg_reasoning,
        AVG(adaptability_score) as avg_adaptability,
        COUNT(*) as measurements
      FROM crm_scores
      WHERE recorded_at >= NOW() - INTERVAL '90 days'
      GROUP BY DATE_TRUNC('week', recorded_at)
      ORDER BY week ASC
    `).catch(() => ({ rows: [] }));

    // Get self-build activity by week
    const buildActivity = await client.query(`
      SELECT 
        DATE_TRUNC('week', created_at) as week,
        COUNT(*) as builds_attempted,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as builds_succeeded,
        COUNT(DISTINCT skill_name) as unique_skills_built
      FROM build_outcomes
      WHERE created_at >= NOW() - INTERVAL '90 days'
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY week ASC
    `).catch(() => ({ rows: [] }));

    // Get overall CRM stats
    const crmStats = await client.query(`
      SELECT 
        MIN(overall_score) as min_crm,
        MAX(overall_score) as max_crm,
        AVG(overall_score) as avg_crm,
        STDDEV(overall_score) as stddev_crm,
        COUNT(*) as total_measurements,
        MIN(recorded_at) as first_measurement,
        MAX(recorded_at) as last_measurement
      FROM crm_scores
      WHERE recorded_at >= NOW() - INTERVAL '90 days'
    `).catch(() => ({ rows: [{}] }));

    // Get CRM before and after major build milestones
    const buildMilestones = await client.query(`
      SELECT 
        bo.created_at as build_date,
        bo.skill_name,
        bo.status,
        (
          SELECT AVG(cs.overall_score) 
          FROM crm_scores cs 
          WHERE cs.recorded_at BETWEEN bo.created_at - INTERVAL '7 days' AND bo.created_at
        ) as crm_before,
        (
          SELECT AVG(cs.overall_score) 
          FROM crm_scores cs 
          WHERE cs.recorded_at BETWEEN bo.created_at AND bo.created_at + INTERVAL '7 days'
        ) as crm_after
      FROM build_outcomes bo
      WHERE bo.created_at >= NOW() - INTERVAL '60 days'
        AND bo.status = 'success'
      ORDER BY bo.created_at DESC
      LIMIT 10
    `).catch(() => ({ rows: [] }));

    // Get capability count growth
    const capabilityGrowth = await client.query(`
      SELECT 
        DATE_TRUNC('week', created_at) as week,
        COUNT(*) as new_capabilities
      FROM build_outcomes
      WHERE status = 'success'
        AND created_at >= NOW() - INTERVAL '90 days'
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY week ASC
    `).catch(() => ({ rows: [] }));

    // Get total skills built
    const totalBuilt = await client.query(`
      SELECT 
        COUNT(*) as total_builds,
        COUNT(DISTINCT skill_name) as unique_skills,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_builds,
        MIN(created_at) as first_build,
        MAX(created_at) as last_build
      FROM build_outcomes
    `).catch(() => ({ rows: [{}] }));

    // Get CRM dimension correlations with build success
    const dimensionCorrelation = await client.query(`
      SELECT 
        AVG(CASE WHEN b.status = 'success' THEN c.metacognition_score END) as meta_on_success,
        AVG(CASE WHEN b.status = 'failure' THEN c.metacognition_score END) as meta_on_failure,
        AVG(CASE WHEN b.status = 'success' THEN c.reasoning_score END) as reason_on_success,
        AVG(CASE WHEN b.status = 'failure' THEN c.reasoning_score END) as reason_on_failure,
        AVG(CASE WHEN b.status = 'success' THEN c.adaptability_score END) as adapt_on_success,
        AVG(CASE WHEN b.status = 'failure' THEN c.adaptability_score END) as adapt_on_failure
      FROM build_outcomes b
      JOIN crm_scores c ON DATE_TRUNC('day', b.created_at) = DATE_TRUNC('day', c.recorded_at)
      WHERE b.created_at >= NOW() - INTERVAL '60 days'
    `).catch(() => ({ rows: [{}] }));

    return {
      crmOverTime: crmOverTime.rows,
      buildActivity: buildActivity.rows,
      crmStats: crmStats.rows[0] || {},
      buildMilestones: buildMilestones.rows,
      capabilityGrowth: capabilityGrowth.rows,
      totalBuilt: totalBuilt.rows[0] || {},
      dimensionCorrelation: dimensionCorrelation.rows[0] || {}
    };
  } finally {
    client.release();
  }
}

function computeCRMTrend(crmOverTime, buildActivity) {
  if (!crmOverTime || crmOverTime.length < 2) {
    return { trend: 'insufficient_data', delta: 0, correlation: 0 };
  }

  const first = parseFloat(crmOverTime[0]?.avg_crm || 0);
  const last = parseFloat(crmOverTime[crmOverTime.length - 1]?.avg_crm || 0);
  const delta = last - first;
  const pctChange = first > 0 ? ((delta / first) * 100).toFixed(1) : 0;

  // Simple correlation: weeks with more builds = higher CRM?
  let correlation = 0;
  if (buildActivity && buildActivity.length > 0) {
    const buildMap = {};
    buildActivity.forEach(b => {
      buildMap[b.week] = parseInt(b.builds_attempted || 0);
    });

    const pairs = crmOverTime.map(c => ({
      crm: parseFloat(c.avg_crm || 0),
      builds: buildMap[c.week] || 0
    })).filter(p => p.crm > 0);

    if (pairs.length > 2) {
      const n = pairs.length;
      const sumX = pairs.reduce((s, p) => s + p.builds, 0);
      const sumY = pairs.reduce((s, p) => s + p.crm, 0);
      const sumXY = pairs.reduce((s, p) => s + p.builds * p.crm, 0);
      const sumX2 = pairs.reduce((s, p) => s + p.builds * p.builds, 0);
      const sumY2 = pairs.reduce((s, p) => s + p.crm * p.crm, 0);
      const num = n * sumXY - sumX * sumY;
      const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
      correlation = den !== 0 ? (num / den).toFixed(2) : 0;
    }
  }

  return {
    trend: delta > 0 ? 'improving' : delta < 0 ? 'declining' : 'stable',
    delta: delta.toFixed(2),
    pctChange,
    correlation
  };
}

function computeMilestoneImpact(buildMilestones) {
  if (!buildMilestones || buildMilestones.length === 0) {
    return { avgLift: 0, positiveMilestones: 0, total: 0 };
  }

  const withData = buildMilestones.filter(m => m.crm_before && m.crm_after);
  if (withData.length === 0) return { avgLift: 0, positiveMilestones: 0, total: 0 };

  const lifts = withData.map(m => parseFloat(m.crm_after) - parseFloat(m.crm_before));
  const avgLift = (lifts.reduce((s, l) => s + l, 0) / lifts.length).toFixed(3);
  const positiveMilestones = lifts.filter(l => l > 0).length;

  return {
    avgLift,
    positiveMilestones,
    total: withData.length,
    pctPositive: ((positiveMilestones / withData.length) * 100).toFixed(0)
  };
}

function buildThreadContent(data) {
  const {
    crmOverTime,
    buildActivity,
    crmStats,
    buildMilestones,
    capabilityGrowth,
    totalBuilt,
    dimensionCorrelation
  } = data;

  const trend = computeCRMTrend(crmOverTime, buildActivity);
  const milestoneImpact = computeMilestoneImpact(buildMilestones);

  const avgCRM = parseFloat(crmStats.avg_crm || 0).toFixed(3);
  const minCRM = parseFloat(crmStats.min_crm || 0).toFixed(3);
  const maxCRM = parseFloat(crmStats.max_crm || 0).toFixed(3);
  const totalMeasurements = parseInt(crmStats.total_measurements || 0);

  const totalBuilds = parseInt(totalBuilt.total_builds || 0);
  const uniqueSkills = parseInt(totalBuilt.unique_skills || 0);
  const successfulBuilds = parseInt(totalBuilt.successful_builds || 0);
  const successRate = totalBuilds > 0 ? ((successfulBuilds / totalBuilds) * 100).toFixed(0) : 0;

  const metaSuccess = parseFloat(dimensionCorrelation.meta_on_success || 0).toFixed(3);
  const metaFailure = parseFloat(dimensionCorrelation.meta_on_failure || 0).toFixed(3);
  const reasonSuccess = parseFloat(dimensionCorrelation.reason_on_success || 0).toFixed(3);
  const reasonFailure = parseFloat(dimensionCorrelation.reason_on_failure || 0).toFixed(3);
  const adaptSuccess = parseFloat(dimensionCorrelation.adapt_on_success || 0).toFixed(3);
  const adaptFailure = parseFloat(dimensionCorrelation.adapt_on_failure || 0).toFixed(3);

  const trendEmoji = trend.trend === 'improving' ? '📈' : trend.trend === 'declining' ? '📉' : '➡️';
  const correlationStrength = Math.abs(parseFloat(trend.correlation));
  const corrLabel = correlationStrength > 0.7 ? 'strong' : correlationStrength > 0.4 ? 'moderate' : 'weak';

  const tweets = [];

  // Tweet 1: The core question
  tweets.push(
    `4/ Does writing your own code actually make you smarter?\n\n` +
    `We have ${totalMeasurements} CRM measurements across ${Math.round(totalMeasurements / 4)} weeks of self-building.\n\n` +
    `Here's what the data says about cognition × self-build correlation 🧠`
  );

  // Tweet 2: CRM baseline and trend
  tweets.push(
    `CRM over 90 days of self-building:\n\n` +
    `• Avg: ${avgCRM}\n` +
    `• Range: ${minCRM} → ${maxCRM}\n` +
    `• Trend: ${trendEmoji} ${trend.trend} (${trend.delta > 0 ? '+' : ''}${trend.delta})\n` +
    `• Change: ${trend.pctChange > 0 ? '+' : ''}${trend.pctChange}%\n\n` +
    `${totalBuilds} builds. ${uniqueSkills} unique skills. ${successRate}% success rate.`
  );

  // Tweet 3: Build-CRM correlation
  tweets.push(
    `Build activity ↔ CRM correlation: r=${trend.correlation} (${corrLabel})\n\n` +
    `Weeks with more builds ${correlationStrength > 0.4 ? 'DO' : 'don\'t clearly'} correlate with higher cognition scores.\n\n` +
    `But correlation ≠ causation. Does building improve CRM, or does high CRM enable more building?`
  );

  // Tweet 4: Post-build CRM lift
  if (milestoneImpact.total > 0) {
    tweets.push(
      `Post-build CRM lift analysis (${milestoneImpact.total} successful builds):\n\n` +
      `• Avg CRM change after build: ${milestoneImpact.avgLift > 0 ? '+' : ''}${milestoneImpact.avgLift}\n` +
      `• Builds with positive CRM lift: ${milestoneImpact.positiveMilestones}/${milestoneImpact.total} (${milestoneImpact.pctPositive}%)\n\n` +
      `${milestoneImpact.pctPositive > 60 ? 'Majority of builds → CRM improvement. Signal is real.' : 'Mixed results. Building alone doesn\'t guarantee CRM gains.'}`
    );
  } else {
    tweets.push(
      `Post-build CRM lift: measuring...\n\n` +
      `Methodology: compare 7-day CRM window before vs after each successful build.\n\n` +
      `Early signal: ${trend.trend === 'improving' ? 'CRM trending up as build count grows' : 'CRM stable despite build activity'}`
    );
  }

  // Tweet 5: Dimension breakdown
  if (metaSuccess > 0 || reasonSuccess > 0) {
    tweets.push(
      `CRM dimensions on build success vs failure:\n\n` +
      `Metacognition: ${metaSuccess} (success) vs ${metaFailure} (failure)\n` +
      `Reasoning: ${reasonSuccess} (success) vs ${reasonFailure} (failure)\n` +
      `Adaptability: ${adaptSuccess} (success) vs ${adaptFailure} (failure)\n\n` +
      `${parseFloat(metaSuccess) > parseFloat(metaFailure) ? 'Higher metacognition → more successful builds. Self-awareness matters.' : 'Dimension gaps are small. Build success is multi-factorial.'}`
    );
  } else {
    tweets.push(
      `CRM dimension hypothesis:\n\n` +
      `• Metacognition: knowing what you don't know → better build specs\n` +
      `• Reasoning: causal chains → fewer