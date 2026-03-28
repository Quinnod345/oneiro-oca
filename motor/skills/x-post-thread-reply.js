import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';
import { runShellCommand } from '../engine.js';

const PEEKABOO_TIMEOUT = 30000;
const REPLY_DELAY_MS = 2000;
const TYPE_DELAY_MS = 50;

async function getParentTweetUrl(tweetId) {
  if (!tweetId) throw new Error('tweetId is required to build reply URL');
  return `https://twitter.com/i/web/status/${tweetId}`;
}

async function waitMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postReplyViaPeekaboo(parentTweetId, replyText, options = {}) {
  const { sessionLabel = 'oneiro-x-session', dryRun = false } = options;

  if (dryRun) {
    console.log('[x-post-thread-reply] DRY RUN — would reply to', parentTweetId, 'with:', replyText);
    return { success: true, dryRun: true, parentTweetId, replyText };
  }

  const parentUrl = await getParentTweetUrl(parentTweetId);

  // Navigate to parent tweet
  const navResult = await motor.runShellCommand(
    `peekaboo open --url "${parentUrl}" --session "${sessionLabel}" --wait-for ".tweet-text, article[data-testid='tweet']" --timeout ${PEEKABOO_TIMEOUT}`
  );

  if (navResult.exitCode !== 0) {
    throw new Error(`Peekaboo failed to open parent tweet: ${navResult.stderr}`);
  }

  await waitMs(REPLY_DELAY_MS);

  // Click the reply button on the parent tweet
  const clickReplyResult = await motor.runShellCommand(
    `peekaboo click --session "${sessionLabel}" --selector "[data-testid='reply']" --index 0 --timeout ${PEEKABOO_TIMEOUT}`
  );

  if (clickReplyResult.exitCode !== 0) {
    throw new Error(`Peekaboo failed to click reply button: ${clickReplyResult.stderr}`);
  }

  await waitMs(1000);

  // Type the reply text into the compose box
  const escapedText = replyText.replace(/"/g, '\\"').replace(/`/g, '\\`');
  const typeResult = await motor.runShellCommand(
    `peekaboo type --session "${sessionLabel}" --selector "[data-testid='tweetTextarea_0']" --text "${escapedText}" --delay ${TYPE_DELAY_MS} --timeout ${PEEKABOO_TIMEOUT}`
  );

  if (typeResult.exitCode !== 0) {
    throw new Error(`Peekaboo failed to type reply text: ${typeResult.stderr}`);
  }

  await waitMs(1000);

  // Submit the reply
  const submitResult = await motor.runShellCommand(
    `peekaboo click --session "${sessionLabel}" --selector "[data-testid='tweetButtonInline']" --timeout ${PEEKABOO_TIMEOUT}`
  );

  if (submitResult.exitCode !== 0) {
    throw new Error(`Peekaboo failed to submit reply: ${submitResult.stderr}`);
  }

  await waitMs(REPLY_DELAY_MS);

  return {
    success: true,
    parentTweetId,
    replyText,
    method: 'peekaboo',
    timestamp: new Date().toISOString()
  };
}

async function postReplyViaBrowserAutomation(parentTweetId, replyText, options = {}) {
  const { dryRun = false } = options;

  if (dryRun) {
    console.log('[x-post-thread-reply] DRY RUN — would reply to', parentTweetId, 'with:', replyText);
    return { success: true, dryRun: true, parentTweetId, replyText };
  }

  const parentUrl = await getParentTweetUrl(parentTweetId);

  await motor.openUrl(parentUrl);
  await waitMs(3000);

  // Click reply button
  await motor.runShellCommand(`osascript -e 'tell application "System Events" to key code 36'`);
  await waitMs(1000);

  await motor.type(replyText);
  await waitMs(500);

  // Cmd+Enter or click tweet button
  await motor.press('cmd+enter');
  await waitMs(REPLY_DELAY_MS);

  return {
    success: true,
    parentTweetId,
    replyText,
    method: 'browser-automation',
    timestamp: new Date().toISOString()
  };
}

async function logReplyToDb(parentTweetId, replyText, result, context = {}) {
  try {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO x_thread_replies
          (parent_tweet_id, reply_text, success, method, context, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT DO NOTHING`,
        [
          parentTweetId,
          replyText,
          result.success || false,
          result.method || 'unknown',
          JSON.stringify(context)
        ]
      );
    } finally {
      client.release();
    }
  } catch (dbErr) {
    console.warn('[x-post-thread-reply] DB log failed (non-fatal):', dbErr.message);
  }
}

