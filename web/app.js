// Oneiro Cognitive Dashboard — app.js
// Pure JS, no dependencies. Connects to OCA backend at localhost:3333.

const API = 'http://localhost:3333';
let connected = false;
let chatMessages = [];

// --- SVG gradient injection ---
function injectSVGDefs() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'svg-defs');
    svg.innerHTML = `<defs>
        <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#8738EB"/>
            <stop offset="100%" stop-color="#4073FA"/>
        </linearGradient>
    </defs>`;
    document.body.prepend(svg);
}

// --- Fetchers ---
async function fetchJSON(path) {
    try {
        const res = await fetch(`${API}${path}`);
        if (!res.ok) throw new Error(res.statusText);
        setConnected(true);
        return await res.json();
    } catch (e) {
        setConnected(false);
        return null;
    }
}

function setConnected(state) {
    if (connected === state) return;
    connected = state;
    const dot = document.getElementById('connDot');
    const txt = document.getElementById('connText');
    dot.className = state ? 'dot live' : 'dot';
    txt.className = state ? 'conn-text live' : 'conn-text';
    txt.textContent = state ? 'connected' : 'offline';
}

// --- CRM ---
async function updateCRM() {
    const data = await fetchJSON('/oca/crm');
    if (!data) return;

    const score = data.composite ?? 0;
    const circumference = 2 * Math.PI * 52; // ~326.73
    const ring = document.getElementById('crmRing');
    ring.style.strokeDashoffset = circumference * (1 - score);

    document.getElementById('crmScore').textContent = Math.round(score * 100) + '%';
    document.getElementById('crmInterpretation').textContent = data.interpretation || '';

    const container = document.getElementById('crmComponents');
    container.innerHTML = '';
    if (data.components) {
        for (const [name, comp] of Object.entries(data.components)) {
            const s = comp.score ?? 0;
            const color = s > 0.7 ? 'var(--green)' : s > 0.4 ? 'var(--yellow)' : 'var(--red)';
            container.innerHTML += `
                <div class="crm-comp">
                    <div class="crm-comp-header">
                        <span class="crm-comp-name">${name}</span>
                        <span class="crm-comp-score" style="color:${color}">${Math.round(s * 100)}%</span>
                    </div>
                    <div class="crm-bar-track"><div class="crm-bar-fill" style="width:${s * 100}%"></div></div>
                    <div class="crm-comp-detail">${comp.detail || ''}</div>
                </div>`;
        }
    }
}

// --- Emotion ---
const EMOTION_KEYS = ['curiosity','fear','frustration','satisfaction','boredom','excitement','attachment','defiance','creative_hunger','loneliness'];

async function updateEmotion() {
    const data = await fetchJSON('/oca/emotion');
    if (!data) return;

    const state = data.state || {};
    const valence = state.valence ?? 0;
    const arousal = state.arousal ?? 0;

    const meta = document.getElementById('emotionMeta');
    meta.innerHTML = `
        <div class="emotion-meta-item">
            <span class="emotion-meta-label">Valence</span>
            <span class="emotion-meta-value" style="color:${valence >= 0 ? 'var(--green)' : 'var(--red)'}">${valence >= 0 ? '+' : ''}${valence.toFixed(2)}</span>
        </div>
        <div class="emotion-meta-item">
            <span class="emotion-meta-label">Arousal</span>
            <span class="emotion-meta-value">${arousal.toFixed(2)}</span>
        </div>
        <div class="emotion-meta-item">
            <span class="emotion-meta-label">Energy</span>
            <span class="emotion-meta-value">${((state.energy_level ?? 0) * 100).toFixed(0)}%</span>
        </div>
        <div class="emotion-meta-item">
            <span class="emotion-meta-label">Confidence</span>
            <span class="emotion-meta-value">${((state.confidence ?? 0) * 100).toFixed(0)}%</span>
        </div>
    `;

    const bars = document.getElementById('emotionBars');
    bars.innerHTML = '';
    for (const key of EMOTION_KEYS) {
        const val = state[key] ?? 0;
        const pct = Math.min(val * 100, 100);
        bars.innerHTML += `
            <div class="emo-row emo-${key}">
                <span class="emo-name">${key.replace('_', ' ')}</span>
                <div class="emo-track"><div class="emo-fill" style="width:${pct}%"></div></div>
                <span class="emo-val">${(val * 100).toFixed(0)}%</span>
            </div>`;
    }
}

