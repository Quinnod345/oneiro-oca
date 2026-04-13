#!/usr/bin/env node
/**
 * Design Grading Server — human-in-the-loop feedback interface.
 *
 * A local web server where you grade designs on 16 dimensions,
 * write freeform notes, and compare designs side-by-side.
 * Human grades become high-weight training signal.
 *
 * Usage:
 *   node grading-server.js              # Start on port 3456
 *   node grading-server.js --port 8080  # Custom port
 *   node grading-server.js --open       # Auto-open browser
 */

import http from 'http';
import { readFileSync, writeFileSync, existsSync, createReadStream, statSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--port') || '3456');
const MANIFEST_PATH = join(__dirname, 'data', 'manifest.json');
const COMPARISONS_PATH = join(__dirname, 'data', 'comparisons.json');
const UI_DIR = join(__dirname, 'grading-ui');

const MIME_TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

// ═══════════════════════════════════════════════════
// MANIFEST HELPERS
// ═══════════════════════════════════════════════════

function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
}

function saveManifest(manifest) {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

function loadComparisons() {
  if (!existsSync(COMPARISONS_PATH)) return { pairs: [] };
  return JSON.parse(readFileSync(COMPARISONS_PATH, 'utf-8'));
}

function saveComparisons(data) {
  writeFileSync(COMPARISONS_PATH, JSON.stringify(data, null, 2));
}

// ═══════════════════════════════════════════════════
// API HANDLERS
// ═══════════════════════════════════════════════════

function listDesigns(req, res) {
  const manifest = loadManifest();
  const designs = manifest.samples.map((s, i) => ({
    id: i,
    name: s.metadata?.source_name || s.metadata?.category || `design-${i}`,
    source: s.source,
    quality: s.metadata?.quality_target || 'unknown',
    category: s.metadata?.category || 'unknown',
    overall: s.scores?.overall_aesthetic ?? null,
    innovation: s.scores?.innovation_score ?? null,
    hasHumanGrade: !!s.human_grades,
    screenshotPath: s.screenshot_path || s.image,
    hasScreenshot: existsSync(s.screenshot_path || s.image || ''),
  }));
  sendJSON(res, designs);
}

function getDesign(req, res, id) {
  const manifest = loadManifest();
  if (id < 0 || id >= manifest.samples.length) {
    return sendJSON(res, { error: 'Not found' }, 404);
  }
  const sample = manifest.samples[id];
  sendJSON(res, {
    id,
    ...sample,
    hasScreenshot: existsSync(sample.screenshot_path || sample.image || ''),
  });
}

function serveScreenshot(req, res, id) {
  const manifest = loadManifest();
  if (id < 0 || id >= manifest.samples.length) {
    return sendJSON(res, { error: 'Not found' }, 404);
  }
  const sample = manifest.samples[id];
  const imgPath = sample.screenshot_path || sample.image;
  if (!imgPath || !existsSync(imgPath) || imgPath.endsWith('.html')) {
    res.writeHead(404);
    res.end('No screenshot');
    return;
  }
  const ext = extname(imgPath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
  createReadStream(imgPath).pipe(res);
}

async function submitGrade(req, res, id) {
  const body = await readBody(req);
  const grade = JSON.parse(body);

  const manifest = loadManifest();
  if (id < 0 || id >= manifest.samples.length) {
    return sendJSON(res, { error: 'Not found' }, 404);
  }

  const sample = manifest.samples[id];

  // Store human grade
  sample.human_grades = {
    scores: grade.scores,
    notes: grade.notes || '',
    tags: grade.tags || [],
    coherence: grade.coherence ?? null,
    graded_at: new Date().toISOString(),
  };

  // Update authoritative scores to human values
  const modelScores = { ...sample.scores };
  sample.model_scores = modelScores; // Preserve model scores
  sample.scores = { ...modelScores, ...grade.scores }; // Human overrides

  // Track disagreements
  sample.disagreements = {};
  for (const [dim, humanScore] of Object.entries(grade.scores)) {
    const modelScore = modelScores[dim];
    if (modelScore !== undefined) {
      const delta = Math.abs(humanScore - modelScore);
      if (delta > 0.15) {
        sample.disagreements[dim] = {
          human: humanScore,
          model: modelScore,
          delta: Math.round(delta * 1000) / 1000,
          direction: humanScore > modelScore ? 'human_higher' : 'model_higher',
        };
      }
    }
  }

  // Set high confidence for human grades
  sample.confidence = 1.0;
  sample.source = sample.source === 'human_grade' ? 'human_grade' : sample.source;

  saveManifest(manifest);
  sendJSON(res, { ok: true, id, disagreements: sample.disagreements });
}

function getQueue(req, res) {
  const manifest = loadManifest();
  const queue = manifest.samples
    .map((s, i) => ({
      id: i,
      name: s.metadata?.source_name || s.metadata?.category || `design-${i}`,
      hasHumanGrade: !!s.human_grades,
      hasScreenshot: existsSync(s.screenshot_path || s.image || ''),
      overall: s.scores?.overall_aesthetic ?? 0.5,
      source: s.source,
    }))
    .filter(d => d.hasScreenshot && !d.hasHumanGrade)
    .sort((a, b) => {
      // Prioritize: scraped real-world first, then flywheel, then synthetic
      const priority = { scraped_real_world: 0, real_world: 1, flywheel: 2, llm_judge: 3 };
      return (priority[a.source] ?? 4) - (priority[b.source] ?? 4);
    });
  sendJSON(res, queue);
}

function getCompare(req, res) {
  const manifest = loadManifest();
  const withScreenshots = manifest.samples
    .map((s, i) => ({ id: i, ...s }))
    .filter(s => existsSync(s.screenshot_path || s.image || '') && !(s.screenshot_path || s.image || '').endsWith('.html'));

  if (withScreenshots.length < 2) {
    return sendJSON(res, { error: 'Need at least 2 designs with screenshots' }, 400);
  }

  // Pick two random designs
  const a = withScreenshots[Math.floor(Math.random() * withScreenshots.length)];
  let b;
  do {
    b = withScreenshots[Math.floor(Math.random() * withScreenshots.length)];
  } while (b.id === a.id);

  sendJSON(res, {
    a: { id: a.id, name: a.metadata?.source_name || `design-${a.id}` },
    b: { id: b.id, name: b.metadata?.source_name || `design-${b.id}` },
  });
}

async function submitCompare(req, res) {
  const body = await readBody(req);
  const compare = JSON.parse(body);

  const comparisons = loadComparisons();
  const manifest = loadManifest();

  const sampleA = manifest.samples[compare.a_id];
  const sampleB = manifest.samples[compare.b_id];

  comparisons.pairs.push({
    image_a: sampleA?.screenshot_path || sampleA?.image,
    image_b: sampleB?.screenshot_path || sampleB?.image,
    preferences: compare.preferences,
    source: 'human',
    created_at: new Date().toISOString(),
  });

  saveComparisons(comparisons);
  sendJSON(res, { ok: true, totalPairs: comparisons.pairs.length });
}

function getStats(req, res) {
  const manifest = loadManifest();
  const comparisons = loadComparisons();

  const total = manifest.samples.length;
  const humanGraded = manifest.samples.filter(s => s.human_grades).length;
  const withScreenshots = manifest.samples.filter(s => existsSync(s.screenshot_path || s.image || '')).length;

  // Disagreement summary
  const dimDisagreements = {};
  for (const s of manifest.samples) {
    if (!s.disagreements) continue;
    for (const [dim, info] of Object.entries(s.disagreements)) {
      if (!dimDisagreements[dim]) dimDisagreements[dim] = { count: 0, totalDelta: 0 };
      dimDisagreements[dim].count++;
      dimDisagreements[dim].totalDelta += info.delta;
    }
  }
  for (const dim of Object.keys(dimDisagreements)) {
    dimDisagreements[dim].avgDelta = dimDisagreements[dim].totalDelta / dimDisagreements[dim].count;
  }

  // Source breakdown
  const sources = {};
  for (const s of manifest.samples) {
    const src = s.source || 'unknown';
    sources[src] = (sources[src] || 0) + 1;
  }

  sendJSON(res, {
    total,
    humanGraded,
    withScreenshots,
    remaining: withScreenshots - humanGraded,
    progress: humanGraded / Math.max(withScreenshots, 1),
    comparisonPairs: comparisons.pairs.length,
    humanPairs: comparisons.pairs.filter(p => p.source === 'human').length,
    disagreements: dimDisagreements,
    sources,
  });
}

// ═══════════════════════════════════════════════════
// HTTP SERVER
// ═══════════════════════════════════════════════════

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
  });
}