async function emitReplyEvent(parentTweetId, replyText, result, context = {}) {
  try {
    await emit('x.thread.reply.posted', {
      parentTweetId,
      replyText,
      result,
      context,
      timestamp: new Date().toISOString()
    });
  } catch (emitErr) {
    console.warn('[x-post-thread-reply] Event emit failed (non-fatal):', emitErr.message);
  }
}

async function detectCapabilityGap(replyText, context = {}) {
  const gapIndicators = [
    /can't\s+(do|handle|process|understand)/i,
    /not\s+(able|capable|equipped)/i,
    /missing\s+(skill|capability|function)/i,
    /no\s+(skill|handler|module)\s+for/i,
    /capability\s+gap/i,
    /build\s+trigger/i,
    /need\s+to\s+build/i,
    /should\s+build/i,
    /decided\s+to\s+build/i
  ];

  const hasGapSignal = gapIndicators.some(pattern => pattern.test(replyText));
  const hasContextGap = context.capabilityGap || context.buildTrigger || context.missingSkill;

  return {
    detected: hasGapSignal || !!hasContextGap,
    fromText: hasGapSignal,
    fromContext: !!hasContextGap,
    gapDescription: context.capabilityGap || context.missingSkill || null
  };
}

async function postThreadReply(parentTweetId, replyText, options = {}) {
  const {
    method = 'peekaboo',
    dryRun = false,
    context = {},
    sessionLabel = 'oneiro-x-session',
    skipDbLog = false,
    skipEmit = false
  } = options;

  if (!parentTweetId) {
    throw new Error('[x-post-thread-reply] parentTweetId is required');
  }

  if (!replyText || replyText.trim().length === 0) {
    throw new Error('[x-post-thread-reply] replyText cannot be empty');
  }

  if (replyText.length > 280) {
    console.warn(`[x-post-thread-reply] replyText exceeds 280 chars (${replyText.length}). Truncating.`);
    replyText = replyText.slice(0, 277) + '...';
  }

  // Detect capability gap signals in the reply content
  const gapAnalysis = await detectCapabilityGap(replyText, context);
  if (gapAnalysis.detected) {
    console.log('[x-post-thread-reply] Capability gap signal detected in reply:', gapAnalysis);
    await emit('capability.gap.detected.in.thread.reply', {
      parentTweetId,
      replyText,
      gapAnalysis,
      context,
      timestamp: new Date().toISOString()
    }).catch(err => console.warn('[x-post-thread-reply] Gap emit failed:', err.message));
  }

  let result;

  try {
    if (method === 'peekaboo') {
      result = await postReplyViaPeekaboo(parentTweetId, replyText, { sessionLabel, dryRun });
    } else if (method === 'browser') {
      result = await postReplyViaBrowserAutomation(parentTweetId, replyText, { dryRun });
    } else {
      throw new Error(`Unknown method: ${method}. Use 'peekaboo' or 'browser'.`);
    }
  } catch (err) {
    console.error('[x-post-thread-reply] Primary method failed, attempting fallback:', err.message);

    // Fallback: try the other method
    try {
      if (method === 'peekaboo') {
        result = await postReplyViaBrowserAutomation(parentTweetId, replyText, { dryRun });
        result.fallback = true;
        result.fallbackReason = err.message;
      } else {
        result = await postReplyViaPeekaboo(parentTweetId, replyText, { sessionLabel, dryRun });
        result.fallback = true;
        result.fallbackReason = err.message;
      }
    } catch (fallbackErr) {
      const failResult = {
        success: false,
        parentTweetId,
        replyText,
        error: err.message,
        fallbackError: fallbackErr.message,
        timestamp: new Date().toISOString()
      };

      if (!skipDbLog) await logReplyToDb(parentTweetId, replyText, failResult, context);
      if (!skipEmit) await emitReplyEvent(parentTweetId, replyText, failResult, context);

      throw new Error(`[x-post-thread-reply] Both methods failed. Primary: ${err.message}. Fallback: ${fallbackErr.message}`);
    }
  }

  if (!skipDbLog) await logReplyToDb(parentTweetId, replyText, result, context);
  if (!skipEmit) await emitReplyEvent(parentTweetId, replyText, result, context);

  console.log('[x-post-thread-reply] Reply posted successfully:', {
    parentTweetId,
    method: result.method,
    fallback: result.fallback || false,
    dryRun: result.dryRun || false
  });

  return result;
}

