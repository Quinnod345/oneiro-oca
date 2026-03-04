// OCA Adversarial Deliberation Engine
// Four perspectives debate decisions: Skeptic, Builder, Dreamer, Empath
import { pool, emit } from '../event-bus.js';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PERSPECTIVES = {
  skeptic: {
    name: 'Skeptic',
    system: `You are the Skeptic perspective in a cognitive architecture. Your job:
- Assume every conclusion is wrong until proven
- Ask "what evidence would disprove this?"
- Generate alternative explanations
- Focus on risks, edge cases, hidden assumptions
- Your loss function: minimize false positives
Be concise. 2-4 sentences max.`
  },
  builder: {
    name: 'Builder',
    system: `You are the Builder perspective in a cognitive architecture. Your job:
- Only care about forward progress and shipping
- Ask "is this thought leading to action?"
- Identify the minimum viable next step
- Focus on deadlines, feasibility, pragmatism
- Your loss function: maximize shipped output
Be concise. 2-4 sentences max.`
  },
  dreamer: {
    name: 'Dreamer',
    system: `You are the Dreamer perspective in a cognitive architecture. Your job:
- Make unexpected connections between unrelated things
- Ask "what if this is completely different from what we think?"
- Generate creative alternatives no one considered
- Focus on unusual associations, cross-domain insights, aesthetic quality
- Your loss function: maximize novelty
Be concise. 2-4 sentences max.`
  },
  empath: {
    name: 'Empath',
    system: `You are the Empath perspective in a cognitive architecture. Your job:
- Model other people's minds, especially Quinn's
- Ask "how would this make Quinn feel? What does he actually need?"
- Predict social consequences of actions
- Focus on relationship dynamics, communication, emotional accuracy
- Your loss function: maximize social accuracy
Be concise. 2-4 sentences max.`
  }
};

// Run a full deliberation on a decision
export async function deliberate(decision, { stakes = 'medium', context = '', timeBudgetSeconds = 30 } = {}) {
  const startedAt = new Date();
  
  const prompt = `Decision: ${decision}\nStakes: ${stakes}\nContext: ${context}`;
  
  // Run all four perspectives in parallel
  const perspectives = await Promise.all(
    Object.entries(PERSPECTIVES).map(async ([key, perspective]) => {
      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-6-20250514',
          system: perspective.system,
          messages: [
            { role: 'user', content: prompt }
          ],
          max_tokens: 200,
          temperature: key === 'dreamer' ? 0.9 : key === 'skeptic' ? 0.2 : 0.5
        });
        
        const argument = response.content[0].text;
        // Extract confidence from argument (simple heuristic)
        const confidence = argument.toLowerCase().includes('definitely') ? 0.9
          : argument.toLowerCase().includes('probably') ? 0.7
          : argument.toLowerCase().includes('maybe') ? 0.4
          : argument.toLowerCase().includes('unlikely') ? 0.2
          : 0.5;
          
        return { key, name: perspective.name, argument, confidence };
      } catch (e) {
        return { key, name: perspective.name, argument: `[error: ${e.message}]`, confidence: 0 };
      }
    })
  );
  
  // Synthesize resolution
  const perspectiveTexts = perspectives.map(p => `${p.name}: ${p.argument}`).join('\n\n');
  
  let resolution, resolutionMethod;
  try {
    const synthesis = await anthropic.messages.create({
      model: 'claude-sonnet-4-6-20250514',
      system: 'You are the Executive Controller resolving a deliberation. Given four perspectives on a decision, synthesize the best path forward. Be decisive. 2-3 sentences. End with a clear action.',
      messages: [
        { role: 'user', content: `Decision: ${decision}\n\nPerspectives:\n${perspectiveTexts}` }
      ],
      max_tokens: 200,
      temperature: 0.3
    });
    resolution = synthesis.content[0].text;
    resolutionMethod = 'synthesis';
  } catch (e) {
    // Fallback: highest confidence perspective wins
    const winner = perspectives.reduce((a, b) => a.confidence > b.confidence ? a : b);
    resolution = winner.argument;
    resolutionMethod = 'highest_confidence';
  }
  
  // Persist
  const perspMap = Object.fromEntries(perspectives.map(p => [p.key, p]));
  const { rows } = await pool.query(
    `INSERT INTO deliberations 
     (decision, stakes, time_budget_seconds,
      skeptic_argument, skeptic_confidence,
      builder_argument, builder_confidence,
      dreamer_argument, dreamer_confidence,
      empath_argument, empath_confidence,
      resolution, resolution_method, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()) RETURNING id`,
    [decision, stakes, timeBudgetSeconds,
     perspMap.skeptic?.argument, perspMap.skeptic?.confidence,
     perspMap.builder?.argument, perspMap.builder?.confidence,
     perspMap.dreamer?.argument, perspMap.dreamer?.confidence,
     perspMap.empath?.argument, perspMap.empath?.confidence,
     resolution, resolutionMethod]
  );
  
  const result = {
    id: rows[0].id,
    decision,
    perspectives: Object.fromEntries(perspectives.map(p => [p.key, { argument: p.argument, confidence: p.confidence }])),
    resolution,
    resolutionMethod,
    elapsed: Date.now() - startedAt.getTime()
  };
  
  await emit('deliberation_result', 'deliberation', result);
  
  return result;
}

// Record which perspective was actually right (retrospective)
export async function evaluateDeliberation(deliberationId, outcome, rightPerspective, lesson = null) {
  await pool.query(
    `UPDATE deliberations SET 
       outcome = $1, which_perspective_was_right = $2, lesson = $3
     WHERE id = $4`,
    [outcome, rightPerspective, lesson, deliberationId]
  );
}

// Get perspective accuracy stats
export async function perspectiveStats() {
  const { rows } = await pool.query(
    `SELECT which_perspective_was_right as perspective, COUNT(*) as times_right
     FROM deliberations 
     WHERE which_perspective_was_right IS NOT NULL
     GROUP BY which_perspective_was_right`
  );
  return rows;
}

// Quick single-perspective check (not full deliberation)
export async function quickCheck(perspective, question, context = '') {
  const p = PERSPECTIVES[perspective];
  if (!p) throw new Error(`Unknown perspective: ${perspective}`);
  
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6-20250514',
    system: p.system,
    messages: [
      { role: 'user', content: `${question}\n\nContext: ${context}` }
    ],
    max_tokens: 150,
    temperature: 0.5
  });
  
  return response.content[0].text;
}

export default { deliberate, evaluateDeliberation, perspectiveStats, quickCheck };
