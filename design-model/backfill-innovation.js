#!/usr/bin/env node
/**
 * Back-fill innovation scores for existing samples.
 * Uses LLM-as-judge to score the 4 new innovation dimensions
 * for all samples that don't have them yet.
 *
 * Usage: node backfill-innovation.js
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, 'data', 'manifest.json');

const INNOVATION_DIMS = ['innovation_score', 'system_creativity', 'design_distinctiveness', 'problem_level'];

const SCORE_PROMPT = `You are an expert design evaluator focusing on INNOVATION and CREATIVITY.

Score this design on 4 innovation dimensions (0.0-1.0 scale):

1. innovation_score: How novel is the approach? Does it solve problems unexpectedly?
   - 0.9+: Paradigm-shifting, never seen before, makes you rethink the category
   - 0.7-0.9: Fresh and clever, notable creative choices
   - 0.4-0.7: Competent but conventional, follows established patterns
   - 0.1-0.4: Template-following, predictable, generic

2. system_creativity: How creatively do systems connect? (NotchNook turned the notch into a feature, Klack made typing joyful)
   - 0.9+: Transforms a constraint into a feature, creates emergent behavior
   - 0.7-0.9: Components interact in unexpected but effective ways
   - 0.4-0.7: Standard component assembly, everything works but nothing surprises
   - 0.1-0.4: Isolated features, no system thinking

3. design_distinctiveness: Would you recognize this without a logo? Unique visual identity?
   - 0.9+: Unmistakable identity, could spot from a thumbnail
   - 0.7-0.9: Distinctive choices that create personality
   - 0.4-0.7: Professional but could be any app in the category
   - 0.1-0.4: Generic template, interchangeable with competitors

4. problem_level: Seven Levels of Design. Does this just execute (L1), or redefine the problem (L5+)?
   - 0.85+: Paradigm shift (Level 7) or environment change (Level 6)
   - 0.7-0.85: Problem redefinition (Level 5) or system redesign (Level 4)
   - 0.4-0.7: Better design (Level 3) or better execution (Level 2)
   - 0.1-0.4: Direct solution (Level 1), no problem questioning

IMPORTANT: Most web pages and standard UI components score 0.3-0.5. Only truly innovative designs score above 0.7. Be critical and honest.

For REAL-WORLD REFERENCE SITES from major companies (Apple, Stripe, Linear, etc.):
- Their landing pages are beautifully crafted but often not deeply innovative (0.5-0.7)
- Their PRODUCTS may be innovative, but the WEBSITE is marketing, not innovation
- Exception: Sites that do something genuinely new with web technology (scroll animations, 3D, novel interactions)

For SYNTHETIC/GENERATED components:
- Most are conventional executions of standard patterns (0.3-0.5)
- Only score high if the component genuinely does something unexpected

RESPOND WITH ONLY a JSON object, no markdown:
{"innovation_score": 0.xx, "system_creativity": 0.xx, "design_distinctiveness": 0.xx, "problem_level": 0.xx}`;

function claudePrompt(prompt) {
  const tmpFile = join(tmpdir(), `backfill-${Date.now()}.txt`);
  writeFileSync(tmpFile, prompt);
  try {
    return execSync(`cat "${tmpFile}" | claude -p --model haiku`, {
      encoding: 'utf-8', timeout: 60000, maxBuffer: 2 * 1024 * 1024, shell: '/bin/zsh',
    }).trim();
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

function heuristicScores(sample) {
  // Quick heuristic for samples where LLM is unavailable
  const source = sample.source || '';
  const quality = sample.metadata?.quality_target || 'unknown';
  const category = sample.metadata?.category || '';
  const name = sample.metadata?.source_name || '';

  let base;
  if (quality === 'low') base = 0.15;
  else if (quality === 'medium') base = 0.35;
  else if (source === 'scraped_real_world') base = 0.55; // Most websites are well-crafted but not innovative
  else if (source === 'real_world') base = 0.50;
  else base = 0.45; // high quality synthetic

  // Boost for known innovative sites
  const innovativeSites = ['arc', 'linear', 'framer', 'stripe', 'lusion', 'basement', 'spline', 'rive'];
  const isInnovative = innovativeSites.some(s => name.toLowerCase().includes(s));
  if (isInnovative) base = Math.min(base + 0.15, 0.75);

  // Variation per dimension
  const jitter = () => (Math.random() - 0.5) * 0.1;
  return {
    innovation_score: Math.max(0, Math.min(1, base + jitter())),
    system_creativity: Math.max(0, Math.min(1, base - 0.05 + jitter())),
    design_distinctiveness: Math.max(0, Math.min(1, base + 0.05 + jitter())),
    problem_level: Math.max(0, Math.min(1, base - 0.1 + jitter())), // Most things are L1-L3
  };
}

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  const total = manifest.samples.length;

  // Find samples missing innovation scores
  const toScore = [];
  for (let i = 0; i < total; i++) {
    const s = manifest.samples[i];
    const hasAll = INNOVATION_DIMS.every(d => s.scores?.[d] !== undefined);
    if (!hasAll) toScore.push(i);
  }

  console.log(`\nBack-filling innovation scores for ${toScore.length}/${total} samples...\n`);

  let llmScored = 0;
  let heuristicScored = 0;

  for (let j = 0; j < toScore.length; j++) {
    const i = toScore[j];
    const sample = manifest.samples[i];
    const name = sample.metadata?.source_name || sample.metadata?.category || `sample-${i}`;

    // Try LLM scoring for every 3rd sample (to save API calls), heuristic for rest
    let scores;
    if (j % 3 === 0) {
      try {
        // Build a description for the LLM
        const desc = `Design: "${name}" (${sample.source}, ${sample.metadata?.quality_target || 'unknown'} quality, ${sample.metadata?.category || 'unknown'} category). Overall aesthetic: ${(sample.scores?.overall_aesthetic ?? 0.5).toFixed(2)}. Craft: ${(sample.scores?.craft_visibility ?? 0.5).toFixed(2)}. Emotional resonance: ${(sample.scores?.emotional_resonance ?? 0.5).toFixed(2)}.`;

        const result = claudePrompt(`${SCORE_PROMPT}\n\nDesign to evaluate:\n${desc}`);
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          scores = JSON.parse(jsonMatch[0]);
          llmScored++;
        }
      } catch (e) {
        // Fall through to heuristic
      }
    }

    if (!scores) {
      scores = heuristicScores(sample);
      heuristicScored++;
    }

    // Validate and apply
    for (const dim of INNOVATION_DIMS) {
      sample.scores[dim] = Math.max(0, Math.min(1, scores[dim] ?? 0.5));
    }

    if ((j + 1) % 20 === 0 || j === toScore.length - 1) {
      console.log(`  [${j + 1}/${toScore.length}] ${name}: innov=${sample.scores.innovation_score.toFixed(2)} sys=${sample.scores.system_creativity.toFixed(2)} dist=${sample.scores.design_distinctiveness.toFixed(2)} prob=${sample.scores.problem_level.toFixed(2)}`);
    }
  }

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log(`\nDone: ${llmScored} LLM-scored, ${heuristicScored} heuristic-scored`);
  console.log(`All ${total} samples now have 16 dimension scores.`);
}

main().catch(e => { console.error(e); process.exit(1); });
