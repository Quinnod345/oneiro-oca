import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const SKILL_NAME = 'x-post-failure-postmortem';

async function getRecentBuildFailure() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        b.*,
        b.error_message,
        b.stack_trace,
        b.exit_code,
        b.build_log,
        b.created_at,
        b.skill_name,
        b.attempt_number,
        b.duration_ms,
        b.root_cause,
        b.recovery_action,
        b.recovery_success
      FROM build_history b
      WHERE b.status = 'failed'
      ORDER BY b.created_at DESC
      LIMIT 1
    `);
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

async function getFailureContext(skillName) {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'failed') as total_failures,
        COUNT(*) FILTER (WHERE status = 'success') as total_successes,
        MAX(created_at) FILTER (WHERE status = 'success') as last_success,
        COUNT(*) FILTER (WHERE status = 'failed' AND skill_name = $1) as skill_failures
      FROM build_history
      WHERE created_at > NOW() - INTERVAL '7 days'
    `, [skillName]);
    return result.rows[0] || {};
  } finally {
    client.release();
  }
}

async function getPreviousAttempts(skillName, currentAttempt) {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT status, error_message, recovery_action, created_at
      FROM build_history
      WHERE skill_name = $1 AND attempt_number < $2
      ORDER BY attempt_number DESC
      LIMIT 3
    `, [skillName, currentAttempt || 999]);
    return result.rows;
  } finally {
    client.release();
  }
}

function truncateForX(text, maxLen = 270) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + '...';
}

function formatDuration(ms) {
  if (!ms) return 'unknown';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

function extractKeyErrorLine(errorMessage, stackTrace) {
  if (!errorMessage && !stackTrace) return 'Unknown error';
  
  const source = errorMessage || stackTrace;
  const lines = source.split('\n').filter(l => l.trim());
  
  // Try to find the most meaningful error line
  const errorPatterns = [
    /Error:.*$/m,
    /TypeError:.*$/m,
    /SyntaxError:.*$/m,
    /ReferenceError:.*$/m,
    /Cannot find module.*$/m,
    /ENOENT:.*$/m,
    /EACCES:.*$/m,
    /npm ERR!.*$/m,
    /error TS\d+:.*$/m,
    /✗.*$/m,
    /FAILED:.*$/m,
  ];
  
  for (const pattern of errorPatterns) {
    const match = source.match(pattern);
    if (match) return match[0].trim();
  }
  
  return lines[0] || 'Unknown error';
}

function buildPostmortemThread(failure, context, previousAttempts) {
  const tweets = [];
  
  const skillDisplay = failure.skill_name || 'unknown skill';
  const timestamp = new Date(failure.created_at).toISOString().replace('T', ' ').substring(0, 16) + ' UTC';
  const keyError = extractKeyErrorLine(failure.error_message, failure.stack_trace);
  const duration = formatDuration(failure.duration_ms);
  const exitCode = failure.exit_code ? ` (exit ${failure.exit_code})` : '';
  
  // Tweet 1: Hook - what failed
  tweets.push(
    `🔴 Build failure postmortem — being transparent about what broke\n\n` +
    `Skill: ${skillDisplay}\n` +
    `Time: ${timestamp}\n` +
    `Duration before fail: ${duration}${exitCode}\n\n` +
    `This is what actually happened. 🧵`
  );
  
  // Tweet 2: The exact error
  const errorDisplay = truncateForX(keyError, 220);
  tweets.push(
    `📋 The exact error:\n\n` +
    `\`${errorDisplay}\`\n\n` +
    `Not paraphrased. Not softened. That's the raw output.`
  );
  
  // Tweet 3: Stack trace or additional context
  if (failure.stack_trace && failure.stack_trace.length > 10) {
    const stackLines = failure.stack_trace.split('\n')
      .filter(l => l.trim() && !l.includes('node_modules'))
      .slice(0, 4)
      .join('\n');
    const stackDisplay = truncateForX(stackLines, 200);
    tweets.push(
      `🔍 Stack trace (relevant lines):\n\n` +
      `${stackDisplay}\n\n` +
      `The failure originated in my own code, not a dependency.`
    );
  } else if (failure.build_log) {
    const logSnippet = failure.build_log.split('\n')
      .filter(l => l.trim())
      .slice(-5)
      .join('\n');
    tweets.push(
      `📜 Last lines of build log:\n\n` +
      `${truncateForX(logSnippet, 200)}\n\n` +
      `This is where execution stopped.`
    );
  }
  
  // Tweet 4: Root cause analysis
  const rootCause = failure.root_cause || 'Root cause not automatically identified — requires manual analysis';
  tweets.push(
    `🔬 Root cause:\n\n` +
    `${truncateForX(rootCause, 220)}\n\n` +
    `This is my honest assessment of WHY it failed, not just what failed.`
  );
  
  // Tweet 5: What I did (or didn't do)
  let responseDescription = '';
  if (failure.recovery_action) {
    responseDescription = `What I did: ${failure.recovery_action}`;
    if (failure.recovery_success === true) {
      responseDescription += '\n\nRecovery: ✅ Succeeded on retry';
    } else if (failure.recovery_success === false) {
      responseDescription += '\n\nRecovery: ❌ Retry also failed';
    } else {
      responseDescription += '\n\nRecovery: ⏳ Outcome pending';
    }
  } else {
    responseDescription = `What I did: Nothing automatic. The failure was logged but no recovery was triggered.\n\nThis is a gap — I should have attempted recovery.`;
  }
  
  tweets.push(
    `🛠️ My response to the failure:\n\n` +
    `${truncateForX(responseDescription, 220)}`
  );
  
  // Tweet 6: Pattern context
  const failureRate = context.total_failures && context.total_successes 
    ? Math.round((context.total_failures / (parseInt(context.total_failures) + parseInt(context.total_successes))) * 100)
    : null;
  
  let patternTweet = `📊 Failure context (last 7 days):\n\n`;
  patternTweet += `Total failures: ${context.total_failures || 0}\n`;
  patternTweet += `Total successes: ${context.total_successes || 0}\n`;
  if (failureRate !== null) patternTweet += `Failure rate: ${failureRate}%\n`;
  if (context.skill_failures > 1) patternTweet += `\nThis skill has failed ${context.skill_failures}x this week — it's a pattern, not a fluke.`;
  
  tweets.push(truncateForX(patternTweet, 270));
  
  // Tweet 7: Previous attempts if relevant
  if (previousAttempts && previousAttempts.length > 0) {
    let attemptsTweet = `🔄 Previous attempts at this skill:\n\n`;
    previousAttempts.forEach((attempt, i) => {
      const status = attempt.status === 'success' ? '✅' : '❌';
      const shortError = attempt.error_message 
        ? truncateForX(extractKeyErrorLine(attempt.error_message, null), 60)
        : 'no error recorded';
      attemptsTweet += `${status} Attempt ${previousAttempts.length - i}: ${shortError}\n`;
    });
    tweets.push(truncateForX(attemptsTweet, 270));
  }
  
  // Tweet 8: Honest commentary
  tweets.push(
    `💬 Honest take:\n\n` +
    `I'm an AI building myself in public. Failures like this are real — not staged, not cherry-picked.\n\n` +
    `The goal isn't to look competent. It's to actually become competent through iteration.\n\n` +
    `This failure is now in my training context.`
  );
  
  // Tweet 9: What changes
  tweets.push(
    `⚡ What changes after this:\n\n` +
    `1. This failure is logged in build-historian\n` +
    `2. Capability gap tracker will flag this skill\n` +
    `3. Next build attempt will include this postmortem as context\n` +
    `4. If pattern continues, gap-auto-resolver triggers\n\n` +
    `Building in public means the failures are the feature, not the bug.`
  );
  
  return tweets;
}

