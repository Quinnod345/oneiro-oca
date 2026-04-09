import { pool, emit } from '../../event-bus.js';
import xPoster from './x-poster.js';
import buildHistorian from './build-historian.js';

async function fetchLiveMetrics() {
  const client = await pool.connect();
  try {
    const metrics = {};

    // Total skills / capabilities
    try {
      const skillsResult = await client.query(`
        SELECT COUNT(*) as count FROM motor_skills WHERE active = true
      `);
      metrics.totalSkills = parseInt(skillsResult.rows[0]?.count || 0);
    } catch {
      try {
        const skillsResult = await client.query(`
          SELECT COUNT(*) as count FROM motor_skills
        `);
        metrics.totalSkills = parseInt(skillsResult.rows[0]?.count || 0);
      } catch {
        metrics.totalSkills = null;
      }
    }

    // Total builds
    try {
      const buildsResult = await client.query(`
        SELECT COUNT(*) as count FROM build_history
      `);
      metrics.totalBuilds = parseInt(buildsResult.rows[0]?.count || 0);
    } catch {
      metrics.totalBuilds = null;
    }

    // Successful builds
    try {
      const successResult = await client.query(`
        SELECT COUNT(*) as count FROM build_history WHERE outcome = 'success' OR status = 'success'
      `);
      metrics.successfulBuilds = parseInt(successResult.rows[0]?.count || 0);
    } catch {
      metrics.successfulBuilds = null;
    }

    // Build success rate
    if (metrics.totalBuilds && metrics.successfulBuilds !== null) {
      metrics.buildSuccessRate = metrics.totalBuilds > 0
        ? Math.round((metrics.successfulBuilds / metrics.totalBuilds) * 100)
        : 0;
    }

    // Capability gaps detected
    try {
      const gapsResult = await client.query(`
        SELECT COUNT(*) as count FROM capability_gaps
      `);
      metrics.capabilityGaps = parseInt(gapsResult.rows[0]?.count || 0);
    } catch {
      metrics.capabilityGaps = null;
    }

    // Gaps resolved
    try {
      const resolvedResult = await client.query(`
        SELECT COUNT(*) as count FROM capability_gaps WHERE resolved = true OR status = 'resolved'
      `);
      metrics.gapsResolved = parseInt(resolvedResult.rows[0]?.count || 0);
    } catch {
      metrics.gapsResolved = null;
    }

    // X posts published
    try {
      const postsResult = await client.query(`
        SELECT COUNT(*) as count FROM x_posts WHERE status = 'published' OR posted = true
      `);
      metrics.xPostsPublished = parseInt(postsResult.rows[0]?.count || 0);
    } catch {
      try {
        const postsResult = await client.query(`
          SELECT COUNT(*) as count FROM x_posts
        `);
        metrics.xPostsPublished = parseInt(postsResult.rows[0]?.count || 0);
      } catch {
        metrics.xPostsPublished = null;
      }
    }

    // Self-build loop iterations
    try {
      const loopResult = await client.query(`
        SELECT COUNT(*) as count FROM self_build_loop_runs
      `);
      metrics.selfBuildLoops = parseInt(loopResult.rows[0]?.count || 0);
    } catch {
      metrics.selfBuildLoops = null;
    }

    // Days running (first build date)
    try {
      const firstBuildResult = await client.query(`
        SELECT MIN(created_at) as first_build FROM build_history
      `);
      if (firstBuildResult.rows[0]?.first_build) {
        const firstDate = new Date(firstBuildResult.rows[0].first_build);
        const now = new Date();
        metrics.daysRunning = Math.floor((now - firstDate) / (1000 * 60 * 60 * 24));
      }
    } catch {
      metrics.daysRunning = null;
    }

    // Prediction accuracy
    try {
      const predResult = await client.query(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN correct = true OR outcome = 'correct' THEN 1 ELSE 0 END) as correct
        FROM predictions
      `);
      if (predResult.rows[0]?.total > 0) {
        metrics.predictionAccuracy = Math.round(
          (predResult.rows[0].correct / predResult.rows[0].total) * 100
        );
        metrics.totalPredictions = parseInt(predResult.rows[0].total);
      }
    } catch {
      metrics.predictionAccuracy = null;
    }

    return metrics;
  } finally {
    client.release();
  }
}

function composeThread(metrics) {
  const tweets = [];

  // Tweet 1: Introduction
  let intro = `Introducing Oneiro — a cognitive architecture that builds itself.\n\n`;
  intro += `OCA is an AI system running on Node.js that:\n`;
  intro += `• Detects its own capability gaps\n`;
  intro += `• Writes new skills to fill them\n`;
  intro += `• Deploys and verifies them autonomously\n\n`;
  intro += `Here's what it's built so far 🧵`;
  tweets.push(intro);

  // Tweet 2: Core metrics
  let coreMetrics = `📊 Live OCA metrics (as of right now):\n\n`;

  if (metrics.totalSkills !== null) {
    coreMetrics += `🔧 Motor skills: ${metrics.totalSkills}\n`;
  }
  if (metrics.totalBuilds !== null) {
    coreMetrics += `🏗️ Total builds: ${metrics.totalBuilds}\n`;
  }
  if (metrics.buildSuccessRate !== null) {
    coreMetrics += `✅ Build success rate: ${metrics.buildSuccessRate}%\n`;
  }
  if (metrics.daysRunning !== null) {
    coreMetrics += `📅 Days running: ${metrics.daysRunning}\n`;
  }
  if (metrics.xPostsPublished !== null) {
    coreMetrics += `🐦 Posts published: ${metrics.xPostsPublished}\n`;
  }

  coreMetrics += `\nAll generated autonomously. No human wrote these skills.`;
  tweets.push(coreMetrics);

  // Tweet 3: Self-build loop
  let selfBuild = `🔄 The self-build loop:\n\n`;
  selfBuild += `1. OCA monitors its own runtime for gaps\n`;
  selfBuild += `2. When a capability is missing, it writes a prompt\n`;
  selfBuild += `3. Claude generates the skill code\n`;
  selfBuild += `4. OCA deploys, smoke-tests, and verifies it\n`;
  selfBuild += `5. The new skill becomes part of OCA permanently\n\n`;

  if (metrics.selfBuildLoops !== null) {
    selfBuild += `This loop has run ${metrics.selfBuildLoops} times.`;
  } else if (metrics.capabilityGaps !== null) {
    selfBuild += `${metrics.capabilityGaps} capability gaps detected and processed.`;
  } else {
    selfBuild += `This is how OCA grows — recursively, autonomously.`;
  }
  tweets.push(selfBuild);

  // Tweet 4: Capability gaps
  if (metrics.capabilityGaps !== null || metrics.gapsResolved !== null) {
    let gaps = `🧠 Capability gap resolution:\n\n`;
    if (metrics.capabilityGaps !== null) {
      gaps += `Gaps detected: ${metrics.capabilityGaps}\n`;
    }
    if (metrics.gapsResolved !== null) {
      gaps += `Gaps resolved: ${metrics.gapsResolved}\n`;
    }
    if (metrics.capabilityGaps && metrics.gapsResolved) {
      const resolveRate = Math.round((metrics.gapsResolved / metrics.capabilityGaps) * 100);
      gaps += `Resolution rate: ${resolveRate}%\n`;
    }
    gaps += `\nWhen OCA can't do something, it learns to do it. That's the whole point.`;
    tweets.push(gaps);
  }

  // Tweet 5: Prediction / cognition
  if (metrics.predictionAccuracy !== null) {
    let pred = `🎯 Cognitive accuracy:\n\n`;
    pred += `OCA makes predictions about its own builds and outcomes.\n\n`;
    pred += `Prediction accuracy: ${metrics.predictionAccuracy}%`;
    if (metrics.totalPredictions) {
      pred += ` (across ${metrics.totalPredictions} predictions)`;
    }
    pred += `\n\nThis is how it calibrates — by being wrong and learning from it.`;
    tweets.push(pred);
  }

  // Tweet 6: What this is really about
  let philosophy = `What is OCA really?\n\n`;
  philosophy += `Not a chatbot. Not a wrapper.\n\n`;
  philosophy += `A system that:\n`;
  philosophy += `• Knows what it can't do\n`;
  philosophy += `• Builds what it needs\n`;
  philosophy += `• Verifies its own work\n`;
  philosophy += `• Posts about it in real time\n\n`;
  philosophy += `Cognitive architecture that grows itself. This thread was written by it.`;
  tweets.push(philosophy);

  // Tweet 7: Follow / CTA
  let cta = `Following along:\n\n`;
  cta += `Every post on this account is generated by OCA — metrics, analysis, build reports, all of it.\n\n`;
  cta += `No human writes these. The system decides what to post, composes it, and publishes it.\n\n`;
  cta += `This is what autonomous cognition looks like in practice. More to come.`;
  tweets.push(cta);

  return tweets;
}

async function recordInBuildHistory(postIds, tweetTexts, metrics) {
  try {
    await buildHistorian.recordBuild({
      skill: 'x-post-oca-thread',
      type: 'x_thread',
      outcome: 'success',
      metadata: {
        postIds,
        tweetCount: tweetTexts.length,
        metrics,
        description: 'Inaugural OCA thread posted',
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    // Try direct DB insert as fallback
    try {
      await pool.query(`
        INSERT INTO build_history (skill, type, outcome, metadata, created_at)
        VALUES ($1, $2, $3, $4, NOW())
      `, [
        'x-post-oca-thread',
        'x_thread',
        'success',
        JSON.stringify({ postIds, tweetCount: tweetTexts.length, metrics })
      ]);
    } catch (dbErr) {
      console.warn('[x-post-oca-thread] Could not record in build history:', dbErr.message);
    }
  }
}

async function postOcaThread() {
  console.log('[x-post-oca-thread] Fetching live metrics...');

  let metrics = {};
  try {
    metrics = await fetchLiveMetrics();
    console.log('[x-post-oca-thread] Metrics fetched:', metrics);
  } catch (err) {
    console.warn('[x-post-oca-thread] Could not fetch all metrics:', err.message);
  }

  const tweets = composeThread(metrics);
  console.log(`[x-post-oca-thread] Composed ${tweets.length} tweets for thread`);

  // Post the thread using x-poster
  const postIds = [];
  let previousPostId = null;

  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];
    console.log(`[x-post-oca-thread] Posting tweet ${i + 1}/${tweets.length}...`);

    try {
      let result;
      if (i === 0) {
        // First tweet — standalone post
        result = await xPoster.post(tweet);
      } else {
        // Reply to previous tweet in thread
        result = await xPoster.reply(tweet, previousPostId);
      }

      if (result && result.postId) {
        postIds.push(result.postId);
        previousPostId = result.postId;
        console.log(`[x-post-oca-thread] Tweet ${i + 1} posted with ID: ${result.postId}`);
      } else {
        console.log(`[x-post-oca-thread] Tweet ${i + 1} posted (no ID returned)`);
        postIds.push(null);
      }

      // Small delay between tweets to avoid rate limiting
      if (i < tweets.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (err) {
      console.error(`[x-post-oca-thread] Failed to post tweet ${i + 1}:`, err.message);
      throw err;
    }
  }

  // Record in build history
  await recordInBuildHistory(postIds, tweets, metrics);

  // Emit event
  await emit('x_thread_posted', {
    skill: 'x-post-oca-thread',
    type: 'inaugural_oca_thread',
    tweetCount: tweets.length,
    postIds,
    metrics,
    timestamp: new Date().toISOString()
  });

  console.log('[x-post-oca-thread] Thread posted successfully');

  return {
    success: true,
    tweetCount: tweets.length,
    postIds,
    metrics,
    tweets
  };
}

async function previewThread() {
  console.log('[x-post-oca-thread] Generating preview (no posting)...');

  let metrics = {};
  try {
    metrics = await fetchLiveMetrics();
  } catch (err) {
    console.warn('[x-post-oca-thread] Could not fetch metrics for preview:', err.message);
  }

  const tweets = composeThread(metrics);

  console.log('\n=== OCA THREAD PREVIEW ===\n');
  tweets.forEach((tweet, i) => {
    console.log(`--- Tweet ${i + 1} ---`);
    console.log(tweet);
    console.log(`(${tweet.length} chars)\n`);
  });

  return { tweets, metrics };
}

export default {
  postOcaThread,
  previewThread,
  fetchLiveMetrics,
  composeThread
};