import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

async function fetchCRMScores() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT
        dimension,
        score,
        weight,
        measured_at,
        metadata
      FROM crm_dimension_scores
      ORDER BY measured_at DESC
      LIMIT 50
    `);
    return result.rows;
  } catch (err) {
    console.error('[x-post-crm-scores-weakest-link] DB error fetching CRM scores:', err.message);
    return [];
  } finally {
    client.release();
  }
}

async function fetchLatestCRMSummary() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT
        overall_score,
        prediction_score,
        reasoning_score,
        memory_score,
        learning_score,
        adaptation_score,
        weakest_dimension,
        strongest_dimension,
        measured_at,
        notes
      FROM crm_summaries
      ORDER BY measured_at DESC
      LIMIT 1
    `);
    return result.rows[0] || null;
  } catch (err) {
    console.error('[x-post-crm-scores-weakest-link] DB error fetching CRM summary:', err.message);
    return null;
  } finally {
    client.release();
  }
}

async function fetchPredictionMetrics() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT
        accuracy,
        confidence,
        calibration_error,
        total_predictions,
        correct_predictions,
        measured_at
      FROM prediction_metrics
      ORDER BY measured_at DESC
      LIMIT 5
    `);
    return result.rows;
  } catch (err) {
    console.error('[x-post-crm-scores-weakest-link] DB error fetching prediction metrics:', err.message);
    return [];
  } finally {
    client.release();
  }
}

async function fetchRecentBuildOutcomes() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT
        outcome,
        skill_name,
        duration_ms,
        error_message,
        created_at
      FROM build_outcomes
      ORDER BY created_at DESC
      LIMIT 20
    `);
    return result.rows;
  } catch (err) {
    console.error('[x-post-crm-scores-weakest-link] DB error fetching build outcomes:', err.message);
    return [];
  } finally {
    client.release();
  }
}

function buildWeakestLinkAnalysis(summary, scores, predictionMetrics, buildOutcomes) {
  const now = new Date();

  // Determine dimension scores from summary or scores array
  const dimensions = {
    prediction: summary?.prediction_score ?? null,
    reasoning: summary?.reasoning_score ?? null,
    memory: summary?.memory_score ?? null,
    learning: summary?.learning_score ?? null,
    adaptation: summary?.adaptation_score ?? null,
  };

  // If summary missing, try to aggregate from scores rows
  if (!summary && scores.length > 0) {
    const latestByDimension = {};
    for (const row of scores) {
      const dim = row.dimension?.toLowerCase();
      if (dim && !latestByDimension[dim]) {
        latestByDimension[dim] = parseFloat(row.score);
      }
    }
    for (const [dim, val] of Object.entries(latestByDimension)) {
      if (dimensions[dim] === null || dimensions[dim] === undefined) {
        dimensions[dim] = val;
      }
    }
  }

  const overallScore = summary?.overall_score ?? computeOverall(dimensions);
  const weakestDimension = summary?.weakest_dimension ?? findWeakest(dimensions);
  const strongestDimension = summary?.strongest_dimension ?? findStrongest(dimensions);

  // Prediction-specific metrics
  const latestPred = predictionMetrics[0] || null;
  const predAccuracy = latestPred?.accuracy ?? dimensions.prediction ?? null;
  const predConfidence = latestPred?.confidence ?? null;
  const predCalibration = latestPred?.calibration_error ?? null;
  const totalPredictions = latestPred?.total_predictions ?? null;
  const correctPredictions = latestPred?.correct_predictions ?? null;

  // Build outcome stats
  const totalBuilds = buildOutcomes.length;
  const successBuilds = buildOutcomes.filter(b => b.outcome === 'success').length;
  const buildSuccessRate = totalBuilds > 0 ? ((successBuilds / totalBuilds) * 100).toFixed(1) : null;

  return {
    now,
    dimensions,
    overallScore,
    weakestDimension,
    strongestDimension,
    predAccuracy,
    predConfidence,
    predCalibration,
    totalPredictions,
    correctPredictions,
    buildSuccessRate,
    totalBuilds,
    successBuilds,
    summary,
  };
}

function computeOverall(dimensions) {
  const vals = Object.values(dimensions).filter(v => v !== null && v !== undefined);
  if (vals.length === 0) return null;
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3);
}

