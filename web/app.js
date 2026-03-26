// Oneiro Cognitive Dashboard — app.js
// Pure JS, no dependencies. Connects to OCA backend at localhost:3333.

const API = 'http://localhost:3333';
let connected = false;
let chatMessages = [];
let visualSearchResults = [];
let visualSearchQuery = '';

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

// --- PADCN + Emotion Channels + Drives + Meta + Self + Policy + Expression ---
const CHANNEL_KEYS = ['joy','sadness','anger','fear','curiosity','shame','guilt','pride','attachment','aversion','trust','disgust','frustration','awe'];
const CHANNEL_COLORS = {
    joy:'var(--green)', sadness:'#6b7bbd', anger:'#ff5533', fear:'#b042e8',
    curiosity:'var(--blue)', shame:'#9b59b6', guilt:'#8e6fb0', pride:'var(--yellow)',
    attachment:'#e862a8', aversion:'var(--red)', trust:'#4ddb8f', disgust:'#7d6b3a',
    frustration:'var(--red)', awe:'var(--accent)'
};
const PADCN_LABELS = { P:'Pleasure', A:'Arousal', D:'Dominance', C:'Certainty', N:'Novelty' };
const PADCN_COLORS = { P:'var(--green)', A:'var(--yellow)', D:'var(--blue)', C:'var(--accent)', N:'#e862a8' };

