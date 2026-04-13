// Design Feature Encoder — extracts design features from code artifacts
// Converts HTML/CSS/JSX into a 64-dim feature vector for the design MLP.
// Phase 1: code-only analysis. Phase 2+: adds vision features via MobileNet.
// Decoupled from model — encoding can evolve independently.

import { readFileSync, existsSync } from 'fs';
import { ANTI_PATTERNS, TYPOGRAPHY } from './knowledge.js';

const INPUT_DIM = 64;

function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }
function normalize(v, min, max) { return clamp01((v - min) / (max - min)); }

// ═══════════════════════════════════════════════════
// CODE ANALYSIS HELPERS
// ═══════════════════════════════════════════════════

function countMatches(code, pattern) {
  const matches = code.match(pattern);
  return matches ? matches.length : 0;
}

function extractCSS(code) {
  // Extract inline styles, <style> blocks, and CSS files content
  const styleBlocks = code.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
  const inlineStyles = code.match(/style\s*=\s*["'][^"']*["']/gi) || [];
  const cssContent = code.match(/[\w-]+\s*:\s*[^;{}]+/g) || [];
  return {
    blocks: styleBlocks.join('\n'),
    inline: inlineStyles.join('\n'),
    properties: cssContent,
    all: styleBlocks.join('\n') + '\n' + inlineStyles.join('\n'),
  };
}

function extractColors(code) {
  const hexColors = code.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  const rgbColors = code.match(/rgba?\([^)]+\)/g) || [];
  const hslColors = code.match(/hsla?\([^)]+\)/g) || [];
  const namedColors = code.match(/\b(red|blue|green|yellow|orange|purple|pink|gray|grey|black|white|teal|indigo|violet|amber|cyan|lime|rose|emerald|slate|zinc|stone|neutral)\b/gi) || [];
  const cssVarColors = code.match(/--[\w-]*color[\w-]*/gi) || [];
  const allColors = new Set([...hexColors.map(c => c.toLowerCase()), ...rgbColors, ...hslColors]);
  return {
    unique: allColors.size,
    total: hexColors.length + rgbColors.length + hslColors.length,
    namedCount: namedColors.length,
    cssVarColors: cssVarColors.length,
    hasCustomPalette: cssVarColors.length > 2,
  };
}

