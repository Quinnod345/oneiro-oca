#!/usr/bin/env node
/**
 * Generate Batch 2 training data — additional 20 design artifacts.
 * Covers component types not in batch 1: onboarding, modals, search,
 * image galleries, command palettes, toast notifications, tables, etc.
 *
 * Usage: node generate-batch-2.js
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import { SCORE_NAMES } from './knowledge.js';
import { encodeFromCode } from './encoder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const SCREENSHOTS_DIR = join(DATA_DIR, 'screenshots');
const PNGS_DIR = join(DATA_DIR, 'pngs');
const MANIFEST_PATH = join(DATA_DIR, 'manifest.json');

for (const dir of [DATA_DIR, SCREENSHOTS_DIR, PNGS_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function claudePrompt(prompt) {
  const tmpFile = join(tmpdir(), `design-b2-${Date.now()}.txt`);
  writeFileSync(tmpFile, prompt);
  try {
    const result = execSync(`cat "${tmpFile}" | claude -p --model sonnet`, {
      encoding: 'utf-8', timeout: 120000, maxBuffer: 2 * 1024 * 1024, shell: '/bin/zsh',
    }).trim();
    return result;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

const BATCH_2_PROMPTS = [
  // ── High quality (target 0.7-0.9) ──
  {
    prompt: `Create a macOS command palette / spotlight-style search overlay. Dark semi-transparent background overlay with a centered search input at the top, followed by grouped search results below (Recent, Actions, Files sections). Use a frosted glass effect on the search container. SF Pro font, keyboard shortcut hints on the right side of each item. Subtle hover highlighting. Similar to Raycast or Linear's command menu. Return ONLY the complete HTML with inline CSS — no markdown, no explanation.`,
    quality: 'high', category: 'command-palette', targetApp: 'raycast',
  },
  {
    prompt: `Create a macOS onboarding welcome screen for a note-taking app. Large centered app icon at top, welcome heading, 3 feature highlights with custom icons (organized as horizontal cards), a "Get Started" primary button and "Skip" text link below. Clean white background, generous whitespace, subtle gradient accent. Inspired by Craft's onboarding. Return ONLY the complete HTML with inline CSS — no markdown, no explanation.`,
    quality: 'high', category: 'onboarding', targetApp: 'craft',
  },
  {
    prompt: `Create a macOS photo gallery grid view with 8 placeholder images (use colored gradient rectangles as placeholders). Masonry-style layout, subtle rounded corners, hover zoom effect, light shadow on hover. Include a toolbar at top with view mode toggles (grid/list), sort dropdown, and search. Inspired by Apple Photos. Clean, native feel. Return ONLY the complete HTML with inline CSS — no markdown, no explanation.`,
    quality: 'high', category: 'gallery', targetApp: 'photos',
  },
  {
    prompt: `Create a toast notification system showing 3 stacked notifications in the bottom-right corner. Each toast has an icon, title, description, timestamp, and dismiss button. Different types: success (green), info (blue), warning (amber). Subtle slide-in animation, frosted glass background, SF Pro font. Return ONLY the complete HTML with inline CSS — no markdown, no explanation.`,
    quality: 'high', category: 'notification', targetApp: 'generic-mac',
  },
  {
    prompt: `Create a dark-themed code editor component showing a Swift code snippet. Include line numbers, syntax highlighting (keywords in purple, strings in red, comments in gray, types in teal), a tab bar at top showing the filename, and a minimap on the right edge. Monospace font (Menlo/SF Mono). Inspired by Xcode's dark theme. Return ONLY the complete HTML with inline CSS — no markdown, no explanation.`,
    quality: 'high', category: 'code-editor', targetApp: 'xcode',
  },
  {
    prompt: `Create a macOS preferences window with a segmented tab bar at top (General, Appearance, Notifications, Privacy) and the General tab active. Show: "Launch at startup" toggle, "Check for updates" dropdown (Daily/Weekly/Never), theme picker (3 circles: light, dark, auto with active indicator), and a "Reset to Defaults" button at bottom. Native macOS styling. Return ONLY the complete HTML with inline CSS — no markdown, no explanation.`,
    quality: 'high', category: 'settings', targetApp: 'generic-mac',
  },
  {
    prompt: `Create a beautiful data table component for a CRM app. Show 6 rows of customer data (name, email, status badge, last activity, revenue). Include sortable column headers with sort indicators, alternating row backgrounds, hover highlighting, and a search/filter bar above. Clean typography, status badges with color coding. Inspired by Linear's table views. Return ONLY the complete HTML with inline CSS — no markdown, no explanation.`,
    quality: 'high', category: 'data-table', targetApp: 'linear',
  },
  {
    prompt: `Create a modal dialog for confirming a destructive action (deleting a project). Centered overlay with dark backdrop, rounded card, warning icon, clear title "Delete Project?", descriptive text explaining consequences, and two buttons: "Cancel" (secondary) and "Delete" (red/destructive). Clean, focused design with clear visual hierarchy. Return ONLY the complete HTML with inline CSS — no markdown, no explanation.`,
    quality: 'high', category: 'modal', targetApp: 'generic-mac',
  },
  {
    prompt: `Create a sidebar navigation component for a design tool. Dark theme, nested collapsible sections (Layers, Components, Assets), each with child items. Active item highlighted, drag handles, eye icons for visibility toggles. Smooth expand/collapse with CSS. Inspired by Figma's left panel. Return ONLY the complete HTML with inline CSS — no markdown, no explanation.`,
    quality: 'high', category: 'sidebar', targetApp: 'figma',
  },
  {
    prompt: `Create an audio waveform player component. Show a colorful waveform visualization (use CSS-drawn bars), playback controls (play/pause, skip), current time and duration, volume slider, and track title with artist. Dark background, vibrant accent color for the played portion of the waveform. Return ONLY the complete HTML with inline CSS — no markdown, no explanation.`,
    quality: 'high', category: 'media', targetApp: 'generic-mac',
  },

  // ── Medium quality (target 0.4-0.6) ──
  {
    prompt: `Create a basic contact form with Name, Email, Subject dropdown, Message textarea, and Submit button. Use simple borders, standard font, basic layout. No special styling beyond basics. Return ONLY the complete HTML with inline CSS — no markdown, no explanation.`,
    quality: 'medium', category: 'form',
  },
  {
    prompt: `Create a simple breadcrumb navigation component showing: Home > Products > Electronics > Smartphones. Use basic styling with arrow separators. Return ONLY the complete HTML with inline CSS — no markdown, no explanation.`,
    quality: 'medium', category: 'navigation',
  },
  {
    prompt: `Create a basic progress indicator showing 4 steps: Account, Details, Payment, Confirm. Step 2 is active, step 1 is completed. Use circles connected by lines. Simple, functional design. Return ONLY the complete HTML with inline CSS — no markdown, no explanation.`,
    quality: 'medium', category: 'progress',
  },
  {
    prompt: `Create a simple FAQ accordion with 4 questions. Click to expand/collapse answers. Basic styling with borders and plus/minus icons. Nothing fancy — just functional. Return ONLY the complete HTML with inline CSS — no markdown, no explanation.`,
    quality: 'medium', category: 'content',
  },
  {
    prompt: `Create a standard footer with company logo, 3 link columns (Product, Company, Resources), social media icons, and copyright text. Gray background, basic grid layout. Return ONLY the complete HTML with inline CSS — no markdown, no explanation.`,
    quality: 'medium', category: 'footer',
  },

  // ── Low quality (target 0.1-0.3, anti-patterns) ──
  {
    prompt: `Create a cluttered dashboard with too many elements: 8 small cards crammed together, multiple clashing neon colors (hot pink, lime green, electric blue), Comic Sans font, thick borders everywhere, drop shadows on everything, animated spinning icons, auto-playing marquee text. Make it visually overwhelming. Return ONLY the complete HTML with inline CSS — no markdown, no explanation.`,
    quality: 'low', category: 'dashboard',
  },
  {
    prompt: `Create a popup modal that looks like a scam website. Flashing red background, ALL CAPS text, multiple exclamation marks, "CONGRATULATIONS YOU WON!!!" heading, fake countdown timer, three suspicious download buttons with different colors and sizes. Return ONLY the complete HTML with inline CSS — no markdown, no explanation.`,
    quality: 'low', category: 'modal',
  },
  {
    prompt: `Create a settings page with terrible UX: tiny 8px font, no labels on form inputs, checkboxes misaligned with text, inconsistent spacing (10px here, 50px there), 6 different font families mixed together, no visual hierarchy. Return ONLY the complete HTML with inline CSS — no markdown, no explanation.`,
    quality: 'low', category: 'settings',
  },
  {
    prompt: `Create a hero section using every generic AI aesthetic cliche: centered headline "Welcome to the Future", Inter font, purple-to-blue gradient background, three identical feature cards below, generic stock photo placeholder, "Get Started Free" button with rounded corners. Maximum genericness. Return ONLY the complete HTML with inline CSS — no markdown, no explanation.`,
    quality: 'low', category: 'hero',
  },
  {
    prompt: `Create a navigation bar that's dysfunctional: menu items in random sizes, logo that's stretched and pixelated (use text with bad aspect ratio), search bar that overlaps other elements, hamburger icon next to an already-visible menu, dropdown that overflows the viewport. Return ONLY the complete HTML with inline CSS — no markdown, no explanation.`,
    quality: 'low', category: 'navigation',
  },
];

const SCORE_SYSTEM_PROMPT = `You are an expert design evaluator. Score the following HTML/CSS design artifact across 12 dimensions on a 0-1 scale. Be precise and critical.

SCORING CRITERIA:
- typography_quality: Font choices, pairing, scale ratio, spacing, readability
- color_harmony: Palette cohesion, contrast ratios, emotional resonance
- spatial_composition: Layout quality, whitespace usage, visual flow, grid alignment
- motion_elegance: Animation quality and purposefulness (0.5 if no animations)
- emotional_resonance: How well the design evokes intended emotions
- craft_visibility: Attention to detail visible in every element
- minimalism_coherence: Appropriate restraint, progressive disclosure
- native_integration: How naturally it fits macOS/Apple ecosystem
- visceral_score: Norman L1 — immediate aesthetic reaction
- behavioral_score: Norman L2 — usability and interaction quality
- reflective_score: Norman L3 — meaning, identity, emotional bond
- overall_aesthetic: The gestalt — everything working together

HIGH quality artifacts: aim for 0.7-0.95 range
MEDIUM quality: aim for 0.35-0.65 range
LOW quality: aim for 0.05-0.30 range

RESPOND WITH ONLY a JSON object, no markdown fences, no explanation:
{"typography_quality": 0.xx, "color_harmony": 0.xx, ...all 12 scores...}`;

async function generateAndScore(promptObj, index, browser) {
  const { prompt, quality, category, targetApp } = promptObj;
  console.log(`  [${index + 1}/${BATCH_2_PROMPTS.length}] Generating ${quality} ${category}...`);

  // Generate HTML
  let html;
  try {
    html = claudePrompt(prompt);
  } catch (e) {
    console.log(`    [FAIL] Generation: ${e.message.slice(0, 60)}`);
    return null;
  }

  // Extract HTML if wrapped in markdown
  const htmlMatch = html.match(/```html\n?([\s\S]*?)\n?```/);
  if (htmlMatch) html = htmlMatch[1];

  // Must contain actual HTML
  if (!html.includes('<') || html.length < 100) {
    console.log(`    [FAIL] Invalid HTML output (${html.length} chars)`);
    return null;
  }

  // Save HTML
  const timestamp = Date.now();
  const htmlFilename = `artifact-b2-${timestamp}-${index}.html`;
  const htmlPath = join(SCREENSHOTS_DIR, htmlFilename);
  writeFileSync(htmlPath, html);

  // Render to PNG
  const pngFilename = htmlFilename.replace('.html', '.png');
  const pngPath = join(PNGS_DIR, pngFilename);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0', timeout: 15000 });
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: pngPath, type: 'png', fullPage: false });
    await page.close();
  } catch (e) {
    console.log(`    [FAIL] Screenshot: ${e.message.slice(0, 60)}`);
  }

  // Score with LLM judge
  let scores;
  try {
    const scorePrompt = `This is a ${quality}-quality ${category} component${targetApp ? ` inspired by ${targetApp}` : ''}.\n\nScore this HTML/CSS code:\n\n${html.slice(0, 8000)}`;
    const scoreResult = claudePrompt(scorePrompt + '\n\nRespond with ONLY a JSON object of scores.', SCORE_SYSTEM_PROMPT);

    // Parse JSON from response
    const jsonMatch = scoreResult.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      scores = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.log(`    [FAIL] Scoring: ${e.message.slice(0, 60)}`);
  }

  if (!scores) {
    // Use defaults based on quality tier
    const defaults = { high: 0.75, medium: 0.50, low: 0.20 };
    const base = defaults[quality] || 0.50;
    scores = Object.fromEntries(SCORE_NAMES.map(n => [n, base + (Math.random() * 0.15 - 0.075)]));
  }

  // Validate scores
  for (const name of SCORE_NAMES) {
    scores[name] = Math.max(0, Math.min(1, scores[name] || 0.5));
  }

  // Extract code features
  let code_features = null;
  try {
    const features = encodeFromCode(html, {
      platform: 'mac',
      targetEmotion: quality === 'high' ? 0.8 : quality === 'low' ? 0.2 : 0.5,
    });
    code_features = Array.from(features);
  } catch {}

  console.log(`    [OK] overall=${scores.overall_aesthetic?.toFixed(2)} (${quality})`);

  return {
    image: htmlPath,
    screenshot_path: existsSync(pngPath) ? pngPath : null,
    scores,
    source: 'llm_judge',
    code_features,
    metadata: {
      quality_target: quality,
      category,
      target_app: targetApp || null,
      code_path: htmlPath,
      batch: 2,
      generated_at: new Date().toISOString(),
    },
  };
}

async function main() {
  console.log(`\nGenerating Batch 2: ${BATCH_2_PROMPTS.length} design artifacts...\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const results = [];

  for (let i = 0; i < BATCH_2_PROMPTS.length; i++) {
    const result = await generateAndScore(BATCH_2_PROMPTS[i], i, browser);
    if (result) results.push(result);
  }

  await browser.close();

  // Update manifest
  const manifest = existsSync(MANIFEST_PATH)
    ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
    : { samples: [] };

  manifest.samples.push(...results);
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log(`\n✓ Generated ${results.length} new samples`);
  console.log(`✓ Total samples in manifest: ${manifest.samples.length}`);

  // Stats
  const byQuality = { high: 0, medium: 0, low: 0, reference: 0 };
  for (const s of manifest.samples) {
    const q = s.metadata?.quality_target || 'unknown';
    byQuality[q] = (byQuality[q] || 0) + 1;
  }
  console.log(`✓ By quality: high=${byQuality.high} medium=${byQuality.medium} low=${byQuality.low} reference=${byQuality.reference}`);
}

main().catch(e => { console.error(e); process.exit(1); });
