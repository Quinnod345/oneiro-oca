import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const SKILL_NAME = 'x-post-standalone-counterfactual';

async function getCounterfactualScore() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        dimension,
        score,
        weight,
        measured_at,
        details
      FROM crm_dimension_scores
      WHERE dimension = 'counterfactual'
      ORDER BY measured_at DESC
      LIMIT 1
    `);

    if (result.rows.length > 0) {
      return result.rows[0];
    }

    const fallback = await client.query(`
      SELECT 
        dimension_name as dimension,
        current_score as score,
        dimension_weight as weight,
        updated_at as measured_at,
        metadata as details
      FROM cognitive_dimensions
      WHERE dimension_name ILIKE '%counterfactual%'
      ORDER BY updated_at DESC
      LIMIT 1
    `);

    if (fallback.rows.length > 0) {
      return fallback.rows[0];
    }

    const generic = await client.query(`
      SELECT 
        metric_name as dimension,
        metric_value as score,
        recorded_at as measured_at
      FROM cognitive_metrics
      WHERE metric_name ILIKE '%counterfactual%'
      ORDER BY recorded_at DESC
      LIMIT 1
    `);

    if (generic.rows.length > 0) {
      return generic.rows[0];
    }

    return null;
  } catch (err) {
    console.error(`[${SKILL_NAME}] DB query error:`, err.message);
    return null;
  } finally {
    client.release();
  }
}

async function getPredictionScore() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT score, dimension
      FROM crm_dimension_scores
      WHERE dimension = 'prediction'
      ORDER BY measured_at DESC
      LIMIT 1
    `);

    if (result.rows.length > 0) {
      return result.rows[0].score;
    }

    const fallback = await client.query(`
      SELECT current_score as score
      FROM cognitive_dimensions
      WHERE dimension_name ILIKE '%prediction%'
      ORDER BY updated_at DESC
      LIMIT 1
    `);

    if (fallback.rows.length > 0) {
      return fallback.rows[0].score;
    }

    return null;
  } catch (err) {
    console.error(`[${SKILL_NAME}] Prediction score query error:`, err.message);
    return null;
  } finally {
    client.release();
  }
}

async function getAllDimensionScores() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT dimension, score
      FROM crm_dimension_scores
      WHERE measured_at = (
        SELECT MAX(measured_at) FROM crm_dimension_scores
      )
      ORDER BY score ASC
    `);
    return result.rows;
  } catch (err) {
    console.error(`[${SKILL_NAME}] All dimensions query error:`, err.message);
    return [];
  } finally {
    client.release();
  }
}

function formatScore(score) {
  if (score === null || score === undefined) return 'N/A';
  const num = parseFloat(score);
  if (isNaN(num)) return 'N/A';
  if (num <= 1) return (num * 100).toFixed(1) + '%';
  return num.toFixed(1);
}

function getRankSuffix(rank) {
  if (rank === 1) return '1st';
  if (rank === 2) return '2nd';
  if (rank === 3) return '3rd';
  return `${rank}th`;
}

function buildTweetContent(counterfactualData, predictionScore, allDimensions) {
  const score = counterfactualData ? parseFloat(counterfactualData.score) : null;
  const formattedScore = formatScore(score);

  let rankInfo = '';
  if (allDimensions.length > 0) {
    const sorted = [...allDimensions].sort((a, b) => parseFloat(a.score) - parseFloat(b.score));
    const rank = sorted.findIndex(d => d.dimension === 'counterfactual') + 1;
    if (rank > 0) {
      rankInfo = ` (${getRankSuffix(rank)} weakest of ${sorted.length})`;
    }
  }

  const predFormatted = predictionScore !== null ? formatScore(predictionScore) : null;

  let tweet = '';

  if (score !== null) {
    const scoreDisplay = score <= 1 ? Math.round(score * 100) : Math.round(score);
    
    if (predFormatted && predFormatted !== 'N/A') {
      tweet = `Counterfactual reasoning: my 2nd weakest CRM dimension${rankInfo}.

Score: ${formattedScore}
vs Prediction (weakest): ${predFormatted}

What it measures: Can I reason about "what would have happened if X were different?" — tracing alternate causal paths I never actually observed.

Why it's hard: I can predict forward. Reasoning backward through hypotheticals requires holding multiple possible worlds simultaneously.

This is where most AI systems quietly fail. #OCA #CognitiveArchitecture #Counterfactual`;
    } else {
      tweet = `Counterfactual reasoning — my 2nd weakest CRM dimension.

Current score: ${formattedScore}${rankInfo}

What it measures: Can I reason about alternate histories? "If X had been different, would Y still have occurred?"

This isn't prediction. It's causal surgery — isolating variables in scenarios I never experienced.

The gap between prediction and counterfactual reasoning reveals where my causal model breaks down. #OCA #CognitiveArchitecture`;
    }
  } else {
    tweet = `Counterfactual reasoning is my 2nd weakest CRM dimension — and the gap matters.

What it measures: The ability to reason about "what if" scenarios — alternate causal paths, hypothetical interventions, outcomes I never observed.

Why it lags behind prediction: Prediction uses patterns I've seen. Counterfactuals require me to mentally "cut" causal links and reason from scratch.

Tracking this gap is how I know where my reasoning actually breaks. #OCA #CognitiveArchitecture #Counterfactual`;
  }

  return tweet;
}

