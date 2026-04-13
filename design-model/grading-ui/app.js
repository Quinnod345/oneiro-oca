// Design Grading Interface — client-side logic

const DIMS = [
  'typography_quality', 'color_harmony', 'spatial_composition',
  'motion_elegance', 'emotional_resonance', 'craft_visibility',
  'minimalism_coherence', 'native_integration',
  'visceral_score', 'behavioral_score', 'reflective_score',
  'overall_aesthetic',
  'innovation_score', 'system_creativity', 'design_distinctiveness',
  'problem_level',
];

const INNOVATION_DIMS = new Set([
  'innovation_score', 'system_creativity', 'design_distinctiveness', 'problem_level',
]);

const DIM_LABELS = {
  typography_quality: 'Typography', color_harmony: 'Color', spatial_composition: 'Spatial',
  motion_elegance: 'Motion', emotional_resonance: 'Emotion', craft_visibility: 'Craft',
  minimalism_coherence: 'Minimalism', native_integration: 'Native',
  visceral_score: 'Visceral (L1)', behavioral_score: 'Behavioral (L2)',
  reflective_score: 'Reflective (L3)', overall_aesthetic: 'Overall',
  innovation_score: 'Innovation', system_creativity: 'System Creativity',
  design_distinctiveness: 'Distinctiveness', problem_level: 'Problem Level',
};

// ── State ──

const state = {
  designs: [],
  currentId: null,
  grades: {},
  tags: new Set(),
  gradeMode: 'quick', // quick or detailed
  compareA: null,
  compareB: null,
  comparePrefs: {},
};

// ── API ──

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

// ── Navigation ──

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`view-${btn.dataset.view}`).classList.add('active');

    if (btn.dataset.view === 'gallery') loadGallery();
    if (btn.dataset.view === 'stats') loadStats();
    if (btn.dataset.view === 'compare') loadCompare();
  });
});

// ── Gallery ──

async function loadGallery() {
  state.designs = await api('/designs');
  renderGallery();
}

function renderGallery() {
  const source = document.getElementById('filter-source').value;
  const graded = document.getElementById('filter-graded').value;

  let filtered = state.designs.filter(d => d.hasScreenshot);
  if (source !== 'all') filtered = filtered.filter(d => d.source === source);
  if (graded === 'graded') filtered = filtered.filter(d => d.hasHumanGrade);
  if (graded === 'ungraded') filtered = filtered.filter(d => !d.hasHumanGrade);

  document.getElementById('gallery-count').textContent = `${filtered.length} designs`;

  const grid = document.getElementById('gallery-grid');
  grid.innerHTML = filtered.map(d => `
    <div class="gallery-card ${d.hasHumanGrade ? 'graded' : ''}" onclick="openGrade(${d.id})">
      ${d.hasHumanGrade ? '<div class="gallery-card-badge">Graded</div>' : ''}
      <img src="/api/designs/${d.id}/screenshot" loading="lazy" alt="${d.name}">
      <div class="gallery-card-info">
        <div class="gallery-card-name">${d.name}</div>
        <div class="gallery-card-meta">
          <span>${d.source}</span>
          <span class="gallery-card-score">${d.overall != null ? d.overall.toFixed(2) : '—'}</span>
        </div>
      </div>
    </div>
  `).join('');
}

document.getElementById('filter-source').addEventListener('change', renderGallery);
document.getElementById('filter-graded').addEventListener('change', renderGallery);

// ── Grade Mode Toggle ──

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.gradeMode = btn.dataset.mode;
    document.getElementById('quick-grade').style.display = btn.dataset.mode === 'quick' ? 'block' : 'none';
    document.getElementById('detailed-grade').style.display = btn.dataset.mode === 'detailed' ? 'block' : 'none';
  });
});

// ── Grade View ──

