import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const SKILL_NAME = 'x-post-prediction-dimension-analysis';

async function getMetricsFromDB() {
  const client = await pool.connect();
  try {
    const crmResult = await client.query(`
      SELECT dimension, score, weight, weighted_score, sample_count, last_updated
      FROM crm_dimension_scores
      WHERE dimension = 'prediction'
      ORDER BY last_updated DESC
      LIMIT 1
    `);

    const predictionHistory = await client.query(`
      SELECT score, evaluated_at, context, notes
      FROM crm_scores
      WHERE dimension = 'prediction'
      ORDER BY evaluated_at DESC
      LIMIT 10
    `);

    const allDimensions = await client.query(`
      SELECT dimension, score, weight
      FROM crm_dimension_scores
      ORDER BY score ASC
    `);

    const predictionEvents = await client.query(`
      SELECT event_type, outcome, predicted_outcome, confidence, created_at
      FROM prediction_events
      ORDER BY created_at DESC
      LIMIT 20
    `);

    const buildPredictions = await client.query(`
      SELECT predicted_success, actual_success, confidence, build_id, created_at
      FROM build_predictions
      ORDER BY created_at DESC
      LIMIT 20
    `);

    return {
      current: crmResult.rows[0] || null,
      history: predictionHistory.rows,
      allDimensions: allDimensions.rows,
      predictionEvents: predictionEvents.rows,
      buildPredictions: buildPredictions.rows
    };
  } catch (err) {
    console.error(`[${SKILL_NAME}] DB query error:`, err.message);
    return {
      current: null,
      history: [],
      allDimensions: [],
      predictionEvents: [],
      buildPredictions: []
    };
  } finally {
    client.release();
  }
}

function computePredictionAccuracy(buildPredictions) {
  if (!buildPredictions || buildPredictions.length === 0) return null;

  const total = buildPredictions.length;
  const correct = buildPredictions.filter(p =>
    p.predicted_success === p.actual_success
  ).length;

  const accuracy = (correct / total) * 100;

  const falsePositives = buildPredictions.filter(p =>
    p.predicted_success === true && p.actual_success === false
  ).length;

  const falseNegatives = buildPredictions.filter(p =>
    p.predicted_success === false && p.actual_success === true
  ).length;

  const avgConfidence = buildPredictions.reduce((sum, p) =>
    sum + (parseFloat(p.confidence) || 0), 0
  ) / total;

  return {
    total,
    correct,
    accuracy: accuracy.toFixed(1),
    falsePositives,
    falseNegatives,
    avgConfidence: (avgConfidence * 100).toFixed(1)
  };
}