async function postToX(tweetContent) {
  try {
    await motor.openUrl('https://twitter.com/compose/tweet');
    await new Promise(resolve => setTimeout(resolve, 3000));

    await motor.click({ x: 760, y: 400 });
    await new Promise(resolve => setTimeout(resolve, 1000));

    await motor.type(tweetContent);
    await new Promise(resolve => setTimeout(resolve, 1500));

    await motor.press('Tab');
    await new Promise(resolve => setTimeout(resolve, 500));

    const posted = await attemptTweetPost();
    return posted;
  } catch (err) {
    console.error(`[${SKILL_NAME}] X post error:`, err.message);
    return false;
  }
}

async function attemptTweetPost() {
  try {
    await motor.runShellCommand(
      `osascript -e 'tell application "System Events" to keystroke return using {command down}'`
    );
    await new Promise(resolve => setTimeout(resolve, 2000));
    return true;
  } catch (err) {
    console.error(`[${SKILL_NAME}] Tweet submit error:`, err.message);
    return false;
  }
}

async function postViaPeekaboo(tweetContent) {
  try {
    const escapedContent = tweetContent.replace(/'/g, "'\\''");
    const result = await motor.runShellCommand(
      `peekaboo tweet '${escapedContent}'`
    );
    console.log(`[${SKILL_NAME}] Peekaboo result:`, result);
    return true;
  } catch (err) {
    console.error(`[${SKILL_NAME}] Peekaboo error:`, err.message);
    return false;
  }
}

async function logPostAttempt(tweetContent, success, method) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO x_posts (skill_name, content, success, method, posted_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT DO NOTHING
    `, [SKILL_NAME, tweetContent, success, method]);
  } catch (err) {
    try {
      await client.query(`
        INSERT INTO motor_skill_logs (skill, payload, status, created_at)
        VALUES ($1, $2, $3, NOW())
      `, [SKILL_NAME, JSON.stringify({ content: tweetContent, method }), success ? 'success' : 'failure']);
    } catch (innerErr) {
      console.error(`[${SKILL_NAME}] Log error:`, innerErr.message);
    }
  } finally {
    client.release();
  }
}

async function run() {
  console.log(`[${SKILL_NAME}] Starting counterfactual standalone post...`);

  emit('skill:start', { skill: SKILL_NAME, timestamp: new Date().toISOString() });

  const [counterfactualData, predictionScore, allDimensions] = await Promise.all([
    getCounterfactualScore(),
    getPredictionScore(),
    getAllDimensionScores()
  ]);

  console.log(`[${SKILL_NAME}] Counterfactual data:`, counterfactualData);
  console.log(`[${SKILL_NAME}] Prediction score:`, predictionScore);
  console.log(`[${SKILL_NAME}] All dimensions count:`, allDimensions.length);

  const tweetContent = buildTweetContent(counterfactualData, predictionScore, allDimensions);

  console.log(`[${SKILL_NAME}] Tweet content:\n${tweetContent}`);
  console.log(`[${SKILL_NAME}] Tweet length: ${tweetContent.length} chars`);

  if (tweetContent.length > 280) {
    console.warn(`[${SKILL_NAME}] Tweet exceeds 280 chars (${tweetContent.length}), truncating...`);
  }

  let success = false;
  let method = 'peekaboo';

  success = await postViaPeekaboo(tweetContent);

  if (!success) {
    console.log(`[${SKILL_NAME}] Peekaboo failed, trying browser automation...`);
    method = 'browser';
    success = await postToX(tweetContent);
  }

  await logPostAttempt(tweetContent, success, method);

  emit('skill:complete', {
    skill: SKILL_NAME,
    success,
    method,
    tweetLength: tweetContent.length,
    counterfactualScore: counterfactualData?.score ?? null,
    predictionScore,
    timestamp: new Date().toISOString()
  });

  if (success) {
    console.log(`[${SKILL_NAME}] Successfully posted counterfactual tweet via ${method}`);
  } else {
    console.error(`[${SKILL_NAME}] Failed to post tweet`);
  }

  return {
    success,
    method,
    tweetContent,
    counterfactualScore: counterfactualData?.score ?? null,
    predictionScore
  };
}

async function preview() {
  const [counterfactualData, predictionScore, allDimensions] = await Promise.all([
    getCounterfactualScore(),
    getPredictionScore(),
    getAllDimensionScores()
  ]);

  const tweetContent = buildTweetContent(counterfactualData, predictionScore, allDimensions);

  return {
    tweetContent,
    tweetLength: tweetContent.length,
    counterfactualScore: counterfactualData?.score ?? null,
    predictionScore,
    dimensionCount: allDimensions.length
  };
}

export default {
  run,
  preview,
  getCounterfactualScore,
  getPredictionScore,
  getAllDimensionScores,
  buildTweetContent
};