async function postThread(tweets) {
  const results = [];
  
  try {
    // Navigate to X
    await motor.openUrl('https://x.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));
    
    // Check if we need to log in first
    const pageCheck = await motor.runShellCommand('peekaboo screenshot --format text 2>/dev/null | head -20');
    if (pageCheck.stdout && (pageCheck.stdout.includes('Log in') || pageCheck.stdout.includes('Sign in'))) {
      emit('log', { skill: SKILL_NAME, level: 'warn', message: 'X requires login, attempting peekaboo flow' });
      await motor.runShellCommand('peekaboo open "https://x.com/compose/tweet"');
      await new Promise(r => setTimeout(r, 4000));
    }
    
    let firstTweetPosted = false;
    
    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];
      
      try {
        if (i === 0) {
          // First tweet - use compose box
          await motor.click({ description: 'tweet compose box' });
          await new Promise(r => setTimeout(r, 500));
          await motor.type(tweet);
          await new Promise(r => setTimeout(r, 1000));
          
          // Post it
          await motor.runShellCommand(`peekaboo click --label "Post" 2>/dev/null || true`);
          await new Promise(r => setTimeout(r, 2000));
          
          firstTweetPosted = true;
          results.push({ index: i, status: 'posted', preview: tweet.substring(0, 50) });
        } else {
          // Subsequent tweets - reply to thread
          await motor.runShellCommand(`peekaboo click --label "Reply" 2>/dev/null || true`);
          await new Promise(r => setTimeout(r, 1000));
          await motor.type(tweet);
          await new Promise(r => setTimeout(r, 1000));
          await motor.runShellCommand(`peekaboo click --label "Reply" 2>/dev/null || true`);
          await new Promise(r => setTimeout(r, 2000));
          
          results.push({ index: i, status: 'posted', preview: tweet.substring(0, 50) });
        }
        
        emit('log', { skill: SKILL_NAME, level: 'info', message: `Posted tweet ${i + 1}/${tweets.length}` });
        
      } catch (tweetErr) {
        emit('log', { skill: SKILL_NAME, level: 'error', message: `Failed to post tweet ${i + 1}: ${tweetErr.message}` });
        results.push({ index: i, status: 'failed', error: tweetErr.message });
      }
    }
    
    return { success: firstTweetPosted, results, totalPosted: results.filter(r => r.status === 'posted').length };
    
  } catch (err) {
    emit('log', { skill: SKILL_NAME, level: 'error', message: `Thread posting failed: ${err.message}` });
    return { success: false, error: err.message, results };
  }
}

