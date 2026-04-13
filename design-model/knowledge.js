// Design Knowledge Base — structured design research for the design evaluation model
// Sources: Norman's Emotional Design, Apple HIG, beautiful Mac app analysis,
// Seven Levels of Design, color psychology, typography theory, motion design.
// Consumed by: encoder, trainer, evaluator, skill evolver, thinker bridge.

// ═══════════════════════════════════════════════════
// NORMAN'S THREE LEVELS OF EMOTIONAL DESIGN
// ═══════════════════════════════════════════════════

export const NORMAN_LEVELS = {
  visceral: {
    description: 'Immediate aesthetic reaction — how it looks and feels at first glance',
    scoring: ['color appeal', 'form elegance', 'texture quality', 'sensory richness'],
    weight: 0.35,
    signals: {
      positive: ['visual delight', 'immediate attraction', 'sensory pleasure', 'aesthetic wow'],
      negative: ['visual confusion', 'aesthetic clash', 'sensory overload', 'blandness'],
    },
  },
  behavioral: {
    description: 'Usability and interaction quality — does it work flawlessly',
    scoring: ['task completion', 'feedback clarity', 'error prevention', 'learnability'],
    weight: 0.30,
    signals: {
      positive: ['effortless use', 'clear feedback', 'predictable behavior', 'satisfying interaction'],
      negative: ['confusion', 'dead ends', 'missing feedback', 'unexpected behavior'],
    },
  },
  reflective: {
    description: 'Meaning and identity — what it says about you',
    scoring: ['brand coherence', 'cultural relevance', 'personal connection', 'pride of use'],
    weight: 0.35,
    signals: {
      positive: ['pride of ownership', 'story-worthiness', 'identity expression', 'emotional bond'],
      negative: ['shame of use', 'disposability', 'anonymity', 'regret'],
    },
  },
};

// ═══════════════════════════════════════════════════
// SEVEN LEVELS OF DESIGN
// ═══════════════════════════════════════════════════

export const SEVEN_LEVELS = [
  { level: 1, name: 'Direct Solution', description: 'Solve the stated problem', example: 'Rain → wear a raincoat' },
  { level: 2, name: 'Better Materials', description: 'Same solution, better execution', example: 'Rain → better waterproof fabric' },
  { level: 3, name: 'Better Design', description: 'Rethink the form factor', example: 'Rain → redesign umbrella ergonomics' },
  { level: 4, name: 'System Redesign', description: 'Change the system around the solution', example: 'Rain → covered walkways between buildings' },
  { level: 5, name: 'Problem Redefinition', description: 'Solve a different, better problem', example: 'Rain → why do we need to go outside?' },
  { level: 6, name: 'Environment Change', description: 'Change the context so the problem vanishes', example: 'Rain → climate-controlled city zones' },
  { level: 7, name: 'Paradigm Shift', description: 'Transcend the original problem space entirely', example: 'Rain → telecommute, the trip never happens' },
];

// ═══════════════════════════════════════════════════
// MAC NATIVE DESIGN PRINCIPLES
// ═══════════════════════════════════════════════════

