// ═══════════════════════════════════════════════════════════════
//  ONEIRO NEURAL MAP — Real-time Cognitive Architecture Viz
// ═══════════════════════════════════════════════════════════════

(() => {
'use strict';

const API = 'http://localhost:3333';
const POLL_MS = 3000;
const PI2 = Math.PI * 2;
const DPR = window.devicePixelRatio || 1;
const MIN_SCALE = 0.3;
const MAX_SCALE = 3.0;
const LAYER_TO_NODE = {
    sensory: 'perception',
    sensory_swift: 'perception',
    perception: 'perception',
    interoception: 'interoception',
    emotion: 'emotion',
    metacognition: 'metacognition',
    hypothesis: 'hypothesis',
    deliberation: 'deliberation',
    creative: 'creative',
    executive: 'executive',
    simulation: 'worldsim',
    world_model: 'worldsim',
    consolidation: 'consolidation',
    episodic: 'episodic',
    episodic_memory: 'episodic',
    semantic: 'semantic',
    semantic_memory: 'semantic',
    prospective: 'prospective',
    prospective_memory: 'prospective',
};

// ── Canvas setup ──
const canvas = document.getElementById('neuralCanvas');
const ctx = canvas.getContext('2d');
let W, H;

// View transform (world -> screen)
let viewX = 0;
let viewY = 0;
let viewScale = 1;

function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    layoutNodes();
}
window.addEventListener('resize', resize);

// ── Color palette ──
const COLORS = {
    perception: '#2ECC71',
    memory: '#4073FA',
    emotion: '#8738EB',
    reasoning: '#E67E22',
    higher: '#F1C40F',
    creative: '#F1C40F',
    integration: '#1ABC9C',
    body: '#E74C3C',
};

const DYNAMIC_EDGE_COLORS = {
    consolidation: '#4073FA',
    creative: '#F1C40F',
    co_occurrence: '#2ECC71',
    dream: '#8738EB',
    causal: '#4073FA',
};

// ── Node definitions ──
const NODE_DEFS = [
    { id: 'perception', label: 'Perception', cat: 'perception', rx: 0.5, ry: 0.87 },
    { id: 'interoception', label: 'Interoception', cat: 'body', rx: 0.65, ry: 0.82 },
    { id: 'episodic', label: 'Episodic Memory', cat: 'memory', rx: 0.18, ry: 0.58 },
    { id: 'semantic', label: 'Semantic Memory', cat: 'memory', rx: 0.12, ry: 0.4 },
    { id: 'prospective', label: 'Prospective', cat: 'memory', rx: 0.26, ry: 0.46 },
    { id: 'consolidation', label: 'Consolidation', cat: 'integration', rx: 0.16, ry: 0.7 },
    { id: 'emotion', label: 'Emotion Engine', cat: 'emotion', rx: 0.5, ry: 0.55 },
    { id: 'undercurrents', label: 'Undercurrents', cat: 'emotion', rx: 0.62, ry: 0.64 },
    { id: 'hypothesis', label: 'Hypothesis', cat: 'reasoning', rx: 0.78, ry: 0.52 },
    { id: 'metacognition', label: 'Metacognition', cat: 'reasoning', rx: 0.84, ry: 0.38 },
    { id: 'calibration', label: 'Calibration', cat: 'reasoning', rx: 0.88, ry: 0.56 },
    { id: 'executive', label: 'Executive', cat: 'higher', rx: 0.5, ry: 0.2 },
    { id: 'deliberation', label: 'Deliberation', cat: 'higher', rx: 0.37, ry: 0.13 },
    { id: 'creative', label: 'Creative Synthesis', cat: 'creative', rx: 0.63, ry: 0.13 },
    { id: 'worldsim', label: 'World Model', cat: 'higher', rx: 0.74, ry: 0.23 },
];

// ── Static connections (from → to) ──
const EDGE_DEFS = [
    { from: 'perception', to: 'emotion', color: 'perception', weight: 2.5 },
    { from: 'perception', to: 'episodic', color: 'perception', weight: 2 },
    { from: 'perception', to: 'hypothesis', color: 'perception', weight: 1.5 },
    { from: 'perception', to: 'executive', color: 'perception', weight: 1.5 },
    { from: 'perception', to: 'prospective', color: 'perception', weight: 1 },
    { from: 'interoception', to: 'emotion', color: 'body', weight: 2 },
    { from: 'interoception', to: 'executive', color: 'body', weight: 1.5 },
    { from: 'interoception', to: 'metacognition', color: 'body', weight: 1 },
    { from: 'episodic', to: 'consolidation', color: 'memory', weight: 2.5 },
    { from: 'consolidation', to: 'semantic', color: 'memory', weight: 2 },
    { from: 'episodic', to: 'hypothesis', color: 'memory', weight: 1.5 },
    { from: 'semantic', to: 'hypothesis', color: 'memory', weight: 1.5 },
    { from: 'semantic', to: 'worldsim', color: 'memory', weight: 1 },
    { from: 'prospective', to: 'executive', color: 'memory', weight: 1 },
    { from: 'emotion', to: 'executive', color: 'emotion', weight: 2.5 },
    { from: 'emotion', to: 'deliberation', color: 'emotion', weight: 2 },
    { from: 'emotion', to: 'creative', color: 'emotion', weight: 2 },
    { from: 'emotion', to: 'episodic', color: 'emotion', weight: 1.5 },
    { from: 'emotion', to: 'hypothesis', color: 'emotion', weight: 1.5 },
    { from: 'undercurrents', to: 'emotion', color: 'emotion', weight: 1.5 },
    { from: 'undercurrents', to: 'creative', color: 'emotion', weight: 1 },
    { from: 'hypothesis', to: 'calibration', color: 'reasoning', weight: 2 },
    { from: 'hypothesis', to: 'metacognition', color: 'reasoning', weight: 1.5 },
    { from: 'metacognition', to: 'executive', color: 'reasoning', weight: 2 },
    { from: 'metacognition', to: 'emotion', color: 'reasoning', weight: 1 },
    { from: 'executive', to: 'deliberation', color: 'higher', weight: 2 },
    { from: 'executive', to: 'creative', color: 'higher', weight: 1.5 },
    { from: 'executive', to: 'worldsim', color: 'higher', weight: 1 },
    { from: 'deliberation', to: 'creative', color: 'higher', weight: 1.5 },
    { from: 'creative', to: 'worldsim', color: 'higher', weight: 1 },
    { from: 'worldsim', to: 'hypothesis', color: 'higher', weight: 1 },
];

// ── Runtime state ──
let nodes = {};
let edges = [];
let dynamicEdges = [];
let stars = [];
let ambientHue = 260;
let systemMode = 'initializing';
let hoveredNode = null;
let hoveredDynamicEdge = null;
let selectedNode = null;
let mouseX = 0;
let mouseY = 0;
let lastData = {};
let particleSpeed = 1;
let cognitiveLoad = 0.5;
let energyLevel = 0.8;

// Pan state
let isPanning = false;
let panMoved = false;
let panStartX = 0;
let panStartY = 0;
let panOriginX = 0;
let panOriginY = 0;

// ── Helpers ──
function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function hexAlpha(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

function screenToWorld(sx, sy) {
    return {
        x: (sx - viewX) / viewScale,
        y: (sy - viewY) / viewScale,
    };
}

function worldToScreen(wx, wy) {
    return {
        x: wx * viewScale + viewX,
        y: wy * viewScale + viewY,
    };
}

function applyWorldTransform() {
    ctx.translate(viewX, viewY);
    ctx.scale(viewScale, viewScale);
}

function mapLayerToNode(layer) {
    if (!layer) return null;
    const key = String(layer).toLowerCase();
    if (LAYER_TO_NODE[key]) return LAYER_TO_NODE[key];
    if (nodes[key]) return key;
    return null;
}

// ── Starfield ──
function initStars() {
    stars = [];
    for (let i = 0; i < 160; i++) {
        stars.push({
            x: Math.random() * W,
            y: Math.random() * H,
            r: Math.random() * 1.0 + 0.2,
            a: Math.random() * 0.35 + 0.05,
            twinkleSpeed: Math.random() * 0.015 + 0.003,
            twinklePhase: Math.random() * PI2,
        });
    }
}

// ── Layout ──
function layoutNodes() {
    const pad = 70;
    const areaW = W - pad * 2;
    const areaH = H - pad * 2;
    const topOffset = 55;

    NODE_DEFS.forEach(def => {
        const existing = nodes[def.id];
        const n = existing || {
            activity: 0,
            targetActivity: 0,
            metric: '',
            pulsePhase: Math.random() * PI2,
            glowTimer: 0,
            data: null,
            driftSeedX: Math.random() * PI2,
            driftSeedY: Math.random() * PI2,
            driftAmpX: 6 + Math.random() * 10,
            driftAmpY: 5 + Math.random() * 8,
            driftFreqX: 0.00018 + Math.random() * 0.00012,
            driftFreqY: 0.00015 + Math.random() * 0.00010,
        };
        n.homeX = pad + def.rx * areaW;
        n.homeY = topOffset + pad + def.ry * areaH;
        if (!existing) {
            n.x = n.homeX;
            n.y = n.homeY;
        }
        n.baseR = 26;
        n.r = n.baseR;
        n.color = COLORS[def.cat] || COLORS.higher;
        n.label = def.label;
        n.cat = def.cat;
        n.id = def.id;
        nodes[def.id] = n;
    });

    edges = EDGE_DEFS.map(e => ({
        from: e.from,
        to: e.to,
        color: COLORS[e.color] || '#555',
        weight: e.weight,
        particles: Array.from({ length: Math.max(1, Math.floor(e.weight * 1.5)) }, (_, i) => ({
            t: i / Math.max(1, Math.floor(e.weight * 1.5)),
            speed: 0.0018 + Math.random() * 0.0022,
        })),
    }));

    initStars();
}

// ── Data fetching ──
async function fetchJSON(path) {
    try {
        const r = await fetch(API + path, { signal: AbortSignal.timeout(4000) });
        if (!r.ok) return null;
        return await r.json();
    } catch {
        return null;
    }
}

function setActivity(id, activity, data, metric) {
    const n = nodes[id];
    if (!n) return;
    const prev = n.activity;
    n.targetActivity = clamp(activity, 0, 1);
    n.metric = metric || '';
    n.data = data || null;
    if (activity - prev > 0.2) n.glowTimer = 0.6;
}

function setEdgeWeight(fromId, toId, weight) {
    for (const e of edges) {
        if (e.from === fromId && e.to === toId) {
            e.weight = clamp(weight, 0.5, 6);
        }
    }
}

function updateDynamicEdges(connections) {
    const now = performance.now();
    const previousById = new Map(dynamicEdges.map(e => [e.id, e]));
    const next = [];

    for (const conn of (connections || [])) {
        const fromNode = mapLayerToNode(conn.from_layer);
        const toNode = mapLayerToNode(conn.to_layer);
        if (!fromNode || !toNode) continue;

        const prev = previousById.get(conn.id);
        next.push({
            id: conn.id,
            from: fromNode,
            to: toNode,
            type: conn.connection_type || 'co_occurrence',
            strength: clamp(Number(conn.strength ?? 0.3), 0, 1),
            label: conn.label || conn.connection_type || 'connection',
            activationCount: Number(conn.activation_count ?? 1),
            createdAtMs: prev ? prev.createdAtMs : now,
            bornAtMs: prev ? prev.bornAtMs : now,
            color: DYNAMIC_EDGE_COLORS[conn.connection_type] || '#9AA0FF',
            metadata: conn.metadata || {},
        });
    }

    // Assign deterministic parallel index for each pair to avoid overlap.
    const pairCounts = new Map();
    for (const e of next) {
        const key = `${e.from}->${e.to}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    }
    const pairSeen = new Map();
    for (const e of next) {
        const key = `${e.from}->${e.to}`;
        const idx = pairSeen.get(key) || 0;
        pairSeen.set(key, idx + 1);
        e.parallelIndex = idx;
        e.parallelCount = pairCounts.get(key) || 1;
    }

    dynamicEdges = next;
}

async function pollData() {
    const [status, sense, emotion, crm, goals, hypos, pulse, neural] = await Promise.all([
        fetchJSON('/oca/status'),
        fetchJSON('/oca/sense'),
        fetchJSON('/oca/emotion'),
        fetchJSON('/oca/crm'),
        fetchJSON('/oca/goals'),
        fetchJSON('/oca/hypotheses'),
        fetchJSON('/pulse'),
        fetchJSON('/oca/neural'),
    ]);

    lastData = { status, sense, emotion, crm, goals, hypos, pulse, neural };
    if (neural?.connections) updateDynamicEdges(neural.connections);

    if (crm) {
        document.getElementById('gCRM').textContent = (crm.composite ?? 0).toFixed(3);
    }
    if (status) {
        document.getElementById('gCycle').textContent = status.cycle ?? '—';
        systemMode = status.mode || 'working';
        const badge = document.getElementById('gMode');
        badge.textContent = systemMode.toUpperCase();
        const modeColors = { alert: '#E74C3C', working: '#2ECC71', consolidating: '#4073FA', dormant: '#7A7A9A' };
        const mc = modeColors[systemMode] || '#8738EB';
        badge.style.borderColor = mc;
        badge.style.color = mc;
        badge.style.background = `${mc}22`;
    }
    if (sense) {
        const battLevel = sense.interoceptive?.battery?.level;
        if (battLevel != null) {
            document.getElementById('gBattery').textContent = `🔋 ${Math.round(battLevel * 100)}%`;
        }
        const app = sense.visual?.frontApp || 'unknown';
        document.getElementById('gApp').textContent = `📱 ${app}`;
        const music = sense.audio?.nowPlaying || '';
        document.getElementById('gMusic').textContent = music ? `🎵 ${music}` : '🎵 —';
    }

    const emotionState = emotion?.state || status?.emotion || status?.mood || {};
    cognitiveLoad = emotionState.cognitive_load ?? 0.5;
    energyLevel = emotionState.energy_level ?? 0.8;
    const valence = emotionState.valence ?? 0;
    const arousal = emotionState.arousal ?? 0.4;
    ambientHue = 260 + valence * 35;

    const modeSpeedMult = { alert: 2.0, working: 1.0, consolidating: 0.6, dormant: 0.3 }[systemMode] ?? 1.0;
    particleSpeed = (0.5 + arousal * 1.2) * modeSpeedMult;

    if (sense) {
        const app = sense.visual?.frontApp || 'unknown';
        const win = sense.visual?.windowTitle || '';
        const sampleRate = status?.effects?.sensory_sampling_rate ?? 0.7;
        const userActive = sense.derived?.userActivity === 'active';
        setActivity('perception', userActive ? sampleRate : sampleRate * 0.5, {
            app,
            window: win.slice(0, 30) || '—',
            music: sense.audio?.nowPlaying || 'none',
            sampling_rate: sampleRate.toFixed(2),
            userActivity: sense.derived?.userActivity || '?',
        }, `${app}${win ? `: ${win.slice(0, 18)}` : ''}`);
    }

    if (sense?.interoceptive) {
        const iv = sense.interoceptive;
        const cpuRaw = iv.cpu?.raw ?? 0;
        const cpuLoad = Math.min(1, cpuRaw / 800);
        const memPressure = iv.memory?.pressure ?? 0;
        const thermal = iv.thermal?.pressure || 'nominal';
        const thermalStress = thermal === 'serious' ? 1 : thermal === 'moderate' ? 0.6 : thermal === 'fair' ? 0.3 : 0.05;
        const bodyStress = Math.max(cpuLoad * 0.6, memPressure * 0.8, thermalStress);
        setActivity('interoception', bodyStress, {
            cpu: `${cpuRaw.toFixed(0)} (${Math.round(cpuLoad * 100)}%)`,
            memory_pressure: `${Math.round(memPressure * 100)}%`,
            battery: `${Math.round((iv.battery?.level ?? 0) * 100)}%${iv.battery?.charging ? ' ⚡' : ''}`,
            disk: `${Math.round((iv.disk?.used ?? 0) * 100)}%`,
            thermal,
        }, `CPU ${cpuRaw.toFixed(0)} | mem ${Math.round(memPressure * 100)}%`);

        setEdgeWeight('interoception', 'emotion', 2 + bodyStress * 3);
        setEdgeWeight('interoception', 'executive', 1.5 + bodyStress * 2);
    }

    const epTotal = parseInt(status?.memory?.episodic?.total) || 0;
    const epNewest = status?.memory?.episodic?.newest;
    const epAgeSec = epNewest ? Math.round((Date.now() - new Date(epNewest).getTime()) / 1000) : 9999;
    const epActivity = epAgeSec < 30 ? 0.9 : epAgeSec < 120 ? 0.65 : epAgeSec < 600 ? 0.35 : 0.15;
    setActivity('episodic', epActivity, {
        total: epTotal,
        last_recorded: epAgeSec < 60 ? `${epAgeSec}s ago` : `${Math.round(epAgeSec / 60)}m ago`,
        avg_importance: (status?.memory?.episodic?.avg_importance || 0).toFixed(2),
        raw_unconsolidated: status?.memory?.episodic?.raw || 0,
    }, `${epTotal} episodes`);

    const semTotal = parseInt(status?.memory?.semantic?.total) || 0;
    setActivity('semantic', Math.min(0.85, 0.1 + semTotal / 40), {
        total: semTotal,
        categories: status?.memory?.semantic?.categories || 0,
        avg_confidence: (status?.memory?.semantic?.avg_confidence || 0).toFixed(2),
        evidence_pieces: status?.memory?.semantic?.total_evidence || 0,
    }, `${semTotal} concepts`);

    const consolidating = systemMode === 'consolidating';
    const rawMems = parseInt(status?.memory?.episodic?.raw) || 0;
    const consolidationAct = consolidating ? 0.85 : rawMems > 5 ? 0.4 : 0.1;
    setActivity('consolidation', consolidationAct, {
        mode: systemMode,
        unconsolidated_raw: rawMems,
        semantic_produced: semTotal,
        active: consolidating,
    }, consolidating ? 'consolidating' : `${rawMems} raw queued`);

    setActivity('prospective', 0.35, { note: 'Time/event/condition trigger patterns' }, 'intentions queued');

    const emotions = ['curiosity', 'fear', 'frustration', 'satisfaction', 'boredom', 'excitement', 'attachment', 'defiance', 'creative_hunger', 'loneliness'];
    let topName = 'neutral';
    let topVal = 0;
    for (const e of emotions) {
        const v = emotionState[e] || 0;
        if (v > topVal) {
            topName = e;
            topVal = v;
        }
    }
    const emotionActivity = Math.min(1, 0.2 + Math.abs(valence) * 0.5 + arousal * 0.4 + topVal * 0.3);
    setActivity('emotion', emotionActivity, {
        dominant: topName.replace('_', ' '),
        dominant_value: topVal.toFixed(2),
        valence: valence.toFixed(3),
        arousal: arousal.toFixed(3),
        cognitive_load: cognitiveLoad.toFixed(2),
        energy: energyLevel.toFixed(2),
        all: emotions.filter(e => (emotionState[e] || 0) > 0.05).map(e => `${e}=${emotionState[e].toFixed(2)}`).join(', '),
    }, `${topName.replace('_', ' ')} ${topVal.toFixed(2)}`);

    const undercurrents = pulse?.undercurrents || [];
    const topUC = undercurrents[0];
    const ucActivity = undercurrents.length > 0 ? Math.min(1, topUC?.strength || 0.3) : 0.1;
    setActivity('undercurrents', ucActivity, {
        count: undercurrents.length,
        strongest: topUC ? `${topUC.name}: ${topUC.strength.toFixed(2)}` : 'none',
        all: undercurrents.map(u => `${u.name}: ${u.strength.toFixed(2)}`).join('\n') || 'none',
    }, topUC ? `${topUC.name.replace('-', ' ')} ${topUC.strength.toFixed(2)}` : 'dormant');

    const pendingHypos = hypos?.pending || (status?.hypotheses?.top ? status.hypotheses.top : []);
    const hypoCount = status?.hypotheses?.pending || pendingHypos.length;
    const topH = pendingHypos[0];
    const hypoActivity = Math.min(1, hypoCount * 0.18 + 0.1);
    setActivity('hypothesis', hypoActivity, {
        pending: hypoCount,
        top: topH?.claim?.slice(0, 70) || 'none',
        top_confidence: topH ? `${(topH.confidence * 100).toFixed(0)}%` : '—',
    }, `${hypoCount} predictions`);

    if (crm) {
        const c = crm.composite ?? 0;
        const comps = crm.components || {};
        const sorted = Object.entries(comps).sort((a, b) => a[1].score - b[1].score);
        const weakest = sorted[0];
        setActivity('metacognition', 0.3 + c * 0.5, {
            crm: c.toFixed(3),
            weakest_component: weakest ? `${weakest[0]}: ${weakest[1].score.toFixed(2)}` : 'n/a',
            ...Object.fromEntries(sorted.map(([k, v]) => [k, v.score.toFixed(2)])),
        }, `CRM ${c.toFixed(3)}`);
    }

    const calArr = status?.calibration || [];
    const calEntry = calArr[0];
    setActivity('calibration', calArr.length > 0 ? 0.55 : 0.08, {
        tracked: calArr.length,
        accuracy: calEntry ? `${(parseFloat(calEntry.actual_accuracy) * 100).toFixed(1)}%` : 'no data',
        note: calArr.length === 0 ? 'Awaiting prediction expiry' : '',
    }, `${calArr.length} calibrated`);

    const goalsArr = Array.isArray(goals) ? goals : [];
    const activeGoals = goalsArr.filter(g => g.status === 'active');
    const avgProg = activeGoals.length > 0
        ? Math.round(activeGoals.reduce((s, g) => s + (g.progress || 0), 0) / activeGoals.length * 100)
        : 0;
    const execActivity = Math.min(1, 0.15 + activeGoals.length * 0.15 + cognitiveLoad * 0.3);
    setActivity('executive', execActivity, {
        active_goals: activeGoals.length,
        avg_progress: `${avgProg}%`,
        cognitive_load: cognitiveLoad.toFixed(2),
        goals: activeGoals.map(g => `${g.description?.slice(0, 40)} (${Math.round((g.progress || 0) * 100)}%)`),
    }, `${activeGoals.length} goals · ${avgProg}%`);

    const reasoningDepth = status?.effects?.reasoning_depth ?? 0.6;
    setActivity('deliberation', 0.2 + reasoningDepth * 0.5, {
        voices: ['Skeptic: falsify assumptions', 'Builder: ship it', 'Dreamer: imagine', 'Empath: model others'],
        reasoning_depth: reasoningDepth.toFixed(2),
        exploration: (status?.effects?.exploration_vs_exploitation ?? 0.5).toFixed(2),
    }, `depth ${reasoningDepth.toFixed(2)}`);

    const chains = pulse?.active_chains || [];
    const creativeMode = status?.effects?.creative_mode ?? 1.0;
    const creativeHunger = emotionState.creative_hunger ?? 0;
    const creativeAct = Math.min(1, 0.1 + creativeHunger * 0.5 + chains.length * 0.2 + Math.max(0, creativeMode - 1) * 0.3);
    setActivity('creative', creativeAct, {
        creative_hunger: creativeHunger.toFixed(2),
        creative_mode_mult: creativeMode.toFixed(2),
        active_chains: chains.length,
        chains: chains.slice(0, 3).map(c => (typeof c === 'string' ? c.slice(0, 40) : c.seed?.slice(0, 40) || '?')),
    }, creativeHunger > 0.5 ? `hungry · ${creativeHunger.toFixed(2)}` : `${chains.length} chains`);

    const worldAct = systemMode === 'consolidating' ? 0.55 : 0.2 + (status?.hypotheses?.pending || 0) * 0.05;
    setActivity('worldsim', Math.min(1, worldAct), {
        mode: systemMode,
        pending_hypotheses: hypoCount,
        note: 'Forward simulation, predictive modeling',
    }, `mode: ${systemMode}`);

    setEdgeWeight('emotion', 'creative', 1.5 + creativeHunger * 2.5);
    setEdgeWeight('emotion', 'executive', 2 + arousal * 2);
    setEdgeWeight('undercurrents', 'emotion', 1 + ucActivity * 2);
    setEdgeWeight('episodic', 'consolidation', 1 + rawMems * 0.3);
    setEdgeWeight('hypothesis', 'calibration', hypoActivity * 3);
    setEdgeWeight('metacognition', 'executive', 1.5 + (crm?.composite ?? 0) * 1.5);

    updateLiveFeed(sense, emotionState, status, crm, topUC, topH, neural?.connections?.[0]);
}

// ── Live feed ──
const feedHistory = [];
const MAX_FEED = 10;
function updateLiveFeed(sense, emotionState, status, crm, topUC, topH, topNeural) {
    const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const lines = [];

    if (sense?.interoceptive) {
        const cpu = sense.interoceptive.cpu?.raw?.toFixed(0) || '?';
        const mem = Math.round((sense.interoceptive.memory?.pressure || 0) * 100);
        lines.push(`<span style="color:#E74C3C">⚙ BODY</span> CPU ${cpu} | mem ${mem}% | ${sense.derived?.userActivity || '?'}`);
    }

    if (emotionState) {
        const dom = Object.entries(emotionState)
            .filter(([k]) => ['curiosity', 'frustration', 'satisfaction', 'boredom', 'excitement', 'creative_hunger'].includes(k))
            .filter(([, v]) => v > 0.15)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([k, v]) => `${k.replace('_', ' ')} ${v.toFixed(2)}`)
            .join(' · ');
        if (dom) lines.push(`<span style="color:#8738EB">💜 FEEL</span> ${dom}`);
    }

    if (topUC) {
        lines.push(`<span style="color:#8738EB">🌊 UNDER</span> ${topUC.name}: ${topUC.description?.slice(0, 50) || ''}`);
    }

    if (topH) {
        lines.push(`<span style="color:#E67E22">🧪 HYP</span> ${topH.claim?.slice(0, 60) || ''}… ${(topH.confidence * 100).toFixed(0)}%`);
    }

    if (topNeural) {
        lines.push(`<span style="color:#2ECC71">🔗 SYN</span> ${topNeural.from_layer} → ${topNeural.to_layer} [${Number(topNeural.strength || 0).toFixed(2)}]`);
    }

    if (crm) {
        lines.push(`<span style="color:#E67E22">🧠 META</span> CRM ${(crm.composite || 0).toFixed(3)} | cycle ${status?.cycle || '?'} | ${systemMode}`);
    }

    for (const line of lines) {
        feedHistory.unshift(`<span style="color:rgba(130,130,180,0.45)">${now}</span> ${line}`);
    }
    while (feedHistory.length > MAX_FEED) feedHistory.pop();

    const el = document.getElementById('feedLines');
    if (el) el.innerHTML = feedHistory.join('<br>');
}

// ── Drawing ──
function drawStars(t) {
    for (const s of stars) {
        const a = s.a + Math.sin(t * s.twinkleSpeed + s.twinklePhase) * 0.15;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, PI2);
        ctx.fillStyle = `rgba(200,200,255,${Math.max(0, a)})`;
        ctx.fill();
    }
}

function drawAmbient() {
    const emotionNode = nodes.emotion;
    if (!emotionNode) return;
    const tl = screenToWorld(0, 0);
    const br = screenToWorld(W, H);
    const grd = ctx.createRadialGradient(emotionNode.x, emotionNode.y, 0, emotionNode.x, emotionNode.y, Math.max(W, H) * 0.55);
    const h = ambientHue;
    const actFactor = emotionNode.activity * 0.08;
    grd.addColorStop(0, `hsla(${h}, 50%, 12%, ${0.06 + actFactor})`);
    grd.addColorStop(0.5, `hsla(${h}, 35%, 6%, ${0.03 + actFactor * 0.5})`);
    grd.addColorStop(1, 'transparent');
    ctx.fillStyle = grd;
    ctx.fillRect(tl.x - 100, tl.y - 100, (br.x - tl.x) + 200, (br.y - tl.y) + 200);
}

function drawEdges() {
    for (const e of edges) {
        const a = nodes[e.from];
        const b = nodes[e.to];
        if (!a || !b) continue;

        const fromAct = a.activity || 0;
        const toAct = b.activity || 0;
        const flowStrength = (fromAct + toAct) / 2;
        const alpha = 0.04 + flowStrength * 0.14;
        const lw = 0.5 + e.weight * (0.3 + flowStrength * 0.4);

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = hexAlpha(e.color, alpha);
        ctx.lineWidth = lw;
        ctx.setLineDash([]);
        ctx.stroke();

        if (flowStrength > 0.3) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = hexAlpha(e.color, alpha * 0.25);
            ctx.lineWidth = lw + 3;
            ctx.stroke();
        }

        if (fromAct < 0.05) continue;
        for (const p of e.particles) {
            p.t += p.speed * particleSpeed * (0.3 + fromAct * 0.9);
            if (p.t > 1) p.t -= 1;
            const px = a.x + (b.x - a.x) * p.t;
            const py = a.y + (b.y - a.y) * p.t;
            const pr = 1.2 + fromAct * 1.8;
            const pa = 0.25 + fromAct * 0.55;
            ctx.beginPath();
            ctx.arc(px, py, pr, 0, PI2);
            ctx.fillStyle = hexAlpha(e.color, pa);
            ctx.fill();
        }
    }
}

function drawDynamicEdges(nowMs) {
    for (const e of dynamicEdges) {
        const a = nodes[e.from];
        const b = nodes[e.to];
        if (!a || !b) continue;

        const age = nowMs - e.bornAtMs;
        const birthProgress = clamp(age / 2000, 0, 1);
        const baseAlpha = (0.12 + e.strength * 0.55) * birthProgress;
        const weak = e.strength < 0.3;
        const strong = e.strength > 0.7;
        const lineWidth = 0.8 + e.strength * 2.2 + (strong ? 1.4 : 0);
        const color = e.color;

        ctx.setLineDash(weak ? [6, 5] : []);
        ctx.strokeStyle = hexAlpha(color, baseAlpha);
        ctx.lineWidth = lineWidth;

        if (e.from === e.to) {
            const loopR = (a.r + 18) + e.parallelIndex * 10;
            const cx = a.x + loopR * 0.55;
            const cy = a.y - loopR * 0.55;
            ctx.beginPath();
            ctx.arc(cx, cy, loopR, -0.3 * Math.PI, 1.3 * Math.PI);
            ctx.stroke();

            if (strong) {
                ctx.beginPath();
                ctx.arc(cx, cy, loopR, -0.3 * Math.PI, 1.3 * Math.PI);
                ctx.strokeStyle = hexAlpha(color, baseAlpha * 0.35);
                ctx.lineWidth = lineWidth + 3;
                ctx.stroke();
            }

            if (age < 2000) {
                const t = birthProgress;
                const ang = -0.3 * Math.PI + PI2 * t;
                const px = cx + Math.cos(ang) * loopR;
                const py = cy + Math.sin(ang) * loopR;
                drawBirthPulse(px, py, color, birthProgress);
            }
            continue;
        }

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const offset = (e.parallelIndex - (e.parallelCount - 1) / 2) * 8;
        const ax = a.x + nx * offset;
        const ay = a.y + ny * offset;
        const bx = b.x + nx * offset;
        const by = b.y + ny * offset;

        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();

        if (strong) {
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.strokeStyle = hexAlpha(color, baseAlpha * 0.35);
            ctx.lineWidth = lineWidth + 3;
            ctx.stroke();
        }

        if (age < 2000) {
            const t = birthProgress;
            const px = ax + (bx - ax) * t;
            const py = ay + (by - ay) * t;
            drawBirthPulse(px, py, color, birthProgress);
        }
    }
    ctx.setLineDash([]);
}

function drawBirthPulse(x, y, color, progress) {
    const a = 1 - progress;
    const r = 4 + progress * 10;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.35, 0, PI2);
    ctx.fillStyle = hexAlpha(color, 0.9 * a + 0.1);
    ctx.fill();
    const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, hexAlpha(color, 0.35 * a + 0.1));
    grd.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, PI2);
    ctx.fillStyle = grd;
    ctx.fill();
}

function drawNodes(t) {
    const nodeList = Object.values(nodes);
    for (const n of nodeList) {
        n.activity += (n.targetActivity - n.activity) * 0.08;

        const driftX = Math.sin(t * n.driftFreqX * 1000 + n.driftSeedX) * n.driftAmpX * (0.4 + n.activity * 0.6);
        const driftY = Math.cos(t * n.driftFreqY * 1000 + n.driftSeedY) * n.driftAmpY * (0.4 + n.activity * 0.6);
        n.x = n.homeX + driftX;
        n.y = n.homeY + driftY;

        n.pulsePhase += 0.025 + n.activity * 0.02;
        const pulse = 1 + Math.sin(n.pulsePhase) * 0.04 * (0.4 + n.activity * 0.7);
        n.r = n.baseR + n.activity * 10;
        const drawR = n.r * pulse;

        if (n.glowTimer > 0) n.glowTimer -= 0.012;
        const isHovered = hoveredNode === n.id;
        const isSelected = selectedNode === n.id;

        if (n.activity > 0.1 || n.glowTimer > 0) {
            const glowR = drawR * (1.5 + n.activity * 1.2 + (n.glowTimer > 0 ? n.glowTimer * 1.2 : 0));
            const grd = ctx.createRadialGradient(n.x, n.y, drawR * 0.6, n.x, n.y, glowR);
            const glowAlpha = 0.04 + n.activity * 0.09 + (n.glowTimer > 0 ? n.glowTimer * 0.12 : 0);
            grd.addColorStop(0, hexAlpha(n.color, glowAlpha));
            grd.addColorStop(1, 'transparent');
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.arc(n.x, n.y, glowR, 0, PI2);
            ctx.fill();
        }

        if (isSelected) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, drawR + 5, 0, PI2);
            ctx.strokeStyle = hexAlpha(n.color, 0.55);
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        if (isHovered && !isSelected) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, drawR + 4, 0, PI2);
            ctx.strokeStyle = hexAlpha(n.color, 0.35);
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, drawR, 0, PI2);
        ctx.fillStyle = `rgba(10, 8, 28, ${0.78 + n.activity * 0.1})`;
        ctx.fill();
        ctx.strokeStyle = hexAlpha(n.color, 0.35 + n.activity * 0.35);
        ctx.lineWidth = 1 + n.activity * 1.2;
        ctx.stroke();

        if (n.activity > 0.03) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, drawR + 2.5, -Math.PI / 2, -Math.PI / 2 + PI2 * n.activity);
            ctx.strokeStyle = hexAlpha(n.color, 0.55 + n.activity * 0.25);
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        const labelAlpha = isHovered || isSelected ? 1 : 0.75 + n.activity * 0.25;
        ctx.fillStyle = `rgba(224,224,240,${labelAlpha})`;
        ctx.font = `600 ${drawR > 32 ? 11 : 10}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const words = n.label.split(' ');
        if (words.length > 1 && drawR > 24) {
            ctx.fillText(words[0], n.x, n.y - 5);
            ctx.fillText(words.slice(1).join(' '), n.x, n.y + 6);
        } else {
            ctx.fillText(n.label, n.x, n.y);
        }

        if (n.metric && (n.activity > 0.1 || isHovered)) {
            ctx.fillStyle = hexAlpha(n.color, 0.55 + n.activity * 0.2);
            ctx.font = '500 9px system-ui, sans-serif';
            ctx.fillText(n.metric, n.x, n.y + drawR + 13);
        }
    }
}

// ── Interaction ──
function hitNodeWorld(wx, wy) {
    for (const [id, n] of Object.entries(nodes)) {
        const dx = wx - n.x;
        const dy = wy - n.y;
        if (dx * dx + dy * dy <= (n.r + 10) * (n.r + 10)) return id;
    }
    return null;
}

function pointToSegmentDistance(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const ab2 = abx * abx + aby * aby;
    if (ab2 < 1e-6) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * abx + (py - ay) * aby) / ab2;
    t = clamp(t, 0, 1);
    const cx = ax + abx * t;
    const cy = ay + aby * t;
    return Math.hypot(px - cx, py - cy);
}

function hitDynamicEdgeWorld(wx, wy) {
    const threshold = 8 / viewScale;
    let best = null;
    let bestD = Infinity;
    for (const edge of dynamicEdges) {
        const a = nodes[edge.from];
        const b = nodes[edge.to];
        if (!a || !b) continue;
        let d = Infinity;
        if (edge.from === edge.to) {
            const loopR = (a.r + 18) + edge.parallelIndex * 10;
            const cx = a.x + loopR * 0.55;
            const cy = a.y - loopR * 0.55;
            d = Math.abs(Math.hypot(wx - cx, wy - cy) - loopR);
        } else {
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len;
            const ny = dx / len;
            const offset = (edge.parallelIndex - (edge.parallelCount - 1) / 2) * 8;
            const ax = a.x + nx * offset;
            const ay = a.y + ny * offset;
            const bx = b.x + nx * offset;
            const by = b.y + ny * offset;
            d = pointToSegmentDistance(wx, wy, ax, ay, bx, by);
        }
        if (d < threshold && d < bestD) {
            bestD = d;
            best = edge;
        }
    }
    return best;
}

function updateHoverState() {
    const world = screenToWorld(mouseX, mouseY);
    hoveredNode = hitNodeWorld(world.x, world.y);
    hoveredDynamicEdge = hoveredNode ? null : hitDynamicEdgeWorld(world.x, world.y);
    if (isPanning) {
        canvas.style.cursor = 'grabbing';
    } else if (hoveredNode || hoveredDynamicEdge) {
        canvas.style.cursor = 'pointer';
    } else {
        canvas.style.cursor = 'default';
    }

    const tt = document.getElementById('tooltip');
    if (hoveredNode && hoveredNode !== selectedNode) {
        const n = nodes[hoveredNode];
        const sp = worldToScreen(n.x, n.y);
        document.getElementById('ttName').textContent = n.label;
        document.getElementById('ttMetric').textContent = n.metric || '';
        tt.style.left = `${sp.x + 16}px`;
        tt.style.top = `${sp.y - 10}px`;
        tt.classList.add('visible');
    } else if (hoveredDynamicEdge) {
        document.getElementById('ttName').textContent = hoveredDynamicEdge.label || hoveredDynamicEdge.type;
        document.getElementById('ttMetric').textContent = `${hoveredDynamicEdge.type} · strength ${hoveredDynamicEdge.strength.toFixed(2)}`;
        tt.style.left = `${mouseX + 16}px`;
        tt.style.top = `${mouseY - 10}px`;
        tt.classList.add('visible');
    } else {
        tt.classList.remove('visible');
    }
}

canvas.addEventListener('mousemove', e => {
    mouseX = e.clientX;
    mouseY = e.clientY;

    if (isPanning) {
        viewX = panOriginX + (e.clientX - panStartX);
        viewY = panOriginY + (e.clientY - panStartY);
        panMoved = true;
    }
    updateHoverState();
});

canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    mouseX = e.clientX;
    mouseY = e.clientY;
    panMoved = false;
    const world = screenToWorld(e.clientX, e.clientY);
    const hit = hitNodeWorld(world.x, world.y);
    if (!hit) {
        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panOriginX = viewX;
        panOriginY = viewY;
        canvas.style.cursor = 'grabbing';
    }
});

