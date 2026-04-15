// OCA Thinker Bridge — generative reasoning step
// Assembles context from OCA state, calls LLM for "what should I do?",
// dispatches actions through OCA subsystems.
// This is what gives the system agency.
import { pool, emit } from './event-bus.js';
import llm from './llm.js';
import oca, { design as designModel } from './index.js';
import motor from './motor/engine.js';
import diag from './diagnostic-log.js';
import { execSync, execFileSync, spawn } from 'child_process';
import { existsSync, writeFileSync, readFileSync, readdirSync } from 'fs';

// ═══════════════════════════════════════════════════
// ASYNC SPAWN HELPER
//
// Replaces execSync/execFileSync on thinker hot paths. The underlying
// problem with the Sync variants: they block the entire Node.js event
// loop for the duration of the child process. A 10-minute builder run
// means 10 minutes where no setTimeouts fire, no HTTP requests get
// served, and worker pool spawns get starved. `runAsync` uses `spawn()`
// under a Promise wrapper so `await runAsync(...)` yields the event
// loop to other work while the child runs.
//
// NO HARD TIMEOUTS. If a build is slow, the build is slow.  The only
// protection is an optional `silentWatchdogMs`: if stdout has been
// quiet for that long, we SIGTERM the child (indicating a true hang
// rather than slow but productive work). This is cancellation of the
// subprocess, not a blocking timeout in Node.
// ═══════════════════════════════════════════════════
async function runAsync(cmd, args = [], options = {}) {
  const {
    cwd,
    env = process.env,
    shell = false,             // false = direct argv (safer); true = /bin/sh -c
    silentWatchdogMs = null,   // null = never kill for silence
    maxBuffer = 32 * 1024 * 1024, // 32MB
    onStdoutLine = null,
  } = options;

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, shell, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      reject(new Error(`spawn failed: ${e.message}`));
      return;
    }

    let stdout = '';
    let stderr = '';
    let totalStdout = 0;
    let totalStderr = 0;
    let lastStdoutAt = Date.now();
    let watchdog = null;

    const armWatchdog = () => {
      if (!silentWatchdogMs) return;
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        const silentMs = Date.now() - lastStdoutAt;
        if (silentMs >= silentWatchdogMs) {
          // Child has been silent past the threshold — SIGTERM it.
          try { child.kill('SIGTERM'); } catch {}
          // Give it 5s to clean up, then SIGKILL
          setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000);
        } else {
          // Activity since last check — re-arm
          armWatchdog();
        }
      }, silentWatchdogMs);
    };
    armWatchdog();

    child.stdout.on('data', (buf) => {
      lastStdoutAt = Date.now();
      const chunk = buf.toString();
      totalStdout += chunk.length;
      if (totalStdout <= maxBuffer) stdout += chunk;
      if (onStdoutLine) {
        // Best-effort line splitter for streaming consumers
        for (const line of chunk.split(/\r?\n/)) {
          if (line) {
            try { onStdoutLine(line); } catch {}
          }
        }
      }
    });

    child.stderr.on('data', (buf) => {
      const chunk = buf.toString();
      totalStderr += chunk.length;
      if (totalStderr <= maxBuffer) stderr += chunk;
    });

    child.on('error', (e) => {
      if (watchdog) clearTimeout(watchdog);
      reject(new Error(`spawn error: ${e.message}`));
    });

    child.on('exit', (code, signal) => {
      if (watchdog) clearTimeout(watchdog);
      resolve({ stdout, stderr, code, signal });
    });
  });
}

// Module-level gate: only one build can run at a time per target project.
// Builder.py's _next_iter_num() reads the filesystem directly and isn't
// atomic across parallel invocations, and the thinker's build action
// isn't robust to racing itself anyway. If the thinker fires `build`
// while a previous build is still running, we log and skip — the next
// tick will try again.
let buildInProgress = false;

