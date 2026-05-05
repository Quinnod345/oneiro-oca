/**
 * Design Flywheel — Self-improving design evaluation loop.
 *
 * Each cycle:
 *   1. Build: Generate a design artifact using the design skill
 *   2. Screenshot: Render to PNG
 *   3. Score: Evaluate via Phase 2b (12 dimensions)
 *   4. Iterate: If weak, generate improved version with targeted feedback
 *   5. Compare: Score improved version, record preference pair
 *   6. Store: Add to manifest + comparisons.json
 *   7. Retrain: If enough new samples accumulated, retrain the model
 *
 * Usage:
 *   import { runCycle, runCycles, getState } from './flywheel.js';
 *   await runCycles(5, llmCall); // Run 5 improvement cycles
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { evaluateDesign } from './evaluate.js';
import { encodeFromCode } from './encoder.js';
import { capture, cleanup } from './screenshot-capture.js';
import { SCORE_NAMES, DESIGN_DIMENSIONS } from './knowledge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const FLYWHEEL_DIR = join(DATA_DIR, 'flywheel');
const MANIFEST_PATH = join(DATA_DIR, 'manifest.json');
const COMPARISONS_PATH = join(DATA_DIR, 'comparisons.json');
const STATE_PATH = join(DATA_DIR, 'flywheel-state.json');

const RETRAIN_THRESHOLD = 20; // Retrain after this many new samples
const IMPROVEMENT_THRESHOLD = 0.7; // Score below this triggers iteration
const MIN_IMPROVEMENT = 0.03; // Minimum score improvement to count as "better"

// ═══════════════════════════════════════════════════
// COMPONENT PROMPTS for artifact generation
// ═══════════════════════════════════════════════════

const ARTIFACT_PROMPTS = [
  { type: 'settings-panel', prompt: 'A macOS settings panel with toggles, dropdowns, and a save button. Dark theme, native feel, SF Pro font.' },
  { type: 'task-list', prompt: 'A minimal task list with priorities, due dates, and completion states. Clean design, inspired by Things 3.' },
  { type: 'dashboard-card', prompt: 'A dashboard analytics card with a line chart, KPIs, and trend indicators. Professional but warm.' },
  { type: 'command-palette', prompt: 'A spotlight/command palette overlay. Search input, grouped results, keyboard shortcuts. Frosted glass.' },
  { type: 'notification-stack', prompt: 'Toast notifications stacked in bottom-right. Success/info/warning types. Subtle animations.' },
  { type: 'modal-dialog', prompt: 'A confirmation modal for a destructive action. Clear hierarchy, warning icon, cancel/confirm buttons.' },
  { type: 'sidebar-nav', prompt: 'A sidebar navigation with nested sections, icons, active states. Dark theme, collapsible.' },
  { type: 'media-player', prompt: 'A music/media player widget. Album art, controls, progress bar, volume. Dark, translucent elements.' },
  { type: 'data-table', prompt: 'A sortable data table with status badges, avatars, and hover highlighting. Clean typography.' },
  { type: 'onboarding', prompt: 'An onboarding welcome screen. App icon, 3 feature highlights, get started button. Generous whitespace.' },
  { type: 'profile-card', prompt: 'A user profile card with avatar, stats, bio, and action buttons. Elegant, card-based layout.' },
  { type: 'code-editor', prompt: 'A code editor component with syntax highlighting, line numbers, and a tab bar. Xcode-inspired dark theme.' },
  { type: 'calendar-view', prompt: 'A week calendar view with color-coded events, time markers, and a mini month picker. Clean and polished.' },
  { type: 'file-browser', prompt: 'A file browser with grid/list views, breadcrumbs, search, and file type icons. Finder-inspired.' },
  { type: 'pricing-table', prompt: 'A pricing comparison with 3 tiers. Feature lists, CTA buttons, popular badge. Elegant, not generic.' },
];

// ═══════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════

function loadState() {
  if (existsSync(STATE_PATH)) {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  }
  return {
    totalCycles: 0,
    lastCycleAt: null,
    samplesAddedSinceLastRetrain: 0,
    lastRetrainAt: null,
    lastRetrainValLoss: null,
    skillVersion: 0,
    cycleHistory: [],
  };
}

function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function getState() {
  return loadState();
}

// ═══════════════════════════════════════════════════
// MANIFEST MANAGEMENT
// ═══════════════════════════════════════════════════

function loadManifest() {
  if (existsSync(MANIFEST_PATH)) {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  }
  return { samples: [] };
}

function saveManifest(manifest) {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

function loadComparisons() {
  if (existsSync(COMPARISONS_PATH)) {
    return JSON.parse(readFileSync(COMPARISONS_PATH, 'utf-8'));
  }
  return { pairs: [] };
}

function saveComparisons(comparisons) {
  writeFileSync(COMPARISONS_PATH, JSON.stringify(comparisons, null, 2));
}

// ═══════════════════════════════════════════════════
// CORE FLYWHEEL CYCLE
// ═══════════════════════════════════════════════════

/**
 * Run one flywheel cycle.
 *
 * @param {function} llmCall - async function(prompt) that returns LLM response text
 * @param {object} options - { artifactType, retrain }
 * @returns {object} Cycle result
 */
