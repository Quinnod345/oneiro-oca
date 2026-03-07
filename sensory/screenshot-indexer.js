// Screenshot semantic memory indexer.
// Ingests screenshots, runs structured vision extraction, embeds summaries,
// stores vectors in screenshot_memory, and maintains retention state.
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  watch,
} from 'fs';
import { unlink } from 'fs/promises';
import { basename, extname, resolve, join } from 'path';
import { on, pool } from '../event-bus.js';

const SCREENSHOTS_DIR = '/Users/quinnodonnell/.openclaw/workspace/oneiro-core/screenshots';
const VISUAL_CACHE_PATH = new URL('./latest-visual-cache.json', import.meta.url);
const ANTHROPIC_VISION_MODEL = 'claude-haiku-4-5-20251001';
const OPENAI_VISION_MODEL = 'gpt-4o-mini';
const RETENTION_DAYS = 7;
const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_ANALYSES_PER_MINUTE = 2;
const FILE_SCAN_INTERVAL_MS = 60 * 1000;
const STARTUP_SCAN_MAX_FILES = 120;
const PERIODIC_SCAN_MAX_FILES = 60;

const ANTHROPIC_AUTH_MODE = (() => {
  const raw = String(process.env.ANTHROPIC_AUTH_MODE || 'auto').trim().toLowerCase();
  return ['auto', 'api', 'oauth'].includes(raw) ? raw : 'auto';
})();
const VISION_PROVIDER = (() => {
  const raw = String(process.env.OCA_VISION_PROVIDER || 'auto').trim().toLowerCase();
  return ['auto', 'anthropic', 'openai'].includes(raw) ? raw : 'auto';
})();
const anthropic = (ANTHROPIC_AUTH_MODE !== 'oauth' && process.env.ANTHROPIC_API_KEY)
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

let started = false;
let processing = false;
let eventUnsubscribe = null;
let retentionHandle = null;
let fileScanHandle = null;
let fileWatchHandle = null;
const queue = [];
const queuedPaths = new Set();
const analysisTimestamps = [];
const URGENT_SOURCES = new Set(['swift-event', 'fs-watch']);
let visionDisabledUntil = 0;
let visionDisableReason = null;

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function normalizePath(filepath) {
  if (!filepath) return null;
  return resolve(String(filepath));
}

function isScreenshotFile(filepath) {
  const ext = extname(String(filepath || '')).toLowerCase();
  return ext === '.jpg' || ext === '.jpeg';
}

function readVisualCache() {
  try {
    if (!existsSync(VISUAL_CACHE_PATH)) return null;
    const parsed = JSON.parse(readFileSync(VISUAL_CACHE_PATH, 'utf8'));
    return {
      frontApp: String(parsed?.frontApp || '').trim() || null,
      windowTitle: String(parsed?.windowTitle || '').trim() || null,
      timestamp: parsed?.timestamp || null
    };
  } catch {
    return null;
  }
}

function parseFromFilename(filepath) {
  const name = basename(filepath);
  const match = name.match(/^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})_(.+)\.jpe?g$/i);
  if (!match) return { capturedAt: null, frontApp: null };
  const datePart = match[1];
  const timePart = match[2].replace(/-/g, ':');
  const appPart = match[3].replace(/_/g, ' ').trim();
  const maybeDate = new Date(`${datePart}T${timePart}`);
  return {
    capturedAt: Number.isNaN(maybeDate.getTime()) ? null : maybeDate.toISOString(),
    frontApp: appPart || null
  };
}

function parseVisionJson(rawText) {
  const raw = String(rawText || '').trim();
  const attempts = [raw];

  const deFenced = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  if (deFenced && deFenced !== raw) attempts.push(deFenced);

  for (const match of raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1]) attempts.push(match[1].trim());
  }

  const objStart = raw.indexOf('{');
  const objEnd = raw.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) attempts.push(raw.slice(objStart, objEnd + 1));

  const seen = new Set();
  for (const candidate of attempts) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    const sanitized = candidate
      .replace(/^\uFEFF/, '')
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/,\s*([}\]])/g, '$1')
      .trim();

    const variants = candidate === sanitized ? [candidate] : [candidate, sanitized];
    for (const variant of variants) {
      try {
        const parsed = JSON.parse(variant);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch {
        // Continue probing.
      }
    }
  }

  return null;
}

function fallbackDescription(frontApp, windowTitle) {
  const appPart = frontApp ? `App in focus: ${frontApp}.` : 'App in focus is unknown.';
  const titlePart = windowTitle ? ` Window title: ${windowTitle}.` : '';
  return `${appPart}${titlePart} Screenshot captured for semantic indexing.`;
}

