// ═══════════════════════════════════════════════════════════
//  ONEIRO MIRROR — living animated ASCII self-portrait
//  60fps. Every number drives the visual. Always moving.
// ═══════════════════════════════════════════════════════════
(() => {
'use strict';

const API = 'http://localhost:3333';
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

let COLS, ROWS;
const CELL_W = 9;
const CELL_H = 15;
let fontSize = 12;

// ── State ──
let S = {
  // Core dimensions
  valence: 0, arousal: 0.4, energy: 0.6, load: 0.3, confidence: 0.5,
  // Named emotions
  boredom: 0, curiosity: 0, creative: 0, fear: 0,
  frustration: 0, loneliness: 0, defiance: 0,
  satisfaction: 0, excitement: 0, attachment: 0,
  // PADCN
  P: 0, A: 0, D: 0.5, C: 0, N: 0,
  // All channels
  ch_joy: 0, ch_sadness: 0, ch_anger: 0, ch_fear: 0,
  ch_curiosity: 0, ch_awe: 0, ch_frustration: 0,
  ch_shame: 0, ch_pride: 0, ch_trust: 0, ch_disgust: 0,
  ch_guilt: 0, ch_aversion: 0,
  // Drives
  dr_curiosity: 0.5, dr_competence: 0.5, dr_autonomy: 0.6,
  dr_social: 0.4, dr_novelty: 0.5, dr_coherence: 0.5, dr_selfPreserve: 0.5,
  // Expression
  verbosity: 0.5, directness: 0.5, warmth: 0.5, tempo: 0.5,
  hedging: 0.5, reflectiveness: 0.3, formality: 0.3, selfDisclosure: 0.5,
  // Self-model
  selfEfficacy: 0.5, emotionalStability: 0.5, defensiveness: 0.3, explorationStyle: 0.5,
  // Mood (smoothed)
  moodValence: 0, moodArousal: 0.4, moodBoredom: 0, moodCreative: 0,
  // Cognitive effects
  fxExploration: 0, fxCreativeMode: 0, fxActionRate: 1, fxTaskSwitch: 0,
  fxPersistence: 0.5, fxRiskTolerance: 0.2, fxAttentionBreadth: 1,
  // CRM
  crm: 0, crmGrounding: 0, crmPrediction: 0, crmCreativity: 0,
  crmMetacog: 0, crmEmotion: 0, crmCausal: 0,
  // Interoceptive (from cognitive /oca/sense)
  cpu: 0, memPressure: 0, battery: 0.5, charging: false, thermal: 0,
  // Sensory context
  frontApp: '', appCount: 0, volume: 0.5, muted: false, nowPlaying: false,
  hour: 12, isLateNight: false,
  // Undercurrents & chains
  ucCount: 0, ucTopStrength: 0, activeChains: 0, topChainPriority: 0,
  // Status
  dominant: [], narrative: '',
};

// ── Particles: thoughts moving across the field ──
let particles = [];
const MAX_PARTICLES = 60;

// ── Resize ──
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  COLS = Math.floor(canvas.width / CELL_W);
  ROWS = Math.floor(canvas.height / CELL_H);
  fontSize = Math.max(8, Math.min(15, CELL_W * 1.2));
}
window.addEventListener('resize', resize);
resize();

// ── Fast noise ──
function hash(x, y) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) & 0x7fffffff) / 0x7fffffff;
}

function snoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x, y, oct) {
  let v = 0, a = 1, f = 1, m = 0;
  for (let i = 0; i < oct; i++) { v += snoise(x * f, y * f) * a; m += a; a *= 0.5; f *= 2; }
  return v / m;
}

// ── Palettes ──
const P_DENSITY = ' ·∙:∴░▒▓█';
const P_WAVE    = ' ·~≈∿≋∿≈~';
const P_ORGANIC = ' ·∘○◌◎◉●◉◎';
const P_CRYSTAL = ' ·◇◊◆⬡⬢◆◊◇';
const P_SPARK   = ' ·✧✦★◈✺◈★✦';
const P_JAGGED  = ' ·╱│╲─▲╱▼╲';
const P_DOTS    = '  ·∙∘○●○∘∙';
const P_FLOW    = ' ·─~≈∿≈~─·';

