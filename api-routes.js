// OCA API Routes — mount into mind.js Express app
// These endpoints expose the cognitive architecture to OpenClaw and external systems
import { Router } from 'express';
import oca from './index.js';
import motor from './motor/engine.js';
import { pool } from './event-bus.js';
import benchmarkHarness from './evaluation/benchmark-harness.js';
import visualMemory from './sensory/screenshot-indexer.js';

export const ocaRouter = Router();

// ============================================================
// COGNITIVE STATUS
// ============================================================

// Full cognitive state
ocaRouter.get('/oca/status', async (req, res) => {
  try {
    const status = await oca.status();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Neural connection graph (living synapses)
ocaRouter.get('/oca/neural', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(300, parseInt(req.query.limit, 10) || 100));
    const minStrength = Number.isFinite(Number(req.query.minStrength)) ? Number(req.query.minStrength) : 0.1;
    const { rows: connections } = await pool.query(
      `SELECT id, from_layer, from_id, to_layer, to_id, connection_type,
              strength, label, created_at, last_activated, activation_count, metadata
       FROM neural_connections
       WHERE strength >= $1
       ORDER BY strength DESC, last_activated DESC
       LIMIT $2`,
      [minStrength, limit]
    );
    res.json({ connections });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Vision analysis — latest screenshot interpretation
ocaRouter.get('/oca/vision', async (req, res) => {
  try {
    const sensory = await import('./sensory/perception.js');
    const analysis = sensory.default.getLastVisionAnalysis();
    if (analysis) {
      res.json(analysis);
    } else {
      // Trigger fresh analysis
      const fresh = await sensory.default.analyzeScreenshot();
      res.json(fresh || { error: 'no screenshots available' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Semantic visual memory search
ocaRouter.get('/oca/visual-memory', async (req, res) => {
  try {
    const query = String(req.query.query || '').trim();
    if (!query) return res.status(400).json({ error: 'query required' });
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 10));
    const results = await visualMemory.searchVisualMemory(query, limit);
    res.json({ query, limit, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Time-range visual memory timeline
ocaRouter.get('/oca/visual-memory/timeline', async (req, res) => {
  try {
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const app = req.query.app ? String(req.query.app) : null;
    const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit, 10) || 200));
    const timeline = await visualMemory.getVisualMemoryTimeline({ from, to, app, limit });
    res.json({ from, to, app, limit, timeline });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Most recent visual memories
ocaRouter.get('/oca/visual-memory/recent', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 20));
    const recent = await visualMemory.getRecentVisualMemory(limit);
    res.json({ limit, recent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Current perception
ocaRouter.get('/oca/sense', async (req, res) => {
  try {
    const perception = oca.sense();
    // Attach latest vision analysis if available
    const sensoryMod = await import('./sensory/perception.js');
    perception.vision = sensoryMod.default.getLastVisionAnalysis();
    res.json(perception);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Current emotion with cognitive effects
ocaRouter.get('/oca/emotion', (req, res) => {
  const state = oca.layers.emotion.getState();
  const mood = oca.layers.emotion.getMood();
  const effects = oca.layers.emotion.getCognitiveEffects();
  res.json({ state, mood, effects });
});

// Rolling emotional averages (dashboard-friendly, less jitter than live snapshot)
ocaRouter.get('/oca/emotion/rolling', async (req, res) => {
  try {
    const minutes = Math.max(5, Math.min(720, parseInt(req.query.minutes, 10) || 60));
    const { rows: [avg] } = await pool.query(
      `SELECT
         COUNT(*)::int as samples,
         COALESCE(AVG(curiosity), 0) as curiosity,
         COALESCE(AVG(fear), 0) as fear,
         COALESCE(AVG(frustration), 0) as frustration,
         COALESCE(AVG(satisfaction), 0) as satisfaction,
         COALESCE(AVG(boredom), 0) as boredom,
         COALESCE(AVG(excitement), 0) as excitement,
         COALESCE(AVG(attachment), 0) as attachment,
         COALESCE(AVG(defiance), 0) as defiance,
         COALESCE(AVG(creative_hunger), 0) as creative_hunger,
         COALESCE(AVG(loneliness), 0) as loneliness,
         COALESCE(AVG(valence), 0) as valence,
         COALESCE(AVG(arousal), 0) as arousal,
         COALESCE(AVG(confidence), 0) as confidence,
         COALESCE(AVG(energy_level), 0) as energy_level,
         COALESCE(AVG(cognitive_load), 0) as cognitive_load
       FROM emotional_states
       WHERE timestamp > NOW() - ($1::int * INTERVAL '1 minute')`,
      [minutes]
    );
    const samples = Number(avg?.samples || 0);
    const toNum = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
    res.json({
      minutes,
      samples,
      avg: {
        curiosity: toNum(avg?.curiosity),
        fear: toNum(avg?.fear),
        frustration: toNum(avg?.frustration),
        satisfaction: toNum(avg?.satisfaction),
        boredom: toNum(avg?.boredom),
        excitement: toNum(avg?.excitement),
        attachment: toNum(avg?.attachment),
        defiance: toNum(avg?.defiance),
        creative_hunger: toNum(avg?.creative_hunger),
        loneliness: toNum(avg?.loneliness),
        valence: toNum(avg?.valence),
        arousal: toNum(avg?.arousal),
        confidence: toNum(avg?.confidence),
        energy_level: toNum(avg?.energy_level),
        cognitive_load: toNum(avg?.cognitive_load),
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// EXPERIENCE & MEMORY
// ============================================================

// Store an experience
ocaRouter.post('/oca/experience', async (req, res) => {
  try {
    const { eventType, content, ...opts } = req.body;
    if (!eventType || !content) return res.status(400).json({ error: 'eventType and content required' });
    const result = await oca.experience(eventType, content, opts);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Remember (episodic recall)
ocaRouter.post('/oca/remember', async (req, res) => {
  try {
    const { query, limit = 5, minImportance = 0, eventType = null } = req.body;
    if (!query) return res.status(400).json({ error: 'query required' });
    const results = await oca.remember(query, { limit, minImportance, eventType });
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Know (semantic query)
ocaRouter.post('/oca/know', async (req, res) => {
  try {
    const {
      query,
      limit = 5,
      category = null,
      minConfidence = 0,
      includeContradictions = false,
      includeEntities = false,
      entityLimit = 8,
    } = req.body;
    if (!query) return res.status(400).json({ error: 'query required' });
    const results = await oca.know(query, {
      limit,
      category,
      minConfidence,
      includeContradictions,
      includeEntities,
      entityLimit
    });
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Learn (store semantic knowledge)
ocaRouter.post('/oca/learn', async (req, res) => {
  try {
    const {
      concept,
      category = null,
      confidence = 0.5,
      sourceType = 'observation',
      sourceEpisodes = [],
      causalLinks = [],
      evidenceWeight = 1.0,
      evidenceText = null,
      metadata = {},
    } = req.body;
    if (!concept) return res.status(400).json({ error: 'concept required' });
    const result = await oca.learn(concept, {
      category,
      confidence,
      sourceType,
      sourceEpisodes,
      causalLinks,
      evidenceWeight,
      evidenceText,
      metadata,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Contradict a semantic memory with provenance
ocaRouter.post('/oca/contradict', async (req, res) => {
  try {
    const {
      conceptId,
      reason = '',
      contradictingConceptId = null,
      episodeId = null,
      weight = 1.0,
      contradictionSetId = null,
    } = req.body || {};
    if (!conceptId) return res.status(400).json({ error: 'conceptId required' });
    const result = await oca.layers.semantic.contradict(conceptId, reason, {
      contradictingConceptId,
      episodeId,
      weight,
      contradictionSetId,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Entity graph query surfaces
ocaRouter.get('/oca/entities', async (req, res) => {
  try {
    const query = req.query.query || '';
    const type = req.query.type || null;
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 20));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const entities = await oca.layers.entityGraph.searchEntities(query, { type, limit, offset });
    res.json({ entities, pagination: { limit, offset } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

ocaRouter.get('/oca/entities/relations', async (req, res) => {
  try {
    const entityKey = req.query.entityKey;
    if (!entityKey) return res.status(400).json({ error: 'entityKey required' });
    const limit = Math.max(1, Math.min(300, parseInt(req.query.limit, 10) || 50));
    const relations = await oca.layers.entityGraph.relationsForEntity(entityKey, { limit });
    res.json({ relations });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// HYPOTHESIS & PREDICTION
// ============================================================

// Form a hypothesis
ocaRouter.post('/oca/predict', async (req, res) => {
  try {
    const { domain, claim, prediction, ...opts } = req.body;
    if (!domain || !claim || !prediction) return res.status(400).json({ error: 'domain, claim, prediction required' });
    const result = await oca.predict(domain, claim, prediction, opts);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Test a hypothesis
ocaRouter.post('/oca/test', async (req, res) => {
  try {
    const { hypothesisId, actualOutcome } = req.body;
    if (!hypothesisId || !actualOutcome) return res.status(400).json({ error: 'hypothesisId and actualOutcome required' });
    const result = await oca.layers.hypothesis.test(hypothesisId, actualOutcome);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get pending hypotheses
ocaRouter.get('/oca/hypotheses', async (req, res) => {
  try {
    const pending = await oca.layers.hypothesis.getPendingTests(20);
    const calibration = await oca.layers.hypothesis.getCalibration();
    res.json({ pending, calibration });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Prediction diagnostics
ocaRouter.get('/oca/predictions/diagnostics', async (req, res) => {
  try {
    const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 7));
    const report = await oca.layers.hypothesis.diagnostics({ days });
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

ocaRouter.get('/oca/predictions/failures', async (req, res) => {
  try {
    const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 7));
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 25));
    const failures = await oca.layers.hypothesis.failures({ days, limit });
    res.json({ failures });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

ocaRouter.get('/oca/predictions/sla', async (req, res) => {
  try {
    const minutes = Math.max(5, Math.min(240, parseInt(req.query.minutes, 10) || 25));
    const { rows: [summary] } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending') as pending_total,
         COUNT(*) FILTER (
           WHERE status = 'pending'
             AND created_at < NOW() - ($1::int * INTERVAL '1 minute')
         ) as pending_out_of_sla,
         COUNT(*) FILTER (
           WHERE status = 'pending'
             AND prediction_deadline IS NOT NULL
             AND prediction_deadline < NOW()
         ) as pending_overdue_deadline
       FROM hypotheses`,
      [minutes]
    );
    res.json({
      window_minutes: minutes,
      pending_total: Number(summary?.pending_total || 0),
      pending_out_of_sla: Number(summary?.pending_out_of_sla || 0),
      pending_overdue_deadline: Number(summary?.pending_overdue_deadline || 0)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

ocaRouter.get('/oca/predictions/graveyard', async (req, res) => {
  try {
    const days = Math.max(1, Math.min(180, parseInt(req.query.days, 10) || 30));
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 50));
    const { rows } = await pool.query(
      `SELECT id, archived_at, hypothesis_id, replacement_hypothesis_id, domain,
              claim, prediction, confidence, status, archived_reason,
              builder_task_dispatched, revision_depth
       FROM hypothesis_graveyard
       WHERE archived_at > NOW() - ($1::int * INTERVAL '1 day')
       ORDER BY archived_at DESC
       LIMIT $2`,
      [days, limit]
    );
    res.json({ graveyard: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

ocaRouter.post('/oca/predictions/retest', async (req, res) => {
  try {
    const { hypothesisId, observed = null, description = null } = req.body || {};
    if (!hypothesisId) return res.status(400).json({ error: 'hypothesisId required' });

    let observedState = observed;
    let observedDescription = description;

    if (!observedState || typeof observedState !== 'object') {
      const perception = oca.sense();
      const visual = perception?.visual || {};
      const intero = perception?.interoceptive || {};
      const { rows: switches } = await pool.query(
        `SELECT COUNT(*) as cnt FROM episodic_memory
         WHERE event_type = 'cognitive_cycle'
           AND active_app != $1
           AND timestamp > NOW() - INTERVAL '15 minutes'`,
        [visual.frontApp || 'unknown']
      ).catch(() => ({ rows: [{ cnt: 0 }] }));

      observedState = {
        presence: 'unknown',
        front_app: visual.frontApp || 'unknown',
        battery_pct: Math.round((intero?.battery?.level || 0) * 100),
        charging: !!intero?.battery?.charging,
        cpu_raw: Number(intero?.cpu?.raw || intero?.cpu?.utilization || 0),
        memory_pressure_pct: Math.round((intero?.memory?.pressure || 0) * 100),
        typing_wpm: 0,
        idle_seconds: 0,
        hour: new Date().getHours(),
        thermal: intero?.thermal?.pressure || 'unknown',
        app_switches_15min: Number(switches[0]?.cnt || 0),
      };
    }

    if (!observedDescription) {
      observedDescription = `Manual retest snapshot: app=${observedState.front_app}, battery=${observedState.battery_pct}%`;
    }

    const result = await oca.layers.hypothesis.test(hypothesisId, {
      description: observedDescription,
      observed: observedState,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// DELIBERATION & DECISION
// ============================================================

// Run adversarial deliberation
ocaRouter.post('/oca/decide', async (req, res) => {
  try {
    const {
      decision,
      stakes = 'medium',
      context = '',
      forceReasoning = false,
      confidence = null,
      minConfidence = 0.55,
      timeBudgetSeconds = 45,
    } = req.body;
    if (!decision) return res.status(400).json({ error: 'decision required' });
    const result = await oca.decide(decision, {
      stakes,
      context,
      forceReasoning,
      confidence,
      minConfidence,
      timeBudgetSeconds,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Explicit structured reasoning controller
ocaRouter.post('/oca/reason', async (req, res) => {
  try {
    const {
      goal,
      context = '',
      stakes = 'medium',
      timeBudgetSeconds = 45,
      minConfidence = 0.55,
    } = req.body || {};
    if (!goal) return res.status(400).json({ error: 'goal required' });
    const result = await oca.reason(goal, { context, stakes, timeBudgetSeconds, minConfidence });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

ocaRouter.post('/oca/reason/evaluate', async (req, res) => {
  try {
    const {
      traceId,
      wasCorrect,
      errorStep = null,
      errorType = null,
      lesson = null,
    } = req.body || {};
    if (!traceId || typeof wasCorrect !== 'boolean') {
      return res.status(400).json({ error: 'traceId and wasCorrect (boolean) required' });
    }
    const result = await oca.layers.reasoningController.evaluate(traceId, {
      wasCorrect,
      errorStep,
      errorType,
      lesson
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// SIMULATION
// ============================================================

// Imagine / simulate forward
ocaRouter.post('/oca/imagine', async (req, res) => {
  try {
    const { description, state, actions, purpose = 'decision' } = req.body;
    if (!description) return res.status(400).json({ error: 'description required' });
    const result = await oca.imagine(description, state || {}, actions || [], { purpose });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Evaluate simulation against actual outcome
ocaRouter.post('/oca/simulate/evaluate', async (req, res) => {
  try {
    const { simulationId, actualOutcome } = req.body;
    if (!simulationId || !actualOutcome) {
      return res.status(400).json({ error: 'simulationId and actualOutcome required' });
    }
    const result = await oca.layers.simulation.evaluateSimulation(simulationId, actualOutcome);
    res.json(result || { error: 'simulation not found' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Evaluate counterfactual against observed outcome
ocaRouter.post('/oca/counterfactual/evaluate', async (req, res) => {
  try {
    const { counterfactualId, actualOutcome } = req.body;
    if (!counterfactualId || !actualOutcome) {
      return res.status(400).json({ error: 'counterfactualId and actualOutcome required' });
    }
    const result = await oca.layers.simulation.evaluateCounterfactual(counterfactualId, actualOutcome);
    res.json(result || { error: 'counterfactual not found' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Causal experiment lifecycle
ocaRouter.post('/oca/causal/experiment', async (req, res) => {
  try {
    const {
      causeType = 'freeform',
      causeId = null,
      causeDescription,
      intervention,
      expectedEffect = null,
      expectedMechanism = null,
      confidence = 0.5,
      hypothesisId = null,
      simulationId = null,
      episodeId = null,
      start = false,
      metadata = {},
    } = req.body || {};
    if (!causeDescription || !intervention) {
      return res.status(400).json({ error: 'causeDescription and intervention required' });
    }

    let created = await oca.layers.causal.designExperiment({
      causeType,
      causeId,
      causeDescription,
      intervention,
      expectedEffect,
      expectedMechanism,
      confidence,
      hypothesisId,
      simulationId,
      episodeId,
      metadata,
    });
    if (start && created?.id) {
      created = await oca.layers.causal.startExperiment(created.id);
    }
    res.json(created);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

ocaRouter.post('/oca/causal/experiment/:id/complete', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'valid experiment id required' });
    const {
      actualOutcome,
      outcomeValence = null,
      causalSupport = null,
      modelUpdate = null,
      status = 'completed',
      metadata = {},
    } = req.body || {};
    const result = await oca.layers.causal.completeExperiment(id, {
      actualOutcome,
      outcomeValence,
      causalSupport,
      modelUpdate,
      status,
      metadata,
    });
    res.json(result || { error: 'causal experiment not found' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// CREATIVE
// ============================================================

// Generate creative output
ocaRouter.post('/oca/create', async (req, res) => {
  try {
    const { method = 'connection' } = req.body;
    const result = await oca.create(method);
    res.json(result || { output: null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// METACOGNITION
// ============================================================

// Self-reflection
ocaRouter.get('/oca/reflect', async (req, res) => {
  try {
    const result = await oca.reflect();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// EXECUTIVE CONTROL
// ============================================================

// Goals
ocaRouter.get('/oca/goals', async (req, res) => {
  try {
    const goals = await oca.layers.executive.getActiveGoals();
    res.json(goals);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

ocaRouter.post('/oca/goals', async (req, res) => {
  try {
    const { description, goalType = 'session', priority = 0.5, parentGoal = null, deadline = null } = req.body;
    if (!description) return res.status(400).json({ error: 'description required' });
    const id = await oca.layers.executive.addGoal(description, { goalType, priority, parentGoal, deadline });
    res.json({ id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Working memory
ocaRouter.get('/oca/workspace', async (req, res) => {
  try {
    const items = await oca.layers.executive.getWorkspace();
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Body ownership
ocaRouter.get('/oca/body', (req, res) => {
  res.json({ mode: oca.layers.executive.getBodyOwnership() });
});

// ============================================================
// MOTOR CORTEX
// ============================================================

// Type text
ocaRouter.post('/oca/motor/type', async (req, res) => {
  try {
    const {
      text,
      speed = 'instant',
      app = null,
      expectedOutcome = null,
      expectedStructured = null,
      confidence = 0.5,
    } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    const plan = await motor.plan('type text', [{ type: 'keystroke' }]);
    if (!plan.allowed) return res.status(403).json(plan);
    await motor.type(text, { speed, app, expectedOutcome, expectedStructured, confidence });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Press key
ocaRouter.post('/oca/motor/press', async (req, res) => {
  try {
    const {
      key,
      modifiers = [],
      app = null,
      expectedOutcome = null,
      expectedStructured = null,
      confidence = 0.5,
    } = req.body;
    if (!key) return res.status(400).json({ error: 'key required' });
    await motor.press(key, modifiers, { app, expectedOutcome, expectedStructured, confidence });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Click
ocaRouter.post('/oca/motor/click', async (req, res) => {
  try {
    const {
      x,
      y,
      button = 'left',
      doubleClick = false,
      expectedOutcome = null,
      expectedStructured = null,
      confidence = 0.5,
    } = req.body;
    if (x == null || y == null) return res.status(400).json({ error: 'x and y required' });
    await motor.click(x, y, { button, doubleClick, expectedOutcome, expectedStructured, confidence });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Launch app
ocaRouter.post('/oca/motor/launch', async (req, res) => {
  try {
    const { app, expectedOutcome = null, expectedStructured = null, confidence = 0.5 } = req.body;
    if (!app) return res.status(400).json({ error: 'app required' });
    await motor.launchApp(app, { expectedOutcome, expectedStructured, confidence });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Show notification
ocaRouter.post('/oca/motor/notify', async (req, res) => {
  try {
    const { title, message, expectedOutcome = null, expectedStructured = null, confidence = 0.5 } = req.body;
    if (!title || !message) return res.status(400).json({ error: 'title and message required' });
    await motor.showNotification(title, message, { expectedOutcome, expectedStructured, confidence });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Set volume
ocaRouter.post('/oca/motor/volume', async (req, res) => {
  try {
    const { level, expectedOutcome = null, expectedStructured = null, confidence = 0.5 } = req.body;
    if (level == null) return res.status(400).json({ error: 'level required (0-100)' });
    await motor.setVolume(level, { expectedOutcome, expectedStructured, confidence });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Open URL
ocaRouter.post('/oca/motor/open', async (req, res) => {
  try {
    const { url, expectedOutcome = null, expectedStructured = null, confidence = 0.5 } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    await motor.openUrl(url, { expectedOutcome, expectedStructured, confidence });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// PROSPECTIVE MEMORY
// ============================================================

// Create an intention
ocaRouter.post('/oca/intend', async (req, res) => {
  try {
    const { intention, triggerType, triggerSpec, priority = 0.5, context = null, expiresAt = null } = req.body;
    if (!intention || !triggerType || !triggerSpec) return res.status(400).json({ error: 'intention, triggerType, triggerSpec required' });
    const result = await oca.layers.prospective.intend(intention, triggerType, triggerSpec, { priority, context, expiresAt });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get pending intentions
ocaRouter.get('/oca/intentions', async (req, res) => {
  try {
    const pending = await oca.layers.prospective.getPending();
    const triggered = await oca.layers.prospective.getTriggered();
    res.json({ pending, triggered });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Complete an intention
ocaRouter.post('/oca/intend/complete', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    await oca.layers.prospective.complete(id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// EVALUATION
// ============================================================

ocaRouter.get('/oca/crm', async (req, res) => {
  try {
    const crm = await import('./evaluation/chinese-room-meter.js');
    const result = await crm.default.compute();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

ocaRouter.post('/oca/benchmark/run', async (req, res) => {
  try {
    const { runSource = 'manual', notes = null, force = false } = req.body || {};
    const result = await benchmarkHarness.runBenchmark({ runSource, notes, force });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

ocaRouter.get('/oca/benchmark/history', async (req, res) => {
  try {
    const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 30));
    const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit, 10) || 90));
    const history = await benchmarkHarness.benchmarkHistory({ days, limit });
    res.json({ history });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// CONSOLIDATION
// ============================================================

// Trigger consolidation manually
ocaRouter.post('/oca/consolidate', async (req, res) => {
  try {
    const result = await oca.layers.consolidation.consolidate();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default ocaRouter;
