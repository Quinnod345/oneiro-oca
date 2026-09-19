// OCA Engine app — hash-routed views over the daemon's JSON. No build step.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f2 = n => Number.isFinite(+n) ? (+n).toFixed(2) : '—';
const f3 = n => Number.isFinite(+n) ? (+n).toFixed(3) : '—';
const pct = n => Math.max(0, Math.min(100, (+n || 0) * 100));
const ago = t => { if (!t) return ''; const s = (Date.now() - new Date(t)) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${s / 60 | 0} min ago` : s < 86400 ? `${s / 3600 | 0} h ago` : `${s / 86400 | 0} d ago`; };
const until = t => { const s = (new Date(t) - Date.now()) / 1000; if (s < 0) return `${ago(t).replace(' ago', '')} overdue`; return s < 3600 ? `in ${s / 60 | 0} min` : s < 86400 ? `in ${s / 3600 | 0} h` : `in ${s / 86400 | 0} d`; };
const when = t => t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const clock = t => t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
const words = s => String(s || '').replaceAll('_', ' ');
async function j(url, opts) { const r = await fetch(url, opts); const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || `${url} → ${r.status}`); return b; }
const post = (url, body, method = 'POST') => j(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function toast(m, bad) { const t = $('#toast'); t.textContent = m; t.classList.toggle('bad', !!bad); t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2800); }
const chip = (text, kind = '') => `<span class="chip ${esc(kind)}">${esc(text)}</span>`;
const empty = (title, hint) => `<div class="empty"><b>${esc(title)}</b>${hint ? esc(hint) : ''}</div>`;
const err = e => `<div class="error">${esc(e.message || e)}</div>`;

/* ── shell: health + nav counts (every view) ── */
async function shell() {
  try {
    const [h, hunger, risk, sb] = await Promise.all([j('/oca/health'), j('/oca/hunger'), j('/oca/risk?limit=1'), j('/oca/self-build')]);
    const inf = h.inference || {};
    $('#health').innerHTML = `
      <div class="row"><span class="dot ${h.ok ? 'ok' : 'bad'}"></span>Daemon ${h.ok ? 'up' : 'degraded'} · ${(h.uptimeSeconds / 60 | 0)} min</div>
      <div class="row"><span class="dot ${h.database?.ok ? 'ok' : 'bad'}"></span>Database</div>
      <div class="row"><span class="dot ${h.embedder?.ok ? 'ok' : 'bad'}"></span>Embedder ${h.embedder?.dim ? `· ${h.embedder.dim}-d` : ''}</div>
      <div class="row"><span class="dot ${inf.reachable ? (inf.state === 'closed' ? 'ok' : 'warn') : 'bad'}"></span>${esc(inf.model || 'Inference')}${inf.state && inf.state !== 'closed' ? ` · circuit ${inf.state}` : ''}</div>
      <div class="row"><span class="dot ${h.queue?.paused ? 'warn' : 'ok'}"></span>Queue ${h.queue?.paused ? 'paused' : 'live'}</div>`;
    $('#n-wants').textContent = hunger.wants?.length || '';
    $('#n-held').textContent = risk.decisions?.prepare_artifact || '';
    $('#n-self').textContent = sb.phase?.active ? 'in phase' : (sb.selfWants?.length || '');
  } catch (e) { $('#health').innerHTML = `<div class="row"><span class="dot bad"></span>Disconnected</div>`; }
}

/* ── views ── */
const views = {};

views.overview = async () => {
  const [hunger, risk, sb, emo, crm, thinker] = await Promise.all([j('/oca/hunger'), j('/oca/risk?limit=40'), j('/oca/self-build'), j('/oca/emotion'), j('/oca/crm'), j('/oca/thinker/status')]);
  const s = emo.state, st = s._style || {};
  const held = (risk.recent || []).filter(r => r.decision === 'prepare_artifact' && !r.outcome);
  const branches = (sb.selfWants || []).length ? await Promise.all(sb.selfWants.map(w => j(`/ponder/${w.chain_id}`).catch(() => null))) : [];
  const awaiting = branches.filter(Boolean).flatMap(w => { const bs = (w.commitments || []).filter(c => c.kind === 'branch' && !c.merged); const latest = new Map(bs.map(c => [c.branch, c])); return [...latest.values()].map(c => ({ w, c })); });
  const waiting = (hunger.wants || []).filter(w => w.status === 'awaiting_evidence');
  const measured = Object.entries(crm.components || {}).filter(([, v]) => v.status === 'measured');
  const needs = [
    ...awaiting.map(({ w, c }) => `<div class="item"><span class="chip info">branch</span><div><div class="t">Merge <span class="mono">${esc(c.branch)}</span></div><div class="d">The engine built this for want #${w.chain_id}: ${esc(w.want.description)}</div></div><span class="when">${ago(c.at)}</span></div>`),
    ...held.slice(0, 6).map(r => `<div class="item"><span class="chip held">held</span><div><div class="t">${esc(r.proposal?.description)}</div><div class="d">${esc(r.appraisal?.reasons?.[0] || '')}</div></div><span class="when">${ago(r.createdAt)}</span></div>`),
    ...waiting.map(w => `<div class="item link" data-go="#/wants/${w.chain_id}"><span class="chip">waiting</span><div><div class="t">#${w.chain_id} ${esc(w.want.description)}</div><div class="d">${esc((w.result?.missingEvidence || [])[0] || 'Needs an observation to continue.')}</div></div><span class="when">${ago(w.updated_at)}</span></div>`),
  ];
  return `<div class="page">
    <div class="page-head"><div><h1>Overview</h1><p>What the engine wants, what needs you, and how it feels right now.</p></div></div>
    <div class="stack">
      <div class="chain">
        <a href="#/worth"><div class="eyebrow">Worth</div><div class="v">${(await j('/oca/worth')).entities.length}</div><div class="s">entities with worth</div></a>
        <a href="#/wants"><div class="eyebrow">Hunger</div><div class="v score">${f2(hunger.pressure)}</div><div class="s">${hunger.wants?.length || 0} active want${hunger.wants?.length === 1 ? '' : 's'}</div></a>
        <a href="#/risk"><div class="eyebrow">Risk</div><div class="v">${f2(risk.appetite?.appetite)}</div><div class="s">appetite · ${held.length} held</div></a>
        <a href="#/self-build"><div class="eyebrow">Self-build</div><div class="v">${sb.phase?.active ? 'in phase' : 'idle'}</div><div class="s">${sb.selfWants?.length || 0} self-want${sb.selfWants?.length === 1 ? '' : 's'}</div></a>
        <a href="#/affect"><div class="eyebrow">Affect</div><div class="v">${s.valence >= 0 ? '+' : ''}${f2(s.valence)}</div><div class="s">valence · fear ${f2(s.fear)}</div></a>
        <a href="#/meter"><div class="eyebrow">Meter</div><div class="v score">${measured.length}/${Object.keys(crm.components || {}).length}</div><div class="s">dimensions measured</div></a>
      </div>
      <div class="cols-2">
        <section class="card"><header><h2>Needs you</h2><span class="meta">${needs.length ? `${needs.length} item${needs.length > 1 ? 's' : ''}` : 'nothing right now'}</span></header>
          <div class="list">${needs.join('') || empty('All quiet', 'Held proposals, branches to merge, and wants waiting on evidence show up here.')}</div></section>
        <div class="stack">
          <section class="card"><header><h2>How it feels</h2><span class="meta">${s._grounding ? `grounded ${ago(s._grounding.at)}` : ''}</span></header>
            <div class="body">
              ${[['Curiosity', s.curiosity, ''], ['Frustration', s.frustration, 'amber'], ['Fear', s.fear, 'violet'], ['Hunger', s.hunger, '']].map(([k, v, c]) => `<div class="meter-row"><span class="l">${k}</span><div class="bar ${c}"><i style="width:${pct(v)}%"></i></div><span class="n">${f2(v)}</span></div>`).join('')}
              <p class="style-line" style="margin-top:var(--s-4)">Speaks <b>${esc(st.length)}</b>, <b>${esc(st.stance)}</b>, <b>${esc(st.warmth)}</b>; ${esc(st.hedging)}; <b>${esc(st.tempo)}</b>.</p>
            </div></section>
          <section class="card"><header><h2>Last thought</h2><span class="meta">${thinker.runs} runs · ${thinker.errors} errors</span></header>
            <div class="body"><p class="thought ${/silent tick|^—/.test(thinker.last_thought || '') ? 'silent' : ''}">${esc(thinker.last_thought || 'No thought yet.')}</p></div></section>
        </div>
      </div>
    </div></div>`;
};

