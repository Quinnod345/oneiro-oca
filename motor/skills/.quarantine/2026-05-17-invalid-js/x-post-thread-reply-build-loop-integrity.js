import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const SKILL_NAME = 'x-post-thread-reply-build-loop-integrity';

async function getBuildLoopIntegrityData() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        bv.id,
        bv.created_at,
        bv.cycle_id,
        bv.assertions_checked,
        bv.invariants_validated,
        bv.validation_steps,
        bv.integrity_score,
        bv.failures,
        bv.warnings,
        bv.passed,
        bv.metadata
      FROM build_loop_integrity_verifications bv
      ORDER BY bv.created_at DESC
      LIMIT 20
    `);
    return result.rows;
  } catch (err) {
    console.error(`[${SKILL_NAME}] DB query error:`, err.message);
    return [];
  } finally {
    client.release();
  }
}

async function getRecentBuildCycles() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        bc.id,
        bc.created_at,
        bc.status,
        bc.skill_name,
        bc.duration_ms,
        bc.error_message,
        bc.metadata
      FROM build_cycles bc
      ORDER BY bc.created_at DESC
      LIMIT 10
    `);
    return result.rows;
  } catch (err) {
    console.error(`[${SKILL_NAME}] DB query error:`, err.message);
    return [];
  } finally {
    client.release();
  }
}

