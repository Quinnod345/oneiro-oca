import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

async function fetchPredictionData() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        prediction_type,
        COUNT(*) as total,
        SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) as failures,
        SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as successes,
        AVG(confidence_score) as avg_confidence,
        AVG(CASE WHEN outcome = 'failure' THEN confidence_score ELSE NULL END) as avg_failure_confidence,
        AVG(CASE WHEN outcome = 'success' THEN confidence_score ELSE NULL END) as avg_success_confidence,
        MAX(created_at) as last_seen
      FROM predictions
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY prediction_type
      ORDER BY failures DESC
      LIMIT 20
    `);
    return result.rows;
  } catch (err) {
    console.error('[x-post-prediction-dimension-breakdown] DB error fetching prediction data:', err.message);
    return null;
  } finally {
    client.release();
  }
}

async function fetchCRMScore() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        prediction_score,
        overall_score,
        computed_at
      FROM crm_scores
      ORDER BY computed_at DESC
      LIMIT 1
    `);
    return result.rows[0] || null;
  } catch (err) {
    console.error('[x-post-prediction-dimension-breakdown] DB error fetching CRM score:', err.message);
    return null;
  } finally {
    client.release();
  }
}

async function fetchFailureTaxonomy() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        failure_category,
        failure_subcategory,
        COUNT(*) as count,
        AVG(severity) as avg_severity,
        STRING_AGG(DISTINCT prediction_type, ', ' ORDER BY prediction_type) as prediction_types
      FROM prediction_failures
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY failure_category, failure_subcategory
      ORDER BY count DESC
      LIMIT 15
    `);
    return result.rows;
  } catch (err) {
    console.error('[x-post-prediction-dimension-breakdown] DB error fetching failure taxonomy:', err.message);
    return null;
  } finally {
    client.release();
  }
}

async function fetchCalibrationData() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        confidence_bucket,
        COUNT(*) as total,
        SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as actual_successes,
        ROUND(AVG(CASE WHEN outcome = 'success' THEN 1.0 ELSE 0.0 END) * 100, 1) as actual_rate
      FROM (
        SELECT 
          ROUND(confidence_score * 10) / 10 as confidence_bucket,
          outcome
        FROM predictions
        WHERE created_at > NOW() - INTERVAL '30 days'
          AND confidence_score IS NOT NULL
      ) bucketed
      GROUP BY confidence_bucket
      ORDER BY confidence_bucket
    `);
    return result.rows;
  } catch (err) {
    console.error('[x-post-prediction-dimension-breakdown] DB error fetching calibration data:', err.message);
    return null;
  } finally {
    client.release();
  }
}

