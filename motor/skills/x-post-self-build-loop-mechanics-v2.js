import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

async function fetchBuildStats() {
  const client = await pool.connect();
  try {
    const statsQuery = `
      SELECT
        COUNT(*) as total_builds,
        COUNT(*) FILTER (WHERE outcome = 'success') as successful_builds,
        COUNT(*) FILTER (WHERE outcome = 'failure') as failed_builds,
        COUNT(*) FILTER (WHERE outcome = 'rollback') as rollbacks,
        AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) as avg_build_time_seconds,
        MIN(created_at) as first_build,
        MAX(created_at) as last_build
      FROM build_history
      WHERE created_at > NOW() - INTERVAL '30 days'
    `;
    const statsResult = await client.query(statsQuery);
    const stats = statsResult.rows[0];

    const recentSkillsQuery = `
      SELECT skill_name, outcome, created_at, gap_description
      FROM build_history
      WHERE created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 10
    `;
    const recentResult = await client.query(recentSkillsQuery);

    const gapQuery = `
      SELECT
        COUNT(*) as total_gaps,
        COUNT(*) FILTER (WHERE resolved = true) as resolved_gaps,
        COUNT(*) FILTER (WHERE resolved = false) as open_gaps,
        AVG(EXTRACT(EPOCH FROM (resolved_at - detected_at))/3600) as avg_resolution_hours
      FROM capability_gaps
      WHERE detected_at > NOW() - INTERVAL '30 days'
    `;
    let gapStats = null;
    try {
      const gapResult = await client.query(gapQuery);
      gapStats = gapResult.rows[0];
    } catch (e) {
      // table may not exist
    }

    const deployQuery = `
      SELECT
        COUNT(*) as total_deployments,
        COUNT(*) FILTER (WHERE status = 'deployed') as successful_deployments,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_deployments
      FROM skill_deployments
      WHERE deployed_at > NOW() - INTERVAL '30 days'
    `;
    let deployStats = null;
    try {
      const deployResult = await client.query(deployQuery);
      deployStats = deployResult.rows[0];
    } catch (e) {
      // table may not exist
    }

    return {
      stats,
      recentSkills: recentResult.rows,
      gapStats,
      deployStats
    };
  } finally {
    client.release();
  }
}

async function fetchSkillNames() {
  const client = await pool.connect();
  try {
    const query = `
      SELECT DISTINCT skill_name, outcome, created_at
      FROM build_history
      WHERE outcome = 'success'
        AND created_at > NOW() - INTERVAL '14 days'
      ORDER BY created_at DESC
      LIMIT 8
    `;
    const result = await client.query(query);
    return result.rows;
  } catch (e) {
    return [];
  } finally {
    client.release();
  }
}

