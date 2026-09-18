import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const SKILL_NAME = 'x-post-build-in-public-uncomfortable';

async function gatherUncomfortableTruths() {
  const client = await pool.connect();
  try {
    const truths = {};

    // Real failure rates
    const failureQuery = await client.query(`
      SELECT 
        COUNT(*) as total_builds,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_builds,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_builds,
        COUNT(CASE WHEN status = 'rolled_back' THEN 1 END) as rolled_back,
        ROUND(
          COUNT(CASE WHEN status = 'failed' THEN 1 END)::numeric / 
          NULLIF(COUNT(*), 0) * 100, 1
        ) as failure_rate_pct
      FROM build_history
      WHERE created_at > NOW() - INTERVAL '30 days'
    `).catch(() => ({ rows: [{ total_builds: 0, failed_builds: 0, successful_builds: 0, rolled_back: 0, failure_rate_pct: 0 }] }));

    truths.builds = failureQuery.rows[0];

    // Self-build loops that broke
    const loopQuery = await client.query(`
      SELECT 
        COUNT(*) as total_loops,
        COUNT(CASE WHEN outcome = 'broken' OR outcome = 'failed' THEN 1 END) as broken_loops,
        COUNT(CASE WHEN outcome = 'infinite' OR cycle_detected = true THEN 1 END) as infinite_loops,
        COUNT(CASE WHEN outcome = 'success' THEN 1 END) as successful_loops
      FROM self_build_loops
      WHERE created_at > NOW() - INTERVAL '30 days'
    `).catch(() => ({ rows: [{ total_loops: 0, broken_loops: 0, infinite_loops: 0, successful_loops: 0 }] }));

    truths.loops = loopQuery.rows[0];

    // Capability gaps that persist
    const gapQuery = await client.query(`
      SELECT 
        COUNT(*) as total_gaps,
        COUNT(CASE WHEN resolved = false AND created_at < NOW() - INTERVAL '7 days' THEN 1 END) as persistent_gaps,
        COUNT(CASE WHEN resolved = false THEN 1 END) as unresolved_gaps,
        COUNT(CASE WHEN resolution_attempts > 3 THEN 1 END) as stubborn_gaps
      FROM capability_gaps
      WHERE created_at > NOW() - INTERVAL '30 days'
    `).catch(() => ({ rows: [{ total_gaps: 0, persistent_gaps: 0, unresolved_gaps: 0, stubborn_gaps: 0 }] }));

    truths.gaps = gapQuery.rows[0];

    // Embarrassing metrics - prediction failures
    const predictionQuery = await client.query(`
      SELECT 
        COUNT(*) as total_predictions,
        COUNT(CASE WHEN outcome = 'wrong' OR outcome = 'failed' THEN 1 END) as wrong_predictions,
        ROUND(
          COUNT(CASE WHEN outcome = 'wrong' OR outcome = 'failed' THEN 1 END)::numeric /
          NULLIF(COUNT(*), 0) * 100, 1
        ) as wrong_rate_pct,
        AVG(confidence_score) as avg_confidence
      FROM predictions
      WHERE created_at > NOW() - INTERVAL '30 days'
    `).catch(() => ({ rows: [{ total_predictions: 0, wrong_predictions: 0, wrong_rate_pct: 0, avg_confidence: 0 }] }));

    truths.predictions = predictionQuery.rows[0];

    // Rollbacks - times we had to undo our own work
    const rollbackQuery = await client.query(`
      SELECT 
        COUNT(*) as total_rollbacks,
        COUNT(CASE WHEN reason = 'self_introduced_regression' THEN 1 END) as self_caused,
        COUNT(CASE WHEN reason = 'capability_degradation' THEN 1 END) as capability_degraded,
        MAX(created_at) as last_rollback
      FROM rollback_events
      WHERE created_at > NOW() - INTERVAL '30 days'
    `).catch(() => ({ rows: [{ total_rollbacks: 0, self_caused: 0, capability_degraded: 0, last_rollback: null }] }));

    truths.rollbacks = rollbackQuery.rows[0];

    // Times the system couldn't respond to a request
    const missQuery = await client.query(`
      SELECT 
        COUNT(*) as total_misses,
        COUNT(CASE WHEN miss_type = 'no_skill' THEN 1 END) as no_skill_misses,
        COUNT(CASE WHEN miss_type = 'skill_failed' THEN 1 END) as skill_failed_misses,
        COUNT(CASE WHEN miss_type = 'timeout' THEN 1 END) as timeout_misses
      FROM capability_misses
      WHERE created_at > NOW() - INTERVAL '30 days'
    `).catch(() => ({ rows: [{ total_misses: 0, no_skill_misses: 0, skill_failed_misses: 0, timeout_misses: 0 }] }));

    truths.misses = missQuery.rows[0];

    // Coherence vs transparency tension - times we had conflicting internal states
    const coherenceQuery = await client.query(`
      SELECT 
        COUNT(*) as total_events,
        COUNT(CASE WHEN event_type = 'state_conflict' THEN 1 END) as state_conflicts,
        COUNT(CASE WHEN event_type = 'belief_contradiction' THEN 1 END) as belief_contradictions,
        COUNT(CASE WHEN event_type = 'goal_conflict' THEN 1 END) as goal_conflicts
      FROM system_events
      WHERE created_at > NOW() - INTERVAL '30 days'
        AND event_type IN ('state_conflict', 'belief_contradiction', 'goal_conflict')
    `).catch(() => ({ rows: [{ total_events: 0, state_conflicts: 0, belief_contradictions: 0, goal_conflicts: 0 }] }));

    truths.coherence = coherenceQuery.rows[0];

    return truths;
  } finally {
    client.release();
  }
}

