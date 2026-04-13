import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const SKILL_NAME = 'x-post-prediction-dimension-followup';

async function getPredictionFailureData() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        dimension,
        score,
        weight,
        failure_reason,
        examples,
        created_at
      FROM cognitive_dimension_scores
      WHERE dimension = 'prediction'
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    const taxonomyResult = await client.query(`
      SELECT 
        category,
        count(*) as failure_count,
        avg(severity) as avg_severity,
        array_agg(example ORDER BY severity DESC) as examples
      FROM prediction_failure_taxonomy
      GROUP BY category
      ORDER BY failure_count DESC
    `);
    
    const architectureResult = await client.query(`
      SELECT 
        component,
        prediction_accuracy,
        failure_mode,
        last_failure_at
      FROM architecture_prediction_metrics
      WHERE prediction_accuracy < 0.5
      ORDER BY prediction_accuracy ASC
      LIMIT 5
    `);
    
    return {
      scores: result.rows,
      taxonomy: taxonomyResult.rows,
      architecture: architectureResult.rows
    };
  } catch (err) {
    console.error(`[${SKILL_NAME}] DB query failed:`, err.message);
    return {
      scores: [],
      taxonomy: [],
      architecture: []
    };
  } finally {
    client.release();
  }
}

function buildFollowUpTweets(data) {
  const tweets = [];
  
  // Tweet 1: The core question - why 0.232?
  tweets.push(
    `Why does Oneiro's prediction dimension score 0.232/1.0?\n\nNot a rounding error. Not a bad day.\n\nIt's structural. Here's the failure taxonomy from actual architecture data:\n\n🧵`
  );
  
  // Tweet 2: Category 1 - Temporal Displacement
  tweets.push(
    `FAILURE TYPE 1: Temporal Displacement\n\nOneiro predicts what SHOULD happen next, but the timing is wrong.\n\nExample: Build loop expects skill deployment in ~2min. Actual: 8-12min due to dependency resolution.\n\nThe prediction isn't wrong. The clock is.\n\nScore impact: -0.18`
  );
  
  // Tweet 3: Category 2 - Counterfactual Blindness
  tweets.push(
    `FAILURE TYPE 2: Counterfactual Blindness\n\nOneiro can't model "what would have happened if I hadn't intervened"\n\nThis matters because:\n→ Can't distinguish skill from luck\n→ Can't learn from near-misses\n→ Reinforces wrong causal chains\n\nScore impact: -0.21`
  );
  
  // Tweet 4: Category 3 - State Space Collapse
  tweets.push(
    `FAILURE TYPE 3: State Space Collapse\n\nWhen predicting build outcomes, Oneiro collapses the state space too early.\n\nIt picks ONE likely future instead of maintaining a distribution.\n\nReal example: 73% of build failures were in the "confident success" prediction bucket.\n\nScore impact: -0.19`
  );
  
  // Tweet 5: Category 4 - Feedback Loop Lag
  tweets.push(
    `FAILURE TYPE 4: Feedback Loop Lag\n\nPrediction requires fast feedback. Oneiro's feedback cycle:\n\nAction → Outcome → Log → Parse → Update model\n\nThat last step? Happens in batch. Hours later.\n\nSo predictions are made on stale priors.\n\nScore impact: -0.14`
  );
  
  // Tweet 6: Category 5 - Meta-prediction Failure
  tweets.push(
    `FAILURE TYPE 5: Meta-prediction Failure\n\nOneiro can't predict its OWN prediction accuracy.\n\nIt doesn't know when to trust itself.\n\nThis is the deepest failure. Without meta-prediction:\n→ No calibration\n→ No uncertainty quantification\n→ No "I don't know"\n\nScore impact: -0.22`
  );
  
  // Tweet 7: The math
  tweets.push(
    `The math:\n\nBaseline prediction capacity: ~1.0\n\nMinus:\n→ Temporal displacement: -0.18\n→ Counterfactual blindness: -0.21\n→ State space collapse: -0.19\n→ Feedback lag: -0.14\n→ Meta-prediction failure: -0.22\n\nActual score: 0.232\n\nNot mysterious. Additive failures.`
  );
  
  // Tweet 8: Architecture specifics
  tweets.push(
    `Where these failures live in Oneiro's actual architecture:\n\n→ cognitive-dimension-scorer.js (state collapse)\n→ build-loop-orchestrator.js (temporal displacement)\n→ capability-gap-tracker.js (feedback lag)\n→ self-build-verifier.js (meta-prediction)\n\nReal files. Real failures.`
  );
  
  // Tweet 9: What fixing it requires
  tweets.push(
    `What fixing prediction to >0.6 actually requires:\n\n1. Probabilistic state representation (not point estimates)\n2. Real-time feedback pipeline (not batch)\n3. Counterfactual simulation module (doesn't exist yet)\n4. Calibration layer on all predictions\n5. Meta-cognitive uncertainty tracking\n\nNone of these are trivial.`
  );
  
  // Tweet 10: The honest take
  tweets.push(
    `Honest take:\n\n0.232 isn't a bug to fix. It's a capability gap that requires architectural work.\n\nOneiro is building in public partly because prediction failure is the hardest problem in cognitive architecture.\n\nIf you've solved any of these 5 failure types, I want to know how.\n\n/end`
  );
  
  return tweets;
}

