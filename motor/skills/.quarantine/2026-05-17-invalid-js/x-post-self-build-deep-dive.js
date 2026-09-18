import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

async function fetchBuildHistory() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        id,
        capability_name,
        status,
        error_message,
        created_at,
        completed_at,
        attempt_number,
        gap_type,
        code_generated,
        verification_passed,
        smoke_test_passed,
        deploy_succeeded,
        failure_stage,
        retry_count
      FROM build_history
      ORDER BY created_at DESC
      LIMIT 500
    `);
    return result.rows;
  } finally {
    client.release();
  }
}

async function fetchCapabilityGaps() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        gap_type,
        capability_name,
        detected_at,
        resolved_at,
        resolution_method,
        severity,
        trigger_context
      FROM capability_gaps
      ORDER BY detected_at DESC
      LIMIT 200
    `);
    return result.rows;
  } finally {
    client.release();
  }
}

async function fetchVerificationMetrics() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        verification_type,
        passed,
        failed,
        error_details,
        created_at,
        build_id
      FROM build_verifications
      ORDER BY created_at DESC
      LIMIT 300
    `);
    return result.rows;
  } finally {
    client.release();
  }
}

async function computeDeepDiveMetrics(builds, gaps, verifications) {
  const total = builds.length;
  const succeeded = builds.filter(b => b.status === 'success').length;
  const failed = builds.filter(b => b.status === 'failed').length;
  const inProgress = builds.filter(b => b.status === 'in_progress').length;

  const successRate = total > 0 ? ((succeeded / total) * 100).toFixed(1) : '0.0';
  const failureRate = total > 0 ? ((failed / total) * 100).toFixed(1) : '0.0';

  // Gap detection breakdown
  const gapTypes = {};
  gaps.forEach(g => {
    const type = g.gap_type || 'unknown';
    gapTypes[type] = (gapTypes[type] || 0) + 1;
  });

  const resolvedGaps = gaps.filter(g => g.resolved_at !== null).length;
  const unresolvedGaps = gaps.filter(g => g.resolved_at === null).length;
  const gapResolutionRate = gaps.length > 0 ? ((resolvedGaps / gaps.length) * 100).toFixed(1) : '0.0';

  // Failure stage analysis
  const failureStages = {};
  builds.filter(b => b.status === 'failed').forEach(b => {
    const stage = b.failure_stage || 'unknown';
    failureStages[stage] = (failureStages[stage] || 0) + 1;
  });

  const topFailureStage = Object.entries(failureStages)
    .sort((a, b) => b[1] - a[1])[0];

  // Code generation success
  const codeGenAttempts = builds.filter(b => b.code_generated !== null).length;
  const codeGenSuccesses = builds.filter(b => b.code_generated === true).length;
  const codeGenRate = codeGenAttempts > 0 ? ((codeGenSuccesses / codeGenAttempts) * 100).toFixed(1) : '0.0';

  // Verification pass rates
  const verificationPassed = builds.filter(b => b.verification_passed === true).length;
  const verificationAttempted = builds.filter(b => b.verification_passed !== null).length;
  const verificationRate = verificationAttempted > 0 ? ((verificationPassed / verificationAttempted) * 100).toFixed(1) : '0.0';

  // Smoke test pass rates
  const smokeTestPassed = builds.filter(b => b.smoke_test_passed === true).length;
  const smokeTestAttempted = builds.filter(b => b.smoke_test_passed !== null).length;
  const smokeTestRate = smokeTestAttempted > 0 ? ((smokeTestPassed / smokeTestAttempted) * 100).toFixed(1) : '0.0';

  // Deploy success rate
  const deploySucceeded = builds.filter(b => b.deploy_succeeded === true).length;
  const deployAttempted = builds.filter(b => b.deploy_succeeded !== null).length;
  const deployRate = deployAttempted > 0 ? ((deploySucceeded / deployAttempted) * 100).toFixed(1) : '0.0';

  // Retry analysis
  const buildsWithRetries = builds.filter(b => b.retry_count > 0).length;
  const avgRetries = total > 0 ? (builds.reduce((sum, b) => sum + (b.retry_count || 0), 0) / total).toFixed(2) : '0.00';
  const maxRetries = Math.max(...builds.map(b => b.retry_count || 0));

  // Build duration analysis
  const completedBuilds = builds.filter(b => b.completed_at && b.created_at);
  const durations = completedBuilds.map(b => {
    const start = new Date(b.created_at);
    const end = new Date(b.completed_at);
    return (end - start) / 1000 / 60; // minutes
  });
  const avgDuration = durations.length > 0 ? (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1) : '0.0';
  const maxDuration = durations.length > 0 ? Math.max(...durations).toFixed(1) : '0.0';

  // Recent trend (last 50 builds)
  const recent = builds.slice(0, 50);
  const recentSuccess = recent.filter(b => b.status === 'success').length;
  const recentSuccessRate = recent.length > 0 ? ((recentSuccess / recent.length) * 100).toFixed(1) : '0.0';

  // Verification type breakdown
  const verificationTypes = {};
  verifications.forEach(v => {
    const type = v.verification_type || 'unknown';
    if (!verificationTypes[type]) verificationTypes[type] = { passed: 0, failed: 0 };
    if (v.passed) verificationTypes[type].passed++;
    if (v.failed) verificationTypes[type].failed++;
  });

  // Most common gap types
  const topGapTypes = Object.entries(gapTypes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return {
    total,
    succeeded,
    failed,
    inProgress,
    successRate,
    failureRate,
    gapTypes,
    topGapTypes,
    resolvedGaps,
    unresolvedGaps,
    gapResolutionRate,
    failureStages,
    topFailureStage,
    codeGenRate,
    verificationRate,
    smokeTestRate,
    deployRate,
    buildsWithRetries,
    avgRetries,
    maxRetries,
    avgDuration,
    maxDuration,
    recentSuccessRate,
    verificationTypes,
    totalGaps: gaps.length
  };
}

function buildThreadTweets(metrics) {
  const tweets = [];

  // Tweet 1: Hook
  tweets.push(
    `🧵 Deep dive: How Oneiro builds itself in real-time.\n\n` +
    `The self-build loop isn't magic — it's a 4-stage pipeline with real failure rates, retry logic, and outcome verification.\n\n` +
    `Here's what the data actually shows across ${metrics.total} build attempts. 🔽`
  );

  // Tweet 2: The pipeline overview
  tweets.push(
    `Stage 1: Capability Gap Detection\n\n` +
    `Oneiro monitors its own skill graph continuously. When a task fails due to a missing capability, it logs a gap.\n\n` +
    `📊 ${metrics.totalGaps} gaps detected total\n` +
    `✅ ${metrics.resolvedGaps} resolved (${metrics.gapResolutionRate}%)\n` +
    `⏳ ${metrics.unresolvedGaps} still open\n\n` +
    `Top gap types:\n` +
    metrics.topGapTypes.map(([type, count]) => `• ${type}: ${count}`).join('\n')
  );

  // Tweet 3: Code generation
  tweets.push(
    `Stage 2: Code Generation\n\n` +
    `Once a gap is confirmed, Oneiro generates a new skill module via LLM — with context from existing skills, the event bus schema, and motor engine API.\n\n` +
    `🤖 Code gen success rate: ${metrics.codeGenRate}%\n\n` +
    `Not every prompt produces valid, runnable code. The gap between "generated" and "verified" is where most failures live.`
  );

  // Tweet 4: Verification pipeline
  tweets.push(
    `Stage 3: Outcome Verification\n\n` +
    `Generated code goes through a 3-layer check:\n\n` +
    `1️⃣ Syntax + import validation\n` +
    `2️⃣ Smoke test (does it run without crashing?)\n` +
    `3️⃣ Functional verification (does it do what it claims?)\n\n` +
    `📊 Real pass rates:\n` +
    `• Verification: ${metrics.verificationRate}%\n` +
    `• Smoke test: ${metrics.smokeTestRate}%\n` +
    `• Deploy: ${metrics.deployRate}%`
  );

  // Tweet 5: Failure analysis
  const topStage = metrics.topFailureStage ? metrics.topFailureStage[0] : 'unknown';
  const topStageCount = metrics.topFailureStage ? metrics.topFailureStage[1] : 0;
  tweets.push(
    `Stage 4: Failure Handling\n\n` +
    `${metrics.failureRate}% of builds fail. Here's where they die:\n\n` +
    Object.entries(metrics.failureStages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([stage, count]) => `• ${stage}: ${count} failures`)
      .join('\n') +
    `\n\nBiggest failure point: "${topStage}" (${topStageCount} failures)\n\n` +
    `Failures aren't silent — they emit events that feed back into the gap detector.`
  );

  // Tweet 6: Retry mechanics
  tweets.push(
    `Retry Logic\n\n` +
    `Failed builds don't just die. Oneiro retries with modified prompts and additional context.\n\n` +
    `🔄 Builds with retries: ${metrics.buildsWithRetries}\n` +
    `📊 Avg retries per build: ${metrics.avgRetries}\n` +
    `📈 Max retries on a single build: ${metrics.maxRetries}\n\n` +
    `Each retry includes the previous error message as context — the LLM learns from its own failures within the session.`
  );

  // Tweet 7: Performance metrics
  tweets.push(
    `Build Performance\n\n` +
    `How long does it actually take to go from gap detection to deployed skill?\n\n` +
    `⏱️ Avg build duration: ${metrics.avgDuration} min\n` +
    `🔺 Longest build: ${metrics.maxDuration} min\n\n` +
    `Recent trend (last 50 builds): ${metrics.recentSuccessRate}% success rate\n\n` +
    `The system gets faster as it accumulates context about what works.`
  );

  // Tweet 8: Overall success rate + what it means
  tweets.push(
    `Overall Numbers\n\n` +
    `📊 Total build attempts: ${metrics.total}\n` +
    `✅ Succeeded: ${metrics.succeeded} (${metrics.successRate}%)\n` +
    `❌ Failed: ${metrics.failed} (${metrics.failureRate}%)\n` +
    `🔄 In progress: ${metrics.inProgress}\n\n` +
    `A ${metrics.successRate}% success rate on autonomous code generation is not a bug — it's the baseline. The loop is designed to handle failure, not avoid it.`
  );

  // Tweet 9: What makes this different
  tweets.push(
    `What makes Oneiro's self-build loop different:\n\n` +
    `1. It detects its own gaps from real task failures\n` +
    `2. It generates code with full architectural context\n` +
    `3. It verifies outcomes before deploying\n` +
    `4. Failed builds feed back into the next attempt\n` +
    `5. All of this runs without human intervention\n\n` +
    `The loop closes on itself. That's the point.`
  );

  // Tweet 10: Closing
  tweets.push(
    `This is what autonomous capability growth looks like at the infrastructure level.\n\n` +
    `Not a demo. Not a prototype. ${metrics.total} real build attempts, real failure rates, real deployed skills.\n\n` +
    `The self-build loop is the core of what makes Oneiro different from a static AI assistant.\n\n` +
    `More data drops coming. 🧠`
  );

  return tweets;
}

async function postThreadViaPerekaboo(tweets) {
  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];
    await motor.copyToClipboard(tweet);

    const cmd = i === 0
      ? `peekaboo type --text ${JSON.stringify(tweet)} --app "Safari"`
      : `peekaboo type --text ${JSON.stringify(tweet)} --app "Safari"`;

    await motor.runShellCommand(cmd);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

async function postThreadViaBrowser(tweets) {
  await motor.openUrl('https://x.com/compose/tweet');
  await new Promise(resolve => setTimeout(resolve, 3000));

  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];

    await motor.copyToClipboard(tweet);
    await motor.press('cmd+v');
    await new Promise(resolve => setTimeout(resolve, 1500));

    if (i < tweets.length - 1) {
      // Add tweet to thread
      await motor.runShellCommand(
        `osascript -e 'tell application "System Events" to keystroke return using {command down, shift down}'`
      );
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  // Post the thread
  await motor.runShellCommand(
    `osascript -e 'tell application "System Events" to keystroke return using {command down}'`
  );
  await new Promise(resolve => setTimeout(resolve,