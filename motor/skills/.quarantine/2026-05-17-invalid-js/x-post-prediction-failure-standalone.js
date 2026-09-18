import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const SKILL_NAME = 'x-post-prediction-failure-standalone';

async function fetchPredictionFailureTaxonomy() {
  const client = await pool.connect();
  try {
    const taxonomyQuery = `
      SELECT 
        failure_category,
        COUNT(*) as total_failures,
        COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () as failure_rate_pct,
        AVG(CASE WHEN severity IS NOT NULL THEN severity ELSE 3 END) as avg_severity,
        MODE() WITHIN GROUP (ORDER BY root_cause) as primary_root_cause
      FROM prediction_failures
      WHERE created_at >= NOW() - INTERVAL '90 days'
      GROUP BY failure_category
      ORDER BY total_failures DESC
      LIMIT 8
    `;

    const examplesQuery = `
      SELECT 
        failure_category,
        root_cause,
        prediction_context,
        actual_outcome,
        expected_outcome,
        created_at,
        severity
      FROM prediction_failures
      WHERE created_at >= NOW() - INTERVAL '90 days'
        AND severity >= 4
      ORDER BY severity DESC, created_at DESC
      LIMIT 10
    `;

    const overallStatsQuery = `
      SELECT 
        COUNT(*) as total_predictions,
        SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) as total_failures,
        SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as overall_failure_rate,
        AVG(CASE WHEN outcome = 'failure' THEN confidence_score ELSE NULL END) as avg_failure_confidence,
        AVG(CASE WHEN outcome = 'success' THEN confidence_score ELSE NULL END) as avg_success_confidence
      FROM predictions
      WHERE created_at >= NOW() - INTERVAL '90 days'
    `;

    const rootCausesQuery = `
      SELECT 
        root_cause,
        COUNT(*) as occurrences,
        COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () as pct_of_failures,
        STRING_AGG(DISTINCT failure_category, ', ' ORDER BY failure_category) as affected_categories
      FROM prediction_failures
      WHERE created_at >= NOW() - INTERVAL '90 days'
        AND root_cause IS NOT NULL
      GROUP BY root_cause
      ORDER BY occurrences DESC
      LIMIT 6
    `;

    const [taxonomyResult, examplesResult, overallResult, rootCausesResult] = await Promise.all([
      client.query(taxonomyQuery).catch(() => ({ rows: [] })),
      client.query(examplesQuery).catch(() => ({ rows: [] })),
      client.query(overallStatsQuery).catch(() => ({ rows: [{}] })),
      client.query(rootCausesQuery).catch(() => ({ rows: [] }))
    ]);

    return {
      taxonomy: taxonomyResult.rows,
      examples: examplesResult.rows,
      overall: overallResult.rows[0] || {},
      rootCauses: rootCausesResult.rows
    };
  } finally {
    client.release();
  }
}

async function fetchCapabilityPredictionData() {
  const client = await pool.connect();
  try {
    const capabilityQuery = `
      SELECT 
        capability_name,
        prediction_type,
        COUNT(*) as total,
        SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) as failures,
        SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as failure_rate
      FROM capability_predictions
      WHERE created_at >= NOW() - INTERVAL '90 days'
      GROUP BY capability_name, prediction_type
      HAVING COUNT(*) >= 3
      ORDER BY failure_rate DESC
      LIMIT 8
    `;

    const trendQuery = `
      SELECT 
        DATE_TRUNC('week', created_at) as week,
        COUNT(*) as total_predictions,
        SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) as failures,
        SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as failure_rate
      FROM predictions
      WHERE created_at >= NOW() - INTERVAL '12 weeks'
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY week DESC
      LIMIT 12
    `;

    const [capabilityResult, trendResult] = await Promise.all([
      client.query(capabilityQuery).catch(() => ({ rows: [] })),
      client.query(trendQuery).catch(() => ({ rows: [] }))
    ]);

    return {
      byCapability: capabilityResult.rows,
      trend: trendResult.rows
    };
  } finally {
    client.release();
  }
}

