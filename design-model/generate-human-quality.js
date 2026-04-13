#!/usr/bin/env node
/**
 * Generate designs that could fool a human into thinking they're human-made.
 *
 * Strategy: instead of "build a settings panel," give deeply specific creative
 * briefs that force unique solutions — the kind of brief a real designer would get.
 *
 * Each brief specifies:
 *   - A specific, unusual problem to solve
 *   - Constraints that force creative solutions
 *   - Emotional targets
 *   - Anti-patterns to avoid
 *   - A reference aesthetic (but NOT to copy)
 *
 * Usage:
 *   node generate-human-quality.js              # Generate all
 *   node generate-human-quality.js --count 5    # Generate 5
 */

import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { encodeFromCode } from './encoder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const GEN_DIR = join(DATA_DIR, 'human-quality');
const MANIFEST_PATH = join(DATA_DIR, 'manifest.json');

if (!existsSync(GEN_DIR)) mkdirSync(GEN_DIR, { recursive: true });

function claudeGenerate(prompt) {
  const tmpFile = join(tmpdir(), `hq-gen-${Date.now()}.txt`);
  writeFileSync(tmpFile, prompt);
  try {
    return execSync(`cat "${tmpFile}" | claude -p --model sonnet`, {
      encoding: 'utf-8', timeout: 180000, maxBuffer: 4 * 1024 * 1024, shell: '/bin/zsh',
    }).trim();
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

// ═══════════════════════════════════════════════════
// CREATIVE BRIEFS — each one forces a unique solution
// ═══════════════════════════════════════════════════

const BRIEFS = [
  {
    id: 'ambient-weather',
    brief: `Design a weather widget that communicates weather through ambient visuals rather than numbers.
    Instead of "72F and sunny," the entire widget's color palette, texture, and movement should FEEL like the weather.
    Rainy: deep blues, subtle vertical lines, muted. Sunny: warm gradients, gentle glow. Stormy: dark contrasts, sharp angles.
    Show a location name and maybe one temperature number, but the visual IS the forecast.
    The widget is 400x300px, floating over a dark background.
    Use CSS gradients, blend modes, and subtle animation. No weather icons — the design IS the icon.`,
    constraints: 'No traditional weather icons. No data tables. The aesthetics must change with the weather state.',
    emotion: 'calm awareness',
    avoid: 'Generic weather app layout, Bootstrap cards, icon + temperature pattern',
  },
  {
    id: 'sound-visualizer',
    brief: `Design an audio visualizer for a meditation app. Not the typical bouncing bars.
    Instead, create an organic, breathing shape — like a living organism responding to sound.
    Use CSS clip-path, border-radius animation, and gradient shifts to create something that feels alive.
    The shape should breathe slowly (CSS animation), with colors that shift between deep ocean blue and soft violet.
    Below the shape: a single line of text showing the current meditation ("Breathing Space") and a minimal play/pause.
    The entire composition should feel like looking into a deep, calm pool.`,
    constraints: 'No equalizer bars. No waveforms. The visualization must feel organic, not mechanical.',
    emotion: 'deep peace, oceanic calm',
    avoid: 'Standard audio player UI, equalizer patterns, sharp geometric shapes',
  },
  {
    id: 'time-river',
    brief: `Reimagine a timeline/calendar not as a grid but as a flowing river.
    Events are stones in the river — they create ripples. Past events have settled, future events shimmer.
    The river flows left to right. Today is marked by a gentle glow.
    Show 5 events across a week. Each event is a rounded organic shape with a short label.
    Use CSS gradients that flow horizontally, subtle wave animations, and organic border-radius.
    The background should feel like a still pond reflecting twilight.`,
    constraints: 'No grid. No traditional calendar layout. Time is a continuous flow, not discrete boxes.',
    emotion: 'contemplative flow, time as water',
    avoid: 'Grid calendars, traditional timelines with dots and lines, any rectangular event blocks',
  },
  {
    id: 'permission-garden',
    brief: `Design an app permissions screen as a garden metaphor.
    Instead of checkboxes, each permission is a plant. Granted permissions bloom and grow.
    Denied permissions are seeds waiting in soil. The garden has 6 permissions:
    Camera (flower), Microphone (reed), Location (compass rose plant), Contacts (intertwined vines),
    Notifications (bell-shaped flower), Storage (tree).
    Use CSS shapes, gradients, and subtle hover animations. When you hover a seed, it shows what it could become.
    The whole screen should feel nurturing and transparent — asking for permissions becomes tending a garden.`,
    constraints: 'No checkboxes. No toggle switches. Pure metaphorical UI. Each permission is a plant.',
    emotion: 'trust, nurturing, transparency',
    avoid: 'Standard permission dialogs, checkbox lists, modal popups',
  },
  {
    id: 'data-landscape',
    brief: `Design a dashboard that presents business metrics as a landscape painting.
    Revenue is mountain height. Growth rate is sky color (sunset warm = growing, cool blue = stable).
    Customer count is the density of trees. Churn is falling leaves.
    Show actual numbers on hover, but the default view is the landscape.
    Use CSS gradients for sky, clip-path for mountains, small repeated elements for trees.
    The landscape should shift with the data — good months look like spring, tough months like autumn.
    Include a subtle "Last 12 months" label and small sparkline at the bottom edge.`,
    constraints: 'The primary view must be the landscape, not charts. Numbers only appear on interaction.',
    emotion: 'strategic overview, birds-eye perspective',
    avoid: 'Bar charts, line graphs, pie charts, standard dashboard grid, data table',
  },
  {
    id: 'commit-constellation',
    brief: `Design a git commit history as a star constellation.
    Each commit is a star. Branches are visible as constellation lines.
    Recent commits glow brighter. Large commits are larger stars. Merge commits are where lines converge.
    Show 15 commits across 3 branches over the last week.
    The background is a deep space gradient. Commit messages appear as whisper-thin labels.
    Use CSS transforms for positioning, box-shadow for glow, and subtle twinkle animations.
    Include a tiny legend showing branch colors.`,
    constraints: 'No traditional git log format. No list view. Spatial, astronomical representation.',
    emotion: 'wonder, cosmic perspective on mundane work',
    avoid: 'Traditional git tree, linear commit log, GitHub contribution graph',
  },
  {
    id: 'emotion-journal',
    brief: `Design a mood tracking entry screen that uses color and texture instead of emoji.
    Instead of picking a smiley face, the user touches/hovers an abstract color field that shifts between:
    Joy (warm gold-amber), Calm (soft sage-mint), Energy (electric coral), Melancholy (deep indigo-grey),
    Tension (sharp red-orange gradient).
    The color field is a large abstract shape that fills most of the screen.
    Below: a single-line text input ("How are you feeling?") and a tiny timestamp.
    The selected mood becomes the entire screen's ambiance.
    Use oklch colors, smooth transitions, and backdrop-filter for depth.`,
    constraints: 'No emoji. No mood scales. No dropdown menus. Color IS the input.',
    emotion: 'introspection, emotional honesty',
    avoid: 'Emoji pickers, 1-10 scales, dropdown selectors, standard form inputs',
  },
  {
    id: 'focus-hourglass',
    brief: `Design a Pomodoro/focus timer as an hourglass that uses particle physics.
    Sand particles (small dots) fall from top to bottom through a narrow waist.
    The particles accumulate at the bottom, forming a pile. Time remaining is shown by the sand level.
    Use CSS animations with randomized particle positions and falling speeds.
    The hourglass frame is a minimal elegant outline. Below: the current focus session name and a pause button.
    When the timer completes, the particles gently explode outward like a celebration.
    Colors: warm amber sand on a deep charcoal background.`,
    constraints: 'No circular timer. No progress bar. Physical sand simulation with CSS particles.',
    emotion: 'focused presence, gentle urgency',
    avoid: 'Circular countdown, linear progress bar, digital clock display',
  },
  {
    id: 'password-forge',
    brief: `Design a password creation UI as a blacksmith's forge metaphor.
    The password is being "forged" — weak passwords show cold, dull metal. As the password strengthens,
    the metal heats up: cold grey → warm red → bright orange → white hot → solid steel.
    Character types add different properties: numbers add structural rivets, symbols add sharp edges,
    uppercase adds weight/thickness, length adds size.
    Show the password input at top, the forging visualization in the center, and strength indicators as
    material properties ("Tensile Strength: HIGH", "Corrosion Resistance: MEDIUM").
    Use CSS gradients, glow effects, and subtle heat shimmer animation.`,
    constraints: 'No traditional password strength bar. No red/yellow/green indicator. Metallurgy metaphor throughout.',
    emotion: 'craftmanship, pride in creating something strong',
    avoid: 'Standard password strength bars, traffic light colors, generic password requirements list',
  },
  {
    id: 'notification-aquarium',
    brief: `Design a notification center as a serene aquarium.
    Each notification is a fish — urgent ones are bright tropical fish that swim actively.
    Read notifications settle to the bottom as calm bottom-feeders.
    Grouped notifications (from same app) swim in schools.
    The aquarium has gentle blue-green gradients, subtle caustic light patterns, and plant decorations.
    Tapping a fish (notification) expands it into a readable card.
    Show 6 notifications as fish, with 2 from the same app swimming together.
    Use CSS animations for swimming motion (figure-8 paths), and clip-path for fish shapes.`,
    constraints: 'No notification list. No badges. Pure aquatic metaphor. Fish ARE the notifications.',
    emotion: 'calm delight, playful information retrieval',
    avoid: 'Notification lists, badge counts, standard notification drawer, bell icons',
  },
  {
    id: 'music-terrain',
    brief: `Design a music library browser where genres are terrains on a landscape.
    Jazz is rolling hills with warm earth tones. Electronic is a crystalline geometric cityscape.
    Classical is a grand mountain range. Hip-hop is an urban skyline at dusk. Folk is gentle meadows.
    The user's library is mapped across this terrain. Album count determines region size.
    Currently playing track creates a gentle pulse from its genre region.
    Show 5 genre regions with 2-3 album names visible in each.
    Use CSS clip-path for terrain shapes, gradients for atmosphere, and subtle parallax on hover.`,
    constraints: 'No list view. No album grid. Geographic/terrain metaphor for music discovery.',
    emotion: 'exploration, discovery, musical wanderlust',
    avoid: 'Album grid, playlist list, standard music library UI, cover art thumbnails',
  },
  {
    id: 'breathing-search',
    brief: `Design a search interface that breathes with the user.
    The search input pulses gently (scale animation) in rhythm with a calm breathing pattern.
    As the user types, the pulse responds — faster typing speeds up the pulse, pauses slow it.
    Results appear as floating, gently drifting cards around the search input (radial layout, not list).
    Each result card is minimal: title + one-line preview. They orbit the search input at different distances
    based on relevance. The closest results are the most relevant.
    Background is a soft, warm gradient that shifts color based on the query topic.`,
    constraints: 'No traditional search results list. Radial layout. The interface itself breathes.',
    emotion: 'mindful searching, calm information discovery',
    avoid: 'Standard search results page, blue links, paginated list, Google-style layout',
  },
];

const SYSTEM_PROMPT = `You are a world-class product designer creating UI artifacts that are indistinguishable from human-made designs.

CRITICAL RULES:
1. NO generic AI aesthetics. No centered hero + 3 cards. No gradient backgrounds with Inter font.
2. Every design choice must have a REASON. If you use a color, know why. If you choose a font, justify it.
3. Use NOVEL CSS: oklch colors, container queries, :has(), view transitions, scroll-driven animations where appropriate.
4. Create a COHESIVE visual language — every element must feel like it belongs to the same design system.
5. Think about the RELATIONSHIPS between elements. Typography must fit the color palette. Spacing must match the emotional tone. Motion must serve the content.
6. Imperfections are human. Perfect symmetry is AI. Add subtle organic asymmetry, intentional weights, visual tension.
7. The design should solve a REAL problem in an UNEXPECTED way.

Return ONLY the complete HTML with all CSS inline. No markdown, no explanation, no code fences.
The viewport is 1440x900. Make it look like a real app, not a component in isolation.`;

async function generateDesign(brief, browser) {
  console.log(`  [${brief.id}] generating...`);

  const prompt = `${SYSTEM_PROMPT}

CREATIVE BRIEF:
${brief.brief}

CONSTRAINTS: ${brief.constraints}
EMOTIONAL TARGET: ${brief.emotion}
AVOID: ${brief.avoid}

Create this as a full-screen HTML page (1440x900 viewport). Make it feel like a real, shipping product — not a prototype or mockup. Include micro-details that only a human designer would think of. Surprise me.`;

  let html;
  try {
    html = claudeGenerate(prompt);
  } catch (e) {
    console.log(`    [FAIL] generation: ${e.message.slice(0, 50)}`);
    return null;
  }

  const match = html.match(/```html\n?([\s\S]*?)\n?```/);
  if (match) html = match[1];
  if (!html.includes('<') || html.length < 200) {
    console.log(`    [FAIL] invalid HTML (${html.length} chars)`);
    return null;
  }

  // Save HTML
  const htmlPath = join(GEN_DIR, `${brief.id}.html`);
  writeFileSync(htmlPath, html);

  // Render to PNG
  const pngPath = join(GEN_DIR, `${brief.id}.png`);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0', timeout: 15000 });
    await new Promise(r => setTimeout(r, 1000)); // Let CSS animations start
    await page.screenshot({ path: pngPath, type: 'png', fullPage: false });
    await page.close();
  } catch (e) {
    console.log(`    [FAIL] screenshot: ${e.message.slice(0, 50)}`);
  }

  // Extract code features
  let codeFeatures = null;
  try {
    codeFeatures = Array.from(encodeFromCode(html, { platform: 'web', targetEmotion: 0.85 }));
  } catch {}

  // These are HIGH quality designs with potentially HIGH innovation
  // Score conservatively — the human will re-grade them
  const sample = {
    image: pngPath,
    screenshot_path: existsSync(pngPath) ? pngPath : null,
    scores: {
      typography_quality: 0.7, color_harmony: 0.75, spatial_composition: 0.72,
      motion_elegance: 0.7, emotional_resonance: 0.78, craft_visibility: 0.73,
      minimalism_coherence: 0.7, native_integration: 0.5,
      visceral_score: 0.76, behavioral_score: 0.68, reflective_score: 0.74,
      overall_aesthetic: 0.72,
      innovation_score: 0.75, system_creativity: 0.72,
      design_distinctiveness: 0.78, problem_level: 0.7,
    },
    source: 'ai_human_quality',
    code_features: codeFeatures,
    metadata: {
      source_name: brief.id,
      category: 'human-quality-gen',
      quality_target: 'innovative',
      brief: brief.brief.slice(0, 200),
      emotion_target: brief.emotion,
      constraints: brief.constraints.slice(0, 200),
      code_path: htmlPath,
      generated_at: new Date().toISOString(),
    },
  };

  console.log(`    [OK] ${brief.id} → ${pngPath}`);
  return sample;
}

async function main() {
  const count = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--count') || BRIEFS.length);
  const briefs = BRIEFS.slice(0, count);

  console.log(`\nGenerating ${briefs.length} human-quality designs...\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const samples = [];
  for (const brief of briefs) {
    const sample = await generateDesign(brief, browser);
    if (sample) samples.push(sample);
  }

  await browser.close();

  // Update manifest
  const manifest = existsSync(MANIFEST_PATH)
    ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
    : { samples: [] };

  manifest.samples.push(...samples);
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log(`\nGenerated: ${samples.length} human-quality designs`);
  console.log(`Total manifest: ${manifest.samples.length} samples`);
}

main().catch(e => { console.error(e); process.exit(1); });