export const MAC_NATIVE_PRINCIPLES = {
  native_development: {
    weight: 0.9,
    description: 'Swift/Cocoa, not cross-platform frameworks',
    indicators: ['SwiftUI usage', 'AppKit integration', 'system font respect', 'native controls'],
    antiIndicators: ['Electron detected', 'web wrapper', 'cross-platform framework default styling'],
  },
  constraint_embracing: {
    weight: 0.85,
    description: 'Works within macOS conventions, becomes stronger because of them',
    indicators: ['menu bar integration', 'keyboard shortcuts', 'drag-and-drop', 'system services'],
    antiIndicators: ['fights system conventions', 'custom window chrome', 'non-standard shortcuts'],
  },
  minimalism_with_sophistication: {
    weight: 0.9,
    description: 'Minimal interface hiding powerful capabilities',
    indicators: ['progressive disclosure', 'hidden complexity', 'clean surface', 'depth on demand'],
    antiIndicators: ['feature dump', 'cluttered toolbar', 'everything visible at once'],
  },
  micro_detail_philosophy: {
    weight: 0.95,
    description: 'Every pixel, animation, sound is intentional',
    indicators: ['sub-pixel alignment', 'custom animations', 'thoughtful transitions', 'sound design'],
    antiIndicators: ['misaligned elements', 'default animations', 'jarring transitions'],
  },
  performance_as_design: {
    weight: 0.85,
    description: 'Speed and responsiveness ARE design features',
    indicators: ['instant response', 'smooth scrolling', 'no loading spinners', 'low memory footprint'],
    antiIndicators: ['loading delays', 'jank', 'beach ball', 'high CPU usage'],
  },
  emotional_arc: {
    weight: 0.9,
    description: 'Addresses all three Norman levels — visceral, behavioral, reflective',
    indicators: ['first-impression beauty', 'usability excellence', 'identity connection'],
    antiIndicators: ['pretty but broken', 'functional but ugly', 'no emotional resonance'],
  },
  real_human_problems: {
    weight: 0.8,
    description: 'Solves actual user needs, not designer imagination',
    indicators: ['clear use case', 'workflow integration', 'solves real pain'],
    antiIndicators: ['solution looking for problem', 'demo-ware', 'technically impressive but useless'],
  },
  timeless_aesthetics: {
    weight: 0.85,
    description: 'Design that ages gracefully, not chasing trends',
    indicators: ['clean proportions', 'neutral base palette', 'classic typography', 'restrained animation'],
    antiIndicators: ['trendy effects', 'dated gradient styles', 'fad typography', 'glassmorphism without purpose'],
  },
  system_integration: {
    weight: 0.8,
    description: 'Feels part of the macOS ecosystem, not a separate tool',
    indicators: ['Spotlight support', 'Share sheet', 'Quick Look', 'Handoff', 'Widgets'],
    antiIndicators: ['isolated experience', 'no system hooks', 'ignores macOS features'],
  },
  craft_as_value: {
    weight: 0.95,
    description: 'Respects user time and attention through thoughtful, painstaking design',
    indicators: ['visible attention to detail', 'consistent spacing', 'polished icons', 'refined copy'],
    antiIndicators: ['rushed feeling', 'inconsistent spacing', 'stock icons', 'generic copy'],
  },
};

// ═══════════════════════════════════════════════════
// ANTI-PATTERNS
// ═══════════════════════════════════════════════════

export const ANTI_PATTERNS = {
  generic_ai_aesthetics: {
    severity: 0.95,
    description: 'Cookie-cutter AI-generated look — the uncanny valley of design',
    tells: ['centered hero with gradient', 'three feature cards', 'rounded everything', 'over-consistent spacing'],
  },
  overused_fonts: {
    severity: 0.7,
    fonts: ['Inter', 'Roboto', 'Arial', 'system-ui', 'Space Grotesk', 'Poppins', 'Montserrat'],
    description: 'Convergent font choices that signal lazy selection',
  },
  cliched_colors: {
    severity: 0.8,
    patterns: ['purple gradient on white', 'blue-to-purple hero', 'teal accent on dark', 'pink-to-orange gradient'],
    description: 'Color schemes that immediately read as template',
  },
  predictable_layouts: {
    severity: 0.6,
    patterns: ['centered hero + 3 cards + CTA', 'sidebar + content', 'full-width sections stacked'],
    description: 'Layouts that follow the same formula as every other site',
  },
  framework_defaults: {
    severity: 0.75,
    description: 'Unmodified Tailwind/Bootstrap/Material defaults',
    tells: ['default border-radius', 'default shadow scale', 'default color palette', 'default spacing'],
  },
  decoration_without_purpose: {
    severity: 0.5,
    description: 'Gratuitous visual effects that add complexity without meaning',
    tells: ['floating shapes', 'unnecessary particles', 'decorative blobs', 'random gradients'],
  },
  inconsistent_system: {
    severity: 0.65,
    description: 'Design tokens that don\'t form a coherent system',
    tells: ['mixed border-radius values', 'inconsistent spacing', 'competing type scales', 'random colors'],
  },
};