async function updateEmotion() {
    const data = await fetchJSON('/oca/emotion');
    if (!data) return;

    const state = data.state || {};
    const padcn = state._padcn || {};
    const channels = state._channels || {};
    const drives = state._drives || {};
    const selfModel = state._self_model || {};
    const meta = state._meta || {};
    const policy = state._policy || {};
    const expression = state._expression || {};
    const personality = state._personality || {};

    const fmtSigned = (v) => { const n = Number(v||0); return (n >= 0 ? '+' : '') + n.toFixed(2); };
    const fmtPct = (v) => Math.round(Math.max(0, Math.min(1, Number(v||0))) * 100) + '%';

    // --- PADCN Panel ---
    const padcnEl = document.getElementById('padcnDims');
    if (padcnEl) {
        padcnEl.innerHTML = '';
        for (const dim of ['P','A','D','C','N']) {
            const val = Number(padcn[dim] || 0);
            const pct = ((val + 1) / 2) * 100; // map -1..1 to 0..100
            const color = PADCN_COLORS[dim];
            padcnEl.innerHTML += `
                <div class="padcn-row">
                    <span class="padcn-label">${PADCN_LABELS[dim]}</span>
                    <div class="padcn-track">
                        <div class="padcn-center"></div>
                        <div class="padcn-fill" style="left:${Math.min(50,pct)}%;width:${Math.abs(pct-50)}%;background:${color}"></div>
                    </div>
                    <span class="padcn-val" style="color:${color}">${fmtSigned(val)}</span>
                </div>`;
        }
    }

    // --- Channels Panel ---
    const metaEl = document.getElementById('emotionMeta');
    if (metaEl) {
        metaEl.innerHTML = `
            <div class="emotion-meta-item">
                <span class="emotion-meta-label">Valence</span>
                <span class="emotion-meta-value" style="color:${(padcn.P||0) >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtSigned(padcn.P)}</span>
            </div>
            <div class="emotion-meta-item">
                <span class="emotion-meta-label">Energy</span>
                <span class="emotion-meta-value">${fmtPct(state.energy_level)}</span>
            </div>
            <div class="emotion-meta-item">
                <span class="emotion-meta-label">Confidence</span>
                <span class="emotion-meta-value">${fmtPct(state.confidence)}</span>
            </div>
        `;
    }

    const barsEl = document.getElementById('emotionBars');
    if (barsEl) {
        // Sort by activation, show all 14
        const sorted = CHANNEL_KEYS.map(k => ({ key: k, val: Number(channels[k] || 0) }))
            .sort((a, b) => b.val - a.val);
        barsEl.innerHTML = '';
        for (const { key, val } of sorted) {
            const pct = Math.max(0, Math.min(val * 100, 100));
            const label = pct < 1 && pct > 0 ? '<1%' : `${pct.toFixed(pct >= 10 ? 0 : 1)}%`;
            const color = CHANNEL_COLORS[key] || 'var(--muted)';
            barsEl.innerHTML += `
                <div class="emo-row">
                    <span class="emo-name">${key}</span>
                    <div class="emo-track"><div class="emo-fill" style="width:${pct}%;background:${color}"></div></div>
                    <span class="emo-val">${label}</span>
                </div>`;
        }
    }

    // --- Drives Panel ---
    const drivesEl = document.getElementById('drivesList');
    if (drivesEl) {
        drivesEl.innerHTML = '';
        for (const [name, d] of Object.entries(drives)) {
            if (!d || typeof d !== 'object') continue;
            const level = Number(d.level || 0);
            const target = Number(d.target || 0.5);
            const deficit = target - level;
            const deficitColor = deficit > 0.15 ? 'var(--red)' : deficit > 0.05 ? 'var(--yellow)' : 'var(--green)';
            drivesEl.innerHTML += `
                <div class="drive-row">
                    <span class="drive-name">${name.replace('_', ' ')}</span>
                    <div class="drive-track">
                        <div class="drive-fill" style="width:${level * 100}%"></div>
                        <div class="drive-target" style="left:${target * 100}%"></div>
                    </div>
                    <span class="drive-deficit" style="color:${deficitColor}">${deficit > 0 ? '-' : '+'}${Math.abs(deficit).toFixed(2)}</span>
                </div>`;
        }
    }

    // --- Meta-Emotions Panel ---
    const metaListEl = document.getElementById('metaList');
    if (metaListEl) {
        const metaEntries = Object.entries(meta).filter(([,v]) => typeof v === 'number');
        if (metaEntries.length === 0) {
            metaListEl.innerHTML = '<div class="meta-empty">No meta-emotion alerts</div>';
        } else {
            metaListEl.innerHTML = '';
            for (const [key, val] of metaEntries) {
                const pct = Math.max(0, Math.min(val * 100, 100));
                const label = key.replace(/^am_i_/, '').replace(/_/g, ' ');
                const active = val > 0.3;
                metaListEl.innerHTML += `
                    <div class="meta-row ${active ? 'meta-active' : ''}">
                        <span class="meta-label">${label}</span>
                        <div class="meta-track"><div class="meta-fill" style="width:${pct}%"></div></div>
                        <span class="meta-val">${pct.toFixed(0)}%</span>
                    </div>`;
            }
        }
    }

    // --- Self-Model Panel ---
    const selfEl = document.getElementById('selfList');
    if (selfEl) {
        selfEl.innerHTML = '';
        for (const [key, val] of Object.entries(selfModel)) {
            if (typeof val !== 'number') continue;
            const pct = Math.max(0, Math.min(val * 100, 100));
            const label = key.replace(/_/g, ' ');
            selfEl.innerHTML += `
                <div class="self-row">
                    <span class="self-label">${label}</span>
                    <div class="self-track"><div class="self-fill" style="width:${pct}%"></div></div>
                    <span class="self-val">${pct.toFixed(0)}%</span>
                </div>`;
        }
    }

    // --- Policy Panel ---
    const policyEl = document.getElementById('policyList');
    if (policyEl) {
        policyEl.innerHTML = '';
        for (const [key, val] of Object.entries(policy)) {
            if (typeof val !== 'number') continue;
            const pct = ((val + 1) / 2) * 100; // -1..1 to 0..100
            const label = key.replace(/_/g, ' ');
            const color = val > 0.1 ? 'var(--green)' : val < -0.1 ? 'var(--red)' : 'var(--muted)';
            policyEl.innerHTML += `
                <div class="policy-row">
                    <span class="policy-label">${label}</span>
                    <div class="padcn-track">
                        <div class="padcn-center"></div>
                        <div class="padcn-fill" style="left:${Math.min(50,pct)}%;width:${Math.abs(pct-50)}%;background:${color}"></div>
                    </div>
                    <span class="policy-val" style="color:${color}">${fmtSigned(val)}</span>
                </div>`;
        }
    }

    // --- Expression Panel ---
    const exprEl = document.getElementById('expressionList');
    if (exprEl) {
        exprEl.innerHTML = '';
        for (const [key, val] of Object.entries(expression)) {
            if (typeof val !== 'number') continue;
            const pct = Math.max(0, Math.min(val * 100, 100));
            const label = key.replace(/_/g, ' ');
            exprEl.innerHTML += `
                <div class="expr-row">
                    <span class="expr-label">${label}</span>
                    <div class="expr-track"><div class="expr-fill" style="width:${pct}%"></div></div>
                    <span class="expr-val">${pct.toFixed(0)}%</span>
                </div>`;
        }
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

// --- Dreams ---
async function updateDreams() {
    const [data, minds] = await Promise.all([
        fetchJSON('/dreams?active=true&limit=12'),
        fetchJSON('/minds/status')
    ]);
    const container = document.getElementById('dreamList');
    const meta = document.getElementById('dreamMeta');
    const button = document.getElementById('dreamActBtn');
    if (!container || !meta) return;

    if (!data || !Array.isArray(data.dreams) || data.dreams.length === 0) {
        meta.textContent = 'No active dreams';
        container.innerHTML = '<div class="dream-empty">No active dreams</div>';
        if (button) button.disabled = true;
        return;
    }

    const dreams = data.dreams;
    const summary = data.summary || {};
    const builderPending = minds?.minds?.builder?.queue?.pending ?? summary.builder_queue_pending ?? 0;
    const actionable = summary.actionable ?? dreams.filter(d => d.actionable).length;
    const lifecycle = summary.lifecycle || {};
    const dormant = lifecycle.dormant || 0;
    const executing = lifecycle.executing || 0;
    const reflected = lifecycle.reflected || 0;
    meta.innerHTML = `
        <span>${actionable}/${dreams.length} actionable</span>
        <span>queue ${builderPending}</span>
        <span>dormant ${dormant}</span>
        <span>executing ${executing}</span>
        <span>reflected ${reflected}</span>
    `;

    container.innerHTML = '';
    for (const dream of dreams) {
        const weight = Number(dream.weight || 0);
        const statusClass = dream.actionable ? 'dream-actionable' : 'dream-conceptual';
        const statusText = dream.actionable ? 'actionable' : 'conceptual';
        const lifecycleState = String(dream.lifecycle_state || 'dormant').toLowerCase();
        const lifecycleClass = ['dormant', 'distilled', 'dispatched', 'executing', 'reflected'].includes(lifecycleState)
            ? lifecycleState
            : 'dormant';
        const lifecycleLabel = lifecycleClass.replace('_', ' ');
        const channel = String(dream.channel || 'builder');
        container.innerHTML += `
            <div class="dream-item">
                <div class="dream-content">${escapeHtml(dream.content || '')}</div>
                <div class="dream-row">
                    <span class="dream-type">${escapeHtml(dream.type || 'dream')}</span>
                    <span class="dream-weight">${(weight * 100).toFixed(0)}%</span>
                    <span class="dream-channel">${escapeHtml(channel)}</span>
                    <span class="dream-lifecycle ${lifecycleClass}">${escapeHtml(lifecycleLabel)}</span>
                    <span class="${statusClass}">${statusText}</span>
                </div>
            </div>`;
    }
    if (button) button.disabled = false;
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
    const [data, visualRecent] = await Promise.all([
        fetchJSON('/oca/sense'),
        fetchJSON('/oca/visual-memory/recent?limit=1')
    ]);
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

    const latestContainer = document.getElementById('visualMemoryLatest');
    const latest = Array.isArray(visualRecent?.recent) ? visualRecent.recent[0] : null;
    if (latestContainer) {
        if (!latest) {
            latestContainer.innerHTML = '<div class="perc-empty">No indexed visual memory yet</div>';
        } else {
            const when = latest.captured_at ? formatRelativeTime(latest.captured_at) : 'just now';
            latestContainer.innerHTML = `
                <div class="visual-latest-label">Latest Visual Memory</div>
                <div class="visual-latest-desc">${escapeHtml(latest.description || 'No description')}</div>
                <div class="visual-latest-meta">
                    <span>${escapeHtml(latest.front_app || 'unknown app')}</span>
                    <span>${when}</span>
                    <span>${latest.file_retained === false ? 'file pruned' : 'file retained'}</span>
                </div>
            `;
        }
    }

    renderVisualSearchResults();
}

function renderVisualSearchResults() {
    const container = document.getElementById('visualSearchResults');
    if (!container) return;
    if (!visualSearchQuery) {
        container.innerHTML = '';
        return;
    }
    if (!Array.isArray(visualSearchResults) || visualSearchResults.length === 0) {
        container.innerHTML = `<div class="perc-empty">No results for “${escapeHtml(visualSearchQuery)}”</div>`;
        return;
    }

    container.innerHTML = visualSearchResults.slice(0, 6).map((item) => {
        const score = Number(item.similarity);
        const scoreText = Number.isFinite(score) ? `${Math.round(score * 100)}%` : 'text';
        const when = item.captured_at ? formatRelativeTime(item.captured_at) : 'unknown time';
        return `
            <div class="visual-search-item">
                <div class="visual-search-head">
                    <span>${escapeHtml(item.front_app || 'unknown')}</span>
                    <span>${scoreText}</span>
                </div>
                <div class="visual-search-desc">${escapeHtml(item.description || '')}</div>
                <div class="visual-search-meta">
                    <span>${when}</span>
                    <span>${escapeHtml(item.activity_type || 'activity unknown')}</span>
                </div>
            </div>`;
    }).join('');
}

async function runVisualSearch() {
    const input = document.getElementById('visualSearchInput');
    const container = document.getElementById('visualSearchResults');
    if (!input || !container) return;

    const query = input.value.trim();
    visualSearchQuery = query;
    if (!query) {
        visualSearchResults = [];
        renderVisualSearchResults();
        return;
    }

    container.innerHTML = '<div class="perc-empty">Searching visual memory…</div>';
    const data = await fetchJSON(`/oca/visual-memory?query=${encodeURIComponent(query)}&limit=6`);
    visualSearchResults = Array.isArray(data?.results) ? data.results : [];
    renderVisualSearchResults();
}

// --- Nudges ---
let nudgeOverlayOpen = false;

function toggleNudgeOverlay() {
    nudgeOverlayOpen = !nudgeOverlayOpen;
    document.getElementById('nudgeOverlay').classList.toggle('open', nudgeOverlayOpen);
    document.getElementById('nudgeBackdrop').classList.toggle('open', nudgeOverlayOpen);
}

function nudgeCategoryIcon(cat) {
    return { thought: '🌑', alert: '🔴', question: '❓', update: '🟢' }[cat] || '🌑';
}

function renderNudgeItem(notif, container) {
    const catClass = ['thought','alert','question','update'].includes(notif.category) ? notif.category : 'default';
    const unreadClass = notif.read ? '' : 'unread';
    const timeAgo = formatRelativeTime(notif.created_at);
    const repliedHtml = notif.reply
        ? `<div class="nudge-replied">
            <span class="nudge-replied-label">You</span>
            <span class="nudge-replied-text">${escapeHtml(notif.reply)}</span>
           </div>`
        : '';
    const replyForm = `
        <div class="nudge-reply-form">
            <input class="nudge-reply-input" id="nudge-input-${notif.id}"
                   placeholder="Reply to Oneiro…"
                   onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendNudgeReply(${notif.id})}">
            <button class="nudge-reply-btn" onclick="sendNudgeReply(${notif.id})" title="Send">↑</button>
        </div>`;

    const div = document.createElement('div');
    div.className = `nudge-item ${unreadClass} category-${catClass}`;
    div.dataset.id = notif.id;
    div.innerHTML = `
        <div class="nudge-meta">
            <span class="nudge-cat-badge ${catClass}">${nudgeCategoryIcon(notif.category)} ${notif.category}</span>
            <span class="nudge-time">${timeAgo}</span>
        </div>
        <div class="nudge-message">${escapeHtml(notif.message)}</div>
        ${repliedHtml}
        ${replyForm}
    `;
    container.appendChild(div);
}

async function updateNudges() {
    const data = await fetchJSON('/notifications');
    if (!data || !Array.isArray(data)) return;

    // Badge count
    const unread = data.filter(n => !n.read).length;
    const badge = document.getElementById('notifBadge');
    if (badge) {
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.style.display = unread > 0 ? '' : 'none';
    }

    // Panel — last 5
    const panel = document.getElementById('nudgesList');
    if (panel) {
        panel.innerHTML = '';
        const items = data.slice(0, 5);
        if (items.length === 0) {
            panel.innerHTML = '<div class="nudge-empty">No nudges yet</div>';
        } else {
            items.forEach((n) => {
                renderNudgeItem(n, panel);
            });
        }
    }

    // Overlay — all
    const overlay = document.getElementById('nudgeOverlayFeed');
    if (overlay) {
        overlay.innerHTML = '';
        if (data.length === 0) {
            overlay.innerHTML = '<div class="nudge-empty">No nudges yet</div>';
        } else {
            data.forEach((n) => {
                renderNudgeItem(n, overlay);
            });
        }
    }
}

async function sendNudgeReply(id) {
    const input = document.getElementById(`nudge-input-${id}`);
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.disabled = true;

    try {
        await fetch(`${API}/notifications/${id}/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reply: text })
        });
    } catch {}

    input.disabled = false;
    await updateNudges();
}

async function sendNudge(text) {
    const nudgeText = String(text || '').trim();
    if (!nudgeText) return;
    try {
        await fetch(`${API}/nudge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: nudgeText, intensity: 0.7 })
        });
    } catch {}
}

