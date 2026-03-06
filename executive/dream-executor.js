// OCA Dream Executor — bridges dispatched dreams into real actions
// Takes dreams in 'dispatched' state, decomposes into tasks, executes via motor/shell
import { pool, emit } from '../event-bus.js';
import motor from '../motor/engine.js';
import { execSync } from 'child_process';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MAX_TASK_RETRIES = 2;
const TASK_TIMEOUT_MS = 120_000;

// Dream → tasks decomposition via Claude
async function decomposeDream(dream) {
  const prompt = `You are the executive function of Oneiro, a cognitive architecture running on a MacBook Pro.

A dream/goal has been dispatched for execution:
"${dream.content}"

Dream type: ${dream.type}
Weight: ${dream.weight}
Context: ${JSON.stringify(dream.lifecycle_context || {})}

Break this dream into 1-5 concrete, actionable tasks that can be executed RIGHT NOW using:
- Shell commands (node scripts, git, file operations)
- Browser automation (opening URLs, typing)
- File creation/editing
- OpenClaw CLI commands

Each task should be small, atomic, and independently executable.

Respond ONLY with a JSON array:
[
  {
    "id": 1,
    "description": "what this task does",
    "type": "shell|browser|file_write|file_edit|notification",
    "command": "the shell command to run" (for shell type),
    "url": "url to open" (for browser type),
    "path": "file path" (for file_write/file_edit),
    "content": "content to write" (for file_write),
    "priority": 0.0-1.0,
    "requires_quinn_review": true/false
  }
]

IMPORTANT:
- For X/Twitter posts, generate a draft file AND use the x-poster skill (type: "x_post")
- For code changes, use shell commands with git
- For notifications to Quinn, use type "notification"
- Be concrete. No placeholder tasks.
- If a task needs Quinn's review first, set requires_quinn_review: true`;

  try {
    const result = execSync(
      `claude -p --no-input -m sonnet --output-format json <<'PROMPT_EOF'\n${prompt}\nPROMPT_EOF`,
      {
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...process.env, ANTHROPIC_API_KEY }
      }
    ).trim();

    // Parse JSON from response
    const parsed = extractJSON(result);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch (e) {
    console.error('[dream-executor] decomposition failed:', e.message);
    return [];
  }
}

function extractJSON(text) {
  // Try direct parse
  try { return JSON.parse(text); } catch {}
  // Try extracting from markdown fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) try { return JSON.parse(fenced[1].trim()); } catch {}
  // Try finding array
  const arrStart = text.indexOf('[');
  const arrEnd = text.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) {
    try { return JSON.parse(text.slice(arrStart, arrEnd + 1)); } catch {}
  }
  return null;
}