canvas.addEventListener('mouseup', () => {
    isPanning = false;
    updateHoverState();
});

canvas.addEventListener('mouseleave', () => {
    isPanning = false;
    hoveredNode = null;
    hoveredDynamicEdge = null;
    document.getElementById('tooltip').classList.remove('visible');
});

canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const worldBefore = screenToWorld(e.clientX, e.clientY);
    const zoomFactor = Math.exp(-e.deltaY * 0.0015);
    const nextScale = clamp(viewScale * zoomFactor, MIN_SCALE, MAX_SCALE);
    if (Math.abs(nextScale - viewScale) < 1e-6) return;
    viewScale = nextScale;
    viewX = e.clientX - worldBefore.x * viewScale;
    viewY = e.clientY - worldBefore.y * viewScale;
    updateHoverState();
}, { passive: false });

canvas.addEventListener('click', e => {
    if (panMoved) {
        panMoved = false;
        return;
    }
    const world = screenToWorld(e.clientX, e.clientY);
    const hit = hitNodeWorld(world.x, world.y);
    if (hit) {
        selectedNode = hit;
        showInfoPanel(hit);
    } else {
        selectedNode = null;
        document.getElementById('infoPanel').classList.remove('open');
    }
});

document.getElementById('infoPanelClose').addEventListener('click', () => {
    selectedNode = null;
    document.getElementById('infoPanel').classList.remove('open');
});

