/**
 * Design Builder — the loop that makes Cognitive actually build things.
 *
 * generate → screenshot → evaluate → iterate → deliver
 *
 * Any agent calls design.build(goal) → gets production-quality code
 * that passed design evaluation. Emotion state drives creative direction.
 *
 *   import { build } from './design-model/builder.js';
 *
 *   const result = await build({
 *     goal: 'A macOS settings panel for a photo editing app',
 *     style: 'dark, minimal, native',
 *     constraints: ['keyboard shortcuts', 'max 5 settings visible'],
 *     emotionState: oca.layers.emotion?.getState(),
 *   });
 *
 *   // result.code = '<html>...'
 *   // result.scores.overall_aesthetic = 0.82
 *   // result.iterations = 4
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

import { evaluateDesign } from './evaluate.js';
import { suggestChanges, generateCssPatch } from './suggest.js';
import { capture, cleanup } from './screenshot-capture.js';
import { encodeFromCode } from './encoder.js';
import { SCORE_NAMES, DESIGN_DIMENSIONS } from './knowledge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Try to import emotion bridge (optional — works without OCA)
let computeDesignPolicy, policyToPromptContext;
try {
  const bridge = await import('../design/emotion-bridge.js');
  computeDesignPolicy = bridge.computeDesignPolicy;
  policyToPromptContext = bridge.policyToPromptContext;
} catch {}

// Load the design skill for prompt assembly
function loadSkill() {
  const skillPath = process.env.HOME + '/.claude/skills/frontend-design/SKILL.md';
  if (existsSync(skillPath)) {
    return readFileSync(skillPath, 'utf-8');
  }
  return '';
}

// Default LLM call via Claude CLI
function defaultLlmCall(prompt) {
  const tmp = join(tmpdir(), `builder-${Date.now()}.txt`);
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
// PROMPT ASSEMBLY
// ═══════════════════════════════════════════════════

function assembleGenerationPrompt(goal, options = {}) {
  const { style, constraints, emotionState, skillContent } = options;

  let prompt = `You are building a real, production-quality interface. Not a mockup. Not a prototype. Something that ships.

DESIGN SKILL:
${(skillContent || '').slice(0, 2000)}

`;

  // Emotion-to-design policy
  if (emotionState && computeDesignPolicy) {
    try {
      const policy = computeDesignPolicy(emotionState);
      const context = policyToPromptContext(policy);
      prompt += `EMOTIONAL DESIGN CONTEXT:\n${context}\n\n`;
    } catch {}
  }

  prompt += `GOAL: ${goal}\n`;
  if (style) prompt += `STYLE DIRECTION: ${style}\n`;
  if (constraints?.length) prompt += `CONSTRAINTS:\n${constraints.map(c => `- ${c}`).join('\n')}\n`;

  prompt += `
REQUIREMENTS:
- Complete HTML page with inline CSS, viewport 1440x900
- System font stack (-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui)
- CSS custom properties for the entire color system
- Every design choice must have a reason. If you use a color, know why.
- The design must be COHESIVE — parts working together as one vision, not individually good but clashing
- Think about what makes this DISTINCTIVE. What's the one thing someone will remember?
- Innovation matters: solve the problem in a way that surprises. What would NotchNook or Klack do?

Return ONLY the complete HTML. No markdown, no explanation, no code fences.`;

  return prompt;
}

function assembleIterationPrompt(code, evaluation, suggestions) {
  const weakDims = evaluation.weakest.slice(0, 3);
  const weakFeedback = weakDims.map(w => {
    const dim = DESIGN_DIMENSIONS.find(d => d.name === w.name);
    return `- ${w.name}: ${(w.score || 0).toFixed(2)} — ${dim?.highSignals?.slice(0, 2).join(', ') || 'improve quality'}`;
  }).join('\n');

  const cssPatch = suggestions?.changes ? generateCssPatch(suggestions.changes.slice(0, 5)) : '';

  return `Improve this design. The following dimensions are weak:

${weakFeedback}

SPECIFIC CHANGES TO MAKE:
${suggestions?.summary || 'Improve the weakest dimensions listed above.'}

SUGGESTED CSS (incorporate these ideas, don't blindly paste):
${cssPatch.slice(0, 1000)}

CURRENT CODE:
${code.slice(0, 8000)}

CRITICAL: The improved version must be COHESIVE. Don't just fix one dimension — make sure your changes work with the WHOLE design. A great heading that fights the color palette makes the design WORSE.

Return ONLY the complete improved HTML. No markdown, no explanation.`;
}

// ═══════════════════════════════════════════════════
// BUILD LOOP
// ═══════════════════════════════════════════════════

/**
 * Build a design artifact with quality-guided iteration.
 *
 * @param {object} options
 * @param {string} options.goal - What to build
 * @param {string} [options.style] - Aesthetic direction
 * @param {string[]} [options.constraints] - Design constraints
 * @param {object} [options.emotionState] - OCA emotion state (PADCN + channels + drives)
 * @param {Function} [options.llmCall] - LLM call function (default: Claude CLI)
 * @param {number} [options.maxIterations=8] - Maximum iteration attempts
 * @param {number} [options.qualityThreshold=0.72] - Minimum overall_aesthetic to accept
 * @param {number} [options.innovationThreshold=0.4] - Minimum innovation_score to accept
 * @param {string} [options.renderer='html'] - 'html' (Puppeteer) or 'swift' (future)
 * @param {string} [options.outputDir] - Where to save artifacts
 * @returns {object} { code, screenshot, scores, iterations, history, suggestions, success }
 */