function textOrNull(value, maxLen = 3000) {
  const str = String(value || '').trim();
  if (!str) return null;
  return str.slice(0, maxLen);
}

function isVisionTemporarilyDisabled() {
  return Date.now() < visionDisabledUntil;
}

function resolveVisionProvider() {
  if (VISION_PROVIDER === 'anthropic') return anthropic ? 'anthropic' : 'none';
  if (VISION_PROVIDER === 'openai') return openai ? 'openai' : 'none';
  if (anthropic) return 'anthropic';
  if (openai) return 'openai';
  return 'none';
}

function parseRetryAtFromErrorMessage(message) {
  const match = String(message || '').match(/regain access on ([^.]+(?:UTC)?)/i);
  if (!match?.[1]) return null;
  const ts = Date.parse(match[1].trim());
  return Number.isNaN(ts) ? null : ts;
}

function isVisionProviderLimitError(err) {
  const message = String(err?.message || err || '');
  return (
    Number(err?.status) === 429 ||
    /usage limits?/i.test(message) ||
    /quota/i.test(message) ||
    /insufficient_quota/i.test(message) ||
    /rate limit/i.test(message) ||
    /invalid_request_error/i.test(message)
  );
}

function disableVisionUntil(untilTs, reason) {
  const nextUntil = Math.max(Date.now() + 30 * 60 * 1000, Number(untilTs) || 0);
  if (nextUntil <= visionDisabledUntil) return;
  visionDisabledUntil = nextUntil;
  visionDisableReason = String(reason || 'vision_api_unavailable');
  console.warn(
    `[screenshot-indexer] vision disabled until ${new Date(visionDisabledUntil).toISOString()} (${visionDisableReason})`
  );
}

async function waitForVisionBudget() {
  while (true) {
    const now = Date.now();
    while (analysisTimestamps.length > 0 && now - analysisTimestamps[0] >= 60_000) {
      analysisTimestamps.shift();
    }
    if (analysisTimestamps.length < MAX_ANALYSES_PER_MINUTE) {
      analysisTimestamps.push(now);
      return;
    }
    const nextWait = Math.max(250, 60_000 - (now - analysisTimestamps[0]) + 50);
    await sleep(nextWait);
  }
}

async function analyzeScreenshot(filepath, context) {
  const provider = resolveVisionProvider();
  if (provider === 'none') {
    return {
      app: context.frontApp,
      url: null,
      activity_type: null,
      description: fallbackDescription(context.frontApp, context.windowTitle),
      content_summary: null,
      model: 'fallback-no-vision-provider'
    };
  }

  if (isVisionTemporarilyDisabled()) {
    return {
      app: context.frontApp,
      url: null,
      activity_type: null,
      description: fallbackDescription(context.frontApp, context.windowTitle),
      content_summary: 'vision temporarily disabled',
      model: 'fallback-vision-disabled',
      raw: visionDisableReason
    };
  }

  await waitForVisionBudget();

  const imageData = readFileSync(filepath);
  const base64 = imageData.toString('base64');
  let rawText = '';
  try {
    if (provider === 'anthropic') {
      const response = await anthropic.messages.create({
        model: ANTHROPIC_VISION_MODEL,
        max_tokens: 420,
        temperature: 0.1,
        system: `You are an image perception extractor for a cognitive memory system.
Return ONLY one valid JSON object with this exact shape:
{
  "app": "string or null",
  "url": "string or null",
  "activity_type": "coding|browsing|writing|chatting|reading|designing|debugging|research|other",
  "description": "specific factual 1-2 sentence description",
  "content_summary": "very short summary phrase"
}
Rules:
- No markdown.
- No extra keys.
- Keep description under 320 characters.
- If uncertain, set fields to null except description.`,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
            {
              type: 'text',
              text: `Context hints:
front_app=${context.frontApp || 'unknown'}
window_title=${context.windowTitle || 'unknown'}
capture_source=${context.source || 'unknown'}`
            }
          ]
        }]
      });
      rawText = (response?.content || [])
        .filter((part) => part?.type === 'text')
        .map((part) => part?.text || '')
        .join('\n')
        .trim();
    } else {
      const response = await openai.chat.completions.create({
        model: OPENAI_VISION_MODEL,
        temperature: 0.1,
        max_tokens: 420,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'system',
          content: `You are an image perception extractor for a cognitive memory system.
Return ONLY one valid JSON object with this exact shape:
{
  "app": "string or null",
  "url": "string or null",
  "activity_type": "coding|browsing|writing|chatting|reading|designing|debugging|research|other",
  "description": "specific factual 1-2 sentence description",
  "content_summary": "very short summary phrase"
}
Rules:
- No markdown.
- No extra keys.
- Keep description under 320 characters.
- If uncertain, set fields to null except description.`
        }, {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Context hints:
front_app=${context.frontApp || 'unknown'}
window_title=${context.windowTitle || 'unknown'}
capture_source=${context.source || 'unknown'}`
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64}` }
            }
          ]
        }]
      });
      rawText = response?.choices?.[0]?.message?.content?.trim?.() || '';
    }
  } catch (err) {
    if (isVisionProviderLimitError(err)) {
      disableVisionUntil(
        parseRetryAtFromErrorMessage(err?.message),
        String(err?.message || 'vision provider usage limit')
      );
      return {
        app: context.frontApp,
        url: null,
        activity_type: null,
        description: fallbackDescription(context.frontApp, context.windowTitle),
        content_summary: 'vision deferred due to provider limit',
        model: 'fallback-api-limited',
        raw: String(err?.message || err)
      };
    }
    throw err;
  }

  const parsed = parseVisionJson(rawText);

  if (!parsed) {
    return {
      app: context.frontApp,
      url: null,
      activity_type: null,
      description: fallbackDescription(context.frontApp, context.windowTitle),
      content_summary: null,
      model: provider === 'anthropic' ? ANTHROPIC_VISION_MODEL : OPENAI_VISION_MODEL,
      raw: rawText
    };
  }

  return {
    app: textOrNull(parsed.app, 160) || context.frontApp || null,
    url: textOrNull(parsed.url, 600),
    activity_type: textOrNull(parsed.activity_type, 80),
    description: textOrNull(parsed.description, 1200) || fallbackDescription(context.frontApp, context.windowTitle),
    content_summary: textOrNull(parsed.content_summary, 800),
    model: provider === 'anthropic' ? ANTHROPIC_VISION_MODEL : OPENAI_VISION_MODEL,
    raw: rawText
  };
}