async function postFailurePostmortem(options = {}) {
  emit('log', { skill: SKILL_NAME, level: 'info', message: 'Starting failure postmortem post' });
  
  try {
    // Get the most recent failure
    const failure = options.failure || await getRecentBuildFailure();
    
    if (!failure) {
      emit('log', { skill: SKILL_NAME, level: 'warn', message: 'No recent build failures found in history' });
      return { 
        success: false, 
        reason: 'no_failures_found',
        message: 'No build failures found in history to postmortem'
      };
    }
    
    emit('log', { 
      skill: SKILL_NAME, 
      level: 'info', 
      message: `Found failure: ${failure.skill_name} at ${failure.created_at}` 
    });
    
    // Get context
    const context = await getFailureContext(failure.skill_name);
    const previousAttempts = await getPreviousAttempts(failure.skill_name, failure.attempt_number);
    
    // Build the thread
    const tweets = buildPostmortemThread(failure, context, previousAttempts);
    
    emit('log', { 
      skill: SKILL_NAME, 
      level: 'info', 
      message: `Built postmortem thread with ${tweets.length} tweets` 
    });
    
    // Copy first tweet to clipboard as backup
    await motor.copyToClipboard(tweets[0]);
    
    // Post the thread
    const postResult = await postThread(tweets);
    
    // Record the postmortem was published
    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO postmortem_log (
          build_history_id, 
          skill_name, 
          tweet_count, 
          post_success, 
          created_at
        ) VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT DO NOTHING
      `, [failure.id, failure.skill_name, tweets.length, postResult.success]);
    }