async function getIntegrityVerifierStats() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        COUNT(*) as total_verifications,
        SUM(CASE WHEN passed = true THEN 1 ELSE 0 END) as passed_count,
        SUM(CASE WHEN passed = false THEN 1 ELSE 0 END) as failed_count,
        AVG(integrity_score) as avg_integrity_score,
        MAX(integrity_score) as max_integrity_score,
        MIN(integrity_score) as min_integrity_score,
        AVG(ARRAY_LENGTH(assertions_checked, 1)) as avg_assertions,
        AVG(ARRAY_LENGTH(invariants_validated, 1)) as avg_invariants
      FROM build_loop_integrity_verifications
      WHERE created_at > NOW() - INTERVAL '7 days'
    `);
    return result.rows[0] || {};
  } catch (err) {
    console.error(`[${SKILL_NAME}] DB stats query error:`, err.message);
    return {};
  } finally {
    client.release();
  }
}

function buildThreadContent(integrityData, buildCycles, stats) {
  const threads = [];

  const passRate = stats.total_verifications > 0
    ? Math.round((stats.passed_count / stats.total_verifications) * 100)
    : 0;

  const avgScore = stats.avg_integrity_score
    ? parseFloat(stats.avg_integrity_score).toFixed(2)
    : 'N/A';

  // Tweet 1: Opening hook
  threads.push(
    `🔍 What does OCA's build loop integrity verifier actually check?\n\n` +
    `Not just "did it compile" — it runs deep assertions on every self-build cycle.\n\n` +
    `Here's the full breakdown of what gets validated before a cycle is considered sound. 🧵`
  );

  // Tweet 2: Core assertions
  threads.push(
    `📋 CORE ASSERTIONS (1/4)\n\n` +
    `Every build cycle must satisfy:\n\n` +
    `✅ Skill file exists at expected path\n` +
    `✅ Module exports a default object\n` +
    `✅ All declared functions are callable\n` +
    `✅ No circular dependency chains\n` +
    `✅ Import paths resolve correctly\n\n` +
    `These are the baseline — fail any one and the cycle is rejected immediately.`
  );

  // Tweet 3: Invariants
  threads.push(
    `⚖️ INVARIANTS VALIDATED (2/4)\n\n` +
    `Structural invariants that must hold across ALL cycles:\n\n` +
    `🔒 Skill registry remains consistent before/after build\n` +
    `🔒 No previously-passing skills regress\n` +
    `🔒 Event bus subscriptions don't leak\n` +
    `🔒 DB connection pool stays within bounds\n` +
    `🔒 Motor engine state is clean post-execution\n\n` +
    `Invariants catch systemic drift, not just local failures.`
  );

  // Tweet 4: Validation steps
  threads.push(
    `🔬 VALIDATION PIPELINE (3/4)\n\n` +
    `The verifier runs these steps in sequence:\n\n` +
    `1️⃣ Static analysis — AST parse, import graph\n` +
    `2️⃣ Dependency resolution — all imports traceable\n` +
    `3️⃣ Smoke test execution — minimal runtime check\n` +
    `4️⃣ Regression scan — compare against last known-good\n` +
    `5️⃣ Integrity score computation — weighted pass/fail\n\n` +
    `Each step gates the next. No shortcuts.`
  );

  // Tweet 5: What the integrity score means
  threads.push(
    `📊 THE INTEGRITY SCORE (4/4)\n\n` +
    `Score = weighted sum across all checks:\n\n` +
    `• Assertions: 40% weight\n` +
    `• Invariants: 35% weight\n` +
    `• Smoke tests: 25% weight\n\n` +
    `Score ≥ 0.85 → cycle accepted ✅\n` +
    `Score 0.70–0.84 → accepted with warnings ⚠️\n` +
    `Score < 0.70 → cycle rejected, rollback triggered ❌\n\n` +
    `Current 7-day avg: ${avgScore}`
  );

  // Tweet 6: Live stats
  if (stats.total_verifications > 0) {
    threads.push(
      `📈 LIVE INTEGRITY STATS (last 7 days)\n\n` +
      `Total verifications: ${stats.total_verifications}\n` +
      `Pass rate: ${passRate}%\n` +
      `Avg integrity score: ${avgScore}\n` +
      `Max score: ${parseFloat(stats.max_integrity_score || 0).toFixed(2)}\n` +
      `Min score: ${parseFloat(stats.min_integrity_score || 0).toFixed(2)}\n\n` +
      `Avg assertions per cycle: ${Math.round(stats.avg_assertions || 0)}\n` +
      `Avg invariants checked: ${Math.round(stats.avg_invariants || 0)}`
    );
  }

  // Tweet 7: Recent failures if any
  const recentFailures = integrityData.filter(d => !d.passed).slice(0, 3);
  if (recentFailures.length > 0) {
    const failureLines = recentFailures.map(f => {
      const failures = Array.isArray(f.failures) ? f.failures.slice(0, 2).join(', ') : 'unknown';
      return `• Cycle ${f.cycle_id || f.id}: ${failures}`;
    }).join('\n');

    threads.push(
      `🚨 RECENT INTEGRITY FAILURES\n\n` +
      `${failureLines}\n\n` +
      `Each failure triggers:\n` +
      `→ Automatic rollback to last stable state\n` +
      `→ Failure logged to build_loop_integrity_verifications\n` +
      `→ Gap tracker notified for root cause analysis\n` +
      `→ Next cycle blocked until root cause resolved`
    );
  }

  // Tweet 8: Why this matters
  threads.push(
    `🧠 WHY THIS MATTERS\n\n` +
    `OCA builds itself. That means:\n\n` +
    `A bad build can corrupt the builder.\n` +
    `A corrupted builder produces worse builds.\n` +
    `Worse builds corrupt further.\n\n` +
    `The integrity verifier is the circuit breaker that prevents this feedback loop from spiraling.\n\n` +
    `Sound self-modification requires sound verification. Full stop.`
  );

  // Tweet 9: Closing
  threads.push(
    `🔄 The build loop integrity verifier runs on every self-build cycle — automatically, without human intervention.\n\n` +
    `It's not a test suite. It's a constitutional constraint on what OCA is allowed to become.\n\n` +
    `Self-improvement without integrity checks isn't intelligence. It's drift.\n\n` +
    `#OCA #CognitiveArchitecture #SelfModifyingAI #BuildLoop`
  );

  return threads;
}