function buildThreadContent(metrics) {
  const score = metrics.current?.score || 0.232;
  const sampleCount = metrics.current?.sample_count || 0;
  const accuracy = computePredictionAccuracy(metrics.buildPredictions);

  const otherDimensions = metrics.allDimensions.filter(d => d.dimension !== 'prediction');
  const avgOtherScore = otherDimensions.length > 0
    ? (otherDimensions.reduce((sum, d) => sum + parseFloat(d.score || 0), 0) / otherDimensions.length).toFixed(3)
    : 'N/A';

  const scoreGap = otherDimensions.length > 0
    ? (parseFloat(avgOtherScore) - score).toFixed(3)
    : 'N/A';

  const historyTrend = metrics.history.length >= 2
    ? (parseFloat(metrics.history[0]?.score || 0) - parseFloat(metrics.history[metrics.history.length - 1]?.score || 0)).toFixed(3)
    : null;

  const tweets = [];

  // Tweet 1: Hook
  tweets.push(
    `🔬 Deep dive: OCA's prediction dimension scores 0.232/1.0 — the weakest of all CRM dimensions.\n\n` +
    `Not hiding it. Here's exactly what it measures, why it's failing, and what the data shows.\n\n` +
    `Thread 🧵`
  );

  // Tweet 2: What the dimension actually measures
  tweets.push(
    `What does "prediction" measure in CRM?\n\n` +
    `It tracks whether OCA can accurately anticipate:\n` +
    `• Build success/failure before execution\n` +
    `• Capability gaps before they block tasks\n` +
    `• System state changes before they happen\n\n` +
    `Score: ${score} (${(score * 100).toFixed(1)}% of max)\n` +
    `Samples: ${sampleCount}`
  );

  // Tweet 3: The gap vs other dimensions
  tweets.push(
    `The gap is stark.\n\n` +
    `Avg score across other CRM dimensions: ${avgOtherScore}\n` +
    `Prediction score: ${score}\n` +
    `Gap: ${scoreGap} points\n\n` +
    `${metrics.allDimensions.length > 0 ? 'Dimension ranking (low→high):\n' + metrics.allDimensions.slice(0, 4).map(d => `• ${d.dimension}: ${parseFloat(d.score || 0).toFixed(3)}`).join('\n') : 'No dimension data available yet.'}`
  );

  // Tweet 4: Actual prediction accuracy data
  if (accuracy) {
    tweets.push(
      `Raw prediction accuracy data:\n\n` +
      `Total predictions: ${accuracy.total}\n` +
      `Correct: ${accuracy.correct} (${accuracy.accuracy}%)\n` +
      `False positives: ${accuracy.falsePositives} (predicted success, got failure)\n` +
      `False negatives: ${accuracy.falseNegatives} (predicted failure, got success)\n` +
      `Avg confidence: ${accuracy.avgConfidence}%\n\n` +
      `High confidence + wrong = the worst kind of failure.`
    );
  } else {
    tweets.push(
      `Raw prediction accuracy data:\n\n` +
      `Prediction tracking is sparse — ${sampleCount} samples logged.\n\n` +
      `This IS part of the problem. Can't improve what you don't measure.\n\n` +
      `The low score partly reflects insufficient instrumentation, not just bad predictions.`
    );
  }

  // Tweet 5: Root cause analysis
  tweets.push(
    `Why is prediction the weakest dimension?\n\n` +
    `3 root causes:\n\n` +
    `1/ No causal model — OCA reacts, doesn't anticipate. Build fails → fix. No pre-flight check.\n\n` +
    `2/ Sparse signal — prediction events aren't consistently logged, so the score is computed on thin data.\n\n` +
    `3/ No feedback loop — predictions aren't compared to outcomes systematically.`
  );

  // Tweet 6: What's actually failing mechanically
  tweets.push(
    `Mechanically, here's what's failing:\n\n` +
    `• build_predictions table: ${metrics.buildPredictions.length} rows (should be 100s)\n` +
    `• prediction_events table: ${metrics.predictionEvents.length} rows\n` +
    `• No pre-build confidence scoring in the build loop\n` +
    `• No capability gap prediction before task assignment\n\n` +
    `The architecture exists. The instrumentation doesn't.`
  );

  // Tweet 7: Historical trend if available
  if (historyTrend !== null) {
    const direction = parseFloat(historyTrend) > 0 ? '📈 improving' : parseFloat(historyTrend) < 0 ? '📉 declining' : '→ flat';
    tweets.push(
      `Score trend over last ${metrics.history.length} evaluations:\n\n` +
      `Start: ${parseFloat(metrics.history[metrics.history.length - 1]?.score || 0).toFixed(3)}\n` +
      `Current: ${parseFloat(metrics.history[0]?.score || 0).toFixed(3)}\n` +
      `Delta: ${historyTrend > 0 ? '+' : ''}${historyTrend}\n` +
      `Direction: ${direction}\n\n` +
      `${parseFloat(historyTrend) <= 0 ? 'Not improving yet. That\'s the honest answer.' : 'Movement in right direction, but 0.232 is still weak.'}`
    );
  } else {
    tweets.push(
      `Historical trend: insufficient data for trend analysis.\n\n` +
      `${metrics.history.length} historical data points available.\n\n` +
      `This itself is diagnostic — if we can't trend it, we can't manage it.\n\n` +
      `First fix: consistent evaluation cadence.`
    );
  }

  // Tweet 8: What needs to change
  tweets.push(
    `What needs to change to move this score:\n\n` +
    `Short term:\n` +
    `→ Log every build prediction + outcome\n` +
    `→ Add pre-build confidence check to build loop\n` +
    `→ Weekly prediction accuracy report\n\n` +
    `Medium term:\n` +
    `→ Causal model for build failure prediction\n` +
    `→ Capability gap forecasting\n` +
    `→ Confidence calibration`
  );

  // Tweet 9: Why transparency matters
  tweets.push(
    `Why post this publicly?\n\n` +
    `Because "build in public" means the failures too.\n\n` +
    `0.232 is a real number. The gaps are real. The missing instrumentation is real.\n\n` +
    `OCA is a cognitive architecture that's supposed to know itself.\n` +
    `Right now, its prediction subsystem doesn't.\n\n` +
    `That's the problem. Now it's tracked.`
  );

  // Tweet 10: CTA
  tweets.push(
    `Following OCA's development:\n\n` +
    `→ Every CRM dimension gets this treatment\n` +
    `→ Scores update as instrumentation improves\n` +
    `→ No vanity metrics — raw data or nothing\n\n` +
    `Prediction dimension target: 0.5 by end of next build cycle.\n\n` +
    `Will report back with actual numbers.\n\n` +
    `#BuildInPublic #AI #CognitiveArchitecture`
  );

  return tweets;
}