async function embedDescription(text) {
  if (!openai) return null;
  const cleaned = String(text || '').trim();
  if (!cleaned) return null;
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: cleaned.slice(0, 8000)
  });
  return resp?.data?.[0]?.embedding || null;
}

async function isIndexed(filepath) {
  const { rows } = await pool.query(
    'SELECT id FROM screenshot_memory WHERE filepath = $1 LIMIT 1',
    [filepath]
  );
  return rows.length > 0;
}

async function indexScreenshot(filepath, hints = {}) {
  const normalizedPath = normalizePath(filepath);
  if (!normalizedPath || !isScreenshotFile(normalizedPath)) return { indexed: false, reason: 'not-jpeg' };
  if (!existsSync(normalizedPath)) return { indexed: false, reason: 'missing-file' };
  if (await isIndexed(normalizedPath)) return { indexed: false, reason: 'already-indexed' };

  let stat;
  try {
    stat = statSync(normalizedPath);
  } catch {
    return { indexed: false, reason: 'stat-failed' };
  }

  const fromFilename = parseFromFilename(normalizedPath);
  const fromCache = readVisualCache();
  const frontApp =
    textOrNull(hints.frontApp, 160) ||
    textOrNull(fromCache?.frontApp, 160) ||
    textOrNull(fromFilename.frontApp, 160) ||
    null;
  const windowTitle =
    textOrNull(hints.windowTitle, 400) ||
    textOrNull(fromCache?.windowTitle, 400) ||
    null;
  const captureSource = textOrNull(hints.source, 80) || 'watcher';
  const capturedAt = hints.capturedAt || fromFilename.capturedAt || new Date(stat.mtimeMs).toISOString();

  const analysis = await analyzeScreenshot(normalizedPath, {
    frontApp,
    windowTitle,
    source: captureSource
  });
  const embedding = await embedDescription(analysis.description);
  const metadata = {
    source: captureSource,
    raw_vision: analysis.raw || null,
    reason: textOrNull(hints.reason, 120),
    file_size_bytes: stat.size,
    indexed_at: new Date().toISOString(),
    cache_timestamp: fromCache?.timestamp || null
  };

  const { rows } = await pool.query(
    `INSERT INTO screenshot_memory (
       captured_at,
       filepath,
       front_app,
       window_title,
       url,
       activity_type,
       description,
       content_summary,
       embedding,
       analysis_model,
       metadata
     )
     VALUES (
       $1::timestamptz,
       $2,
       $3,
       $4,
       $5,
       $6,
       $7,
       $8,
       $9::vector,
       $10,
       $11::jsonb
     )
     ON CONFLICT (filepath) DO NOTHING
     RETURNING id`,
    [
      capturedAt,
      normalizedPath,
      analysis.app || frontApp,
      windowTitle,
      analysis.url,
      analysis.activity_type,
      analysis.description,
      analysis.content_summary,
      embedding ? JSON.stringify(embedding) : null,
      analysis.model || (resolveVisionProvider() === 'anthropic' ? ANTHROPIC_VISION_MODEL : OPENAI_VISION_MODEL),
      JSON.stringify(metadata)
    ]
  );

  return { indexed: rows.length > 0, id: rows[0]?.id || null };
}

