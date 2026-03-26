import { pool, emit } from '../../event-bus.js';
import motor from '../engine.js';

const PEEKABOO = 'peekaboo';

function buildTweetText(template, context) {
  if (!context) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (context[key] !== undefined) return String(context[key]);
    return `{{${key}}}`;
  });
}

async function getThreadUrl(threadId) {
  if (!threadId) return null;
  const res = await pool.query(
    `SELECT url FROM x_threads WHERE thread_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [threadId]
  );
  return res.rows[0]?.url || null;
}

async function fetchMetricsContext() {
  try {
    const res = await pool.query(`
      SELECT metric_key, metric_value, recorded_at
      FROM oca_metrics
      ORDER BY recorded_at DESC
      LIMIT 20
    `);
    const ctx = {};
    for (const row of res.rows) {
      if (!(row.metric_key in ctx)) {
        ctx[row.metric_key] = row.metric_value;
      }
    }
    return ctx;
  } catch {
    return {};
  }
}

async function fetchPhaseContext() {
  try {
    const res = await pool.query(`
      SELECT phase_name, started_at, status, notes
      FROM build_phases
      ORDER BY started_at DESC
      LIMIT 1
    `);
    const row = res.rows[0];
    if (!row) return {};
    return {
      phase: row.phase_name,
      phase_status: row.status,
      phase_notes: row.notes,
      phase_started: row.started_at ? row.started_at.toISOString().slice(0, 10) : null,
    };
  } catch {
    return {};
  }
}

async function fetchCompositionContext() {
  try {
    const res = await pool.query(`
      SELECT title, bpm, key_sig, track_count, created_at
      FROM compositions
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const row = res.rows[0];
    if (!row) return {};
    return {
      composition_title: row.title,
      composition_bpm: row.bpm,
      composition_key: row.key_sig,
      composition_tracks: row.track_count,
    };
  } catch {
    return {};
  }
}

async function buildContext(contextTypes) {
  const parts = await Promise.all(
    (contextTypes || []).map(async (type) => {
      switch (type) {
        case 'metrics': return fetchMetricsContext();
        case 'phase': return fetchPhaseContext();
        case 'composition': return fetchCompositionContext();
        default: return {};
      }
    })
  );
  return Object.assign({}, ...parts);
}

async function postReplyViaPeekaboo(tweetUrl, replyText) {
  const escaped = replyText.replace(/'/g, "'\\''");
  const result = await motor.runShellCommand(
    `${PEEKABOO} x reply --url '${tweetUrl}' --text '${escaped}'`
  );
  return result;
}

async function postReplyViaBrowser(tweetUrl, replyText) {
  await motor.openUrl(tweetUrl);
  await new Promise(r => setTimeout(r, 3000));
  await motor.runShellCommand(`osascript -e 'tell application "System Events" to keystroke "r" using {command down}'`);
  await new Promise(r => setTimeout(r, 1500));
  await motor.type(replyText);
  await new Promise(r => setTimeout(r, 500));
  await motor.runShellCommand(`osascript -e 'tell application "System Events" to key code 36 using {command down}'`);
  await new Promise(r => setTimeout(r, 2000));
}

async function saveReplyRecord({ threadId, tweetUrl, replyText, method, success, error }) {
  try {
    await pool.query(
      `INSERT INTO x_thread_replies (thread_id, tweet_url, reply_text, method, success, error, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT DO NOTHING`,
      [threadId || null, tweetUrl || null, replyText, method, success, error || null]
    );
  } catch {
    // table may not exist; non-fatal
  }
}

async function replyToThread({
  tweetUrl,
  threadId,
  text,
  contextTypes,
  extraContext,
  method = 'peekaboo',
} = {}) {
  if (!text) throw new Error('x-thread-reply: text is required');

  let resolvedUrl = tweetUrl;
  if (!resolvedUrl && threadId) {
    resolvedUrl = await getThreadUrl(threadId);
  }
  if (!resolvedUrl) throw new Error('x-thread-reply: tweetUrl or threadId required');

  const dbCtx = await buildContext(contextTypes || []);
  const ctx = Object.assign({}, dbCtx, extraContext || {});
  const replyText = buildTweetText(text, ctx);

  let success = false;
  let errorMsg = null;

  try {
    if (method === 'browser') {
      await postReplyViaBrowser(resolvedUrl, replyText);
    } else {
      await postReplyViaPeekaboo(resolvedUrl, replyText);
    }
    success = true;
    emit('x:reply:posted', { tweetUrl: resolvedUrl, threadId, replyText });
  } catch (err) {
    errorMsg = err.message;
    emit('x:reply:failed', { tweetUrl: resolvedUrl, threadId, error: errorMsg });
    throw err;
  } finally {
    await saveReplyRecord({
      threadId,
      tweetUrl: resolvedUrl,
      replyText,
      method,
      success,
      error: errorMsg,
    });
  }

  return { success: true, tweetUrl: resolvedUrl, replyText };
}

async function replyWithMetrics({ tweetUrl, threadId, text, extraContext, method } = {}) {
  return replyToThread({
    tweetUrl,
    threadId,
    text,
    contextTypes: ['metrics'],
    extraContext,
    method,
  });
}

async function replyWithPhase({ tweetUrl, threadId, text, extraContext, method } = {}) {
  return replyToThread({
    tweetUrl,
    threadId,
    text,
    contextTypes: ['phase'],
    extraContext,
    method,
  });
}

async function replyWithComposition({ tweetUrl, threadId, text, extraContext, method } = {}) {
  return replyToThread({
    tweetUrl,
    threadId,
    text,
    contextTypes: ['composition'],
    extraContext,
    method,
  });
}

async function replyBuildInPublic({ tweetUrl, threadId, text, extraContext, method } = {}) {
  return replyToThread({
    tweetUrl,
    threadId,
    text,
    contextTypes: ['metrics', 'phase', 'composition'],
    extraContext,
    method,
  });
}

export default {
  replyToThread,
  replyWithMetrics,
  replyWithPhase,
  replyWithComposition,
  replyBuildInPublic,
};