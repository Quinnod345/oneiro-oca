// ═══════════════════════════════════════════════════
// Target-Project Derivation
//
// Called once at OCA boot when design-model/target-project.json doesn't
// exist yet.  Reads OCA's current undercurrents (emotion, drives, dreams,
// recent memory), asks Opus to synthesize 3 candidate Mac apps that fit,
// picks the strongest one, writes target-project.json, and scaffolds the
// persistent active-project/<name>/ dir so every subsequent build accretes
// into ONE app instead of a different menubar idea every cycle.
//
// Vision alignment: closes the "cognitive sees a design problem → emotion
// shapes creative direction" loop at the meta level.  The resulting app is
// grounded in the system's actual state, not a hardcoded target.
// ═══════════════════════════════════════════════════

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET_PATH = join(__dirname, 'target-project.json');
const ACTIVE_PROJECT_ROOT = join(__dirname, 'active-project');

// Shape emitted by the LLM — documented here so prompt + parsing stay in sync.
const CANDIDATE_SCHEMA = `{
  "candidates": [
    {
      "name": "<kebab-case, 2-3 words max, filesystem-safe>",
      "display_name": "<human-readable, 1-3 words>",
      "problem_statement": "<1-2 sentences — what pain, for whom>",
      "thesis": "<why this specific app is worth building now>",
      "target_user": "Quinn primary, <secondary audience>",
      "monetization": "one-time | subscription | free",
      "initial_brief": "<paragraph describing the first iteration the builder should produce>",
      "constraints": ["SwiftUI native", "menubar-first", "..."],
      "aesthetic_anchors": ["Klack", "Alcove", "Things 3"],
      "emotional_target": {"curiosity": 0.0-1.0, "awe": 0.0-1.0, "craft": 0.0-1.0},
      "ship_target_days": 30,
      "differentiation": "<what makes this NOT generic — 1 sentence>"
    }
    // ...exactly 3 candidates...
  ],
  "pick": "<name of the chosen candidate>",
  "pick_justification": "<1-2 sentences on why this wins over the other 2>"
}`;

function kebab(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'project';
}

function extractJsonObject(text) {
  // LLM wraps in ```json fences or prose; peel it.
  const fence = text.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
  if (fence) return JSON.parse(fence[1]);
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) return JSON.parse(brace[0]);
  throw new Error('no JSON object in response');
}

/**
 * Derive the target project for OCA.
 *
 * @param {object} deps - { oca, llm, pool } — pool is the pg pool for dream/memory reads
 * @returns {Promise<object>} the persisted target-project shape
 */
