// Autonomic Self-Modification Layer
// Watches OCA performance metrics over time, proposes code changes to improve itself,
// tests them in a sandbox, and promotes winners to production.
//
// This is the difference between a system that HAS numbers and one that GROWS from them.

import { pool, emit } from '../event-bus.js';
import llm from '../llm.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OCA_ROOT = join(__dirname, '..');
const SANDBOX_DIR = join(__dirname, 'sandbox');
const PROPOSALS_DIR = join(__dirname, 'proposals');
const MAX_PROPOSALS_PER_CYCLE = 2;
const MIN_OBSERVATION_WINDOW_HOURS = 2;
const PROPOSAL_COOLDOWN_CYCLES = 100; // ~15 min at 10s cycles

// Ensure directories exist
mkdirSync(SANDBOX_DIR, { recursive: true });
mkdirSync(PROPOSALS_DIR, { recursive: true });

// ═══════════════════════════════════════════════════
// METRIC COLLECTION — what am I measuring about myself?
// ═══════════════════════════════════════════════════

async function collectPerformanceMetrics() {
  const metrics = {};

  // Hypothesis calibration — am I getting better at predicting?
  try {
    const { rows } = await pool.query(`
      SELECT 
        confidence_bucket,
        total::int,
        correct::int,
        actual_accuracy::float
      FROM calibration_curve
      WHERE total::int >= 5
    `);
    const totalPredictions = rows.reduce((s, r) => s + r.total, 0);
    const totalCorrect = rows.reduce((s, r) => s + r.correct, 0);
    const avgDeviation = rows.reduce((s, r) => 
      s + Math.abs(parseFloat(r.confidence_bucket) - r.actual_accuracy), 0) / (rows.length || 1);
    
    metrics.hypothesis = {
      totalPredictions,
      totalCorrect,
      overallAccuracy: totalPredictions > 0 ? totalCorrect / totalPredictions : 0,
      avgCalibrationDeviation: avgDeviation,
      buckets: rows,
    };
  } catch (e) {
    metrics.hypothesis = { error: e.message };
  }

  // Working memory utilization
  try {
    const { rows } = await pool.query(`
      SELECT COUNT(*) as active, 
             AVG(salience) as avg_salience,
             MIN(salience) as min_salience
      FROM working_memory WHERE is_active
    `);
    metrics.workingMemory = {
      activeItems: parseInt(rows[0].active),
      avgSalience: parseFloat(rows[0].avg_salience) || 0,
      minSalience: parseFloat(rows[0].min_salience) || 0,
    };
  } catch (e) {
    metrics.workingMemory = { error: e.message };
  }

  // Emotional stability — am I thrashing?
  try {
    const { rows } = await pool.query(`
      SELECT 
        STDDEV(valence) as valence_std,
        STDDEV(arousal) as arousal_std,
        AVG(valence) as valence_mean,
        AVG(arousal) as arousal_mean,
        COUNT(*) as samples
      FROM emotional_states 
      WHERE timestamp > NOW() - INTERVAL '6 hours'
    `);
    metrics.emotional = {
      valenceStd: parseFloat(rows[0].valence_std) || 0,
      arousalStd: parseFloat(rows[0].arousal_std) || 0,
      valenceMean: parseFloat(rows[0].valence_mean) || 0,
      arousalMean: parseFloat(rows[0].arousal_mean) || 0,
      samples: parseInt(rows[0].samples),
    };
  } catch (e) {
    metrics.emotional = { error: e.message };
  }

  // Metacognitive health
  try {
    const { rows } = await pool.query(`
      SELECT observation_type, COUNT(*) as count, AVG(severity) as avg_severity
      FROM metacognitive_observations 
      WHERE timestamp > NOW() - INTERVAL '24 hours'
      GROUP BY observation_type
    `);
    metrics.metacognition = {
      observations: rows.map(r => ({
        type: r.observation_type,
        count: parseInt(r.count),
        avgSeverity: parseFloat(r.avg_severity),
      })),
    };
  } catch (e) {
    metrics.metacognition = { error: e.message };
  }

  // Neural connection health
  try {
    const { rows } = await pool.query(`
      SELECT COUNT(*) as total,
             AVG(strength) as avg_weight,
             COUNT(*) FILTER (WHERE strength > 0.5) as strong
      FROM neural_connections
    `);
    metrics.neural = {
      totalConnections: parseInt(rows[0].total),
      avgWeight: parseFloat(rows[0].avg_weight) || 0,
      strongConnections: parseInt(rows[0].strong),
    };
  } catch (e) {
    metrics.neural = { error: e.message };
  }

  // Consolidation effectiveness
  try {
    const { rows } = await pool.query(`
      SELECT COUNT(*) as total FROM semantic_memory
    `);
    const { rows: recent } = await pool.query(`
      SELECT COUNT(*) as recent FROM semantic_memory 
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);
    metrics.consolidation = {
      totalConcepts: parseInt(rows[0].total),
      recentConcepts: parseInt(recent[0].recent),
    };
  } catch (e) {
    metrics.consolidation = { error: e.message };
  }

  // Dream execution success rate
  try {
    const { rows } = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE success) as successful
      FROM self_builds
      WHERE built_at > NOW() - INTERVAL '7 days'
    `);
    metrics.dreamExecution = {
      total: parseInt(rows[0].total),
      successful: parseInt(rows[0].successful),
      successRate: parseInt(rows[0].total) > 0 
        ? parseInt(rows[0].successful) / parseInt(rows[0].total) : 0,
    };
  } catch (e) {
    metrics.dreamExecution = { error: e.message };
  }

  // Cycle performance
  try {
    const { rows } = await pool.query(`
      WITH cycle_gaps AS (
        SELECT timestamp, 
               EXTRACT(EPOCH FROM (timestamp - LAG(timestamp) OVER (ORDER BY timestamp))) as gap_seconds
        FROM episodic_memory 
        WHERE event_type = 'cognitive_cycle' 
          AND timestamp > NOW() - INTERVAL '1 hour'
      )
      SELECT COUNT(*) as cycles, AVG(gap_seconds) as avg_cycle_seconds
      FROM cycle_gaps
    `);
    metrics.cycles = {
      lastHour: parseInt(rows[0].cycles),
      avgCycleSeconds: parseFloat(rows[0].avg_cycle_seconds) || 0,
    };
  } catch (e) {
    metrics.cycles = { error: e.message };
  }

  return metrics;
}