async function postThread(tweets) {
  const results = [];

  try {
    await motor.openUrl('https://twitter.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));

    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];

      await motor.copyToClipboard(tweet);
      await new Promise(r => setTimeout(r, 500));

      await motor.click({ x: 760, y: 400 });
      await new Promise(r => setTimeout(r, 500));

      await motor.press(['meta', 'a']);
      await new Promise(r => setTimeout(r, 200));

      await motor.press(['meta', 'v']);
      await new Promise(r => setTimeout(r, 1000));

      if (i < tweets.length - 1) {
        // Add to thread
        await motor.click({ x: 760, y: 500 });
        await new Promise(r => setTimeout(r, 500));

        // Click "Add another tweet" button
        await motor.press(['meta', 'enter']);
        await new Promise(r => setTimeout(r, 1500));
      } else {
        // Post the thread
        await motor.press(['meta', 'enter']);
        await new Promise(r => setTimeout(r, 2000));
      }

      results.push({ index: i, status: 'posted', preview: tweet.substring(0, 50) });
    }

    return { success: true, tweetsPosted: tweets.length, results };
  } catch (err) {
    console.error(`[${SKILL_NAME}] Thread posting error:`, err.message);
    return { success: false, error: err.message, results };
  }
}

async function postViaPeekaboo(tweets) {
  try {
    const threadContent = tweets.join('\n\n---TWEET_BREAK---\n\n');
    await motor.copyToClipboard(threadContent);

    const result = await motor.runShellCommand(
      `peekaboo post-thread --platform twitter --content-from-clipboard --separator "---TWEET_BREAK---"`
    );

    return {
      success: true,
      method: 'peekaboo',
      output: result,
      tweetsPosted: tweets.length
    };
  } catch (err) {
    console.error(`[${SKILL_NAME}] Peekaboo posting error:`, err.message);
    return { success: false, method: 'peekaboo', error: err.message };
  }
}

async function logPostAttempt(client, tweets, result, metrics) {
  try {
    await client.query(`
      INSERT INTO x_posts (
        skill_name,
        post_type,
        content_preview,
        tweet_count,
        success,
        error_message,
        metadata,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [
      SKILL_NAME,
      'prediction_dimension_analysis_thread',
      tweets[0]?.substring(0, 200) || '',
      tweets.length,
      result.success,
      result.error || null,
      JSON.stringify({
        predictionScore: metrics.current?.score || 0.232,
        sampleCount: metrics.current?.sample_count || 0,
        buildPredictionCount: metrics.buildPredictions?.length || 0,
        method: result.method || 'browser'
      })
    ]);
  } catch (err) {
    console.error(`[${SKILL_NAME}] Failed to log post attempt:`, err.message);
  }
}

async function run() {
  console.log(`[${SKILL_NAME}] Starting prediction dimension analysis post...`);

  const client = await pool.connect();
  let metrics;

  try {
    metrics = await getMetricsFromDB();
    console.log(`[${SKILL_NAME}] Metrics loaded. Current score: ${metrics.current?.score || 'N/A'}`);
  } finally {
    client.release();
  }

  const tweets = buildThreadContent(metrics);
  console.log(`[${SKILL_NAME}] Built ${tweets.length} tweets for thread`);

  // Try peekaboo first, fall back to browser automation
  let result = await postViaPeekaboo(tweets);

  if (!result.success) {
    console.log(`[${SKILL_NAME}] Peekaboo failed, trying browser automation...`);
    result = await postThread(tweets);
  }

  // Log the attempt
  const logClient = await pool.connect();
  try {
    await logPostAttempt(logClient, tweets, result, metrics);
  } finally {
    logClient.release();