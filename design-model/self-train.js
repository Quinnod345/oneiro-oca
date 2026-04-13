#!/usr/bin/env node
/**
 * Self-Training Loop — the model builds itself.
 *
 * Opus generates designs → Opus grades them deeply → model trains on Opus's judgment
 * → model guides next generation → repeat. No human needed.
 *
 * This is the core loop. Everything else serves this.
 *
 * Usage:
 *   node self-train.js                    # Run 10 cycles
 *   node self-train.js --cycles 50        # Run 50 cycles
 *   node self-train.js --forever          # Run until killed
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { capture, cleanup } from './screenshot-capture.js';
import { evaluateDesign } from './evaluate.js';
import { encodeFromCode } from './encoder.js';
import { SCORE_NAMES } from './knowledge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const MANIFEST_PATH = join(DATA_DIR, 'manifest.json');
const SELF_TRAIN_DIR = join(DATA_DIR, 'self-train');
const STATE_PATH = join(DATA_DIR, 'self-train-state.json');

if (!existsSync(SELF_TRAIN_DIR)) mkdirSync(SELF_TRAIN_DIR, { recursive: true });

// ═══════════════════════════════════════════════════
// OPUS — the taste oracle
// ═══════════════════════════════════════════════════

function opus(prompt) {
  const tmp = join(tmpdir(), `opus-${Date.now()}.txt`);
  writeFileSync(tmp, prompt);
  try {
    return execSync(`cat "${tmp}" | claude -p --model claude-opus-4-6`, {
      encoding: 'utf-8', timeout: 600000, maxBuffer: 8 * 1024 * 1024, shell: '/bin/zsh',
    }).trim();
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

function sonnet(prompt) {
  const tmp = join(tmpdir(), `sonnet-${Date.now()}.txt`);
  writeFileSync(tmp, prompt);
  try {
    return execSync(`cat "${tmp}" | claude -p --model sonnet`, {
      encoding: 'utf-8', timeout: 600000, maxBuffer: 4 * 1024 * 1024, shell: '/bin/zsh',
    }).trim();
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

// ═══════════════════════════════════════════════════
// DESIGN BRIEFS — what to build each cycle
// ═══════════════════════════════════════════════════

const BRIEFS = [
  'A macOS menu bar app that shows your current focus state — not a timer, but an ambient presence that communicates depth of focus through color and subtle motion',
  'A file organizer that arranges documents spatially by topic, like papers on a desk — not a list, not a grid, a spatial canvas where proximity means relatedness',
  'A bookmark manager where saved links grow into a knowledge map — connections between topics are visible, clusters form naturally, and forgotten links fade like old memories',
  'A meeting scheduler that shows time as a river — your free slots are calm water, meetings are bridges, and conflicts are rapids',
  'A music discovery interface where genres are landscapes — jazz is rolling hills, electronic is a city grid, classical is mountain peaks — and your listening history is a trail through the terrain',
  'A habit tracker where habits are plants in a garden — daily completion waters them, streaks make them bloom, and neglected ones wilt visually',
  'A note-taking app where notes exist in 3D space — recent notes float near you, old ones drift further away, and connections between notes are visible threads',
  'A weather dashboard that makes you FEEL the weather through visual design — rain is communicated through texture and rhythm, not icons',
  'A personal finance view where spending categories are geological layers — deeper layers are necessities, surface layers are discretionary, and erosion shows overspending',
  'A code review tool where diff quality is communicated through visual density — clean changes are spacious and clear, messy changes are visually compressed and noisy',
  'A recipe manager that visualizes cooking as a timeline of transformations — ingredients flow through steps, combine, and transform into the final dish',
  'A podcast player where episodes are constellations in a night sky — listened episodes glow, series form constellation patterns, and your listening journey is a visible path through the stars',
  'A task manager where tasks have physical weight — heavy tasks sink to the bottom, quick tasks float, and completing one launches it upward with a satisfying animation',
  'A contacts app where people exist in a social constellation — closeness reflects relationship strength, recent interactions glow, and groups form natural clusters',
  'A reading list where articles are stacked like physical magazines on a coffee table — you can see edges, peek at covers, and the pile reflects your reading ambitions',
  'A system monitor where CPU/memory/disk are living organisms — healthy systems breathe steadily, stressed ones pulse faster, and crashes are visible injuries healing',
  'A color palette generator that works like a musical instrument — you play colors by dragging through hue/saturation space, and harmonies lock in like musical chords',
  'A git branch visualizer where branches are actual tree branches — main is the trunk, feature branches grow outward, merged branches are pruned cleanly, and abandoned ones wither',
  'A calendar that shows your energy levels — morning meetings are on high ground, post-lunch dips are valleys, and the terrain shapes your day visually',
  'A password manager where vaults are rooms in a building — each room has a distinct character, security level is communicated through visual weight, and you navigate spatially',
];

const GRADING_PROMPT = `You are an expert design critic with impeccable taste. You grade design artifacts with brutal honesty.

Score this design across ALL 16 dimensions on a 0.0-1.0 scale. Be HARSH and PRECISE.

SCORING GUIDE:
- 0.0-0.2: Terrible. Anti-patterns everywhere. Generic AI slop.
- 0.2-0.4: Below average. Functional but forgettable. Template-following.
- 0.4-0.6: Mediocre. Some good choices but nothing distinctive. Wouldn't remember it.
- 0.6-0.75: Good. Solid craft, some personality, but still conventional.
- 0.75-0.85: Excellent. Distinctive, cohesive, shows real design thinking.
- 0.85-0.95: Exceptional. Would mistake for a top-tier human designer's work.
- 0.95-1.0: Transcendent. Redefines expectations. Almost never give this.

CRITICAL: The dimensions MUST be coherent. If typography is great but clashes with the color palette, BOTH typography and color scores should reflect that conflict. A part that doesn't serve the whole is a LIABILITY, not an asset.

DIMENSIONS:
1. typography_quality (0-1): Font choices, pairing, scale, spacing, hierarchy
2. color_harmony (0-1): Palette cohesion, emotional resonance, contrast ratios
3. spatial_composition (0-1): Layout, whitespace, grid, visual flow, breathing room
4. motion_elegance (0-1): Animation quality/purposefulness (0.5 if static)
5. emotional_resonance (0-1): Does it FEEL like something? Evoke a mood?
6. craft_visibility (0-1): Pixel-perfect details, consistency, polish
7. minimalism_coherence (0-1): Every element earns its place. Nothing gratuitous.
8. native_integration (0-1): Feels like it belongs on macOS
9. visceral_score (0-1): Norman L1 — instant aesthetic reaction
10. behavioral_score (0-1): Norman L2 — would it work flawlessly?
11. reflective_score (0-1): Norman L3 — pride of use, identity, meaning
12. overall_aesthetic (0-1): THE WHOLE. Not the average. The gestalt.
13. innovation_score (0-1): Is the APPROACH novel? Does it redefine the problem?
14. system_creativity (0-1): Do systems connect in unexpected ways?
15. design_distinctiveness (0-1): Would you recognize this without a logo?
16. problem_level (0-1): Seven Levels — execute (0.1) vs paradigm shift (0.9)

Also write a 2-3 sentence CRITIQUE explaining what works, what doesn't, and WHY.

RESPOND WITH ONLY valid JSON:
{"scores": {"typography_quality": 0.xx, ...all 16...}, "critique": "..."}`;

// ═══════════════════════════════════════════════════
// CORE LOOP
// ═══════════════════════════════════════════════════

function loadState() {
  if (existsSync(STATE_PATH)) return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  return { totalCycles: 0, totalSamples: 0, retrains: 0, lastRetrain: null, avgOverall: 0 };
}

function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function runCycle(cycleNum) {
  const brief = BRIEFS[cycleNum % BRIEFS.length];
  const briefShort = brief.slice(0, 50);
  console.log(`\n[cycle ${cycleNum}] ${briefShort}...`);

  // Load the design skill for context
  const skillPath = process.env.HOME + '/.claude/skills/frontend-design/SKILL.md';
  const skill = existsSync(skillPath) ? readFileSync(skillPath, 'utf-8').slice(0, 2000) : '';

  // ── 1. SONNET GENERATES (fast), OPUS GRADES (smart) ──
  let html;
  try {
    html = sonnet(`Create a complete HTML page (1440x900) with inline CSS:

${brief}

Rules: system fonts, CSS vars, no Inter, no generic gradients, solve at Level 5+, ship quality.
Return ONLY the HTML.`);

    // Extract HTML from various wrapper formats
    const htmlMatch = html?.match(/```html\n?([\s\S]*?)\n?```/);
    if (htmlMatch) html = htmlMatch[1];
    // Try generic code fence
    if (!html?.includes('<!DOCTYPE') && !html?.includes('<html')) {
      const codeFence = html?.match(/```\n?([\s\S]*?)\n?```/);
      if (codeFence) html = codeFence[1];
    }
    // Strip any leading text before the HTML
    const docStart = html?.indexOf('<!DOCTYPE') ?? html?.indexOf('<html') ?? html?.indexOf('<head') ?? -1;
    if (docStart > 0) html = html.slice(docStart);
    if (!html?.includes('<') || html.length < 200) throw new Error('Invalid HTML (' + (html?.length || 0) + ' chars)');
  } catch (e) {
    console.log(`  [FAIL] generate: ${e.message.slice(0, 50)}`);
    return null;
  }

  // ── 2. RENDER ──
  const htmlPath = join(SELF_TRAIN_DIR, `cycle-${cycleNum}.html`);
  const pngPath = join(SELF_TRAIN_DIR, `cycle-${cycleNum}.png`);
  writeFileSync(htmlPath, html);

  try {
    await capture(`file://${htmlPath}`, pngPath);
  } catch (e) {
    console.log(`  [FAIL] render: ${e.message.slice(0, 50)}`);
  }

  // ── 3. OPUS GRADES (short prompt, just the code) ──
  let opusGrade;
  try {
    const gradeResult = opus(`Grade this UI design (0-1 per dimension, be harsh). Dimensions must be COHERENT — great typography that clashes with the palette means BOTH scores drop.

Score: typography_quality, color_harmony, spatial_composition, motion_elegance, emotional_resonance, craft_visibility, minimalism_coherence, native_integration, visceral_score, behavioral_score, reflective_score, overall_aesthetic, innovation_score, system_creativity, design_distinctiveness, problem_level

Write a 2-sentence critique. Return ONLY JSON: {"scores":{...all 16...},"critique":"..."}

HTML:\n${html.slice(0, 8000)}`);
    const jsonMatch = gradeResult.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      opusGrade = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.log(`  [FAIL] grade: ${e.message.slice(0, 50)}`);
  }

  if (!opusGrade?.scores) {
    // Fallback: use the model's own scores
    try {
      const evalResult = await evaluateDesign({ code: html, screenshot: existsSync(pngPath) ? pngPath : undefined });
      opusGrade = { scores: evalResult.scores, critique: 'Model self-scored (Opus grading failed)' };
    } catch {
      console.log(`  [FAIL] both grading methods failed`);
      return null;
    }
  }

  // Validate scores
  for (const name of SCORE_NAMES) {
    opusGrade.scores[name] = Math.max(0, Math.min(1, opusGrade.scores[name] ?? 0.5));
  }

  const overall = opusGrade.scores.overall_aesthetic;
  const innovation = opusGrade.scores.innovation_score;
  console.log(`  overall=${overall.toFixed(2)} innovation=${innovation.toFixed(2)} | ${opusGrade.critique?.slice(0, 80) || ''}`);

  // ── 4. STORE ──
  let codeFeatures = null;
  try { codeFeatures = Array.from(encodeFromCode(html, { platform: 'web' })); } catch {}

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  manifest.samples.push({
    image: pngPath,
    screenshot_path: existsSync(pngPath) ? pngPath : null,
    scores: opusGrade.scores,
    source: 'opus_self_train',
    confidence: 0.9, // Opus is a strong judge
    code_features: codeFeatures,
    metadata: {
      source_name: `self-train-${cycleNum}`,
      category: 'self-train',
      quality_target: overall > 0.75 ? 'high' : overall > 0.5 ? 'medium' : 'low',
      brief: brief.slice(0, 200),
      critique: opusGrade.critique,
      code_path: htmlPath,
      generated_at: new Date().toISOString(),
    },
  });
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  return { overall, innovation, critique: opusGrade.critique };
}

async function retrain() {
  console.log('\n[retrain] extracting features + training...');
  const mlxDir = join(__dirname, 'mlx');
  try {
    execSync(`python3 ${join(mlxDir, 'extract_features.py')}`, { timeout: 180000, cwd: mlxDir, encoding: 'utf-8' });
    const result = execSync(`python3 ${join(mlxDir, 'train_v2.py')} --epochs 300 --batch 16 --patience 40`, { timeout: 120000, cwd: mlxDir, encoding: 'utf-8' });
    const best = result.split('\n').find(l => l.includes('best val loss'));
    console.log(`[retrain] ${best || 'done'}`);

    // Reload server if running
    try {
      const client = await import('./client.js');
      if (client.isServerRunning()) await client.reload();
    } catch {}
  } catch (e) {
    console.log(`[retrain] failed: ${e.message.slice(0, 50)}`);
  }
}

// ═══════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════

async function main() {
  const totalCycles = process.argv.includes('--forever') ? Infinity :
    parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--cycles') || '10');

  console.log(`\n${'═'.repeat(50)}`);
  console.log('SELF-TRAINING LOOP');
  console.log(`Opus generates → Opus grades → model trains → repeat`);
  console.log(`Cycles: ${totalCycles === Infinity ? 'forever' : totalCycles}`);
  console.log('═'.repeat(50));

  // Ensure server is running
  try {
    execSync(`"${__dirname}/start-server.sh"`, { timeout: 45000, stdio: 'ignore' });
  } catch {}

  const state = loadState();
  let cycleScores = [];

  for (let i = 0; i < totalCycles; i++) {
    const cycleNum = state.totalCycles + i + 1;

    const result = await runCycle(cycleNum);
    if (result) {
      cycleScores.push(result.overall);
      state.totalSamples++;
    }

    // Retrain every 10 successful cycles
    if (cycleScores.length > 0 && cycleScores.length % 10 === 0) {
      await retrain();
      state.retrains++;
      state.lastRetrain = new Date().toISOString();
    }

    state.totalCycles = cycleNum;
    if (cycleScores.length > 0) {
      state.avgOverall = cycleScores.reduce((a, b) => a + b, 0) / cycleScores.length;
    }
    saveState(state);
  }

  await cleanup();

  // Final summary
  console.log(`\n${'═'.repeat(50)}`);
  console.log('COMPLETE');
  console.log(`Cycles: ${state.totalCycles}`);
  console.log(`Samples: ${state.totalSamples}`);
  console.log(`Retrains: ${state.retrains}`);
  if (cycleScores.length > 0) {
    console.log(`Avg overall: ${state.avgOverall.toFixed(3)}`);
    console.log(`Best: ${Math.max(...cycleScores).toFixed(3)}`);
    console.log(`Worst: ${Math.min(...cycleScores).toFixed(3)}`);
  }
  console.log('═'.repeat(50));

  // Cleanup server
  try { execSync('kill $(cat /tmp/design-model-v2.pid) 2>/dev/null'); } catch {}
}

main().catch(e => { console.error(e); process.exit(1); });