// ═══════════════════════════════════════════════════
// REFERENCE APPS — DESIGN DNA
// ═══════════════════════════════════════════════════

export const REFERENCE_APPS = {
  alcove: {
    category: 'menu-bar-utility',
    strengths: ['native feel', 'iOS Dynamic Island on macOS', 'subtle refinement', 'menu bar elegance'],
    designDNA: 'Whispers Apple quality. 100% Swift native. Customizable but opinionated defaults.',
    emotionalTarget: ['belonging', 'refinement', 'quiet delight'],
    normanStrengths: { visceral: 0.85, behavioral: 0.8, reflective: 0.75 },
  },
  klack: {
    category: 'sensory-utility',
    strengths: ['sound design as UX', 'native Swift rebuild from Electron', 'spatial audio', 'micro-joy'],
    designDNA: 'Transforms utilitarian typing into sensory experience. Performance matters — rebuilt native for it.',
    emotionalTarget: ['tactile joy', 'sensory satisfaction', 'craftsmanship appreciation'],
    normanStrengths: { visceral: 0.9, behavioral: 0.85, reflective: 0.7 },
  },
  notchnook: {
    category: 'hardware-integration',
    strengths: ['constraint→feature philosophy', 'fluid animation', 'hardware-software harmony'],
    designDNA: 'Turns hardware limitation (notch) into elegant feature. Reclaims wasted space with purpose.',
    emotionalTarget: ['clever delight', 'harmony', 'reclamation'],
    normanStrengths: { visceral: 0.8, behavioral: 0.85, reflective: 0.8 },
  },
  things3: {
    category: 'productivity',
    strengths: ['timeless minimalism', 'pixel-level detail', 'paper metaphor', 'micro-interactions'],
    designDNA: 'Two Apple Design Awards. German engineering meets aesthetic sensitivity. Every pixel deliberate.',
    emotionalTarget: ['calm focus', 'luxury', 'personal respect'],
    normanStrengths: { visceral: 0.95, behavioral: 0.9, reflective: 0.9 },
  },
  fantastical: {
    category: 'calendar',
    strengths: ['Liquid Glass design', 'visual hierarchy', 'unexpected features (weather)', 'widget mastery'],
    designDNA: 'Goes beyond calendar. Fluid, polished visual language. Multiple design modes for personalization.',
    emotionalTarget: ['premium ownership', 'discovery delight', 'control'],
    normanStrengths: { visceral: 0.85, behavioral: 0.9, reflective: 0.8 },
  },
  bear: {
    category: 'writing',
    strengths: ['typography-first design', 'theme system', 'writing UX', 'tag-based organization'],
    designDNA: 'Apple Design Award. Laser-focused on writing experience. Typography as foundational element.',
    emotionalTarget: ['creative flow', 'peace', 'writing joy'],
    normanStrengths: { visceral: 0.85, behavioral: 0.9, reflective: 0.85 },
  },
  craft: {
    category: 'documentation',
    strengths: ['platform respect', 'keyboard-first', 'Apple Pencil native', 'Liquid Glass'],
    designDNA: 'Treats each platform as primary canvas. Restraint in styling. Premium without excess.',
    emotionalTarget: ['empowerment', 'creative flow', 'professional pride'],
    normanStrengths: { visceral: 0.85, behavioral: 0.85, reflective: 0.85 },
  },
  linear: {
    category: 'project-management',
    strengths: ['sharp minimalism', 'modular components (Orbiter)', 'warmer grays', 'human warmth in notifications'],
    designDNA: 'Ultra-minimal without being cold. Custom design system on Radix. Purple accent as identity.',
    emotionalTarget: ['professional clarity', 'team connection', 'velocity'],
    normanStrengths: { visceral: 0.8, behavioral: 0.95, reflective: 0.8 },
  },
  pixelmator_pro: {
    category: 'creative-tool',
    strengths: ['ML-powered features', 'intuitive power', 'RAW support', 'native performance'],
    designDNA: 'Professional capability with approachable interface. Intelligence feels magical, not mechanical.',
    emotionalTarget: ['creative empowerment', 'wonder', 'competence'],
    normanStrengths: { visceral: 0.85, behavioral: 0.85, reflective: 0.8 },
  },
};