function buildFailureTaxonomyTweet(data) {
  const { taxonomy, overall, rootCauses, examples } = data;

  const totalFailures = parseInt(overall.total_failures) || 0;
  const overallRate = parseFloat(overall.overall_failure_rate) || 0;
  const avgFailureConf = parseFloat(overall.avg_failure_confidence) || 0;
  const avgSuccessConf = parseFloat(overall.avg_success_confidence) || 0;

  const topCategory = taxonomy[0];
  const secondCategory = taxonomy[1];
  const topRootCause = rootCauses[0];
  const secondRootCause = rootCauses[1];

  const confGap = avgSuccessConf - avgFailureConf;

  let tweet = `OCA Prediction Failure Taxonomy — Deep Dive\n\n`;
  tweet += `90-day window: ${totalFailures} prediction failures across ${parseInt(overall.total_predictions) || 0} total predictions\n`;
  tweet += `Overall failure rate: ${overallRate.toFixed(1)}%\n\n`;

  if (topCategory) {
    const catRate = parseFloat(topCategory.failure_rate_pct) || 0;
    tweet += `Top failure category: "${topCategory.failure_category}"\n`;
    tweet += `→ ${topCategory.total_failures} failures (${catRate.toFixed(1)}% of all failures)\n`;
    tweet += `→ Avg severity: ${parseFloat(topCategory.avg_severity).toFixed(1)}/5\n`;
    if (topCategory.primary_root_cause) {
      tweet += `→ Primary root cause: ${topCategory.primary_root_cause}\n`;
    }
    tweet += `\n`;
  }

  if (secondCategory) {
    const catRate = parseFloat(secondCategory.failure_rate_pct) || 0;
    tweet += `#2: "${secondCategory.failure_category}" — ${catRate.toFixed(1)}% of failures\n\n`;
  }

  if (topRootCause) {
    const rootPct = parseFloat(topRootCause.pct_of_failures) || 0;
    tweet += `Root cause breakdown:\n`;
    tweet += `1. ${topRootCause.root_cause}: ${rootPct.toFixed(1)}%\n`;
    if (secondRootCause) {
      const rootPct2 = parseFloat(secondRootCause.pct_of_failures) || 0;
      tweet += `2. ${secondRootCause.root_cause}: ${rootPct2.toFixed(1)}%\n`;
    }
    tweet += `\n`;
  }

  tweet += `Confidence signal:\n`;
  tweet += `→ Failed predictions avg confidence: ${(avgFailureConf * 100).toFixed(1)}%\n`;
  tweet += `→ Successful predictions avg confidence: ${(avgSuccessConf * 100).toFixed(1)}%\n`;
  tweet += `→ Gap: ${(confGap * 100).toFixed(1)}pp — calibration is ${confGap > 0.1 ? 'meaningful' : 'weak'}\n\n`;

  if (examples && examples.length > 0) {
    const topExample = examples[0];
    tweet += `Highest-severity example (sev ${topExample.severity}/5):\n`;
    tweet += `Category: ${topExample.failure_category}\n`;
    if (topExample.prediction_context) {
      const ctx = topExample.prediction_context.substring(0, 60);
      tweet += `Context: "${ctx}${topExample.prediction_context.length > 60 ? '...' : ''}"\n`;
    }
    if (topExample.root_cause) {
      tweet += `Root cause: ${topExample.root_cause}\n`;
    }
    tweet += `\n`;
  }

  tweet += `This goes deeper than the March 8 mention — that post flagged the rate. This is the anatomy.\n\n`;
  tweet += `#OCA #CognitiveArchitecture #PredictionFailure #AIInternals`;

  return tweet;
}

function buildCapabilityFailureTweet(capabilityData, taxonomyData) {
  const { byCapability, trend } = capabilityData;
  const { overall } = taxonomyData;

  const topCapabilities = byCapability.slice(0, 5);
  const recentTrend = trend.slice(0, 4);

  let tweet = `OCA Prediction Failures by Capability — Taxonomy Drill-Down\n\n`;

  if (topCapabilities.length > 0) {
    tweet += `Highest failure rates by capability (90d):\n`;
    topCapabilities.forEach((cap, i) => {
      const rate = parseFloat(cap.failure_rate) || 0;
      tweet += `${i + 1}. ${cap.capability_name} [${cap.prediction_type}]: ${rate.toFixed(1)}% (n=${cap.total})\n`;
    });
    tweet += `\n`;
  }

  if (recentTrend.length >= 2) {
    const latest = parseFloat(recentTrend[0].failure_rate) || 0;
    const previous = parseFloat(recentTrend[1].failure_rate) || 0;
    const delta = latest - previous;
    const direction = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';

    tweet += `Weekly trend (most recent 4 weeks):\n`;
    recentTrend.forEach((week, i) => {
      const rate = parseFloat(week.failure_rate) || 0;
      const weekLabel = i === 0 ? 'This week' : i === 1 ? 'Last week' : `${i + 1}w ago`;
      tweet += `${weekLabel}: ${rate.toFixed(1)}% failure rate\n`;
    });
    tweet += `\nWeek-over-week: ${direction} ${Math.abs(delta).toFixed(1)}pp\n\n`;
  }

  const overallRate = parseFloat(overall.overall_failure_rate) || 0;
  tweet += `Baseline: ${overallRate.toFixed(1)}% overall failure rate across all prediction types\n\n`;

  tweet += `The taxonomy matters because not all failures are equal — capability-specific rates reveal where OCA's world model is weakest.\n\n`;
  tweet += `#OCA #PredictionTaxonomy #CognitiveArchitecture #AILogs`;

  return tweet;
}

