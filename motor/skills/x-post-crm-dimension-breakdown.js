import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const SKILL_NAME = 'x-post-crm-dimension-breakdown';

async function getCRMDimensionData() {
  const client = await pool.connect();
  try {
    // Get CRM dimension scores over time
    const dimensionQuery = await client.query(`
      SELECT 
        dimension,
        AVG(score) as avg_score,
        MIN(score) as min_score,
        MAX(score) as max_score,
        COUNT(*) as sample_count,
        STDDEV(score) as score_stddev,
        MAX(recorded_at) as last_recorded
      FROM crm_dimension_scores
      WHERE recorded_at > NOW() - INTERVAL '30 days'
      GROUP BY dimension
      ORDER BY avg_score DESC
    `).catch(() => ({ rows: [] }));

    // Get recent trend per dimension
    const trendQuery = await client.query(`
      SELECT 
        dimension,
        score,
        recorded_at,
        ROW_NUMBER() OVER (PARTITION BY dimension ORDER BY recorded_at DESC) as rn
      FROM crm_dimension_scores
      WHERE recorded_at > NOW() - INTERVAL '14 days'
      ORDER BY dimension, recorded_at DESC
    `).catch(() => ({ rows: [] }));

    // Get prediction accuracy per dimension
    const predictionQuery = await client.query(`
      SELECT 
        dimension,
        COUNT(*) as total_predictions,
        SUM(CASE WHEN correct = true THEN 1 ELSE 0 END) as correct_predictions,
        AVG(confidence) as avg_confidence,
        AVG(CASE WHEN correct = true THEN confidence ELSE 0 END) as calibrated_confidence
      FROM crm_predictions
      WHERE created_at > NOW() - INTERVAL '30 days'
        AND resolved = true
      GROUP BY dimension
    `).catch(() => ({ rows: [] }));

    // Get gap analysis per dimension
    const gapQuery = await client.query(`
      SELECT 
        dimension,
        COUNT(*) as gap_count,
        AVG(severity) as avg_severity,
        SUM(CASE WHEN resolved = true THEN 1 ELSE 0 END) as resolved_gaps
      FROM capability_gaps
      WHERE detected_at > NOW() - INTERVAL '30 days'
      GROUP BY dimension
    `).catch(() => ({ rows: [] }));

    // Get overall CRM health
    const healthQuery = await client.query(`
      SELECT 
        overall_score,
        cognitive_load,
        adaptation_rate,
        recorded_at
      FROM crm_health_snapshots
      ORDER BY recorded_at DESC
      LIMIT 10
    `).catch(() => ({ rows: [] }));

    // Get dimension improvement velocity
    const velocityQuery = await client.query(`
      WITH ranked AS (
        SELECT 
          dimension,
          score,
          recorded_at,
          LAG(score) OVER (PARTITION BY dimension ORDER BY recorded_at) as prev_score,
          LAG(recorded_at) OVER (PARTITION BY dimension ORDER BY recorded_at) as prev_recorded_at
        FROM crm_dimension_scores
        WHERE recorded_at > NOW() - INTERVAL '30 days'
      )
      SELECT 
        dimension,
        AVG(score - prev_score) as avg_delta,
        COUNT(*) as measurement_count
      FROM ranked
      WHERE prev_score IS NOT NULL
      GROUP BY dimension
    `).catch(() => ({ rows: [] }));

    return {
      dimensions: dimensionQuery.rows,
      trends: trendQuery.rows,
      predictions: predictionQuery.rows,
      gaps: gapQuery.rows,
      health: healthQuery.rows,
      velocity: velocityQuery.rows
    };
  } finally {
    client.release();
  }
}