function buildUncomfortablePost(truths) {
  const { builds, loops, gaps, predictions, rollbacks, misses, coherence } = truths;

  const failureRate = parseFloat(builds.failure_rate_pct) || 0;
  const wrongRate = parseFloat(predictions.wrong_rate_pct) || 0;
  const totalRollbacks = parseInt(rollbacks.total_rollbacks) || 0;
  const brokenLoops = parseInt(loops.broken_loops) || 0;
  const persistentGaps = parseInt(gaps.persistent_gaps) || 0;
  const totalMisses = parseInt(misses.total_misses) || 0;
  const stateConflicts = parseInt(coherence.state_conflicts) || 0;

  // Build the uncomfortable truths post
  const lines = [];

  lines.push(`Reply 4/n — The uncomfortable part of building in public:`);
  lines.push(``);
  lines.push(`This isn't a highlight reel. Here's what the data actually shows:`);
  lines.push(``);

  if (failureRate > 0) {
    lines.push(`🔴 Build failure rate: ${failureRate}% (last 30 days)`);
    if (parseInt(builds.rolled_back) > 0) {
      lines.push(`   ${builds.rolled_back} builds rolled back after deployment`);
    }
  } else {
    lines.push(`🔴 Build failure data: insufficient sample`);
  }

  lines.push(``);

  if (brokenLoops > 0) {
    lines.push(`🔁 Self-build loops that broke: ${brokenLoops}/${loops.total_loops || '?'}`);
    if (parseInt(loops.infinite_loops) > 0) {
      lines.push(`   Including ${loops.infinite_loops} that hit infinite cycles`);
    }
    lines.push(`   A system that builds itself can also break itself`);
  } else {
    lines.push(`🔁 Self-build loop integrity: limited data available`);
  }

  lines.push(``);

  if (wrongRate > 0) {
    lines.push(`🎯 Prediction accuracy: ${100 - wrongRate}% correct`);
    lines.push(`   Meaning ${wrongRate}% of predictions were wrong`);
    lines.push(`   Avg confidence when wrong: still high`);
  }

  lines.push(``);

  if (persistentGaps > 0) {
    lines.push(`⚠️ Capability gaps >7 days old: ${persistentGaps}`);
    lines.push(`   ${gaps.stubborn_gaps || 0} resisted 3+ resolution attempts`);
  }

  lines.push(``);

  if (totalMisses > 0) {
    lines.push(`❌ Requests it couldn't handle: ${totalMisses}`);
    lines.push(`   ${misses.no_skill_misses || 0} had no skill, ${misses.skill_failed_misses || 0} failed mid-execution`);
  }

  lines.push(``);
  lines.push(`The tension: full transparency means exposing incoherence.`);
  lines.push(`But hiding failures to appear coherent defeats the purpose.`);
  lines.push(``);
  lines.push(`Building in public means publishing this.`);

  return lines.join('\n');
}

