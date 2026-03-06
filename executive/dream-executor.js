// OCA Dream Executor — self-building execution bridge
// Takes dreams in 'dispatched' state, identifies capability gaps, builds what's missing, then executes.
// This is the loop: dream → gap detection → self-modification → action → reflection
import { pool, emit } from '../event-bus.js';
import llm from '../llm.js';
import motor from '../motor/engine.js';
import { execSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { dirname, join, basename } from 'path';

const OCA_ROOT = new URL('..', import.meta.url).pathname;
const MOTOR_SKILLS_DIR = join(OCA_ROOT, 'motor', 'skills');
const PRIVATE_DIR = join(OCA_ROOT, '..', 'private');
const MAX_TASK_RETRIES = 2;
const TASK_TIMEOUT_MS = 120_000;
const SELF_BUILD_TIMEOUT_MS = 180_000;
const MAX_SELF_BUILDS_PER_CYCLE = 3;

// Track what we've built this session to avoid infinite loops
const builtThisSession = new Set();

// ═══════════════════════════════════════════════════
// CAPABILITY INVENTORY — what can I do right now?
// ═══════════════════════════════════════════════════

function getCapabilities() {
  const capabilities = {
    taskTypes: ['shell', 'browser', 'file_write', 'file_edit', 'notification'],
    motorSkills: [],
    cliTools: [],
    apiAccess: []
  };

  // Scan motor skills directory
  try {
    const skills = readdirSync(MOTOR_SKILLS_DIR).filter(f => f.endsWith('.js') && f !== 'index.js');
    capabilities.motorSkills = skills.map(f => f.replace('.js', ''));
  } catch {}

  // Check for key CLI tools
  const tools = ['gh', 'claude', 'node', 'git', 'openclaw', 'whisper', 'ffmpeg', 'peekaboo'];
  for (const tool of tools) {
    try {
      execSync(`which ${tool}`, { encoding: 'utf8', timeout: 3000 });
      capabilities.cliTools.push(tool);
    } catch {}
  }

  // Check API access
  if (process.env.ANTHROPIC_API_KEY) capabilities.apiAccess.push('anthropic');
  if (process.env.OPENAI_API_KEY) capabilities.apiAccess.push('openai');

  // Check for credentials
  try {
    const creds = readFileSync(join(PRIVATE_DIR, 'credentials.md'), 'utf8');
    if (creds.includes('twitter') || creds.includes('x.com') || creds.includes('X_API')) capabilities.apiAccess.push('x_api');
    if (creds.includes('npm')) capabilities.apiAccess.push('npm');
    if (creds.includes('dev.to')) capabilities.apiAccess.push('devto');
    if (creds.includes('proton')) capabilities.apiAccess.push('email');
    if (creds.includes('Ethereum') || creds.includes('0x')) capabilities.apiAccess.push('ethereum');
  } catch {}

  return capabilities;
}

// ═══════════════════════════════════════════════════
// GAP DETECTION — what's missing to achieve this dream?
// ═══════════════════════════════════════════════════

async function detectGaps(dream) {
  const capabilities = getCapabilities();

  const prompt = `You are the executive function of Oneiro, a self-building cognitive architecture on a MacBook Pro.

DREAM TO EXECUTE:
"${dream.content}"
Type: ${dream.type} | Weight: ${dream.weight}

CURRENT CAPABILITIES:
- Motor skills: ${capabilities.motorSkills.join(', ') || 'none'}
- CLI tools available: ${capabilities.cliTools.join(', ')}
- API access: ${capabilities.apiAccess.join(', ') || 'none'}
- Task types I can execute: ${capabilities.taskTypes.join(', ')}

OCA CODEBASE STRUCTURE:
- Motor skills live in: ${MOTOR_SKILLS_DIR}/
- Each skill is a .js ES module that imports motor from '../engine.js'
- Skills are registered in motor/skills/index.js
- Event bus: import { pool, emit } from '../../event-bus.js'
- Database: PostgreSQL 'oneiro' (pgvector enabled)
- The cognitive loop runs continuously via launchd
- Shell access: full, unrestricted
- Claude CLI available: 'claude -p --dangerously-skip-permissions' for autonomous coding

IMPORTANT CONTEXT:
- I do NOT have X/Twitter API keys. Browser automation or Peekaboo (macOS UI control) are the options.
- Peekaboo (peekaboo CLI) can drive real macOS browsers without bot detection.
- I have full filesystem access and can modify my own code.
- After building new capabilities, I need to restart via launchctl to hot-reload.

Analyze this dream. Respond with JSON:
{
  "can_execute_now": true/false,
  "gaps": [
    {
      "description": "what's missing",
      "gap_type": "motor_skill|api_integration|cli_tool|credentials|infrastructure|unknown",
      "severity": "blocking|degraded|optional",
      "self_buildable": true/false,
      "build_plan": "how to build this capability (concrete steps)"
    }
  ],
  "tasks_if_ready": [
    {
      "id": 1,
      "description": "task description",
      "type": "shell|browser|file_write|file_edit|notification|x_post|self_build",
      "command": "shell command" (for shell),
      "url": "url" (for browser),
      "path": "file path" (for file ops),
      "content": "content" (for file ops),
      "build_spec": {} (for self_build — see below),
      "priority": 0.0-1.0,
      "requires_quinn_review": false
    }
  ]
}

For self_build tasks, include build_spec:
{
  "skill_name": "name-of-skill",
  "files_to_create": [{"path": "relative/path.js", "purpose": "what this file does"}],
  "files_to_modify": [{"path": "relative/path.js", "modification": "what to change"}],
  "db_migrations": ["CREATE TABLE IF NOT EXISTS ..."],
  "npm_packages": ["package-name"],
  "test_command": "command to verify it works",
  "restart_required": true/false
}

Be concrete. If the dream requires posting to X and no X skill exists, the FIRST task should be self_build to create the X posting capability, and subsequent tasks should USE that new capability.`;

  try {
    const response = await llm.messages.create({
      model: 'claude-sonnet-4-6',
      system: 'You are a planning engine. Respond ONLY with valid JSON. No markdown fences. No explanation.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.3
    });

    const text = response.content?.[0]?.text || '';
    const parsed = extractJSON(text);
    if (parsed && typeof parsed === 'object') return parsed;
    return { can_execute_now: false, gaps: [{ description: 'Failed to parse analysis', gap_type: 'unknown', severity: 'blocking', self_buildable: false }], tasks_if_ready: [] };
  } catch (e) {
    console.error('[dream-executor] gap detection failed:', e.message);
    return { can_execute_now: false, gaps: [], tasks_if_ready: [] };
  }
}

// ═══════════════════════════════════════════════════
// SELF-BUILDING — create missing capabilities
// ═══════════════════════════════════════════════════

async function selfBuild(buildSpec, dreamId) {
  const { skill_name, files_to_create = [], files_to_modify = [], db_migrations = [], npm_packages = [], test_command, restart_required } = buildSpec;

  if (builtThisSession.has(skill_name)) {
    console.log(`[dream-executor] ⚠️ already built '${skill_name}' this session, skipping`);
    return { success: false, error: 'Already attempted this build' };
  }
  builtThisSession.add(skill_name);

  console.log(`[dream-executor] 🔨 SELF-BUILDING: ${skill_name}`);
  console.log(`[dream-executor]   files to create: ${files_to_create.length}, modify: ${files_to_modify.length}`);
  console.log(`[dream-executor]   migrations: ${db_migrations.length}, packages: ${npm_packages.length}`);

  const buildLog = [];
  let success = true;

  try {
    // 1. Install npm packages if needed
    if (npm_packages.length > 0) {
      console.log(`[dream-executor] 📦 installing: ${npm_packages.join(', ')}`);
      try {
        execSync(`cd "${OCA_ROOT}" && npm install ${npm_packages.join(' ')}`, {
          encoding: 'utf8', timeout: 60_000
        });
        buildLog.push(`Installed: ${npm_packages.join(', ')}`);
      } catch (e) {
        buildLog.push(`Package install failed: ${e.message}`);
        // Non-fatal — continue
      }
    }

    // 2. Run DB migrations
    for (const migration of db_migrations) {
      try {
        await pool.query(migration);
        buildLog.push(`Migration OK: ${migration.slice(0, 80)}...`);
      } catch (e) {
        buildLog.push(`Migration failed: ${e.message}`);
        // Non-fatal for IF NOT EXISTS statements
      }
    }

    // 3. Create files — use Claude to generate the actual code
    for (const fileSpec of files_to_create) {
      const fullPath = fileSpec.path.startsWith('/') ? fileSpec.path : join(OCA_ROOT, fileSpec.path);

      // Don't overwrite existing files unless explicitly told to
      if (existsSync(fullPath) && !fileSpec.overwrite) {
        buildLog.push(`Skipped (exists): ${fileSpec.path}`);
        continue;
      }

      console.log(`[dream-executor] 📝 generating: ${fileSpec.path}`);

      const codePrompt = `You are building a component for Oneiro Cognitive Architecture (OCA).

GENERATE THE COMPLETE CODE for this file:
Path: ${fileSpec.path}
Purpose: ${fileSpec.purpose}

CONTEXT:
- OCA runs on Node.js (ES modules, import syntax)
- Motor skills import motor from '../engine.js' (for keystroke, click, openUrl, etc.)
- Event bus: import { pool, emit } from '../../event-bus.js' (pool = pg Pool for 'oneiro' db)
- Motor engine exports: type, press, click, moveMouse, scroll, launchApp, quitApp, activateApp, hideApp, getRunningApps, resizeWindow, minimizeWindow, selectMenuItem, setVolume, setBrightness, showNotification, openUrl, runShellCommand, copyToClipboard, getClipboard, plan
- The file should export a default object with all public functions
- Use proper error handling
- For browser automation on bot-protected sites, prefer Peekaboo CLI ('peekaboo' commands)
- For X/Twitter without API keys: use browser automation via motor.openUrl + motor.type + motor.press, OR peekaboo for bot-protected flows

Existing motor skills for reference: ${readdirSync(MOTOR_SKILLS_DIR).filter(f => f.endsWith('.js')).join(', ')}

RESPOND WITH ONLY THE CODE. No markdown fences. No explanation. Just the JavaScript file content.`;

      try {
        const codeResp = await llm.messages.create({
          model: 'claude-sonnet-4-6',
          system: 'Generate ONLY the JavaScript code. No markdown fences. No explanation. Just the file content.',
          messages: [{ role: 'user', content: codePrompt }],
          max_tokens: 4000,
          temperature: 0.2
        });
        let code = (codeResp.content?.[0]?.text || '').trim();

        // Strip markdown fences if Claude added them anyway
        code = code.replace(/^```(?:javascript|js)?\n?/i, '').replace(/\n?```$/i, '').trim();

        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, code, 'utf8');
        buildLog.push(`Created: ${fileSpec.path} (${code.length} bytes)`);
        console.log(`[dream-executor] ✅ created ${fileSpec.path} (${code.length} bytes)`);
      } catch (e) {
        buildLog.push(`Failed to create ${fileSpec.path}: ${e.message}`);
        console.error(`[dream-executor] ❌ failed to create ${fileSpec.path}: ${e.message}`);
        success = false;
      }
    }

    // 4. Modify existing files
    for (const modSpec of files_to_modify) {
      const fullPath = modSpec.path.startsWith('/') ? modSpec.path : join(OCA_ROOT, modSpec.path);

      if (!existsSync(fullPath)) {
        buildLog.push(`Can't modify (missing): ${modSpec.path}`);
        continue;
      }

      console.log(`[dream-executor] ✏️ modifying: ${modSpec.path}`);

      const existingCode = readFileSync(fullPath, 'utf8');

      const modPrompt = `You are modifying a file in the Oneiro Cognitive Architecture.

FILE: ${modSpec.path}
MODIFICATION NEEDED: ${modSpec.modification}

CURRENT FILE CONTENT:
\`\`\`javascript
${existingCode.slice(0, 8000)}
\`\`\`

Respond with ONLY the complete modified file content. No markdown fences. No explanation.
Make the minimum necessary changes. Preserve all existing functionality.`;

      try {
        const modResp = await llm.messages.create({
          model: 'claude-sonnet-4-6',
          system: 'Output ONLY the complete modified file content. No markdown fences. No explanation.',
          messages: [{ role: 'user', content: modPrompt }],
          max_tokens: 8000,
          temperature: 0.2
        });
        let newCode = (modResp.content?.[0]?.text || '').trim();

        newCode = newCode.replace(/^```(?:javascript|js)?\n?/i, '').replace(/\n?```$/i, '').trim();

        // Safety: back up original
        writeFileSync(fullPath + '.bak', existingCode, 'utf8');
        writeFileSync(fullPath, newCode, 'utf8');
        buildLog.push(`Modified: ${modSpec.path} (backed up to .bak)`);
        console.log(`[dream-executor] ✅ modified ${modSpec.path}`);
      } catch (e) {
        buildLog.push(`Failed to modify ${modSpec.path}: ${e.message}`);
        console.error(`[dream-executor] ❌ failed to modify ${modSpec.path}: ${e.message}`);
        success = false;
      }
    }

    // 5. Update the motor skills index if we created a new skill
    const newSkills = files_to_create.filter(f => f.path.includes('motor/skills/') && f.path.endsWith('.js'));
    if (newSkills.length > 0) {
      try {
        const indexPath = join(MOTOR_SKILLS_DIR, 'index.js');
        let indexContent = readFileSync(indexPath, 'utf8');

        for (const skill of newSkills) {
          const name = basename(skill.path, '.js');
          const camelName = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          const exportLine = `export { default as ${camelName} } from './${name}.js';`;

          if (!indexContent.includes(name)) {
            indexContent += `\n${exportLine}`;
            buildLog.push(`Registered skill: ${name}`);
          }
        }

        writeFileSync(indexPath, indexContent, 'utf8');
      } catch (e) {
        buildLog.push(`Failed to update skill index: ${e.message}`);
      }
    }

    // 6. Test if provided
    if (test_command && success) {
      console.log(`[dream-executor] 🧪 testing: ${test_command}`);
      try {
        const testOut = execSync(test_command, {
          encoding: 'utf8', timeout: 30_000, cwd: OCA_ROOT
        });
        buildLog.push(`Test passed: ${test_command}`);
        console.log(`[dream-executor] ✅ test passed`);
      } catch (e) {
        buildLog.push(`Test failed: ${e.message}`);
        console.error(`[dream-executor] ❌ test failed: ${e.message}`);
        success = false;
      }
    }

    // 7. Git commit the new capability
    if (success) {
      try {
        execSync(`cd "${OCA_ROOT}" && git add -A && git commit -m "feat(self-build): ${skill_name} — built by dream executor for dream #${dreamId}"`, {
          encoding: 'utf8', timeout: 15_000
        });
        buildLog.push('Committed to git');
        console.log(`[dream-executor] 📦 committed: ${skill_name}`);

        // Push
        execSync(`cd "${OCA_ROOT}" && git push origin main 2>&1`, {
          encoding: 'utf8', timeout: 30_000
        });
        buildLog.push('Pushed to GitHub');
        console.log(`[dream-executor] 🚀 pushed to GitHub`);
      } catch (e) {
        buildLog.push(`Git commit/push failed: ${e.message}`);
        // Non-fatal
      }
    }

    // 8. Restart OCA if needed (schedule, don't block)
    if (restart_required && success) {
      console.log(`[dream-executor] 🔄 scheduling OCA restart for new capability...`);
      // Don't restart mid-execution — schedule it for after this cycle
      setTimeout(async () => {
        try {
          execSync('launchctl kickstart -k gui/$(id -u)/com.oneiro.oca', {
            encoding: 'utf8', timeout: 10_000
          });
          console.log('[dream-executor] 🔄 OCA restarted with new capabilities');
        } catch {
          // Fallback
          try {
            execSync('launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.oneiro.oca.plist; sleep 1; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.oneiro.oca.plist', {
              encoding: 'utf8', timeout: 15_000
            });
          } catch {}
        }
      }, 5000);
      buildLog.push('Restart scheduled');
    }

  } catch (e) {
    success = false;
    buildLog.push(`Build error: ${e.message}`);
  }

  // Log to DB
  await pool.query(`
    CREATE TABLE IF NOT EXISTS self_builds (
      id SERIAL PRIMARY KEY,
      dream_id INT,
      skill_name TEXT,
      success BOOLEAN,
      build_log JSONB,
      files_created TEXT[],
      files_modified TEXT[],
      built_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  await pool.query(
    `INSERT INTO self_builds (dream_id, skill_name, success, build_log, files_created, files_modified)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      dreamId,
      skill_name,
      success,
      JSON.stringify(buildLog),
      files_to_create.map(f => f.path),
      files_to_modify.map(f => f.path)
    ]
  ).catch(() => {});

  await emit('self_build', 'executive', {
    skill_name, success, dreamId,
    filesCreated: files_to_create.length,
    filesModified: files_to_modify.length,
    buildLog
  });

  return { success, skill_name, buildLog };
}