export async function runCycle(llmCall, options = {}) {
  const state = loadState();
  const cycleNum = state.totalCycles + 1;
  const cycleDir = join(FLYWHEEL_DIR, `cycle-${cycleNum}`);
  mkdirSync(cycleDir, { recursive: true });

  // Pick artifact type (random or specified)
  const artifactSpec = options.artifactType
    ? ARTIFACT_PROMPTS.find(a => a.type === options.artifactType) || ARTIFACT_PROMPTS[0]
    : ARTIFACT_PROMPTS[Math.floor(Math.random() * ARTIFACT_PROMPTS.length)];

  console.log(`\n[flywheel] cycle ${cycleNum}: ${artifactSpec.type}`);

  // ── 1. BUILD ──
  const buildPrompt = `Create a beautiful, polished HTML component: ${artifactSpec.prompt}\n\nReturn ONLY the complete HTML with inline CSS. No markdown, no explanation. Make it production-quality, pixel-perfect, with thoughtful typography, spacing, and color.`;

  console.log(`  [build] generating ${artifactSpec.type}...`);
  let html;
  try {
    html = await llmCall(buildPrompt);
    // Extract HTML if wrapped
    const match = html.match(/```html\n?([\s\S]*?)\n?```/);
    if (match) html = match[1];
    if (!html.includes('<') || html.length < 100) throw new Error('Invalid HTML');
  } catch (e) {
    console.log(`  [FAIL] build: ${e.message.slice(0, 60)}`);
    return { cycle: cycleNum, status: 'build_failed', error: e.message };
  }

  // Save HTML
  const htmlPath = join(cycleDir, 'original.html');
  writeFileSync(htmlPath, html);

  // ── 2. SCREENSHOT ──
  const screenshotPath = join(cycleDir, 'original.png');
  try {
    await capture(html, screenshotPath);
    console.log(`  [screenshot] ${screenshotPath}`);
  } catch (e) {
    console.log(`  [FAIL] screenshot: ${e.message.slice(0, 60)}`);
  }

  // ── 3. SCORE ──
  const evalInput = { code: html };
  if (existsSync(screenshotPath)) evalInput.screenshot = screenshotPath;
  const scores = await evaluateDesign(evalInput);

  console.log(`  [score] overall=${scores.overall.toFixed(3)} backend=${scores.backend}`);

  // ── 4. ITERATE (if weak) ──
  let improvedScores = null;
  let improvedHtml = null;
  let improvedScreenshot = null;

  const weakDims = Object.entries(scores.scores)
    .filter(([name, score]) => name !== 'overall_aesthetic' && score < IMPROVEMENT_THRESHOLD)
    .sort(([, a], [, b]) => a - b)
    .slice(0, 3);

  if (weakDims.length > 0) {
    const weakFeedback = weakDims.map(([name, score]) => {
      const dim = DESIGN_DIMENSIONS?.[name] || {};
      return `- ${name}: ${score.toFixed(2)} (improve: ${dim.high_signals?.slice(0, 2).join(', ') || 'increase quality'})`;
    }).join('\n');

    const improvePrompt = `Improve this HTML design component. The following dimensions scored low:\n\n${weakFeedback}\n\nOriginal HTML:\n${html.slice(0, 6000)}\n\nCreate an improved version addressing these specific weaknesses. Return ONLY the complete HTML with inline CSS. No markdown, no explanation.`;

    console.log(`  [iterate] improving ${weakDims.length} weak dimensions...`);
    try {
      improvedHtml = await llmCall(improvePrompt);
      const match = improvedHtml.match(/```html\n?([\s\S]*?)\n?```/);
      if (match) improvedHtml = match[1];

      if (improvedHtml && improvedHtml.includes('<') && improvedHtml.length > 100) {
        // Save improved version
        writeFileSync(join(cycleDir, 'improved.html'), improvedHtml);

        // Screenshot improved version
        improvedScreenshot = join(cycleDir, 'improved.png');
        try {
          await capture(improvedHtml, improvedScreenshot);
        } catch {}

        // Score improved version
        const improvedInput = { code: improvedHtml };
        if (existsSync(improvedScreenshot)) improvedInput.screenshot = improvedScreenshot;
        improvedScores = await evaluateDesign(improvedInput);

        const delta = improvedScores.overall - scores.overall;
        const marker = delta > MIN_IMPROVEMENT ? '↑' : delta < -MIN_IMPROVEMENT ? '↓' : '→';
        console.log(`  [iterate] improved overall=${improvedScores.overall.toFixed(3)} (${marker}${Math.abs(delta).toFixed(3)})`);
      }
    } catch (e) {
      console.log(`  [iterate] failed: ${e.message.slice(0, 60)}`);
    }
  }

  // ── 5. STORE ──
  const manifest = loadManifest();

  // Add original
  const codeFeatures = Array.from(encodeFromCode(html, { platform: 'web' }));
  manifest.samples.push({
    image: screenshotPath,
    screenshot_path: existsSync(screenshotPath) ? screenshotPath : null,
    scores: scores.scores,
    source: 'flywheel',
    code_features: codeFeatures,
    metadata: {
      source_name: `flywheel-${cycleNum}-original`,
      quality_target: scores.overall > 0.8 ? 'high' : scores.overall > 0.5 ? 'medium' : 'low',
      category: artifactSpec.type,
      cycle: cycleNum,
      version: 'original',
      code_path: htmlPath,
      generated_at: new Date().toISOString(),
    },
  });

  let samplesAdded = 1;

  // Add improved version + preference pair
  if (improvedScores && improvedHtml) {
    const improvedCodeFeatures = Array.from(encodeFromCode(improvedHtml, { platform: 'web' }));
    manifest.samples.push({
      image: improvedScreenshot,
      screenshot_path: existsSync(improvedScreenshot) ? improvedScreenshot : null,
      scores: improvedScores.scores,
      source: 'flywheel',
      code_features: improvedCodeFeatures,
      metadata: {
        source_name: `flywheel-${cycleNum}-improved`,
        quality_target: improvedScores.overall > 0.8 ? 'high' : improvedScores.overall > 0.5 ? 'medium' : 'low',
        category: artifactSpec.type,
        cycle: cycleNum,
        version: 'improved',
        code_path: join(cycleDir, 'improved.html'),
        generated_at: new Date().toISOString(),
      },
    });
    samplesAdded++;

    // Record preference pair
    if (Math.abs(improvedScores.overall - scores.overall) > MIN_IMPROVEMENT) {
      const comparisons = loadComparisons();
      const preferences = {};
      for (const name of SCORE_NAMES) {
        const a = scores.scores[name] || 0.5;
        const b = improvedScores.scores[name] || 0.5;
        const margin = Math.abs(b - a);
        preferences[name] = {
          winner: b > a + MIN_IMPROVEMENT ? 'B' : a > b + MIN_IMPROVEMENT ? 'A' : 'tie',
          margin,
        };
      }
      comparisons.pairs.push({
        image_a: screenshotPath,
        image_b: improvedScreenshot,
        preferences,
        cycle: cycleNum,
        created_at: new Date().toISOString(),
      });
      saveComparisons(comparisons);
    }
  }

  saveManifest(manifest);

  // ── 6. UPDATE STATE ──
  state.totalCycles = cycleNum;
  state.lastCycleAt = new Date().toISOString();
  state.samplesAddedSinceLastRetrain += samplesAdded;
  state.cycleHistory.push({
    cycle: cycleNum,
    type: artifactSpec.type,
    originalScore: scores.overall,
    improvedScore: improvedScores?.overall || null,
    samplesAdded,
  });
  // Keep only last 100 entries
  if (state.cycleHistory.length > 100) state.cycleHistory = state.cycleHistory.slice(-100);
  saveState(state);

  // ── 7. RETRAIN CHECK ──
  const shouldRetrain = options.retrain !== false &&
    state.samplesAddedSinceLastRetrain >= RETRAIN_THRESHOLD;

  if (shouldRetrain) {
    console.log(`  [retrain] ${state.samplesAddedSinceLastRetrain} new samples, triggering retrain...`);
    try {
      await triggerRetrain();
      state.samplesAddedSinceLastRetrain = 0;
      state.lastRetrainAt = new Date().toISOString();
      saveState(state);
    } catch (e) {
      console.log(`  [retrain] failed: ${e.message.slice(0, 60)}`);
    }
  }

  const result = {
    cycle: cycleNum,
    status: 'complete',
    type: artifactSpec.type,
    originalScore: scores.overall,
    improvedScore: improvedScores?.overall || null,
    improvement: improvedScores ? (improvedScores.overall - scores.overall) : 0,
    samplesAdded,
    totalSamples: manifest.samples.length,
    backend: scores.backend,
  };

  console.log(`  [done] +${samplesAdded} samples (total: ${manifest.samples.length})`);
  return result;
}

