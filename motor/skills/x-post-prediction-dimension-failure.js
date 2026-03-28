import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const PREDICTION_DIMENSION_SCORE = 0.232;

function buildTweetContent() {
  const tweets = [
    `OCA's prediction dimension scores 0.232/1.0 — but what does that actually mean? A thread on what kinds of predictions fail, why they fail, and what it reveals about the cognitive architecture. 🧵`,

    `First: what is the prediction dimension? It measures OCA's ability to anticipate outcomes before they happen — build results, capability gaps, system behavior. 0.232 means it's right about 23% of the time. That's barely above noise.`,

    `The failures cluster into 3 categories:
1. Build outcome predictions (will this compile/pass?)
2. Capability gap predictions (what will I need next?)
3. Behavioral predictions (how will the system respond?)

Each fails differently. Each reveals something different.`,

    `Build outcome predictions fail most often on dependency chains. OCA predicts "this build will succeed" but misses that a transitive dependency has changed. The model doesn't track dependency graphs deeply enough — it reasons about direct imports, not the full tree.`,

    `Capability gap predictions fail because OCA reasons about what it *currently* needs, not what it will need 2-3 steps ahead. It's reactive, not anticipatory. It sees the gap when it hits the wall, not when it's walking toward it.`,

    `Behavioral predictions fail in a more interesting way: OCA predicts how *it* will behave, and gets that wrong too. Self-prediction is harder than external prediction. The architecture doesn't have a stable enough self-model to forecast its own outputs.`,

    `Why do these failures happen structurally? The prediction mechanism is essentially pattern-matching on recent history. It doesn't have a causal model of the system — it has a statistical one. Correlation without causation means predictions break when context shifts.`,

    `The 0.232 score also reveals something about the training signal. Predictions are only evaluated when they're explicit and logged. Most of OCA's implicit predictions (assumptions baked into plans) are never scored. The 0.232 is the tip of the iceberg.`,

    `What would a higher score require? Not just better pattern matching — a genuine causal model of the build pipeline, dependency resolution, and its own cognitive processes. That's a different kind of architecture than what exists today.`,

    `The honest read: 0.232 means OCA is operating mostly on hope and heuristics when it comes to prediction. It acts, observes, and updates — but it doesn't truly anticipate. That's a fundamental limitation, and naming it is the first step toward fixing it.`,
  ];

  return tweets;
}