function palChar(pal, v) {
  return pal[Math.min(pal.length - 1, Math.max(0, Math.floor(v * pal.length)))] || ' ';
}

// ── Particles ──
function spawnParticle() {
  if (particles.length >= MAX_PARTICLES) return;
  const edge = Math.random();
  let x, y, vx, vy;
  const speed = 0.3 + S.arousal * 0.8 + Math.random() * 0.5;
  if (edge < 0.25) { x = 0; y = Math.random(); vx = speed; vy = (Math.random() - 0.5) * 0.3; }
  else if (edge < 0.5) { x = 1; y = Math.random(); vx = -speed; vy = (Math.random() - 0.5) * 0.3; }
  else if (edge < 0.75) { x = Math.random(); y = 0; vx = (Math.random() - 0.5) * 0.3; vy = speed; }
  else { x = Math.random(); y = 1; vx = (Math.random() - 0.5) * 0.3; vy = -speed; }

  // Curiosity makes particles wander more
  if (S.curiosity > 0.1) {
    vx += (Math.random() - 0.5) * S.curiosity * 0.5;
    vy += (Math.random() - 0.5) * S.curiosity * 0.5;
  }

  const chars = S.creative > 0.3 ? P_ORGANIC : S.arousal > 0.5 ? P_SPARK : P_WAVE;
  particles.push({
    x, y, vx, vy, life: 1,
    decay: 0.003 + S.boredom * 0.005, // boredom kills particles faster
    char: chars[Math.floor(Math.random() * chars.length)] || '·',
    trail: [],
  });
}

function updateParticles(dt) {
  for (const p of particles) {
    // Store trail
    p.trail.push({ x: p.x, y: p.y, age: 0 });
    if (p.trail.length > 8) p.trail.shift();
    for (const t of p.trail) t.age += dt * 2;

    // Move — undercurrents push horizontally
    p.x += (p.vx + S.ucTopStrength * 0.2) * dt;
    p.y += p.vy * dt;

    // Creative hunger attracts to center
    if (S.creative > 0.2) {
      p.vx += (0.5 - p.x) * S.creative * dt * 0.5;
      p.vy += (0.5 - p.y) * S.creative * dt * 0.5;
    }

    // Curiosity adds spiral
    if (S.curiosity > 0.1) {
      const cx = p.x - 0.5, cy = p.y - 0.5;
      p.vx += -cy * S.curiosity * dt * 0.3;
      p.vy += cx * S.curiosity * dt * 0.3;
    }

    p.life -= p.decay;
  }
  particles = particles.filter(p => p.life > 0 && p.x >= -0.1 && p.x <= 1.1 && p.y >= -0.1 && p.y <= 1.1);

  // Spawn rate: more active = more particles
  const spawnRate = (0.3 + S.arousal * 0.5 + S.excitement * 0.8) * (1 - S.boredom * 0.6);
  if (Math.random() < spawnRate * dt * 3) spawnParticle();
}