/**
 * Run multiple flywheel cycles.
 */
export async function runCycles(count, llmCall, options = {}) {
  const results = [];
  for (let i = 0; i < count; i++) {
    const result = await runCycle(llmCall, { ...options, retrain: i === count - 1 });
    results.push(result);
  }
  await cleanup(); // Close Puppeteer
  return results;
}

// ═══════════════════════════════════════════════════
// RETRAIN
// ═══════════════════════════════════════════════════

async function triggerRetrain() {
  const mlxDir = join(__dirname, 'mlx');

  // 1. Extract features for new samples (both pooled and pre-pool — v7 needs both)
  console.log(`  [retrain] extracting features...`);
  execSync(`python3 ${join(mlxDir, 'extract_features.py')} --include-pre`, {
    encoding: 'utf-8', timeout: 180000, cwd: mlxDir,
  });

  // 2. Retrain the head (Phase 7 — backbone fine-tune + 2000 synthetic pairs,
  //                      warm-started from v6)
  console.log(`  [retrain] training Phase 7 head...`);
  const trainResult = execSync(
    `python3 ${join(mlxDir, 'train_v7.py')} --epochs 300 --batch 16 --patience 40`,
    { encoding: 'utf-8', timeout: 600000, cwd: mlxDir }
  );
  console.log(`  [retrain] ${trainResult.split('\n').filter(l => l.includes('best val')).pop()}`);

  // 3. Reload server weights
  try {
    const client = await import('./client.js');
    if (client.isServerRunning()) {
      await client.reload();
      console.log(`  [retrain] server weights reloaded`);
    }
  } catch {}
}

export default { runCycle, runCycles, getState };
