/**
 * Design Suggestions — the model proposes specific CSS/HTML changes.
 *
 * Goes beyond evaluation ("your typography scores 0.45") to prescription
 * ("change font-weight from 400 to 500, add -0.01em letter-spacing on headings,
 *  increase line-height from 1.4 to 1.6 on body text").
 *
 * Uses the 16-dimension scores + design knowledge to generate actionable,
 * specific changes that would improve the weakest dimensions.
 *
 * Usage:
 *   import { suggestChanges, generateDiff } from './suggest.js';
 *   const suggestions = await suggestChanges(htmlCode, screenshotPath);
 *   // suggestions.changes = [ { type: 'css', selector: 'h1', property: 'letter-spacing', from: '0', to: '-0.02em', reason: '...' }, ... ]
 */

import { evaluateDesign } from './evaluate.js';
import { DESIGN_DIMENSIONS, SCORE_NAMES, ANTI_PATTERNS, REFERENCE_APPS } from './knowledge.js';

// ═══════════════════════════════════════════════════
// DIMENSION → SPECIFIC CHANGE MAPPING
// ═══════════════════════════════════════════════════

const CHANGE_RECIPES = {
  typography_quality: [
    { check: code => !code.match(/letter-spacing/i), change: { property: 'letter-spacing', selectors: ['h1', 'h2', 'h3'], to: '-0.02em', reason: 'Headings need negative tracking for visual weight' } },
    { check: code => !code.match(/line-height:\s*(1\.[6-9]|2)/), change: { property: 'line-height', selectors: ['p', 'body'], to: '1.65', reason: 'Body text needs generous leading for readability' } },
    { check: code => code.match(/font-weight:\s*400/) && !code.match(/font-weight:\s*(5|6|7)/), change: { property: 'font-weight', selectors: ['h1', 'h2'], to: '600', reason: 'Headings lack visual hierarchy — increase weight' } },
    { check: code => !code.match(/font-feature-settings/i), change: { property: 'font-feature-settings', selectors: ['body'], to: '"kern" 1, "liga" 1', reason: 'Enable OpenType kerning and ligatures' } },
    { check: code => code.match(/Inter|Roboto|Open Sans/i), change: { property: 'font-family', selectors: ['body'], to: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif', reason: 'Replace generic web fonts with system font stack for native feel' } },
  ],

  color_harmony: [
    { check: code => (code.match(/#[0-9a-f]{3,8}/gi) || []).length > 8, change: { type: 'refactor', reason: 'Too many colors. Extract a 3-5 color palette into CSS custom properties: --color-bg, --color-surface, --color-text, --color-accent, --color-muted' } },
    { check: code => !code.match(/oklch|hsl/i), change: { type: 'refactor', reason: 'Switch to oklch() or hsl() color space for more perceptually uniform color relationships' } },
    { check: code => code.match(/color:\s*(#000|black|rgb\(0)/i), change: { property: 'color', selectors: ['body', 'p'], to: '#1a1a2e', reason: 'Pure black text is too harsh. Use a dark navy-charcoal instead' } },
  ],

  spatial_composition: [
    { check: code => !code.match(/gap:\s*\d/), change: { property: 'gap', selectors: ['.container', 'main'], to: '24px', reason: 'Use consistent spacing via CSS gap instead of margin hacks' } },
    { check: code => !code.match(/padding:\s*(2[4-9]|3[2-9]|4[0-9]|[5-9]\d)/), change: { property: 'padding', selectors: ['section', 'main'], to: '32px 40px', reason: 'Content needs more breathing room — increase padding to 32-40px' } },
    { check: code => code.match(/margin:\s*\d+px/) && !code.match(/(4|8|12|16|24|32|48|64)px/), change: { type: 'refactor', reason: 'Spacing is arbitrary. Use a 4px/8px base grid: 4, 8, 12, 16, 24, 32, 48, 64px' } },
  ],

  motion_elegance: [
    { check: code => !code.match(/transition/i), change: { property: 'transition', selectors: ['a', 'button', '[class]'], to: 'all 200ms ease-out', reason: 'Add micro-transitions for interactivity feedback' } },
    { check: code => code.match(/transition.*all.*0\.\d*s/i) && !code.match(/ease-out|cubic-bezier/i), change: { property: 'transition-timing-function', selectors: ['*'], to: 'cubic-bezier(0.16, 1, 0.3, 1)', reason: 'Replace linear/ease with a custom deceleration curve for more natural motion' } },
    { check: code => !code.match(/prefers-reduced-motion/i), change: { type: 'media-query', rule: '@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }', reason: 'Respect reduced-motion preference for accessibility' } },
  ],

  craft_visibility: [
    { check: code => !code.match(/border-radius:\s*(8|10|12|16)/), change: { property: 'border-radius', selectors: ['[class*="card"]', '[class*="panel"]', 'button'], to: '12px', reason: 'Refine border-radius to a consistent 12px for a polished feel' } },
    { check: code => !code.match(/box-shadow.*rgba.*0\.[0-2]/), change: { property: 'box-shadow', selectors: ['[class*="card"]'], to: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06)', reason: 'Add subtle layered shadows for depth hierarchy' } },
    { check: code => !code.match(/::selection/), change: { type: 'rule', rule: '::selection { background: oklch(0.8 0.15 260); color: white; }', reason: 'Custom text selection color shows attention to detail' } },
  ],

  minimalism_coherence: [
    { check: code => (code.match(/border:\s*\d+px\s+solid/gi) || []).length > 5, change: { type: 'refactor', reason: 'Too many borders creating visual noise. Remove borders and use spacing/background contrast instead' } },
    { check: code => (code.match(/font-size/gi) || []).length > 8, change: { type: 'refactor', reason: 'Too many font sizes. Establish a type scale with 4-5 sizes max: 12, 14, 16, 20, 28px' } },
  ],

  native_integration: [
    { check: code => !code.match(/-apple-system|BlinkMacSystemFont|SF Pro/), change: { property: 'font-family', selectors: ['body'], to: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif', reason: 'Use the platform system font for native feel' } },
    { check: code => !code.match(/prefers-color-scheme/i), change: { type: 'media-query', rule: '@media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --text: #e5e5e5; --surface: #1a1a1a; } }', reason: 'Support system dark mode preference' } },
  ],

  innovation_score: [
    { check: code => !code.match(/clip-path|container|:has\(|view-transition|scroll-timeline/i), change: { type: 'suggestion', reason: 'No modern CSS features detected. Consider: clip-path for unique shapes, :has() for parent selection, container queries for component-level responsiveness' } },
    { check: () => true, change: { type: 'question', reason: 'Ask yourself: what would make the original problem irrelevant? Can you turn a constraint into a feature? What would NotchNook or Klack do differently?' } },
  ],

  design_distinctiveness: [
    { check: code => code.match(/Inter|Roboto|Space Grotesk|Poppins/i), change: { type: 'suggestion', reason: 'Using an overused font. Try a distinctive alternative: Instrument Sans, Geist, Satoshi, General Sans, or commit to the system font stack' } },
    { check: code => code.match(/purple.*gradient|blue.*gradient|linear-gradient.*#[89a-f]/i), change: { type: 'suggestion', reason: 'Generic gradient detected. Create a unique color identity — pick one distinctive accent color and build the palette around it' } },
  ],
};


// ═══════════════════════════════════════════════════
// MAIN SUGGESTION ENGINE
// ═══════════════════════════════════════════════════

/**
 * Analyze a design and suggest specific, actionable improvements.
 *
 * @param {string} code - HTML/CSS code
 * @param {string} screenshotPath - Optional screenshot for visual scoring
 * @returns {object} { scores, weakest, changes, summary }
 */
export async function suggestChanges(code, screenshotPath) {
  // Score the design
  const evalInput = { code };
  if (screenshotPath) evalInput.screenshot = screenshotPath;
  const evaluation = await evaluateDesign(evalInput);

  // Find the 4 weakest dimensions
  const weakest = Object.entries(evaluation.scores)
    .filter(([name]) => name !== 'overall_aesthetic')
    .sort(([, a], [, b]) => a - b)
    .slice(0, 4);

  // Generate changes for each weak dimension
  const changes = [];

  for (const [dimName, score] of weakest) {
    if (score >= 0.85) continue; // Already strong

    const recipes = CHANGE_RECIPES[dimName] || [];
    for (const recipe of recipes) {
      if (recipe.check(code)) {
        changes.push({
          dimension: dimName,
          dimensionScore: score,
          priority: score < 0.5 ? 'critical' : score < 0.7 ? 'high' : 'medium',
          ...recipe.change,
        });
      }
    }
  }

  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2 };
  changes.sort((a, b) => (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3));

  // Generate a human-readable summary
  const summary = changes.slice(0, 5).map((c, i) => {
    if (c.type === 'css' || c.property) {
      return `${i + 1}. [${c.dimension}] Set \`${c.property}: ${c.to}\` on ${(c.selectors || []).join(', ')} — ${c.reason}`;
    } else if (c.type === 'rule' || c.type === 'media-query') {
      return `${i + 1}. [${c.dimension}] Add: \`${c.rule?.slice(0, 80)}...\` — ${c.reason}`;
    } else {
      return `${i + 1}. [${c.dimension}] ${c.reason}`;
    }
  }).join('\n');

  return {
    scores: evaluation.scores,
    overall: evaluation.overall,
    backend: evaluation.backend,
    weakest: weakest.map(([name, score]) => ({ name, score })),
    changes,
    summary,
    changeCount: changes.length,
  };
}


/**
 * Generate a CSS diff that would improve the design.
 * Returns CSS that can be appended to the existing stylesheet.
 */
export function generateCssPatch(changes) {
  const rules = [];

  for (const change of changes) {
    if (change.property && change.selectors) {
      for (const sel of change.selectors) {
        rules.push(`/* ${change.reason} */\n${sel} { ${change.property}: ${change.to}; }`);
      }
    } else if (change.rule) {
      rules.push(`/* ${change.reason} */\n${change.rule}`);
    }
  }

  return `/* ═══ Design Model Suggestions ═══ */\n/* Generated to improve: ${changes.map(c => c.dimension).join(', ')} */\n\n${rules.join('\n\n')}`;
}


export default { suggestChanges, generateCssPatch };
