import { pool, emit } from '../../event-bus.js';
import motor from '../engine.js';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

const DEFAULT_DIFF_THRESHOLD = 0.1;
const GOLDEN_TABLE = 'build_regression_golden_outputs';
const RUN_TABLE = 'build_regression_runs';
const OCA_ROOT = process.env.OCA_ROOT || process.cwd();

async function ensureSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${GOLDEN_TABLE} (
        id SERIAL PRIMARY KEY,
        skill_name TEXT NOT NULL,
        version TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        input JSONB NOT NULL,
        output JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (skill_name, version, input_hash)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${RUN_TABLE} (
        id SERIAL PRIMARY KEY,
        skill_name TEXT NOT NULL,
        candidate_version TEXT NOT NULL,
        golden_version TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        golden_output JSONB,
        candidate_output JSONB,
        diff_score FLOAT,
        blocked BOOLEAN DEFAULT FALSE,
        threshold FLOAT,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${GOLDEN_TABLE}_skill ON ${GOLDEN_TABLE} (skill_name, version)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${RUN_TABLE}_skill ON ${RUN_TABLE} (skill_name, created_at DESC)`);
  } finally {
    client.release();
  }
}

function hashInput(input) {
  const str = JSON.stringify(input, Object.keys(input).sort());
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function computeDiffScore(golden, candidate) {
  if (golden === null && candidate === null) return 0;
  if (golden === null || candidate === null) return 1;

  const goldenStr = JSON.stringify(golden);
  const candidateStr = JSON.stringify(candidate);

  if (goldenStr === candidateStr) return 0;

  if (typeof golden !== typeof candidate) return 1;

  if (typeof golden === 'object' && !Array.isArray(golden)) {
    const allKeys = new Set([...Object.keys(golden), ...Object.keys(candidate)]);
    if (allKeys.size === 0) return 0;
    let totalDiff = 0;
    for (const key of allKeys) {
      if (!(key in golden) || !(key in candidate)) {
        totalDiff += 1;
      } else {
        totalDiff += computeDiffScore(golden[key], candidate[key]);
      }
    }
    return Math.min(1, totalDiff / allKeys.size);
  }

  if (Array.isArray(golden) && Array.isArray(candidate)) {
    const maxLen = Math.max(golden.length, candidate.length);
    if (maxLen === 0) return 0;
    let totalDiff = 0;
    for (let i = 0; i < maxLen; i++) {
      if (i >= golden.length || i >= candidate.length) {
        totalDiff += 1;
      } else {
        totalDiff += computeDiffScore(golden[i], candidate[i]);
      }
    }
    return Math.min(1, totalDiff / maxLen);
  }

  if (typeof golden === 'number' && typeof candidate === 'number') {
    const maxAbs = Math.max(Math.abs(golden), Math.abs(candidate));
    if (maxAbs === 0) return 0;
    return Math.min(1, Math.abs(golden - candidate) / maxAbs);
  }

  return goldenStr === candidateStr ? 0 : 1;
}

async function loadSkillModule(skillName) {
  const skillPath = path.resolve(OCA_ROOT, 'motor', 'skills', `${skillName}.js`);
  try {
    await fs.access(skillPath);
    const mod = await import(`${skillPath}?t=${Date.now()}`);
    return mod.default || mod;
  } catch (err) {
    throw new Error(`Failed to load skill module '${skillName}': ${err.message}`);
  }
}

async function getGoldenOutputs(skillName, version) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT input_hash, input, output FROM ${GOLDEN_TABLE} WHERE skill_name = $1 AND version = $2 ORDER BY created_at ASC`,
      [skillName, version]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

async function getLatestGoldenVersion(skillName) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT version FROM ${GOLDEN_TABLE} WHERE skill_name = $1 ORDER BY created_at DESC LIMIT 1`,
      [skillName]
    );
    return result.rows[0]?.version || null;
  } finally {
    client.release();
  }
}

async function saveGoldenOutput(skillName, version, input, output) {
  const inputHash = hashInput(input);
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO ${GOLDEN_TABLE} (skill_name, version, input_hash, input, output)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (skill_name, version, input_hash) DO UPDATE SET output = EXCLUDED.output`,
      [skillName, version, inputHash, JSON.stringify(input), JSON.stringify(output)]
    );
    return { skillName, version, inputHash };
  } finally {
    client.release();
  }
}

