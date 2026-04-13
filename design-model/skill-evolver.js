// Design Skill Evolver — iterates on the frontend-design SKILL.md
// Follows the autonomic self-modifier pattern: read → evaluate → propose → test → apply.
// Uses design model scores as feedback signal.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { evaluateDesign } from './evaluate.js';
import { encodeFromCode } from './encoder.js';
import { capture, cleanup } from './screenshot-capture.js';
import { SCORE_NAMES, DESIGN_DIMENSIONS } from './knowledge.js';

const SKILL_PATH = process.env.HOME + '/.claude/skills/frontend-design/SKILL.md';
const IMPROVEMENT_THRESHOLD = 0.05;    // Must improve weak dims by 5%+
const REGRESSION_THRESHOLD = 0.02;     // Must not regress strong dims by 2%+
const MIN_CYCLES_BETWEEN = 1000;       // Minimum cognitive cycles between evolutions
const DEFICIT_TRIGGER = 0.5;           // design_drive_deficit threshold to trigger early

let lastEvolutionCycle = 0;
let evolutionCount = 0;

// ═══════════════════════════════════════════════════
// MAIN EVOLUTION CYCLE
// ═══════════════════════════════════════════════════

/**
 * Run one evolution cycle on the frontend-design skill.
 *
 * @param {Function} llmCall - Async function(prompt, systemPrompt) → string
 * @param {object} options - { currentCycle, designDriveDeficit, pool (pg pool for tracking) }
 * @returns {object} Evolution result
 */