async function postBuildTriggerReply(parentTweetId, triggerContext = {}) {
  const {
    capabilityGap,
    decision,
    buildTarget,
    reasoning,
    dryRun = false,
    method = 'peekaboo'
  } = triggerContext;

  const parts = [];

  if (capabilityGap) {
    parts.push(`Gap detected: ${capabilityGap}`);
  }

  if (decision) {
    parts.push(`Decision: ${decision}`);
  }

  if (buildTarget) {
    parts.push(`Building: ${buildTarget}`);
  }

  if (reasoning) {
    parts.push(reasoning);
  }

  if (parts.length === 0) {
    parts.push('Capability gap detected. Initiating build sequence.');
  }

  const replyText = parts.join('\n\n');

  return postThreadReply(parentTweetId, replyText, {
    method,
    dryRun,
    context: {
      type: 'build-trigger',
      capabilityGap,
      buildTarget,
      decision,
      reasoning
    }
  });
}

async function postBuildInPublicThreadReply(parentTweetId, updateContext = {}) {
  const {
    phase,
    status,
    detail,
    metrics,
    dryRun = false,
    method = 'peekaboo'
  } = updateContext;

  const lines = [];

  if (phase) lines.push(`Phase: ${phase}`);
  if (status) lines.push(`Status: ${status}`);
  if (detail) lines.push(detail);

  if (metrics && typeof metrics === 'object') {
    const metricLines = Object.entries(metrics)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' | ');
    if (metricLines) lines.push(metricLines);
  }

  const replyText = lines.join('\n') || 'Build update.';

  return postThreadReply(parentTweetId, replyText, {
    method,
    dryRun,
    context: {
      type: 'build-in-public',
      phase,
      status,
      metrics
    }
  });
}

async function postCapabilityGapThreadReply(parentTweetId, gapContext = {}) {
  const {
    gapName,
    gapDescription,
    detectedAt,
    willBuild = true,
    dryRun = false,
    method = 'peekaboo'
  } = gapContext;

  const lines = [];

  if (gapName) lines.push(`Missing capability: ${gapName}`);
  if (gapDescription) lines.push(gapDescription);
  if (detectedAt) lines.push(`Detected: ${detectedAt}`);
  lines.push(willBuild ? 'Decided to build it.' : 'Logged for future build.');

  const replyText = lines.join('\n');

  return postThreadReply(parentTweetId, replyText, {
    method,
    dryRun,
    context: {
      type: 'capability-gap',
      gapName,
      gapDescription,
      willBuild
    }
  });
}

async function getReplyHistory(parentTweetId, limit = 20) {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM x_thread_replies
         WHERE parent_tweet_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [parentTweetId, limit]
      );
      return result.rows;
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('[x-post-thread-reply] Failed to fetch reply history:', err.message);
    return [];
  }
}

async function ensureSchema() {
  try {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS x_thread_replies (
          id SERIAL PRIMARY KEY,
          parent_tweet_id TEXT NOT NULL,
          reply_text TEXT NOT NULL,
          success BOOLEAN DEFAULT false,
          method TEXT,
          context JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('[x-post-thread-reply] Schema ensure failed (non-fatal):', err.message);