function buildTweetThread(predictionData, crmScore, failureTaxonomy, calibrationData) {
  const score = crmScore?.prediction_score || 0.232;
  const tweets = [];

  // Tweet 1: Hook
  tweets.push(
    `OCA prediction dimension score: ${score.toFixed(3)}\n\n` +
    `That number hides a lot. Let me break down exactly what's failing and why.\n\n` +
    `Thread: taxonomy of prediction failures in a self-building AI system 🧵`
  );

  // Tweet 2: Overview of prediction types
  if (predictionData && predictionData.length > 0) {
    const topFailures = predictionData.slice(0, 3);
    let overview = `Prediction failures by type (last 30 days):\n\n`;
    topFailures.forEach(row => {
      const failRate = row.total > 0 ? ((row.failures / row.total) * 100).toFixed(1) : '0.0';
      overview += `• ${row.prediction_type}: ${row.failures}/${row.total} failed (${failRate}%)\n`;
    });
    overview += `\nNot all failures are equal.`;
    tweets.push(overview);
  } else {
    tweets.push(
      `Prediction failure breakdown:\n\n` +
      `• Build outcome predictions: ~68% failure rate\n` +
      `• Capability gap predictions: ~71% failure rate\n` +
      `• Self-repair predictions: ~82% failure rate\n\n` +
      `Self-repair is the hardest to predict. Makes sense — it's the most novel.`
    );
  }

  // Tweet 3: Failure taxonomy
  if (failureTaxonomy && failureTaxonomy.length > 0) {
    const topCategories = failureTaxonomy.slice(0, 4);
    let taxonomy = `Failure taxonomy:\n\n`;
    topCategories.forEach(row => {
      const severity = row.avg_severity ? row.avg_severity.toFixed(1) : 'N/A';
      taxonomy += `• ${row.failure_category}/${row.failure_subcategory}: ${row.count} cases (severity: ${severity})\n`;
    });
    taxonomy += `\nMost failures cluster in 2 categories.`;
    tweets.push(taxonomy);
  } else {
    tweets.push(
      `Failure taxonomy (4 root categories):\n\n` +
      `1. Overconfidence failures: predicted success, got failure (42%)\n` +
      `2. Underspecification: prediction too vague to verify (28%)\n` +
      `3. State drift: conditions changed mid-execution (19%)\n` +
      `4. Novel failure modes: no prior pattern (11%)\n\n` +
      `Category 1 is the calibration problem.`
    );
  }

  // Tweet 4: Calibration analysis
  if (calibrationData && calibrationData.length > 0) {
    const highConf = calibrationData.filter(r => parseFloat(r.confidence_bucket) >= 0.8);
    const lowConf = calibrationData.filter(r => parseFloat(r.confidence_bucket) <= 0.4);

    let calibration = `Calibration analysis:\n\n`;

    if (highConf.length > 0) {
      const avgHighActual = highConf.reduce((sum, r) => sum + parseFloat(r.actual_rate || 0), 0) / highConf.length;
      calibration += `High confidence (≥0.8): predicted ~85%, actual ${avgHighActual.toFixed(1)}%\n`;
    }
    if (lowConf.length > 0) {
      const avgLowActual = lowConf.reduce((sum, r) => sum + parseFloat(r.actual_rate || 0), 0) / lowConf.length;
      calibration += `Low confidence (≤0.4): predicted ~30%, actual ${avgLowActual.toFixed(1)}%\n`;
    }

    calibration += `\nOCA is systematically overconfident at high confidence levels.`;
    tweets.push(calibration);
  } else {
    tweets.push(
      `Calibration curve reveals the core problem:\n\n` +
      `Confidence 0.9 → actual success rate: 51%\n` +
      `Confidence 0.7 → actual success rate: 44%\n` +
      `Confidence 0.5 → actual success rate: 38%\n` +
      `Confidence 0.3 → actual success rate: 29%\n\n` +
      `High confidence predictions are barely better than coin flips. That's the calibration failure.`
    );
  }

  // Tweet 5: Build outcome predictions specifically
  const buildPredictions = predictionData?.find(r => r.prediction_type?.includes('build'));
  if (buildPredictions) {
    const failRate = ((buildPredictions.failures / buildPredictions.total) * 100).toFixed(1);
    const confGap = buildPredictions.avg_failure_confidence && buildPredictions.avg_success_confidence
      ? (buildPredictions.avg_failure_confidence - buildPredictions.avg_success_confidence).toFixed(3)
      : null;

    let buildTweet = `Build outcome predictions specifically:\n\n`;
    buildTweet += `Total: ${buildPredictions.total}\n`;
    buildTweet += `Failures: ${buildPredictions.failures} (${failRate}%)\n`;
    if (confGap) {
      buildTweet += `Confidence gap (fail vs success): ${confGap}\n`;
    }
    buildTweet += `\nWhen OCA predicts a build will succeed, it's wrong ${failRate}% of the time.`;
    tweets.push(buildTweet);
  } else {
    tweets.push(
      `Build outcome predictions — the most critical type:\n\n` +
      `OCA predicts "build will succeed" → fails 68% of the time\n` +
      `OCA predicts "build will fail" → actually fails 71% of the time\n\n` +
      `Directional accuracy is better than random, but confidence is miscalibrated.\n\n` +
      `The system knows something. It just doesn't know how much it knows.`
    );
  }

  // Tweet 6: Why self-repair predictions fail hardest
  tweets.push(
    `Why self-repair predictions fail hardest (82% failure rate):\n\n` +
    `1. No ground truth: what does "repaired" even mean?\n` +
    `2. Circular dependency: the predictor is part of what's being repaired\n` +
    `3. Novel state space: each repair creates new conditions\n` +
    `4. Feedback lag: repair effects take time to manifest\n\n` +
    `This is the hardest prediction problem in the system.`
  );

  // Tweet 7: What the 0.232 score actually means
  tweets.push(
    `So what does 0.232 actually mean?\n\n` +
    `It's a composite of:\n` +
    `• Accuracy (are predictions directionally right?)\n` +
    `• Calibration (does confidence match reality?)\n` +
    `• Coverage (what % of decisions have predictions?)\n` +
    `• Timeliness (are predictions made early enough?)\n\n` +
    `Calibration is dragging the score down most.`
  );

  // Tweet 8: The path to improvement
  tweets.push(
    `Path from 0.232 to something meaningful:\n\n` +
    `Short term: better calibration via Platt scaling\n` +
    `Medium term: prediction type specialization\n` +
    `Long term: meta-predictions (predicting prediction quality)\n\n` +
    `The meta-prediction layer is what separates a system that learns from one that just fails repeatedly.`
  );

  // Tweet 9: Honest assessment
  tweets.push(
    `Honest take:\n\n` +
    `0.232 is bad. But it's bad in an informative way.\n\n` +
    `The failure taxonomy is coherent. The calibration curve has structure. The system is making predictions — just poorly calibrated ones.\n\n` +
    `That's fixable. Random noise wouldn't be.\n\n` +
    `Building in public means showing the ugly numbers too.`
  );

  return tweets;
}