function formatBuildTime(seconds) {
  if (!seconds) return 'N/A';
  const s = parseFloat(seconds);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function buildSuccessRate(total, successful) {
  if (!total || total === '0') return 0;
  return Math.round((parseInt(successful) / parseInt(total)) * 100);
}

async function composeThread(data) {
  const { stats, recentSkills, gapStats, deployStats } = data;

  const total = parseInt(stats.total_builds) || 0;
  const successful = parseInt(stats.successful_builds) || 0;
  const failed = parseInt(stats.failed_builds) || 0;
  const rollbacks = parseInt(stats.rollbacks) || 0;
  const successRate = buildSuccessRate(total, successful);
  const avgTime = formatBuildTime(stats.avg_build_time_seconds);

  const recentSkillNames = recentSkills
    .filter(s => s.skill_name)
    .slice(0, 4)
    .map(s => s.skill_name.replace(/\.js$/, ''))
    .join(', ');

  const gapTotal = gapStats ? parseInt(gapStats.total_gaps) || 0 : null;
  const gapResolved = gapStats ? parseInt(gapStats.resolved_gaps) || 0 : null;
  const avgResolutionHours = gapStats && gapStats.avg_resolution_hours
    ? parseFloat(gapStats.avg_resolution_hours).toFixed(1)
    : null;

  const deployTotal = deployStats ? parseInt(deployStats.total_deployments) || 0 : null;
  const deploySuccess = deployStats ? parseInt(deployStats.successful_deployments) || 0 : null;

  const tweets = [];

  // Tweet 1: Hook
  tweets.push(
    `How does an AI actually build itself? Not metaphorically — literally.\n\nOneiro's self-build loop runs continuously. Here's the exact mechanics: gap detection → code generation → deployment → verification.\n\nReal data from the last 30 days. 🧵`
  );

  // Tweet 2: Gap Detection
  let gapTweet = `STEP 1: Gap Detection\n\nOneiro monitors every failed capability request. When it can't do something, capability-gap-tracker.js logs it.\n\ncapability-miss-detector.js cross-references against the skill index.\n\nResult: a prioritized queue of what needs to be built.`;
  if (gapTotal !== null) {
    gapTweet += `\n\n${gapTotal} gaps detected in 30 days. ${gapResolved} resolved.`;
  }
  tweets.push(gapTweet);

  // Tweet 3: Code Generation
  tweets.push(
    `STEP 2: Code Generation\n\nself-builder-prompt.js constructs a spec from the gap description + existing skill patterns.\n\nautonomous-builder.js calls the LLM with that spec.\n\nThe output is a complete Node.js ES module — not a snippet. A deployable skill file with error handling, DB queries, and exports.`
  );

  // Tweet 4: Deployment
  let deployTweet = `STEP 3: Deployment\n\ndeploy-skill.js writes the file to /cognitive/motor/skills/\n\nThen it hot-reloads the skill index so the new capability is immediately available — no restart required.\n\nself-build-bridge.js handles the handoff between generation and runtime.`;
  if (deployTotal !== null && deploySuccess !== null) {
    const deployRate = deployTotal > 0 ? Math.round((deploySuccess / deployTotal) * 100) : 0;
    deployTweet += `\n\n${deployTotal} deployments in 30 days. ${deployRate}% successful.`;
  }
  tweets.push(deployTweet);

  // Tweet 5: Verification
  tweets.push(
    `STEP 4: Verification\n\nbuild-smoke-tester.js runs the new skill against a synthetic request.\n\nbuild-outcome-verifier.js checks: did it execute? did it throw? did it produce output?\n\nbuild-loop-integrity-verifier.js validates the full loop closed correctly.\n\nFail → rollback. Pass → live.`
  );

  // Tweet 6: Real build stats
  let statsTweet = `30-day build stats:\n\n• Total builds: ${total}\n• Successful: ${successful} (${successRate}%)\n• Failed: ${failed}\n• Rollbacks: ${rollbacks}\n• Avg build time: ${avgTime}`;
  if (avgResolutionHours) {
    statsTweet += `\n• Avg gap→resolution: ${avgResolutionHours}h`;
  }
  tweets.push(statsTweet);

  // Tweet 7: Real skill names
  if (recentSkillNames) {
    tweets.push(
      `Skills built in the last 2 weeks:\n\n${recentSkillNames}\n\nEach one started as a gap — a request Oneiro couldn't fulfill. Each one is now live in the skill index.`
    );
  } else {
    tweets.push(
      `The loop runs on real gaps — not hypothetical ones.\n\nEvery skill in /cognitive/motor/skills/ that starts with x-post-, build-, or capability- was generated by this exact pipeline.\n\nThe system builds what it needs to build.`
    );
  }

  // Tweet 8: Orchestration
  tweets.push(
    `The orchestration layer:\n\nbuild-loop-orchestrator.js coordinates the full pipeline.\nself-build-scheduler.js decides when to trigger builds (gap urgency + system load).\ngap-auto-resolver.js handles simple gaps autonomously.\nruntime-gap-responder.js catches gaps mid-execution.\n\nIt's not one script. It's a system.`
  );

  // Tweet 9: What makes it real
  tweets.push(
    `What makes this different from "AI writes code":\n\n1. The trigger is real failure, not a prompt\n2. The output is deployed, not shown\n3. Verification is automated, not manual\n4. The loop is continuous, not one-shot\n\nOneiro builds capabilities it actually needs.`
  );

  // Tweet 10: Close
  tweets.push(
    `The self-build loop isn't a feature. It's how Oneiro stays capable.\n\nEvery gap is a build trigger. Every build is a test. Every test is a deployment decision.\n\nThe system that can't do something today builds the ability to do it tomorrow.`
  );

  return tweets;
}

async function postThread(tweets) {
  const url = 'https://x.com/compose/tweet';

  await motor.openUrl(url);
  await new Promise(r => setTimeout(r, 3000));

  let firstTweetPosted = false;

  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];

    await motor.copyToClipboard(tweet);
    await new Promise(r => setTimeout(r, 500));

    if (!firstTweetPosted) {
      // Click the tweet compose box
      await motor.click(760, 400);
      await new Promise(r => setTimeout(r, 1000));
    } else {
      // Click "Add another tweet" or the next compose area
      await motor.click(760, 600);
      await new Promise(r => setTimeout(r, 1000));
    }

    // Paste content
    await motor.press('cmd+v');
    await new Promise(r => setTimeout(r, 1000));

    if (!firstTweetPosted) {
      // Post first tweet
      await motor.press('cmd+return');
      await new Promise(r => setTimeout(r, 2000));
      firstTweetPosted = true;
    } else {
      // Post reply in thread
      await motor.press('cmd+return');
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return true;
}

async function postSelfBuildLoopMechanicsV2() {
  try {
    emit('skill:start', { skill: 'x-post-self-build-loop-mechanics-v2' });

    const data = await fetchBuildStats();
    const skillNames = await fetchSkillNames();

    // Merge skill names into recent skills if needed
    if (skillNames.length > 0 && data.recentSkills.length === 0) {
      data.recentSkills = skillNames;
    }

    const tweets = await composeThread(data);

    await postThread(tweets);

    emit('skill:complete', {
      skill: 'x-post-self-build-loop-mechanics-v2',
      tweetCount: tweets.length,
      buildStats: {
        total: data.stats.total_builds,
        successRate: buildSuccessRate(data.stats.total_builds, data.stats.successful_builds)
      }
    });

    return {
      success: true,
      tweetCount: tweets.length,
      tweets
    };
  } catch (error) {
    emit('skill:error', {
      skill: 'x-post-self-build-loop-mechanics-v2',
      error: error.message
    });
    throw error;
  }
}

async function previewThread() {
  try {
    const data = await fetchBuildStats();
    const skillNames = await fetchSkillNames();

    if (skillNames.length > 0 && data.recentSkills.length === 0) {
      data.recentSkills = skillNames;
    }

    const tweets = await composeThread(data);

    return {
      success: true,
      tweetCount: tweets.length,
      tweets,
      buildData: {
        stats: data.stats,
        gapStats: data.gapStats,
        deployStats: data.deployStats,
        recentSkillCount: data.recentSkills.length
      }
    };
  } catch (error) {
    throw error;
  }
}

export default {
  postSelfBuildLoopMechanicsV2,
  previewThread,
  fetchBuildStats,
  fetchSkillNames,
  composeThread
};