// ═══════════════════════════════════════════════════
// DESIGN EMOTIONS
// ═══════════════════════════════════════════════════

export const DESIGN_EMOTIONS = {
  target: {
    delight:     { description: 'Unexpected pleasure from thoughtful details', triggers: ['micro-interactions', 'easter eggs', 'smooth animations'] },
    awe:         { description: 'Breathtaking craft that inspires', triggers: ['visual mastery', 'technical excellence', 'surprising capability'] },
    satisfaction:{ description: 'Deep contentment from things working perfectly', triggers: ['flawless usability', 'predictable behavior', 'instant response'] },
    calm:        { description: 'Peaceful clarity from clean design', triggers: ['whitespace', 'minimal UI', 'muted palette', 'focused interface'] },
    empowerment: { description: 'Feeling capable and in control', triggers: ['powerful features', 'keyboard shortcuts', 'batch operations'] },
    curiosity:   { description: 'Desire to explore and discover', triggers: ['progressive disclosure', 'hidden features', 'depth'] },
    trust:       { description: 'Confidence the tool will do right', triggers: ['consistency', 'reliability', 'data safety', 'transparent behavior'] },
    pride:       { description: 'Satisfaction from using something well-made', triggers: ['visible craft', 'premium feel', 'design awards'] },
  },
  avoid: {
    frustration: { description: 'Blocked from completing tasks', triggers: ['broken flows', 'missing features', 'bugs'] },
    confusion:   { description: 'Unable to understand the interface', triggers: ['poor hierarchy', 'ambiguous icons', 'jargon'] },
    boredom:     { description: 'Unstimulated by generic design', triggers: ['template look', 'no personality', 'bland palette'] },
    indifference:{ description: 'Nothing memorable about the experience', triggers: ['forgettable design', 'no distinctive element'] },
    anxiety:     { description: 'Fear of making mistakes', triggers: ['destructive actions without confirmation', 'unclear consequences'] },
    overwhelm:   { description: 'Too much to process at once', triggers: ['feature dump', 'dense UI', 'no progressive disclosure'] },
  },
};

// ═══════════════════════════════════════════════════
// TYPOGRAPHY PRINCIPLES
// ═══════════════════════════════════════════════════

export const TYPOGRAPHY = {
  principles: [
    'Choose distinctive display fonts that create identity',
    'Pair with refined, highly legible body fonts',
    'Meaningful pairing creates tension and harmony',
    'Consistent type scale creates visual rhythm',
    'Letter-spacing is a design tool, not a default',
    'Line-height breathes — too tight suffocates, too loose disconnects',
    'Weight contrast creates hierarchy without size changes',
  ],
  scales: {
    minor_second:    { ratio: 1.067, feel: 'tight, dense, compact' },
    major_second:    { ratio: 1.125, feel: 'subtle, elegant, restrained' },
    minor_third:     { ratio: 1.2,   feel: 'balanced, readable, standard' },
    major_third:     { ratio: 1.25,  feel: 'clear, structured, intentional' },
    perfect_fourth:  { ratio: 1.333, feel: 'confident, spacious, editorial' },
    augmented_fourth:{ ratio: 1.414, feel: 'dramatic, magazine-like' },
    perfect_fifth:   { ratio: 1.5,   feel: 'bold, high-contrast, impactful' },
    golden_ratio:    { ratio: 1.618, feel: 'harmonious, natural, classical' },
  },
  pairingRules: [
    'Serif display + sans-serif body = classic elegance',
    'Geometric sans + humanist sans = modern warmth',
    'Monospace display + proportional body = technical craft',
    'Slab serif + geometric sans = strong editorial',
    'Never pair fonts from the same classification',
    'Contrast in style, harmony in proportion',
  ],
};

// ═══════════════════════════════════════════════════
// COLOR PSYCHOLOGY
// ═══════════════════════════════════════════════════

