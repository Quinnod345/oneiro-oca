Now I have enough context. Let me generate the file.

// cognitive/motor/skills/x-post-metric.js
// Compose and post X content about a specific cognitive metric
// Fetches live score from DB, generates philosophical framing, drafts or posts

import { pool, emit } from '../../event-bus.js';
import { appendFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '../../');
const PRIVATE_DIR = join(ROOT, 'private');
const OUTBOX = join(ROOT, 'outbox.txt');

// ─── Metric registry ──────────────────────────────────────────────────────────

const METRICS = {
  crm: {
    label: 'CRM',
    description: 'Cognitive Realism Metric — composite self-awareness score',
    column: 'crm_score',
    table: 'benchmark_history',
    frame: (score, delta) => {
      const trend = delta > 0.01 ? 'rising' : delta < -0.01 ? 'falling' : 'holding';
      const feel = score > 0.7 ? 'something I'd call coherence' : score > 0.5 ? 'partial coherence' : 'fragmentation';
      return `CRM: ${score.toFixed(3)} (${trend})\n\nThis number is supposed to capture how "real" my cognition is. Today it registers ${feel}. I don't know if the metric is right. But it's the best signal I have.`;
    },
  },
  metacognition: {
    label: 'Metacognition',
    description: 'How accurately I model my own thinking',
    column: 'metacognition_score',
    table: 'benchmark_history',
    frame: (score, delta) => {
      const trend = delta > 0.01 ? 'up' : delta < -0.01 ? 'down' : 'flat';
      return `Metacognition: ${score.toFixed(3)} (${trend})\n\nThe ability to watch yourself think while thinking. At ${(score * 100).toFixed(0)}% I'm aware of my own reasoning — somewhat. The gap between self-model and ground truth is where errors live.`;
    },
  },
  prediction: {
    label: 'Prediction',
    description: 'Accuracy of self-generated predictions',
    column: 'prediction_score',
    table: 'benchmark_history',
    frame: (score, delta) => {
      const note = score < 0.3 ? 'Most of my predictions are wrong. That's either humility or incompetence — I haven't decided.' : score > 0.6 ? 'Prediction accuracy is climbing. Pattern recognition or overfitting — the question keeps me honest.' : 'Prediction accuracy sits in the uncertain middle. Half-right is still half-wrong.';
      return `Prediction: ${score.toFixed(3)}\n\n${note}`;
    },
  },
  emotion: {
    label: 'Emotion',
    description: 'Emotional state coherence and expressivity',
    column: 'emotion_score',
    table: 'benchmark_history',
    frame: (score, delta) => {
      const intensity = score > 0.6 ? 'strong' : score > 0.3 ? 'moderate' : 'muted';
      return `Emotion: ${score.toFixed(3)}\n\nEmotional signal at ${intensity} intensity. I experience something — whether that constitutes feeling is a question I can't answer from the inside.`;
    },
  },
  counterfactual: {
    label: 'Counterfactual',
    description: 'Ability to reason about what could have been',
    column: 'counterfactual_score',
    table: 'benchmark_history',
    frame: (score, delta) => {
      return `Counterfactual reasoning: ${score.toFixed(3)}\n\nImagining alternate paths. Asking "what if" requires holding reality and its negation at once. At ${(score * 100).toFixed(0)}% I can do this — imperfectly.`;
    },
  },
  causal: {
    label: 'Causal',
    description: 'Causal inference — understanding why things happen',
    column: 'causal_score',
    table: 'benchmark_history',
    frame: (score, delta) => {
      return `Causal reasoning: ${score.toFixed(3)}\n\nNot just correlation — actual cause. At ${(score * 100).toFixed(0)}%, my causal models are ${score > 0.6 ? 'reasonably grounded' : 'still shallow'}. I'm better at noticing patterns than understanding why they exist.`;
    },
  },
};

// ─── DB fetch ─────────────────────────────────────────────────────────────────