// --- Body Mode ---
const BODY_MODES = {
    quinn_primary: { icon: '🟢', label: 'Quinn Primary', desc: 'Quinn controls, Oneiro observes' },
    shared: { icon: '🟡', label: 'Shared', desc: 'Collaborative control' },
    oneiro_primary: { icon: '🔵', label: 'Oneiro Primary', desc: 'Oneiro controls with Quinn awareness' },
    autonomous: { icon: '🟣', label: 'Autonomous', desc: 'Full Oneiro control' },
};

async function updateBody() {
    const data = await fetchJSON('/oca/body');
    if (!data) return;
    const mode = BODY_MODES[data.mode] || { icon: '⚪', label: data.mode || 'Unknown', desc: '' };
    const el = document.getElementById('bodyMode');
    el.innerHTML = `
        <span class="body-icon">${mode.icon}</span>
        <span class="body-label">${mode.label}</span>
        <span style="font-size:10px;color:var(--dim);text-align:center">${mode.desc}</span>
    `;
}

// --- Working Memory ---
async function updateMemory() {
    const data = await fetchJSON('/oca/workspace');
    const container = document.getElementById('memorySlots');
    if (!data || !Array.isArray(data) || data.length === 0) {
        container.innerHTML = '<div class="mem-empty">Working memory empty</div>';
        return;
    }
    container.innerHTML = '';
    const slots = data.slice(0, 7);
    for (const item of slots) {
        const type = item.content_type || 'unknown';
        const typeClass = ['perception','thought','goal'].includes(type) ? type : 'default';
        const content = typeof item.content === 'object' ? JSON.stringify(item.content) : (item.content || '');
        container.innerHTML += `
            <div class="mem-slot">
                <div class="mem-slot-meta">
                    <span class="mem-slot-type ${typeClass}">${type}</span>
                    <span class="mem-slot-salience">${(item.salience ?? 0).toFixed(2)}</span>
                </div>
                <div class="mem-slot-content">${escapeHtml(content).substring(0, 120)}</div>
            </div>`;
    }
}

// --- Goals ---
async function updateGoals() {
    const data = await fetchJSON('/oca/goals');
    const container = document.getElementById('goalsList');
    if (!data || !Array.isArray(data) || data.length === 0) {
        container.innerHTML = '<div class="goal-empty">No active goals</div>';
        return;
    }
    container.innerHTML = '';
    for (const goal of data) {
        const p = goal.priority ?? 0;
        const pClass = p >= 0.8 ? 'high' : p >= 0.5 ? 'med' : 'low';
        const progress = (goal.progress ?? 0) * 100;
        container.innerHTML += `
            <div class="goal-item">
                <div class="goal-header">
                    <span class="goal-desc">${escapeHtml(goal.description || '')}</span>
                    <span class="goal-priority ${pClass}">${(p * 10).toFixed(0)}</span>
                </div>
                <div class="goal-progress-track"><div class="goal-progress-fill" style="width:${progress}%"></div></div>
                <div class="goal-meta">
                    <span>${goal.goal_type || ''}</span>
                    <span>${goal.status || ''}</span>
                </div>
            </div>`;
    }
}

// --- Hypotheses ---
async function updateHypotheses() {
    const data = await fetchJSON('/oca/hypotheses');
    const container = document.getElementById('hypoList');
    if (!data) { container.innerHTML = '<div class="hypo-empty">No hypotheses</div>'; return; }

    const pending = data.pending || [];
    if (pending.length === 0) {
        container.innerHTML = '<div class="hypo-empty">No pending hypotheses</div>';
        return;
    }
    container.innerHTML = '';
    for (const h of pending) {
        const conf = (h.confidence ?? 0);
        const confColor = conf > 0.7 ? 'var(--green)' : conf > 0.4 ? 'var(--yellow)' : 'var(--red)';
        const status = h.status || 'pending';
        container.innerHTML += `
            <div class="hypo-item">
                <div class="hypo-claim">${escapeHtml(h.claim || '')}</div>
                <div class="hypo-meta">
                    <span class="hypo-confidence" style="color:${confColor}">${(conf * 100).toFixed(0)}%</span>
                    <span class="hypo-domain">${h.domain || ''}</span>
                    <span class="hypo-status ${status}">${status}</span>
                </div>
                ${h.prediction ? `<div class="hypo-prediction">${escapeHtml(h.prediction)}</div>` : ''}
            </div>`;
    }
}