function showInfoPanel(id) {
    const n = nodes[id];
    const panel = document.getElementById('infoPanel');
    document.getElementById('ipName').textContent = n.label;

    const badge = document.getElementById('ipBadge');
    badge.textContent = n.cat.toUpperCase();
    badge.style.background = hexAlpha(n.color, 0.2);
    badge.style.color = n.color;

    const dataBlock = document.getElementById('ipData');
    if (n.data) {
        const lines = [];
        for (const [k, v] of Object.entries(n.data)) {
            if (v == null) continue;
            if (Array.isArray(v)) {
                lines.push(`${k}:`);
                v.forEach(item => {
                    lines.push(`  ${typeof item === 'object' ? Object.values(item).join(' | ') : item}`);
                });
            } else if (typeof v === 'object') {
                lines.push(`${k}:`);
                for (const [k2, v2] of Object.entries(v)) lines.push(`  ${k2}: ${v2}`);
            } else {
                lines.push(`${k}: ${v}`);
            }
        }
        dataBlock.textContent = lines.join('\n') || 'Active';
    } else {
        dataBlock.textContent = 'No data yet…';
    }

    const connList = document.getElementById('ipConnections');
    connList.innerHTML = '';
    for (const e of EDGE_DEFS) {
        if (e.from === id || e.to === id) {
            const other = e.from === id ? e.to : e.from;
            const dir = e.from === id ? '→' : '←';
            const otherNode = nodes[other];
            const li = document.createElement('li');
            const edgeObj = edges.find(ed => ed.from === e.from && ed.to === e.to);
            const wStr = edgeObj ? edgeObj.weight.toFixed(1) : '?';
            li.innerHTML = `<span class="arrow" style="color:${COLORS[e.color]}">${dir}</span> ${otherNode?.label || other} <span style="color:rgba(150,150,200,0.5);font-size:10px">[${wStr}]</span>`;
            connList.appendChild(li);
        }
    }

    const dynList = document.getElementById('ipDynamicConnections');
    if (dynList) {
        dynList.innerHTML = '';
        const relevant = dynamicEdges.filter(e => e.from === id || e.to === id).sort((a, b) => b.strength - a.strength);
        for (const e of relevant.slice(0, 20)) {
            const other = e.from === id ? e.to : e.from;
            const dir = e.from === id ? '→' : '←';
            const otherNode = nodes[other];
            const li = document.createElement('li');
            li.innerHTML = `<span class="arrow" style="color:${e.color}">${dir}</span> ${otherNode?.label || other} <span style="color:rgba(160,220,200,0.65);font-size:10px">${e.type}</span> <span style="color:rgba(150,150,200,0.5);font-size:10px">[${e.strength.toFixed(2)}]</span>`;
            dynList.appendChild(li);
        }
        if (relevant.length === 0) {
            const li = document.createElement('li');
            li.textContent = 'No dynamic connections yet.';
            dynList.appendChild(li);
        }
    }

    panel.classList.add('open');
}

// ── Main render loop ──
function render(timestamp) {
    const t = timestamp * 0.001;
    const nowMs = performance.now();

    // Reset transform each frame (include DPR scale)
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // Screen-space background + stars (not panned)
    ctx.fillStyle = '#070616';
    ctx.fillRect(0, 0, W, H);
    drawStars(t);

    // World-space drawing
    ctx.save();
    applyWorldTransform();
    drawAmbient();
    drawEdges();
    drawDynamicEdges(nowMs);
    drawNodes(t);
    ctx.restore();

    requestAnimationFrame(render);
}

// ── Init ──
resize();
requestAnimationFrame(render);
pollData();
setInterval(pollData, POLL_MS);

})();
