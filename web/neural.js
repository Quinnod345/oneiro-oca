// ═══════════════════════════════════════════════════════════════
//  ONEIRO NEURAL MAP — Real-time Cognitive Architecture Viz
// ═══════════════════════════════════════════════════════════════

(() => {
'use strict';

const API = 'http://localhost:3333';
const POLL_MS = 3000;
const PI2 = Math.PI * 2;
const DPR = window.devicePixelRatio || 1;

// ── Canvas setup ──
const canvas = document.getElementById('neuralCanvas');
const ctx = canvas.getContext('2d');
let W, H, cx, cy;

function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cx = W / 2;
    cy = H / 2;
    layoutNodes();
}
window.addEventListener('resize', resize);

// ── Color palette ──
const COLORS = {
    perception: '#2ECC71',
    memory:     '#4073FA',
    emotion:    '#8738EB',
    reasoning:  '#E67E22',
    higher:     '#F1C40F',
    creative:   '#F1C40F',
    integration:'#1ABC9C',
};

// ── Node definitions ──
// id, label, category, baseRadius, position hint (relative 0-1)
const NODE_DEFS = [
    // Sensory (bottom)
    { id: 'perception',     label: 'Perception',           cat: 'perception',   rx: 0.5,  ry: 0.88 },
    // Memory (left)
    { id: 'episodic',       label: 'Episodic Memory',      cat: 'memory',       rx: 0.18, ry: 0.55 },
    { id: 'semantic',       label: 'Semantic Memory',       cat: 'memory',       rx: 0.12, ry: 0.38 },
    { id: 'procedural',     label: 'Procedural Memory',     cat: 'memory',       rx: 0.22, ry: 0.28 },
    { id: 'prospective',    label: 'Prospective Memory',    cat: 'memory',       rx: 0.28, ry: 0.45 },
    // Emotion (center)
    { id: 'emotion',        label: 'Emotion Engine',        cat: 'emotion',      rx: 0.5,  ry: 0.55 },
    // Reasoning (right)
    { id: 'hypothesis',     label: 'Hypothesis Engine',     cat: 'reasoning',    rx: 0.78, ry: 0.52 },
    { id: 'metacognition',  label: 'Metacognition',         cat: 'reasoning',    rx: 0.82, ry: 0.38 },
    // Higher (top)
    { id: 'executive',      label: 'Executive Control',     cat: 'higher',       rx: 0.5,  ry: 0.18 },
    { id: 'deliberation',   label: 'Deliberation',          cat: 'higher',       rx: 0.38, ry: 0.12 },
    { id: 'creative',       label: 'Creative Synthesis',    cat: 'creative',     rx: 0.62, ry: 0.12 },
    { id: 'worldsim',       label: 'World Simulation',      cat: 'higher',       rx: 0.72, ry: 0.22 },
    // Integration
    { id: 'consolidation',  label: 'Memory Consolidation',  cat: 'integration',  rx: 0.15, ry: 0.68 },
    // Calibration (meta)
    { id: 'calibration',    label: 'Calibration',           cat: 'reasoning',    rx: 0.85, ry: 0.58 },
];

// ── Connections ──
const EDGE_DEFS = [
    // Perception feeds everything
    { from: 'perception', to: 'emotion',       color: 'perception', weight: 3 },
    { from: 'perception', to: 'episodic',      color: 'perception', weight: 2 },
    { from: 'perception', to: 'hypothesis',    color: 'perception', weight: 2 },
    { from: 'perception', to: 'executive',     color: 'perception', weight: 1.5 },
    { from: 'perception', to: 'worldsim',      color: 'perception', weight: 1 },
    { from: 'perception', to: 'prospective',   color: 'perception', weight: 1 },
    // Emotion affects everything
    { from: 'emotion', to: 'executive',        color: 'emotion', weight: 2.5 },
    { from: 'emotion', to: 'deliberation',     color: 'emotion', weight: 2 },
    { from: 'emotion', to: 'creative',         color: 'emotion', weight: 2 },
    { from: 'emotion', to: 'episodic',         color: 'emotion', weight: 1.5 },
    { from: 'emotion', to: 'hypothesis',       color: 'emotion', weight: 1.5 },
    { from: 'emotion', to: 'metacognition',    color: 'emotion', weight: 1 },
    { from: 'emotion', to: 'worldsim',         color: 'emotion', weight: 1 },
    // Memory consolidation path
    { from: 'episodic',    to: 'consolidation', color: 'memory', weight: 2.5 },
    { from: 'consolidation', to: 'semantic',    color: 'memory', weight: 2.5 },
    { from: 'semantic',    to: 'procedural',    color: 'memory', weight: 1.5 },
    // Memory → reasoning
    { from: 'episodic',  to: 'hypothesis',     color: 'memory', weight: 1.5 },
    { from: 'semantic',  to: 'hypothesis',     color: 'memory', weight: 1.5 },
    { from: 'semantic',  to: 'worldsim',       color: 'memory', weight: 1 },
    { from: 'procedural', to: 'executive',     color: 'memory', weight: 1 },
    // Reasoning
    { from: 'hypothesis', to: 'calibration',   color: 'reasoning', weight: 2 },
    { from: 'hypothesis', to: 'metacognition', color: 'reasoning', weight: 1.5 },
    { from: 'metacognition', to: 'executive',  color: 'reasoning', weight: 2 },
    // Higher
    { from: 'executive', to: 'deliberation',   color: 'higher', weight: 2 },
    { from: 'executive', to: 'creative',       color: 'higher', weight: 1.5 },
    { from: 'deliberation', to: 'creative',    color: 'higher', weight: 1.5 },
    { from: 'creative',  to: 'worldsim',       color: 'higher', weight: 1 },
    // Prospective
    { from: 'prospective', to: 'executive',    color: 'memory', weight: 1 },
    { from: 'prospective', to: 'episodic',     color: 'memory', weight: 1 },
];

// ── Runtime state ──
let nodes = {};   // id → { x, y, r, baseR, color, label, cat, activity, metric, pulsePhase, glowTimer, data }
let edges = [];   // { from, to, color, weight, particles[] }
let stars = [];   // background stars
let ambientHue = 260; // shifts with emotion valence
let systemMode = 'initializing';
let hoveredNode = null;
let selectedNode = null;
let mouseX = 0, mouseY = 0;
let lastData = {};
let animFrame = 0;
let particleSpeed = 1;

// ── Starfield ──
function initStars() {
    stars = [];
    for (let i = 0; i < 200; i++) {
        stars.push({
            x: Math.random() * W,
            y: Math.random() * H,
            r: Math.random() * 1.2 + 0.3,
            a: Math.random() * 0.5 + 0.1,
            twinkleSpeed: Math.random() * 0.02 + 0.005,
            twinklePhase: Math.random() * PI2,
        });
    }
}

// ── Layout ──
function layoutNodes() {
    const pad = 60;
    const areaW = W - pad * 2;
    const areaH = H - pad * 2;
    const topOffset = 50; // header clearance

    NODE_DEFS.forEach(def => {
        const n = nodes[def.id] || {
            activity: 0,
            metric: '',
            pulsePhase: Math.random() * PI2,
            glowTimer: 0,
            data: null,
        };
        n.x = pad + def.rx * areaW;
        n.y = topOffset + pad + def.ry * areaH;
        n.baseR = 32;
        n.r = n.baseR;
        n.color = COLORS[def.cat] || COLORS.higher;
        n.label = def.label;
        n.cat = def.cat;
        n.id = def.id;
        nodes[def.id] = n;
    });

    // Rebuild edges
    edges = EDGE_DEFS.map(e => ({
        from: e.from,
        to: e.to,
        color: COLORS[e.color] || '#555',
        weight: e.weight,
        particles: Array.from({ length: Math.floor(e.weight * 2) + 1 }, () => ({
            t: Math.random(),
            speed: (0.002 + Math.random() * 0.003),
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
    } catch { return null; }
}

async function pollData() {
    const [status, sense, emotion, crm, goals, hypos, workspace, pulse] = await Promise.all([
        fetchJSON('/oca/status'),
        fetchJSON('/oca/sense'),
        fetchJSON('/oca/emotion'),
        fetchJSON('/oca/crm'),
        fetchJSON('/oca/goals'),
        fetchJSON('/oca/hypotheses'),
        fetchJSON('/oca/workspace'),
        fetchJSON('/pulse'),
    ]);

    lastData = { status, sense, emotion, crm, goals, hypos, workspace, pulse };

    // ── Update global indicators with REAL data ──
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
        badge.style.background = mc + '22';
    }
    if (sense) {
        const battLevel = sense.interoceptive?.battery?.level;
        if (battLevel != null) {
            document.getElementById('gBattery').textContent = '🔋 ' + Math.round(battLevel * 100) + '%';
        }
        const app = sense.visual?.frontApp || 'unknown';
        document.getElementById('gApp').textContent = '📱 ' + app;
        const music = sense.audio?.nowPlaying || '';
        document.getElementById('gMusic').textContent = music ? ('🎵 ' + music) : '🎵 —';
    }

    // ── Update nodes with REAL API data ──
    
    // PERCEPTION — what the system actually sees right now
    if (sense) {
        const app = sense.visual?.frontApp || 'unknown';
        const win = sense.visual?.windowTitle || '';
        const music = sense.audio?.nowPlaying || '';
        const batt = sense.interoceptive?.battery?.level;
        updateNode('perception', {
            activity: 0.8,
            metric: app + (win ? ': ' + win.slice(0, 20) : ''),
            data: { app, window: win, music, battery: batt ? Math.round(batt*100)+'%' : '?', apps: sense.visual?.runningApps?.length || 0 },
        });
    }

    // EPISODIC MEMORY — real episode count and recency
    const epTotal = parseInt(status?.memory?.episodic?.total) || 0;
    const epNewest = status?.memory?.episodic?.newest;
    const epAgeSec = epNewest ? Math.round((Date.now() - new Date(epNewest).getTime()) / 1000) : 999;
    updateNode('episodic', {
        activity: epAgeSec < 30 ? 0.9 : epAgeSec < 120 ? 0.5 : 0.25,
        metric: epTotal + ' episodes',
        data: { total: epTotal, lastRecorded: epAgeSec + 's ago', avgImportance: (status?.memory?.episodic?.avg_importance || 0).toFixed(2) },
    });

    // SEMANTIC MEMORY — concepts learned through consolidation
    const semTotal = parseInt(status?.memory?.semantic?.total) || 0;
    const semCats = parseInt(status?.memory?.semantic?.categories) || 0;
    const semConf = (status?.memory?.semantic?.avg_confidence || 0).toFixed(2);
    updateNode('semantic', {
        activity: Math.min(1, semTotal / 30),
        metric: semTotal + ' concepts',
        data: { total: semTotal, categories: semCats, avgConfidence: semConf, evidence: status?.memory?.semantic?.total_evidence },
    });

    // PROCEDURAL MEMORY — learned behavioral patterns
    updateNode('procedural', {
        activity: 0.35,
        metric: 'skills learned',
        data: { note: 'Trigger-action patterns from repeated behavior' },
    });

    // PROSPECTIVE MEMORY — future intentions waiting to trigger
    updateNode('prospective', {
        activity: 0.4,
        metric: 'intentions queued',
        data: { note: 'Time/event/condition triggers' },
    });

    // EMOTION ENGINE — live emotional state, highlight dominant emotion
    if (emotion) {
        const st = emotion.state || emotion;
        const v = st.valence ?? 0;
        const a = st.arousal ?? 0;
        // Find top non-meta emotion
        const emotions = ['curiosity','fear','frustration','satisfaction','boredom','excitement','attachment','defiance','creative_hunger','loneliness'];
        let topName = 'neutral', topVal = 0;
        for (const e of emotions) {
            if ((st[e] || 0) > topVal) { topName = e; topVal = st[e]; }
        }
        updateNode('emotion', {
            activity: Math.min(1, Math.abs(v) * 2 + a),
            metric: topName.replace('_',' ') + ': ' + topVal.toFixed(2),
            data: { 
                dominant: topName, dominantValue: topVal.toFixed(2),
                valence: v.toFixed(3), arousal: a.toFixed(3),
                all: emotions.map(e => e + '=' + (st[e]||0).toFixed(2)).join(', '),
            },
        });
        ambientHue = 260 + v * 40;
    }

    // METACOGNITION — self-monitoring, CRM score, biases
    if (crm) {
        const c = crm.composite ?? 0;
        const comps = crm.components || {};
        const weakest = Object.entries(comps).sort((a,b) => a[1].score - b[1].score)[0];
        updateNode('metacognition', {
            activity: c,
            metric: 'CRM ' + c.toFixed(3),
            data: {
                composite: c.toFixed(3),
                weakest: weakest ? weakest[0] + ': ' + weakest[1].score.toFixed(2) : 'n/a',
                components: Object.fromEntries(Object.entries(comps).map(([k,v]) => [k, v.score.toFixed(2)])),
            },
        });
    }

    // HYPOTHESIS ENGINE — active predictions
    const pendingHypos = hypos?.pending || [];
    const topH = pendingHypos[0];
    updateNode('hypothesis', {
        activity: Math.min(1, pendingHypos.length * 0.25),
        metric: pendingHypos.length + ' predictions',
        data: {
            count: pendingHypos.length,
            topPrediction: topH?.claim?.slice(0, 60) || 'none',
            topConfidence: topH ? (topH.confidence * 100).toFixed(0) + '%' : 'n/a',
        },
    });

    // CALIBRATION — prediction accuracy tracking
    const calArr = status?.calibration || [];
    updateNode('calibration', {
        activity: calArr.length > 0 ? 0.6 : 0.1,
        metric: calArr.length + ' calibrated',
        data: { entries: calArr.length, note: calArr.length === 0 ? 'Waiting for predictions to expire' : '' },
    });

    // EXECUTIVE CONTROL — goals + working memory
    const goalsArr = Array.isArray(goals) ? goals : [];
    const avgProg = goalsArr.length > 0
        ? Math.round(goalsArr.reduce((s,g) => s + (g.progress||0), 0) / goalsArr.length * 100)
        : 0;
    updateNode('executive', {
        activity: Math.min(1, goalsArr.length * 0.2),
        metric: goalsArr.length + ' goals (' + avgProg + '%)',
        data: {
            goals: goalsArr.map(g => ({ name: g.description?.slice(0, 35), progress: Math.round((g.progress||0)*100) + '%', priority: g.priority })),
        },
    });

    // DELIBERATION — adversarial reasoning voices
    updateNode('deliberation', {
        activity: 0.4,
        metric: '4 voices',
        data: { voices: ['Skeptic (falsify)', 'Builder (ship)', 'Dreamer (create)', 'Empath (model others)'] },
    });

    // CREATIVE SYNTHESIS — dreams + thought chains
    const chains = pulse?.thoughtChains || [];
    updateNode('creative', {
        activity: chains.length > 0 ? 0.6 : 0.2,
        metric: chains.length > 0 ? chains.length + ' chains' : 'idle',
        data: { chains: chains.slice(0, 3).map(c => c.seed?.slice(0, 40) || 'thinking...') },
    });

    // WORLD SIMULATION — forward modeling
    updateNode('worldsim', {
        activity: systemMode === 'consolidating' ? 0.5 : 0.15,
        metric: systemMode,
        data: { mode: systemMode },
    });

    // CONSOLIDATION — episodic → semantic pipeline
    updateNode('consolidation', {
        activity: systemMode === 'consolidating' ? 0.9 : 0.25,
        metric: semTotal + ' abstractions',
        data: { semanticProduced: semTotal, mode: systemMode },
    });

    // Working memory
    if (workspace) {
        const items = Array.isArray(workspace) ? workspace : (workspace.items || []);
        const exec = nodes.executive;
        if (exec) exec.data = { ...exec.data, workspace: items.slice(0, 7).map(i => typeof i === 'object' ? (i.type || 'item') : String(i).slice(0, 30)), wmCount: items.length + '/7' };
    }

    // Adjust particle speed based on mode
    particleSpeed = systemMode === 'alert' ? 2.5 : systemMode === 'consolidating' ? 0.8 : 1;

    // Update live feed
    updateLiveFeed(sense, emotion, status, crm);
}

const feedHistory = [];
const MAX_FEED = 12;
function updateLiveFeed(sense, emotion, status, crm) {
    const now = new Date().toLocaleTimeString();
    const lines = [];
    
    // Perception event
    if (sense) {
        const app = sense.visual?.frontApp || '?';
        const music = sense.audio?.nowPlaying;
        const batt = sense.interoceptive?.battery?.level;
        lines.push(`<span style="color:#2ECC71">👁 SENSE</span> ${app}${music ? ' 🎵 ' + music : ''} | ⚡${batt ? Math.round(batt*100) : '?'}%`);
    }
    
    // Emotion event
    if (emotion) {
        const st = emotion.state || emotion;
        const emotions = ['curiosity','fear','frustration','satisfaction','boredom','excitement','creative_hunger'];
        const active = emotions.filter(e => (st[e]||0) > 0.1).map(e => e.replace('_',' ') + '=' + (st[e]).toFixed(2));
        if (active.length > 0) {
            lines.push(`<span style="color:#8738EB">💜 FEEL</span> ${active.join(', ')} | valence=${(st.valence||0).toFixed(2)}`);
        }
    }
    
    // CRM
    if (crm) {
        const c = crm.composite || 0;
        lines.push(`<span style="color:#E67E22">🧠 CRM</span> ${c.toFixed(3)} | cycle ${status?.cycle || '?'} | mode: ${systemMode}`);
    }
    
    // Add timestamped lines
    for (const line of lines) {
        feedHistory.unshift(`<span style="color:rgba(150,150,200,0.5)">${now}</span> ${line}`);
    }
    while (feedHistory.length > MAX_FEED) feedHistory.pop();
    
    const el = document.getElementById('feedLines');
    if (el) el.innerHTML = feedHistory.join('<br>');
}

function updateNode(id, updates) {
    const n = nodes[id];
    if (!n) return;
    const prevActivity = n.activity;
    Object.assign(n, updates);
    // Fire glow if activity spiked
    if (updates.activity - prevActivity > 0.15) {
        n.glowTimer = 1;
    }
    // Scale radius by activity
    n.r = n.baseR + n.activity * 14;
}

// ── Drawing ──

function drawStars(t) {
    for (const s of stars) {
        const a = s.a + Math.sin(t * s.twinkleSpeed + s.twinklePhase) * 0.2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, PI2);
        ctx.fillStyle = `rgba(200,200,255,${Math.max(0, a)})`;
        ctx.fill();
    }
}

function drawAmbient(t) {
    // Subtle radial gradient from center (emotion node) that shifts with valence
    const emotionNode = nodes.emotion;
    if (!emotionNode) return;
    const grd = ctx.createRadialGradient(emotionNode.x, emotionNode.y, 0, emotionNode.x, emotionNode.y, Math.max(W, H) * 0.6);
    const h = ambientHue;
    grd.addColorStop(0, `hsla(${h}, 60%, 15%, 0.12)`);
    grd.addColorStop(0.5, `hsla(${h}, 40%, 8%, 0.06)`);
    grd.addColorStop(1, 'transparent');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);
}

function drawEdges(t) {
    for (const e of edges) {
        const a = nodes[e.from];
        const b = nodes[e.to];
        if (!a || !b) continue;

        // Draw line
        const avgActivity = ((a.activity || 0) + (b.activity || 0)) / 2;
        const alpha = 0.08 + avgActivity * 0.18;
        const lw = e.weight * (0.5 + avgActivity * 0.8);

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = hexAlpha(e.color, alpha);
        ctx.lineWidth = lw;
        ctx.stroke();

        // Glow on line
        ctx.strokeStyle = hexAlpha(e.color, alpha * 0.3);
        ctx.lineWidth = lw + 4;
        ctx.stroke();

        // Particles
        for (const p of e.particles) {
            p.t += p.speed * particleSpeed;
            if (p.t > 1) p.t -= 1;

            const px = a.x + (b.x - a.x) * p.t;
            const py = a.y + (b.y - a.y) * p.t;
            const pr = 1.5 + avgActivity * 2;

            ctx.beginPath();
            ctx.arc(px, py, pr, 0, PI2);
            ctx.fillStyle = hexAlpha(e.color, 0.6 + avgActivity * 0.4);
            ctx.fill();

            // Particle glow
            const grd = ctx.createRadialGradient(px, py, 0, px, py, pr * 3);
            grd.addColorStop(0, hexAlpha(e.color, 0.3));
            grd.addColorStop(1, 'transparent');
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.arc(px, py, pr * 3, 0, PI2);
            ctx.fill();
        }
    }
}

function drawNodes(t) {
    const nodeList = Object.values(nodes);

    for (const n of nodeList) {
        n.pulsePhase += 0.03;
        const pulse = 1 + Math.sin(n.pulsePhase) * 0.06 * (0.3 + n.activity);
        const drawR = n.r * pulse;

        // Glow timer decay
        if (n.glowTimer > 0) n.glowTimer -= 0.015;

        const isHovered = hoveredNode === n.id;
        const isSelected = selectedNode === n.id;

        // Outer glow (always)
        const glowR = drawR * (2 + n.activity * 1.5 + (n.glowTimer > 0 ? n.glowTimer * 2 : 0));
        const grd = ctx.createRadialGradient(n.x, n.y, drawR * 0.5, n.x, n.y, glowR);
        const glowAlpha = 0.08 + n.activity * 0.12 + (n.glowTimer > 0 ? n.glowTimer * 0.2 : 0);
        grd.addColorStop(0, hexAlpha(n.color, glowAlpha));
        grd.addColorStop(1, 'transparent');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(n.x, n.y, glowR, 0, PI2);
        ctx.fill();

        // Selection ring
        if (isSelected) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, drawR + 6, 0, PI2);
            ctx.strokeStyle = hexAlpha(n.color, 0.6);
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Hover ring
        if (isHovered && !isSelected) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, drawR + 4, 0, PI2);
            ctx.strokeStyle = hexAlpha(n.color, 0.4);
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // Node body — dark filled circle with colored border
        ctx.beginPath();
        ctx.arc(n.x, n.y, drawR, 0, PI2);
        // Fill: dark with slight color tint
        const fillAlpha = 0.7 + n.activity * 0.15;
        ctx.fillStyle = `rgba(10, 8, 28, ${fillAlpha})`;
        ctx.fill();
        // Border
        ctx.strokeStyle = hexAlpha(n.color, 0.5 + n.activity * 0.3);
        ctx.lineWidth = 1.5 + n.activity * 1;
        ctx.stroke();

        // Activity ring (arc showing activity 0-1)
        if (n.activity > 0.01) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, drawR + 2, -Math.PI / 2, -Math.PI / 2 + PI2 * n.activity);
            ctx.strokeStyle = hexAlpha(n.color, 0.7);
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Glitch/fire effect when glowTimer active
        if (n.glowTimer > 0) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, drawR + 8 + Math.random() * 4, 0, PI2);
            ctx.strokeStyle = hexAlpha(n.color, n.glowTimer * 0.4);
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Label
        ctx.fillStyle = isHovered || isSelected ? '#fff' : 'rgba(224,224,240,0.85)';
        ctx.font = `600 ${drawR > 36 ? 11 : 10}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Wrap long labels
        const words = n.label.split(' ');
        if (words.length > 1 && drawR > 28) {
            ctx.fillText(words[0], n.x, n.y - 5);
            ctx.fillText(words.slice(1).join(' '), n.x, n.y + 7);
        } else {
            ctx.fillText(n.label, n.x, n.y);
        }

        // Metric below node
        if (n.metric) {
            ctx.fillStyle = hexAlpha(n.color, 0.7);
            ctx.font = '500 9px system-ui, sans-serif';
            ctx.fillText(n.metric, n.x, n.y + drawR + 14);
        }
    }
}

// ── Interaction ──
canvas.addEventListener('mousemove', e => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    hoveredNode = hitTest(mouseX, mouseY);
    canvas.style.cursor = hoveredNode ? 'pointer' : 'default';

    const tt = document.getElementById('tooltip');
    if (hoveredNode && hoveredNode !== selectedNode) {
        const n = nodes[hoveredNode];
        document.getElementById('ttName').textContent = n.label;
        document.getElementById('ttMetric').textContent = n.metric || '';
        tt.style.left = (mouseX + 16) + 'px';
        tt.style.top = (mouseY - 10) + 'px';
        tt.classList.add('visible');
    } else {
        tt.classList.remove('visible');
    }
});

canvas.addEventListener('click', e => {
    const hit = hitTest(e.clientX, e.clientY);
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

function hitTest(mx, my) {
    for (const [id, n] of Object.entries(nodes)) {
        const dx = mx - n.x;
        const dy = my - n.y;
        if (dx * dx + dy * dy <= (n.r + 8) * (n.r + 8)) return id;
    }
    return null;
}

function showInfoPanel(id) {
    const n = nodes[id];
    const panel = document.getElementById('infoPanel');
    document.getElementById('ipName').textContent = n.label;

    const badge = document.getElementById('ipBadge');
    badge.textContent = n.cat.toUpperCase();
    badge.style.background = hexAlpha(n.color, 0.2);
    badge.style.color = n.color;

    // Data — formatted for readability
    const dataBlock = document.getElementById('ipData');
    if (n.data) {
        let lines = [];
        for (const [k, v] of Object.entries(n.data)) {
            if (v === null || v === undefined) continue;
            if (Array.isArray(v)) {
                lines.push(k + ':');
                v.forEach((item, i) => {
                    if (typeof item === 'object') {
                        lines.push('  ' + Object.values(item).join(' | '));
                    } else {
                        lines.push('  ' + item);
                    }
                });
            } else if (typeof v === 'object') {
                lines.push(k + ':');
                for (const [k2, v2] of Object.entries(v)) {
                    lines.push('  ' + k2 + ': ' + v2);
                }
            } else {
                lines.push(k + ': ' + v);
            }
        }
        dataBlock.textContent = lines.join('\n') || 'Active';
    } else {
        dataBlock.textContent = 'No data yet…';
    }

    // Connections
    const connList = document.getElementById('ipConnections');
    connList.innerHTML = '';
    for (const e of EDGE_DEFS) {
        if (e.from === id || e.to === id) {
            const other = e.from === id ? e.to : e.from;
            const dir = e.from === id ? '→' : '←';
            const otherNode = nodes[other];
            const li = document.createElement('li');
            li.innerHTML = `<span class="arrow" style="color:${COLORS[e.color]}">${dir}</span> ${otherNode?.label || other}`;
            connList.appendChild(li);
        }
    }

    panel.classList.add('open');
}

// ── Utility ──
function hexAlpha(hex, alpha) {
    // Convert #RRGGBB to rgba
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

// ── Main render loop ──
let lastTime = 0;
function render(timestamp) {
    const t = timestamp * 0.001;
    animFrame++;

    // Clear
    ctx.fillStyle = '#070616';
    ctx.fillRect(0, 0, W, H);

    drawStars(t);
    drawAmbient(t);
    drawEdges(t);
    drawNodes(t);

    requestAnimationFrame(render);
}

// ── Init ──
resize();
requestAnimationFrame(render);

// Initial data fetch
pollData();
// Poll loop
setInterval(pollData, POLL_MS);

})();