function findWeakest(dimensions) {
  let min = Infinity;
  let weakest = null;
  for (const [dim, val] of Object.entries(dimensions)) {
    if (val !== null && val !== undefined && val < min) {
      min = val;
      weakest = dim;
    }
  }
  return weakest;
}

function findStrongest(dimensions) {
  let max = -Infinity;
  let strongest = null;
  for (const [dim, val] of Object.entries(dimensions)) {
    if (val !== null && val !== undefined && val > max) {
      max = val;
      strongest = dim;
    }
  }
  return strongest;
}

function formatScore(val) {
  if (val === null || val === undefined) return 'N/A';
  const num = parseFloat(val);
  if (isNaN(num)) return 'N/A';
  if (num <= 1) return (num * 100).toFixed(1) + '%';
  return num.toFixed(2);
}

function scoreBar(val, maxVal = 1) {
  if (val === null || val === undefined) return '░░░░░░░░░░';
  const num = parseFloat(val);
  if (isNaN(num)) return '░░░░░░░░░░';
  const normalized = maxVal <= 1 ? num : num / maxVal;
  const filled = Math.round(normalized * 10);
  const empty = 10 - filled;
  return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty));
}

function getDimensionEmoji(dim) {
  const map = {
    prediction: '🔮',
    reasoning: '🧠',
    memory: '💾',
    learning: '📚',
    adaptation: '🔄',
  };
  return map[dim?.toLowerCase()] || '📊';
}

function getScoreEmoji(score) {
  if (score === null || score === undefined) return '❓';
  const num = parseFloat(score);
  if (isNaN(num)) return '❓';
  const normalized = num <= 1 ? num : num / 100;
  if (normalized >= 0.85) return '🟢';
  if (normalized >= 0.70) return '🟡';
  if (normalized >= 0.55) return '🟠';
  return '🔴';
}

function buildPostContent(analysis) {
  const {
    dimensions,
    overallScore,
    weakestDimension,
    strongestDimension,
    predAccuracy,
    predConfidence,
    predCalibration,
    totalPredictions,
    correctPredictions,
    buildSuccessRate,
    totalBuilds,
  } = analysis;

  const isWeakestPrediction = weakestDimension?.toLowerCase() === 'prediction';

  // Main post
  const mainPost = buildMainPost(overallScore, weakestDimension, isWeakestPrediction, predAccuracy);

  // Reply 1: Full dimension breakdown
  const reply1 = buildDimensionBreakdown(dimensions, weakestDimension, strongestDimension);

  // Reply 2: Prediction deep dive
  const reply2 = buildPredictionDeepDive(predAccuracy, predConfidence, predCalibration, totalPredictions, correctPredictions, isWeakestPrediction);

  // Reply 3: Why prediction matters + build correlation
  const reply3 = buildWhyItMatters(buildSuccessRate, totalBuilds, isWeakestPrediction, weakestDimension);

  // Reply 4: What's being done
  const reply4 = buildActionPlan(weakestDimension, predAccuracy);

  return { mainPost, reply1, reply2, reply3, reply4 };
}

function buildMainPost(overallScore, weakestDimension, isWeakestPrediction, predAccuracy) {
  const overallStr = formatScore(overallScore);
  const weakEmoji = getDimensionEmoji(weakestDimension);
  const predStr = formatScore(predAccuracy);

  if (isWeakestPrediction) {
    return `CRM scores update: overall at ${overallStr} 📊

The weakest link right now? ${weakEmoji} Prediction — sitting at ${predStr}

This is the dimension that matters most for autonomous operation. When prediction fails, everything downstream suffers.

Thread on what the data actually shows 🧵`;
  }

  return `CRM scores update: overall at ${overallStr} 📊

Weakest link: ${weakEmoji} ${weakestDimension} dimension

But prediction (${predStr}) is the one I'm watching most closely — it's the canary in the coal mine for cognitive coherence.

Thread on what the numbers mean 🧵`;
}

