// OCA Runtime Self-Patch
// Listens for skill:error events, reads the failing skill, constructs diagnostic context,
// calls Claude to produce a corrected version, writes the patch, re-registers, emits build:outcome

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import Anthropic from '@anthropic-ai/sdk';
import { pool, emit, on } from '../../event-bus.js';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = __dirname;
const INDEX_PATH = path.join(SKILLS_DIR, 'index.js');
const client = new Anthropic();

let unsubSkillError = null;
let active = false;
const patchingNow = new Set();

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS skill_patch_log (
      id SERIAL PRIMARY KEY,
      patched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      skill_name TEXT NOT NULL,
      error_message TEXT,
      error_stack TEXT,
      patch_status TEXT NOT NULL DEFAULT 'pending',
      claude_model TEXT,
      patch_applied_at TIMESTAMPTZ,
      failure_reason TEXT
    )
  `);
}

function skillNameFromPath(filePath) {
  return path.basename(filePath, '.js');
}

function toCamelCase(kebab) {
  return kebab.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function skillFilePath(skillName) {
  const clean = skillName.replace(/\.js$/, '');
  return path.join(SKILLS_DIR, `${clean}.js`);
}

async function readSkillSource(skillName) {
  const fp = skillFilePath(skillName);
  if (!existsSync(fp)) return null;
  return readFile(fp, 'utf8');
}

async function callClaude(diagnosticContext) {
  const systemPrompt = `You are an expert JavaScript developer working on the Oneiro Cognitive Architecture (OCA).
OCA runs on Node.js with ES modules (import/import syntax). Motor skills export a default object with public methods.
Your task: given a failing skill's source code and its error, produce a corrected, complete version of the file.
Rules:
- Output ONLY the raw JavaScript file content. No markdown fences. No explanation.
- Preserve the original skill's purpose and public API.
- Fix the root cause of the error shown in the diagnostic.
- Use proper ES module syntax (import/export).
- Motor engine: import motor from '../engine.js'
- Event bus: import { pool, emit, on } from '../../event-bus.js'
- Export a default object with all public functions.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: diagnosticContext,
      },
    ],
  });

  let code = response.content[0].text.trim();
  // Strip any accidental markdown fences
  code = code.replace(/^```(?:javascript|js)?\n?/i, '').replace(/\n?```\s*$/i, '');
  return code;
}

async function verifySyntax(filePath) {
  try {
    await execAsync(`node --input-type=module --eval "import('${filePath.replace(/'/g, "\\'")}').then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)})"`, {
      timeout: 10000,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.stderr || err.message };
  }
}

async function reRegisterSkill(skillName) {
  const camel = toCamelCase(skillName);
  const exportLine = `export { default as ${camel} } from './${skillName}.js';`;

  const indexSrc = await readFile(INDEX_PATH, 'utf8');
  if (indexSrc.includes(exportLine)) return; // already registered

  const lines = indexSrc.split('\n');
  // Insert after last export line
  let lastExportIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().startsWith('export')) {
      lastExportIdx = i;
      break;
    }
  }

  if (lastExportIdx >= 0) {
    lines.splice(lastExportIdx + 1, 0, exportLine);
  } else {
    lines.push(exportLine);
  }

  await writeFile(INDEX_PATH, lines.join('\n'), 'utf8');
}