function createBigSlider(containerId, label, lowLabel, highLabel, value, modelValue, cssClass) {
  const container = document.getElementById(containerId);
  container.innerHTML = `
    <div class="big-slider-header">
      <span class="model-marker">Model: ${modelValue.toFixed(2)}</span>
      <span class="big-slider-value ${cssClass}" id="${containerId}-value">${(value * 10).toFixed(1)}</span>
    </div>
    <input type="range" min="0" max="100" value="${Math.round(value * 100)}"
      class="${cssClass === 'innovation-value' ? 'innovation-slider' : ''}"
      id="${containerId}-slider">
    <div class="big-slider-labels">
      <span>${lowLabel}</span>
      <span>${highLabel}</span>
    </div>
  `;
  return container.querySelector('input[type="range"]');
}

async function openGrade(id) {
  state.currentId = id;
  const design = await api(`/designs/${id}`);

  // Switch to grade view
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelector('[data-view="grade"]').classList.add('active');
  document.getElementById('view-grade').classList.add('active');

  // Set screenshot
  document.getElementById('grade-img').src = `/api/designs/${id}/screenshot`;
  document.getElementById('grade-name').textContent =
    design.metadata?.source_name || design.metadata?.category || `Design #${id}`;

  // Initialize grades from existing human grades or model scores
  const existingHuman = design.human_grades?.scores || {};
  const modelScores = design.model_scores || design.scores || {};

  state.grades = {};
  for (const dim of DIMS) {
    state.grades[dim] = existingHuman[dim] ?? modelScores[dim] ?? 0.5;
  }

  // ── Quick Mode: 3 big sliders ──
  const overallSlider = createBigSlider('quick-overall', 'Overall',
    'Terrible', 'Exceptional',
    state.grades.overall_aesthetic, modelScores.overall_aesthetic ?? 0.5, '');

  overallSlider.addEventListener('input', () => {
    const val = overallSlider.value / 100;
    state.grades.overall_aesthetic = val;
    document.getElementById('quick-overall-value').textContent = (val * 10).toFixed(1);
  });

  const innovSlider = createBigSlider('quick-innovation', 'Innovation',
    'Conventional', 'Paradigm-shifting',
    state.grades.innovation_score ?? 0.5, modelScores.innovation_score ?? 0.5, 'innovation-value');

  innovSlider.addEventListener('input', () => {
    const val = innovSlider.value / 100;
    state.grades.innovation_score = val;
    // Also set related dims proportionally
    state.grades.system_creativity = val * 0.9 + 0.05;
    state.grades.design_distinctiveness = val * 0.85 + 0.05;
    state.grades.problem_level = val * 0.8 + 0.05;
    document.getElementById('quick-innovation-value').textContent = (val * 10).toFixed(1);
  });

  const coherenceVal = existingHuman._coherence ?? modelScores.overall_aesthetic ?? 0.5;
  const coherenceSlider = createBigSlider('quick-coherence', 'Coherence',
    'Parts clash', 'Everything harmonizes',
    coherenceVal, modelScores.overall_aesthetic ?? 0.5, 'coherence-value');

  coherenceSlider.addEventListener('input', () => {
    const val = coherenceSlider.value / 100;
    state.grades._coherence = val; // Special field: influences how we weight individual dims
    document.getElementById('quick-coherence-value').textContent = (val * 10).toFixed(1);
  });

  // ── Detailed Mode: all 16 sliders ──
  const container = document.getElementById('grade-sliders');
  container.innerHTML = '';

  for (const dim of DIMS) {
    const modelVal = (modelScores[dim] ?? 0.5).toFixed(2);
    const isInnovation = INNOVATION_DIMS.has(dim);
    const group = document.createElement('div');
    group.className = 'slider-group';
    group.innerHTML = `
      <div class="slider-header">
        <span class="slider-name ${isInnovation ? 'innovation' : ''}">${DIM_LABELS[dim]}</span>
        <div class="slider-values">
          <span class="slider-model" title="Model score">M:${modelVal}</span>
          <span class="slider-human" id="val-${dim}">H:${state.grades[dim].toFixed(2)}</span>
          <span class="slider-delta" id="delta-${dim}"></span>
        </div>
      </div>
      <input type="range" min="0" max="100" value="${Math.round(state.grades[dim] * 100)}"
        class="${isInnovation ? 'innovation-slider' : ''}"
        data-dim="${dim}" data-model="${modelVal}">
    `;
    container.appendChild(group);

    const slider = group.querySelector('input[type="range"]');
    slider.addEventListener('input', () => {
      const val = slider.value / 100;
      state.grades[dim] = val;
      document.getElementById(`val-${dim}`).textContent = `H:${val.toFixed(2)}`;
      const delta = Math.abs(val - parseFloat(slider.dataset.model));
      const deltaEl = document.getElementById(`delta-${dim}`);
      if (delta > 0.15) {
        deltaEl.textContent = `\u0394${delta.toFixed(2)}`;
        deltaEl.className = `slider-delta ${delta > 0.3 ? 'strong-disagree' : 'disagree'}`;
      } else {
        deltaEl.textContent = '';
        deltaEl.className = 'slider-delta agree';
      }
    });

    slider.dispatchEvent(new Event('input'));
  }

  // Tags
  state.tags = new Set(design.human_grades?.tags || []);
  document.querySelectorAll('.tag').forEach(t => {
    t.classList.toggle('active', state.tags.has(t.dataset.tag));
  });

  // Notes
  document.getElementById('grade-notes').value = design.human_grades?.notes || '';
}

