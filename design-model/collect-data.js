#!/usr/bin/env node
/**
 * Design Training Data Collector
 *
 * Generates design artifacts, renders them, screenshots them, and scores them
 * using LLM-as-judge. Also accepts manually added reference screenshots.
 *
 * Usage:
 *   node collect-data.js generate 20     # Generate 20 scored artifacts
 *   node collect-data.js score <path>     # Score an existing screenshot
 *   node collect-data.js stats            # Show dataset statistics
 *   node collect-data.js reference <path> <quality>  # Add reference screenshot (quality: high/medium/low)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { SCORE_NAMES, DESIGN_DIMENSIONS, REFERENCE_APPS, ANTI_PATTERNS } from './knowledge.js';
import { encodeFromCode } from './encoder.js';
import { loadModel } from './model.js';

function claudePrompt(prompt, systemPrompt = null) {
  const tmpPrompt = join(tmpdir(), `design-prompt-${Date.now()}.txt`);
  writeFileSync(tmpPrompt, prompt);
  try {
    let cmd = `cat "${tmpPrompt}" | claude -p --model sonnet`;
    if (systemPrompt) {
      const tmpSystem = join(tmpdir(), `design-system-${Date.now()}.txt`);
      writeFileSync(tmpSystem, systemPrompt);
      cmd = `cat "${tmpPrompt}" | claude -p --model sonnet --append-system-prompt "$(cat '${tmpSystem}')"`;
    }
    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
      shell: '/bin/zsh',
    }).trim();
    return result;
  } finally {
    try { unlinkSync(tmpPrompt); } catch {}
  }
}

const DATA_DIR = new URL('./data/', import.meta.url).pathname;
const SCREENSHOTS_DIR = DATA_DIR + 'screenshots/';
const MANIFEST_PATH = DATA_DIR + 'manifest.json';

// Ensure directories exist
for (const dir of [DATA_DIR, SCREENSHOTS_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ═══════════════════════════════════════════════════
// DESIGN ARTIFACT GENERATORS
// ═══════════════════════════════════════════════════

const COMPONENT_PROMPTS = [
  // High-quality targets (should score 0.7-0.9)
  {
    prompt: 'A macOS menu bar app settings panel with toggle switches, inspired by Alcove. Dark theme, SF Pro font, subtle shadows, native macOS feel. Include a section header, 4 toggle options with descriptions, and a "Done" button.',
    quality: 'high',
    category: 'settings',
    targetApp: 'alcove',
  },
  {
    prompt: 'A minimal task list component inspired by Things 3. Clean white background, refined typography with a display font for the header, subtle separators, checkbox animations. Show 5 tasks with priorities.',
    quality: 'high',
    category: 'productivity',
    targetApp: 'things3',
  },
  {
    prompt: 'A writing editor toolbar inspired by Bear. Markdown formatting buttons with subtle hover states, clean typography, warm neutral palette. Show bold, italic, heading, link, and code buttons.',
    quality: 'high',
    category: 'writing',
    targetApp: 'bear',
  },
  {
    prompt: 'A notification card that slides in from the right, inspired by NotchNook. Dark background with subtle blur, app icon, title, message, and action buttons. Fluid, modern design.',
    quality: 'high',
    category: 'notification',
    targetApp: 'notchnook',
  },
  {
    prompt: 'A calendar day view with events, inspired by Fantastical. Clean layout, color-coded events, time markers, weather widget in the corner. Modern, polished UI.',
    quality: 'high',
    category: 'calendar',
    targetApp: 'fantastical',
  },
  {
    prompt: 'A project issue card inspired by Linear. Sharp minimalism, purple accent, assignee avatar, status badge, priority indicator. Dark theme with warmer grays.',
    quality: 'high',
    category: 'project-management',
    targetApp: 'linear',
  },
  {
    prompt: 'A music player mini-widget with album art, playback controls, progress bar, and song info. Inspired by Apple Music. Dark theme, translucent elements, SF Symbols-style icons.',
    quality: 'high',
    category: 'media',
    targetApp: 'apple-music',
  },
  {
    prompt: 'A file browser sidebar with nested folders, icons, and a search bar. Inspired by Finder. Clean macOS aesthetic, system colors, disclosure triangles, selection highlighting.',
    quality: 'high',
    category: 'file-management',
    targetApp: 'finder',
  },
  {
    prompt: 'A keyboard shortcut reference card/cheat sheet overlay. Clean grid layout, keyboard key styling, grouped by category. Inspired by premium Mac apps.',
    quality: 'high',
    category: 'utility',
    targetApp: 'generic-mac',
  },
  {
    prompt: 'A data visualization dashboard card with a line chart, key metrics, and trend indicators. Minimal design, clear hierarchy, subtle grid lines. Professional but warm.',
    quality: 'high',
    category: 'analytics',
    targetApp: 'craft',
  },

  // Medium-quality targets (should score 0.4-0.6)
  {
    prompt: 'A basic login form with email and password fields, a submit button, and a "forgot password" link. Use standard styling, nothing fancy.',
    quality: 'medium',
    category: 'auth',
  },
  {
    prompt: 'A pricing table with three tiers (Free, Pro, Enterprise). Standard card layout with feature lists and CTA buttons.',
    quality: 'medium',
    category: 'marketing',
  },
  {
    prompt: 'A user profile card with avatar, name, bio, and social links. Clean but generic design.',
    quality: 'medium',
    category: 'social',
  },
  {
    prompt: 'A simple navigation bar with logo, menu items, and a hamburger menu icon. Responsive but basic.',
    quality: 'medium',
    category: 'navigation',
  },
  {
    prompt: 'A cookie consent banner at the bottom of the page. Accept/Reject buttons, brief privacy text.',
    quality: 'medium',
    category: 'utility',
  },

  // Low-quality targets (should score 0.1-0.3, anti-patterns)
  {
    prompt: 'A hero section with a centered headline, subtitle, and CTA button. Use Inter font, a purple-to-blue gradient background, and rounded corners on everything. Add three feature cards below.',
    quality: 'low',
    category: 'marketing',
    antiPatterns: ['generic_ai_aesthetics', 'cliched_colors', 'overused_fonts'],
  },
  {
    prompt: 'A dashboard with every feature visible at once — charts, tables, notifications, settings, all crammed into one screen. Use default Bootstrap styling.',
    quality: 'low',
    category: 'dashboard',
    antiPatterns: ['framework_defaults', 'predictable_layouts'],
  },
  {
    prompt: 'A landing page with floating decorative blobs, a gradient mesh background, excessive animations, and too many different fonts. Style over substance.',
    quality: 'low',
    category: 'marketing',
    antiPatterns: ['decoration_without_purpose', 'inconsistent_system'],
  },
];

// ═══════════════════════════════════════════════════
// LLM SCORING PROMPT
// ═══════════════════════════════════════════════════

const SCORING_SYSTEM = `You are an expert design critic. Score this HTML/CSS design artifact on 12 dimensions.
Use 0.0 (worst) to 1.0 (best). Be calibrated:
- 0.0-0.2: Actively bad design, anti-patterns present
- 0.2-0.4: Below average, generic or careless
- 0.4-0.6: Average, competent but unremarkable
- 0.6-0.8: Good, thoughtful and intentional
- 0.8-1.0: Exceptional, Apple Design Award caliber (Things 3, Alcove, Bear)

Reference standard: Things 3 ≈ 0.9, Generic Tailwind template ≈ 0.4, Bootstrap default ≈ 0.3

Respond with ONLY a JSON object, nothing else:
{"typography_quality":0.X,"color_harmony":0.X,"spatial_composition":0.X,"motion_elegance":0.X,"emotional_resonance":0.X,"craft_visibility":0.X,"minimalism_coherence":0.X,"native_integration":0.X,"visceral_score":0.X,"behavioral_score":0.X,"reflective_score":0.X,"overall_aesthetic":0.X}`;

// ═══════════════════════════════════════════════════
// MANIFEST MANAGEMENT
// ═══════════════════════════════════════════════════

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) return { samples: [] };
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  } catch {
    return { samples: [] };
  }
}

function saveManifest(manifest) {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

function addSample(manifest, sample) {
  manifest.samples.push(sample);
  saveManifest(manifest);
}

// ═══════════════════════════════════════════════════
// GENERATION + SCORING
// ═══════════════════════════════════════════════════

async function generateAndScore(componentPrompt, index) {
  const manifest = loadManifest();
  const timestamp = Date.now();
  const filename = `artifact-${timestamp}-${index}`;

  console.log(`\n[${index}] Generating: ${componentPrompt.prompt.slice(0, 80)}...`);
  console.log(`    Target quality: ${componentPrompt.quality}`);

  // Step 1: Generate the design artifact using Claude
  const genPrompt = `Create a single, self-contained HTML file with embedded CSS that renders this component:

${componentPrompt.prompt}

Requirements:
- Must be a complete HTML file that renders standalone
- All CSS must be inline or in a <style> tag
- Use distinctive, non-generic fonts (Google Fonts or system fonts — NOT Inter, Roboto, or Arial)
- The design should be ${componentPrompt.quality === 'high' ? 'exceptional — Apple Design Award caliber' : componentPrompt.quality === 'low' ? 'deliberately generic with common anti-patterns' : 'competent but unremarkable'}
- Max 200 lines of code
- Dark mode preferred unless the design calls for light

Return ONLY the HTML code, no explanation.`;

  let code;
  try {
    code = claudePrompt(genPrompt);

    // Strip markdown fences
    code = code.replace(/^```html?\n?/m, '').replace(/\n?```$/m, '').trim();

    if (!code.includes('<') || code.length < 50) {
      console.log('    ⚠ Generation too short, skipping');
      return null;
    }
  } catch (err) {
    console.log('    ⚠ Generation failed:', err.message?.slice(0, 100));
    return null;
  }

  // Save the HTML file
  const htmlPath = SCREENSHOTS_DIR + filename + '.html';
  writeFileSync(htmlPath, code);

  // Step 2: Score the artifact using Claude
  const scorePrompt = `Score this design artifact:\n\n\`\`\`html\n${code.slice(0, 5000)}\n\`\`\``;

  let scores;
  try {
    const scoreResponse = claudePrompt(scorePrompt, SCORING_SYSTEM);

    const jsonMatch = scoreResponse.match(/\{[^}]+\}/s);
    if (!jsonMatch) throw new Error('No JSON in response');
    scores = JSON.parse(jsonMatch[0]);

    // Validate all 12 dimensions
    for (const name of SCORE_NAMES) {
      if (typeof scores[name] !== 'number') scores[name] = 0.5;
      scores[name] = Math.max(0, Math.min(1, scores[name]));
    }
  } catch (err) {
    console.log('    ⚠ Scoring failed:', err.message?.slice(0, 100));
    return null;
  }

  // Step 3: Extract code features
  const codeFeatures = Array.from(encodeFromCode(code, {
    platform: 'mac',
    targetEmotion: componentPrompt.quality === 'high' ? 0.8 : componentPrompt.quality === 'low' ? 0.2 : 0.5,
    iterationNumber: 0,
  }));

  // Step 4: Save to manifest
  const sample = {
    image: htmlPath, // Will be replaced with screenshot path when rendered
    scores,
    source: 'llm_judge',
    code_features: codeFeatures,
    metadata: {
      prompt: componentPrompt.prompt.slice(0, 200),
      quality_target: componentPrompt.quality,
      category: componentPrompt.category,
      targetApp: componentPrompt.targetApp || null,
      antiPatterns: componentPrompt.antiPatterns || [],
      generated_at: new Date().toISOString(),
      code_path: htmlPath,
    },
  };

  addSample(manifest, sample);

  console.log(`    ✅ Scored: overall=${scores.overall_aesthetic?.toFixed(2)} visceral=${scores.visceral_score?.toFixed(2)} craft=${scores.craft_visibility?.toFixed(2)}`);

  return sample;
}

// ═══════════════════════════════════════════════════
// REFERENCE SCREENSHOT SCORING
// ═══════════════════════════════════════════════════

async function scoreReference(imagePath, quality = 'high') {
  const manifest = loadManifest();

  if (!existsSync(imagePath)) {
    console.log(`File not found: ${imagePath}`);
    return null;
  }

  // Assign scores based on quality tier (human-calibrated anchors)
  const qualityScores = {
    high: {  // Apple Design Award caliber
      typography_quality: 0.85, color_harmony: 0.85, spatial_composition: 0.85,
      motion_elegance: 0.80, emotional_resonance: 0.85, craft_visibility: 0.90,
      minimalism_coherence: 0.85, native_integration: 0.90,
      visceral_score: 0.85, behavioral_score: 0.85, reflective_score: 0.85,
      overall_aesthetic: 0.87,
    },
    medium: {
      typography_quality: 0.50, color_harmony: 0.50, spatial_composition: 0.50,
      motion_elegance: 0.45, emotional_resonance: 0.45, craft_visibility: 0.50,
      minimalism_coherence: 0.50, native_integration: 0.45,
      visceral_score: 0.50, behavioral_score: 0.50, reflective_score: 0.45,
      overall_aesthetic: 0.48,
    },
    low: {
      typography_quality: 0.20, color_harmony: 0.20, spatial_composition: 0.25,
      motion_elegance: 0.15, emotional_resonance: 0.15, craft_visibility: 0.20,
      minimalism_coherence: 0.25, native_integration: 0.15,
      visceral_score: 0.20, behavioral_score: 0.25, reflective_score: 0.15,
      overall_aesthetic: 0.20,
    },
  };

  const scores = qualityScores[quality] || qualityScores.medium;

  const sample = {
    image: imagePath,
    scores,
    source: 'reference',
    metadata: {
      quality_tier: quality,
      added_at: new Date().toISOString(),
    },
  };

  addSample(manifest, sample);
  console.log(`Added reference: ${imagePath} (${quality}) overall=${scores.overall_aesthetic}`);
  return sample;
}

// ═══════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════

function showStats() {
  const manifest = loadManifest();
  const samples = manifest.samples || [];

  console.log(`\nDataset Statistics:`);
  console.log(`  Total samples: ${samples.length}`);

  // By source
  const sources = {};
  for (const s of samples) {
    const src = s.source || 'unknown';
    sources[src] = (sources[src] || 0) + 1;
  }
  console.log(`  Sources:`, JSON.stringify(sources));

  // By quality
  const qualities = {};
  for (const s of samples) {
    const q = s.metadata?.quality_target || s.metadata?.quality_tier || 'unknown';
    qualities[q] = (qualities[q] || 0) + 1;
  }
  console.log(`  Quality tiers:`, JSON.stringify(qualities));

  // Score distributions
  if (samples.length > 0) {
    console.log(`\n  Score distributions:`);
    for (const name of SCORE_NAMES) {
      const vals = samples.map(s => s.scores?.[name]).filter(v => v != null);
      if (vals.length === 0) continue;
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      console.log(`    ${name.padEnd(25)} avg=${avg.toFixed(3)} min=${min.toFixed(3)} max=${max.toFixed(3)}`);
    }
  }
}

// ═══════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════

const [,, command, ...args] = process.argv;

if (command === 'generate') {
  const count = parseInt(args[0]) || 10;
  console.log(`Generating ${count} design artifacts with LLM scoring...`);

  let generated = 0;
  const prompts = [...COMPONENT_PROMPTS];

  for (let i = 0; i < count && i < prompts.length; i++) {
    const result = await generateAndScore(prompts[i % prompts.length], i);
    if (result) generated++;
  }

  // If we need more than the prompt list, cycle through with variations
  for (let i = prompts.length; i < count; i++) {
    const base = prompts[i % prompts.length];
    const result = await generateAndScore({
      ...base,
      prompt: base.prompt + ' Use a different color scheme and font than your first instinct.',
    }, i);
    if (result) generated++;
  }

  console.log(`\n✅ Generated ${generated}/${count} samples`);
  showStats();

} else if (command === 'score') {
  const path = args[0];
  if (!path) {
    console.log('Usage: node collect-data.js score <screenshot-path>');
    process.exit(1);
  }
  await scoreReference(path, 'high');

} else if (command === 'reference') {
  const [path, quality] = args;
  if (!path) {
    console.log('Usage: node collect-data.js reference <screenshot-path> <high|medium|low>');
    process.exit(1);
  }
  await scoreReference(path, quality || 'high');

} else if (command === 'stats') {
  showStats();

} else {
  console.log(`
Design Training Data Collector

Usage:
  node collect-data.js generate <count>           Generate and score design artifacts
  node collect-data.js score <screenshot-path>     Score an existing screenshot (high quality)
  node collect-data.js reference <path> <quality>  Add reference screenshot (high/medium/low)
  node collect-data.js stats                       Show dataset statistics
  `);
}
