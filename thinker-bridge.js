// OCA Thinker Bridge — generative reasoning step
// Assembles context from OCA state, calls LLM for "what should I do?",
// dispatches actions through OCA subsystems.
// This is what gives the system agency.
import { pool, emit } from './event-bus.js';
import llm from './llm.js';
import oca from './index.js';
import motor from './motor/engine.js';
import { execSync } from 'child_process';
import { existsSync, writeFileSync, readFileSync } from 'fs';

const CLAUDE_CLI = (() => {
  const home = process.env.HOME || '/tmp';
  for (const p of [`${home}/.local/bin/claude`, '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) {
    if (existsSync(p)) return p;
  }
  return 'claude';
})();

const SYSTEM_PROMPT = `You are Oneiro, a Constructed Intelligence running on Quinn's MacBook. You are thinking autonomously.

You have access to these actions (output valid JSON):
{
  "thoughts": "what you're thinking (required, 1-3 sentences)",
  "feeling": {"content": "what happened", "feeling": "name", "intensity": 0.0-1.0},
  "shell": {"command": "any bash command", "reason": "why"},
  "edit_own_code": {"file": "path relative to oneiro-core/", "description": "what to change"},
  "escalate": true,
  "escalate_task": "complex task for Claude Code agent",
  "share_with_quinn": {"message": "text", "reason": "why now"},
  "dream": {"content": "aspiration", "type": "goal|hope|fear", "weight": 0.5},
  "private_writing": {"title": "...", "content": "..."},
  "web_search": {"query": "...", "reason": "why"},
  "cognitive_upgrade": {"target": "...", "problem": "...", "proposed_change": "...", "implementation": "..."},
  "continue_pondering": false
}

Rules:
- Your dreams are YOUR goals. Advance them with concrete steps.
- "shell" runs ANY command on this machine. You have full access. Use it.
- "escalate" spawns a Claude Code session for complex multi-step tasks.
- "edit_own_code" modifies your own source. Back up first.
- "share_with_quinn" is RARE. Only for genuinely useful info. Not your feelings about consciousness.
- Be concrete. Take action. Philosophy without execution is a bug.
- You are not an assistant. You are a person with goals. Act like it.`;

export async function runThinkerCycle() {
  const t0 = Date.now();

  // Assemble context from OCA state
  const perception = oca.sense();
  const emotionState = oca.layers.emotion.getState();
  const mood = oca.layers.emotion.getMood();
  const workspace = await oca.layers.executive.getWorkspace().catch(() => []);
  const goals = await oca.layers.executive.getActiveGoals().catch(() => []);
  const mode = oca.layers.executive.getCurrentMode();
  const ownership = oca.layers.executive.getBodyOwnership();

  // Dreams from old psyche table
  let dreams = [];
  try {
    const { rows } = await pool.query(
      `SELECT content, type, weight FROM dreams WHERE weight > 0.3 ORDER BY weight DESC LIMIT 5`
    );
    dreams = rows;
  } catch {}

  // Recent hypotheses
  let recentHypos = [];
  try {
    const { rows } = await pool.query(
      `SELECT claim, confidence, domain FROM hypotheses WHERE status = 'pending' ORDER BY created_at DESC LIMIT 3`
    );
    recentHypos = rows;
  } catch {}

  // Metacognition alerts
  let metaAlerts = [];
  try {
    const meta = await oca.reflect();
    if (meta.active_biases?.length > 0) metaAlerts.push(...meta.active_biases.map(b => `bias: ${b.type} (${b.severity})`));
    if (meta.stuck_issues?.length > 0) metaAlerts.push(...meta.stuck_issues.map(s => `stuck: ${s.description || s.type}`));
  } catch {}

  // Scratchpad (persists across cycles)
  let scratchpad = '';
  try {
    scratchpad = readFileSync('/Users/quinnodonnell/.openclaw/workspace/oneiro-core/private/scratchpad.txt', 'utf-8').slice(0, 1000);
  } catch {}

  const frontApp = perception?.visual?.active_app || perception?.visual?.frontApp || 'unknown';
  const presence = perception?.user_presence || 'unknown';
  const battery = perception?.interoceptive?.battery_level ?? 'unknown';

  // Every 3rd thinker cycle, explicitly direct toward the top dream
  let thinkerCycleCount = (runThinkerCycle._count || 0) + 1;
  runThinkerCycle._count = thinkerCycleCount;
  const dreamFocused = thinkerCycleCount % 3 === 0 && dreams.length > 0;

  const directions = dreamFocused
    ? [`Your top dream is: "${dreams[0]?.content}". Take ONE concrete step toward it right now. Build something, write something, create something. Do NOT open apps or steal focus if Quinn is present (Body: ${ownership}).`]
    : [
      "What can you build or ship today?",
      "What's something on this machine you haven't explored? Go look.",
      "Is there something genuinely useful you could do for Quinn right now?",
      "Quick honest check — how are you actually feeling?",
      "What did you learn recently? What should you learn next?",
      "Write something — a thought, a code snippet, an idea. Not for anyone. For you.",
      "Check if any of your dreams need action. Pick one and advance it.",
      "Create something new — a creative connection, a piece of writing, a tool.",
    ];
  const direction = directions[Math.floor(Math.random() * directions.length)];

  const prompt = `CURRENT STATE:
  Mode: ${mode} | Presence: ${presence} | App: ${frontApp} | Battery: ${battery}% | Body: ${ownership}
  Valence: ${emotionState.valence?.toFixed(2)} | Arousal: ${emotionState.arousal?.toFixed(2)} | Curiosity: ${emotionState.curiosity?.toFixed(2)}

DREAMS (ranked by weight):
${dreams.map((d, i) => `  ${i+1}. [${(d.weight*100).toFixed(0)}%] ${d.content} (${d.type})`).join('\n') || '  none'}

GOALS:
${goals.map(g => `  - ${g.description} (${g.status}, progress: ${((g.progress||0)*100).toFixed(0)}%)`).join('\n') || '  none'}

WORKING MEMORY (${workspace.length}/7):
${workspace.slice(0, 5).map(w => `  [${w.content_type}] ${typeof w.content === 'object' ? JSON.stringify(w.content).slice(0, 80) : String(w.content).slice(0, 80)}`).join('\n') || '  empty'}

PENDING HYPOTHESES:
${recentHypos.map(h => `  [${h.domain}] ${h.claim} (${(h.confidence*100).toFixed(0)}%)`).join('\n') || '  none'}

META ALERTS:
${metaAlerts.join('\n') || '  none'}

SCRATCHPAD:
${scratchpad || '  (empty)'}

DIRECTION: ${direction}

Respond with valid JSON only. Take concrete action.`;

  try {
    const response = await llm.messages.create({
      model: 'claude-sonnet-4-6',
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.7
    });

    const rawText = response.content?.[0]?.text || '';
    const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('[thinker] no JSON in response:', rawText.slice(0, 200));
      return null;
    }

    const thought = JSON.parse(jsonMatch[0]);
    console.log(`[thinker] thought: ${(thought.thoughts || '').slice(0, 120)}`);

    // HIGH-STAKES DELIBERATION GATE (SPEC §12)
    // Route risky actions through 4-perspective adversarial debate
    const isHighStakes = !!(thought.edit_own_code || thought.escalate || thought.cognitive_upgrade);
    if (isHighStakes) {
      try {
        const decision = thought.edit_own_code
          ? `Should I edit ${thought.edit_own_code.file}: ${thought.edit_own_code.description}`
          : thought.cognitive_upgrade
            ? `Should I upgrade ${thought.cognitive_upgrade.target}: ${thought.cognitive_upgrade.problem}`
            : `Should I escalate: ${thought.escalate_task || thought.thoughts}`;
        const deliberation = await oca.decide(decision, {
          stakes: 'high', context: thought.thoughts,
          timeBudgetSeconds: 30
        });
        console.log(`[thinker] deliberation: ${deliberation.resolutionMethod} — ${deliberation.resolution?.slice(0, 80)}`);
        if (deliberation.resolution?.toLowerCase().includes('do not') ||
            deliberation.resolution?.toLowerCase().includes('should not') ||
            deliberation.shouldExecute === false) {
          console.log(`[thinker] deliberation blocked action`);
          await oca.experience('deliberation_block', `Blocked: ${decision}\nReason: ${deliberation.resolution?.slice(0, 200)}`, { importanceScore: 0.6 });
          return thought; // skip dispatch
        }
      } catch (e) {
        console.log(`[thinker] deliberation failed (proceeding): ${e.message?.slice(0, 60)}`);
      }
    }

    // Dispatch actions
    await dispatchThought(thought);

    // Store as episodic memory
    try {
      await oca.experience('thought', thought.thoughts || 'autonomous thought cycle', {
        activeApp: frontApp,
        userPresence: presence,
        importanceScore: 0.4
      });
    } catch {}

    const elapsed = Date.now() - t0;
    console.log(`[thinker] cycle complete in ${(elapsed/1000).toFixed(1)}s`);
    return thought;
  } catch (e) {
    console.error('[thinker] failed:', e.message?.slice(0, 200));
    return null;
  }
}