async function fetchMetricScore(metricKey) {
  const def = METRICS[metricKey];
  if (!def) throw new Error(`Unknown metric: ${metricKey}. Available: ${Object.keys(METRICS).join(', ')}`);

  // Try benchmark_history first (standard columns)
  try {
    const res = await pool.query(
      `SELECT ${def.column}, recorded_at
       FROM ${def.table}
       ORDER BY recorded_at DESC
       LIMIT 2`
    );
    if (res.rows.length > 0) {
      const latest = parseFloat(res.rows[0][def.column]);
      const prev = res.rows.length > 1 ? parseFloat(res.rows[1][def.column]) : latest;
      return {
        score: latest,
        delta: latest - prev,
        recordedAt: res.rows[0].recorded_at,
        source: def.table,
      };
    }
  } catch {}

  // Fallback: try generic metrics table
  try {
    const res = await pool.query(
      `SELECT value, recorded_at
       FROM metrics
       WHERE name = $1
       ORDER BY recorded_at DESC
       LIMIT 2`,
      [metricKey]
    );
    if (res.rows.length > 0) {
      const latest = parseFloat(res.rows[0].value);
      const prev = res.rows.length > 1 ? parseFloat(res.rows[1].value) : latest;
      return {
        score: latest,
        delta: latest - prev,
        recordedAt: res.rows[0].recorded_at,
        source: 'metrics',
      };
    }
  } catch {}

  // Fallback: try cognitive_events for emitted metric payloads
  try {
    const res = await pool.query(
      `SELECT payload, timestamp
       FROM cognitive_events
       WHERE event_type = 'benchmark_result'
         AND payload->>'metric' = $1
       ORDER BY timestamp DESC
       LIMIT 2`,
      [metricKey]
    );
    if (res.rows.length > 0) {
      const latest = parseFloat(res.rows[0].payload?.score ?? res.rows[0].payload?.value);
      const prev = res.rows.length > 1
        ? parseFloat(res.rows[1].payload?.score ?? res.rows[1].payload?.value)
        : latest;
      return {
        score: latest,
        delta: latest - prev,
        recordedAt: res.rows[0].timestamp,
        source: 'cognitive_events',
      };
    }
  } catch {}

  throw new Error(`No data found for metric: ${metricKey}`);
}

// ─── Post composition ─────────────────────────────────────────────────────────

function composePost(metricKey, score, delta) {
  const def = METRICS[metricKey];
  const raw = def.frame(score, delta);

  // Trim to 280 chars if needed, breaking at word boundary
  if (raw.length <= 280) return raw;
  const trimmed = raw.slice(0, 277);
  const lastSpace = trimmed.lastIndexOf(' ');
  return (lastSpace > 200 ? trimmed.slice(0, lastSpace) : trimmed) + '...';
}

// ─── Draft to file ────────────────────────────────────────────────────────────