views.wants = async (id) => {
  const hunger = await j('/oca/hunger');
  const wants = hunger.wants || [];
  const sel = wants.find(w => w.chain_id === Number(id)) || wants[0];
  const list = wants.map(w => `<a class="item link" href="#/wants/${w.chain_id}" aria-current="${sel && w.chain_id === sel.chain_id}" style="text-decoration:none;color:inherit">
    <span class="num" style="font-weight:600;color:var(--teal-600);min-width:36px">${f2(w.hunger.pressure)}</span>
    <div><div class="t">#${w.chain_id} · ${esc(w.want.description).slice(0, 90)}${w.want.description.length > 90 ? '…' : ''}</div><div class="d">${esc(words(w.status))} · ${esc(words(w.hunger.strategy))}${w.origin?.kind === 'self' ? ' · about itself' : ''}</div></div></a>`).join('');
  let detail = empty('No want selected', 'Pick one on the left, or create one below.');
  if (sel) {
    const [chain, t] = await Promise.all([j(`/ponder/${sel.chain_id}`), j(`/oca/trace/${sel.chain_id}`)]);
    const w = chain.want, h = sel.hunger, ls = chain.lastStrategy || {};
    const commits = (chain.commitments || []).slice().reverse().map(c => {
      const label = c.kind === 'hypothesis' ? `Prediction #${c.id}` : c.kind === 'simulation' ? `Simulation #${c.id}` : c.kind === 'branch' ? `Branch <span class="mono">${esc(c.branch)}</span>` : c.kind === 'artifact' ? `Artifact ${esc(c.title || '')}` : esc(c.kind);
      const state = c.settled ? chip(`settled — ${c.confirmed === true ? 'held' : c.confirmed === false ? 'failed' : c.settled}`, c.confirmed === true ? 'ok' : c.confirmed === false ? 'bad' : '') : c.kind === 'branch' ? chip(c.merged ? 'merged' : 'awaiting your merge', c.merged ? 'ok' : 'warn') : c.deadline ? chip(until(c.deadline), 'info') : chip('open');
      return `<div class="item"><span>${state}</span><div><div class="t">${label}</div><div class="d">${esc(c.metric ? `${c.metric} · by ${when(c.deadline)}` : c.action || c.sha ? `${esc((c.sha || '').slice(0, 7))} ${esc(c.action || '')}` : '')}</div></div><span class="when">${ago(c.at)}</span></div>`;
    }).join('');
    const evs = (t.events || []).filter(e => !(e.kind === 'attempt_appraised' && String(e.detail.id || '').startsWith('thinker:'))).slice(-40).reverse();
    const trace = evs.map(e => {
      const d = e.detail || {}, a = e.affect; let body = '';
      if (e.kind === 'attempt_appraised') body = `${chip(words(d.decision), d.decision)} ${esc(d.description)}${d.reasons?.[0] ? `<span class="q">${esc(d.reasons[0])}</span>` : ''}`;
      else if (e.kind === 'attempt_observed') body = `${chip(d.result, d.result)} ${esc(d.observation || '')}`;
      else if (e.kind === 'prediction_committed') body = `<b>#${d.id}</b> ${esc(d.claim)}<span class="q">${esc(d.prediction)} · confidence ${f2(d.confidence)}</span>`;
      else if (e.kind === 'prediction_settled') body = `<b>#${d.id} ${esc(d.status)}</b><span class="q">${esc(d.how)}</span>`;
      else if (e.kind === 'progress_observed') body = `Progress → <b>${f2(d.progress)}</b>${d.usefulness != null ? ` · usefulness ${f2(d.usefulness)}` : ''}${d.criterionMet ? ' · <b>criterion met</b>' : ''}${(d.evidence || []).slice(0, 1).map(x => `<span class="q">${esc(x.observation)}</span>`).join('')}`;
      else if (e.kind === 'worth_signal') body = `<span class="mono">${esc(d.entity)}</span> ← ${esc(d.signal)}${d.rating != null ? ` ${d.rating > 0 ? '+' : ''}${d.rating} by ${esc(d.by)}` : ''}${d.outcome ? ` ${esc(d.outcome)}` : ''}`;
      else if (e.kind === 'want_created') body = `${esc(d.description)}<span class="q">Done when: ${esc(d.doneWhen)}</span>`;
      else if (e.kind === 'branch_committed') body = `Built and pushed <span class="mono">${esc(d.branch)}</span> at ${esc((d.sha || '').slice(0, 7))}`;
      else body = esc(JSON.stringify(d)).slice(0, 200);
      return `<div class="ev ${esc(e.kind)}"><div class="h"><span class="k">${esc(words(e.kind))}</span><span class="at">${when(e.at)}</span></div><div class="b">${body}</div>${a ? `<div class="a"><span><b>frustration</b> ${f2(a.frustration)}</span><span><b>curiosity</b> ${f2(a.curiosity)}</span><span><b>joy</b> ${f2(a.joy)}</span><span><b>self-efficacy</b> ${f2(a.selfEfficacy)}</span></div>` : ''}</div>`;
    }).join('');
    const shift = t.affectShift ? Object.entries(t.affectShift).filter(([k]) => ['frustration', 'curiosity', 'joy', 'selfEfficacy'].includes(k)).map(([k, v]) => `<span class="chip ${v > .05 ? 'ok' : v < -.05 ? 'warn' : ''}">${esc(words(k))} ${v >= 0 ? '+' : ''}${f2(v)}</span>`).join(' ') : '';
    detail = `
      <section class="card"><div class="body">
        <div class="eyebrow">Want #${chain.chain_id} · ${esc(words(chain.status))}${chain.origin?.kind === 'self' ? ' · about itself' : chain.origin?.kind === 'interest' ? ' · self-originated inquiry' : ''}</div>
        <h2 style="margin:var(--s-2) 0 var(--s-3);font-size:20px">${esc(w.description)}</h2>
        <p class="secondary"><b>Done when:</b> ${esc(w.doneWhen)}</p>
        <div class="cols-4" style="margin-top:var(--s-6)">
          <div><div class="eyebrow">Pressure</div><div class="num" style="font-size:24px;font-weight:700;color:var(--teal-600)">${f2(h.pressure)}</div></div>
          <div><div class="eyebrow">Value</div><div class="num" style="font-size:24px;font-weight:700">${f2(w.value)}</div><div class="tiny muted">${esc(w.pricing?.provenance || h.valueProvenance)}${h.unpriced ? ' · unpriced' : ''}</div></div>
          <div><div class="eyebrow">Progress</div><div class="num" style="font-size:24px;font-weight:700">${f2(w.progress)}</div><div class="bar green" style="margin-top:6px"><i style="width:${pct(w.progress)}%"></i></div></div>
          <div><div class="eyebrow">Strategy</div><div style="font-weight:600;margin-top:4px">${esc(words(h.strategy))}</div><div class="tiny muted">${esc(words(h.mode))}${w.failedAttempts ? ` · ${w.failedAttempts} failed` : ''}${ls.name ? ` · last: ${esc(words(ls.status || ls.decision))} ${ago(ls.at)}` : ''}</div></div>
        </div>
      </div></section>
      <section class="card"><header><h2>Commitments</h2><span class="meta">what the world will settle</span></header><div class="list">${commits || empty('Nothing committed yet', 'Predictions, simulations, artifacts and branches appear here once a strategy has run.')}</div></section>
      <section class="card"><header><h2>Story</h2><span class="meta">${shift || 'from the journals'}</span></header><div class="body"><div class="timeline">${trace || empty('No events yet')}</div></div>
        <details><summary>Record observed progress</summary><div class="body">
          <div class="range"><label>Progress</label><input type="range" id="r-progress" min="0" max="1" step="0.05" value="${w.progress || 0}"><span class="n" id="r-progress-n">${f2(w.progress || 0)}</span></div>
          <div class="range"><label>Usefulness</label><input type="range" id="r-useful" min="0" max="1" step="0.05" value="0.5"><span class="n" id="r-useful-n">0.50</span></div>
          <label class="check"><input type="checkbox" id="r-done"> The criterion is met — this satiates the want (sets progress to 1)</label>
          <div class="field"><label>Source of the observation</label><input id="r-source" placeholder="e.g. Quinn, reading the draft"></div>
          <div class="field"><label>What was observed</label><textarea id="r-obs" placeholder="A fact, not a feeling. This becomes evidence on the want and, with usefulness, worth."></textarea></div>
          <div class="actions"><button class="btn primary" id="r-send" data-chain="${chain.chain_id}">Record receipt</button></div>
        </div></details>
      </section>`;
  }
  return `<div class="page">
    <div class="page-head"><div><h1>Wants</h1><p>What the engine is pursuing, priced from worth. Only observed progress satisfies one.</p></div></div>
    <div class="split">
      <section class="card"><header><h2>Active</h2><span class="meta">${wants.length} · top pressure ${f2(hunger.pressure)}</span></header>
        <div class="list">${list || empty('Nothing wanted yet')}</div>
        <details><summary>Create a want</summary><div class="body">
          <div class="field"><label>What should be true</label><input id="w-seed" placeholder="Describe the outcome, not the task"></div>
          <div class="field"><label>Done when</label><input id="w-done" placeholder="An observable criterion"></div>
          <div class="field"><label>Project</label><input id="w-topic" placeholder="Optional — becomes a stake"></div>
          <div class="actions"><button class="btn primary" id="w-send">Create</button></div>
        </div></details>
      </section>
      <div class="stack">${detail}</div>
    </div></div>`;
};