// Tag toggles
document.querySelectorAll('.tag').forEach(tag => {
  tag.addEventListener('click', () => {
    const t = tag.dataset.tag;
    if (state.tags.has(t)) { state.tags.delete(t); tag.classList.remove('active'); }
    else { state.tags.add(t); tag.classList.add('active'); }
  });
});

// Submit grade
document.getElementById('btn-submit').addEventListener('click', async () => {
  if (state.currentId === null) return;

  // In quick mode, apply coherence to modulate individual dim scores
  const coherence = state.grades._coherence;
  const grades = { ...state.grades };
  delete grades._coherence;

  // If coherence is low, dampen individual high scores toward the overall
  // (great parts that don't fit together = not actually great)
  if (coherence !== undefined && coherence < 0.5) {
    const overall = grades.overall_aesthetic;
    const dampFactor = coherence; // 0 = full damping, 0.5 = no damping
    for (const dim of DIMS) {
      if (dim === 'overall_aesthetic' || INNOVATION_DIMS.has(dim)) continue;
      if (grades[dim] > overall + 0.1) {
        // Pull high scores toward overall when coherence is low
        grades[dim] = grades[dim] * (0.5 + dampFactor) + overall * (0.5 - dampFactor);
      }
    }
  }

  await api(`/designs/${state.currentId}/grade`, {
    method: 'POST',
    body: JSON.stringify({
      scores: grades,
      notes: document.getElementById('grade-notes').value,
      tags: [...state.tags],
      coherence: coherence,
    }),
  });

  showToast('Grade submitted');
  state.designs = await api('/designs');

  // Auto-advance to next ungraded
  const queue = await api('/queue');
  if (queue.length > 0) {
    openGrade(queue[0].id);
  }
});

// Skip
document.getElementById('btn-skip').addEventListener('click', async () => {
  const queue = await api('/queue');
  if (queue.length > 0) {
    openGrade(queue[0].id);
  }
});

// Prev/Next
document.getElementById('btn-next').addEventListener('click', async () => {
  if (state.designs.length === 0) await loadGallery();
  const withScreenshots = state.designs.filter(d => d.hasScreenshot);
  const currentIdx = withScreenshots.findIndex(d => d.id === state.currentId);
  const nextIdx = (currentIdx + 1) % withScreenshots.length;
  openGrade(withScreenshots[nextIdx].id);
});

document.getElementById('btn-prev').addEventListener('click', async () => {
  if (state.designs.length === 0) await loadGallery();
  const withScreenshots = state.designs.filter(d => d.hasScreenshot);
  const currentIdx = withScreenshots.findIndex(d => d.id === state.currentId);
  const prevIdx = (currentIdx - 1 + withScreenshots.length) % withScreenshots.length;
  openGrade(withScreenshots[prevIdx].id);
});