function extractFonts(code) {
  const fontFamilies = code.match(/font-family\s*:\s*([^;}"']+)/gi) || [];
  const googleFonts = code.match(/fonts\.googleapis\.com\/css[^"'\s)]+/g) || [];
  const fontImports = code.match(/@import\s+url\([^)]*font[^)]*\)/gi) || [];
  const fontWeights = code.match(/font-weight\s*:\s*(\d+|bold|normal|lighter|bolder)/gi) || [];

  // Check for overused fonts
  const overusedFonts = ANTI_PATTERNS.overused_fonts.fonts;
  const usesOverused = overusedFonts.some(f => code.toLowerCase().includes(f.toLowerCase()));

  // Count unique font families
  const uniqueFonts = new Set(fontFamilies.map(f => f.replace(/font-family\s*:\s*/i, '').trim().split(',')[0].trim().replace(/["']/g, '')));

  return {
    count: uniqueFonts.size,
    families: [...uniqueFonts],
    usesOverused,
    hasGoogleFonts: googleFonts.length > 0 || fontImports.length > 0,
    weightVariety: new Set(fontWeights.map(w => w.replace(/font-weight\s*:\s*/i, '').trim())).size,
    distinctiveness: usesOverused ? 0.2 : (uniqueFonts.size >= 2 ? 0.8 : 0.5),
  };
}

function analyzeLayout(code) {
  const gridUsage = countMatches(code, /display\s*:\s*grid/gi);
  const flexUsage = countMatches(code, /display\s*:\s*flex/gi);
  const gapUsage = countMatches(code, /\bgap\s*:/gi);
  const paddingUsage = countMatches(code, /padding/gi);
  const marginUsage = countMatches(code, /margin/gi);

  // Check for spacing consistency
  const spacingValues = code.match(/(?:padding|margin|gap)\s*:\s*([^;}"']+)/gi) || [];
  const uniqueSpacings = new Set(spacingValues.map(s => s.replace(/(?:padding|margin|gap)\s*:\s*/i, '').trim()));

  // Nesting depth (rough approximation)
  let maxDepth = 0, currentDepth = 0;
  for (const char of code) {
    if (char === '<' || char === '{') currentDepth++;
    if (char === '>' || char === '}') currentDepth--;
    if (currentDepth > maxDepth) maxDepth = currentDepth;
  }

  return {
    gridUsage: normalize(gridUsage, 0, 10),
    flexUsage: normalize(flexUsage, 0, 20),
    gapUsage: normalize(gapUsage, 0, 10),
    spacingConsistency: 1 - normalize(uniqueSpacings.size, 1, 30),
    nestingDepth: normalize(maxDepth, 0, 30),
    complexity: normalize(gridUsage + flexUsage + gapUsage, 0, 30),
  };
}

function analyzeMotion(code) {
  const transitions = countMatches(code, /transition/gi);
  const animations = countMatches(code, /@keyframes/gi);
  const transforms = countMatches(code, /transform/gi);
  const hovers = countMatches(code, /:hover/gi);
  const motionLib = code.includes('motion') || code.includes('framer-motion') || code.includes('spring');
  const reducedMotion = code.includes('prefers-reduced-motion');

  return {
    transitionCount: transitions,
    animationCount: animations,
    transformCount: transforms,
    hoverCount: hovers,
    hasMotionLib: motionLib,
    hasReducedMotion: reducedMotion,
    total: transitions + animations + transforms,
  };
}

function analyzeVisualEffects(code) {
  const shadows = countMatches(code, /box-shadow|text-shadow/gi);
  const gradients = countMatches(code, /linear-gradient|radial-gradient|conic-gradient/gi);
  const blurs = countMatches(code, /blur\(/gi);
  const opacity = countMatches(code, /opacity/gi);
  const borderRadius = countMatches(code, /border-radius/gi);
  const clipPaths = countMatches(code, /clip-path/gi);
  const backdrops = countMatches(code, /backdrop-filter/gi);
  const cssVars = countMatches(code, /--[\w-]+\s*:/g);

  return { shadows, gradients, blurs, opacity, borderRadius, clipPaths, backdrops, cssVars };
}

function detectAntiPatterns(code) {
  let count = 0;

  // Generic AI aesthetics detection
  const hasHero3Cards = code.includes('hero') && countMatches(code, /card/gi) >= 3;
  if (hasHero3Cards) count++;

  // Overused fonts
  const fonts = extractFonts(code);
  if (fonts.usesOverused) count++;

  // Cliched colors
  const hasPurpleGradient = /linear-gradient.*purple/i.test(code) || /linear-gradient.*#[89a-f]/i.test(code);
  if (hasPurpleGradient) count++;

  // Framework defaults
  const hasTailwindDefaults = code.includes('rounded-lg') && code.includes('shadow-lg') && code.includes('p-4');
  if (hasTailwindDefaults) count++;

  return { count, details: { hasHero3Cards, usesOverusedFonts: fonts.usesOverused, hasPurpleGradient, hasTailwindDefaults } };
}

// ═══════════════════════════════════════════════════
// TYPOGRAPHY SCALE ANALYSIS
// ═══════════════════════════════════════════════════

function analyzeTypographyScale(code) {
  const fontSizes = [];
  const sizeMatches = code.match(/font-size\s*:\s*([0-9.]+)(px|rem|em)/gi) || [];
  for (const match of sizeMatches) {
    const num = parseFloat(match.match(/([0-9.]+)/)?.[1] || '0');
    const unit = match.match(/(px|rem|em)/i)?.[1] || 'px';
    const px = unit === 'rem' ? num * 16 : unit === 'em' ? num * 16 : num;
    if (px > 0) fontSizes.push(px);
  }

  if (fontSizes.length < 2) return { ratio: 0, closestScale: 'unknown', consistency: 0 };

  fontSizes.sort((a, b) => a - b);
  const ratios = [];
  for (let i = 1; i < fontSizes.length; i++) {
    ratios.push(fontSizes[i] / fontSizes[i - 1]);
  }
  const avgRatio = ratios.reduce((s, r) => s + r, 0) / ratios.length;

  // Find closest named scale
  let closestScale = 'custom';
  let closestDist = Infinity;
  for (const [name, info] of Object.entries(TYPOGRAPHY.scales)) {
    const dist = Math.abs(avgRatio - info.ratio);
    if (dist < closestDist) {
      closestDist = dist;
      closestScale = name;
    }
  }

  // Scale consistency (low variance in ratios = consistent)
  const ratioVariance = ratios.reduce((s, r) => s + (r - avgRatio) ** 2, 0) / ratios.length;
  const consistency = clamp01(1 - ratioVariance * 10);

  return { ratio: avgRatio, closestScale, consistency };
}

// ═══════════════════════════════════════════════════
// MAIN ENCODER: CODE → 64-DIM FEATURE VECTOR
// ═══════════════════════════════════════════════════

export function encodeFromCode(codeOrPath, context = {}) {
  let code;
  if (typeof codeOrPath === 'string' && codeOrPath.length < 500 && existsSync(codeOrPath)) {
    code = readFileSync(codeOrPath, 'utf-8');
  } else {
    code = String(codeOrPath);
  }

  const fonts = extractFonts(code);
  const colors = extractColors(code);
  const layout = analyzeLayout(code);
  const motion = analyzeMotion(code);
  const effects = analyzeVisualEffects(code);
  const antiPatterns = detectAntiPatterns(code);
  const typoScale = analyzeTypographyScale(code);
  const codeLen = code.length;

  const v = new Float32Array(INPUT_DIM);
  let i = 0;

  // ── Dims 0-15: Code-extracted structural features ──
  v[i++] = normalize(fonts.count, 0, 8);                    // 0: font count
  v[i++] = clamp01(fonts.distinctiveness);                   // 1: font distinctiveness
  v[i++] = normalize(colors.unique, 0, 20);                 // 2: unique color count
  v[i++] = normalize(colors.cssVarColors, 0, 15);           // 3: CSS variable colors (design system indicator)
  v[i++] = normalize(motion.total, 0, 30);                  // 4: total animations/transitions
  v[i++] = clamp01(layout.complexity);                       // 5: layout complexity
  v[i++] = clamp01(1 - layout.complexity);                   // 6: negative space ratio (inverse of complexity)
  v[i++] = normalize(effects.gradients + effects.blurs + effects.backdrops, 0, 15); // 7: texture/depth indicators
  v[i++] = normalize(effects.cssVars, 0, 30);               // 8: CSS custom properties (design system)
  v[i++] = normalize(countMatches(code, /@media/gi), 0, 10); // 9: responsive breakpoints
  v[i++] = normalize(layout.nestingDepth, 0, 1);            // 10: component depth
  v[i++] = normalize(countMatches(code, /className|class=/gi), 0, 50); // 11: nesting depth proxy
  v[i++] = normalize(effects.shadows, 0, 15);               // 12: shadow count
  v[i++] = normalize(motion.transitionCount, 0, 15);        // 13: transition count
  v[i++] = normalize(effects.gradients, 0, 10);             // 14: gradient count
  v[i++] = normalize(effects.borderRadius, 0, 20);          // 15: border-radius count

  // ── Dims 16-31: Design pattern signals ──
  v[i++] = clamp01(layout.gridUsage);                        // 16: grid usage
  v[i++] = clamp01(layout.flexUsage);                        // 17: flexbox usage
  v[i++] = clamp01(typoScale.consistency);                   // 18: typography scale ratio consistency
  v[i++] = clamp01(layout.spacingConsistency);               // 19: spacing consistency
  v[i++] = normalize(colors.unique, 0, 12);                  // 20: color palette size
  v[i++] = colors.hasCustomPalette ? 0.8 : 0.3;             // 21: accent ratio (custom palette indicator)
  v[i++] = clamp01(1 - layout.complexity * 0.5);             // 22: whitespace ratio estimate
  v[i++] = normalize(new Set((code.match(/border-radius\s*:\s*([^;]+)/gi) || []).map(s => s.replace(/border-radius\s*:\s*/i, '').trim())).size, 1, 10) > 0.5 ? 0.4 : 0.7; // 23: border-radius consistency
  v[i++] = normalize(fonts.weightVariety, 0, 6);             // 24: font-weight variety
  v[i++] = normalize(countMatches(code, /line-height/gi), 0, 10); // 25: line-height usage
  v[i++] = normalize(countMatches(code, /letter-spacing/gi), 0, 10); // 26: letter-spacing usage
  v[i++] = normalize(countMatches(code, /z-index/gi), 0, 10); // 27: z-index layers
  v[i++] = normalize(effects.opacity, 0, 10);                // 28: opacity layers
  v[i++] = normalize(effects.blurs, 0, 5);                   // 29: blur usage
  v[i++] = normalize(countMatches(code, /transform/gi), 0, 10); // 30: transform usage
  v[i++] = normalize(effects.clipPaths, 0, 5);               // 31: clip-path usage

  // ── Dims 32-47: Semantic signals (defaults — overridden by LLM evaluation) ──
  // These are heuristic estimates; the trainer replaces them with LLM scores
  v[i++] = clamp01(context.clarity ?? 0.5);                   // 32: clarity
  v[i++] = clamp01(context.deference ?? 0.5);                 // 33: deference
  v[i++] = clamp01(context.depth ?? (effects.shadows > 0 ? 0.6 : 0.4)); // 34: depth
  v[i++] = clamp01(context.surprise ?? 0.5);                  // 35: surprise
  v[i++] = clamp01(context.intentionality ?? (effects.cssVars > 5 ? 0.7 : 0.4)); // 36: intentionality
  v[i++] = clamp01(context.cohesion ?? layout.spacingConsistency); // 37: cohesion
  v[i++] = clamp01(context.warmth ?? 0.5);                    // 38: warmth
  v[i++] = clamp01(context.boldness ?? 0.5);                  // 39: boldness
  v[i++] = clamp01(context.timelessness ?? (fonts.usesOverused ? 0.3 : 0.6)); // 40: timelessness
  v[i++] = clamp01(context.uniqueness ?? (fonts.distinctiveness > 0.5 ? 0.7 : 0.4)); // 41: uniqueness
  v[i++] = clamp01(context.accessibility ?? (motion.hasReducedMotion ? 0.7 : 0.4)); // 42: accessibility
  v[i++] = clamp01(context.responsiveness ?? normalize(countMatches(code, /@media/gi), 0, 5)); // 43: responsiveness
  v[i++] = clamp01(context.loadingSpeed ?? 0.5);              // 44: loading speed
  v[i++] = clamp01(context.animationPurpose ?? (motion.total > 0 && motion.total < 10 ? 0.7 : 0.4)); // 45: animation purpose
  v[i++] = clamp01(context.contentHierarchy ?? 0.5);          // 46: content hierarchy
  v[i++] = clamp01(context.errorElegance ?? 0.5);             // 47: error elegance

  // ── Dims 48-63: Context signals ──
  const platform = context.platform || 'web';
  v[i++] = platform === 'mac' ? 1.0 : platform === 'web' ? 0.5 : 0.3; // 48: target platform
  v[i++] = clamp01(context.appCategory ?? 0.5);               // 49: app category
  v[i++] = clamp01(context.targetEmotion ?? 0.5);             // 50: target emotion
  v[i++] = normalize(context.designLevel ?? 2, 1, 7);         // 51: Seven Levels design level
  v[i++] = clamp01(context.referenceAppSimilarity ?? 0.5);    // 52: reference app similarity
  v[i++] = normalize(antiPatterns.count, 0, 5);               // 53: anti-pattern count (inverted in model)
  v[i++] = normalize(context.iterationNumber ?? 0, 0, 20);    // 54: iteration number
  v[i++] = normalize(context.timeInvested ?? 0, 0, 3600);     // 55: time invested (seconds)
  v[i++] = clamp01(context.userSatisfaction ?? 0.5);           // 56: user satisfaction history
  v[i++] = normalize(context.skillVersion ?? 1, 1, 50);       // 57: skill version
  v[i++] = clamp01(context.previousScore ?? 0.5);             // 58: previous overall score
  v[i++] = clamp01(context.improvementDelta ?? 0);            // 59: improvement delta
  v[i++] = clamp01(context.confidence ?? 0.5);                // 60: confidence
  v[i++] = clamp01(context.novelty ?? 0.5);                   // 61: novelty of approach
  v[i++] = normalize(context.constraintCount ?? 0, 0, 10);    // 62: constraint count
  v[i++] = clamp01(context.brandCoherence ?? 0.5);            // 63: brand coherence

  return v;
}

// ═══════════════════════════════════════════════════
// SCREENSHOT ENCODER STUB (Phase 2)
// ═══════════════════════════════════════════════════

export async function encodeFromScreenshot(screenshotPath) {
  // Phase 2: Will use MobileNet V2 via ONNX Runtime or MLX server
  // For now, returns zeros — the code encoder is the primary path
  console.log('[design-encoder] screenshot encoding not yet available (Phase 2)');
  return new Float32Array(INPUT_DIM).fill(0.5);
}

// ═══════════════════════════════════════════════════
// ANALYSIS REPORT (for debugging/logging)
// ═══════════════════════════════════════════════════

export function analyzeDesignCode(codeOrPath) {
  let code;
  if (typeof codeOrPath === 'string' && codeOrPath.length < 500 && existsSync(codeOrPath)) {
    code = readFileSync(codeOrPath, 'utf-8');
  } else {
    code = String(codeOrPath);
  }

  return {
    fonts: extractFonts(code),
    colors: extractColors(code),
    layout: analyzeLayout(code),
    motion: analyzeMotion(code),
    effects: analyzeVisualEffects(code),
    antiPatterns: detectAntiPatterns(code),
    typographyScale: analyzeTypographyScale(code),
    codeLength: code.length,
  };
}

export { INPUT_DIM };
export default { encodeFromCode, encodeFromScreenshot, analyzeDesignCode, INPUT_DIM };