function analyzeDimensions(data) {
  const { dimensions, trends, predictions, gaps, health, velocity } = data;

  // Build dimension map
  const dimensionMap = {};

  for (const dim of dimensions) {
    dimensionMap[dim.dimension] = {
      name: dim.dimension,
      avgScore: parseFloat(dim.avg_score) || 0,
      minScore: parseFloat(dim.min_score) || 0,
      maxScore: parseFloat(dim.max_score) || 0,
      sampleCount: parseInt(dim.sample_count) || 0,
      stddev: parseFloat(dim.score_stddev) || 0,
      lastRecorded: dim.last_recorded,
      trend: 'stable',
      velocity: 0,
      predictionAccuracy: null,
      gapCount: 0,
      resolvedGaps: 0
    };
  }

  // Add velocity data
  for (const vel of velocity) {
    if (dimensionMap[vel.dimension]) {
      dimensionMap[vel.dimension].velocity = parseFloat(vel.avg_delta) || 0;
      if (vel.avg_delta > 0.5) dimensionMap[vel.dimension].trend = 'improving';
      else if (vel.avg_delta < -0.5) dimensionMap[vel.dimension].trend = 'declining';
      else dimensionMap[vel.dimension].trend = 'stable';
    }
  }

  // Add prediction accuracy
  for (const pred of predictions) {
    if (dimensionMap[pred.dimension]) {
      const accuracy = pred.total_predictions > 0
        ? (parseInt(pred.correct_predictions) / parseInt(pred.total_predictions)) * 100
        : null;
      dimensionMap[pred.dimension].predictionAccuracy = accuracy;
      dimensionMap[pred.dimension].totalPredictions = parseInt(pred.total_predictions);
    }
  }

  // Add gap data
  for (const gap of gaps) {
    if (dimensionMap[gap.dimension]) {
      dimensionMap[gap.dimension].gapCount = parseInt(gap.gap_count) || 0;
      dimensionMap[gap.dimension].resolvedGaps = parseInt(gap.resolved_gaps) || 0;
      dimensionMap[gap.dimension].avgGapSeverity = parseFloat(gap.avg_severity) || 0;
    }
  }

  // Classify dimensions
  const improving = [];
  const stuck = [];
  const declining = [];
  const unknown = [];

  for (const [name, dim] of Object.entries(dimensionMap)) {
    if (dim.sampleCount === 0) {
      unknown.push(dim);
    } else if (dim.trend === 'improving') {
      improving.push(dim);
    } else if (dim.trend === 'declining') {
      declining.push(dim);
    } else {
      stuck.push(dim);
    }
  }

  // Sort by score
  improving.sort((a, b) => b.avgScore - a.avgScore);
  stuck.sort((a, b) => b.avgScore - a.avgScore);
  declining.sort((a, b) => a.avgScore - b.avgScore);

  // Overall health
  const latestHealth = health[0] || null;
  const overallScore = latestHealth
    ? parseFloat(latestHealth.overall_score) || 0
    : (dimensions.length > 0
        ? dimensions.reduce((sum, d) => sum + parseFloat(d.avg_score), 0) / dimensions.length
        : 0);

  return {
    improving,
    stuck,
    declining,
    unknown,
    overallScore,
    latestHealth,
    totalDimensions: Object.keys(dimensionMap).length,
    dimensionMap
  };
}