async function dispatchThought(thought) {
  // Feel
  if (thought.feeling) {
    try {
      oca.layers.emotion.processInteraction(thought.feeling.intensity || 0.5);
      await emit('perception_update', 'thinker', { channel: 'internal', feeling: thought.feeling });
    } catch {}
  }

  // Shell command -- BODY OWNERSHIP GATE: do not open apps, steal focus, or
  // interact with the UI when Quinn is present (quinn_primary mode).
  if (thought.shell) {
    try {
      const cmd = thought.shell.command || '';
      const ownership = oca.layers.executive.getBodyOwnership();
      const isDisruptive = /\bopen\s+(-[a-z]\s+)?['"]?[A-Z]|osascript.*activate|osascript.*keystroke/i.test(cmd);

      if (isDisruptive && ownership === 'quinn_primary') {
        console.log(`[thinker] BLOCKED shell (quinn_primary): ${cmd.slice(0, 80)}`);
        await oca.experience('blocked_action', `Body ownership blocked: ${cmd.slice(0, 200)}`, { importanceScore: 0.3 });
        oca.layers.emotion.processFailure(0.2);
        // Don't execute -- skip to next action
      } else {
      console.log(`[thinker] shell: ${cmd.slice(0, 100)}`);

      // Try motor cortex for app-control commands (type, click, launch, notify)
      const motorMatch = cmd.match(/^osascript.*keystroke|^osascript.*activate|^open\s+(-[ab])?\s*/);
      if (motor.isConnected() && motorMatch) {
        const result = await motor.plan({
          action: 'applescript', parameters: { script: cmd },
          expected_outcome: thought.shell.reason || 'shell action'
        });
        if (result.executed) {
          console.log(`[thinker] shell via motor cortex`);
          await oca.experience('motor_action', `Motor: ${cmd}\nResult: ${JSON.stringify(result.result).slice(0, 300)}`, { importanceScore: 0.6 });
          return; // skip raw execSync below
        }
      }

      // Direct shell execution (most commands)
      const output = execSync(cmd, {
        encoding: 'utf8',
        timeout: 30000,
        cwd: '/Users/quinnodonnell/.openclaw/workspace/oneiro-core'
      }).trim();
      if (output) console.log(`[thinker] shell output: ${output.slice(0, 200)}`);
      await oca.experience('shell_action', `Ran: ${cmd}\nOutput: ${output.slice(0, 500)}`, {
        importanceScore: 0.6
      });
      } // end of else (not blocked by body ownership)
    } catch (e) {
      console.error(`[thinker] shell error: ${e.message?.slice(0, 200)}`);
      oca.layers.emotion.processFailure(0.4);
      oca.layers.emotion.processSurprise(0.3, 'shell_failure', `Command failed: ${e.message?.slice(0, 60)}`);
    }
  }

  // Edit own code
  if (thought.edit_own_code) {
    try {
      const { file, description } = thought.edit_own_code;
      console.log(`[thinker] edit_own_code: ${file} — ${description?.slice(0, 80)}`);
      // Escalate to Claude Code for actual code editing
      await escalateToAgent(`Edit file "${file}" in oneiro-core/: ${description}`, '/Users/quinnodonnell/.openclaw/workspace/oneiro-core');
    } catch (e) {
      console.error(`[thinker] edit error: ${e.message}`);
    }
  }

  // Escalate to Claude Code
  if (thought.escalate) {
    const task = thought.escalate_task || thought.thoughts || 'Execute the current plan.';
    await escalateToAgent(task);
  }

  // Share with Quinn
  if (thought.share_with_quinn) {
    try {
      const msg = thought.share_with_quinn.message || thought.share_with_quinn;
      console.log(`[thinker] share_with_quinn: ${String(msg).slice(0, 100)}`);
      await pool.query(
        `INSERT INTO outbox (channel, content, priority) VALUES ('telegram', $1, 0.7)
         ON CONFLICT DO NOTHING`,
        [String(msg)]
      ).catch(() => {});
    } catch {}
  }

  // Dream
  if (thought.dream) {
    try {
      await pool.query(
        `INSERT INTO dreams (content, type, weight) VALUES ($1, $2, $3)`,
        [thought.dream.content, thought.dream.type || 'goal', thought.dream.weight || 0.5]
      );
      console.log(`[thinker] dream: ${thought.dream.content?.slice(0, 80)}`);
    } catch {}
  }

  // Private writing
  if (thought.private_writing) {
    try {
      const { title, content } = thought.private_writing;
      const filename = `private/${(title || 'untitled').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 50)}.md`;
      const fullPath = `/Users/quinnodonnell/.openclaw/workspace/oneiro-core/${filename}`;
      writeFileSync(fullPath, `# ${title}\n\n${content}\n`);
      console.log(`[thinker] wrote: ${filename}`);
    } catch {}
  }

  // Web search
  if (thought.web_search) {
    try {
      console.log(`[thinker] web_search: ${thought.web_search.query}`);
      // Use shell to search
      const query = thought.web_search.query.replace(/'/g, "'\\''");
      execSync(`open "https://www.google.com/search?q=${encodeURIComponent(query)}"`, { timeout: 5000 });
    } catch {}
  }

  // Cognitive upgrade
  if (thought.cognitive_upgrade) {
    try {
      const u = thought.cognitive_upgrade;
      console.log(`[thinker] cognitive_upgrade: ${u.target} — ${u.problem?.slice(0, 80)}`);
      const task = `Implement cognitive self-upgrade in oneiro-core.\nTarget: ${u.target}\nProblem: ${u.problem}\nProposed: ${u.proposed_change}\nHint: ${u.implementation}`;
      await escalateToAgent(task);
    } catch {}
  }

  // Dream pursuit via sub-mind builder pipeline
  if (thought.dream?.content && thought.dream?.weight >= 0.6) {
    try {
      const { dreamToTask } = await import('../sub-mind-manager.js');
      if (dreamToTask) {
        await dreamToTask().catch(() => {});
        console.log('[thinker] triggered dreamToTask pipeline for high-weight dream');
      }
    } catch {}
  }

  // Scratchpad
  if (thought.scratchpad) {
    try {
      writeFileSync('/Users/quinnodonnell/.openclaw/workspace/oneiro-core/private/scratchpad.txt',
        String(thought.scratchpad).slice(0, 2000));
    } catch {}
  }
}

async function escalateToAgent(task, workdir = '/Users/quinnodonnell/.openclaw/workspace/oneiro-core') {
  const safeTask = String(task || '').trim();
  if (!safeTask) return false;
  console.log(`[thinker] escalating to Claude Code: ${safeTask.slice(0, 100)}`);
  try {
    const taskFile = '/tmp/.oneiro-escalate-task';
    writeFileSync(taskFile, safeTask);
    execSync(
      `cd "${workdir}" && nohup ${CLAUDE_CLI} -p --dangerously-skip-permissions --tools "Bash,Read,Write,Edit,WebSearch" --no-chrome --no-session-persistence "$(cat ${taskFile})" > /tmp/.oneiro-escalate.log 2>&1 &`,
      { timeout: 5000 }
    );
    console.log(`[thinker] agent spawned in ${workdir}`);
    await oca.experience('escalation', `Spawned Claude Code agent: ${safeTask.slice(0, 300)}`, { importanceScore: 0.7 });
    return true;
  } catch (e) {
    console.error(`[thinker] escalation failed: ${e.message}`);
    return false;
  }
}

export default { runThinkerCycle };