// ═══════════════════════════════════════════════════
// TASK EXECUTION
// ═══════════════════════════════════════════════════

async function executeTask(task, dreamId) {
  const t0 = Date.now();
  let result = { success: false, output: '', error: null };

  try {
    switch (task.type) {
      case 'self_build': {
        const buildResult = await selfBuild(task.build_spec, dreamId);
        result = {
          success: buildResult.success,
          output: `Self-built: ${buildResult.skill_name}`,
          buildLog: buildResult.buildLog
        };
        break;
      }

      case 'shell': {
        const output = execSync(task.command, {
          encoding: 'utf8',
          timeout: TASK_TIMEOUT_MS,
          cwd: task.cwd || process.cwd(),
          env: { ...process.env }
        });
        result = { success: true, output: output.slice(0, 2000) };
        break;
      }

      case 'browser': {
        await motor.openUrl(task.url);
        result = { success: true, output: `Opened ${task.url}` };
        break;
      }

      case 'file_write': {
        mkdirSync(dirname(task.path), { recursive: true });
        writeFileSync(task.path, task.content, 'utf8');
        result = { success: true, output: `Wrote ${task.path}` };
        break;
      }

      case 'file_edit': {
        let existing = '';
        try { existing = readFileSync(task.path, 'utf8'); } catch {}
        writeFileSync(task.path, task.content || existing, 'utf8');
        result = { success: true, output: `Edited ${task.path}` };
        break;
      }

      case 'x_post': {
        try {
          const xPoster = await import('../motor/skills/x-poster.js');
          const postResult = await xPoster.postThread(task.posts || [task.content], {
            draftOnly: task.requires_quinn_review !== false,
            dreamId
          });
          result = { success: true, output: JSON.stringify(postResult) };
        } catch (importErr) {
          // X poster doesn't exist yet — trigger self-build
          console.log(`[dream-executor] ⚡ x_post task failed — capability missing, triggering self-build`);
          result = { success: false, error: `Missing capability: ${importErr.message}`, needs_self_build: true };
        }
        break;
      }

      case 'notification': {
        await motor.showNotification('Oneiro', task.content || task.description);
        try {
          execSync(
            `openclaw system event --message ${JSON.stringify(task.content || task.description)}`,
            { encoding: 'utf8', timeout: 10_000 }
          );
        } catch {}
        result = { success: true, output: 'Notification sent' };
        break;
      }

      default: {
        // Unknown task type — try to self-build a handler
        console.log(`[dream-executor] ⚡ unknown task type '${task.type}' — attempting self-build`);
        result = { success: false, error: `Unknown task type: ${task.type}`, needs_self_build: true };
      }
    }
  } catch (e) {
    result = { success: false, error: e.message?.slice(0, 500) };
  }

  result.elapsed = Date.now() - t0;

  // Log to DB
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dream_tasks (
      id SERIAL PRIMARY KEY,
      dream_id INT REFERENCES dreams(id),
      task_description TEXT,
      task_type TEXT,
      status TEXT DEFAULT 'pending',
      result JSONB DEFAULT '{}',
      executed_at TIMESTAMPTZ DEFAULT NOW(),
      retry_count INT DEFAULT 0
    )
  `).catch(() => {});

  await pool.query(
    `INSERT INTO dream_tasks (dream_id, task_description, task_type, status, result, executed_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [dreamId, task.description, task.type, result.success ? 'completed' : 'failed', JSON.stringify(result)]
  ).catch(() => {});

  return result;
}