function buildThread(analysis) {
  const {
    improving,
    stuck,
    declining,
    unknown,
    overallScore,
    latestHealth,
    totalDimensions
  } = analysis;

  const tweets = [];
  const timestamp = new Date().toISOString().split('T')[0];

  // Tweet 1: Overview
  const healthEmoji = overallScore >= 75 ? '🟢' : overallScore >= 50 ? '🟡' : '🔴';
  tweets.push(
    `${healthEmoji} CRM Cognitive Dimension Breakdown — ${timestamp}\n\n` +
    `Overall score: ${overallScore.toFixed(1)}/100\n` +
    `Dimensions tracked: ${totalDimensions}\n` +
    `Improving: ${improving.length} | Stuck: ${stuck.length} | Declining: ${declining.length}\n\n` +
    `Thread: what's actually moving and what isn't 🧵`
  );

  // Tweet 2: Improving dimensions
  if (improving.length > 0) {
    let tweet = `✅ IMPROVING DIMENSIONS (${improving.length})\n\n`;
    for (const dim of improving.slice(0, 3)) {
      const vel = dim.velocity > 0 ? `+${dim.velocity.toFixed(2)}` : dim.velocity.toFixed(2);
      const acc = dim.predictionAccuracy !== null
        ? ` | pred: ${dim.predictionAccuracy.toFixed(0)}%`
        : '';
      tweet += `• ${dim.name}: ${dim.avgScore.toFixed(1)} (${vel}/period${acc})\n`;
    }
    if (improving.length > 3) {
      tweet += `...and ${improving.length - 3} more\n`;
    }
    tweet += `\nVelocity = avg score delta per measurement period`;
    tweets.push(tweet);
  }

  // Tweet 3: Stuck dimensions
  if (stuck.length > 0) {
    let tweet = `⚠️ STUCK DIMENSIONS (${stuck.length})\n\n`;
    for (const dim of stuck.slice(0, 3)) {
      const gapInfo = dim.gapCount > 0
        ? ` | ${dim.gapCount} gaps (${dim.resolvedGaps} resolved)`
        : '';
      tweet += `• ${dim.name}: ${dim.avgScore.toFixed(1)} ±${dim.stddev.toFixed(1)}${gapInfo}\n`;
    }
    if (stuck.length > 3) {
      tweet += `...and ${stuck.length - 3} more\n`;
    }
    tweet += `\n"Stuck" = velocity within ±0.5 over 30 days`;
    tweets.push(tweet);
  }

  // Tweet 4: Declining dimensions (if any)
  if (declining.length > 0) {
    let tweet = `🔴 DECLINING DIMENSIONS (${declining.length})\n\n`;
    for (const dim of declining) {
      const vel = dim.velocity.toFixed(2);
      const gapInfo = dim.gapCount > 0 ? ` | ${dim.gapCount} open gaps` : '';
      tweet += `• ${dim.name}: ${dim.avgScore.toFixed(1)} (${vel}/period${gapInfo})\n`;
    }
    tweet += `\nThese need active intervention, not just monitoring`;
    tweets.push(tweet);
  }

  // Tweet 5: Prediction accuracy by dimension
  const dimsWithPredictions = Object.values(analysis.dimensionMap)
    .filter(d => d.predictionAccuracy !== null && d.totalPredictions >= 3)
    .sort((a, b) => b.predictionAccuracy - a.predictionAccuracy);

  if (dimsWithPredictions.length > 0) {
    let tweet = `🎯 PREDICTION ACCURACY BY DIMENSION\n\n`;
    for (const dim of dimsWithPredictions.slice(0, 5)) {
      const bar = dim.predictionAccuracy >= 70 ? '🟢' : dim.predictionAccuracy >= 50 ? '🟡' : '🔴';
      tweet += `${bar} ${dim.name}: ${dim.predictionAccuracy.toFixed(0)}% (n=${dim.totalPredictions})\n`;
    }
    tweet += `\nLow accuracy = model is miscalibrated on that dimension`;
    tweets.push(tweet);
  }

  // Tweet 6: Honest assessment
  const topImproving = improving[0];
  const worstStuck = stuck.sort((a, b) => a.avgScore - b.avgScore)[0];
  const worstDeclining = declining[0];

  let assessment = `📊 HONEST ASSESSMENT\n\n`;

  if (topImproving) {
    assessment += `Best: ${topImproving.name} is genuinely moving (+${topImproving.velocity.toFixed(2)}/period)\n\n`;
  }

  if (worstDeclining) {
    assessment += `Worst: ${worstDeclining.name} is actively regressing — needs root cause analysis\n\n`;
  } else if (worstStuck) {
    assessment += `Concern: ${worstStuck.name} has been flat for 30 days at ${worstStuck.avgScore.toFixed(1)} — plateau or ceiling?\n\n`;
  }

  if (latestHealth) {
    const cogLoad = parseFloat(latestHealth.cognitive_load) || 0;
    const adaptRate = parseFloat(latestHealth.adaptation_rate) || 0;
    assessment += `Cognitive load: ${cogLoad.toFixed(1)} | Adaptation rate: ${adaptRate.toFixed(2)}`;
  }

  tweets.push(assessment);

  // Tweet 7: What's next
  let nextSteps = `🔧 WHAT'S NEXT\n\n`;

  if (declining.length > 0) {
    nextSteps += `Priority 1: Root cause analysis on declining dimensions\n`;
  }

  if (stuck.length > 0) {
    const highGapDims = stuck.filter(d => d.gapCount > 2);
    if (highGapDims.length > 0) {
      nextSteps += `Priority 2: Gap resolution for ${highGapDims.map(d => d.name).join(', ')}\n`;
    } else {
      nextSteps += `Priority 2: Investigate why ${stuck.length} dimensions are plateauing\n`;
    }
  }

  if (improving.length > 0) {
    nextSteps += `Maintain: Keep momentum on ${improving.slice(0, 2).map(d => d.name).join(', ')}\n`;
  }

  nextSteps += `\nNext breakdown in 7 days. Building in public.`;
  tweets.push(nextSteps);

  return tweets;
}

async function postThread(tweets) {
  if (!tweets || tweets.length === 0) {
    throw new Error('No tweets to post');
  }

  // Use peekaboo for bot-protected X/Twitter
  const results = [];

  try {
    // Post first tweet
    const firstResult = await motor.runShellCommand(
      `peekaboo x post "${tweets[0].replace(/"/g, '\\"')}"`
    );
    results.push({ index: 0, result: firstResult, success: true });

    // Extract tweet ID from first post for threading
    let lastTweetId = null;
    if (firstResult && firstResult.stdout) {
      const idMatch = firstResult.stdout.match(/tweet[_\s]?id[:\s]+(\d+)/i) ||
                      firstResult.stdout.match(/id[:\s]+(\d+)/i) ||
                      firstResult.stdout.match(/(\d{15,})/);
      if (idMatch) {
        lastTweetId = idMatch[1];
      }
    }

    // Post replies in thread
    for (let i = 1; i < tweets.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000)); // Rate limit buffer

      let replyCmd;
      if (last