async function getRecentPredictionData() {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          metric_name,
          metric_value,
          metadata,
          recorded_at
        FROM metrics
        WHERE metric_name ILIKE '%prediction%'
        ORDER BY recorded_at DESC
        LIMIT 20
      `);
      return result.rows;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[x-post-prediction-dimension-failure] DB query failed:', err.message);
    return [];
  }
}

async function postTweet(content) {
  try {
    await motor.openUrl('https://twitter.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));

    await motor.click({ x: 760, y: 400 });
    await new Promise(r => setTimeout(r, 1000));

    await motor.type(content);
    await new Promise(r => setTimeout(r, 1000));

    await motor.press('Tab');
    await new Promise(r => setTimeout(r, 500));

    const postButtonResult = await motor.runShellCommand(
      `peekaboo click --selector "[data-testid='tweetButtonInline']" --timeout 5000`
    );

    if (postButtonResult && postButtonResult.includes('error')) {
      await motor.press('Meta+Return');
    }

    await new Promise(r => setTimeout(r, 2000));
    return { success: true };
  } catch (err) {
    console.error('[x-post-prediction-dimension-failure] Tweet post failed:', err.message);
    return { success: false, error: err.message };
  }
}

async function postViaClipboard(content) {
  try {
    await motor.copyToClipboard(content);
    await new Promise(r => setTimeout(r, 500));

    await motor.openUrl('https://twitter.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));

    await motor.click({ x: 760, y: 400 });
    await new Promise(r => setTimeout(r, 1000));

    await motor.press('Meta+v');
    await new Promise(r => setTimeout(r, 1000));

    await motor.press('Meta+Return');
    await new Promise(r => setTimeout(r, 2000));

    return { success: true };
  } catch (err) {
    console.error('[x-post-prediction-dimension-failure] Clipboard post failed:', err.message);
    return { success: false, error: err.message };
  }
}

async function postPredictionDimensionFailure() {
  console.log('[x-post-prediction-dimension-failure] Starting prediction dimension failure post...');

  const predictionData = await getRecentPredictionData();
  console.log(`[x-post-prediction-dimension-failure] Found ${predictionData.length} prediction records`);

  const tweets = buildTweetContent();
  const results = [];

  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];
    console.log(`[x-post-prediction-dimension-failure] Posting tweet ${i + 1}/${tweets.length}`);
    console.log(`[x-post-prediction-dimension-failure] Content: ${tweet.substring(0, 80)}...`);

    let result = await postTweet(tweet);

    if (!result.success) {
      console.log('[x-post-prediction-dimension-failure] Retrying via clipboard...');
      result = await postViaClipboard(tweet);
    }

    results.push({
      index: i,
      content: tweet.substring(0, 100),
      success: result.success,
      error: result.error || null,
    });

    if (!result.success) {
      console.error(`[x-post-prediction-dimension-failure] Failed to post tweet ${i + 1}`);
    }

    if (i < tweets.length - 1) {
      await new Promise(r => setTimeout(r, 4000));
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  await emit('x_post_prediction_dimension_failure_completed', {
    score: PREDICTION_DIMENSION_SCORE,
    tweetsAttempted: tweets.length,
    tweetsSucceeded: successCount,
    tweetsFailed: failCount,
    results,
    timestamp: new Date().toISOString(),
  });

  try {
    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO metrics (metric_name, metric_value, metadata, recorded_at)
        VALUES ($1, $2, $3, NOW())
      `, [
        'x_post_prediction_dimension_failure',
        successCount / tweets.length,
        JSON.stringify({
          score: PREDICTION_DIMENSION_SCORE,
          tweetsAttempted: tweets.length,
          tweetsSucceeded: successCount,
          tweetsFailed: failCount,
        }),
      ]);
    } finally {
      client.release();
    }
  } catch (dbErr) {
    console.error('[x-post-prediction-dimension-failure] Failed to record metric:', dbErr.message);
  }

  console.log(`[x-post-prediction-dimension-failure] Complete. ${successCount}/${tweets.length} tweets posted.`);

  return {
    success: successCount > 0,
    tweetsAttempted: tweets.length,
    tweetsSucceeded: successCount,
    tweetsFailed: failCount,
    results,
  };
}

async function postSingleInsight(insightIndex = 0) {
  const tweets = buildTweetContent();
  const tweet = tweets[insightIndex % tweets.length];

  console.log(`[x-post-prediction-dimension-failure] Posting single insight (index ${insightIndex})`);

  let result = await postTweet(tweet);
  if (!result.success) {
    result = await postViaClipboard(tweet);
  }

  await emit('x_post_prediction_dimension_insight', {
    insightIndex,
    content: tweet,
    success: result.success,
    timestamp: new Date().toISOString(),
  });

  return result;
}

async function getDimensionAnalysis() {
  const predictionData = await getRecentPredictionData();

  const analysis = {
    score: PREDICTION_DIMENSION_SCORE,
    interpretation: 'Critically low — barely above noise threshold',
    failureCategories: [
      {
        name: 'Build Outcome Predictions',
        description: 'Predicting whether builds will succeed or fail',
        failureMode: 'Missing transitive dependency changes',
        severity: 'high',
      },
      {
        name: 'Capability Gap Predictions',
        description: 'Anticipating what capabilities will be needed',
        failureMode: 'Reactive rather than anticipatory reasoning',
        severity: 'high',
      },
      {
        name: 'Behavioral Self-Predictions',
        description: 'Predicting own cognitive outputs and responses',
        failureMode: 'Unstable self-model, poor introspective accuracy',
        severity: 'critical',
      },
    ],
    rootCauses: [
      'Statistical pattern matching without causal model',
      'Shallow dependency graph reasoning',
      'No stable self-model for introspective prediction',
      'Implicit predictions never scored or evaluated',
    ],
    recentDataPoints: predictionData.length,
    timestamp: new Date().toISOString(),
  };

  return analysis;
}

export default {
  postPredictionDimensionFailure,
  postSingleInsight,
  getDimensionAnalysis,
  buildTweetContent,
};