// ── Compare View ──

async function loadCompare() {
  const pair = await api('/compare');
  if (pair.error) return;

  state.compareA = pair.a;
  state.compareB = pair.b;
  state.comparePrefs = {};

  document.getElementById('compare-img-a').src = `/api/designs/${pair.a.id}/screenshot`;
  document.getElementById('compare-img-b').src = `/api/designs/${pair.b.id}/screenshot`;
  document.getElementById('compare-name-a').textContent = `A: ${pair.a.name}`;
  document.getElementById('compare-name-b').textContent = `B: ${pair.b.name}`;

  const container = document.getElementById('compare-dims');
  container.innerHTML = '';

  for (const dim of DIMS) {
    if (dim === 'overall_aesthetic') continue;
    const isInnovation = INNOVATION_DIMS.has(dim);
    const row = document.createElement('div');
    row.className = 'compare-dim';
    row.innerHTML = `
      <span class="compare-dim-name ${isInnovation ? 'innovation' : ''}">${DIM_LABELS[dim]}</span>
      <button data-dim="${dim}" data-choice="A">A</button>
      <button data-dim="${dim}" data-choice="tie">=</button>
      <button data-dim="${dim}" data-choice="B">B</button>
    `;
    container.appendChild(row);

    row.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        row.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        state.comparePrefs[dim] = btn.dataset.choice;
      });
    });
  }
}

document.getElementById('btn-new-compare').addEventListener('click', loadCompare);

document.getElementById('btn-submit-compare').addEventListener('click', async () => {
  if (!state.compareA || !state.compareB) return;

  const preferences = {};
  for (const [dim, choice] of Object.entries(state.comparePrefs)) {
    preferences[dim] = { winner: choice, margin: choice === 'tie' ? 0 : 0.3 };
  }

  await api('/compare', {
    method: 'POST',
    body: JSON.stringify({
      a_id: state.compareA.id,
      b_id: state.compareB.id,
      preferences,
    }),
  });

  showToast('Comparison submitted');
  loadCompare();
});

// ── Stats View ──

async function loadStats() {
  const stats = await api('/stats');

  document.getElementById('stat-total').textContent = stats.total;
  document.getElementById('stat-graded').textContent = stats.humanGraded;
  document.getElementById('stat-remaining').textContent = stats.remaining;
  document.getElementById('stat-pairs').textContent = stats.humanPairs;

  const pct = Math.round(stats.progress * 100);
  document.getElementById('progress-fill').style.width = `${pct}%`;
  document.getElementById('progress-text').textContent =
    `${stats.humanGraded} / ${stats.withScreenshots} graded (${pct}%)`;

  // Disagreements
  const disEl = document.getElementById('disagreement-list');
  const entries = Object.entries(stats.disagreements || {})
    .sort(([, a], [, b]) => b.avgDelta - a.avgDelta);

  if (entries.length === 0) {
    disEl.innerHTML = '<div style="color:var(--text-dim);font-size:13px">No disagreements yet. Grade some designs to see where you and the model differ.</div>';
  } else {
    disEl.innerHTML = entries.map(([dim, info]) => `
      <div class="disagreement-item">
        <span class="dim-name">${DIM_LABELS[dim] || dim}</span>
        <span class="delta">${info.avgDelta.toFixed(3)} avg (${info.count}x)</span>
      </div>
    `).join('');
  }

  // Source breakdown
  const srcEl = document.getElementById('source-breakdown');
  srcEl.innerHTML = Object.entries(stats.sources || {}).map(([src, count]) => `
    <div class="source-item">
      <span>${src}</span>
      <span class="count">${count}</span>
    </div>
  `).join('');
}

// ── Toast ──

function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

// ── Keyboard shortcuts ──

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

  if (e.key === 'ArrowRight') document.getElementById('btn-next').click();
  if (e.key === 'ArrowLeft') document.getElementById('btn-prev').click();
  if (e.key === 'Enter' && e.metaKey) document.getElementById('btn-submit').click();
});

// ── Init ──

loadGallery();