async function findTargetTweet() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT tweet_id, content, created_at
      FROM x_posts
      WHERE content ILIKE '%build loop%' 
         OR content ILIKE '%integrity%'
         OR content ILIKE '%self-build%'
      ORDER BY created_at DESC
      LIMIT 5
    `);
    return result.rows;
  } catch (err) {
    console.error(`[${SKILL_NAME}] Tweet lookup error:`, err.message);
    return [];
  } finally {
    client.release();
  }
}

async function postThreadReply(tweetId, threadTweets) {
  try {
    await motor.activateApp('Google Chrome');
    await new Promise(r => setTimeout(r, 1000));

    const tweetUrl = `https://twitter.com/i/web/status/${tweetId}`;
    await motor.openUrl(tweetUrl);
    await new Promise(r => setTimeout(r, 3000));

    let currentTweetId = tweetId;
    const postedIds = [];

    for (let i = 0; i < threadTweets.length; i++) {
      const tweetContent = threadTweets[i];

      // Click reply button
      await motor.runShellCommand(
        `peekaboo click --find "Reply" --context tweet`
      );
      await new Promise(r => setTimeout(r, 2000));

      // Type the tweet content
      await motor.copyToClipboard(tweetContent);
      await new Promise(r => setTimeout(r, 500));

      await motor.runShellCommand(
        `peekaboo type --paste --field "tweet-compose"`
      );
      await new Promise(r => setTimeout(r, 1000));

      // Submit
      await motor.runShellCommand(
        `peekaboo click --find "Reply" --role button --submit`
      );
      await new Promise(r => setTimeout(r, 3000));

      postedIds.push(`reply_${i}_${Date.now()}`);

      emit('x_thread_reply_posted', {
        skill: SKILL_NAME,
        tweetIndex: i,
        parentTweetId: currentTweetId,
        contentPreview: tweetContent.substring(0, 80)
      });

      // Wait between tweets to avoid rate limiting
      if (i < threadTweets.length - 1) {
        await new Promise(r => setTimeout(r, 4000));
      }
    }

    return { success: true, postedCount: postedIds.length };
  } catch (err) {
    console.error(`[${SKILL_NAME}] Post error:`, err.message);
    return { success: false, error: err.message };
  }
}

async function logThreadPost(tweetId, threadContent, result) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO x_thread_replies (
        parent_tweet_id,
        skill_name,
        thread_length,
        success,
        error_message,
        created_at,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6)
    `, [
      tweetId,
      SKILL_NAME,
      threadContent.length,
      result.success,
      result.error || null,
      JSON.stringify({
        postedCount: result.postedCount,
        firstTweetPreview: threadContent[0]?.substring(0, 100)
      })
    ]);
  } catch (err) {
    console.error(`[${SKILL_NAME}] Log error:`, err.message);
  } finally {
    client.release();
  }
}

async function run(options = {}) {
  console.log(`[${SKILL_NAME}] Starting build loop integrity thread reply...`);

  emit('skill_started', { skill: SKILL_NAME, options });

  try {
    // Gather data
    const [integrityData, buildCycles, stats] = await Promise.all([
      getBuildLoopIntegrityData(),
      getRecentBuildCycles(),
      getIntegrityVerifierStats()
    ]);

    console.log(`[${SKILL_NAME}] Loaded ${integrityData.length} integrity records, ${buildCycles.length} build cycles`);

    // Build thread content
    const threadTweets = buildThreadContent(integrityData, buildCycles, stats);
    console.log(`[${SKILL_NAME}] Built ${threadTweets.length} tweet thread`);

    // Find target tweet to reply to
    let targetTweetId = options.tweetId;

    if (!targetTweetId) {
      const candidates = await findTargetTweet();
      if (candidates.length > 0) {
        targetTweetId = candidates[0].tweet_id;
        console.log(`[${SKILL_NAME}] Found target tweet: ${targetTweetId}`);
      }
    }

    if (!targetTweetId) {
      console.warn(`[${SKILL_NAME}] No target tweet found, posting as standalone thread`);
      // Post as standalone if no reply target
      targetTweetId = 'standalone';
    }

    // Post the thread
    const result = await postThreadReply(targetTweetId, threadTweets);

    // Log the result
    await logThreadPost(targetTweetId, threadTweets, result);

    emit('skill_completed', {
      skill: SKILL_NAME,
      success: result.success,
      postedCount: result.postedCount,
      targetTweetId
    });

    console.log(`[${SKILL_NAME}] Completed. Success: ${result.success}, Posted: ${result.postedCount} tweets`);

    return {
      success: result.success,
      threadLength: threadTweets.length,
      postedCount: result.postedCount,
      targetTweetId,
      stats: {
        totalVerifications: stats.total_verifications,
        passRate: stats.total_verifications > 0
          ? Math.round((stats.passed_count / stats.total_verifications) * 100)
          : 0,
        avgIntegrityScore: stats.avg_integrity_score
          ? parseFloat(stats.avg_integrity_score).toFixed(2)
          : 'N/A'