// Execute a single task
async function executeTask(task, dreamId) {
  const t0 = Date.now();
  let result = { success: false, output: '', error: null };

  try {
    switch (task.type) {
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
        const { writeFileSync: wf, mkdirSync } = await import('fs');
        const { dirname } = await import('path');
        mkdirSync(dirname(task.path), { recursive: true });
        wf(task.path, task.content, 'utf8');
        result = { success: true, output: `Wrote ${task.path}` };
        break;
      }

      case 'file_edit': {
        const { readFileSync: rf, writeFileSync: wf2 } = await import('fs');
        let existing = '';
        try { existing = rf(task.path, 'utf8'); } catch {}
        const updated = task.content; // For now, full replacement
        wf2(task.path, updated, 'utf8');
        result = { success: true, output: `Edited ${task.path}` };
        break;
      }

      case 'x_post': {
        // Import and use the X poster skill
        const xPoster = await import('../motor/skills/x-poster.js');
        const postResult = await xPoster.postThread(task.posts || [task.content], {
          draftOnly: task.requires_quinn_review !== false,
          dreamId
        });
        result = { success: true, output: JSON.stringify(postResult) };
        break;
      }

      case 'notification': {
        await motor.showNotification('Oneiro', task.content || task.description);
        // Also emit to OpenClaw for Telegram delivery
        try {
          execSync(
            `openclaw system event --message ${JSON.stringify(task.content || task.description)}`,
            { encoding: 'utf8', timeout: 10_000 }
          );
        } catch {}
        result = { success: true, output: 'Notification sent' };
        break;
      }

      default:
        result = { success: false, error: `Unknown task type: ${task.type}` };
    }
  } catch (e) {
    result = { success: false, error: e.message?.slice(0, 500) };
  }

  result.elapsed = Date.now() - t0;

  // Log to DB
  await pool.query(
    `INSERT INTO dream_tasks (dream_id, task_description, task_type, status, result, executed_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [dreamId, task.description, task.type, result.success ? 'completed' : 'failed', JSON.stringify(result)]
  ).catch(() => {});

  return result;
}

// Main execution loop for dispatched dreams
export async function executeDreams() {
  // Ensure dream_tasks table exists
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

  // Get dispatched dreams
  const { rows: dreams } = await pool.query(
    `SELECT * FROM dreams 
     WHERE lifecycle_state = 'dispatched' AND NOT resolved
     ORDER BY weight DESC LIMIT 3`
  );

  if (dreams.length === 0) return { executed: 0 };

  const results = [];

  for (const dream of dreams) {
    console.log(`[dream-executor] 🎯 executing dream: "${dream.content}" (weight: ${dream.weight})`);

    // Transition to executing
    await pool.query(
      `UPDATE dreams SET lifecycle_state = 'executing', executing_at = NOW(),
       lifecycle_context = lifecycle_context || $1::jsonb
       WHERE id = $2`,
      [JSON.stringify({ execution_started: new Date().toISOString() }), dream.id]
    );

    // Decompose into tasks
    const tasks = await decomposeDream(dream);
    if (tasks.length === 0) {
      console.log(`[dream-executor] ⚠️ no tasks generated for dream ${dream.id}`);
      await pool.query(
        `UPDATE dreams SET lifecycle_state = 'dispatched',
         lifecycle_context = lifecycle_context || '{"last_attempt_empty": true}'::jsonb
         WHERE id = $1`,
        [dream.id]
      );
      continue;
    }

    console.log(`[dream-executor] 📋 ${tasks.length} tasks decomposed`);

    // Execute tasks in priority order
    const sorted = tasks.sort((a, b) => (b.priority || 0.5) - (a.priority || 0.5));
    let completedCount = 0;
    let failedCount = 0;

    for (const task of sorted) {
      // Skip tasks requiring Quinn review if flagged
      if (task.requires_quinn_review) {
        console.log(`[dream-executor] ⏸ task needs Quinn review: "${task.description}"`);
        await pool.query(
          `INSERT INTO dream_tasks (dream_id, task_description, task_type, status, result, executed_at)
           VALUES ($1, $2, $3, 'awaiting_review', $4, NOW())`,
          [dream.id, task.description, task.type, JSON.stringify({ requires_quinn_review: true })]
        ).catch(() => {});
        continue;
      }

      console.log(`[dream-executor] ▶ ${task.type}: ${task.description}`);
      const taskResult = await executeTask(task, dream.id);

      if (taskResult.success) {
        completedCount++;
        console.log(`[dream-executor] ✅ ${task.description} (${taskResult.elapsed}ms)`);
      } else {
        failedCount++;
        console.log(`[dream-executor] ❌ ${task.description}: ${taskResult.error}`);
      }
    }

    // Update dream lifecycle
    const newState = failedCount === sorted.length ? 'dispatched' : 'reflected';
    await pool.query(
      `UPDATE dreams SET lifecycle_state = $1, reflected_at = CASE WHEN $1 = 'reflected' THEN NOW() ELSE reflected_at END,
       lifecycle_context = lifecycle_context || $2::jsonb
       WHERE id = $3`,
      [
        newState,
        JSON.stringify({
          last_execution: new Date().toISOString(),
          tasks_total: sorted.length,
          tasks_completed: completedCount,
          tasks_failed: failedCount
        }),
        dream.id
      ]
    );

    // Emit execution event
    await emit('dream_executed', 'executive', {
      dreamId: dream.id,
      content: dream.content,
      tasksTotal: sorted.length,
      completed: completedCount,
      failed: failedCount
    });

    results.push({
      dreamId: dream.id,
      content: dream.content,
      tasks: sorted.length,
      completed: completedCount,
      failed: failedCount,
      newState
    });
  }

  return { executed: results.length, results };
}

// Check if Quinn is using the machine (safety gate)
async function isQuinnActive() {
  try {
    const { rows } = await pool.query(
      `SELECT mode FROM body_ownership_log ORDER BY timestamp DESC LIMIT 1`
    );
    return rows[0]?.mode === 'quinn_primary';
  } catch {
    // Default to safe: assume Quinn is active
    return true;
  }
}

export default { executeDreams, decomposeDream, executeTask };