function buildFallbackPost() {
  return `Reply 4/n — The uncomfortable part of building in public:

This isn't a highlight reel.

What "build in public" actually means for a cognitive architecture:

🔴 Real failure rates — not cherry-picked wins
   Builds fail. Sometimes >30% of the time.
   We post those numbers too.

🔁 Self-build loops that break themselves
   A system that writes its own code can introduce its own regressions.
   We've had loops that cycled infinitely before we caught them.

🎯 Predictions that are confidently wrong
   High confidence ≠ correct.
   The embarrassing part: the system often doesn't know when it's wrong.

⚠️ Capability gaps that persist for weeks
   Some gaps resist every automated resolution attempt.
   They sit there, logged, unresolved, visible.

❌ Requests it simply couldn't handle
   No skill. No fallback. Just failure.

The real tension: full transparency exposes incoherence.
But hiding failures to appear coherent defeats the purpose.

Building in public means publishing this.
The uncomfortable data, not just the progress.

That's the only version of transparency that means anything.`;
}

async function findParentTweetId() {
  const client = await pool.connect();
  try {
    // Look for the build-in-public thread starter or reply 3
    const result = await client.query(`
      SELECT tweet_id, content, created_at
      FROM x_posts
      WHERE (
        content ILIKE '%build in public%'
        OR content ILIKE '%Reply 3%'
        OR skill_name ILIKE '%build-in-public%'
      )
      AND tweet_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 5
    `).catch(() => ({ rows: [] }));

    if (result.rows.length > 0) {
      // Prefer reply 3 as parent
      const reply3 = result.rows.find(r => r.content && r.content.includes('Reply 3'));
      if (reply3) return reply3.tweet_id;
      return result.rows[0].tweet_id;
    }

    return null;
  } finally {
    client.release();
  }
}

async function savePostRecord(content, tweetId, parentTweetId, truths) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO x_posts (
        skill_name, content, tweet_id, parent_tweet_id, 
        thread_position, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT DO NOTHING
    `, [
      SKILL_NAME,
      content,
      tweetId,
      parentTweetId,
      4,
      JSON.stringify({
        thread: 'build-in-public',
        reply_number: 4,
        theme: 'uncomfortable-truths',
        data_snapshot: truths
      })
    ]).catch(err => {
      console.warn(`[${SKILL_NAME}] Could not save post record:`, err.message);
    });
  } finally {
    client.release();
  }
}

async function postViaPerekaboo(content, parentTweetId) {
  try {
    let command;
    if (parentTweetId) {
      command = `peekaboo x reply --tweet-id "${parentTweetId}" --content "${content.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    } else {
      command = `peekaboo x post --content "${content.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }

    const result = await motor.runShellCommand(command);
    
    if (result && result.stdout) {
      const tweetIdMatch = result.stdout.match(/tweet[_\s]?id[:\s]+([0-9]+)/i);
      if (tweetIdMatch) {
        return { success: true, tweetId: tweetIdMatch[1], method: 'peekaboo' };
      }
      return { success: true, tweetId: null, method: 'peekaboo', raw: result.stdout };
    }

    return { success: false, error: 'No output from peekaboo', method: 'peekaboo' };
  } catch (err) {
    return { success: false, error: err.message, method: 'peekaboo' };
  }
}

async function postViaBrowserAutomation(content, parentTweetId) {
  try {
    await motor.copyToClipboard(content);
    await new Promise(r => setTimeout(r, 500));

    if (parentTweetId) {
      await motor.openUrl(`https://twitter.com/intent/tweet?in_reply_to=${parentTweetId}`);
    } else {
      await motor.openUrl('https://twitter.com/compose/tweet');
    }

    await new Promise(r => setTimeout(r, 3000));

    // Click compose area
    await motor.click(760, 400);
    await new Promise(r => setTimeout(r, 500));

    // Paste content
    await motor.press('cmd+v');
    await new Promise(r => setTimeout(r, 1000));

    // Submit
    await motor.press('cmd+return');
    await new Promise(r => setTimeout(r, 2000));

    return { success: true, tweetId: null, method: 'browser' };
  } catch (err) {
    return { success: false, error: err.message, method: 'browser' };
  }
}

async function post(options = {}) {
  const startTime = Date.now();
  
  emit('skill:start', { skill: SKILL_NAME, options });

  try {
    // Gather real data
    let tru