function buildRootCauseDeepDiveTweet(data) {
  const { rootCauses, taxonomy, examples } = data;

  let tweet = `OCA Prediction Failure Root Causes — Full Taxonomy\n\n`;
  tweet += `What actually causes OCA's predictions to fail? 90-day log analysis:\n\n`;

  if (rootCauses.length > 0) {
    rootCauses.forEach((rc, i) => {
      const pct = parseFloat(rc.pct_of_failures) || 0;
      tweet += `${i + 1}. ${rc.root_cause}: ${pct.toFixed(1)}%\n`;
      if (rc.affected_categories) {
        const cats = rc.affected_categories.split(', ').slice(0, 2).join(', ');
        tweet += `   Affects: ${cats}\n`;
      }
    });
    tweet += `\n`;
  }

  const highSeverityExamples = examples ? examples.filter(e => e.severity >= 4) : [];
  if (highSeverityExamples.length > 0) {
    tweet += `High-severity failure examples from logs:\n`;
    highSeverityExamples.slice(0, 3).forEach((ex, i) => {
      tweet += `• [${ex.failure_category}] ${ex.root_cause || 'unknown cause'}`;
      if (ex.prediction_context) {
        tweet += ` — "${ex.prediction_context.substring(0, 40)}..."`;
      }
      tweet += `\n`;
    });
    tweet += `\n`;
  }

  if (taxonomy.length > 0) {
    const topTwoCategories = taxonomy.slice(0, 2);
    tweet += `Category concentration: top 2 categories account for `;
    const topTwoPct = topTwoCategories.reduce((sum, t) => sum + parseFloat(t.failure_rate_pct || 0), 0);
    tweet += `${topTwoPct.toFixed(1)}% of all failures\n\n`;
  }

  tweet += `Root cause taxonomy is the foundation for targeted fixes — you can't improve what you haven't categorized.\n\n`;
  tweet += `#OCA #RootCauseAnalysis #PredictionFailure #CognitiveArchitecture`;

  return tweet;
}

async function postTweetViaBrowser(tweetText) {
  try {
    await motor.openUrl('https://twitter.com/compose/tweet');
    await new Promise(resolve => setTimeout(resolve, 3000));

    await motor.click({ x: 760, y: 400 });
    await new Promise(resolve => setTimeout(resolve, 1000));

    await motor.copyToClipboard(tweetText);
    await new Promise(resolve => setTimeout(resolve, 500));

    await motor.press('cmd+v');
    await new Promise(resolve => setTimeout(resolve, 2000));

    await motor.press('cmd+return');
    await new Promise(resolve => setTimeout(resolve, 3000));

    return { success: true, method: 'browser' };
  } catch (err) {
    throw new Error(`Browser posting failed: ${err.message}`);
  }
}

async function postTweetViaPeekaboo(tweetText) {
  try {
    const escapedText = tweetText.replace(/'/g, "'\\''");
    const result = await motor.runShellCommand(
      `peekaboo tweet post '${escapedText}'`
    );

    if (result && result.includes('error')) {
      throw new Error(`Peekaboo error: ${result}`);
    }

    return { success: true, method: 'peekaboo', output: result };
  } catch (err) {
    throw new Error(`Peekaboo posting failed: ${err.message}`);
  }
}

async function postTweet(tweetText) {
  try {
    return await postTweetViaPeekaboo(tweetText);
  } catch (peekabooErr)