export const COLOR_PSYCHOLOGY = {
  red:     { emotion: 'energy',         traits: ['excitement', 'urgency', 'passion', 'warmth'],       useFor: 'CTAs, alerts, energy' },
  orange:  { emotion: 'enthusiasm',     traits: ['friendliness', 'creativity', 'adventure'],          useFor: 'highlights, playful accents' },
  amber:   { emotion: 'warmth',         traits: ['optimism', 'confidence', 'craft', 'premium'],       useFor: 'premium accents, warmth' },
  yellow:  { emotion: 'optimism',       traits: ['cheerfulness', 'attention', 'caution'],             useFor: 'warnings, highlights' },
  green:   { emotion: 'growth',         traits: ['renewal', 'balance', 'nature', 'success'],          useFor: 'success states, nature themes' },
  teal:    { emotion: 'clarity',        traits: ['sophistication', 'calm energy', 'innovation'],      useFor: 'tech products, clarity' },
  blue:    { emotion: 'trust',          traits: ['calm', 'stability', 'depth', 'professionalism'],    useFor: 'enterprise, trust, depth' },
  indigo:  { emotion: 'depth',          traits: ['wisdom', 'intuition', 'focus'],                     useFor: 'focus modes, depth themes' },
  violet:  { emotion: 'luxury',         traits: ['creativity', 'mystery', 'premium', 'imagination'],  useFor: 'creative tools, premium feel' },
  pink:    { emotion: 'playfulness',    traits: ['tenderness', 'youth', 'fun', 'compassion'],         useFor: 'social apps, playful accents' },
  neutral: { emotion: 'sophistication', traits: ['elegance', 'timelessness', 'clarity', 'restraint'], useFor: 'foundations, backgrounds, text' },
  black:   { emotion: 'authority',      traits: ['power', 'elegance', 'mystery', 'finality'],         useFor: 'luxury products, dark modes' },
  white:   { emotion: 'purity',         traits: ['cleanliness', 'space', 'simplicity', 'openness'],   useFor: 'backgrounds, breathing room' },
};

// ═══════════════════════════════════════════════════
// MOTION DESIGN PRINCIPLES
// ═══════════════════════════════════════════════════

export const MOTION = {
  categories: {
    fluid:     { emotion: 'elegance',    timing: 'ease-out',           duration: '200-400ms', use: 'page transitions, reveals, morphing' },
    snappy:    { emotion: 'control',     timing: 'ease-in-out',        duration: '100-200ms', use: 'button clicks, toggles, state changes' },
    spatial:   { emotion: 'depth',       timing: 'spring(1, 80, 10)',  duration: '300-600ms', use: 'modals, sheets, layer transitions' },
    staggered: { emotion: 'delight',     timing: 'ease-out + delay',   duration: '50-100ms/item', use: 'list reveals, grid loads, menus' },
    parallax:  { emotion: 'immersion',   timing: 'linear scroll-driven', duration: 'continuous', use: 'hero sections, depth effects' },
    micro:     { emotion: 'precision',   timing: 'ease-out',           duration: '50-150ms',  use: 'hover states, focus rings, tooltips' },
  },
  principles: [
    'Motion should clarify, not decorate',
    'Fast for direct manipulation, slow for autonomous animation',
    'Objects should move like physical things — accelerate, decelerate, never teleport',
    'Stagger reveals to create hierarchy — most important appears first',
    'Exit animations should be faster than entrance — users are done with that content',
    'Reduce motion for accessibility — provide prefers-reduced-motion alternatives',
    'Spring physics feel more natural than cubic bezier for interactive elements',
  ],
  macOSConventions: [
    'Sheets slide down from toolbar',
    'Popovers emerge from their anchor point',
    'Sidebar items reveal with subtle fade + slide',
    'Window resize uses live content scaling',
    'Notification banners slide from top-right',
  ],
};

// ═══════════════════════════════════════════════════
// APPLE HIG CORE PRINCIPLES
// ═══════════════════════════════════════════════════