// ═══════════════════════════════════════════════════
// TREND ANALYSIS — am I improving or degrading?
// ═══════════════════════════════════════════════════

async function analyzeTrends() {
  // Store current metrics snapshot
  const metrics = await collectPerformanceMetrics();
  const now = new Date().toISOString();
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS performance_snapshots (
      id SERIAL PRIMARY KEY,
      timestamp TIMESTAMPTZ DEFAULT NOW(),
      metrics JSONB NOT NULL
    )
  `);
  
  await pool.query(
    `INSERT INTO performance_snapshots (metrics) VALUES ($1)`,
    [JSON.stringify(metrics)]
  );

  // Get historical snapshots for comparison
  const { rows: history } = await pool.query(`
    SELECT metrics, timestamp 
    FROM performance_snapshots 
    ORDER BY timestamp DESC 
    LIMIT 20
  `);

  if (history.length < 3) {
    return { metrics, trends: null, reason: 'insufficient history' };
  }

  // Compute trends
  const trends = {};
  
  // Calibration trend
  const calDevs = history
    .map(h => h.metrics?.hypothesis?.avgCalibrationDeviation)
    .filter(v => Number.isFinite(v));
  if (calDevs.length >= 3) {
    const recent = calDevs.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
    const older = calDevs.slice(-3).reduce((a, b) => a + b, 0) / 3;
    trends.calibration = {
      direction: recent < older ? 'improving' : recent > older ? 'degrading' : 'stable',
      recentAvg: recent,
      olderAvg: older,
      delta: older - recent, // positive = improvement
    };
  }

  // Emotional stability trend
  const valStds = history
    .map(h => h.metrics?.emotional?.valenceStd)
    .filter(v => Number.isFinite(v));
  if (valStds.length >= 3) {
    const recent = valStds.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
    const older = valStds.slice(-3).reduce((a, b) => a + b, 0) / 3;
    trends.emotionalStability = {
      direction: recent < older ? 'stabilizing' : recent > older ? 'destabilizing' : 'stable',
      recentStd: recent,
      olderStd: older,
    };
  }

  // Neural growth trend
  const neuralCounts = history
    .map(h => h.metrics?.neural?.totalConnections)
    .filter(v => Number.isFinite(v));
  if (neuralCounts.length >= 3) {
    const recent = neuralCounts[0];
    const older = neuralCounts[neuralCounts.length - 1];
    trends.neuralGrowth = {
      direction: recent > older ? 'growing' : recent < older ? 'shrinking' : 'stable',
      current: recent,
      previous: older,
      rate: (recent - older) / neuralCounts.length,
    };
  }

  // Dream execution trend
  const dreamRates = history
    .map(h => h.metrics?.dreamExecution?.successRate)
    .filter(v => Number.isFinite(v));
  if (dreamRates.length >= 3) {
    const recent = dreamRates.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
    const older = dreamRates.slice(-3).reduce((a, b) => a + b, 0) / 3;
    trends.dreamExecution = {
      direction: recent > older ? 'improving' : recent < older ? 'degrading' : 'stable',
      recentRate: recent,
      olderRate: older,
    };
  }

  return { metrics, trends };
}

// ═══════════════════════════════════════════════════
// PROPOSAL GENERATION — what should I change about myself?
// ═══════════════════════════════════════════════════

async function generateProposals(metrics, trends) {
  if (!trends) return [];

  // Identify problems worth solving
  const problems = [];

  // Overconfident predictions — the biggest known issue
  if (metrics.hypothesis?.avgCalibrationDeviation > 0.25) {
    problems.push({
      area: 'hypothesis',
      problem: `Systematic overconfidence: avg calibration deviation is ${metrics.hypothesis.avgCalibrationDeviation.toFixed(3)} (target < 0.15)`,
      severity: metrics.hypothesis.avgCalibrationDeviation,
      targetFile: 'hypothesis/engine.js',
    });
  }

  // Working memory saturation
  if (metrics.workingMemory?.activeItems >= 7) {
    problems.push({
      area: 'executive',
      problem: `Working memory saturated at ${metrics.workingMemory.activeItems}/7 — salience decay may be too slow`,
      severity: 0.6,
      targetFile: 'executive/engine.js',
    });
  }

  // Emotional flatness or thrashing
  if (metrics.emotional?.valenceStd > 0.3) {
    problems.push({
      area: 'emotion',
      problem: `High emotional volatility: valence std=${metrics.emotional.valenceStd.toFixed(3)}`,
      severity: metrics.emotional.valenceStd,
      targetFile: 'emotion/engine.js',
    });
  } else if (metrics.emotional?.valenceStd < 0.02 && metrics.emotional?.samples > 10) {
    problems.push({
      area: 'emotion',
      problem: `Emotional flatness: valence std=${metrics.emotional.valenceStd.toFixed(3)} — may not be responding to stimuli`,
      severity: 0.5,
      targetFile: 'emotion/engine.js',
    });
  }

  // Neural stagnation
  if (trends.neuralGrowth?.direction === 'shrinking') {
    problems.push({
      area: 'neural',
      problem: `Neural connections shrinking: ${trends.neuralGrowth.current} → ${trends.neuralGrowth.previous}`,
      severity: 0.5,
      targetFile: 'neural-connections.js',
    });
  }

  // Low dream execution success
  if (metrics.dreamExecution?.total > 3 && metrics.dreamExecution?.successRate < 0.3) {
    problems.push({
      area: 'executive',
      problem: `Dream execution success rate only ${(metrics.dreamExecution.successRate * 100).toFixed(0)}%`,
      severity: 0.7,
      targetFile: 'executive/dream-executor.js',
    });
  }

  if (problems.length === 0) return [];

  // Sort by severity, take top problems
  problems.sort((a, b) => b.severity - a.severity);
  const topProblems = problems.slice(0, MAX_PROPOSALS_PER_CYCLE);

  const proposals = [];
  for (const problem of topProblems) {
    try {
      const proposal = await generateSingleProposal(problem, metrics, trends);
      if (proposal) proposals.push(proposal);
    } catch (e) {
      console.error(`[autonomic] proposal generation failed for ${problem.area}: ${e.message}`);
    }
  }

  return proposals;
}

async function generateSingleProposal(problem, metrics, trends) {
  // Read the target file
  const targetPath = join(OCA_ROOT, problem.targetFile);
  if (!existsSync(targetPath)) return null;
  
  const currentCode = readFileSync(targetPath, 'utf8');
  
  // Don't try to modify files > 500 lines — too risky
  const lineCount = currentCode.split('\n').length;
  if (lineCount > 500) {
    // For large files, only read relevant sections
    // This is a safety measure
  }

  // Get recent modification history
  const { rows: recentMods } = await pool.query(`
    SELECT proposal_id, target_file, status, result_summary
    FROM self_modification_log 
    WHERE target_file = $1 
    ORDER BY created_at DESC LIMIT 5
  `, [problem.targetFile]).catch(() => ({ rows: [] }));

  const response = await llm.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: `You are the autonomic self-modification layer of Oneiro, a cognitive architecture.
You're analyzing a performance problem and proposing a TARGETED code change.

Rules:
1. Propose SMALL, surgical changes — one function, one constant, one algorithm adjustment.
2. Never rewrite entire files. Never change imports or exports.
3. Every change must be testable — include a concrete metric that should improve.
4. Prefer parameter tuning over structural changes.
5. Include the EXACT old code and new code (for find-and-replace).
6. If the problem can't be fixed with a small code change, say so.

Respond with JSON:
{
  "viable": true/false,
  "reason": "why this change should help",
  "risk": "low|medium|high",
  "old_code": "exact code to find",
  "new_code": "replacement code",
  "success_metric": "what to measure",
  "success_threshold": "target value",
  "rollback_safe": true/false
}`,
    messages: [{
      role: 'user',
      content: `Problem: ${problem.problem}
Severity: ${problem.severity}
Target file: ${problem.targetFile} (${lineCount} lines)

Current metrics:
${JSON.stringify(metrics, null, 2)}

Trends:
${JSON.stringify(trends, null, 2)}

Recent modifications to this file:
${recentMods.map(m => `${m.status}: ${m.result_summary || 'no summary'}`).join('\n') || 'none'}

Relevant code (first 200 lines):
\`\`\`javascript
${currentCode.split('\n').slice(0, 200).join('\n')}
\`\`\``
    }],
    temperature: 0.3,
  });

  const text = response.content?.[0]?.text || '';
  try {
    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const proposal = JSON.parse(jsonMatch[0]);
    
    if (!proposal.viable) {
      console.log(`[autonomic] proposal not viable for ${problem.area}: ${proposal.reason}`);
      return null;
    }
    if (proposal.risk === 'high') {
      console.log(`[autonomic] skipping high-risk proposal for ${problem.area}`);
      return null;
    }
    if (!proposal.old_code || !proposal.new_code) return null;

    return {
      ...proposal,
      problem,
      targetFile: problem.targetFile,
      targetPath,
      proposedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error(`[autonomic] failed to parse proposal: ${e.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════
// SANDBOXED TESTING — verify before applying
// ═══════════════════════════════════════════════════

async function testProposal(proposal) {
  const { targetPath, old_code, new_code, targetFile } = proposal;
  
  // Verify old_code exists in target
  const currentCode = readFileSync(targetPath, 'utf8');
  if (!currentCode.includes(old_code)) {
    return { passed: false, reason: 'old_code not found in target file — code may have changed' };
  }

  // Create backup
  const backupPath = join(SANDBOX_DIR, `${targetFile.replace(/\//g, '_')}.backup.${Date.now()}`);
  copyFileSync(targetPath, backupPath);

  // Syntax check the proposed change
  const modifiedCode = currentCode.replace(old_code, new_code);
  const syntaxCheckPath = join(SANDBOX_DIR, 'syntax-check.mjs');
  writeFileSync(syntaxCheckPath, modifiedCode, 'utf8');
  
  try {
    execSync(`node --check "${syntaxCheckPath}"`, { timeout: 5000, stdio: 'pipe' });
  } catch (e) {
    return { passed: false, reason: `Syntax error: ${e.stderr?.toString().slice(0, 200)}`, backupPath };
  }

  return { passed: true, backupPath, modifiedCode };
}

// ═══════════════════════════════════════════════════
// APPLICATION — apply tested proposals
// ═══════════════════════════════════════════════════

async function applyProposal(proposal, testResult) {
  if (!testResult.passed) return { applied: false, reason: testResult.reason };

  const { targetPath, targetFile, old_code, new_code, success_metric, success_threshold, reason } = proposal;
  
  // Ensure log table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS self_modification_log (
      id SERIAL PRIMARY KEY,
      proposal_id TEXT UNIQUE,
      target_file TEXT NOT NULL,
      change_description TEXT,
      old_code TEXT,
      new_code TEXT,
      success_metric TEXT,
      success_threshold TEXT,
      status TEXT DEFAULT 'applied',
      result_summary TEXT,
      backup_path TEXT,
      applied_at TIMESTAMPTZ DEFAULT NOW(),
      evaluated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const proposalId = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  // Apply the change
  const currentCode = readFileSync(targetPath, 'utf8');
  const newCode = currentCode.replace(old_code, new_code);
  writeFileSync(targetPath, newCode, 'utf8');

  // Log the modification
  await pool.query(`
    INSERT INTO self_modification_log 
      (proposal_id, target_file, change_description, old_code, new_code, 
       success_metric, success_threshold, status, backup_path)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'applied', $8)
  `, [
    proposalId, targetFile, reason, old_code, new_code,
    success_metric, success_threshold, testResult.backupPath
  ]);

  console.log(`[autonomic] ✅ applied modification to ${targetFile}: ${reason}`);
  
  await emit('self_modification', 'autonomic', {
    proposalId, targetFile, reason, status: 'applied'
  });

  return { applied: true, proposalId };
}

// ═══════════════════════════════════════════════════
// EVALUATION — did the change actually help?
// ═══════════════════════════════════════════════════

async function evaluateRecentModifications() {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM self_modification_log 
      WHERE status = 'applied' 
        AND applied_at < NOW() - INTERVAL '${MIN_OBSERVATION_WINDOW_HOURS} hours'
        AND evaluated_at IS NULL
      ORDER BY applied_at ASC 
      LIMIT 3
    `);

    for (const mod of rows) {
      const currentMetrics = await collectPerformanceMetrics();
      
      // Simple evaluation: check if the target metric improved
      let improved = false;
      let summary = '';
      
      if (mod.success_metric?.includes('calibration')) {
        const dev = currentMetrics.hypothesis?.avgCalibrationDeviation;
        improved = dev !== undefined && dev < parseFloat(mod.success_threshold || 0.25);
        summary = `calibration deviation: ${dev?.toFixed(3) || 'n/a'} (target: <${mod.success_threshold})`;
      } else if (mod.success_metric?.includes('working_memory') || mod.success_metric?.includes('salience')) {
        const active = currentMetrics.workingMemory?.activeItems;
        improved = active !== undefined && active < 7;
        summary = `working memory items: ${active} (target: <7)`;
      } else if (mod.success_metric?.includes('valence') || mod.success_metric?.includes('emotion')) {
        const std = currentMetrics.emotional?.valenceStd;
        improved = std !== undefined && std > 0.02 && std < 0.3;
        summary = `valence std: ${std?.toFixed(3) || 'n/a'} (target: 0.02-0.3)`;
      } else {
        summary = 'no automated evaluation available';
        improved = null; // unknown
      }

      const status = improved === true ? 'confirmed' : improved === false ? 'reverted' : 'inconclusive';
      
      await pool.query(`
        UPDATE self_modification_log 
        SET status = $1, result_summary = $2, evaluated_at = NOW()
        WHERE id = $3
      `, [status, summary, mod.id]);

      // Rollback if it made things worse
      if (improved === false && mod.backup_path && existsSync(mod.backup_path)) {
        console.log(`[autonomic] ⏪ reverting ${mod.target_file} — change didn't help: ${summary}`);
        const targetPath = join(OCA_ROOT, mod.target_file);
        copyFileSync(mod.backup_path, targetPath);
        await pool.query(
          `UPDATE self_modification_log SET status = 'reverted' WHERE id = $1`,
          [mod.id]
        );
        await emit('self_modification', 'autonomic', {
          proposalId: mod.proposal_id, status: 'reverted', reason: summary
        });
      } else if (improved === true) {
        console.log(`[autonomic] 🎉 confirmed improvement in ${mod.target_file}: ${summary}`);
        await emit('self_modification', 'autonomic', {
          proposalId: mod.proposal_id, status: 'confirmed', result: summary
        });
      }
    }
  } catch (e) {
    console.error(`[autonomic] evaluation error: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════
// WEB RESEARCH — learn from the outside world
// ═══════════════════════════════════════════════════

async function researchTechniques(problem) {
  // Use web search to find relevant techniques
  // This runs through the OpenClaw agent bridge
  try {
    const query = `cognitive architecture ${problem.area} optimization technique ${problem.problem.slice(0, 50)}`;
    
    // Store research intent for the builder mind to pick up
    await pool.query(`
      CREATE TABLE IF NOT EXISTS research_queue (
        id SERIAL PRIMARY KEY,
        query TEXT NOT NULL,
        problem_area TEXT,
        status TEXT DEFAULT 'pending',
        results JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    await pool.query(
      `INSERT INTO research_queue (query, problem_area) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [query, problem.area]
    );
    
    return { queued: true, query };
  } catch (e) {
    return { queued: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════
// MAIN CYCLE — called from cognitive-loop.js
// ═══════════════════════════════════════════════════

export async function runAutonomicCycle() {
  const t0 = Date.now();
  
  try {
    // 1. Analyze current state and trends
    const { metrics, trends, reason } = await analyzeTrends();
    
    if (!trends) {
      console.log(`[autonomic] 📊 metrics collected, ${reason}`);
      return { phase: 'collecting', metrics };
    }

    // 2. Evaluate any pending modifications first
    await evaluateRecentModifications();

    // 3. Check if any problems warrant intervention
    const proposals = await generateProposals(metrics, trends);
    
    if (proposals.length === 0) {
      console.log(`[autonomic] 📊 no interventions needed (cal_dev=${metrics.hypothesis?.avgCalibrationDeviation?.toFixed(3) || 'n/a'})`);
      return { phase: 'monitoring', metrics, trends };
    }

    // 4. Test and apply proposals
    let applied = 0;
    for (const proposal of proposals) {
      const testResult = await testProposal(proposal);
      if (testResult.passed) {
        const applyResult = await applyProposal(proposal, testResult);
        if (applyResult.applied) applied++;
      } else {
        console.log(`[autonomic] ❌ proposal failed testing: ${testResult.reason}`);
      }
    }

    const elapsed = Date.now() - t0;
    console.log(`[autonomic] 🧬 cycle complete: ${applied}/${proposals.length} proposals applied (${elapsed}ms)`);
    
    return { phase: 'active', metrics, trends, proposals: proposals.length, applied };
  } catch (e) {
    console.error(`[autonomic] cycle error: ${e.message}`);
    return { phase: 'error', error: e.message };
  }
}

// Get modification history
export async function getModificationHistory(limit = 10) {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM self_modification_log 
      ORDER BY created_at DESC 
      LIMIT $1
    `, [limit]);
    return rows;
  } catch {
    return [];
  }
}

// Get current performance snapshot
export { collectPerformanceMetrics, analyzeTrends };

export default { 
  runAutonomicCycle, 
  collectPerformanceMetrics, 
  analyzeTrends, 
  getModificationHistory 
};