async function sendNudgeFromInput(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.disabled = true;
    await sendNudge(text);
    input.disabled = false;
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

function formatRelativeTime(iso) {
    const ts = Date.parse(iso);
    if (Number.isNaN(ts)) return 'unknown';
    const deltaSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (deltaSec < 60) return `${deltaSec}s ago`;
    const min = Math.floor(deltaSec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 48) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    return `${d}d ago`;
}

// --- Init ---
function init() {
    injectSVGDefs();

    // Chat events
    document.getElementById('chatSend').addEventListener('click', sendChat);
    document.getElementById('chatInput').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    const dreamActBtn = document.getElementById('dreamActBtn');
    if (dreamActBtn) {
        dreamActBtn.addEventListener('click', async () => {
            dreamActBtn.disabled = true;
            dreamActBtn.textContent = 'Acting...';
            try {
                await fetch(`${API}/minds/dream-to-task`, { method: 'POST' });
            } catch {}
            await updateDreams();
            dreamActBtn.textContent = 'Act On Dreams Now';
            dreamActBtn.disabled = false;
        });
    }

    const visualSearchBtn = document.getElementById('visualSearchBtn');
    if (visualSearchBtn) visualSearchBtn.addEventListener('click', runVisualSearch);
    const visualSearchInput = document.getElementById('visualSearchInput');
    if (visualSearchInput) {
        visualSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                runVisualSearch();
            }
        });
    }

    ['panelNudgeInput', 'overlayNudgeInput'].forEach((id) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendNudgeFromInput(id);
            }
        });
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
        updateDreams(),
        updateHypotheses(),
        updatePerception(),
        updateNudges(),
        updateTrader(),
    ]);
}