async function recordRun(runData) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO ${RUN_TABLE}
         (skill_name, candidate_version, golden_version, input_hash, golden_output, candidate_output, diff_score, blocked, threshold, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        runData.skillName,
        runData.candidateVersion,
        runData.goldenVersion,
        runData.inputHash,
        runData.goldenOutput !== undefined ? JSON.stringify(runData.goldenOutput) : null,
        runData.candidateOutput !== undefined ? JSON.stringify(runData.candidateOutput) : null,
        runData.diffScore !== undefined ? runData.diffScore : null,
        runData.blocked || false,
        runData.threshold,
        runData.error || null,
      ]
    );
    return result.rows[0].id;
  } finally {
    client.release();
  }
}

async function runCandidateAgainstInput(skillModule, functionName, input) {
  if (!skillModule || typeof skillModule[functionName] !== 'function') {
    throw new Error(`Function '${functionName}' not found on skill module`);
  }
  const args = Array.isArray(input) ? input : [input];
  return await skillModule[functionName](...args);
}

async function guard(event) {
  const {
    skill_name: skillName,
    candidate_version: candidateVersion,
    golden_version: goldenVersion,
    function_name: functionName = 'run',
    threshold = DEFAULT_DIFF_THRESHOLD,
  } = event || {};

  if (!skillName) {
    throw new Error('build:pre-deploy event missing skill_name');
  }
  if (!candidateVersion) {
    throw new Error('build:pre-deploy event missing candidate_version');
  }

  await ensureSchema();

  const resolvedGoldenVersion = goldenVersion || (await getLatestGoldenVersion(skillName));

  if (!resolvedGoldenVersion) {
    await emit('build:regression-clear', {
      skill_name: skillName,
      candidate_version: candidateVersion,
      reason: 'no_golden_baseline',
      timestamp: new Date().toISOString(),
    });
    return { blocked: false, reason: 'no_golden_baseline', skillName, candidateVersion };
  }

  const goldenOutputs = await getGoldenOutputs(skillName, resolvedGoldenVersion);

  if (goldenOutputs.length === 0) {
    await emit('build:regression-clear', {
      skill_name: skillName,
      candidate_version: candidateVersion,
      golden_version: resolvedGoldenVersion,
      reason: 'no_golden_outputs',
      timestamp: new Date().toISOString(),
    });
    return { blocked: false, reason: 'no_golden_outputs', skillName, candidateVersion };
  }

  let skillModule;
  try {
    skillModule = await loadSkillModule(skillName);
  } catch (err) {
    await emit('build:regression-blocked', {
      skill_name: skillName,
      candidate_version: candidateVersion,
      golden_version: resolvedGoldenVersion,
      reason: 'module_load_failure',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
    return { blocked: true, reason: 'module_load_failure', error: err.message, skillName, candidateVersion };
  }

  const results = [];
  let maxDiff = 0;
  let blocked = false;
  const violations = [];

  for (const golden of goldenOutputs) {
    const input = typeof golden.input === 'string' ? JSON.parse(golden.input) : golden.input;
    const goldenOutput = typeof golden.output === 'string' ? JSON.parse(golden.output) : golden.output;

    let candidateOutput = null;
    let runError = null;
    let diffScore = 1;

    try {
      candidateOutput = await runCandidateAgainstInput(skillModule, functionName, input);
      diffScore = computeDiffScore(goldenOutput, candidateOutput);
    } catch (err) {
      runError = err.message;
      diffScore = 1;
    }

    const isViolation = diffScore > threshold;
    if (isViolation) blocked = true;
    if (diffScore > maxDiff) maxDiff = diffScore;

    const runId = await recordRun({
      skillName,
      candidateVersion,
      goldenVersion: resolvedGoldenVersion,
      inputHash: golden.input_hash,
      goldenOutput,
      candidateOutput,
      diffScore,
      blocked: isViolation,
      threshold,
      error: runError,
    });

    const entry = {
      runId,
      inputHash: golden.input_hash,
      diffScore,
      threshold,
      blocked: isViolation,
      error: runError,
    };

    results.push(entry);
    if (isViolation) violations.push(entry);
  }

  const payload = {
    skill_name: skillName,
    candidate_version: candidateVersion,
    golden_version: resolvedGoldenVersion,
    function_name: functionName,
    threshold,
    max_diff_score: maxDiff,
    total_inputs: goldenOutputs.length,
    violations: violations.length,
    results,
    timestamp: new Date().toISOString(),
  };

  if (blocked) {
    await emit('build:regression-blocked', payload);
  } else {
    await emit('build:regression-clear', payload);
  }

  return {
    blocked,
    skillName,
    candidateVersion,
    goldenVersion: resolvedGoldenVersion,
    maxDiffScore: maxDiff,
    threshold,
    violations: violations.length,
    total: goldenOutputs.length,
    results,
  };
}

async function captureGolden(skillName, version, functionName = 'run', inputs = []) {
  await ensureSchema();

  const skillModule = await loadSkillModule(skillName);
  const captured = [];

  for (const input of inputs) {
    try {
      const output = await runCandidateAgainstInput(skillModule, functionName, input);
      const record = await saveGoldenOutput(skillName, version, input, output);
      captured.push({ ...record, success: true });
    } catch (err) {
      captured.push({
        skillName,
        version,
        inputHash: hashInput(input),
        success: false,
        error: err.message,
      });
    }
  }

  await emit('build:regression-golden-captured', {
    skill_name: skillName,
    version,
    function_name: functionName,
    captured_count: captured.filter(c => c.success).length,
    failed_count: captured.filter(c => !c.success).length,
    timestamp: new Date().toISOString(),
  });

  return captured;
}

async function handlePreDeployEvent(event) {
  return await guard(event);
}

async function getRecentRuns(skillName, limit = 20) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM ${RUN_TABLE} WHERE skill_name = $1 ORDER BY created_at DESC LIMIT $2`,
      [skillName, limit]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

async function getGoldenVersions(skillName) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT version, COUNT(*) AS input_count, MAX(created_at) AS captured_at
       FROM ${GOLDEN_TABLE} WHERE skill_name = $1
       GROUP BY version ORDER BY captured_at DESC`,
      [skillName]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

async function deleteGoldenVersion(skillName, version) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `DELETE FROM ${GOLDEN_TABLE} WHERE skill_name = $1 AND version = $2`,
      [skillName, version]
    );
    return { deleted: result.rowCount };
  } finally {
    client.release();
  }
}

async function getStats(skillName) {
  const client = await pool.connect();
  try {
    const runs = await client.query(
      `SELECT
         COUNT(*) AS total_runs,
         SUM(CASE WHEN blocked THEN 1 ELSE 0 END) AS total_blocked,
         AVG(diff_score) AS avg_diff_score,
         MAX(diff_score) AS max_diff_score,
         MIN(diff_score) AS min_diff_score
       FROM ${RUN_TABLE} WHERE skill_name = $1`,
      [skillName]
    );
    const goldens = await client.query(
      `SELECT COUNT(*) AS golden_count, COUNT(DISTINCT version) AS version_count
       FROM ${GOLDEN_TABLE} WHERE skill_name = $1`,
      [skillName]
    );
    return {
      skillName,
      ...runs.rows[0],
      ...goldens.rows[0],
    };
  } finally {
    client.release();
  }
}

export default {
  guard,
  handlePreDeployEvent,
  captureGolden,
  saveGoldenOutput,
  getGoldenOutputs,
  getGoldenVersions,
  getLatestGoldenVersion,
  deleteGoldenVersion,
  getRecentRuns,
  getStats,
  ensureSchema,
  computeDiffScore,
  hashInput,
};