function sendJSON(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // API routes
  if (pathname === '/api/designs' && method === 'GET') return listDesigns(req, res);
  if (pathname === '/api/queue' && method === 'GET') return getQueue(req, res);
  if (pathname === '/api/stats' && method === 'GET') return getStats(req, res);
  if (pathname === '/api/compare' && method === 'GET') return getCompare(req, res);
  if (pathname === '/api/compare' && method === 'POST') return submitCompare(req, res);

  // Parameterized routes
  const designMatch = pathname.match(/^\/api\/designs\/(\d+)$/);
  if (designMatch && method === 'GET') return getDesign(req, res, parseInt(designMatch[1]));

  const screenshotMatch = pathname.match(/^\/api\/designs\/(\d+)\/screenshot$/);
  if (screenshotMatch && method === 'GET') return serveScreenshot(req, res, parseInt(screenshotMatch[1]));

  const gradeMatch = pathname.match(/^\/api\/designs\/(\d+)\/grade$/);
  if (gradeMatch && method === 'POST') return submitGrade(req, res, parseInt(gradeMatch[1]));

  // Static files (grading UI)
  let filePath = pathname === '/' ? '/index.html' : pathname;
  const fullPath = join(UI_DIR, filePath);

  if (existsSync(fullPath) && statSync(fullPath).isFile()) {
    const ext = extname(fullPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
    createReadStream(fullPath).pipe(res);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  Design Grading Interface`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  Grade designs, write feedback, train the model.`);
  console.log(`  Press Ctrl+C to stop.\n`);

  if (process.argv.includes('--open')) {
    try { execSync(`open http://localhost:${PORT}`); } catch {}
  }
});