export async function evolveSkill(llmCall, options = {}) {
  const { currentCycle = 0, designDriveDeficit = 0, pool } = options;

  // Check cooldown
  if (currentCycle - lastEvolutionCycle < MIN_CYCLES_BETWEEN && designDriveDeficit < DEFICIT_TRIGGER) {
    return { skipped: true, reason: 'cooldown', cyclesRemaining: MIN_CYCLES_BETWEEN - (currentCycle - lastEvolutionCycle) };
  }

  // Step 1: Read current skill
  if (!existsSync(SKILL_PATH)) {
    return { skipped: true, reason: 'skill_not_found', path: SKILL_PATH };
  }
  const currentSkill = readFileSync(SKILL_PATH, 'utf-8');

  // Step 2: Evaluate — identify weakest dimensions by generating a test artifact
  //   and scoring it to see where the current skill produces weak results
  let probeScores;
  try {
    const probeCode = await llmCall(
      `Using this design skill:\n---\n${currentSkill.slice(0, 2000)}\n---\n\nGenerate a single, complete HTML component with inline CSS that demonstrates the skill's design principles. Return ONLY the HTML.`,
      'You are a frontend developer who follows design skill files precisely.'
    );
    const probeHtml = probeCode?.replace(/^```\w*\n?/m, '').replace(/\n?```$/m, '').trim();
    if (probeHtml && probeHtml.includes('<') && probeHtml.length > 100) {
      // Render to screenshot for visual evaluation
      const probePng = `/tmp/skill-probe-${Date.now()}.png`;
      try { await capture(probeHtml, probePng); } catch {}
      const probeResult = await evaluateDesign({
        code: probeHtml,
        screenshot: existsSync(probePng) ? probePng : undefined,
      });
      probeScores = probeResult.scores;
    }
  } catch {}

  if (!probeScores) {
    return { skipped: true, reason: 'probe_evaluation_failed' };
  }

  // Find the 3 weakest dimensions
  const weakest = Object.entries(probeScores)
    .filter(([name]) => name !== 'overall_aesthetic')
    .sort(([, a], [, b]) => a - b)
    .slice(0, 3)
    .map(([name, score]) => ({ name, score }));

  if (weakest.length === 0 || weakest[0].score > 0.8) {
    return { skipped: true, reason: 'skill_performing_well', weakest };
  }

  const weakDimNames = weakest.map(w => w.name);
  const weakDimDescriptions = weakest.map(w => {
    const dim = DESIGN_DIMENSIONS.find(d => d.name === w.name);
    return `${w.name} (score: ${w.score.toFixed(3)}): ${dim?.description || ''}\n  High signals: ${dim?.highSignals?.join(', ') || 'N/A'}\n  Low signals: ${dim?.lowSignals?.join(', ') || 'N/A'}`;
  }).join('\n\n');

  // Step 3: Propose skill amendment
  const proposalPrompt = `You are iterating on a design skill file to improve its design guidance.

The design evaluation model shows these dimensions are weakest:
${weakDimDescriptions}

Current skill content:
---
${currentSkill}
---

Propose specific amendments to the skill that would improve the weak dimensions.
Focus on:
- Adding concrete, actionable guidance for the weak areas
- Strengthening existing guidance that relates to weak dimensions
- Adding anti-patterns specific to the weak dimensions
- Adding reference examples from apps like Things 3, Alcove, Klack, NotchNook, Bear, Linear

Rules:
- Keep the existing structure (frontmatter + sections)
- Don't remove anything that works — only add or refine
- Be specific — vague guidance is useless
- Each addition should directly target one of the weak dimensions

Return the COMPLETE updated skill file content (not a diff).`;

  let proposedSkill;
  try {
    proposedSkill = await llmCall(proposalPrompt, 'You are a design system architect. Your goal is to create the most effective design skill possible.');
    if (!proposedSkill || proposedSkill.length < 100) throw new Error('Proposal too short');

    // Strip markdown code fences if present
    proposedSkill = proposedSkill.replace(/^```\w*\n?/m, '').replace(/\n?```$/m, '').trim();
  } catch (err) {
    return { skipped: true, reason: 'proposal_failed', error: err.message };
  }

  // Step 4: Generate test artifacts with proposed skill
  const testPrompt = `Using this design skill as your guide:
---
${proposedSkill.slice(0, 3000)}
---

Generate a single React/HTML component that demonstrates excellent:
${weakDimNames.join(', ')}

The component should be a complete, self-contained piece of UI (e.g., a card, a settings panel, a notification).
Return ONLY the code, no explanation.`;

  let testArtifacts = [];
  for (let i = 0; i < 3; i++) {
    try {
      const artifact = await llmCall(testPrompt, 'You are a frontend developer who creates beautiful, distinctive UI components.');
      if (artifact && artifact.length > 50) {
        testArtifacts.push(artifact.replace(/^```\w*\n?/m, '').replace(/\n?```$/m, '').trim());
      }
    } catch {}
  }

  if (testArtifacts.length === 0) {
    return { skipped: true, reason: 'test_generation_failed' };
  }

  // Step 5: Score test artifacts via Phase 2b/3 (with screenshots)
  const testScores = [];
  for (const artifact of testArtifacts) {
    try {
      const pngPath = `/tmp/skill-test-${Date.now()}-${testScores.length}.png`;
      try { await capture(artifact, pngPath); } catch {}
      const result = await evaluateDesign({
        code: artifact,
        screenshot: existsSync(pngPath) ? pngPath : undefined,
      });
      testScores.push(result.scores);
    } catch {
      // Fallback: code-only scoring
      const result = await evaluateDesign({ code: artifact });
      testScores.push(result.scores);
    }
  }

  if (testScores.length === 0) {
    await cleanup();
    return { skipped: true, reason: 'test_scoring_failed' };
  }

  // Step 6: Compare to baseline (probeScores from Step 2)
  const baselineScores = probeScores;

  // Pick best test artifact
  const bestTest = testScores.reduce((best, scores, idx) => {
    const overall = scores.overall_aesthetic;
    return overall > best.overall ? { scores, overall, idx } : best;
  }, { scores: testScores[0], overall: testScores[0].overall_aesthetic, idx: 0 });

  // Check improvement on weak dimensions
  const improvements = {};
  let allImproved = true;
  for (const weakDim of weakDimNames) {
    const delta = bestTest.scores[weakDim] - baselineScores[weakDim];
    improvements[weakDim] = { before: baselineScores[weakDim], after: bestTest.scores[weakDim], delta };
    if (delta < IMPROVEMENT_THRESHOLD) allImproved = false;
  }

  // Check no regression on strong dimensions
  let hasRegression = false;
  const regressions = {};
  for (const name of SCORE_NAMES) {
    if (weakDimNames.includes(name)) continue;
    const delta = bestTest.scores[name] - baselineScores[name];
    if (delta < -REGRESSION_THRESHOLD) {
      hasRegression = true;
      regressions[name] = { before: baselineScores[name], after: bestTest.scores[name], delta };
    }
  }

  // Step 7: Apply or reject
  const scoreBefore = baselineScores.overall_aesthetic;
  const scoreAfter = bestTest.scores.overall_aesthetic;

  const result = {
    improvements,
    regressions,
    scoreBefore,
    scoreAfter,
    testArtifactCount: testArtifacts.length,
    bestTestIndex: bestTest.idx,
  };

  if (scoreAfter > scoreBefore && !hasRegression) {
    // Apply the improved skill
    writeFileSync(SKILL_PATH, proposedSkill);
    lastEvolutionCycle = currentCycle;
    evolutionCount++;

    result.applied = true;
    result.version = evolutionCount;
    result.reason = 'overall_improvement';

    console.log(`[skill-evolver] ✨ skill v${evolutionCount} applied (${scoreBefore.toFixed(3)} → ${scoreAfter.toFixed(3)})`);

    // Track in database if pool available
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO design_skill_versions (version, content, trigger, weak_dimensions, improvement_targets, score_before, score_after)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [evolutionCount, proposedSkill, 'auto_evolution', JSON.stringify(weakDimNames), JSON.stringify(improvements), scoreBefore, scoreAfter]
        );
      } catch {}
    }
  } else {
    result.applied = false;
    result.reason = hasRegression ? 'regression_detected' : 'insufficient_improvement';
    console.log(`[skill-evolver] ❌ skill evolution rejected: ${result.reason}`);
  }

  await cleanup(); // Close Puppeteer
  return result;
}

// ═══════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════

export function getEvolutionStatus() {
  return {
    evolutionCount,
    lastEvolutionCycle,
    skillExists: existsSync(SKILL_PATH),
    skillPath: SKILL_PATH,
  };
}

export default { evolveSkill, getEvolutionStatus };