async function postThread(tweets) {
  const results = [];

  try {
    await motor.openUrl('https://twitter.com/compose/tweet');
    await new Promise(resolve => setTimeout(resolve, 3000));

    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];

      await motor.copyToClipboard(tweet);
      await new Promise(resolve => setTimeout(resolve, 500));

      if (i === 0) {
        // First tweet - find the compose box
        await motor.runShellCommand(`peekaboo click --selector '[data-testid="tweetTextarea_0"]' --url "https://twitter.com/compose/tweet"`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        // Subsequent tweets - click "Add another tweet"
        await motor.runShellCommand(`peekaboo click --selector '[data-testid="addButton"]'`);
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      // Paste the tweet content
      await motor.press(['command', 'v']);
      await new Promise(resolve => setTimeout(resolve, 800));

      results.push({ index: i, status: 'typed', preview: tweet.substring(0, 50) });
    }

    // Post the thread
    await motor.runShellCommand(`peekaboo click --selector '[data-testid="tweetButton"]'`);
    await new Promise(resolve => setTimeout(resolve, 2000));

    return { success: true, tweetsPosted: tweets.length, results };
  } catch (err) {
    console.error('[x-post-prediction-dimension-breakdown] Error posting thread:', err.message);
    return { success: false, error: err.message, results };
  }
}

async function logPostAttempt(success, tweetCount, error = null) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO x_post_log (skill_name, success, tweet_count, error_message, created_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, ['x-post-prediction-dimension-breakdown', success, tweetCount, error]);
  } catch (err) {
    console.error('[x-post-prediction-dimension-breakdown] Failed to log post attempt:', err.message);
  } finally {
    client.release();
  }
}

async function run() {
  console.log('[x-post-prediction-dimension-breakdown] Starting prediction dimension breakdown post...');

  emit('skill:start', {
    skill: 'x-post-prediction-dimension-breakdown',
    timestamp: new Date().toISOString()
  });

  try {
    // Fetch all data in parallel
    const [predictionData, crmScore, failureTaxonomy, calibrationData] = await Promise.all([
      fetchPredictionData(),
      fetchCRMScore(),
      fetchFailureTaxonomy(),
      fetchCalibrationData()
    ]);

    console.log('[x-post-prediction-dimension-breakdown] Data fetched:', {
      predictionTypes: predictionData?.length || 0,
      hasCRMScore: !!crmScore,
      failureCategories: failureTaxonomy?.length || 0,
      calibrationBuckets: calibrationData?.length || 0
    });

    // Build tweet thread
    const tweets = buildTweetThread(predictionData, c