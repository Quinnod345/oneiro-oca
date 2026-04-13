#!/usr/bin/env node
/**
 * Overnight Autonomous Design Loop
 *
 * Runs while you sleep:
 *   Phase 1: Flywheel cycles (create → score → iterate → store)
 *   Phase 2: Retrain model on accumulated data
 *   Phase 3: Evolve the design skill
 *   Phase 4: Build a full app using the evolved skill
 *
 * The model creates, grades itself, trains, improves its skill,
 * and then builds something real with what it learned.
 *
 * Usage: node overnight.js
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { execSync, spawn } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, 'overnight-app');
const LOG_FILE = join(__dirname, 'overnight-log.txt');

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function claude(prompt, timeout = 300000) {
  // Retry up to 3 times with increasing timeout
  for (let attempt = 1; attempt <= 3; attempt++) {
    const tmp = join(tmpdir(), `overnight-${Date.now()}.txt`);
    writeFileSync(tmp, prompt);
    try {
      const result = execSync(`cat "${tmp}" | claude -p --model sonnet`, {
        encoding: 'utf-8', timeout: Math.min(timeout + (attempt - 1) * 60000, 600000), maxBuffer: 4 * 1024 * 1024, shell: '/bin/zsh',
      }).trim();
      try { unlinkSync(tmp); } catch {}
      if (result && result.length > 10) return result;
    } catch (e) {
      try { unlinkSync(tmp); } catch {}
      if (attempt < 3) {
        log(`  [retry ${attempt}/3] CLI call failed: ${e.message.slice(0, 40)}, retrying...`);
        // Wait before retry
        execSync('sleep 5');
      } else {
        throw e;
      }
    }
  }
  throw new Error('All 3 attempts failed');
}

function claudeOpus(prompt, timeout = 300000) {
  const tmp = join(tmpdir(), `overnight-opus-${Date.now()}.txt`);
  writeFileSync(tmp, prompt);
  try {
    return execSync(`cat "${tmp}" | claude -p --model claude-opus-4-6`, {
      encoding: 'utf-8', timeout, maxBuffer: 8 * 1024 * 1024, shell: '/bin/zsh',
    }).trim();
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

async function ensureServer() {
  const { isServerRunning } = await import('./client.js');
  if (isServerRunning()) return;
  log('Starting inference server...');
  try {
    execSync(`"${__dirname}/start-server.sh" --warmup`, { timeout: 45000, stdio: 'ignore' });
    log('Server started.');
  } catch (e) {
    log('Server start failed: ' + e.message.slice(0, 60));
  }
}

// ═══════════════════════════════════════════════════
// PHASE 1: FLYWHEEL CYCLES
// ═══════════════════════════════════════════════════

async function runFlywheelCycles(count) {
  log(`\n${'═'.repeat(50)}`);
  log(`PHASE 1: Running ${count} flywheel cycles`);
  log('═'.repeat(50));

  const { runCycle } = await import('./flywheel.js');
  const results = [];

  let failures = 0;
  for (let i = 0; i < count; i++) {
    log(`Flywheel cycle ${i + 1}/${count}...`);
    try {
      const result = await runCycle(claude, { retrain: false });
      results.push(result);
      if (result.status === 'complete') {
        log(`  → ${result.type}: ${result.originalScore?.toFixed(3) || '?'} → ${result.improvedScore?.toFixed(3) || 'n/a'} (+${result.samplesAdded} samples)`);
        failures = 0; // Reset on success
      } else {
        log(`  → ${result.type || '?'}: ${result.status} (${result.error?.slice(0, 40) || ''})`);
        failures++;
      }
    } catch (e) {
      log(`  → FAILED: ${e.message.slice(0, 60)}`);
      failures++;
    }
    // If 3+ consecutive failures, wait longer before next attempt
    if (failures >= 3) {
      log('  → 3 consecutive failures, waiting 30s before retry...');
      execSync('sleep 30');
      failures = 0;
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════
// PHASE 2: RETRAIN
// ═══════════════════════════════════════════════════

async function retrain() {
  log(`\n${'═'.repeat(50)}`);
  log('PHASE 2: Retraining model');
  log('═'.repeat(50));

  const mlxDir = join(__dirname, 'mlx');

  // Extract features for new samples
  log('Extracting MobileNet features...');
  try {
    execSync(`python3 ${join(mlxDir, 'extract_features.py')}`, {
      encoding: 'utf-8', timeout: 180000, cwd: mlxDir,
    });
    log('Features extracted.');
  } catch (e) {
    log('Feature extraction failed: ' + e.message.slice(0, 60));
  }

  // Retrain Phase 2b
  log('Training Phase 2b head...');
  try {
    const result = execSync(
      `python3 ${join(mlxDir, 'train_v2.py')} --epochs 300 --batch 16 --patience 40`,
      { encoding: 'utf-8', timeout: 120000, cwd: mlxDir }
    );
    const bestLine = result.split('\n').find(l => l.includes('best val loss'));
    log('Phase 2b: ' + (bestLine || 'trained'));
  } catch (e) {
    log('Phase 2b training failed: ' + e.message.slice(0, 60));
  }

  // Reload server weights
  try {
    const client = await import('./client.js');
    if (client.isServerRunning()) {
      await client.reload();
      log('Server weights reloaded.');
    }
  } catch {}
}

// ═══════════════════════════════════════════════════
// PHASE 3: SKILL EVOLUTION
// ═══════════════════════════════════════════════════

async function evolve() {
  log(`\n${'═'.repeat(50)}`);
  log('PHASE 3: Evolving design skill');
  log('═'.repeat(50));

  const { evolveSkill } = await import('./skill-evolver.js');

  try {
    const result = await evolveSkill(claude, {
      currentCycle: 999999,
      designDriveDeficit: 1.0,
    });

    if (result.applied) {
      log(`Skill evolved to v${result.version}: ${result.scoreBefore?.toFixed(3)} → ${result.scoreAfter?.toFixed(3)}`);
    } else {
      log(`Skill evolution: ${result.reason}`);
    }
    return result;
  } catch (e) {
    log('Skill evolution failed: ' + e.message.slice(0, 60));
    return { skipped: true, reason: 'error' };
  }
}

// ═══════════════════════════════════════════════════
// PHASE 4: BUILD A FULL APP
// ═══════════════════════════════════════════════════

async function buildApp() {
  log(`\n${'═'.repeat(50)}`);
  log('PHASE 4: Building a full app');
  log('═'.repeat(50));

  if (!existsSync(APP_DIR)) mkdirSync(APP_DIR, { recursive: true });

  // Read the evolved skill for context
  const skillPath = process.env.HOME + '/.claude/skills/frontend-design/SKILL.md';
  const skill = existsSync(skillPath) ? readFileSync(skillPath, 'utf-8').slice(0, 3000) : '';

  // Build the app in stages to avoid timeouts

  // Stage 1: Concept
  log('Stage 1: Generating app concept...');
  let concept;
  try {
    concept = claude(`You are designing an innovative Mac app. Using these design principles:
${skill.slice(0, 1500)}

Create a concept for a SINGLE innovative Mac-like web app. Requirements:
- Must solve a real problem in an UNEXPECTED way (Level 5+ design)
- Must have a unique visual identity (not generic)
- Must demonstrate that AI can create something indistinguishable from human-made design
- Must be a full, functional web app (not just a component)
- Should feel like a premium, shipping product

Pick ONE of these concepts and flesh it out:
1. A "mood workspace" — your desktop changes based on what you're working on. Colors, layout, ambient sounds all shift.
2. A "knowledge garden" — your bookmarks/notes visualized as a growing garden. Each topic is a plant species.
3. A "time crystals" app — your calendar visualized as crystalline structures that grow and fracture with your schedule.
4. A "sound palette" — a color picker but for ambient sound. Mix environmental audio the way you mix paint.
5. A "conversation compass" — a meeting tool where discussion topics are visualized as a navigation map.

Return ONLY: A 3-sentence concept description, the app name, and the key visual metaphor. No code yet.`);
    log('Concept: ' + concept.slice(0, 150));
  } catch (e) {
    concept = 'A "knowledge garden" app — your bookmarks and notes visualized as a living garden. Each topic grows as a distinct plant species. Deeper engagement with a topic makes its plant bloom. App name: Verdant. Visual metaphor: organic growth as understanding.';
    log('Using fallback concept');
  }

  // Stage 2: Layout + Structure
  log('Stage 2: Building HTML structure...');
  let htmlShell;
  try {
    htmlShell = claude(`Create the complete HTML structure for this app:

${concept}

Requirements:
- Full-screen web app (1440x900 viewport)
- Dark theme with the app's unique color palette
- Main layout: sidebar (200px) + main content area
- Navigation, header, and at least 3 distinct content sections
- Use CSS Grid for layout, CSS custom properties for the entire color system
- System font stack (-apple-system, BlinkMacSystemFont, etc.)
- Include placeholder content that tells a story
- NO frameworks, NO Inter font, NO generic gradients

Return ONLY the complete HTML with ALL CSS in a <style> tag. No markdown, no explanation.`);
    const match = htmlShell?.match(/```html\n?([\s\S]*?)\n?```/);
    if (match) htmlShell = match[1];
  } catch (e) {
    log('Structure generation failed, retrying...');
    htmlShell = null;
  }

  if (!htmlShell || !htmlShell.includes('<')) {
    try {
      htmlShell = claude(`Create a beautiful, full-screen web app called "Verdant" — a knowledge garden where your notes and bookmarks grow as plants.

Dark theme. Sidebar + main area. CSS Grid layout. CSS custom properties. System fonts.
The garden is the main view — show 6 "plants" (topic clusters) at different growth stages.
Each plant is a CSS-drawn organic shape with a label. Include a search bar, navigation, and a "plant detail" panel.

Return ONLY the complete HTML. No markdown.`);
      const match = htmlShell?.match(/```html\n?([\s\S]*?)\n?```/);
      if (match) htmlShell = match[1];
    } catch (e) {
      log('Structure generation failed again: ' + e.message.slice(0, 50));
    }
  }

  if (htmlShell && htmlShell.includes('<')) {
    writeFileSync(join(APP_DIR, 'index.html'), htmlShell);
    log('HTML structure saved (' + htmlShell.length + ' chars)');
  }

  // Stage 3: Interactivity
  log('Stage 3: Adding interactivity...');
  try {
    const js = claude(`Add JavaScript interactivity to this app. The app concept is:
${concept}

Add these interactions (vanilla JS, no frameworks):
1. Sidebar navigation — clicking items scrolls/switches the main view
2. Search filtering — typing in the search bar filters visible content
3. Hover effects — elements respond to mouse with smooth CSS transitions
4. Click interactions — clicking a main element opens a detail panel
5. Keyboard shortcuts — Cmd+K for search, Escape to close panels
6. Smooth animations — use requestAnimationFrame or CSS transitions
7. Dark/light theme toggle (optional)

Return ONLY the JavaScript code (no HTML, no markdown). It will be added as a <script> tag.`);

    if (js && js.length > 100) {
      const cleanJs = js.replace(/^```\w*\n?/m, '').replace(/\n?```$/m, '').trim();
      // Inject JS into the HTML
      if (existsSync(join(APP_DIR, 'index.html'))) {
        let html = readFileSync(join(APP_DIR, 'index.html'), 'utf-8');
        if (html.includes('</body>')) {
          html = html.replace('</body>', `<script>\n${cleanJs}\n</script>\n</body>`);
        } else {
          html += `\n<script>\n${cleanJs}\n</script>`;
        }
        writeFileSync(join(APP_DIR, 'index.html'), html);
        log('Interactivity added (' + cleanJs.length + ' chars JS)');
      }
    }
  } catch (e) {
    log('JS generation failed: ' + e.message.slice(0, 50));
  }

  // Stage 4: Polish + Details
  log('Stage 4: Adding micro-details and polish...');
  try {
    const polish = claude(`Review and enhance this HTML app with micro-details that make it feel human-crafted:

${readFileSync(join(APP_DIR, 'index.html'), 'utf-8').slice(0, 6000)}

Add ONLY CSS enhancements (return a <style> block):
1. Subtle box-shadows that create depth hierarchy
2. Smooth hover transitions (transform, opacity, color shifts)
3. A loading/entrance animation (elements fade in with staggered delay)
4. Refined spacing — ensure consistent 4px/8px/16px/24px/32px scale
5. Typography refinement — letter-spacing on headings, line-height on body
6. Subtle gradient overlays for depth
7. Custom scrollbar styling (webkit)
8. Focus-visible styles for accessibility

Return ONLY the <style> block. No markdown.`);

    if (polish && polish.includes('{')) {
      let html = readFileSync(join(APP_DIR, 'index.html'), 'utf-8');
      const cleanPolish = polish.replace(/^```\w*\n?/m, '').replace(/\n?```$/m, '').trim();
      if (html.includes('</head>')) {
        html = html.replace('</head>', `${cleanPolish}\n</head>`);
      } else {
        html = cleanPolish + '\n' + html;
      }
      writeFileSync(join(APP_DIR, 'index.html'), html);
      log('Polish applied');
    }
  } catch (e) {
    log('Polish failed: ' + e.message.slice(0, 50));
  }

  // Stage 5: Screenshot and evaluate
  log('Stage 5: Rendering and evaluating...');
  try {
    const { capture, cleanup } = await import('./screenshot-capture.js');
    const htmlPath = join(APP_DIR, 'index.html');
    const pngPath = join(APP_DIR, 'screenshot.png');
    if (existsSync(htmlPath)) {
      await capture(`file://${htmlPath}`, pngPath);
      log('Screenshot saved: ' + pngPath);

      // Evaluate with the model
      const { evaluateDesign } = await import('./evaluate.js');
      const result = await evaluateDesign({
        code: readFileSync(htmlPath, 'utf-8'),
        screenshot: pngPath,
      });
      log(`App scores: overall=${result.overall?.toFixed(3)} innovation=${result.scores?.innovation_score?.toFixed(3)} backend=${result.backend}`);
    }
    await cleanup();
  } catch (e) {
    log('Screenshot/eval failed: ' + e.message.slice(0, 50));
  }

  log('\nApp saved to: ' + APP_DIR);
  log('Open: file://' + join(APP_DIR, 'index.html'));
}

// ═══════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════

async function main() {
  const startTime = Date.now();
  writeFileSync(LOG_FILE, `Overnight Design Loop — Started ${new Date().toISOString()}\n${'═'.repeat(60)}\n\n`);

  log('Starting overnight autonomous design loop...');

  // Start inference server
  await ensureServer();

  // Round 1: 10 flywheel cycles + retrain + evolve
  await runFlywheelCycles(10);
  await retrain();
  await ensureServer(); // Ensure server is still running after retrain
  await evolve();

  // Round 2: 10 more cycles + retrain + evolve
  await runFlywheelCycles(10);
  await retrain();
  await ensureServer();
  await evolve();

  // Round 3: 5 more cycles + final retrain
  await runFlywheelCycles(5);
  await retrain();
  await ensureServer();

  // Build the app!
  await buildApp();

  // Final stats
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const manifest = JSON.parse(readFileSync(join(__dirname, 'data', 'manifest.json'), 'utf-8'));

  log(`\n${'═'.repeat(60)}`);
  log('OVERNIGHT LOOP COMPLETE');
  log(`Total time: ${elapsed} minutes`);
  log(`Total samples: ${manifest.samples.length}`);
  log(`App: ${APP_DIR}/index.html`);
  log('═'.repeat(60));

  // Cleanup
  try {
    execSync(`kill $(cat /tmp/design-model-v2.pid) 2>/dev/null`);
  } catch {}
}

main().catch(e => {
  console.error('Overnight loop crashed:', e);
  try { execSync(`kill $(cat /tmp/design-model-v2.pid) 2>/dev/null`); } catch {}
  process.exit(1);
});