// --- Trader Mind ---
async function updateTrader() {
    const el = document.getElementById('traderContent');
    if (!el) return;
    const data = await fetchJSON('/trader');
    if (!data) { el.innerHTML = '<span style="color:#666">offline</span>'; return; }

    const c = data.crypto || {};
    const r = data.robinhood || {};
    const port = c.portfolio;
    const rhPort = r.portfolio;

    let html = '';

    // Status badges
    html += '<div style="margin-bottom:12px">';
    html += `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;background:${c.running ? '#4ade80' : '#f87171'};color:#000;margin-right:8px">CRYPTO ${c.running ? '● LIVE' : '● OFF'}</span>`;
    html += `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;background:${r.running ? '#4ade80' : '#f87171'};color:#000">RH ${r.running ? '● LIVE' : '● OFF'}</span>`;
    html += '</div>';

    // Crypto portfolio
    if (port) {
        html += `<div style="font-size:20px;font-weight:700;color:#fff;margin-bottom:4px">$${port.totalValueUsd?.toFixed(2) || '?'}</div>`;
        html += `<div style="color:#666;font-size:11px;margin-bottom:10px">ETH: ${port.ethBalance?.toFixed(4) || '?'} ($${port.ethValueUsd?.toFixed(2) || '?'})</div>`;

        const positions = port.positions || {};
        for (const [sym, pos] of Object.entries(positions).sort((a,b) => (b[1].valueUsd||0) - (a[1].valueUsd||0))) {
            const pct = port.totalValueUsd > 0 ? (pos.valueUsd / port.totalValueUsd * 100).toFixed(1) : '0';
            const barW = Math.min(100, Math.max(2, parseFloat(pct)));
            html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #222">`;
            html += `<div><span style="color:#ddd;font-weight:600">${sym}</span> <span style="color:#555;font-size:10px">${pct}%</span></div>`;
            html += `<div style="text-align:right">$${pos.valueUsd?.toFixed(2) || '?'}</div>`;
            html += `</div>`;
            html += `<div style="height:3px;background:#222;border-radius:2px;margin-bottom:4px"><div style="height:100%;width:${barW}%;background:linear-gradient(90deg,#8738EB,#4073FA);border-radius:2px"></div></div>`;
        }
    }

    // Robinhood
    if (rhPort && rhPort.total_equity > 0) {
        html += `<div style="margin-top:16px;padding-top:12px;border-top:1px solid #333">`;
        html += `<div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Robinhood</div>`;
        html += `<div style="font-size:18px;font-weight:700;color:#fff">$${rhPort.total_equity?.toFixed(2)}</div>`;
        html += `<div style="color:#666;font-size:11px;margin-bottom:8px">BP: $${rhPort.buying_power?.toFixed(2) || '?'}</div>`;
        const rhPos = rhPort.positions || [];
        for (const pos of rhPos.sort((a,b) => (b.quantity*b.current_price) - (a.quantity*a.current_price)).slice(0,6)) {
            const val = pos.quantity * pos.current_price;
            const pnlColor = (pos.pnl_pct||0) >= 0 ? '#4ade80' : '#f87171';
            html += `<div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid #1a1a1a">`;
            html += `<span style="color:#ccc">${pos.ticker}</span>`;
            html += `<span>$${val.toFixed(2)} <span style="color:${pnlColor};font-size:10px">${(pos.pnl_pct||0) >= 0 ? '+' : ''}${pos.pnl_pct?.toFixed(1)}%</span></span>`;
            html += `</div>`;
        }
        html += `</div>`;
    }

    // Recent decisions
    const decisions = (c.decisions || []).slice(-5).reverse();
    if (decisions.length > 0) {
        html += `<div style="margin-top:16px;padding-top:12px;border-top:1px solid #333">`;
        html += `<div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Recent Decisions</div>`;
        for (const d of decisions) {
            const color = d.action === 'buy' ? '#4ade80' : d.action === 'sell' ? '#f87171' : '#fbbf24';
            html += `<div style="padding:3px 0;border-bottom:1px solid #1a1a1a">`;
            html += `<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:600;background:${color};color:#000">${(d.action||'?').toUpperCase()}</span> `;
            html += `<span style="color:#ddd">${d.symbol || '?'}</span> `;
            if (d.score != null) html += `<span style="color:#666;font-size:10px">score:${d.score}</span> `;
            if (d.amount != null) html += `<span style="color:#888;font-size:10px">$${d.amount?.toFixed(2)}</span>`;
            html += `</div>`;
        }
        html += `</div>`;
    }

    // Last few log lines
    const logLines = (c.recentLog || '').split('\\n').filter(Boolean).slice(-6);
    if (logLines.length > 0) {
        html += `<div style="margin-top:16px;padding-top:12px;border-top:1px solid #333">`;
        html += `<div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Live Log</div>`;
        html += `<div style="background:#0a0a0a;border-radius:4px;padding:6px;max-height:150px;overflow:auto">`;
        for (const line of logLines) {
            html += `<div style="font-size:10px;color:#666;line-height:1.5;white-space:pre-wrap">${escapeHTML(line)}</div>`;
        }
        html += `</div></div>`;
    }

    el.innerHTML = html;
}

function escapeHTML(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Add blink animation
const style = document.createElement('style');
style.textContent = '@keyframes blink { from { opacity: 1; } to { opacity: 0; } }';
document.head.appendChild(style);

document.addEventListener('DOMContentLoaded', init);