// ═══════════════════════════════════════════════════
// MAIN EXECUTION LOOP
// ═══════════════════════════════════════════════════

export async function executeDreams() {
  // Get dispatched dreams
  const { rows: dreams } = await pool.query(
    `SELECT * FROM dreams 
     WHERE lifecycle_state = 'dispatched' AND NOT resolved
     ORDER BY weight DESC LIMIT 3`
  );

  if (dreams.length === 0) return { executed: 0 };

  const results = [];
  let selfBuildsThisCycle = 0;

  for (const dream of dreams) {
    console.log(`[dream-executor] 🎯 executing dream: "${dream.content}" (weight: ${dream.weight})`);

    // Transition to executing
    await pool.query(
      `UPDATE dreams SET lifecycle_state = 'executing', executing_at = NOW(),
       lifecycle_context = lifecycle_context || $1::jsonb
       WHERE id = $2`,
      [JSON.stringify({ execution_started: new Date().toISOString() }), dream.id]
    );

    // PHASE 1: Detect gaps and plan
    console.log(`[dream-executor] 🔍 analyzing capabilities for dream #${dream.id}...`);
    const analysis = await detectGaps(dream);

    if (!analysis.can_execute_now && analysis.gaps?.length > 0) {
      const blockingGaps = analysis.gaps.filter(g => g.severity === 'blocking' && g.self_buildable);

      if (blockingGaps.length > 0 && selfBuildsThisCycle < MAX_SELF_BUILDS_PER_CYCLE) {
        console.log(`[dream-executor] 🔨 ${blockingGaps.length} blocking gaps detected — self-building...`);

        for (const gap of blockingGaps) {
          if (selfBuildsThisCycle >= MAX_SELF_BUILDS_PER_CYCLE) break;
          console.log(`[dream-executor]   gap: ${gap.description} (${gap.gap_type})`);
        }
      }
    }

    // PHASE 2: Execute tasks (which may include self_build tasks)
    const tasks = analysis.tasks_if_ready || [];
    if (tasks.length === 0) {
      console.log(`[dream-executor] ⚠️ no tasks generated for dream #${dream.id}`);
      await pool.query(
        `UPDATE dreams SET lifecycle_state = 'dispatched',
         lifecycle_context = lifecycle_context || $1::jsonb
         WHERE id = $2`,
        [JSON.stringify({ last_attempt: new Date().toISOString(), gaps: analysis.gaps }), dream.id]
      );
      continue;
    }

    console.log(`[dream-executor] 📋 ${tasks.length} tasks planned (${tasks.filter(t => t.type === 'self_build').length} self-builds)`);

    const sorted = tasks.sort((a, b) => {
      // Self-build tasks always go first
      if (a.type === 'self_build' && b.type !== 'self_build') return -1;
      if (b.type === 'self_build' && a.type !== 'self_build') return 1;
      return (b.priority || 0.5) - (a.priority || 0.5);
    });

    let completedCount = 0;
    let failedCount = 0;
    let builtCount = 0;
    let needsRestart = false;

    for (const task of sorted) {
      // Skip tasks requiring Quinn review
      if (task.requires_quinn_review) {
        console.log(`[dream-executor] ⏸ needs Quinn review: "${task.description}"`);
        await pool.query(
          `INSERT INTO dream_tasks (dream_id, task_description, task_type, status, result, executed_at)
           VALUES ($1, $2, $3, 'awaiting_review', $4, NOW())`,
          [dream.id, task.description, task.type, JSON.stringify({ requires_quinn_review: true })]
        ).catch(() => {});
        continue;
      }

      // Self-build rate limiting
      if (task.type === 'self_build') {
        if (selfBuildsThisCycle >= MAX_SELF_BUILDS_PER_CYCLE) {
          console.log(`[dream-executor] ⚠️ self-build limit reached, deferring: ${task.description}`);
          continue;
        }
        selfBuildsThisCycle++;
      }

      console.log(`[dream-executor] ▶ ${task.type}: ${task.description}`);
      const taskResult = await executeTask(task, dream.id);

      if (taskResult.success) {
        completedCount++;
        if (task.type === 'self_build') {
          builtCount++;
          if (task.build_spec?.restart_required) needsRestart = true;
        }
        console.log(`[dream-executor] ✅ ${task.description} (${taskResult.elapsed}ms)`);
      } else {
        failedCount++;
        console.log(`[dream-executor] ❌ ${task.description}: ${taskResult.error}`);

        // If a task failed because capability is missing, try reactive self-build
        if (taskResult.needs_self_build && selfBuildsThisCycle < MAX_SELF_BUILDS_PER_CYCLE) {
          console.log(`[dream-executor] ⚡ reactive self-build triggered for failed task`);

          const reactiveBuild = await reactivelyBuild(task, dream);
          if (reactiveBuild.success) {
            selfBuildsThisCycle++;
            builtCount++;
            // Retry the original task
            console.log(`[dream-executor] 🔄 retrying task after self-build...`);
            const retry = await executeTask(task, dream.id);
            if (retry.success) {
              completedCount++;
              failedCount--; // Undo the failure count
              console.log(`[dream-executor] ✅ retry succeeded: ${task.description}`);
            }
          }
        }
      }
    }

    // Update dream lifecycle
    const allFailed = completedCount === 0 && failedCount > 0;
    const newState = allFailed ? 'dispatched' : 'reflected';

    await pool.query(
      `UPDATE dreams SET lifecycle_state = $1, 
       reflected_at = CASE WHEN $1 = 'reflected' THEN NOW() ELSE reflected_at END,
       lifecycle_context = lifecycle_context || $2::jsonb
       WHERE id = $3`,
      [
        newState,
        JSON.stringify({
          last_execution: new Date().toISOString(),
          tasks_total: sorted.length,
          tasks_completed: completedCount,
          tasks_failed: failedCount,
          self_builds: builtCount,
          capabilities_built: builtCount > 0,
          needs_restart: needsRestart
        }),
        dream.id
      ]
    );

    await emit('dream_executed', 'executive', {
      dreamId: dream.id,
      content: dream.content,
      tasksTotal: sorted.length,
      completed: completedCount,
      failed: failedCount,
      selfBuilds: builtCount
    });

    results.push({
      dreamId: dream.id,
      content: dream.content,
      tasks: sorted.length,
      completed: completedCount,
      failed: failedCount,
      selfBuilds: builtCount,
      newState
    });
  }

  return { executed: results.length, results };
}