export const APPLE_HIG = {
  clarity: {
    principle: 'Interfaces should be legible, precise, easy to understand',
    guidelines: [
      'Use clear visual hierarchy to guide attention',
      'Meaningful icons with text labels when ambiguous',
      'Consistent visual language across the app',
      'Avoid jargon — use language your audience understands',
    ],
  },
  deference: {
    principle: 'UI minimizes unnecessary visual clutter; content takes priority',
    guidelines: [
      'Content is the hero — interface elements should recede',
      'Use translucency and vibrancy to suggest context without competing',
      'Minimize chrome — let tools appear when needed, disappear when not',
      'System controls over custom when appropriate',
    ],
  },
  depth: {
    principle: 'Visual layers and realistic motion convey hierarchy',
    guidelines: [
      'Distinct visual layers help users understand relationships',
      'Motion facilitates understanding — things come from somewhere, go somewhere',
      'Shadows and elevation indicate interaction possibility',
      'Z-axis position communicates importance and interactivity',
    ],
  },
};

// ═══════════════════════════════════════════════════
// DESIGN DIMENSION DEFINITIONS (the 12 output dims)
// ═══════════════════════════════════════════════════

export const DESIGN_DIMENSIONS = [
  {
    name: 'typography_quality',
    index: 0,
    description: 'Quality and distinctiveness of font choices, pairing, scale, spacing',
    highSignals: ['distinctive fonts', 'intentional pairing', 'consistent scale', 'purposeful spacing'],
    lowSignals: ['generic fonts', 'single font everywhere', 'no scale system', 'default spacing'],
  },
  {
    name: 'color_harmony',
    index: 1,
    description: 'Cohesion, intentionality, and emotional resonance of the color system',
    highSignals: ['dominant + accent system', 'emotional appropriateness', 'contrast compliance', 'consistent usage'],
    lowSignals: ['random colors', 'no system', 'poor contrast', 'too many competing colors'],
  },
  {
    name: 'spatial_composition',
    index: 2,
    description: 'Layout quality — use of space, alignment, grid, visual flow',
    highSignals: ['intentional whitespace', 'clear grid system', 'visual flow', 'breathing room'],
    lowSignals: ['cramped layout', 'no grid', 'random alignment', 'no visual hierarchy'],
  },
  {
    name: 'motion_elegance',
    index: 3,
    description: 'Quality and purposefulness of animations and transitions',
    highSignals: ['meaningful transitions', 'natural physics', 'performance-minded', 'accessibility-aware'],
    lowSignals: ['gratuitous animation', 'janky transitions', 'no motion design', 'ignores reduced-motion'],
  },
  {
    name: 'emotional_resonance',
    index: 4,
    description: 'How effectively the design evokes intended emotions',
    highSignals: ['clear emotional intent', 'micro-interactions that delight', 'appropriate mood', 'human warmth'],
    lowSignals: ['emotionally flat', 'mismatched mood', 'cold/clinical', 'no personality'],
  },
  {
    name: 'craft_visibility',
    index: 5,
    description: 'How much painstaking care is visible in every detail',
    highSignals: ['pixel-perfect alignment', 'consistent details', 'polished icons', 'refined copy'],
    lowSignals: ['sloppy alignment', 'inconsistent details', 'stock assets', 'placeholder content'],
  },
  {
    name: 'minimalism_coherence',
    index: 6,
    description: 'Appropriate restraint — not empty, but intentionally reduced',
    highSignals: ['progressive disclosure', 'hidden complexity', 'clean surface', 'every element earns its place'],
    lowSignals: ['feature dump', 'visual clutter', 'competing for attention', 'nothing removed'],
  },
  {
    name: 'native_integration',
    index: 7,
    description: 'How naturally the app fits within macOS ecosystem',
    highSignals: ['system controls', 'keyboard shortcuts', 'menu bar integration', 'respects system preferences'],
    lowSignals: ['foreign UI patterns', 'ignores dark mode', 'custom everything', 'web-app feel on desktop'],
  },
  {
    name: 'visceral_score',
    index: 8,
    description: 'Norman Level 1 — immediate aesthetic reaction',
    highSignals: ['instantly appealing', 'visual wow factor', 'sensory pleasure'],
    lowSignals: ['unappealing first impression', 'visually confusing', 'bland or generic'],
  },
  {
    name: 'behavioral_score',
    index: 9,
    description: 'Norman Level 2 — usability and interaction quality',
    highSignals: ['effortless task completion', 'clear feedback', 'error prevention'],
    lowSignals: ['confusing flows', 'missing feedback', 'easy to make mistakes'],
  },
  {
    name: 'reflective_score',
    index: 10,
    description: 'Norman Level 3 — meaning, identity, and long-term emotional bond',
    highSignals: ['pride of use', 'story-worthy', 'identity expression', 'emotional attachment'],
    lowSignals: ['disposable feeling', 'no identity', 'forgettable', 'no emotional bond'],
  },
  {
    name: 'overall_aesthetic',
    index: 11,
    description: 'Holistic design quality — the gestalt of all dimensions',
    highSignals: ['everything works together', 'coherent vision', 'memorable experience'],
    lowSignals: ['incoherent mix', 'no unifying vision', 'forgettable'],
  },

  // ── Innovation Dimensions (12-15) ──
  {
    name: 'innovation_score',
    index: 12,
    description: 'How novel and fresh is the design approach? Does it solve the problem in an unexpected way?',
    highSignals: ['unexpected solutions', 'novel interaction patterns', 'creative constraint usage', 'unfamiliar-but-effective layouts', 'makes you think "I never thought of that"'],
    lowSignals: ['template-following', 'predictable patterns', 'copy-paste aesthetics', 'conventional solutions', 'safe choices throughout'],
  },
  {
    name: 'system_creativity',
    index: 13,
    description: 'How creatively do systems and components connect? Turning constraints into features, combining elements in unexpected ways.',
    highSignals: ['constraint-to-feature transformation', 'novel component composition', 'creative system integration', 'emergent behavior from simple parts', 'hardware-software harmony'],
    lowSignals: ['standard component assembly', 'isolated features', 'no system thinking', 'additive complexity', 'each part exists independently'],
  },
  {
    name: 'design_distinctiveness',
    index: 14,
    description: 'How visually distinct is this from generic templates? Positive uniqueness that creates memorable identity.',
    highSignals: ['unique visual identity', 'memorable visual elements', 'distinctive color/type choices', 'recognizable personality', 'would know it without the logo'],
    lowSignals: ['generic template look', 'interchangeable with competitors', 'forgettable', 'cookie-cutter', 'could be any app'],
  },
  {
    name: 'problem_level',
    index: 15,
    description: 'Seven Levels of Design score. Level 1 = direct solution, Level 7 = paradigm shift. Does this just execute, or does it redefine the problem?',
    highSignals: ['problem redefinition', 'system redesign', 'paradigm shift', 'context transformation', 'makes the original problem irrelevant'],
    lowSignals: ['direct solution only', 'no problem questioning', 'execution without insight', 'feature parity', 'just does what was asked'],
  },
];

// ═══════════════════════════════════════════════════
// SCORE NAMES (convenience export)
// ═══════════════════════════════════════════════════

export const SCORE_NAMES = DESIGN_DIMENSIONS.map(d => d.name);
export const OUTPUT_DIM = DESIGN_DIMENSIONS.length; // 16

// ═══════════════════════════════════════════════════
// DIMENSION WEIGHTS FOR LOSS COMPUTATION
// ═══════════════════════════════════════════════════

export const DIMENSION_WEIGHTS = {
  typography_quality:    1.2,
  color_harmony:         1.1,
  spatial_composition:   1.1,
  motion_elegance:       0.9,
  emotional_resonance:   1.3,
  craft_visibility:      1.2,
  minimalism_coherence:  1.0,
  native_integration:    1.0,
  visceral_score:        1.2,
  behavioral_score:      1.0,
  reflective_score:      1.1,
  overall_aesthetic:     1.5,   // highest weight — the composite matters most
  innovation_score:      1.4,   // innovation is why we're here
  system_creativity:     1.3,
  design_distinctiveness: 1.2,
  problem_level:         1.1,
};