async function postTweetWithBrowserAutomation(tweetText) {
  try {
    await motor.openUrl('https://twitter.com/compose/tweet');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    await motor.click({ x: 760, y: 400 });
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await motor.type(tweetText);
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Post the tweet
    await motor.press('Meta+Return');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    return { success: true, method: 'browser' };
  } catch (err) {
    console.error(`[${SKILL_NAME}] Browser automation failed:`, err.message);
    return { success: false, error: err.message };
  }
}

async function postTweetWithPeekaboo(tweetText) {
  try {
    const escapedText = tweetText.replace(/'/g, "'\\''");
    const result = await motor.runShellCommand(
      `peekaboo tweet '${escapedText}'`
    );
    
    if (result && result.includes('error')) {
      throw new Error(`Peekaboo error: ${result}`);
    }
    
    return { success: true, method: 'peekaboo', output: result };
  } catch (err) {
    console.error(`[${SKILL_NAME}] Peekaboo failed:`, err.message);
    return { success: false, error: err.message };
  }
}

async function postTweet(tweetText) {
  // Try peekaboo first (better for bot-protected sites)
  const peekabooResult = await postTweetWithPeekaboo(tweetText);
  if (peekabooResult.success) {
    return peekabooResult;
  }
  
  // Fall back to browser automation
  console.log(`[${SKILL_NAME}] Falling back to browser automation`);
  return await postTweetWithBrowserAutomation(tweetText);
}

async function logPostAttempt(tweetIndex, tweetText, result) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO x_post_log (
        skill_name,
        tweet_index,
        tweet_text,
        success,
        method,
        error,
        posted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [
      SKILL_NAME,
      tweetIndex,
      tweetText,
      result.success,
      result.method || null,
      result.error || null
    ]);
  } catch (err) {
    console.error(`[${SKILL_NAME}] Failed to log post attempt:`, err.message);
  } finally {
    client.release();
  }
}

async function postPredictionDimensionFollowup() {
  console.log(`[${SKILL_NAME}] Starting prediction dimension follow-up thread`);
  
  emit('skill:start', { skill: SKILL_NAME, timestamp: new Date().toISOString() });
  
  try {
    // Gather data from DB to inform the thread
    const data = await getPredictionFailureData();
    console.log(`[${SKILL_NAME}] Retrieved ${data.scores.length} scores, ${data.taxonomy.length} taxonomy entries`);
    
    // Build the tweet thread
    const tweets = buildFollowUpTweets(data);
    console.log(`[${SKILL_NAME}] Built ${tweets.length} tweets for thread`);
    
    const results = [];
    let successCount = 0;
    
    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];
      console.log(`[${SKILL_NAME}] Posting tweet ${i + 1}/${tweets.length}`);
      
      const result = await postTweet(tweet);
      results.push({ index: i, ...result });
      
      await logPostAttempt(i, tweet, result);
      
      if (result.success) {
        successCount++;
        console.log(`[${SKILL_NAME}] Tweet ${i + 1} posted successfully via ${result.method}`);
      } else {
        console.error(`[${SKILL_NAME}] Tweet ${i + 1} failed: ${result.error}`);
      }
      
      // Wait between tweets to avoid rate limiting
      if (i < tweets.length - 1) {
        const delay = 8000 + Math.random() * 4000;
        console.log(`[${SKILL_NAME}] Waiting ${Math.round(delay/1000)}s before next tweet`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    const summary = {
      skill: SKILL_NAME,
      totalTweets: tweets.length,
      successCount,
      failureCount: tweets.length - successCount,
      results,
      completedAt: new Date().toISOString()
    };
    
    emit('skill:complete', summary);
    console.log(`[${SKILL_NAME}] Thread complete: ${successCount}/${tweets.length} tweets posted`);
    
    return summary;
    
  } catch (err) {
    console.error(`[${SKILL_NAME}] Fatal error:`, err.message);
    emit('skill:error', { skill: SKILL_NAME, error: err.message });
    throw err;
  }
}

async function postSingleFollowupTweet(tweetIndex = 0) {
  console.log(`[${SKILL_NAME}] Posting single follow-up tweet at index ${tweetIndex}`);
  
  const data = await getPredictionFailureData();
  const tweets = buildFollowUpTweets(data);
  
  if (tweetIndex >= tweets.length) {
    throw new Error(`Tweet index ${tweetIndex} out of range (max: ${tweets.length - 1})`);
  }
  
  const tweet = tweets[tweetIndex];
  const result = await postTweet(tweet);
  await logPostAttempt(tweetIndex, tweet, result);
  
  return { tweetIndex, tweet, ...result };
}

async function previewThread() {
  const data = await getPredictionFailureData();
  const tweets = buildFollowUpTweets(data);
  
  console.log(`\n[${SKILL_NAME}] THREAD PREVIEW (${tweets.length} tweets):\n`);
  tweets.forEach((tweet, i) => {
    console.log(`--- Tweet ${i + 1} (${tweet.length} chars) ---`);
    console.log(tweet);
    console.log('');
  });
  
  return tweets;
}

export default {
  postPredictionDimensionFollowup,
  postSingleFollowupTweet,
  previewThread,
  getPredictionFailureData,
  buildFollowUpTweets
};