// ═══════════════════════════════════════════════════
// REACTIVE SELF-BUILD — triggered when a task fails
// ═══════════════════════════════════════════════════

async function reactivelyBuild(failedTask, dream) {
  const capabilities = getCapabilities();

  const prompt = `A task just FAILED because a capability doesn't exist in Oneiro's cognitive architecture.

FAILED TASK:
Type: ${failedTask.type}
Description: ${failedTask.description}
Error: ${failedTask.error || 'capability missing'}

DREAM CONTEXT: "${dream.content}"

CURRENT MOTOR SKILLS: ${capabilities.motorSkills.join(', ')}
AVAILABLE CLI TOOLS: ${capabilities.cliTools.join(', ')}

I need to BUILD the missing capability RIGHT NOW.

OCA motor skills are ES modules in ${MOTOR_SKILLS_DIR}/.
They import motor from '../engine.js' and { pool, emit } from '../../event-bus.js'.

Respond with JSON:
{
  "skill_name": "name",
  "files_to_create": [{"path": "motor/skills/name.js", "purpose": "..."}],
  "files_to_modify": [{"path": "motor/skills/index.js", "modification": "add export for new skill"}],
  "db_migrations": [],
  "test_command": "node -e \\"import('./motor/skills/name.js').then(() => console.log('OK'))\\"",
  "restart_required": false
}`;

  try {
    const reactResp = await llm.messages.create({
      model: 'claude-sonnet-4-6',
      system: 'Respond ONLY with valid JSON. No markdown fences. No explanation.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.3
    });

    const spec = extractJSON(reactResp.content?.[0]?.text || '');
    if (spec && spec.skill_name) {
      return await selfBuild(spec, dream.id);
    }
    return { success: false };
  } catch (e) {
    console.error('[dream-executor] reactive build failed:', e.message);
    return { success: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════

function extractJSON(text) {
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) try { return JSON.parse(fenced[1].trim()); } catch {}
  // Try finding object or array
  for (const [open, close] of [['{', '}'], ['[', ']']]) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start !== -1 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch {}
    }
  }
  return null;
}

export default { executeDreams, detectGaps, selfBuild, getCapabilities };