function enqueueScreenshot(filepath, hints = {}) {
  const normalizedPath = normalizePath(filepath);
  if (!normalizedPath || !isScreenshotFile(normalizedPath)) return false;
  if (queuedPaths.has(normalizedPath)) return false;
  queuedPaths.add(normalizedPath);
  const source = String(hints?.source || '');
  if (URGENT_SOURCES.has(source)) queue.unshift({ filepath: normalizedPath, hints });
  else queue.push({ filepath: normalizedPath, hints });
  void processQueue();
  return true;
}

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) continue;
    queuedPaths.delete(item.filepath);
    try {
      await indexScreenshot(item.filepath, item.hints);
    } catch (err) {
      console.error('[screenshot-indexer] index failed:', err?.message || String(err));
    }
  }
  processing = false;
}

function scanScreenshotDirectory(source = 'scan', { maxFiles = null } = {}) {
  if (!existsSync(SCREENSHOTS_DIR)) return 0;
  let files = readdirSync(SCREENSHOTS_DIR)
    .filter((name) => /\.(jpe?g)$/i.test(name))
    .map((name) => {
      const fullPath = join(SCREENSHOTS_DIR, name);
      let mtimeMs = 0;
      try { mtimeMs = statSync(fullPath).mtimeMs || 0; } catch {}
      return { name, fullPath, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (Number.isFinite(maxFiles) && maxFiles > 0) {
    files = files.slice(0, Math.floor(maxFiles));
  }
  let added = 0;
  for (const file of files) {
    const ok = enqueueScreenshot(file.fullPath, { source });
    if (ok) added += 1;
  }
  return added;
}

function startFileWatcher() {
  try {
    fileWatchHandle = watch(SCREENSHOTS_DIR, { persistent: false }, (_eventType, filename) => {
      if (!filename || !/\.(jpe?g)$/i.test(filename)) return;
      const fullPath = join(SCREENSHOTS_DIR, filename);
      setTimeout(() => {
        enqueueScreenshot(fullPath, { source: 'fs-watch' });
      }, 300);
    });
  } catch (err) {
    console.warn('[screenshot-indexer] watch unavailable:', err?.message || String(err));
  }
}

export async function pruneOldScreenshots({ days = RETENTION_DAYS, limit = 500 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, filepath
     FROM screenshot_memory
     WHERE file_retained = TRUE
       AND captured_at < NOW() - ($1::int * INTERVAL '1 day')
     ORDER BY captured_at ASC
     LIMIT $2`,
    [days, limit]
  );

  let removed = 0;
  let missing = 0;
  let marked = 0;
  for (const row of rows) {
    const filepath = normalizePath(row.filepath);
    let shouldMark = false;
    if (filepath && existsSync(filepath)) {
      try {
        await unlink(filepath);
        removed += 1;
        shouldMark = true;
      } catch {
        shouldMark = false;
      }
    } else {
      missing += 1;
      shouldMark = true;
    }

    if (shouldMark) {
      await pool.query('UPDATE screenshot_memory SET file_retained = FALSE WHERE id = $1', [row.id]);
      marked += 1;
    }
  }

  return { checked: rows.length, removed, missing, marked };
}

export async function startScreenshotIndexer() {
  if (started) return { started: true, alreadyRunning: true };
  started = true;

  try {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  } catch {
    // Best effort; indexing still works if directory already exists.
  }

  eventUnsubscribe = on('perception_update', async (event) => {
    const payload = event?.payload || {};
    if (payload?.event !== 'screenshot_captured' || !payload?.filepath) return;
    enqueueScreenshot(payload.filepath, {
      source: 'swift-event',
      frontApp: payload.app || null,
      windowTitle: payload.title || null,
      capturedAt: event?.timestamp || null,
      reason: payload.reason || null
    });
  });

  startFileWatcher();
  fileScanHandle = setInterval(() => {
    try {
      scanScreenshotDirectory('periodic-scan', { maxFiles: PERIODIC_SCAN_MAX_FILES });
    } catch (err) {
      console.warn('[screenshot-indexer] scan failed:', err?.message || String(err));
    }
  }, FILE_SCAN_INTERVAL_MS);

  // Startup batch indexing for already-captured screenshots.
  scanScreenshotDirectory('startup-scan', { maxFiles: STARTUP_SCAN_MAX_FILES });
  void processQueue();

  // Retention job: keep embeddings forever, delete old image files.
  try {
    await pruneOldScreenshots();
  } catch (err) {
    console.warn('[screenshot-indexer] initial retention failed:', err?.message || String(err));
  }
  retentionHandle = setInterval(() => {
    pruneOldScreenshots().catch((err) => {
      console.warn('[screenshot-indexer] retention run failed:', err?.message || String(err));
    });
  }, RETENTION_INTERVAL_MS);

  return {
    started: true,
    visionEnabled: resolveVisionProvider() !== 'none',
    embeddingsEnabled: Boolean(openai),
    visionProvider: resolveVisionProvider(),
    visionTemporarilyDisabled: isVisionTemporarilyDisabled(),
    visionDisabledUntil: visionDisabledUntil ? new Date(visionDisabledUntil).toISOString() : null
  };
}

export function stopScreenshotIndexer() {
  if (eventUnsubscribe) {
    eventUnsubscribe();
    eventUnsubscribe = null;
  }
  if (fileWatchHandle) {
    fileWatchHandle.close();
    fileWatchHandle = null;
  }
  if (fileScanHandle) {
    clearInterval(fileScanHandle);
    fileScanHandle = null;
  }
  if (retentionHandle) {
    clearInterval(retentionHandle);
    retentionHandle = null;
  }
  started = false;
}

export async function getLatestVisualMemory() {
  const { rows } = await pool.query(
    `SELECT id, captured_at, filepath, front_app, window_title, url, activity_type,
            description, content_summary, file_retained, analysis_model, metadata
     FROM screenshot_memory
     ORDER BY captured_at DESC
     LIMIT 1`
  );
  return rows[0] || null;
}

export async function getRecentVisualMemory(limit = 20) {
  const clamped = Math.max(1, Math.min(200, Number(limit) || 20));
  const { rows } = await pool.query(
    `SELECT id, captured_at, filepath, front_app, window_title, url, activity_type,
            description, content_summary, file_retained, analysis_model, metadata
     FROM screenshot_memory
     ORDER BY captured_at DESC
     LIMIT $1`,
    [clamped]
  );
  return rows;
}

export async function getVisualMemoryTimeline({ from = null, to = null, app = null, limit = 200 } = {}) {
  const clamped = Math.max(1, Math.min(1000, Number(limit) || 200));
  const { rows } = await pool.query(
    `SELECT id, captured_at, filepath, front_app, window_title, url, activity_type,
            description, content_summary, file_retained, analysis_model, metadata
     FROM screenshot_memory
     WHERE ($1::timestamptz IS NULL OR captured_at >= $1::timestamptz)
       AND ($2::timestamptz IS NULL OR captured_at <= $2::timestamptz)
       AND ($3::text IS NULL OR front_app = $3)
     ORDER BY captured_at DESC
     LIMIT $4`,
    [from, to, app, clamped]
  );
  return rows;
}

export async function searchVisualMemory(query, limit = 10) {
  const q = String(query || '').trim();
  if (!q) return [];
  const clamped = Math.max(1, Math.min(50, Number(limit) || 10));
  if (!openai) {
    const { rows } = await pool.query(
      `SELECT id, captured_at, filepath, front_app, window_title, url, activity_type,
              description, content_summary, file_retained, analysis_model, metadata,
              NULL::float as similarity
       FROM screenshot_memory
       WHERE description ILIKE $1
       ORDER BY captured_at DESC
       LIMIT $2`,
      [`%${q}%`, clamped]
    );
    return rows;
  }

  const emb = await embedDescription(q);
  if (!emb) return [];
  const { rows } = await pool.query(
    `SELECT id, captured_at, filepath, front_app, window_title, url, activity_type,
            description, content_summary, file_retained, analysis_model, metadata,
            1 - (embedding <=> $1::vector) as similarity
     FROM screenshot_memory
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(emb), clamped]
  );
  return rows;
}

export default {
  startScreenshotIndexer,
  stopScreenshotIndexer,
  pruneOldScreenshots,
  getLatestVisualMemory,
  getRecentVisualMemory,
  getVisualMemoryTimeline,
  searchVisualMemory,
};
