// OCA API Routes — mount into mind.js Express app
// These endpoints expose the cognitive architecture to OpenClaw and external systems
import { Router } from 'express';
import oca from './index.js';
import motor from './motor/engine.js';

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
    const { query, limit = 5, category = null } = req.body;
    if (!query) return res.status(400).json({ error: 'query required' });
    const results = await oca.know(query, { limit, category });
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Learn (store semantic knowledge)
ocaRouter.post('/oca/learn', async (req, res) => {
  try {
    const { concept, category = null, confidence = 0.5 } = req.body;
    if (!concept) return res.status(400).json({ error: 'concept required' });
    const result = await oca.learn(concept, category, confidence);
    res.json(result);
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

// ============================================================
// DELIBERATION & DECISION
// ============================================================

// Run adversarial deliberation
ocaRouter.post('/oca/decide', async (req, res) => {
  try {
    const { decision, stakes = 'medium', context = '' } = req.body;
    if (!decision) return res.status(400).json({ error: 'decision required' });
    const result = await oca.decide(decision, { stakes, context });
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
    const { text, speed = 'instant', app = null } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    const plan = await motor.plan('type text', [{ type: 'keystroke' }]);
    if (!plan.allowed) return res.status(403).json(plan);
    await motor.type(text, { speed, app });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Press key
ocaRouter.post('/oca/motor/press', async (req, res) => {
  try {
    const { key, modifiers = [], app = null } = req.body;
    if (!key) return res.status(400).json({ error: 'key required' });
    await motor.press(key, modifiers, { app });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Click
ocaRouter.post('/oca/motor/click', async (req, res) => {
  try {
    const { x, y, button = 'left', doubleClick = false } = req.body;
    if (x == null || y == null) return res.status(400).json({ error: 'x and y required' });
    await motor.click(x, y, { button, doubleClick });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Launch app
ocaRouter.post('/oca/motor/launch', async (req, res) => {
  try {
    const { app } = req.body;
    if (!app) return res.status(400).json({ error: 'app required' });
    await motor.launchApp(app);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Show notification
ocaRouter.post('/oca/motor/notify', async (req, res) => {
  try {
    const { title, message } = req.body;
    if (!title || !message) return res.status(400).json({ error: 'title and message required' });
    await motor.showNotification(title, message);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Set volume
ocaRouter.post('/oca/motor/volume', async (req, res) => {
  try {
    const { level } = req.body;
    if (level == null) return res.status(400).json({ error: 'level required (0-100)' });
    await motor.setVolume(level);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Open URL
ocaRouter.post('/oca/motor/open', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    await motor.openUrl(url);
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