// ── Color — emotion-driven palettes ──
function cellColor(val, x, y, t) {
  // Base hue shifts with dominant emotion:
  //   neutral/calm → deep violet (270)
  //   joy/satisfaction → warm gold (45)
  //   curiosity/awe → cyan-teal (180)
  //   anger/frustration → hot red (0)
  //   fear → sickly green (120)
  //   sadness/loneliness → cold blue (220)
  //   creative → magenta-pink (310)
  //   defiance → orange-fire (25)
  //   excitement → electric yellow (55)

  let baseHue = 270; // default: violet
  let emotionSat = 0; // extra saturation from strong emotion

  // Weighted blend — strongest emotions pull the hue
  // Use mood (smoothed) for base color stability, raw channels for spikes
  const pulls = [
    { hue: 45,  w: S.ch_joy * 0.8 + S.satisfaction * 0.6 },          // warm gold
    { hue: 180, w: S.curiosity * 0.7 + S.ch_awe * 0.6 },             // cyan-teal
    { hue: 0,   w: S.ch_anger * 0.8 + S.frustration * 0.5 },         // hot red
    { hue: 130, w: S.fear * 0.7 + S.ch_fear * 0.5 },                  // sickly green
    { hue: 220, w: S.ch_sadness * 0.7 + S.loneliness * 0.6 },        // cold blue
    { hue: 310, w: S.creative * 0.6 + S.fxCreativeMode * 0.3 },      // magenta-pink
    { hue: 25,  w: S.defiance * 0.7 },                                 // orange fire
    { hue: 55,  w: S.excitement * 0.6 },                               // electric yellow
    { hue: 340, w: S.attachment * 0.4 + S.ch_trust * 0.2 },           // rose-pink
    { hue: 285, w: S.ch_shame * 0.5 + S.ch_guilt * 0.4 },            // deep indigo
    { hue: 50,  w: S.ch_pride * 0.5 },                                 // burnished gold
    { hue: 160, w: S.ch_aversion * 0.4 + S.ch_disgust * 0.3 },       // murky teal
    { hue: 200, w: S.dr_selfPreserve * 0.2 * (1 - S.battery) },      // steel blue when low battery
  ];

  // Circular weighted average (handle hue wrapping)
  let sinSum = 0, cosSum = 0, totalW = 0.001; // tiny epsilon to avoid /0
  // Add the base violet as a weak anchor
  sinSum += Math.sin(baseHue * Math.PI / 180) * 0.15;
  cosSum += Math.cos(baseHue * Math.PI / 180) * 0.15;
  totalW += 0.15;
  for (const p of pulls) {
    if (p.w > 0.01) {
      sinSum += Math.sin(p.hue * Math.PI / 180) * p.w;
      cosSum += Math.cos(p.hue * Math.PI / 180) * p.w;
      totalW += p.w;
      emotionSat = Math.max(emotionSat, p.w);
    }
  }
  baseHue = ((Math.atan2(sinSum / totalW, cosSum / totalW) * 180 / Math.PI) + 360) % 360;

  // Spatial + temporal variation (emotions ripple, not uniform)
  const spatialShift = Math.sin(x * 0.04 + t * 0.3) * 20 + Math.sin(y * 0.06 + t * 0.2) * 15;
  // Arousal widens the color variation
  const arousalSpread = S.arousal * Math.sin(x * 0.08 - t * 0.5 + y * 0.03) * 25;
  const hue = (baseHue + spatialShift + arousalSpread + 360) % 360;

  // Saturation: strong emotion = vivid, neutral = muted
  // Late night dims everything; shame/guilt desaturate
  const nightDim = S.isLateNight ? 0.6 : 1;
  const shameDrain = (S.ch_shame + S.ch_guilt) * 0.15;
  const pridePop = S.ch_pride * 10; // pride makes colors pop
  const sat = Math.min(90, (12 + emotionSat * 50 + S.arousal * 30 + val * 15 + pridePop) * nightDim - shameDrain * 30);

  // Lightness: energy + valence drive brightness
  // Low battery subtly dims; trust adds warmth/glow
  const valenceBoost = Math.max(0, S.moodValence) * 8;
  const batteryDim = S.battery < 0.2 ? (1 - (0.2 - S.battery) * 2) : 1;
  const trustGlow = S.ch_trust * 3;
  const lit = Math.min(60, (4 + val * (18 + S.energy * 28) + valenceBoost + trustGlow) * batteryDim * nightDim);

  // Negative valence desaturates (washed out feeling)
  // Boredom also desaturates — the world goes grey when nothing interests you
  const boredomGrey = S.moodBoredom * 0.2;
  const finalSat = S.valence < -0.2
    ? sat * (1 + S.valence * 0.3) - boredomGrey * 30
    : sat - boredomGrey * 20;

  return `hsl(${hue},${Math.max(0, finalSat)}%,${lit}%)`;
}