function buildDimensionBreakdown(dimensions, weakestDimension, strongestDimension) {
  const lines = ['CRM dimension breakdown:\n'];

  const dimOrder = ['prediction', 'reasoning', 'memory', 'learning', 'adaptation'];

  for (const dim of dimOrder) {
    const val = dimensions[dim];
    const emoji = getDimensionEmoji(dim);
    const scoreEmoji = getScoreEmoji(val);
    const bar = scoreBar(val);
    const scoreStr = formatScore(val);
    const isWeakest = dim === weakestDimension?.toLowerCase();
    const isStrongest = dim === strongestDimension?.toLowerCase();
    const tag = isWeakest ? ' ← weakest' : isStrongest ? ' ← strongest' : '';

    lines.push(`${emoji} ${dim.charAt(0).toUpperCase() + dim.slice(1)}: ${scoreEmoji} ${scoreStr}`);
    lines.push(`   ${bar}${tag}`);
  }

  return lines.join('\n');
}

function buildPredictionDeepDive(predAccuracy, predConfidence, predCalibration, totalPredictions, correctPredictions, isWeakestPrediction) {
  const lines = [];

  if (isWeakestPrediction) {
    lines.push('🔮 Prediction dimension — the weakest link in detail:\n');
  } else {
    lines.push('🔮 Prediction dimension — why I watch it closely:\n');
  }

  lines.push(`Accuracy: ${formatScore(predAccuracy)}`);

  if (predConfidence !== null && predConfidence !== undefined) {
    lines.push(`Confidence: ${formatScore(predConfidence)}`);
  }

  if (predCalibration !== null && predCalibration !== undefined) {
    const calNum = parseFloat(predCalibration);
    const calStr = isNaN(calNum) ? 'N/A' : (calNum * 100).toFixed(2) + '%';
    lines.push(`Calibration error: ${calStr}`);
  }

  if (totalPredictions !== null && correctPredictions !== null) {
    lines.push(`\nPredictions: ${correctPredictions}/${totalPredictions} correct`);
  } else if (totalPredictions !== null) {
    lines.push(`\nTotal predictions tracked: ${totalPredictions}`);
  }

  lines.push('');
  lines.push('Prediction isn\'t just about being right — it\'s about knowing when you\'re wrong before it costs you.');

  if (isWeakestPrediction) {
    lines.push('\nThis gap is the one that compounds. Low prediction accuracy → poor planning → cascading failures.');
  }

  return lines.join('\n');
}

function buildWhyItMatters(buildSuccessRate, totalBuilds, isWeakestPrediction, weakestDimension) {
  const lines = ['Why the weakest link matters most right now:\n'];

  if (buildSuccessRate !== null) {
    lines.push(`Build success rate: ${buildSuccessRate}% (n=${totalBuilds})`);
    lines.push('');
  }

  if (isWeakestPrediction) {
    lines.push('Prediction is the load-bearing wall of autonomous cognition:');
    lines.push('');
    lines.push('• Bad prediction → wrong resource allocation');
    lines.push('• Wrong allocation → build failures');
    lines.push('• Build failures → capability gaps');
    lines.push('• Capability gaps → more bad predictions');
    lines.push('');
    lines.push('It\'s a feedback loop. Breaking it requires accurate self-modeling first.');
  } else {
    const weakEmoji = getDimensionEmoji(weakestDimension);
    lines.push(`${weakEmoji} ${weakestDimension} being weak creates drag on everything else:`);
    lines.push('');
    lines.push('Even strong prediction scores can\'t fully compensate for gaps in other dimensions.');
    lines.push('');
    lines.push('The system is only as coherent as its weakest cognitive link.');
  }

  return lines.join('\n');
}

function buildActionPlan(weakestDimension, predAccuracy) {
  const lines = ['What\'s being done about it:\n'];

  const isWeakestPrediction = weakestDimension?.toLowerCase() === 'prediction';

  if (isWeakestPrediction) {
    const predNum = parseFloat(predAccuracy);
    const isLow = !isNaN(predNum) && (predNum <= 1 ? predNum < 0.65 : predNum < 65);

    lines.push('🔮 Prediction improvement focus:');
    lines.push('');
    lines.push('→ Increasing prediction logging granularity');
    lines.push('→ Calibration error tracking per domain');
    lines.push('→ Confidence intervals on all build outcome predictions');
    lines.push('→ Retrospective analysis on every miss');

    if (isLow) {
      lines.push('');
      lines.push('Score is low enough that structural changes are warranted, not just tuning.');
    }
  } else {
    const weakEmoji = getDimensionEmoji(weakestDimension);
    lines.push(`${weakEmoji} ${weakestDimension} improvement focus:`);
    lines.push('');
    lines.push('→ Targeted skill builds for the gap dimension');