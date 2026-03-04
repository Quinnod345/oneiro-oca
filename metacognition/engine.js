// OCA Metacognition Engine
// Thinking about thinking — bias tracking, calibration, stuck detection
import { pool, emit } from '../event-bus.js';

// Detect if the system is stuck
export async function detectStuck() {
  const issues = [];
  
  // 1. Same content in working memory for too long
  const { rows: staleWM } = await pool.query(
    `SELECT content, entered_at FROM working_memory 
     WHERE is_active AND entered_at < NOW() - INTERVAL '10 minutes'`
  );
  if (staleWM.length > 3) {
    issues.push({
      type: 'stuck_state',
      severity: 0.7,
      description: `${staleWM.length} items in working memory for >10 minutes`,
      intervention: 'Clear stale working memory, force task switch'
    });
  }
  
  // 2. Hypotheses untested for too long
  const { rows: staleHyp } = await pool.query(
    `SELECT COUNT(*) as count FROM hypotheses 
     WHERE status = 'pending' AND created_at < NOW() - INTERVAL '2 hours'`
  );
  if (parseInt(staleHyp[0].count) > 5) {
    issues.push({
      type: 'stuck_state',
      severity: 0.5,
      description: `${staleHyp[0].count} hypotheses untested for >2 hours`,
      intervention: 'Test or expire stale hypotheses'
    });
  }
  
  // 3. Repetitive episodic content (perseveration)
  const { rows: recentEps } = await pool.query(
    `SELECT content FROM episodic_memory 
     WHERE timestamp > NOW() - INTERVAL '30 minutes'
     ORDER BY timestamp DESC LIMIT 20`
  );
  const contentSet = new Set();
  let duplicates = 0;
  for (const ep of recentEps) {
    const key = ep.content.slice(0, 100).toLowerCase();
    if (contentSet.has(key)) duplicates++;
    contentSet.add(key);
  }
  if (duplicates > 5) {
    issues.push({
      type: 'perseveration',
      severity: 0.8,
      description: `${duplicates} near-duplicate memories in last 30 minutes`,
      intervention: 'Detected perseveration — force topic change'
    });
  }
  
  // Log issues
  for (const issue of issues) {
    await pool.query(
      `INSERT INTO metacognitive_observations (target_layer, observation_type, description, evidence, severity, recommended_intervention)
       VALUES ('system', $1, $2, $3, $4, $5)`,
      [issue.type, issue.description, JSON.stringify({}), issue.severity, issue.intervention]
    );
  }
  
  if (issues.length > 0) {
    await emit('metacognition_alert', 'metacognition', { issues }, { priority: 0.8 });
  }
  
  return issues;
}

// Check calibration (am I overconfident or underconfident?)
export async function checkCalibration() {
  const { rows } = await pool.query('SELECT * FROM calibration_curve');
  
  const issues = [];
  for (const bucket of rows) {
    if (bucket.total < 5) continue; // not enough data
    const deviation = Math.abs(parseFloat(bucket.confidence_bucket) - parseFloat(bucket.actual_accuracy));
    if (deviation > 0.2) {
      const direction = parseFloat(bucket.actual_accuracy) < parseFloat(bucket.confidence_bucket) ? 'overconfident' : 'underconfident';
      issues.push({
        bucket: bucket.confidence_bucket,
        stated: bucket.confidence_bucket,
        actual: bucket.actual_accuracy,
        direction,
        deviation,
        count: bucket.total
      });
    }
  }
  
  if (issues.length > 0) {
    // Update bias tracking
    const biasType = issues[0].direction === 'overconfident' ? 'optimism_bias' : 'underconfidence';
    await pool.query(
      `UPDATE cognitive_biases SET 
         instance_count = instance_count + 1,
         current_severity = $1,
         recent_instances = jsonb_build_array($2::jsonb) || COALESCE(recent_instances, '[]'::jsonb)
       WHERE bias_type = $3`,
      [issues[0].deviation, JSON.stringify(issues[0]), biasType === 'optimism_bias' ? 'optimism_bias' : 'confirmation_bias']
    );
  }
  
  return { calibration: rows, issues };
}

// Track a bias instance
export async function recordBias(biasType, details) {
  await pool.query(
    `UPDATE cognitive_biases SET 
       instance_count = instance_count + 1,
       current_severity = LEAST(1.0, current_severity + 0.1),
       recent_instances = (jsonb_build_array($1::jsonb) || COALESCE(recent_instances, '[]'::jsonb))
     WHERE bias_type = $2`,
    [JSON.stringify({ ...details, timestamp: new Date().toISOString() }), biasType]
  );
}

// Store a reasoning trace for retrospective analysis
export async function traceReasoning(goal, steps, conclusion) {
  const { rows } = await pool.query(
    `INSERT INTO reasoning_traces (goal, steps, conclusion)
     VALUES ($1, $2, $3) RETURNING id`,
    [goal, JSON.stringify(steps), conclusion]
  );
  return rows[0].id;
}

// Evaluate a past reasoning trace
export async function evaluateTrace(traceId, wasCorrect, errorStep = null, errorType = null, lesson = null) {
  await pool.query(
    `UPDATE reasoning_traces SET 
       conclusion_correct = $1, evaluated_at = NOW(),
       error_step = $2, error_type = $3, lesson = $4
     WHERE id = $5`,
    [wasCorrect, errorStep, errorType, lesson, traceId]
  );
  
  if (!wasCorrect && lesson) {
    // Store lesson as semantic memory
    const semantic = await import('./semantic.js');
    await semantic.default.learn(lesson, { category: 'reasoning_lesson', sourceType: 'inference' });
  }
}

// Full metacognition cycle
export async function runCycle() {
  const stuck = await detectStuck();
  const calibration = await checkCalibration();
  
  // Check bias trends
  const { rows: biases } = await pool.query(
    `SELECT * FROM cognitive_biases WHERE current_severity > 0.3 ORDER BY current_severity DESC`
  );
  
  return {
    stuck_issues: stuck,
    calibration: calibration.issues,
    active_biases: biases.map(b => ({ type: b.bias_type, severity: b.current_severity, countermeasure: b.countermeasure })),
    healthy: stuck.length === 0 && calibration.issues.length === 0 && biases.length === 0
  };
}

export default { detectStuck, checkCalibration, recordBias, traceReasoning, evaluateTrace, runCycle };
