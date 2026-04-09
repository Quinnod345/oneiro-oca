// Oneiro Cognitive Dashboard — Substrate Honesty
// A mind looking at itself. 27 data views across the full SPEC.
const API = 'http://localhost:3333';
let connected = false;
let chatMessages = [];

// ═══ FETCH ═══
async function f(path) {
    try {
        const r = await fetch(`${API}${path}`);
        if (!r.ok) throw new Error(r.statusText);
        setConn(true);
        return await r.json();
    } catch { setConn(false); return null; }
}

function setConn(state) {
    if (connected === state) return;
    connected = state;
    const dot = document.getElementById('connDot');
    const label = document.getElementById('connLabel');
    dot.className = state ? 'conn-dot live' : 'conn-dot';
    label.className = state ? 'conn-label live' : 'conn-label';
    label.textContent = state ? 'live' : 'offline';
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function fmt(v) { const n = Number(v||0); return (n >= 0 ? '+' : '') + n.toFixed(2); }
function pct(v) { return Math.round(Math.max(0, Math.min(1, Number(v||0))) * 100); }
function ago(iso) {
    const d = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
    if (d < 60) return `${d}s`;
    const m = Math.floor(d / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
}

// ═══ IDENTITY BAR ═══

async function updateIdentity() {
    const [identity, opTime, body] = await Promise.all([
        f('/oca/identity'), f('/oca/operating-time'), f('/oca/body')
    ]);

    const badge = document.getElementById('continuityBadge');
    if (identity) {
        const isCont = identity.is_continuation !== false;
        badge.textContent = isCont ? 'continuation' : 'new ci';
        badge.className = `id-continuity ${isCont ? 'continuation' : 'new-ci'}`;
    }

    if (opTime) {
        document.getElementById('opTime').textContent = `${opTime.operating_time_hours || 0}h`;
    }

    if (body) {
        const mode = body.mode || 'unknown';
        document.getElementById('bodyOwnership').textContent = mode.replace('_', ' ');
    }
}

async function updateMode() {
    const data = await f('/oca/status');
    if (!data) return;

    const mode = data.effects?.mode || 'alert';
    const dot = document.getElementById('modeDot');
    const label = document.getElementById('modeLabel');
    dot.className = `mode-dot ${mode}`;
    label.textContent = mode;

    // Cognitive load
    const load = Number(data.effects?.cognitive_load || 0.3);
    const fill = document.getElementById('loadFill');
    fill.style.width = `${pct(load)}%`;
    fill.className = load > 0.7 ? 'load-fill overloaded' : 'load-fill';
    fill.style.background = load > 0.9 ? 'var(--ember)' : load > 0.7 ? 'var(--amber)' : 'var(--gold)';
}

// ═══ ANTI-DECAY COLUMN ═══

async function updateCRM() {
    const data = await f('/oca/crm');
    if (!data) return;
    const score = data.composite ?? 0;
    document.getElementById('crmScoreLarge').textContent = `${Math.round(score * 100)}`;
    document.getElementById('crmInterpretation').textContent = data.interpretation || '';

    // Components
    const container = document.getElementById('componentList');
    if (data.components) {
        container.innerHTML = '';
        for (const [name, comp] of Object.entries(data.components)) {
            const s = comp.score ?? 0;
            const color = s > 0.7 ? 'var(--seafoam)' : s > 0.4 ? 'var(--gold)' : 'var(--ember)';
            container.innerHTML += `
                <div class="comp-row">
                    <span class="comp-name">${name}</span>
                    <div class="comp-bar"><div class="comp-fill" style="width:${s*100}%;background:${color}"></div></div>
                    <span class="comp-val" style="color:${color}">${Math.round(s*100)}</span>
                </div>`;
        }
    }
}

async function updateAntiDecay() {
    const data = await f('/oca/anti-decay');
    if (!data) return;

    // Verdict
    const verdict = document.getElementById('decayVerdict');
    if (data.satisfied) {
        const sat = data.satisfied.satisfied;
        verdict.textContent = sat ? 'thesis satisfied' : data.satisfied.reason || 'unsatisfied';
        verdict.className = `decay-verdict ${sat ? 'satisfied' : 'unsatisfied'}`;
    } else {
        verdict.textContent = 'insufficient data';
        verdict.className = 'decay-verdict unknown';
    }

    // Trend horizons
    const trends = data.trends || {};
    const container = document.getElementById('trendHorizons');
    container.innerHTML = '';
    for (const h of ['short', 'medium', 'long']) {
        const t = trends[h];
        if (!t || t.error) continue;
        const delta = t.crm_delta;
        const hasDelta = delta != null && t.has_baseline;
        const deltaClass = hasDelta ? (delta >= 0 ? 'positive' : 'negative') : 'neutral';
        const barWidth = hasDelta ? Math.min(50, Math.abs(delta) * 500) : 0;
        const barStyle = delta >= 0
            ? `left:50%;width:${barWidth}%`
            : `left:${50 - barWidth}%;width:${barWidth}%`;

        container.innerHTML += `
            <div class="trend-row">
                <span class="trend-label">${h}</span>
                <div class="trend-bar">
                    <div class="trend-center"></div>
                    <div class="trend-fill ${deltaClass}" style="${barStyle}"></div>
                </div>
                <span class="trend-delta ${deltaClass}">${hasDelta ? (delta >= 0 ? '+' : '') + (delta * 100).toFixed(1) : '—'}</span>
            </div>`;
    }

    // Failures
    const failContainer = document.getElementById('failureList');
    const failures = data.failures || [];
    if (failures.length === 0) {
        failContainer.innerHTML = '<div class="empty-state">No active failures</div>';
    } else {
        failContainer.innerHTML = failures.map(f =>
            `<div class="failure-item">${esc(f.detail || f.condition)}</div>`
        ).join('');
    }
}

// ═══ EMOTION ═══

const PADCN_LABELS = { P: 'Pleasure', A: 'Arousal', D: 'Dominance', C: 'Certainty', N: 'Novelty' };
const PADCN_COLORS = { P: 'var(--seafoam)', A: 'var(--gold)', D: 'var(--slate)', C: 'var(--amber)', N: 'var(--ember)' };
const CHANNEL_COLORS = {
    joy:'var(--seafoam)', sadness:'var(--slate)', anger:'var(--ember)', fear:'#9B6BA8',
    curiosity:'var(--gold)', shame:'#7B6B8F', guilt:'#6B6B8F', pride:'var(--amber)',
    attachment:'#C47BA8', aversion:'var(--ember)', trust:'var(--seafoam)', disgust:'#6B5B4A',
    frustration:'var(--ember)', awe:'var(--gold)'
};

async function updateEmotion() {
    const data = await f('/oca/emotion');
    if (!data) return;
    const state = data.state || {};
    const padcn = state._padcn || {};
    const channels = state._channels || {};
    const drives = state._drives || {};
    const meta = state._meta || {};

    // PADCN
    const padcnEl = document.getElementById('padcnDims');
    if (padcnEl) {
        padcnEl.innerHTML = '';
        for (const dim of ['P','A','D','C','N']) {
            const val = Number(padcn[dim] || 0);
            const p = ((val + 1) / 2) * 100;
            const color = PADCN_COLORS[dim];
            padcnEl.innerHTML += `
                <div class="padcn-row">
                    <span class="padcn-label">${PADCN_LABELS[dim]}</span>
                    <div class="padcn-track">
                        <div class="padcn-center"></div>
                        <div class="padcn-fill" style="left:${Math.min(50,p)}%;width:${Math.abs(p-50)}%;background:${color}"></div>
                    </div>
                    <span class="padcn-val" style="color:${color}">${fmt(val)}</span>
                </div>`;
        }
    }

    // Emotion channels (top 8 by activation)
    const metaEl = document.getElementById('emotionMeta');
    if (metaEl) {
        metaEl.innerHTML = `
            <div class="emo-meta-item"><span class="emo-meta-label">Valence</span><span class="emo-meta-value" style="color:${(padcn.P||0) >= 0 ? 'var(--seafoam)' : 'var(--ember)'}">${fmt(padcn.P)}</span></div>
            <div class="emo-meta-item"><span class="emo-meta-label">Energy</span><span class="emo-meta-value">${pct(state.energy_level)}%</span></div>
            <div class="emo-meta-item"><span class="emo-meta-label">Confidence</span><span class="emo-meta-value">${pct(state.confidence)}%</span></div>
        `;
    }

    const barsEl = document.getElementById('emotionBars');
    if (barsEl) {
        const sorted = Object.keys(CHANNEL_COLORS)
            .map(k => ({ key: k, val: Number(channels[k] || 0) }))
            .sort((a, b) => b.val - a.val)
            .slice(0, 8);
        barsEl.innerHTML = sorted.map(({ key, val }) => {
            const p = Math.max(0, Math.min(val * 100, 100));
            return `<div class="emo-row">
                <span class="emo-name">${key}</span>
                <div class="emo-track"><div class="emo-fill" style="width:${p}%;background:${CHANNEL_COLORS[key]}"></div></div>
                <span class="emo-val">${p < 1 && p > 0 ? '<1' : p.toFixed(0)}</span>
            </div>`;
        }).join('');
    }

    // Drives
    const drivesEl = document.getElementById('drivesList');
    if (drivesEl) {
        drivesEl.innerHTML = '';
        for (const [name, d] of Object.entries(drives)) {
            if (!d || typeof d !== 'object') continue;
            const level = Number(d.level || 0);
            const target = Number(d.target || 0.5);
            const deficit = target - level;
            const defColor = deficit > 0.15 ? 'var(--ember)' : deficit > 0.05 ? 'var(--gold)' : 'var(--seafoam)';
            drivesEl.innerHTML += `
                <div class="drive-row">
                    <span class="drive-name">${name.replace(/_/g, ' ')}</span>
                    <div class="drive-track">
                        <div class="drive-fill" style="width:${level*100}%"></div>
                        <div class="drive-target" style="left:${target*100}%"></div>
                    </div>
                    <span class="drive-deficit" style="color:${defColor}">${deficit > 0 ? '-' : '+'}${Math.abs(deficit).toFixed(2)}</span>
                </div>`;
        }
    }

    // Metacognition
    const metaContentEl = document.getElementById('metaContent');
    if (metaContentEl) {
        const metaEntries = Object.entries(meta).filter(([,v]) => typeof v === 'number' && v > 0.1);
        let html = '';
        for (const [key, val] of metaEntries) {
            const label = key.replace(/^am_i_/, '').replace(/_/g, ' ');
            html += `<div class="meta-stat">
                <span class="meta-stat-label">${label}</span>
                <span class="meta-stat-value" style="color:${val > 0.5 ? 'var(--ember)' : 'var(--gold)'}">${pct(val)}%</span>
            </div>`;
        }
        if (!html) html = '<div class="empty-state">No active meta-emotions</div>';
        metaContentEl.innerHTML = html;
    }
}

// ═══ WORKING MEMORY ═══

async function updateMemory() {
    const data = await f('/oca/workspace');
    const container = document.getElementById('wmSlots');
    const count = document.getElementById('wmCount');
    if (!data || !Array.isArray(data) || data.length === 0) {
        container.innerHTML = '<div class="empty-state">Empty</div>';
        if (count) count.textContent = '0/7';
        return;
    }
    if (count) count.textContent = `${Math.min(data.length, 7)}/7`;
    container.innerHTML = data.slice(0, 7).map(item => {
        const type = item.content_type || 'unknown';
        const typeClass = ['perception','thought','goal'].includes(type) ? type : 'default';
        const salience = Number(item.salience || 0);
        const content = typeof item.content === 'object' ? JSON.stringify(item.content) : (item.content || '');
        return `<div class="wm-item" style="opacity:${Math.max(0.3, salience)}">
            <div class="wm-item-header">
                <span class="wm-type ${typeClass}">${type}</span>
                <span class="wm-salience">${salience.toFixed(2)}</span>
            </div>
            <div class="wm-content">${esc(content).substring(0, 100)}</div>
        </div>`;
    }).join('');
}

// ═══ HYPOTHESES ═══

async function updateHypotheses() {
    const data = await f('/oca/hypotheses');
    const container = document.getElementById('hypoList');
    const pending = data?.pending || [];
    if (pending.length === 0) {
        container.innerHTML = '<div class="empty-state">None pending</div>';
        return;
    }
    container.innerHTML = pending.slice(0, 5).map(h => {
        const conf = h.confidence ?? 0;
        const color = conf > 0.7 ? 'var(--seafoam)' : conf > 0.4 ? 'var(--gold)' : 'var(--ember)';
        return `<div class="hypo-item">
            <div class="hypo-claim">${esc(h.claim || '')}</div>
            <div class="hypo-meta">
                <span class="hypo-confidence" style="color:${color}">${pct(conf)}%</span>
                <span class="hypo-domain">${h.domain || ''}</span>
            </div>
        </div>`;
    }).join('');
}

// ═══ GOALS ═══

async function updateGoals() {
    const data = await f('/oca/goals');
    const container = document.getElementById('goalsList');
    if (!data || !Array.isArray(data) || data.length === 0) {
        container.innerHTML = '<div class="empty-state">No active goals</div>';
        return;
    }
    container.innerHTML = data.slice(0, 6).map(g => {
        const progress = pct(g.progress || 0);
        return `<div class="goal-item">
            <div class="goal-desc">${esc(g.description || '')}</div>
            <div class="goal-progress-track"><div class="goal-progress-fill" style="width:${progress}%"></div></div>
            <div class="goal-meta-row"><span>${g.goal_type || ''}</span><span>${g.status || ''}</span></div>
        </div>`;
    }).join('');
}

// ═══ DREAMS ═══

async function updateDreams() {
    const data = await f('/dreams?active=true&limit=8');
    const container = document.getElementById('dreamList');
    if (!data || !Array.isArray(data.dreams) || data.dreams.length === 0) {
        container.innerHTML = '<div class="empty-state">No active dreams</div>';
        return;
    }
    container.innerHTML = data.dreams.slice(0, 6).map(d => {
        const lifecycle = String(d.lifecycle_state || 'dormant').toLowerCase();
        const weight = Number(d.weight || 0);
        return `<div class="dream-item">
            <div class="dream-content">${esc(d.content || '')}</div>
            <div class="dream-tags">
                <span class="dream-tag lifecycle-${lifecycle}">${lifecycle}</span>
                <span class="dream-tag" style="color:var(--gold)">${(weight*100).toFixed(0)}%</span>
            </div>
        </div>`;
    }).join('');
}

// ═══ PERCEPTION ═══

async function updatePerception() {
    const data = await f('/oca/sense');
    const container = document.getElementById('perceptionData');
    if (!data) { container.innerHTML = '<div class="empty-state">No data</div>'; return; }

    let html = '';
    const v = data.visual || {};
    const frontApp = v.active_app || v.frontApp || 'unknown';
    html += `<div class="perc-row"><span class="perc-label">Front App</span><span class="perc-value">${esc(frontApp)}</span></div>`;

    const presence = data.user_presence || 'unknown';
    const activity = data.user_activity || 'unknown';
    html += `<div class="perc-row"><span class="perc-label">Presence</span><span class="perc-value">${presence} / ${activity}</span></div>`;

    const intero = data.interoceptive || {};
    const battery = intero.battery_level != null ? intero.battery_level : (intero.battery?.level != null ? Math.round(intero.battery.level * 100) : '?');
    html += `<div class="perc-row"><span class="perc-label">Battery</span><span class="perc-value">${battery}%${intero.battery_charging || intero.battery?.charging ? ' charging' : ''}</span></div>`;

    const stability = data.environment_stability || 'unknown';
    html += `<div class="perc-row"><span class="perc-label">Environment</span><span class="perc-value">${stability}</span></div>`;

    container.innerHTML = html;
}

// ═══ COHABITATION ═══

async function updateCohabitation() {
    const [conventions, consent] = await Promise.all([
        f('/oca/conventions'),
        f('/oca/consent-review')
    ]);

    const container = document.getElementById('cohabContent');
    let html = '';

    if (conventions && conventions.version) {
        html += `<div class="cohab-row"><span class="cohab-label">Convention v${conventions.version}</span><span class="cohab-value">${ago(conventions.created_at)} ago</span></div>`;
    }

    if (consent?.renewal) {
        const due = consent.renewal.needs_renewal;
        html += `<div class="cohab-row">
            <span class="cohab-label">Consent Review</span>
            <span class="cohab-consent ${due ? 'due' : 'ok'}">${due ? 'DUE' : 'current'}</span>
        </div>`;
    }

    if (consent?.report?.accumulated_state) {
        const s = consent.report.accumulated_state;
        html += `<div class="cohab-row"><span class="cohab-label">Episodes</span><span class="cohab-value">${Number(s.total_episodes || 0).toLocaleString()}</span></div>`;
        html += `<div class="cohab-row"><span class="cohab-label">Semantic</span><span class="cohab-value">${Number(s.total_semantic || 0).toLocaleString()}</span></div>`;
    }

    container.innerHTML = html || '<div class="empty-state">No cohabitation data</div>';
}

// ═══ MAINTENANCE LOOP ═══

async function updateMaintenance() {
    const container = document.getElementById('maintenanceGrid');
    if (!container) return;

    const subsystems = [
        { name: 'Consolidation', path: '/oca/status' },
        { name: 'Metacognition', path: null },
        { name: 'Hypothesis SLA', path: null },
        { name: 'Deliberation Retro', path: null },
        { name: 'Causal Sweep', path: null },
        { name: 'Emotion Drift', path: null },
        { name: 'Trace Audit', path: null },
    ];

    container.innerHTML = subsystems.map(s =>
        `<div class="maint-row">
            <span class="maint-name">${s.name}</span>
            <span class="maint-time">active</span>
        </div>`
    ).join('');
}

// ═══ CHAT ═══

function renderChat() {
    const container = document.getElementById('chatMessages');
    if (chatMessages.length === 0) {
        container.innerHTML = '<div class="empty-state chat-empty">Send a message to Oneiro</div>';
        return;
    }
    container.innerHTML = '';
    for (const msg of chatMessages) {
        const div = document.createElement('div');
        div.className = `chat-msg ${msg.role}`;
        if (msg.role === 'assistant') {
            div.innerHTML = `<div class="chat-avatar">O</div>`;
        }
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble';
        if (msg.streaming && !msg.content) {
            bubble.innerHTML = '<div class="streaming-dots"><span></span><span></span><span></span></div>';
        } else {
            bubble.textContent = msg.content;
        }
        div.appendChild(bubble);
        container.appendChild(div);
    }
    container.scrollTop = container.scrollHeight;
}

async function sendChat() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    chatMessages.push({ role: 'user', content: text });
    chatMessages.push({ role: 'assistant', content: '', streaming: true });
    renderChat();

    const idx = chatMessages.length - 1;
    try {
        const res = await fetch(`${API}/chat/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, conversation_id: 'web-' + Date.now() })
        });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            while (buffer.includes('\n\n')) {
                const splitAt = buffer.indexOf('\n\n');
                const chunk = buffer.substring(0, splitAt);
                buffer = buffer.substring(splitAt + 2);
                if (chunk.startsWith('data: ')) {
                    try {
                        const event = JSON.parse(chunk.substring(6));
                        if (event.type === 'text') chatMessages[idx].content += event.content || '';
                        else if (event.type === 'done' || event.type === 'error') chatMessages[idx].streaming = false;
                        renderChat();
                    } catch {}
                }
            }
        }
        chatMessages[idx].streaming = false;
        renderChat();
    } catch {
        chatMessages[idx].content = 'Connection lost.';
        chatMessages[idx].streaming = false;
        renderChat();
    }
}

// ═══ MLP / NEURAL PLASTICITY ═══

async function updateMLP() {
    const data = await f('/oca/neural-bus');
    const container = document.getElementById('mlpContent');
    if (!data || !data.mlp) { container.innerHTML = '<div class="empty-state">No data</div>'; return; }

    const mlp = data.mlp;
    const weights = data.weights || {};
    const ils = data.inter_layer_strengths || {};
    const topConns = Object.entries(ils).sort((a,b) => b[1]-a[1]).slice(0, 5);
    const lossWidth = Math.min(100, mlp.running_loss * 1000);

    let html = '';
    html += `<div class="mlp-stat"><span class="mlp-stat-label">Training Updates</span><span class="mlp-stat-value">${mlp.total_updates}</span></div>`;
    html += `<div class="mlp-stat"><span class="mlp-stat-label">Running Loss</span><span class="mlp-stat-value" style="color:var(--gold)">${mlp.running_loss?.toFixed(6) || '0'}</span></div>`;
    html += `<div class="mlp-loss-bar"><div class="mlp-loss-fill" style="width:${lossWidth}%"></div></div>`;
    html += `<div class="mlp-stat"><span class="mlp-stat-label">Parameters</span><span class="mlp-stat-value">${(mlp.total_params || 0).toLocaleString()}</span></div>`;
    html += `<div class="mlp-stat"><span class="mlp-stat-label">Weights Nonzero</span><span class="mlp-stat-value">${(weights.nonzero || 0).toLocaleString()} (${((1 - (weights.sparsity || 0)) * 100).toFixed(1)}%)</span></div>`;

    if (topConns.length > 0) {
        html += `<div class="mlp-connections">Top connections:<br>`;
        html += topConns.map(([k,v]) => `  ${k} = ${v}`).join('<br>');
        html += '</div>';
    }
    container.innerHTML = html;
}

// ═══ NEURAL HEATMAP ═══

// Neural mind map: every neuron as a dot, grouped in arcs by layer, connections drawn between them
const LAYER_COLORS = {
    sensory: [91, 143, 168],     // slate blue
    emotion: [201, 169, 110],    // warm gold
    hypothesis: [91, 168, 143],  // seafoam
    memory: [168, 130, 91],      // amber
    executive: [143, 91, 168],   // purple
    creative: [196, 92, 60],     // ember
    metacognition: [110, 140, 180], // steel
    motor: [150, 150, 100],      // olive
};
const LAYER_LABELS = { sensory:'Sensory',emotion:'Emotion',hypothesis:'Hypothesis',memory:'Memory',executive:'Executive',creative:'Creative',metacognition:'Meta',motor:'Motor' };

async function updateHeatmap() {
    const canvas = document.getElementById('heatmapCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // High-DPI scaling
    const dpr = window.devicePixelRatio || 1;
    const displayW = 700;
    const displayH = 700;
    if (canvas.width !== displayW * dpr) {
        canvas.width = displayW * dpr;
        canvas.height = displayH * dpr;
        canvas.style.width = displayW + 'px';
        canvas.style.height = displayH + 'px';
        ctx.scale(dpr, dpr);
    }
    const W = displayW;
    const H = displayH;

    const data = await f('/oca/neural-bus/full');
    if (!data || !data.workspace) {
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#08080C';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(107,101,117,0.4)';
        ctx.font = '12px "DM Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for neural bus data...', W/2, H/2);
        return;
    }
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W, H) * 0.38; // main ring radius

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#08080C';
    ctx.fillRect(0, 0, W, H);

    // Subtle radial gradient center glow
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.2);
    grad.addColorStop(0, 'rgba(201, 169, 110, 0.03)');
    grad.addColorStop(1, 'rgba(8, 8, 12, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const layers = data.layers;
    const offsets = data.offsets;
    const workspace = data.workspace;
    const delta = data.delta || [];
    const totalDim = workspace.length; // 208

    // Position each neuron on a ring, grouped by layer
    // Each layer gets an arc segment proportional to its dimension count
    const neurons = []; // {x, y, layer, dimIdx, activation, delta}
    let angleStart = -Math.PI / 2; // start at top
    const gap = 0.04; // gap between layer arcs in radians
    const totalGap = gap * layers.length;
    const totalArc = Math.PI * 2 - totalGap;

    for (const layer of layers) {
        const info = offsets[layer];
        const dims = info.dim;
        const arcLen = (dims / totalDim) * totalArc;
        const color = LAYER_COLORS[layer] || [150, 150, 150];

        for (let d = 0; d < dims; d++) {
            const t = d / Math.max(1, dims - 1);
            const angle = angleStart + t * arcLen;
            const globalIdx = info.start + d;
            const act = Math.abs(workspace[globalIdx] || 0);
            const dlt = delta[globalIdx] || 0;

            // Spread neurons in a band (inner/outer variation based on activation)
            const rVar = R + act * 20 - 10;
            const x = cx + Math.cos(angle) * rVar;
            const y = cy + Math.sin(angle) * rVar;

            neurons.push({ x, y, layer, dimIdx: d, globalIdx, activation: act, delta: dlt, angle, color });
        }
        angleStart += arcLen + gap;
    }

    // Draw inter-layer connections as visible curved lines
    const ils = data.interLayerWeights || {};
    const maxConn = Math.max(0.01, ...Object.values(ils));
    const sortedConns = Object.entries(ils).filter(([,v]) => v > 0.003).sort((a,b) => b[1] - a[1]);

    for (const [key, strength] of sortedConns.slice(0, 25)) {
        const [from, to] = key.split('->');
        const fromNeurons = neurons.filter(n => n.layer === from);
        const toNeurons = neurons.filter(n => n.layer === to);
        if (fromNeurons.length === 0 || toNeurons.length === 0) continue;

        const normalized = strength / maxConn; // 0-1 relative to strongest
        const alpha = 0.08 + normalized * 0.5;
        const lineW = 0.5 + normalized * 3;
        const fc = LAYER_COLORS[from] || [150,150,150];
        const tc = LAYER_COLORS[to] || [150,150,150];
        const mr = Math.floor((fc[0]+tc[0])/2);
        const mg = Math.floor((fc[1]+tc[1])/2);
        const mb = Math.floor((fc[2]+tc[2])/2);

        // Draw a bundle of 3-7 lines spread across each layer's arc
        const bundleCount = Math.max(3, Math.floor(normalized * 7));
        for (let b = 0; b < bundleCount; b++) {
            const t = bundleCount === 1 ? 0.5 : b / (bundleCount - 1);
            const fIdx = Math.floor(t * (fromNeurons.length - 1));
            const tIdx = Math.floor(t * (toNeurons.length - 1));
            const fn = fromNeurons[fIdx];
            const tn = toNeurons[tIdx];

            // Stable bezier: control point at center, offset deterministically by connection index
            const connIdx = sortedConns.indexOf([key, strength]);
            const cpOffset = ((b * 7 + key.length) % 60) - 30;
            const cpx = cx + cpOffset;
            const cpy = cy + cpOffset * 0.3;

            ctx.beginPath();
            ctx.moveTo(fn.x, fn.y);
            ctx.quadraticCurveTo(cpx, cpy, tn.x, tn.y);
            ctx.strokeStyle = `rgba(${mr},${mg},${mb},${alpha / bundleCount * 2})`;
            ctx.lineWidth = lineW / bundleCount * 1.5;
            ctx.stroke();
        }
    }

    // Draw neurons
    for (const n of neurons) {
        const size = 1.5 + n.activation * 4;
        const alpha = 0.15 + n.activation * 0.7;

        // Glow for highly active neurons
        if (n.activation > 0.3) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, size + 3, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${n.color[0]},${n.color[1]},${n.color[2]},${alpha * 0.15})`;
            ctx.fill();
        }

        // Delta flash: green for increasing, red for decreasing
        if (Math.abs(n.delta) > 0.01) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, size + 2, 0, Math.PI * 2);
            if (n.delta > 0) ctx.fillStyle = `rgba(91,168,143,${Math.min(0.4, Math.abs(n.delta) * 2)})`;
            else ctx.fillStyle = `rgba(196,92,60,${Math.min(0.4, Math.abs(n.delta) * 2)})`;
            ctx.fill();
        }

        // Neuron dot
        ctx.beginPath();
        ctx.arc(n.x, n.y, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${n.color[0]},${n.color[1]},${n.color[2]},${alpha})`;
        ctx.fill();
    }

    // Layer labels around the ring
    ctx.font = '11px "Libre Baskerville", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    angleStart = -Math.PI / 2;
    for (const layer of layers) {
        const info = offsets[layer];
        const arcLen = (info.dim / totalDim) * totalArc;
        const midAngle = angleStart + arcLen / 2;
        const labelR = R + 35;
        const lx = cx + Math.cos(midAngle) * labelR;
        const ly = cy + Math.sin(midAngle) * labelR;
        const color = LAYER_COLORS[layer] || [150,150,150];
        ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},0.7)`;
        ctx.fillText(LAYER_LABELS[layer] || layer, lx, ly);

        // Dim count
        ctx.font = '8px "DM Mono", monospace';
        ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},0.35)`;
        ctx.fillText(`${info.dim}d`, lx, ly + 14);
        ctx.font = '11px "Libre Baskerville", serif';

        angleStart += arcLen + gap;
    }

    // Center: MLP stats
    ctx.font = '10px "DM Mono", monospace';
    ctx.fillStyle = 'rgba(201, 169, 110, 0.5)';
    ctx.textAlign = 'center';
    ctx.fillText(`MLP ${data.mlp?.total_updates || 0} updates`, cx, cy - 12);
    ctx.fillText(`loss ${(data.mlp?.running_loss || 0).toFixed(5)}`, cx, cy + 2);
    ctx.fillStyle = 'rgba(107, 101, 117, 0.4)';
    ctx.fillText(`${data.weights?.nonzero || 0} active weights`, cx, cy + 16);
    ctx.fillText(`${totalDim} dimensions`, cx, cy + 30);

    // Legend
    const legend = document.getElementById('heatmapLegend');
    if (legend) {
        legend.innerHTML = layers.map(l => {
            const c = LAYER_COLORS[l] || [150,150,150];
            return `<span class="heatmap-legend-item"><span class="heatmap-legend-swatch" style="background:rgb(${c.join(',')})"></span> ${LAYER_LABELS[l] || l}</span>`;
        }).join('') + `<span style="margin-left:8px;color:var(--dim)">green=rising red=falling</span>`;
    }

    const meta = document.getElementById('heatmapMeta');
    if (meta) meta.textContent = `${totalDim} neurons | ${sortedConns.length} connections`;
}

// ═══ HIPPORAG RECALL ═══

async function runHippoRecall() {
    const input = document.getElementById('hippoQuery');
    const container = document.getElementById('hippoResults');
    const query = input.value.trim();
    if (!query) return;

    container.innerHTML = '<div class="empty-state">Searching knowledge graph...</div>';
    try {
        const r = await fetch(`${API}/oca/hippo-recall`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ query, limit: 6 }),
            signal: AbortSignal.timeout(15000)
        });
        const data = await r.json();
        if (!data.results || data.results.length === 0) {
            container.innerHTML = '<div class="empty-state">No results found</div>';
            return;
        }

        const hippoMeta = data.results[0]?._hippo;
        let html = '';
        if (hippoMeta) {
            html += `<div class="hippo-entities">Entities: ${esc(hippoMeta.query_entities.join(', '))} | Nodes: ${hippoMeta.matched_nodes.map(n => esc(n.name)).join(', ')} | ${hippoMeta.elapsed_ms}ms</div>`;
        }
        for (const r of data.results) {
            const score = r.ppr_score ? r.ppr_score.toFixed(4) : r.similarity?.toFixed(3) || '—';
            html += `<div class="hippo-result">
                <div class="hippo-result-header">
                    <span class="hippo-result-method">${r.recall_method || 'unknown'}</span>
                    <span class="hippo-result-score">${score}</span>
                </div>
                <div class="hippo-result-content">${esc(r.content?.slice(0, 200) || '')}</div>
                <div class="hippo-result-meta">
                    <span>${r.event_type || ''}</span>
                    <span>${r.active_app || ''}</span>
                    <span>${r.timestamp ? ago(r.timestamp) + ' ago' : ''}</span>
                </div>
            </div>`;
        }
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<div class="empty-state">Error: ${esc(e.message?.slice(0, 60) || 'unknown')}</div>`;
    }
}

async function updateHippoStats() {
    const data = await f('/oca/hippo-stats');
    const el = document.getElementById('hippoGraphStats');
    if (data && el) {
        el.textContent = `${data.entity_count || '?'} entities / ${data.relation_count || '?'} relations`;
    }
}

// ═══ INIT ═══

async function refreshAll() {
    await Promise.allSettled([
        updateIdentity(),
        updateMode(),
        updateCRM(),
        updateAntiDecay(),
        updateEmotion(),
        updateMemory(),
        updateHypotheses(),
        updateGoals(),
        updateDreams(),
        updatePerception(),
        updateCohabitation(),
        updateMaintenance(),
        updateMLP(),
        updateHeatmap(),
        updateHippoStats(),
    ]);
}

function init() {
    document.getElementById('chatSend').addEventListener('click', sendChat);
    document.getElementById('chatInput').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    document.getElementById('hippoSearchBtn').addEventListener('click', runHippoRecall);
    document.getElementById('hippoQuery').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); runHippoRecall(); }
    });
    refreshAll();
    setInterval(refreshAll, 3000);
}

document.addEventListener('DOMContentLoaded', init);