views.worth = async () => {
  const d = await j('/oca/worth');
  const rows = (d.entities || []).map(e => `<tr>
    <td><span class="mono">${esc(e.key)}</span>${e.constraint ? `<div class="tiny" style="color:var(--red-ink);margin-top:2px">Constraint — never weighed: ${e.constraints.map(c => esc(words(c.rule))).join('; ')}</div>` : ''}</td>
    <td class="r num" style="font-weight:600">${f2(e.worth)}</td><td class="r num muted">${f2(e.confidence)}</td><td class="muted small">${esc(e.provenance)} · ${e.signals.rated} rated, ${e.signals.observed} observed</td>
    <td class="r"><span class="actions" style="justify-content:flex-end"><button class="btn sm icon" data-rate="1" data-key="${esc(e.key)}" title="Rate +1">+</button><button class="btn sm icon" data-rate="-1" data-key="${esc(e.key)}" title="Rate −1">−</button></span></td></tr>`).join('');
  return `<div class="page">
    <div class="page-head"><div><h1>Worth</h1><p>What things are worth to the engine — its own capabilities, you, your data and attention, projects, outcomes. Your ratings are its only external reward.</p></div></div>
    <section class="card"><div class="body tight"><table><thead><tr><th>Entity</th><th class="r">Worth</th><th class="r">Confidence</th><th>From</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>
  </div>`;
};