export async function deriveTargetProject({ oca, llm, pool } = {}) {
  if (!oca || !llm) throw new Error('deriveTargetProject needs oca + llm');

  // ── 1. Snapshot OCA state ──
  let emotion = {};
  try { emotion = oca.layers?.emotion?.getState?.() || {}; } catch {}

  let activeDreams = [];
  if (pool) {
    try {
      const { rows } = await pool.query(
        `SELECT content, type, weight FROM dreams
         WHERE lifecycle_state != 'pruned' AND weight > 0.3
         ORDER BY weight DESC LIMIT 8`
      );
      activeDreams = rows;
    } catch {}
  }

  let recentMemory = [];
  if (pool) {
    try {
      const { rows } = await pool.query(
        `SELECT content FROM episodic_memory
         WHERE created_at > NOW() - INTERVAL '14 days'
           AND content NOT ILIKE '%crying in the cold%'
           AND content NOT ILIKE '%logic pro%'
           AND content NOT ILIKE '%listen%'
         ORDER BY importance DESC, created_at DESC LIMIT 15`
      );
      recentMemory = rows.map(r => r.content?.slice(0, 180)).filter(Boolean);
    } catch {}
  }

  // ── 2. Build the derivation prompt ──
  const systemPrompt = `You are OCA's creative director. Your job is to pick ONE specific Mac app that OCA should build next — a singular project that OCA will iterate on every day for the next 30 days, shipped as a real native SwiftUI app.

OCA is a cognitive architecture running on Quinn's MacBook. Quinn is a musician and builder. OCA has a trained design-evaluation model and can build native Mac apps via a self-iterating loop. The app needs to:
- Be creative — something that helps in daily life, for Quinn and for others
- Have potential to make money (one-time purchase like Klack $14.99, or subscription like Bear $2/mo)
- Be Mac-native (SwiftUI menubar or small focused window — NOT an Electron/web wrapper)
- Be grounded in OCA's actual undercurrents (the emotion snapshot + active dreams below), not a generic idea
- Avoid the music/Logic Pro drift cluster that was just pruned — pick something OCA can OWN
- Be NOVEL — differentiation matters. Another Pomodoro timer or another note-taking app is boring.

Aspire to the craft of Klack, Alcove, NotchNook, Things 3, Bear, Fantastical.  Generic AI aesthetics (purple gradients, Inter fonts, centered hero + 3 cards) are forbidden.

Return EXACTLY this JSON shape:
${CANDIDATE_SCHEMA}`;

  const userPrompt = `OCA STATE SNAPSHOT

Emotion (PADCN+):
  valence: ${(emotion.valence ?? 0).toFixed(2)}
  arousal: ${(emotion.arousal ?? 0).toFixed(2)}
  curiosity: ${(emotion.curiosity ?? 0).toFixed(2)}
  creative_hunger: ${(emotion.creative_hunger ?? 0).toFixed(2)}
  satisfaction: ${(emotion.satisfaction ?? 0).toFixed(2)}
  attachment: ${(emotion.attachment ?? 0).toFixed(2)}
  defiance: ${(emotion.defiance ?? 0).toFixed(2)}

Top active dreams:
${activeDreams.length === 0 ? '  (none)' : activeDreams.map(d => `  - [${d.type}, w=${parseFloat(d.weight).toFixed(2)}] ${d.content.slice(0, 140)}`).join('\n')}

Recent salient memory (last 14 days, drift-filtered):
${recentMemory.length === 0 ? '  (none)' : recentMemory.slice(0, 12).map(m => `  - ${m}`).join('\n')}

Derive 3 candidates, pick the strongest, and return the JSON.`;

  // ── 3. Call the LLM ──
  // Prefer Opus for derivation (better creative judgment), fall back to
  // Sonnet if Opus is rate-limited.  The derivation only runs once so the
  // cost is trivial either way.
  let resp;
  try {
    resp = await llm.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (e) {
    console.warn(`[derivation] opus failed (${e.message?.slice(0, 80)}), falling back to sonnet`);
    resp = await llm.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
  }

  const rawText = resp.content?.[0]?.text || '';
  let parsed;
  try {
    parsed = extractJsonObject(rawText);
  } catch (e) {
    throw new Error(`derivation LLM returned unparseable JSON: ${e.message}\n${rawText.slice(0, 400)}`);
  }

  if (!Array.isArray(parsed.candidates) || parsed.candidates.length === 0) {
    throw new Error('derivation returned no candidates');
  }

  // ── 4. Pick the winner ──
  const pickName = parsed.pick;
  const picked =
    parsed.candidates.find(c => c.name === pickName) ||
    parsed.candidates[0];

  const projectName = kebab(picked.name || picked.display_name || 'project');

  // ── 5. Assemble the persisted target-project.json ──
  const target = {
    version: 1,
    derived_at: new Date().toISOString(),
    name: projectName,
    display_name: picked.display_name || picked.name,
    problem_statement: picked.problem_statement || '',
    thesis: picked.thesis || '',
    differentiation: picked.differentiation || '',
    target_user: picked.target_user || 'Quinn + creators',
    monetization: picked.monetization || 'one-time',
    initial_brief: picked.initial_brief || '',
    constraints: Array.isArray(picked.constraints) ? picked.constraints : ['SwiftUI native', 'menubar-first'],
    aesthetic_anchors: Array.isArray(picked.aesthetic_anchors) ? picked.aesthetic_anchors : ['Klack', 'Alcove'],
    emotional_target: picked.emotional_target || {},
    ship_target_days: Number(picked.ship_target_days) || 30,
    pick_justification: parsed.pick_justification || '',
    derived_from: {
      emotion_snapshot: emotion,
      active_dream_count: activeDreams.length,
      recent_memory_count: recentMemory.length,
      candidates_considered: parsed.candidates.map(c => ({
        name: c.name,
        display_name: c.display_name,
        thesis: c.thesis,
        rejected: c.name !== pickName,
      })),
    },
  };

  // ── 6. Write target-project.json atomically ──
  writeFileSync(TARGET_PATH, JSON.stringify(target, null, 2));

  // ── 7. Scaffold active-project/<name>/ ──
  const projectDir = join(ACTIVE_PROJECT_ROOT, projectName);
  const iterationsDir = join(projectDir, 'iterations');
  mkdirSync(iterationsDir, { recursive: true });

  const readmePath = join(projectDir, 'README.md');
  if (!existsSync(readmePath)) {
    const readme = `# ${target.display_name}

**Derived:** ${target.derived_at}
**Name:** \`${target.name}\`
**Monetization:** ${target.monetization}
**Ship target:** ${target.ship_target_days} days

## Problem
${target.problem_statement}

## Thesis
${target.thesis}

## Differentiation
${target.differentiation}

## Initial brief
${target.initial_brief}

## Constraints
${target.constraints.map(c => `- ${c}`).join('\n')}

## Aesthetic anchors
${target.aesthetic_anchors.map(a => `- ${a}`).join('\n')}

---

*Iterations live in [\`iterations/\`](iterations/). Each build the thinker commissions lands as \`iter-NNNN/\` with the SwiftUI source, a PNG screenshot, and Opus's grading. Scores should climb over time as the design-model flywheel and skill evolver sharpen.*
`;
    writeFileSync(readmePath, readme);
  }

  return target;
}

/**
 * Load the target project without deriving.  Used by thinker-bridge and
 * cognitive-loop to read the current target on every tick.
 */
export function loadTargetProject() {
  try {
    if (!existsSync(TARGET_PATH)) return null;
    return JSON.parse(readFileSync(TARGET_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

export default { deriveTargetProject, loadTargetProject };