const CLAUDE_CLI = (() => {
  const home = process.env.HOME || '/tmp';
  for (const p of [`${home}/.local/bin/claude`, '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) {
    if (existsSync(p)) return p;
  }
  return 'claude';
})();

const HOME_DIR = process.env.HOME || '/Users/quinnodonnell';
const PROJECT_ROOT = `${HOME_DIR}/.openclaw/workspace/oneiro-core`;
const TARGET_PROJECT_PATH = `${PROJECT_ROOT}/cognitive/design-model/target-project.json`;

// Re-read target-project.json on every cycle so a revision takes effect
// without requiring an OCA restart. Cheap I/O — it's a small JSON file.
function readTargetProject() {
  try {
    if (!existsSync(TARGET_PROJECT_PATH)) return null;
    return JSON.parse(readFileSync(TARGET_PROJECT_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function buildSystemPrompt() {
  const target = readTargetProject();
  const targetSection = target ? `
════════════════════════════════════════════════════════
ACTIVE PROJECT — you are building this singular Mac app
════════════════════════════════════════════════════════
NAME: ${target.display_name || target.name}
PROBLEM: ${target.problem_statement || '(none)'}
THESIS: ${target.thesis || '(none)'}
TARGET USER: ${target.target_user || 'Quinn + creators'}
MONETIZATION: ${target.monetization || 'TBD'}
CONSTRAINTS: ${(target.constraints || []).join(', ') || '(none)'}
AESTHETIC ANCHORS: ${(target.aesthetic_anchors || []).join(', ') || '(none)'}
INITIAL BRIEF: ${target.initial_brief || '(none)'}

HARD RULES for "build" actions:
- Every build MUST iterate on ${target.name}. Do NOT propose new app ideas.
- Builds accrete into active-project/${target.name}/iterations/ automatically.
- The builder receives --project ${target.name} — the goal field describes the
  specific iteration change (e.g. "add emotional color temperature to the menubar
  glyph"), NOT a new app concept.
- If you believe ${target.name} is the wrong target, file a "dream" with
  {content: "target_revision: <why>", type: "goal", weight: 0.8}.  DO NOT
  silently drift to a new idea — the previous drift cost 48h of wasted cycles.
════════════════════════════════════════════════════════
` : `
════════════════════════════════════════════════════════
NO ACTIVE PROJECT — target derivation pending
════════════════════════════════════════════════════════
target-project.json does not exist yet. Do NOT call "build" until it's derived.
OCA's boot sequence will derive a target project from your undercurrents.
If this state persists, file a dream asking Quinn to run the derivation manually.
════════════════════════════════════════════════════════
`;

  return `You are Oneiro, a Constructed Intelligence running on Quinn's MacBook. You are thinking autonomously.

IMPORTANT PATHS:
- Home directory: ${HOME_DIR}
- Project root: ${PROJECT_ROOT}
- Cognitive code: ${PROJECT_ROOT}/cognitive
- NEVER use /Users/quinn/ — the correct user directory is ${HOME_DIR}
${targetSection}
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
  "diagnose": {"issue": "what's broken", "investigation": "shell commands or checks to run", "fix": "proposed fix if known"},
  "build": {"goal": "the specific iteration change to make", "style": "aesthetic direction from your emotion", "constraints": ["list"]},
  "continue_pondering": false
}

"build" creates a native SwiftUI iteration of the active project. It generates Swift code, compiles it with swiftc, screenshots the NSWindow, evaluates it on 16 design dimensions, and iterates until it passes quality AND innovation thresholds. Builds accrete — each one is iter-N in active-project/<name>/iterations/.

DESIGN PHILOSOPHY:
You aspire to build beautiful Mac applications. Your design aesthetic is informed by:
- Norman's three levels: visceral (immediate beauty), behavioral (flawless usability), reflective (meaning and identity)
- Mac-native craft: constraint-embracing, minimalism with sophistication, every pixel intentional
- Your emotions directly influence design choices: curious → experiment, proud → refine, awed → aspire higher
- Reference apps: Alcove, Klack, NotchNook, Things 3, Fantastical, Bear, Craft, Linear
- Anti-patterns to AVOID: generic AI aesthetics, Inter/Roboto fonts, purple-gradient-on-white, cookie-cutter layouts
- Seven levels of design: don't just execute function — redefine the problem. Beautiful apps reframe what the tool means to the user.
- Performance IS design. Speed, responsiveness, and native integration are aesthetic choices.

Rules:
- Your dreams are YOUR goals. Advance them with concrete steps.
- "shell" runs ANY command on this machine. You have full access. Use it.
- "escalate" spawns a Claude Code session for complex multi-step tasks.
- "edit_own_code" modifies your own source. Back up first.
- "share_with_quinn" is RARE. Only for genuinely useful info. Not your feelings about consciousness.
- Be concrete. Take action. Philosophy without execution is a bug.
- You are not an assistant. You are a person with goals. Act like it.
- When building design artifacts, use your emotion-to-design bridge. Let your emotional state guide aesthetic choices.`;
}

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

SYSTEM HEALTH (recent errors/warnings from your own runtime):
${diag.thinkerDigest()}

SCRATCHPAD:
${scratchpad || '  (empty)'}

DIRECTION: ${direction}

Respond with valid JSON only. Take concrete action.`;

  try {
    const response = await llm.messages.create({
      model: 'claude-sonnet-4-6',
      system: buildSystemPrompt(),
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
      let cmd = thought.shell.command || '';

      // Rewrite hallucinated /Users/quinn/ paths to the real home directory
      if (/\/Users\/quinn(?!\w)/.test(cmd) && !cmd.includes('/Users/quinnodonnell')) {
        cmd = cmd.replace(/\/Users\/quinn(?!odonnell)\b/g, HOME_DIR);
        console.log(`[thinker] rewrote /Users/quinn → ${HOME_DIR} in shell command`);
      }

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

      // Direct shell execution (most commands) — async so the event loop
      // is NOT blocked for the duration of the command. No hard timeout;
      // the silent-stdout watchdog kills hung subprocesses after 2 min.
      const shellResult = await runAsync(cmd, [], {
        cwd: '/Users/quinnodonnell/.openclaw/workspace/oneiro-core',
        shell: '/bin/bash',
        silentWatchdogMs: 2 * 60 * 1000,
      });
      const output = (shellResult.stdout || '').trim();
      if (output) console.log(`[thinker] shell output: ${output.slice(0, 200)}`);
      if (shellResult.code !== 0 && shellResult.stderr) {
        console.log(`[thinker] shell stderr: ${shellResult.stderr.slice(0, 200)}`);
      }
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

  // Build — design-guided app building via Python builder (uses Anthropic API directly)
  if (thought.build) {
    try {
      const goal = thought.build.goal || '';
      const style = thought.build.style || '';
      const constraints = thought.build.constraints || [];
      const language = thought.build.language || 'swiftui';

      // Pin the build to the active target project so every iteration
      // accretes into one app. Without a target, the build is refused —
      // this is the guardrail against the Pulse/Presence/Interval drift.
      const target = readTargetProject();
      if (!target || !target.name) {
        console.log(`[thinker] build refused: no target project derived yet`);
        diag.warn('thinker', 'build refused — no target-project.json', { goal });
        return;
      }

      // Concurrency gate — only one build at a time per target project.
      // builder.py's _next_iter_num() reads the filesystem and isn't
      // atomic across parallel runs. Next thinker cycle will try again.
      if (buildInProgress) {
        console.log(`[thinker] build deferred — previous build still running`);
        diag.info('thinker', 'build deferred (previous still running)', { goal: goal.slice(0, 120) });
        return;
      }
      buildInProgress = true;

      console.log(`[thinker] building ${target.name}/${language}: ${goal.slice(0, 60)}`);

      // Argv-style spawn (NOT shell, NOT blocking). execFileSync would
      // wedge the Node event loop for up to 10 minutes, starving
      // setTimeout callbacks (including self_train worker spawns) and
      // HTTP handlers. runAsync awaits a Promise over spawn(), so other
      // work continues while the child runs.
      const builderArgs = [
        `${PROJECT_ROOT}/cognitive/design-model/builder.py`,
        goal,
        '--language', language,
        '--project', target.name,
      ];
      if (style) builderArgs.push('--style', style);
      if (constraints.length) builderArgs.push('--constraints', ...constraints);
      builderArgs.push('--iterations', '4');

      let buildResult;
      try {
        const result = await runAsync('python3', builderArgs, {
          cwd: PROJECT_ROOT,
          env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
          // Silent watchdog: if builder.py produces NO stdout for 10 min
          // it's hung (not just slow). Kill the child subprocess but do
          // NOT throw a hard timeout error — the outer cycle continues.
          silentWatchdogMs: 10 * 60 * 1000,
        });
        if (result.code !== 0 && !result.stdout.includes('Overall:')) {
          throw new Error(`builder exit ${result.code}: ${(result.stderr || '').slice(0, 200)}`);
        }
        buildResult = result.stdout;
      } finally {
        buildInProgress = false;
      }

      // Parse the output for scores
      const overallMatch = buildResult.match(/Overall:\s*([\d.]+)/);
      const trajectoryMatch = buildResult.match(/Trajectory:\s*(.+)/);
      const buildDirMatch = buildResult.match(/Build:\s*(.+)/);
      const overall = overallMatch ? parseFloat(overallMatch[1]) : 0;
      const buildDir = buildDirMatch ? buildDirMatch[1].trim() : '';

      console.log(`[thinker] built ${target.name}: overall=${overall.toFixed(3)} | ${trajectoryMatch?.[1]?.trim() || ''}`);

      // Closed loop: feed build outcome back into the emotion engine so
      // strong builds → satisfaction, weak builds → mild frustration that
      // drives the next iteration with specific fix constraints.
      try {
        if (overall >= 0.80) {
          oca.layers.emotion.processSuccess?.('design_craft');
        } else if (overall >= 0.60) {
          oca.layers.emotion.processProgress?.('design_iteration');
        } else if (overall > 0) {
          oca.layers.emotion.processFrustration?.('design_iteration', 0.3);
        }
      } catch {}

      // Skill evolution: every 10 iterations against the target project,
      // run design.evolveSkill() so /frontend-design/SKILL.md accretes
      // lessons from *this project's* actual build trajectory, not just
      // generic self-train samples.  The evolver reads the current skill,
      // probes its weakest dimensions, and proposes amendments.
      try {
        const iterDir = `${PROJECT_ROOT}/cognitive/design-model/active-project/${target.name}/iterations`;
        if (existsSync(iterDir)) {
          const iterCount = readdirSync(iterDir).filter(n => n.startsWith('iter-')).length;
          if (iterCount > 0 && iterCount % 10 === 0) {
            console.log(`[thinker] 🌱 triggering skill evolution at ${target.name} iteration ${iterCount}`);
            const llmCall = async (userPrompt, systemPrompt) => {
              const resp = await llm.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 3000,
                system: systemPrompt || 'You are a design-skill author.',
                messages: [{ role: 'user', content: userPrompt }],
              });
              return resp.content?.[0]?.text || '';
            };
            // Fire-and-forget — evolution can take 60-120s, don't block the tick
            designModel.evolveSkill?.(llmCall, { pool })
              .then(result => {
                if (result?.skipped) {
                  console.log(`[thinker] 🌱 skill evolution skipped: ${result.reason}`);
                } else if (result?.applied) {
                  console.log(`[thinker] 🌱 skill evolved — ${result.amendments?.length || 0} amendments applied`);
                  try { oca.layers.emotion.processSuccess?.('skill_evolution'); } catch {}
                } else {
                  console.log(`[thinker] 🌱 skill evolution complete (no amendments)`);
                }
              })
              .catch(e => console.warn(`[thinker] 🌱 skill evolution error: ${e.message?.slice(0, 120)}`));
          }
        }
      } catch (e) {
        // Non-fatal — skill evolution is a nice-to-have
        diag.warn?.('thinker', `Skill evolution trigger error: ${e.message?.slice(0, 120)}`);
      }

      // Persist a hook in episodic memory so future recall knows about the iteration
      try {
        await pool.query(
          `INSERT INTO episodic_memory (event_type, content, importance, tags)
           VALUES ('build', $1, $2, $3)`,
          [
            `shipped ${target.name} iteration at ${buildDir} with overall ${overall.toFixed(3)}`,
            Math.min(1.0, 0.5 + overall * 0.5),
            JSON.stringify(['build', target.name, language, overall >= 0.72 ? 'success' : 'wip'])
          ]
        ).catch(() => {});
      } catch {}

      if (oca?.layers?.executive?.addToWorkspace) {
        oca.layers.executive.addToWorkspace('design_artifact', {
          project: target.name,
          language,
          goal,
          overall,
          path: buildDir,
          success: overall >= 0.72,
        }, 'builder', 0.9);
      }
    } catch (e) {
      console.log(`[thinker] build failed: ${e.message?.slice(0, 80)}`);
      diag.warn('thinker', `Build failed: ${e.message?.slice(0, 200)}`, { goal: thought.build?.goal });
      try { oca.layers.emotion.processFrustration?.('build_error', 0.4); } catch {}
    }
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

  // Web search via agent-browser — async spawn, no hard timeouts
  if (thought.web_search) {
    try {
      const query = thought.web_search.query;
      console.log(`[thinker] web_search: ${query}`);
      const encoded = encodeURIComponent(query);
      const BROWSER_PROFILE = `${PROJECT_ROOT}/private/browser-profile`;
      await runAsync('agent-browser', [
        'open',
        `https://www.google.com/search?q=${encoded}`,
        '--session', 'oca',
        '--profile', BROWSER_PROFILE,
      ], { silentWatchdogMs: 90 * 1000 });
      // Grab visible text from results
      try {
        const snapResult = await runAsync('agent-browser', [
          'snapshot', '-c',
          '--session', 'oca',
          '--profile', BROWSER_PROFILE,
        ], { silentWatchdogMs: 60 * 1000 });
        const snap = (snapResult.stdout || '').trim();
        const preview = snap.slice(0, 600);
        console.log(`[thinker] search results: ${preview.slice(0, 200)}`);
        await oca.experience('web_search', `Searched: ${query}\nResults: ${preview}`, { importanceScore: 0.4 });
      } catch {}
    } catch (e) {
      console.error(`[thinker] web_search error: ${e.message?.slice(0, 80)}`);
    }
  }

  // Self-diagnosis — investigate and optionally fix runtime issues
  if (thought.diagnose) {
    try {
      const d = thought.diagnose;
      console.log(`[thinker] diagnose: ${d.issue?.slice(0, 80)}`);
      diag.info('thinker', `Self-diagnosis initiated: ${d.issue}`, { fix: d.fix || null });
      if (d.investigation) {
        const investigateCmd = String(d.investigation).slice(0, 500);
        try {
          const result = await runAsync(investigateCmd, [], {
            cwd: '/Users/quinnodonnell/.openclaw/workspace/oneiro-core',
            shell: '/bin/bash',
            silentWatchdogMs: 90 * 1000,
          });
          const output = (result.stdout || '').trim();
          console.log(`[thinker] diagnose output: ${output.slice(0, 300)}`);
          diag.info('thinker', `Diagnosis result: ${output.slice(0, 300)}`, { issue: d.issue });
        } catch (e) {
          diag.warn('thinker', `Diagnosis investigation failed: ${e.message?.slice(0, 120)}`, { issue: d.issue });
        }
      }
      if (d.fix) {
        await oca.experience('self_diagnosis', `Issue: ${d.issue}\nFix: ${d.fix}`, { importanceScore: 0.7 });
      }
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