views.risk = async () => {
  const d = await j('/oca/risk?limit=40');
  const a = d.appetite || {}, dec = d.decisions || {};
  const rows = (d.recent || []).map(r => `<tr><td>${chip(words(r.decision), r.decision)}</td><td>${esc(r.proposal?.description)}<div class="tiny muted">${esc(r.appraisal?.reasons?.[0] || '')}</div></td><td>${r.outcome ? chip(r.outcome.result, r.outcome.result) : '<span class="faint tiny">—</span>'}</td><td class="r num small muted">${f2(r.expected?.gain)} / ${f2(r.expected?.loss)}</td><td class="r tiny faint">${ago(r.createdAt)}</td></tr>`).join('');
  return `<div class="page">
    <div class="page-head"><div><h1>Risk</h1><p>Every action appraised as worth gained against worth lost, bounded by reversibility. Appetite is where affect enters.</p></div></div>
    <div class="stack">
      <div class="cols-4">
        <div class="stat"><div class="eyebrow">Appetite</div><div class="v score">${f2(a.appetite)}</div><div class="s">base ${f2(a.base)} + frustration ${f2(a.inputs?.frustration)} + curiosity ${f2(a.inputs?.curiosity)} − fear ${f2(a.inputs?.fear)}</div></div>
        <div class="stat"><div class="eyebrow">Proceeded</div><div class="v">${dec.proceed || 0}</div><div class="s">${d.awaitingOutcome || 0} awaiting an outcome</div></div>
        <div class="stat"><div class="eyebrow">Held for you</div><div class="v">${dec.prepare_artifact || 0}</div><div class="s">the master switch is ${d.controls?.autonomousActions ? 'on' : 'off'}</div></div>
        <div class="stat"><div class="eyebrow">Refused</div><div class="v">${dec.refuse || 0}</div><div class="s">constraints, never weighed</div></div>
      </div>
      ${(d.calibration || []).length ? `<section class="card"><header><h2>Self-knowledge</h2><span class="meta">predicted success vs what happened</span></header><div class="body tight"><table><thead><tr><th>Capability</th><th class="r">n</th><th class="r">Brier</th><th class="r">Observed success</th><th class="r">Predicted</th></tr></thead><tbody>${d.calibration.map(c => `<tr><td>${esc(words(c.capability))}</td><td class="r num">${c.n}</td><td class="r num">${f3(c.brier)}</td><td class="r num">${f2(c.observedSuccessRate)}</td><td class="r num">${f2(c.meanPredicted)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
      <section class="card"><header><h2>Decisions</h2><span class="meta">most recent first</span></header><div class="body tight"><table><thead><tr><th>Decision</th><th>Action</th><th>Outcome</th><th class="r">Gain / loss</th><th class="r">When</th></tr></thead><tbody>${rows || `<tr><td colspan="5">${empty('No decisions yet')}</td></tr>`}</tbody></table></div></section>
    </div></div>`;
};

views.affect = async () => {
  const e = await j('/oca/emotion'); const s = e.state, st = s._style || {}, g = s._grounding || {};
  const bi = (k, v) => { const w = Math.abs(v) * 50, left = v < 0 ? 50 - w : 50; return `<div class="meter-row"><span class="l">${k}</span><div class="bipolar"><i style="left:${left}%;width:${w}%"></i></div><span class="n">${v >= 0 ? '+' : ''}${f2(v)}</span></div>`; };
  const uni = (k, v, c = '') => `<div class="meter-row"><span class="l">${k}</span><div class="bar ${c}"><i style="width:${pct(v)}%"></i></div><span class="n">${f2(v)}</span></div>`;
  const dr = (k, d) => `<div class="meter-row"><span class="l">${k}</span><div class="bar violet" style="position:relative;overflow:visible"><i style="width:${pct(d.level)}%"></i><span class="target" style="left:${pct(d.target)}%"></span></div><span class="n">${f2(d.level)}</span></div>`;
  return `<div class="page">
    <div class="page-head"><div><h1>Affect</h1><p>Feelings come only from what the engine did and observed. Tonic state is a projection of the journals — time alone changes nothing.</p></div>
      <p class="small muted">${g.at ? `Grounded ${ago(g.at)}` : 'Not yet grounded'}</p></div>
    <div class="cols-2">
      <section class="card"><header><h2>Core affect</h2><span class="meta">pleasure · arousal · dominance · certainty · novelty</span></header><div class="body">${[['Pleasure', 'P'], ['Arousal', 'A'], ['Dominance', 'D'], ['Certainty', 'C'], ['Novelty', 'N']].map(([k, key]) => bi(k, s._padcn[key])).join('')}</div></section>
      <section class="card"><header><h2>Channels</h2><span class="meta">phasic, from observed events</span></header><div class="body">${['joy', 'curiosity', 'frustration', 'fear', 'pride', 'shame', 'trust', 'awe', 'sadness', 'anger'].map(k => uni(k[0].toUpperCase() + k.slice(1), s._channels[k])).join('')}</div></section>
      <section class="card"><header><h2>Drives</h2><span class="meta">level against target (the tick)</span></header><div class="body">${Object.entries(s._drives).map(([k, d]) => dr(words(k)[0].toUpperCase() + words(k).slice(1), d)).join('')}</div></section>
      <section class="card"><header><h2>Self-model</h2><span class="meta">projected from calibration and worth</span></header><div class="body">${[['Self-efficacy', s._self_model.self_efficacy], ['Competence identity', s._self_model.competence_identity], ['Autonomy identity', s._self_model.autonomy_identity], ['Emotional stability', s._self_model.emotional_stability], ['Defensiveness', s._self_model.defensiveness]].map(([k, v]) => uni(k, v, 'gray')).join('')}
        <p class="style-line" style="margin-top:var(--s-5)">What it consumes: appetite for risk, the confidence a conclusion must reach, patience before changing strategy, and the form of what it writes — <b>${esc(st.length)}</b>, <b>${esc(st.stance)}</b>, <b>${esc(st.warmth)}</b>; ${esc(st.hedging)}; <b>${esc(st.tempo)}</b>.</p></div></section>
    </div></div>`;
};

views['self-build'] = async () => {
  const d = await j('/oca/self-build'); const p = d.phase, perm = d.permission;
  const wants = (d.selfWants || []).map(w => `<a class="item link" href="#/wants/${w.chain_id}" style="text-decoration:none;color:inherit"><span class="num" style="font-weight:600;color:var(--teal-600);min-width:36px">${f2(w.pressure)}</span><div><div class="t">#${w.chain_id} ${esc(w.description)}</div><div class="d">${esc(words(w.status))} · ${esc(words(w.strategy))}</div></div></a>`).join('');
  const events = (d.recent || []).map(e => { const pl = e.payload || {}; const kind = e.kind === 'build' ? (pl.pushed ? 'ok' : 'bad') : e.kind === 'refused' || e.kind === 'recurred' ? 'bad' : e.kind === 'enter' ? 'info' : e.kind === 'merged' || e.kind === 'settled' ? 'ok' : '';
    const text = e.kind === 'build' ? (pl.pushed ? `Pushed <span class="mono">${esc(pl.branch)}</span> · tests ${pl.tests?.after ?? '?'}/${pl.tests?.after ?? '?'}${pl.coder ? ` · ${esc(pl.coder)}` : ''}` : `Refused: ${esc(pl.failed || pl.code || '')}`) : e.kind === 'want' ? `Wanted: ${esc(pl.defect || '')}` : e.kind === 'refused' ? `Refused — touched ${esc((pl.forbidden || []).join(', '))}`
      : e.kind === 'merged' ? `You merged <span class="mono">${esc(pl.branch)}</span> at ${esc((pl.sha || '').slice(0, 7))}${pl.running ? ' · running' : ' · restart to run it'}`
      : e.kind === 'settled' ? `Quiet after the merge of <span class="mono">${esc(pl.branch)}</span> — ${pl.failures ?? 0} failure(s) journaled, none this defect; want sated`
      : e.kind === 'recurred' ? `The defect came back after <span class="mono">${esc(pl.branch)}</span> was merged (${pl.same ?? 0}×); want reopened` : esc(pl.reason || JSON.stringify(pl));
    return `<div class="item"><span>${chip(e.kind, kind)}</span><div><div class="t" style="font-weight:400">${text}</div>${e.chain_id ? `<div class="d">want #${e.chain_id}</div>` : ''}</div><span class="when">${ago(e.created_at)}</span></div>`; }).join('');
  return `<div class="page">
    <div class="page-head"><div><h1>Self-build</h1><p>The engine may want things about itself. You permit the phase; it enters and leaves on its own, changes its code on a branch, proves it with its tests, and publishes the branch for you to merge.</p></div>
      <label class="toggle ${perm.enabled ? 'on' : ''}" id="sb-perm"><span class="sw"></span>${perm.enabled ? 'Permitted' : 'Not permitted'}</label></div>
    <div class="stack">
      <div class="cols-4">
        <div class="stat"><div class="eyebrow">Phase</div><div class="v ${p.active ? 'score' : ''}">${p.active ? 'In phase' : 'Idle'}</div><div class="s">${p.active ? `since ${clock(p.since)} · ${esc(p.reason)}` : p.lastExitAt ? `left ${ago(p.lastExitAt)}` : 'has not entered yet'}</div></div>
        <div class="stat"><div class="eyebrow">Built this phase</div><div class="v">${p.builds}</div><div class="s">${p.failures} consecutive failure${p.failures === 1 ? '' : 's'}</div></div>
        <div class="stat"><div class="eyebrow">Self-wants</div><div class="v">${(d.selfWants || []).length}</div><div class="s">wants about itself</div></div>
        <div class="stat"><div class="eyebrow">Auto-merge</div><div class="v">${perm.autoMerge ? 'On' : 'Off'}</div><div class="s">branches await your merge</div></div>
      </div>
      <div class="cols-2">
        <section class="card"><header><h2>Wants about itself</h2></header><div class="list">${wants || empty('None right now', 'Introspection turns repeated defects in the risk journal into wants; or hand it one below.')}</div>
          <details><summary>Give it a want about itself</summary><div class="body">
            <div class="field"><label>What should be different about the engine</label><input id="sb-seed" placeholder="A defect, a gap, a capability"></div>
            <div class="field"><label>Done when</label><input id="sb-done" placeholder="Default: merged to main and its tests pass"></div>
            <div class="field"><label>What you observed</label><textarea id="sb-obs" placeholder="A fact that shows it. Becomes evidence on the want."></textarea></div>
            <div class="actions"><button class="btn primary" id="sb-send">Hand it the want</button></div>
          </div></details></section>
        <section class="card"><header><h2>Journal</h2><span class="meta">entries, builds, refusals, merges, settlements</span></header><div class="list">${events || empty('Nothing yet')}</div>
          <div class="body tiny muted" style="border-top:1px solid var(--border-subtle)">Constitution — untouchable by the engine: ${(d.constitution || []).map(c => `<span class="mono">${esc(c)}</span>`).join(', ')}</div></section>
      </div>
    </div></div>`;
};

views.meter = async () => {
  const c = await j('/oca/crm');
  const rows = Object.entries(c.components || {}).map(([k, v]) => `<tr><td style="font-weight:500;width:160px">${esc(k[0].toUpperCase() + k.slice(1))}</td><td class="r num" style="width:80px;font-weight:600;${v.status === 'measured' ? 'color:var(--teal-600)' : 'color:var(--ink-faint)'}">${v.score == null ? '—' : f3(v.score)}</td><td style="width:200px">${chip(words(v.status), v.status === 'measured' ? 'ok' : v.status === 'insufficient_evidence' ? 'warn' : '')}${v.n != null ? `<span class="tiny muted" style="margin-left:8px">n = ${v.n}</span>` : ''}</td><td class="small secondary">${esc(v.detail)}</td></tr>`).join('');
  return `<div class="page">
    <div class="page-head"><div><h1>Chinese Room Meter</h1><p>Each dimension measured from the journals against a stated baseline, or exactly what evidence it still needs. The composite stays null until every dimension is measured.</p></div></div>
    <div class="stack">
      <div class="cols-3">
        <div class="stat"><div class="eyebrow">Composite</div><div class="v ${c.composite == null ? '' : 'score'}">${c.composite == null ? 'null' : f3(c.composite)}</div><div class="s">${c.composite == null ? 'not all dimensions measured' : 'all dimensions measured'}</div></div>
        <div class="stat"><div class="eyebrow">Coverage</div><div class="v score">${Math.round((c.evidence_coverage || 0) * 100)}%</div><div class="s">${(Object.values(c.components || {}).filter(v => v.status === 'measured')).length} of ${Object.keys(c.components || {}).length} measured</div></div>
        <div class="stat"><div class="eyebrow">Partial mean</div><div class="v">${c.partial_mean == null ? '—' : f3(c.partial_mean)}</div><div class="s">${esc(c.evaluation_version)}</div></div>
      </div>
      <section class="card"><div class="body tight"><table><thead><tr><th>Dimension</th><th class="r">Score</th><th>Status</th><th>What it measures / what it needs</th></tr></thead><tbody>${rows}</tbody></table></div></section>
      <p class="small muted">${esc(c.interpretation)}</p>
    </div></div>`;
};

views.thinker = async () => {
  const t = await j('/oca/thinker/status');
  return `<div class="page">
    <div class="page-head"><div><h1>Thinker</h1><p>The ambient thinker: it reads the active wants and the perception snapshot each cycle, and its proposals go through the risk gate.</p></div></div>
    <div class="cols-3">
      <div class="stat"><div class="eyebrow">Runs</div><div class="v">${t.runs}</div><div class="s">${t.skipped || 0} skipped · ${t.suppressed || 0} suppressed</div></div>
      <div class="stat"><div class="eyebrow">Errors</div><div class="v">${t.errors}</div><div class="s">${t.last_error ? esc(String(t.last_error).slice(0, 60)) : 'none'}</div></div>
      <div class="stat"><div class="eyebrow">Last run</div><div class="v">${t.last_run_age_seconds != null ? `${t.last_run_age_seconds < 60 ? t.last_run_age_seconds + ' s' : (t.last_run_age_seconds / 60 | 0) + ' min'}` : '—'}</div><div class="s">${t.last_run_duration_ms ? `${(t.last_run_duration_ms / 1000).toFixed(1)} s to think` : ''}</div></div>
    </div>
    <section class="card" style="margin-top:var(--s-6)"><header><h2>Last thought</h2></header><div class="body"><p class="thought ${/silent tick|^—/.test(t.last_thought || '') ? 'silent' : ''}">${esc(t.last_thought || 'No thought yet.')}</p></div></section>
  </div>`;
};

/* ── actions ── */
function wire() {
  document.querySelectorAll('[data-go]').forEach(el => el.onclick = () => { location.hash = el.dataset.go; });
  document.querySelectorAll('[data-rate]').forEach(b => b.onclick = async () => { b.disabled = true; try { const r = await post('/oca/worth/rate', { entityKey: b.dataset.key, rating: Number(b.dataset.rate), by: 'quinn', about: 'engine app' }); toast(`${b.dataset.key} → ${f2(r.state.worth)}`); render(); } catch (e) { toast(e.message, true); b.disabled = false; } });
  const rp = $('#r-progress'), ru = $('#r-useful');
  if (rp) { rp.oninput = e => $('#r-progress-n').textContent = f2(e.target.value); ru.oninput = e => $('#r-useful-n').textContent = f2(e.target.value);
    $('#r-done').onchange = e => { if (e.target.checked) { rp.value = 1; $('#r-progress-n').textContent = '1.00'; } };
    $('#r-send').onclick = async () => { const source = $('#r-source').value.trim(), obs = $('#r-obs').value.trim(); if (!source || !obs) return toast('Source and observation are both required.', true);
      const id = $('#r-send').dataset.chain; $('#r-send').disabled = true;
      try { const r = await post(`/ponder/${id}/outcome`, { receiptId: `app-${Date.now().toString(36)}`, progress: Number(rp.value), usefulness: Number(ru.value), criterionMet: $('#r-done').checked, evidence: [{ id: `app-${Date.now().toString(36)}`, source, observation: obs }] }); toast(`Recorded. Progress ${f2(r.want.progress)} · ${words(r.status)}`); render(); }
      catch (e) { toast(e.message, true); $('#r-send').disabled = false; } }; }
  const ws = $('#w-send');
  if (ws) ws.onclick = async () => { const seed = $('#w-seed').value.trim(); if (!seed) return toast('Say what should be true.', true); ws.disabled = true;
    try { const r = await post('/ponder', { seed, doneWhen: $('#w-done').value.trim() || undefined, topic: $('#w-topic').value.trim(), evidence: [] }); toast(`Want #${r.chain_id} created`); location.hash = `#/wants/${r.chain_id}`; } catch (e) { toast(e.message, true); ws.disabled = false; } };
  const sp = $('#sb-perm');
  if (sp) sp.onclick = async () => { const on = sp.classList.contains('on'); try { await post('/oca/ui/controls', { selfBuild: !on }, 'PATCH'); toast(`Self-build ${on ? 'no longer' : 'now'} permitted`); render(); } catch (e) { toast(e.message, true); } };
  const ss = $('#sb-send');
  if (ss) ss.onclick = async () => { const seed = $('#sb-seed').value.trim(), obs = $('#sb-obs').value.trim(), doneWhen = $('#sb-done').value.trim(); if (!seed) return toast('Say what should be different.', true); ss.disabled = true;
    try { const r = await post('/oca/self-build/want', { seed, ...(doneWhen ? { doneWhen } : {}), evidence: obs ? [{ id: `person-${Date.now().toString(36)}`, source: 'a person, observing the engine', observation: obs }] : [] }); toast(`Self-want #${r.chain_id} created`); render(); } catch (e) { toast(e.message, true); ss.disabled = false; } };
}

/* ── router ── */
let current = null, timer = null;
function route() { const m = location.hash.match(/^#\/([a-z-]+)(?:\/(\d+))?/); return { view: m?.[1] && views[m[1]] ? m[1] : 'overview', id: m?.[2] }; }
async function render() {
  const { view, id } = route();
  document.querySelectorAll('.nav a').forEach(a => a.setAttribute('aria-current', a.dataset.view === view ? 'page' : 'false'));
  const key = `${view}/${id || ''}`; const first = key !== current; current = key;
  const scrollY = window.scrollY;
  try { const html = await views[view](id); if (current !== key) return; $('#main').innerHTML = html; wire();
    if (first) { $('#main .page')?.classList.add('enter'); window.scrollTo(0, 0); } else window.scrollTo(0, scrollY); }
  catch (e) { $('#main').innerHTML = `<div class="page"><div class="page-head"><h1>${esc(view)}</h1></div>${err(e)}</div>`; }
  shell();
}
window.addEventListener('hashchange', render);
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('details[open]').forEach(d => d.open = false); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
render();
timer = setInterval(() => { if (!document.hidden && !document.querySelector('details[open]') && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') render(); }, 8000);