export async function build(options) {
  const {
    goal,
    style,
    constraints,
    emotionState,
    llmCall = defaultLlmCall,
    maxIterations = 8,
    qualityThreshold = 0.72,
    innovationThreshold = 0.4,
    renderer = 'html',
    outputDir,
  } = options;

  const buildDir = outputDir || join(__dirname, 'builds', `build-${Date.now()}`);
  mkdirSync(buildDir, { recursive: true });

  const skillContent = loadSkill();
  const history = [];
  let bestCode = null;
  let bestScore = 0;
  let bestScores = null;
  let bestScreenshot = null;

  console.log(`[builder] goal: ${goal}`);
  console.log(`[builder] thresholds: quality=${qualityThreshold} innovation=${innovationThreshold}`);

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const isFirst = iteration === 0;

    // ── GENERATE ──
    let code;
    try {
      const lastEntry = history.length > 0 ? history[history.length - 1] : null;
      if (!lastEntry || !lastEntry.code) {
        // First generation or retry after failure
        const prompt = assembleGenerationPrompt(goal, { style, constraints, emotionState, skillContent });
        code = llmCall(prompt);
      } else {
        // Iterate on previous version
        const prompt = assembleIterationPrompt(lastEntry.code, lastEntry.evaluation, lastEntry.suggestions);
        code = llmCall(prompt);
      }
      // Clean markdown fences
      const match = code?.match(/```html\n?([\s\S]*?)\n?```/);
      if (match) code = match[1];
      if (!code || !code.includes('<') || code.length < 100) {
        console.log(`  [${iteration + 1}] invalid HTML, skipping`);
        continue;
      }
    } catch (e) {
      console.log(`  [${iteration + 1}] generation failed: ${e.message.slice(0, 50)}`);
      continue;
    }

    // ── RENDER ──
    const htmlPath = join(buildDir, `iteration-${iteration}.html`);
    const pngPath = join(buildDir, `iteration-${iteration}.png`);
    writeFileSync(htmlPath, code);

    try {
      await capture(`file://${htmlPath}`, pngPath);
    } catch (e) {
      console.log(`  [${iteration + 1}] render failed: ${e.message.slice(0, 50)}`);
    }

    // ── EVALUATE ──
    const evalInput = { code };
    if (existsSync(pngPath)) evalInput.screenshot = pngPath;
    const evaluation = await evaluateDesign(evalInput);
    const overall = evaluation.overall || 0;
    const innovation = evaluation.scores?.innovation_score || 0;

    // ── SUGGEST ──
    let suggestions = null;
    try {
      suggestions = await suggestChanges(code, existsSync(pngPath) ? pngPath : undefined);
    } catch {}

    // Track
    history.push({
      iteration,
      code,
      htmlPath,
      screenshotPath: existsSync(pngPath) ? pngPath : null,
      evaluation,
      suggestions,
      scores: evaluation.scores,
      overall,
      innovation,
    });

    // Track best
    if (overall > bestScore) {
      bestCode = code;
      bestScore = overall;
      bestScores = evaluation.scores;
      bestScreenshot = existsSync(pngPath) ? pngPath : null;
    }

    const marker = overall >= qualityThreshold && innovation >= innovationThreshold ? '✅' :
                   overall >= qualityThreshold ? '🟡' : '⏳';
    console.log(`  [${iteration + 1}/${maxIterations}] overall=${overall.toFixed(3)} innovation=${innovation.toFixed(3)} ${marker}`);

    // ── DECIDE ──
    if (overall >= qualityThreshold && innovation >= innovationThreshold) {
      console.log(`[builder] accepted at iteration ${iteration + 1}`);
      break;
    }

    if (iteration === maxIterations - 1) {
      console.log(`[builder] max iterations reached, using best (${bestScore.toFixed(3)})`);
    }
  }

  await cleanup(); // Close Puppeteer

  // ── STORE AS TRAINING DATA ──
  try {
    const manifestPath = join(__dirname, 'data', 'manifest.json');
    if (existsSync(manifestPath) && bestScreenshot) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      let codeFeatures = null;
      try { codeFeatures = Array.from(encodeFromCode(bestCode, { platform: 'web' })); } catch {}

      manifest.samples.push({
        image: bestScreenshot,
        screenshot_path: bestScreenshot,
        scores: bestScores,
        source: 'builder',
        code_features: codeFeatures,
        metadata: {
          source_name: `build-${goal.slice(0, 30).replace(/\s+/g, '-')}`,
          category: 'builder-output',
          quality_target: bestScore > 0.8 ? 'high' : 'medium',
          goal: goal.slice(0, 200),
          iterations: history.length,
          code_path: history[history.length - 1]?.htmlPath,
          generated_at: new Date().toISOString(),
        },
      });
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }
  } catch {}

  return {
    code: bestCode,
    screenshot: bestScreenshot,
    scores: bestScores,
    overall: bestScore,
    iterations: history.length,
    history: history.map(h => ({
      iteration: h.iteration,
      overall: h.overall,
      innovation: h.innovation,
      screenshotPath: h.screenshotPath,
    })),
    suggestions: history[history.length - 1]?.suggestions,
    success: bestScore >= qualityThreshold,
    buildDir,
  };
}

export default { build };