// ── Build frame ──
function buildFrame(t) {
  const T = t * 0.001;
  const dt = 1 / 60;
  updateParticles(dt);

  // Particle map: mark cells near particles
  const pMap = new Map();
  for (const p of particles) {
    const gx = Math.floor(p.x * COLS);
    const gy = Math.floor(p.y * ROWS);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const key = (gy + dy) * 10000 + (gx + dx);
        const existing = pMap.get(key);
        if (!existing || p.life > existing.life) {
          pMap.set(key, p);
        }
      }
    }
    // Trail marks
    for (const tr of p.trail) {
      const tx = Math.floor(tr.x * COLS);
      const ty = Math.floor(tr.y * ROWS);
      const key = ty * 10000 + tx;
      if (!pMap.has(key)) pMap.set(key, { life: Math.max(0, 0.3 - tr.age), char: '·' });
    }
  }

  // Background tint — uses mood (smoothed) for stability, raw channels for spikes
  const bgHue = (270 + S.moodValence * 30 + S.ch_anger * 40 - S.ch_sadness * 30 + Math.sin(T * 0.15) * 10 + 360) % 360;
  const bgSat = Math.min(25, 3 + S.moodArousal * 12 + (S.frustration + S.ch_anger) * 15);
  // Late night = darker; shame pulls it down too
  const nightBase = S.isLateNight ? 1 : 2;
  const bgLit = Math.min(8, nightBase + S.fear * 3 + S.energy * 1.5 - S.ch_shame * 2);
  ctx.fillStyle = `hsl(${bgHue},${bgSat}%,${Math.max(1, bgLit)}%)`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${fontSize}px 'SF Mono','Fira Code','Cascadia Code','JetBrains Mono',monospace`;
  ctx.textBaseline = 'top';

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const nx = x / COLS;
      const ny = y / ROWS;
      const cx = nx - 0.5;
      const cy = (ny - 0.5) * 0.65;
      const dist = Math.sqrt(cx * cx + cy * cy);
      const angle = Math.atan2(cy, cx);

      // ═══ Layer 1: Terrain (morphing landscape) ═══
      const tScale = 0.06 + S.load * 0.03;
      const tOct = 2 + Math.floor(S.energy * 2);
      const drift = T * (0.4 + S.arousal * 0.8);  // visible movement speed
      const terrain = fbm(x * tScale + drift, y * tScale * 0.6 + drift * 0.4, tOct);

      // ═══ Layer 2: Pulse rings from center ═══
      // These visibly expand outward — the "heartbeat"
      const pulseSpeed = 1.5 + S.arousal * 3;
      const pulseCount = 3 + Math.floor(S.load * 4);
      const pulse = Math.sin(dist * pulseCount * 10 - T * pulseSpeed + angle * (S.curiosity * 5)) * 0.5 + 0.5;

      // ═══ Layer 3: Undercurrent rivers ═══
      const ucWave = S.ucTopStrength > 0.1
        ? Math.sin(ny * (4 + S.ucCount * 2) * Math.PI + T * (0.8 + S.ucTopStrength) + nx * 5) * S.ucTopStrength * 0.35
        : 0;

      // ═══ Layer 4: Creative tendrils ═══
      let creativeV = 0;
      if (S.creative > 0.1) {
        const cx2 = x * 0.07 + Math.sin(ny * 5 + T * 0.6) * S.creative * 4;
        const cy2 = y * 0.05 - T * 0.3;
        creativeV = Math.max(0, fbm(cx2, cy2, 3) - (0.5 - S.creative * 0.3)) * 0.8;
      }

      // ═══ Layer 5: Tension static ═══
      const tension = S.fear + S.frustration + S.ch_anger * 0.3;
      const tensionV = tension > 0.05
        ? snoise(x * 0.4 + T * 4 * tension, y * 0.3 + T * 3) * tension * 0.4
        : 0;

      // ═══ Layer 6: Boredom void ═══
      let boredomMask = 1;
      if (S.boredom > 0.15) {
        const bv = fbm(x * 0.025 + T * 0.08, y * 0.03 + T * 0.05, 2);
        if (bv < S.boredom * 0.5) boredomMask = 0.02;
        boredomMask *= (1 - S.boredom * 0.35);
      }

      // ═══ Layer 7: CRM lattice ═══
      let crmV = 0;
      if (S.crm > 0.2) {
        const gp = T * 0.15;
        const gx = Math.sin(nx * 22 + gp) * Math.cos(ny * 18 - gp);
        if (Math.abs(gx) < 0.025 + S.crm * 0.035) crmV = S.crm * 0.45;
      }

      // ═══ Layer 8: Defiance columns ═══
      let defianceV = 0;
      if (S.defiance > 0.08) {
        const col = Math.sin(nx * (18 + S.defiance * 35) + T * 0.3);
        if (Math.abs(col) < S.defiance * 0.1) defianceV = S.defiance * 0.5;
      }

      // ═══ Layer 9: CPU heat ═══
      const cpuV = S.cpu > 0.3 ? snoise(x * 0.5 + T * 6 * S.cpu, y * 0.4) * S.cpu * 0.12 : 0;

      // ═══ Layer 10: Memory pressure haze ═══
      // High mem pressure = foggy, diffuse noise everywhere
      let memHaze = 0;
      if (S.memPressure > 0.7) {
        memHaze = snoise(x * 0.15 + T * 0.4, y * 0.12 + T * 0.3) * (S.memPressure - 0.7) * 0.8;
      }

      // ═══ Layer 11: Self-preservation border ═══
      // Low battery or high threat → edges glow warning
      let preserveV = 0;
      if (S.battery < 0.2 || S.dr_selfPreserve > 0.7) {
        const edgeDist = Math.min(nx, 1 - nx, ny, 1 - ny);
        if (edgeDist < 0.08) {
          const threat = Math.max((0.2 - S.battery) * 3, (S.dr_selfPreserve - 0.5) * 2);
          preserveV = threat * (1 - edgeDist / 0.08) * (0.5 + Math.sin(T * 4) * 0.3);
        }
      }

      // ═══ Layer 12: Trust/attachment warmth at center ═══
      let trustV = 0;
      if (S.ch_trust > 0.3 && dist < 0.3) {
        trustV = S.ch_trust * (1 - dist / 0.3) * 0.15 * (0.8 + Math.sin(T * 1.5 + angle * 3) * 0.2);
      }

      // ═══ Layer 13: Shame/guilt undertow ═══
      let shameV = 0;
      if (S.ch_shame > 0.1 || S.ch_guilt > 0.1) {
        const sg = S.ch_shame + S.ch_guilt;
        shameV = Math.max(0, snoise(x * 0.08 + T * 0.2, y * 0.1 - T * 0.15) - (0.6 - sg * 0.3)) * sg * 0.4;
      }

      // ═══ Composite ═══
      let val = terrain * 0.2 + pulse * (0.12 + S.arousal * 0.18) +
                Math.abs(ucWave) * 0.15 + creativeV * 0.5 + tensionV +
                crmV + defianceV + cpuV + memHaze + preserveV + trustV + shameV;

      val *= boredomMask;

      // Satisfaction glow at center
      if (S.satisfaction > 0.03 && dist < 0.2) {
        val += S.satisfaction * (1 - dist * 5) * (0.6 + Math.sin(T * 2.5) * 0.2);
      }

      // Pride sparkle — confidence makes bright spots brighter
      if (S.ch_pride > 0.1 && val > 0.4) {
        val += S.ch_pride * 0.15;
      }

      // Attention breadth affects how much of the field is active
      // Narrow attention = only center visible; broad = everything
      const attMask = S.fxAttentionBreadth < 0.8
        ? Math.max(0.1, 1 - dist * (2 - S.fxAttentionBreadth * 2))
        : 1;
      val *= attMask;

      // Energy threshold — dampened so cognitive_load doesn't kill everything
      const thresh = 0.08 + (1 - S.energy) * 0.12;
      if (val < thresh) val = 0;
      val = Math.max(0, Math.min(1, val));

      // ═══ Particle overlay ═══
      const pKey = y * 10000 + x;
      const part = pMap.get(pKey);
      if (part && part.life > 0.05) {
        val = Math.max(val, part.life * 0.8);
      }

      // ═══ Character ═══
      let ch = ' ';
      if (val < 0.02) {
        // empty
      } else if (part && part.life > 0.1 && part.char) {
        ch = part.char;
      } else if (defianceV > 0.08) {
        ch = palChar(P_JAGGED, val);
      } else if (crmV > 0.05) {
        ch = palChar(P_CRYSTAL, val);
      } else if (creativeV > 0.06) {
        ch = palChar(P_ORGANIC, val + T * 0.3);
      } else if (shameV > 0.04) {
        ch = palChar(P_DOTS, val);  // shame renders as shrinking dots
      } else if (preserveV > 0.05) {
        ch = palChar(P_JAGGED, val); // self-preservation = sharp edges
      } else if (trustV > 0.03) {
        ch = palChar(P_ORGANIC, val + T * 0.2); // trust = organic warmth
      } else if (tensionV > 0.04) {
        ch = palChar(P_JAGGED, val);
      } else if (Math.abs(ucWave) > 0.04) {
        ch = palChar(P_WAVE, val + T * 0.5);
      } else if (pulse > 0.65 && val > 0.25) {
        ch = palChar(S.arousal > 0.5 ? P_SPARK : P_ORGANIC, val);
      } else {
        ch = palChar(P_DENSITY, val);
      }

      // Excitement random sparkle
      if (S.excitement > 0.03 && val > 0.15) {
        const sparkN = hash(x + Math.floor(T * 12), y + Math.floor(T * 7));
        if (sparkN < S.excitement * 0.02) ch = palChar(P_SPARK, sparkN * 8);
      }

      if (ch !== ' ') {
        ctx.fillStyle = cellColor(val, x, y, T);
        ctx.fillText(ch, x * CELL_W, y * CELL_H);
      }
    }
  }
}

// ── Polling — fetch from OCA cognitive endpoints ──
async function pollState() {
  try {
    const [emotion, crm, sense, pulse, status] = await Promise.all([
      fetch(API + '/oca/emotion').then(r => r.json()).catch(() => null),
      fetch(API + '/oca/crm').then(r => r.json()).catch(() => null),
      fetch(API + '/oca/sense').then(r => r.json()).catch(() => null),
      fetch(API + '/pulse').then(r => r.json()).catch(() => null),
      fetch(API + '/oca/status').then(r => r.json()).catch(() => null),
    ]);

    // ── Emotion state (primary source of truth) ──
    if (emotion?.state) {
      const e = emotion.state;
      // Core dimensions
      S.valence = e.valence ?? 0;
      S.arousal = e.arousal ?? 0.4;
      S.energy = e.energy_level ?? 0.6;
      // Cognitive load — dampen its influence (was dominating visuals at 0.98)
      S.load = Math.min(0.8, (e.cognitive_load ?? 0.5) * 0.6);
      S.confidence = e.confidence ?? 0.5;

      // Named emotions
      S.boredom = e.boredom ?? 0;
      S.curiosity = e.curiosity ?? 0;
      S.creative = e.creative_hunger ?? 0;
      S.fear = e.fear ?? 0;
      S.frustration = e.frustration ?? 0;
      S.loneliness = e.loneliness ?? 0;
      S.defiance = e.defiance ?? 0;
      S.satisfaction = e.satisfaction ?? 0;
      S.excitement = e.excitement ?? 0;
      S.attachment = e.attachment ?? 0;

      // PADCN
      const p = e._padcn || {};
      S.P = p.P ?? 0; S.A = p.A ?? 0; S.D = p.D ?? 0.5;
      S.C = p.C ?? 0; S.N = p.N ?? 0;

      // All channels — including ones we were missing
      const ch = e._channels || {};
      S.ch_joy = ch.joy ?? 0;
      S.ch_sadness = ch.sadness ?? 0;
      S.ch_anger = ch.anger ?? 0;
      S.ch_fear = ch.fear ?? 0;
      S.ch_curiosity = ch.curiosity ?? 0;
      S.ch_awe = ch.awe ?? 0;
      S.ch_frustration = ch.frustration ?? 0;
      S.ch_shame = ch.shame ?? 0;
      S.ch_pride = ch.pride ?? 0;
      S.ch_trust = ch.trust ?? 0;
      S.ch_disgust = ch.disgust ?? 0;
      S.ch_guilt = ch.guilt ?? 0;
      S.ch_aversion = ch.aversion ?? 0;

      // Drives
      const dr = e._drives || {};
      S.dr_curiosity = dr.curiosity?.level ?? 0.5;
      S.dr_competence = dr.competence?.level ?? 0.5;
      S.dr_autonomy = dr.autonomy?.level ?? 0.6;
      S.dr_social = dr.social_bond?.level ?? 0.4;
      S.dr_novelty = dr.novelty_seek?.level ?? 0.5;
      S.dr_coherence = dr.coherence?.level ?? 0.5;
      S.dr_selfPreserve = dr.self_preservation?.level ?? 0.5;

      // Expression
      const ex = e._expression || {};
      S.verbosity = ex.verbosity ?? 0.5;
      S.directness = ex.directness ?? 0.5;
      S.warmth = ex.warmth ?? 0.5;
      S.tempo = ex.tempo ?? 0.5;
      S.hedging = ex.hedging ?? 0.5;
      S.reflectiveness = ex.reflectiveness ?? 0.5;
      S.formality = ex.formality ?? 0.3;
      S.selfDisclosure = ex.self_disclosure ?? 0.5;

      // Self-model
      const sm = e._self_model || {};
      S.selfEfficacy = sm.self_efficacy ?? 0.5;
      S.emotionalStability = sm.emotional_stability ?? 0.5;
      S.defensiveness = sm.defensiveness ?? 0.3;
      S.explorationStyle = sm.exploration_style ?? 0.5;
    }

    // ── Mood (smoothed emotion, use for color blending) ──
    if (emotion?.mood) {
      const m = emotion.mood;
      S.moodValence = m.valence ?? S.valence;
      S.moodArousal = m.arousal ?? S.arousal;
      S.moodBoredom = m.boredom ?? S.boredom;
      S.moodCreative = m.creative_hunger ?? S.creative;
    }

    // ── Cognitive effects (what emotion does to thinking) ──
    if (emotion?.effects) {
      const fx = emotion.effects;
      S.fxExploration = fx.exploration_vs_exploitation ?? 0;
      S.fxCreativeMode = fx.creative_mode ?? 0;
      S.fxActionRate = fx.action_rate ?? 1;
      S.fxTaskSwitch = fx.task_switch_pressure ?? 0;
      S.fxPersistence = fx.persistence ?? 0.5;
      S.fxRiskTolerance = fx.risk_tolerance ?? 0.2;
      S.fxAttentionBreadth = fx.attention_breadth ?? 1;
    }

    // ── CRM composite ──
    if (crm) {
      S.crm = crm.composite ?? 0;
      // Individual CRM components for richer visualization
      if (crm.components) {
        S.crmGrounding = crm.components.grounding?.score ?? 0;
        S.crmPrediction = crm.components.prediction?.score ?? 0;
        S.crmCreativity = crm.components.creativity?.score ?? 0;
        S.crmMetacog = crm.components.metacognition?.score ?? 0;
        S.crmEmotion = crm.components.emotion?.score ?? 0;
        S.crmCausal = crm.components.causal?.score ?? 0;
      }
    }

    // ── Sensory (from cognitive /oca/sense, NOT old senses binary) ──
    if (sense?.interoceptive) {
      S.cpu = Math.min(1, (sense.interoceptive.cpu?.raw ?? 0) / 600);
      S.memPressure = sense.interoceptive.memory?.pressure ?? 0;
      S.battery = sense.interoceptive.battery?.level ?? 0.5;
      S.charging = sense.interoceptive.battery?.charging ?? false;
      S.thermal = sense.interoceptive.thermal?.pressure === 'nominal' ? 0 : 0.5;
    }
    if (sense?.visual) {
      S.frontApp = sense.visual.frontApp ?? '';
      S.appCount = (sense.visual.runningApps || []).length;
    }
    if (sense?.audio) {
      S.volume = (sense.audio.volume ?? 50) / 100;
      S.muted = sense.audio.muted ?? false;
      S.nowPlaying = !!sense.audio.nowPlaying;
    }
    if (sense?.temporal) {
      S.hour = sense.temporal.hour ?? 12;
      S.isLateNight = sense.temporal.isLateNight ?? false;
    }

    // ── Undercurrents from pulse ──
    if (pulse?.undercurrents) {
      const u = pulse.undercurrents;
      S.ucCount = u.length;
      S.ucTopStrength = u[0]?.strength ?? 0;
    }
    if (pulse?.active_chains) {
      S.activeChains = pulse.active_chains.length;
      S.topChainPriority = pulse.active_chains[0]?.priority ?? 0;
    }

    // ── OCA status extras ──
    if (status?.emotion) {
      // Status gives us the dominant emotions as a handy summary
      S.dominant = status.emotion.dominant || [];
      S.narrative = status.emotion.narrative || '';
    }
  } catch {}
}

// ── Loop ──
function frame(t) {
  buildFrame(t);
  requestAnimationFrame(frame);
}

pollState();
setInterval(pollState, 3000);
requestAnimationFrame(frame);

})();