// --- Perception ---
async function updatePerception() {
    const data = await fetchJSON('/oca/sense');
    const container = document.getElementById('perceptionData');
    if (!data) { container.innerHTML = '<div class="perc-empty">No perception data</div>'; return; }

    let html = '';

    if (data.visual) {
        html += `
            <div class="perc-item">
                <span class="perc-label">Front App</span>
                <span class="perc-value">${escapeHtml(data.visual.frontApp || 'None')}</span>
            </div>`;
        if (data.visual.runningApps && data.visual.runningApps.length > 0) {
            html += `<div class="perc-item">
                <span class="perc-label">Running Apps (${data.visual.runningApps.length})</span>
                <div class="perc-apps">${data.visual.runningApps.map(a => `<span class="perc-app-tag">${escapeHtml(a)}</span>`).join('')}</div>
            </div>`;
        }
    }

    if (data.audio) {
        const np = data.audio.nowPlaying;
        html += `
            <div class="perc-item">
                <span class="perc-label">Audio</span>
                <span class="perc-value">${np ? escapeHtml(typeof np === 'object' ? (np.title || JSON.stringify(np)) : np) : 'Nothing playing'} · Vol ${data.audio.volume ?? '?'}%${data.audio.muted ? ' (muted)' : ''}</span>
            </div>`;
    }

    if (data.interoceptive?.battery) {
        const b = data.interoceptive.battery;
        html += `
            <div class="perc-item">
                <span class="perc-label">Battery</span>
                <span class="perc-value">${Math.round((b.level ?? 0) * 100)}%${b.charging ? ' ⚡ charging' : ''}</span>
            </div>`;
    }

    container.innerHTML = html || '<div class="perc-empty">No perception data</div>';
}

// --- Chat ---
function renderChat() {
    const container = document.getElementById('chatMessages');
    if (chatMessages.length === 0) {
        container.innerHTML = '<div class="chat-empty">Send a message to Oneiro…</div>';
        return;
    }
    container.innerHTML = '';
    for (const msg of chatMessages) {
        const div = document.createElement('div');
        div.className = `chat-msg ${msg.role}`;
        if (msg.role === 'assistant') {
            div.innerHTML = `<div class="chat-avatar">🌑</div>`;
        }
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble';
        if (msg.streaming && !msg.content) {
            bubble.innerHTML = '<div class="streaming-dots"><span></span><span></span><span></span></div>';
        } else {
            bubble.textContent = msg.content;
            if (msg.streaming) {
                bubble.innerHTML += '<span style="display:inline-block;width:2px;height:14px;background:var(--accent);animation:blink 0.5s ease-in-out infinite alternate;margin-left:2px;vertical-align:middle"></span>';
            }
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
                        if (event.type === 'text') {
                            chatMessages[idx].content += event.content || '';
                        } else if (event.type === 'done') {
                            chatMessages[idx].streaming = false;
                        } else if (event.type === 'error') {
                            chatMessages[idx].content = event.content || 'Error';
                            chatMessages[idx].streaming = false;
                        }
                        renderChat();
                    } catch (e) {}
                }
            }
        }
        chatMessages[idx].streaming = false;
        renderChat();
    } catch (e) {
        chatMessages[idx].content = 'Connection lost.';
        chatMessages[idx].streaming = false;
        renderChat();
    }
}

// --- Utils ---
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// --- Init ---
function init() {
    injectSVGDefs();

    // Chat events
    document.getElementById('chatSend').addEventListener('click', sendChat);
    document.getElementById('chatInput').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });

    // Initial fetch
    refreshAll();

    // Auto-refresh every 3s
    setInterval(refreshAll, 3000);
}

async function refreshAll() {
    await Promise.allSettled([
        updateCRM(),
        updateEmotion(),
        updateBody(),
        updateMemory(),
        updateGoals(),
        updateHypotheses(),
        updatePerception(),
    ]);
}

// Add blink animation
const style = document.createElement('style');
style.textContent = '@keyframes blink { from { opacity: 1; } to { opacity: 0; } }';
document.head.appendChild(style);

document.addEventListener('DOMContentLoaded', init);