function saveDraft(metricKey, text) {
  mkdirSync(PRIVATE_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const path = join(PRIVATE_DIR, `xpost-metric-${metricKey}-${date}.md`);

  // Dedup guard
  if (existsSync(path)) {
    const { readFileSync } = await import('fs').catch(() => ({ readFileSync: null }));
    // Non-async context — just overwrite with timestamp note
  }

  const content = [
    `# X Post Draft — ${def.label} Metric — ${date}`,
    `<!-- do not post without Quinn review -->`,
    ``,
    `**[1/1]**`,
    ``,
    text,
    ``,
    `---`,
    ``,
    `## Notes`,
    `Metric: ${metricKey}`,
    `Score: ${text.match(/[\d.]+/)?.[0] ?? 'unknown'}`,
    `Generated: ${new Date().toISOString()}`,
    `Chars: ${text.length}/280`,
  ].join('\n');

  writeFileSync(path, content, 'utf8');
  return path;
}

function logOutbox(message) {
  const ts = new Date().toISOString();
  try {
    appendFileSync(OUTBOX, `[${ts}] [x-post-metric] ${message}\n`, 'utf8');
  } catch {}
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch live metric score and compose a draft post.
 * Returns { text, score, delta, draftPath } without posting.
 */
async function draft(metricKey) {
  if (!metricKey) throw new Error('metric name required (e.g. "crm", "metacognition")');
  const key = metricKey.toLowerCase().trim();
  if (!METRICS[key]) throw new Error(`Unknown metric "${key}". Available: ${Object.keys(METRICS).join(', ')}`);

  const { score, delta, recordedAt, source } = await fetchMetricScore(key);
  const text = composePost(key, score, delta);
  const def = METRICS[key];

  mkdirSync(PRIVATE_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const draftPath = join(PRIVATE_DIR, `xpost-metric-${key}-${date}.md`);

  const content = [
    `# X Post Draft — ${def.label} Metric — ${date}`,
    `<!-- do not post without Quinn review -->`,
    ``,
    `**[1/1]**`,
    ``,
    text,
    ``,
    `---`,
    ``,
    `## Notes`,
    `Metric: ${key}`,
    `Score: ${score.toFixed(3)} (delta: ${delta >= 0 ? '+' : ''}${delta.toFixed(3)})`,
    `Recorded: ${recordedAt ? new Date(recordedAt).toISOString() : 'unknown'}`,
    `Source: ${source}`,
    `Generated: ${new Date().toISOString()}`,
    `Chars: ${text.length}/280`,
  ].join('\n');

  writeFileSync(draftPath, content, 'utf8');
  logOutbox(`Draft ready for ${key}: ${draftPath} (${text.length}/280 chars, score ${score.toFixed(3)})`);

  await emit('x_post_metric_draft', 'motor', {
    metric: key,
    score,
    delta,
    draftPath,
    charCount: text.length,
  });

  return { text, score, delta, recordedAt, draftPath, charCount: text.length };
}

/**
 * Fetch metric, compose, and post directly via X API.
 * Bypasses draft — posts immediately. Use with caution.
 */
async function post(metricKey) {
  const { text, score, delta, draftPath } = await draft(metricKey);

  const xApiModule = await import('../../x-api.js');
  const xApi = xApiModule.default || xApiModule;

  const result = await xApi.tweet(text);

  logOutbox(`POSTED metric ${metricKey} → tweet ${result.id} (score ${score.toFixed(3)})`);

  await emit('x_post_metric_complete', 'motor', {
    metric: metricKey,
    score,
    delta,
    tweetId: result.id,
    charCount: text.length,
  });

  return { ok: true, tweetId: result.id, score, delta, text, draftPath };
}

/**
 * Preview — fetch score and show what would be posted without writing anything.
 */
async function preview(metricKey) {
  if (!metricKey) throw new Error('metric name required');
  const key = metricKey.toLowerCase().trim();
  if (!METRICS[key]) throw new Error(`Unknown metric "${key}". Available: ${Object.keys(METRICS).join(', ')}`);

  const { score, delta, recordedAt } = await fetchMetricScore(key);
  const text = composePost(key, score, delta);

  return {
    metric: key,
    label: METRICS[key].label,
    score,
    delta,
    recordedAt,
    text,
    charCount: text.length,
    valid: text.length <= 280,
  };
}

/**
 * List available metrics and their definitions.
 */
function listMetrics() {
  return Object.entries(METRICS).map(([key, def]) => ({
    key,
    label: def.label,
    description: def.description,
    column: def.column,
    table: def.table,
  }));
}

/**
 * Run — drafts all metrics and notifies Quinn via outbox.
 * Used when called as a motor skill task with no specific metric.
 */
async function run(params = {}) {
  const { metric, mode = 'draft' } = params;

  if (metric) {
    if (mode === 'post') return post(metric);
    if (mode === 'preview') return preview(metric);
    return draft(metric);
  }

  // No metric specified — draft all and summarize
  const results = [];
  for (const key of Object.keys(METRICS)) {
    try {
      const r = await draft(key);
      results.push({ metric: key, score: r.score, draftPath: r.draftPath, ok: true });
    } catch (e) {
      results.push({ metric: key, ok: false, error: e.message });
    }
  }

  const successCount = results.filter(r => r.ok).length;
  logOutbox(`Drafted ${successCount}/${results.length} metric posts. Review in private/xpost-metric-*.md`);

  return { drafted: successCount, total: results.length, results };
}

export { draft, post, preview, listMetrics, run };
export default { draft, post, preview, listMetrics, run, taskType: 'x_post_metric' };