async function patchSkill(skillName, errorMessage, errorStack) {
  if (patchingNow.has(skillName)) {
    console.log(`[runtime-self-patch] Already patching "${skillName}", skipping duplicate`);
    return;
  }
  patchingNow.add(skillName);

  const { rows } = await pool.query(
    `INSERT INTO skill_patch_log (skill_name, error_message, error_stack, patch_status)
     VALUES ($1, $2, $3, 'pending') RETURNING id`,
    [skillName, errorMessage, errorStack || null]
  );
  const logId = rows[0].id;

  let patchStatus = 'failed';
  let failureReason = null;

  try {
    const skillSource = await readSkillSource(skillName);
    if (!skillSource) {
      throw new Error(`Skill file not found: ${skillName}.js`);
    }

    const diagnosticContext = [
      `Skill name: ${skillName}`,
      `File: motor/skills/${skillName}.js`,
      '',
      '=== ERROR ===',
      errorMessage || '(no error message)',
      '',
      errorStack ? `=== STACK TRACE ===\n${errorStack}\n` : '',
      '=== CURRENT SOURCE ===',
      skillSource,
      '',
      'Produce a corrected, complete version of this skill file that fixes the error above.',
    ].join('\n');

    console.log(`[runtime-self-patch] Calling Claude for "${skillName}" patch...`);
    const correctedCode = await callClaude(diagnosticContext);

    const fp = skillFilePath(skillName);
    // Write to a temp path first, verify, then replace
    const tmpPath = fp + '.patch.tmp';
    await writeFile(tmpPath, correctedCode, 'utf8');

    const { ok, error: syntaxError } = await verifySyntax(tmpPath);
    if (!ok) {
      // Remove bad temp file
      try { execSync(`rm -f "${tmpPath}"`); } catch (_) {}
      throw new Error(`Patched code failed syntax check: ${syntaxError}`);
    }

    // Overwrite the original
    await writeFile(fp, correctedCode, 'utf8');
    try { execSync(`rm -f "${tmpPath}"`); } catch (_) {}

    // Re-register in index.js
    await reRegisterSkill(skillName);

    patchStatus = 'patched';
    console.log(`[runtime-self-patch] Patched "${skillName}" successfully`);

    await pool.query(
      `UPDATE skill_patch_log SET patch_status = $1, patch_applied_at = NOW(), claude_model = $2 WHERE id = $3`,
      [patchStatus, 'claude-sonnet-4-6', logId]
    );

    await emit('build:outcome', 'motor/runtime-self-patch', {
      skillName,
      status: 'patched',
      logId,
      errorMessage,
    }, { priority: 0.8 });

  } catch (err) {
    failureReason = err.message;
    console.error(`[runtime-self-patch] Failed to patch "${skillName}":`, err.message);

    await pool.query(
      `UPDATE skill_patch_log SET patch_status = 'failed', failure_reason = $1 WHERE id = $2`,
      [failureReason, logId]
    );

    await emit('build:outcome', 'motor/runtime-self-patch', {
      skillName,
      status: 'failed',
      logId,
      errorMessage,
      failureReason,
    }, { priority: 0.8 });

  } finally {
    patchingNow.delete(skillName);
  }
}

async function handleSkillError(event) {
  const { payload } = event;
  if (!payload) return;

  const skillName = payload.skillName || payload.skill_name || payload.skill;
  const errorMessage = payload.error || payload.message || payload.errorMessage || '';
  const errorStack = payload.stack || payload.errorStack || null;

  if (!skillName) {
    console.warn('[runtime-self-patch] skill:error event missing skillName, ignoring');
    return;
  }

  const cleanName = skillName.replace(/\.js$/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  console.log(`[runtime-self-patch] skill:error for "${cleanName}": ${errorMessage.slice(0, 120)}`);

  await patchSkill(cleanName, errorMessage, errorStack);
}

async function start() {
  if (active) return;
  active = true;

  await ensureSchema();
  unsubSkillError = on('skill:error', handleSkillError);

  console.log('[runtime-self-patch] Active — listening for skill:error events');
}

function stop() {
  if (!active) return;
  active = false;
  if (unsubSkillError) { unsubSkillError(); unsubSkillError = null; }
  patchingNow.clear();
  console.log('[runtime-self-patch] Stopped');
}

async function getRecentPatches(limit = 20) {
  const { rows } = await pool.query(
    `SELECT * FROM skill_patch_log ORDER BY patched_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

async function getStats() {
  const { rows } = await pool.query(`
    SELECT
      patch_status,
      COUNT(*) AS count,
      COUNT(DISTINCT skill_name) AS unique_skills
    FROM skill_patch_log
    GROUP BY patch_status
  `);
  return rows;
}

function isActive() {
  return active;
}

function getPatchingNow() {
  return [...patchingNow];
}

export default {
  start,
  stop,
  isActive,
  getPatchingNow,
  getRecentPatches,
  getStats,
  ensureSchema,
};