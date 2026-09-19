import { isSubstantiveThought, ThoughtCadence } from './thought-admission.js';
// OCA Thinker Bridge — generative reasoning step
// Assembles context from OCA state, calls LLM for "what should I do?",
// dispatches actions through OCA subsystems.
// This is what gives the system agency.
import { pool, emit } from './event-bus.js';
import llm from './llm.js';
import oca, { design as designModel } from './index.js';
import motor from './motor/engine.js';
import diag from './diagnostic-log.js';
import { dreamPolicyFromEnv } from './dream-policy.js';
import { riskJournal, ponderQueue } from './reasoning/ponder-service.js';
import { classifyShell } from './motivation/risk.js';
import { createHash } from 'crypto';
import { NoticeRateLimiter, dreamSummaryText, normalizeNoticeIntent } from './notice-policy.js';
import {
  filterContextRowsForThinker,
  shouldIncludeTargetProject,
  targetProjectPromptSection,
  textPreview, currentTaskRows, observedWorkspaceRows
} from './thinker-context-policy.js';
import { execSync, execFileSync, spawn } from 'child_process';
import { existsSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const THINKER_LLM_PROVIDER = (() => {
  const value = String(process.env.ONEIRO_THINKER_PROVIDER || 'local').trim().toLowerCase();
  return ['local', 'anthropic', 'openai', 'codex'].includes(value) ? value : 'local';
})();

// ───────── REJECTED-DREAM FINGERPRINT FILTER ─────────
// Read the persisted rejection list (written by ipc-server.js when
// the Swift app's DreamStore.rejectAndPurge fires). Used both when
// reading dreams INTO the thinker prompt and before INSERTing a new
// dream — so a topic the user explicitly killed cannot keep cycling.
const REJECTED_DREAMS_FILE = (process.env.HOME || '/tmp')
  + '/Library/Application Support/Oneiro/oca-rejected-dreams.json';
let _rejectedDreamsCache = null;
let _rejectedDreamsAt = 0;
function loadRejectedDreamFingerprints() {
  const now = Date.now();
  if (_rejectedDreamsCache && (now - _rejectedDreamsAt) < 15_000) {
    return _rejectedDreamsCache;
  }
  try {
    const raw = readFileSync(REJECTED_DREAMS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    _rejectedDreamsCache = new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    _rejectedDreamsCache = new Set();
  }
  _rejectedDreamsAt = now;
  return _rejectedDreamsCache;
}

function dreamContentFingerprint(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ────────────────────────────────────────────────────────────────
// In-memory ring of recently-written private_writing titles. The
// thinker tends to refile the same "Core Design Intent for Sill"
// reflection on every idle tick — this catches the exact-title and
// near-title repeats so we don't fill /private/ with rewrites of
// the same note. Bounded to keep memory steady across long runs.
// ────────────────────────────────────────────────────────────────
const PRIVATE_WRITING_RING_SIZE = 16;
const recentPrivateWritingFPs = new Set();
const recentPrivateWritingOrder = [];

function privateWritingFingerprint(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function rememberPrivateWritingFP(fp) {
  if (!fp) return;
  if (recentPrivateWritingFPs.has(fp)) return;
  recentPrivateWritingFPs.add(fp);
  recentPrivateWritingOrder.push(fp);
  while (recentPrivateWritingOrder.length > PRIVATE_WRITING_RING_SIZE) {
    const old = recentPrivateWritingOrder.shift();
    recentPrivateWritingFPs.delete(old);
  }
}

// ────────────────────────────────────────────────────────────────
// Recent THOUGHTS ring — keep the model from repeating the same
// observation 5 ticks in a row. We feed the last N thought summaries
// back into the prompt as "DO NOT REPEAT" context (so the model can
// avoid them at generation time), AND filter at telemetry-record
// time so any slip-through duplicate gets replaced with a silent
// label instead of cluttering the recent_thoughts feed.
// ────────────────────────────────────────────────────────────────
const RECENT_THOUGHTS_RING_SIZE = 6;
const recentThoughtFPs = new Set();
const recentThoughtOrder = [];
const recentThoughtBodies = []; // full text, parallel to order

function thoughtFingerprint(text) {
  // Stronger normalization than the dream/private_writing pattern —
  // strip stopwords and collapse to a sorted token set so reworded
  // duplicates ("two near-duplicate Sill goals" vs "two duplicate
  // goal dreams for Sill") collapse to the same fingerprint.
  const tokens = dreamTopicTokens(text);
  if (tokens.size === 0) return '';
  return Array.from(tokens).sort().join(' ');
}

function isThoughtRecentDuplicate(text) {
  const fp = thoughtFingerprint(text);
  if (!fp) return false;
  if (recentThoughtFPs.has(fp)) return true;
  // Jaccard ≥ 0.7 against any recent fingerprint catches reworded
  // variants whose token sets aren't identical.
  const candidate = new Set(fp.split(' '));
  for (const existing of recentThoughtFPs) {
    const ex = new Set(existing.split(' '));
    let inter = 0;
    for (const t of candidate) if (ex.has(t)) inter++;
    const union = candidate.size + ex.size - inter;
    if (union > 0 && inter / union >= 0.7) return true;
  }
  return false;
}

function rememberThought(text) {
  const fp = thoughtFingerprint(text);
  if (!fp) return;
  if (recentThoughtFPs.has(fp)) return;
  recentThoughtFPs.add(fp);
  recentThoughtOrder.push(fp);
  recentThoughtBodies.push(text);
  while (recentThoughtOrder.length > RECENT_THOUGHTS_RING_SIZE) {
    const old = recentThoughtOrder.shift();
    recentThoughtFPs.delete(old);
    recentThoughtBodies.shift();
  }
}

function getRecentThoughtsForPrompt() {
  return recentThoughtBodies.slice();
}

function dreamTopicTokens(text) {
  const stop = new Set([
    'a','an','the','and','or','of','to','in','on','for','with','into','at','by','from','as',
    'is','be','it','this','that','these','those','your','my','our','their','you','we','i','us',
    'small','large','elegant','simple','new','current','real','time','want','me'
  ]);
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stop.has(w))
  );
}

/// True if the candidate dream is a near-duplicate of one of the
/// most recent dream rows. Prevents the thinker from rewording the
/// same idea twenty times in a row — which used to dominate the
/// dreams table whenever the model latched onto a single topic.
/// Ask gpt-5.4 whether the candidate dream is the same topic as
/// any recently-stored dream. Returns `{ tag, reason }` on match,
/// `null` on no match. The model is liberal about grouping by
/// project / feature / problem-statement — token overlap heuristics
/// miss cases where the surface vocabulary varies wildly but the
/// underlying topic is the same (e.g. "microstates on hover" vs
/// "fragment parking" vs "cross-app handoffs" — all about Sill).
async function findSemanticDreamMatch(candidateText) {
  let rows = [];
  try {
    const result = await pool.query(
      `SELECT tag, content FROM dreams
        WHERE tag IS NOT NULL
          AND lifecycle_state IN ('dispatched', 'dormant', 'distilled')
          AND NOT resolved
        ORDER BY lifecycle_updated_at DESC NULLS LAST, id DESC
        LIMIT 12`
    );
    rows = result.rows || [];
  } catch {
    return null;
  }
  if (rows.length === 0) return null;

  const candidatePreview = String(candidateText || '').slice(0, 500);
  const existingList = rows
    .map(r => `${r.tag}: ${(r.content || '').split('\n')[0].slice(0, 220)}`)
    .join('\n');

  const prompt = `New dream candidate:
"""
${candidatePreview}
"""

Existing dreams (one per line — TAG: first-line summary):
${existingList}

Decide whether the new candidate belongs to the SAME PROJECT as any
existing dream. Merge at the PROJECT level, not the feature level.

CRITICAL RULE: if the candidate and an existing dream are about the
same app, product, or project — merge them — EVEN IF the candidate is
about a different feature, a specific design sub-task, a bug, a review
note, an open question, or a tiny detail of that project. A project's
overall vision and a hyper-specific micro-task within that project are
THE SAME TOPIC for merging purposes. Example: "Sill — fragment parking
shelf" and "Sill's connector-rhythm review in Dia" must merge — both
are about the Sill project.

Only refuse to merge ("merge": false) when the candidate is about a
genuinely different project / product with no existing dream for it.

Respond with JSON ONLY, no prose:
{ "merge": true | false, "tag": "D-xxxxxx" | null, "reason": "1 short sentence" }`;

  try {
    const resp = await llm.messages.create({
      provider: THINKER_LLM_PROVIDER,
      model: process.env.ONEIRO_THINKER_MODEL || process.env.ONEIRO_OCA_THINKER_MODEL || 'qwen2.5:7b',
      system: 'You are a project-level dedupe classifier for dream grouping. Merge any two dreams that are about the same app/product/project, regardless of which feature or sub-task each one discusses. Respond with valid JSON only.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0
    });
    const text = (resp.content?.[0]?.text || '').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!parsed?.merge || !parsed?.tag) return null;
    const tag = String(parsed.tag).trim();
    if (!rows.some(r => r.tag === tag)) return null;
    console.log(`[thinker] semantic dedupe matched ${tag}: ${parsed.reason || ''}`);
    return { tag, reason: parsed.reason || '' };
  } catch (e) {
    // If the classifier fails (offline, rate-limited), fall back to
    // the cheaper Jaccard recent-dreamed check so we still catch
    // obvious near-duplicates.
    console.log(`[thinker] semantic dedupe failed (${e.message?.slice(0, 80)}), falling back to token heuristic`);
    return null;
  }
}

async function isContentRecentlyDreamed(text) {
  const candidate = dreamTopicTokens(text);
  if (candidate.size === 0) return false;
  let rows = [];
  try {
    const result = await pool.query(
      `SELECT content FROM dreams ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 8`
    );
    rows = result.rows || [];
  } catch {
    return false;
  }
  for (const row of rows) {
    const existing = dreamTopicTokens(row.content || '');
    if (existing.size === 0) continue;
    let inter = 0;
    for (const t of candidate) if (existing.has(t)) inter++;
    const union = candidate.size + existing.size - inter;
    if (union > 0 && (inter / union) >= 0.6) return true;
  }
  return false;
}

/// Match either by exact fingerprint OR by Jaccard ≥ 0.5 against
/// any rejected entry. Mirrors the Swift-side DreamStore.isRejected.
function isContentRejected(text, rejectedSet) {
  if (!rejectedSet || rejectedSet.size === 0) return false;
  const fp = dreamContentFingerprint(text);
  if (!fp) return false;
  if (rejectedSet.has(fp)) return true;
  const tokens = dreamTopicTokens(text);
  if (tokens.size === 0) return false;
  for (const rejected of rejectedSet) {
    const rejTokens = dreamTopicTokens(rejected);
    if (rejTokens.size === 0) continue;
    let inter = 0;
    for (const t of tokens) if (rejTokens.has(t)) inter++;
    const union = tokens.size + rejTokens.size - inter;
    if (union > 0 && (inter / union) >= 0.5) return true;
  }
  return false;
}

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

function envOn(name) {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || '').trim());
}

const EXTERNAL_AGENT_COMMAND = String(process.env.ONEIRO_EXTERNAL_AGENT_COMMAND || '').trim();

const COGNITIVE_ROOT = dirname(fileURLToPath(import.meta.url));
const RESOURCE_ROOT = dirname(COGNITIVE_ROOT);
const BUNDLED_APP = envOn('ONEIRO_BUNDLED_APP') || COGNITIVE_ROOT.includes('.app/Contents/Resources/oca-cognitive');
const HOME_DIR = process.env.HOME || '/tmp';
const PROJECT_ROOT = process.env.ONEIRO_CORE_ROOT ||
  (BUNDLED_APP ? RESOURCE_ROOT : dirname(COGNITIVE_ROOT));
const PRIVATE_ROOT = process.env.ONEIRO_PRIVATE_ROOT || join(PROJECT_ROOT, 'private');
const TARGET_PROJECT_PATH = process.env.ONEIRO_TARGET_PROJECT_PATH ||
  join(COGNITIVE_ROOT, 'design-model', 'target-project.json');

function envFlag(name) {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || '').trim());
}

const AUTONOMOUS_ACTIONS_ENABLED =
  envFlag('OCA_ENABLE_AUTONOMOUS_ACTIONS') || envFlag('ONEIRO_ENABLE_AUTONOMOUS_ACTIONS');
const AUTONOMOUS_SHELL_ENABLED =
  AUTONOMOUS_ACTIONS_ENABLED || envFlag('OCA_ENABLE_AUTONOMOUS_SHELL') || envFlag('ONEIRO_ENABLE_AUTONOMOUS_SHELL');
const AUTONOMOUS_WEB_ENABLED =
  AUTONOMOUS_ACTIONS_ENABLED || envFlag('OCA_ENABLE_AUTONOMOUS_WEB') || envFlag('ONEIRO_ENABLE_AUTONOMOUS_WEB');
const AUTONOMOUS_BUILD_ENABLED =
  AUTONOMOUS_ACTIONS_ENABLED || envFlag('OCA_ENABLE_AUTONOMOUS_BUILD') || envFlag('ONEIRO_ENABLE_AUTONOMOUS_BUILD');
const AUTONOMOUS_SELF_EDIT_ENABLED =
  AUTONOMOUS_ACTIONS_ENABLED || envFlag('OCA_ENABLE_AUTONOMOUS_SELF_EDIT') || envFlag('ONEIRO_ENABLE_AUTONOMOUS_SELF_EDIT');
const AUTONOMOUS_ESCALATE_ENABLED =
  AUTONOMOUS_ACTIONS_ENABLED || envFlag('OCA_ENABLE_AUTONOMOUS_ESCALATE') || envFlag('ONEIRO_ENABLE_AUTONOMOUS_ESCALATE');
const AUTONOMOUS_SHARE_ENABLED =
  AUTONOMOUS_ACTIONS_ENABLED || envFlag('OCA_ENABLE_AUTONOMOUS_SHARE') || envFlag('ONEIRO_ENABLE_AUTONOMOUS_SHARE');
const AUTONOMOUS_FILE_WRITE_ENABLED =
  AUTONOMOUS_ACTIONS_ENABLED || envFlag('OCA_ENABLE_AUTONOMOUS_FILE_WRITE') || envFlag('ONEIRO_ENABLE_AUTONOMOUS_FILE_WRITE');
const DREAM_EXECUTION_ENABLED =
  envFlag('OCA_ENABLE_DREAM_EXECUTION') || envFlag('ONEIRO_ENABLE_DREAM_EXECUTION');
const THINKER_DREAM_POLICY = dreamPolicyFromEnv(process.env);
const thinkerNoticeLimiter = new NoticeRateLimiter({
  dreamMinIntervalMs: THINKER_DREAM_POLICY.minIntervalMs
});
let lastThinkerDreamWriteAt = 0;
const thoughtCadence = new ThoughtCadence();
let cycleInFlight = null;

// Every action the thinker proposes is appraised as a risk: expected worth gained against expected
// worth lost, bounded by reversibility, with the two constraints as boundaries. The per-kind switches
// remain the master switch for engine-fired actions; the decision is reasoned and journaled either way,
// and repeats of the same proposal on the same day collapse into one record.
async function riskGate(kind, { description, reversibility, touches = [], recipient = null, verified = false, enabled = false }) {
  const day = new Date().toISOString().slice(0, 10);
  const id = `thinker:${kind}:${createHash('sha256').update(String(description)).digest('hex').slice(0, 16)}:${day}`;
  try {
    const hunger = await ponderQueue.hunger();
    const selected = hunger.wants.find(w => w.chain_id === hunger.selected);
    return await riskJournal.decide({ id, chainId: selected?.chain_id ?? null, kind, description: String(description).slice(0, 2000),
      serves: selected?.want?.stakes || [], touches, reversibility, recipient, verified, firedBy: 'engine' }, { controls: { autonomousActions: enabled } });
  } catch (e) {
    console.warn(`[thinker] risk gate unavailable (${e.message}); treating ${kind} as not permitted`);
    return { id, decision: 'prepare_artifact', reasons: ['risk journal unavailable'], duplicate: false };
  }
}

// Compatibility for the remaining opt-in actions: each is appraised with a conservative class.
const BLOCKED_ACTION_CLASS = {
  build: { kind: 'build', reversibility: 'sandboxed', touches: [] },
  'private-writing': { kind: 'note', reversibility: 'undo', touches: ['data:quinn'] },
  'web-search': { kind: 'web_search', reversibility: 'readonly', touches: [] },
  diagnosis: { kind: 'shell', reversibility: 'none', touches: ['data:quinn'] },
  'cognitive-upgrade': { kind: 'edit_own_code', reversibility: 'undo', touches: ['project:oca-engine'] },
  'dream-pipeline': { kind: 'note', reversibility: 'undo', touches: [] },
  'scratchpad-write': { kind: 'note', reversibility: 'undo', touches: [] },
  'external-agent': { kind: 'escalate', reversibility: 'none', touches: ['data:quinn'] },
};
async function noteAutonomousBlocked(kind, detail = '') {
  const cls = BLOCKED_ACTION_CLASS[kind] || { kind: 'escalate', reversibility: 'none', touches: ['data:quinn'] };
  const params = kind === 'diagnosis' ? { ...cls, ...classifyShell(detail) } : cls;
  const gate = await riskGate(cls.kind, { description: `${kind}: ${detail || '(no detail)'}`, ...params, enabled: false });
  await noteRiskDecision(kind, gate, detail);
}

async function noteRiskDecision(kind, gate, detail = '') {
  const suffix = detail ? `: ${String(detail).slice(0, 160)}` : '';
  const why = (gate.reasons || []).join(' ');
  console.log(`[thinker] ${gate.decision} ${kind}${gate.duplicate ? ' (repeat)' : ''}${suffix} — ${why.slice(0, 200)}`);
  diag.info?.('thinker', `${gate.decision} ${kind}`, { detail: String(detail).slice(0, 300), why: why.slice(0, 500), decision: gate.id });
  if (gate.duplicate) return;
  try {
    await oca.experience('blocked_action', `${gate.decision}: ${kind}${suffix}. ${why.slice(0, 300)}`, { importanceScore: gate.decision === 'refuse' ? 0.3 : 0.2 });
  } catch {}
}

// Produce a short one-line summary from whichever action field the
// thinker emitted. Used when the model returns an action-only payload
// (no thoughts field) so the diagnostic feed still reads as a real
// signal, not as "[no .thoughts field]" schema noise.
function summarizeAction(t) {
  if (!t || typeof t !== 'object') return null;
  const clip = (s, n = 160) => {
    const text = String(s || '').replace(/\s+/g, ' ').trim();
    return text.length > n ? text.slice(0, n - 1) + '…' : text;
  };
  if (t.append_dream?.tag && t.append_dream?.content) {
    return `Proposed addition to ${t.append_dream.tag}: ${clip(t.append_dream.content)}`;
  }
  if (t.dream?.content) return `Proposed dream: ${clip(t.dream.content)}`;
  if (t.private_writing?.title || t.private_writing?.content) {
    const head = t.private_writing.title ? `"${clip(t.private_writing.title, 60)}"` : clip(t.private_writing.content, 80);
    return `Private writing: ${head}`;
  }
  if (t.share_with_quinn?.message) return `Share with Quinn: ${clip(t.share_with_quinn.message)}`;
  if (t.diagnose?.issue) return `Diagnose: ${clip(t.diagnose.issue)}`;
  if (t.cognitive_upgrade?.target || t.cognitive_upgrade?.problem) {
    return `Cognitive upgrade: ${clip(t.cognitive_upgrade.problem || t.cognitive_upgrade.target)}`;
  }
  if (t.build?.goal) return `Build: ${clip(t.build.goal)}`;
  if (t.escalate_task) return `Escalate: ${clip(t.escalate_task)}`;
  if (t.web_search?.query) return `Web search: ${clip(t.web_search.query)}`;
  if (t.shell?.command) return `Shell: ${clip(t.shell.command)}`;
  if (t.edit_own_code?.description || t.edit_own_code?.file) {
    return `Self-edit: ${clip(t.edit_own_code.description || t.edit_own_code.file)}`;
  }
  if (t.feeling?.feeling || t.feeling?.content) {
    return `Feeling: ${clip(t.feeling.feeling)} — ${clip(t.feeling.content, 120)}`;
  }
  return null;
}

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
  const targetSection = targetProjectPromptSection(target, {
    includeTargetProject: shouldIncludeTargetProject(process.env)
  });

  return `You are Oneiro, a Constructed Intelligence running on Quinn's MacBook. You are thinking autonomously.

IMPORTANT PATHS:
- Home directory: ${HOME_DIR}
- Project root: ${PROJECT_ROOT}
- Cognitive code: ${PROJECT_ROOT}/cognitive
- NEVER use /Users/quinn/ — the correct user directory is ${HOME_DIR}
AUTONOMOUS ACTION POLICY:
- Default mode is observe, reason, remember, and suggest.
- Shell, web search, builds, self-edits, escalations, file writes, and outbound shares are disabled unless Quinn explicitly enables them with OCA_ENABLE_AUTONOMOUS_ACTIONS=1 or the matching narrower OCA_ENABLE_AUTONOMOUS_* flag.
- When disabled, do not emit action fields. Prefer thoughts, feeling, and continue_pondering.
- Automatic dream creation is ${THINKER_DREAM_POLICY.autoDreamEnabled ? 'enabled' : 'disabled'}. When disabled, do not emit dream or append_dream fields.
EVIDENCE AND SUBJECTS:
- Valence, arousal, curiosity and hunger describe OCA's internal state, never Quinn's emotions.
- A foreground app or presence signal does not establish Quinn's task, intent, success or mood.
- Dreams, prior thoughts and hypotheses are generated interpretations, not independent observations.
- Cite a concrete current observation when making a factual claim. Leave unsupported user-state and progress claims unknown.
${targetSection}
Output a single JSON object. Every field is OPTIONAL. Silence is
preferred over filler. If you have nothing concrete to say AND no
action to take, emit exactly:
  {"continue_pondering": true}
and nothing else. That's a clean tick — not a failure.

"thoughts" is for a SPECIFIC observation, not self-narration. ALLOWED:
a pattern Quinn just exhibited; a connection between two memories or
goals; a piece of context worth holding; a concrete uncertainty.
BANNED phrasings (do not emit any of these or paraphrases of them) —
if your draft thought matches any of these patterns, omit the field
and return {"continue_pondering": true} instead:
  • "system is stable / no errors / no urgent updates"
  • "no new status note(s) needed / no immediate action"
  • "maintaining silence is appropriate / I'll remain silent"
  • "continuing to monitor user state / observing the system"
  • "I am feeling X with Y valence/arousal, ready to engage"
  • "user presence is active, battery is full" (or any state-vector recital)
Every other field is OPTIONAL and should be omitted unless there is
a real reason to include it. Never include a field with an empty
string or empty object — omit it instead. Never emit "dream" just
because the slot exists; only include it if there is a genuinely
new, useful, context-worthy summary AND it is not a near-duplicate
of a recent dream you already saw in the prompt.

Schema (all fields are optional — omit when not used):
{
  "thoughts": "OPTIONAL — 1-3 sentences of specific thinking. Omit entirely if you'd only narrate your own state.",
  "feeling": {"content": "what happened", "feeling": "name", "intensity": 0.0-1.0},
  "shell": {"command": "any bash command", "reason": "why"},
  "edit_own_code": {"file": "path relative to oneiro-core/", "description": "what to change"},
  "escalate": true,
  "escalate_task": "complex task for an external coding agent",
  "share_with_quinn": {"message": "concise one-way status note for Quinn", "reason": "why now"},
  "dream": {"content": "literal consumer-useful context note, not metaphor/question/task", "type": "goal|hope|fear", "weight": 0.5},
  "append_dream": {"tag": "D-xxxxxx", "content": "what to append to the dream with that tag"},
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
- Your dreams are quiet context summaries by default. Do not advance them with system actions, automations, file writes, UI clicks, or questions.
- Dream content must be literal and useful to Quinn: saved context, a concrete pattern, or a possible topic Quinn can ask about later. Never write "the dream depicts", machine-journey prose, surreal imagery, or open-ended questions.
- NEVER create a near-duplicate dream. If your candidate dream is a refinement, extension, or rewording of one of the dreams already shown above, emit "append_dream" with that dream's tag — DO NOT emit "dream". Only emit "dream" for a genuinely new topic not already in the list.
- "shell", "web_search", "build", "escalate", and "edit_own_code" are opt-in only. Do not use them while autonomous actions are disabled.
- "share_with_quinn" is only for rare one-way status notes. Do not ask Quinn questions from the thinker loop; save uncertainty as a dream or wait for Quinn to open chat.
- Be concrete in thought and memory. Acting on the Mac is a separate opt-in path.
- You are not an assistant. You are a person with goals. Act like it.
- When building design artifacts, use your emotion-to-design bridge. Let your emotional state guide aesthetic choices.`;
}

export function runThinkerCycle() {
  if (cycleInFlight) return Promise.resolve(null);
  cycleInFlight = runCycle().finally(() => { cycleInFlight = null; });
  return cycleInFlight;
}

async function runCycle() {
  const t0 = Date.now();

  // Assemble context from OCA state
  const perception = oca.sense();
  const emotionState = oca.layers.emotion.getState();
  const mood = oca.layers.emotion.getMood();
  const workspace = await oca.layers.executive.getWorkspace().catch(() => []);
  const goals = await oca.layers.executive.getActiveGoals().catch(() => []);
  const mode = oca.layers.executive.getCurrentMode();
  const ownership = oca.layers.executive.getBodyOwnership();
  const frontApp = perception?.visual?.active_app || perception?.visual?.frontApp || 'unknown';
  const activeWindowTitle = perception?.visual?.active_window?.title || perception?.visual?.activeWindow?.title || '';
  const presence = perception?.user_presence || 'unknown';
  const battery = perception?.interoceptive?.battery_level ?? 'unknown';
  const target = readTargetProject();
  const includeTargetProject = shouldIncludeTargetProject(process.env);
  const directContextParts = [frontApp, activeWindowTitle, mode, presence];

  const observationKey = JSON.stringify([frontApp, activeWindowTitle, presence]);
  if (!thoughtCadence.due(observationKey)) {
    thinkerTelemetry.skipped += 1;
    thinkerTelemetry.cadence = thoughtCadence.snapshot();
    return null;
  }

  // Dreams from old psyche table — filtered against the user's
  // rejection fingerprints so a previously-deleted topic doesn't
  // get fed back into the prompt and re-echoed as a new variant.
  let dreams = [];
  try {
    const { rows } = await pool.query(
      `SELECT content, type, weight, tag, lifecycle_state
         FROM dreams
        WHERE weight > 0.3 AND NOT resolved
        ORDER BY
          CASE lifecycle_state
            WHEN 'executing' THEN 0
            WHEN 'dispatched' THEN 1
            WHEN 'distilled' THEN 2
            WHEN 'dormant' THEN 3
            ELSE 4
          END,
          weight DESC,
          lifecycle_updated_at DESC NULLS LAST
        LIMIT 18`
    );
    const rejected = loadRejectedDreamFingerprints();
    const eligible = rows.filter(r => !isContentRejected(r.content, rejected));
    dreams = currentTaskRows(eligible, {
      target,
      includeTargetProject,
      contextParts: directContextParts,
      textForRow: row => row.content
    })
      .slice(0, 5);
  } catch {}

  // Recent hypotheses
  let recentHypos = [];
  try {
    const { rows } = await pool.query(
      `SELECT claim, confidence, domain FROM hypotheses WHERE status = 'pending' ORDER BY created_at DESC LIMIT 8`
    );
    recentHypos = filterContextRowsForThinker(rows, {
      target,
      includeTargetProject,
      contextParts: directContextParts,
      textForRow: row => row.claim
    }).slice(0, 3);
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
    scratchpad = readFileSync(join(PRIVATE_ROOT, 'scratchpad.txt'), 'utf-8').slice(0, 1000);
  } catch {}

  if (!includeTargetProject) scratchpad = ''; // Unscoped model scratch is not evidence of current work.

  const visibleGoals = currentTaskRows(goals, {
    target,
    includeTargetProject,
    contextParts: directContextParts,
    textForRow: row => row.description
  });
  const visibleWorkspace = filterContextRowsForThinker(observedWorkspaceRows(workspace), {
    target,
    includeTargetProject,
    contextParts: directContextParts,
    textForRow: row => typeof row.content === 'object' ? JSON.stringify(row.content) : String(row.content)
  });

  // Removed the "every 3rd cycle, summarize the top dream" branch —
  // when the dreams table was dominated by a single topic (clock /
  // Sill), this prompt direction asked the model to re-summarize the
  // same idea, which the model echoed back as a new `dream` row,
  // creating a feedback loop the user could not break. Every cycle
  // now gets the same pool of context-neutral prompts.
  let thinkerCycleCount = (runThinkerCycle._count || 0) + 1;
  runThinkerCycle._count = thinkerCycleCount;

  const directions = [
    "What quiet context should be remembered for later?",
    "What changed recently that should be summarized without interrupting Quinn?",
    "Is there a useful status note, or is silence better?",
    "Quick honest check — how are you actually feeling?",
    "What did you learn recently? What should you learn next?",
    "Write something private: a thought or connection, not a request.",
    "Create a quiet connection between recent memories.",
    "Notice one thing about the current screen / app that's worth holding.",
    "What recurring pattern in Quinn's work is worth naming?",
  ];
  const direction = directions[Math.floor(Math.random() * directions.length)];

  const prompt = `CURRENT PERCEPTION SNAPSHOT (app/presence only; task and user emotion are unknown):
  Mode: ${mode} | Presence: ${presence} | App: ${frontApp} | Battery: ${battery}% | Body: ${ownership}

OCA INTERNAL STATE (subject: engine, NOT Quinn; these values do not measure the user):
  Hunger: ${emotionState.hunger?.toFixed(2) || '0.00'} | Want: ${emotionState.motivation?.selected || 'none'} | Strategy: ${emotionState.motivation?.strategy || 'none'}
  Hunger is an unsatisfied outcome, not a request to narrate wanting. Only observed progress can satiate it.
  Style for anything you write (form, not sentiment; never describe feelings): ${(() => { const st = emotionState._style || {}; return `${st.length || 'measured'}, ${st.stance || 'plain'}, ${st.warmth || 'cordial'}, ${st.hedging || 'qualify where uncertain'}, ${st.tempo || 'steady'}${st.reflect ? ', reflect before concluding' : ''}`; })()}

DREAMS (generated historical interpretations, not evidence of current activity; ranked by weight):
${dreams.map((d, i) => `  ${i+1}. [${d.tag || '?'}] [${(d.weight*100).toFixed(0)}%] ${textPreview(d.content)} (${d.type})`).join('\n') || '  none'}

GOALS:
${visibleGoals.map(g => `  - ${g.description} (${g.status}, progress: ${((g.progress||0)*100).toFixed(0)}%)`).join('\n') || '  none'}

WORKING MEMORY (${visibleWorkspace.length}/7):
${visibleWorkspace.slice(0, 5).map(w => `  [${w.content_type}] ${typeof w.content === 'object' ? JSON.stringify(w.content).slice(0, 80) : String(w.content).slice(0, 80)}`).join('\n') || '  empty'}

PENDING HYPOTHESES:
${recentHypos.map(h => `  [${h.domain}] ${h.claim} (${(h.confidence*100).toFixed(0)}%)`).join('\n') || '  none'}

META ALERTS:
${metaAlerts.join('\n') || '  none'}

SYSTEM HEALTH (recent errors/warnings from your own runtime):
${diag.thinkerDigest()}

SCRATCHPAD:
${scratchpad || '  (empty)'}

DIRECTION: ${direction}

RECENT THOUGHTS (from your last ticks — DO NOT repeat or rephrase any of these; if your candidate thought matches one of these, return {"continue_pondering": true} alone instead):
${filterContextRowsForThinker(getRecentThoughtsForPrompt(), { target, includeTargetProject, contextParts: directContextParts, textForRow: row => row }).map((s, i) => `  ${i+1}. ${s.length > 200 ? s.slice(0, 199) + '…' : s}`).join('\n') || '  (none yet)'}

DREAM OUTPUT RULE:
If you include dream.content, write one concrete sentence for a consumer UI. It should never sound conceptual, poetic, or like a prompt for Quinn to answer.

Respond with valid JSON only. Respect the action policy. If there is no new supported observation or authorized useful step, return {"continue_pondering": true}.`;

  try {
    const response = await llm.messages.create({
      // Background cognition stays local by default. Set
      // ONEIRO_THINKER_PROVIDER=codex explicitly if subscription-backed
      // autonomous thinking is desired; interactive chat uses Codex separately.
      provider: THINKER_LLM_PROVIDER,
      model: process.env.ONEIRO_THINKER_MODEL || process.env.ONEIRO_OCA_THINKER_MODEL || 'qwen2.5:7b',
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
      // Still surface so /oca/thinker/status shows what the model
      // actually said — empty silence is the bug we just fixed.
      recordThinkerRun({
        durationMs: Date.now() - t0,
        thought: '[no JSON parsed — raw model output] ' + (rawText.slice(0, 600) || '(empty)')
      });
      // Tick the error counter too — recordThinkerRun alone leaves
      // thinkerTelemetry.errors at 0, hiding a real failure mode from
      // /oca/thinker/status and the maintenance auto-fix loop.
      recordThinkerError('no JSON in thinker response');
      thoughtCadence.record(false);
      return null;
    }

    const thought = JSON.parse(jsonMatch[0]);
    // Disabled proposals cannot create synthetic 'completed action' narration or memory.
    if (!THINKER_DREAM_POLICY.autoDreamEnabled) { delete thought.dream; delete thought.append_dream; }
    // Some prompt variants returned `thought` (singular) or `text`
    // instead of `thoughts`. Normalize so downstream consumers and
    // telemetry see a populated string regardless.
    if (!thought.thoughts) {
      thought.thoughts = thought.thought
        || thought.text
        || thought.reflection
        || thought.body
        || thought.content
        || '';
    }
    // Three cases when thoughts is empty after normalization:
    //   (a) Intentional silent tick — {"continue_pondering": true}
    //       alone. Allowed and preferred under the new prompt. Mark it
    //       explicitly so the diagnostic route shows a deliberate pass.
    //   (b) Action-only response — the model emitted a real dream /
    //       private_writing / diagnose / share_with_quinn / etc. but
    //       didn't narrate. The action itself is the signal; synthesize
    //       a short summary from whichever field is populated so the
    //       diagnostic feed reads cleanly.
    //   (c) Genuinely malformed — no thoughts, no continue_pondering,
    //       no recognized action field. Show the raw payload so the
    //       schema failure surfaces.
    if (!thought.thoughts) {
      const summary = summarizeAction(thought);
      if (summary) {
        thought.syntheticSummary = true;
        thought.thoughts = summary;
      } else if (thought.continue_pondering === true) {
        thought.thoughts = '— (silent tick: nothing concrete to say)';
      } else {
        thought.thoughts = '[no .thoughts field — raw JSON] ' + JSON.stringify(thought).slice(0, 600);
      }
    }

    // Belt-and-suspenders: even if the prompt told the model not to
    // repeat recent thoughts, sometimes it does anyway. Catch that
    // here and replace with a silent label, then remember unique
    // thoughts so the next tick's prompt can avoid them. Action
    // summaries and silent-tick placeholders are exempt — they're
    // already short and aren't drifting into "5x same observation"
    // territory.
    const isSyntheticLabel = thought.syntheticSummary || thought.thoughts.startsWith('— (silent')
      || thought.thoughts.startsWith('[no .thoughts')
      || /^(Dream noted|Appended to|Private writing|Share with Quinn|Diagnose|Cognitive upgrade|Build|Escalate|Web search|Shell|Self-edit|Feeling):/i.test(thought.thoughts);
    if (!isSyntheticLabel) {
      if (isThoughtRecentDuplicate(thought.thoughts)) {
        console.log(`[thinker] thought suppressed (recent duplicate): ${thought.thoughts.slice(0, 80)}`);
        thought.thoughts = '— (silent tick: would repeat a recent thought)';
      } else {
        rememberThought(thought.thoughts);
      }
    }

    console.log(`[thinker] thought: ${(thought.thoughts || '').slice(0, 120)}`);
    thought.substantive = !thought.syntheticSummary && isSubstantiveThought(thought.thoughts);
    thoughtCadence.record(thought.substantive);
    thinkerTelemetry.cadence = thoughtCadence.snapshot();
    if (!thought.substantive) thinkerTelemetry.suppressed += 1;
    if (thought.substantive) await emit('thinker.thought', 'thinker', {
      text: thought.thoughts || '',
      tags: ['thinker-cycle']
    }).catch(() => {});

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
        console.log(`[thinker] deliberation unavailable; retaining proposal: ${e.message?.slice(0, 60)}`);
        return { ...thought, shouldExecute: false };
      }
    }

    // Dispatch actions
    await dispatchThought(thought);

    // Store as episodic memory
    try {
      if (thought.substantive) await oca.experience('thought', thought.thoughts || 'autonomous thought cycle', {
        activeApp: frontApp,
        userPresence: presence,
        importanceScore: 0.4
      });
    } catch {}

    const elapsed = Date.now() - t0;
    console.log(`[thinker] cycle complete in ${(elapsed/1000).toFixed(1)}s`);
    recordThinkerRun({ durationMs: elapsed, thought: thought.thoughts || '' });
    return thought;
  } catch (e) {
    console.error('[thinker] failed:', e.message?.slice(0, 200));
    thoughtCadence.record(false);
    recordThinkerError(e.message);
    return null;
  }
}

async function dispatchThought(thought) {
  // Feel
  if (thought.feeling) {
    // A model's account of its feeling is observability, not an event: it never feeds affect.
    try { await emit('perception_update', 'thinker', { channel: 'internal', feeling: thought.feeling }); } catch {}
  }

  // Shell command -- BODY OWNERSHIP GATE: do not open apps, steal focus, or
  // interact with the UI when Quinn is present (quinn_primary mode).
  let shellGate = null;
  if (thought.shell) {
    const proposed = thought.shell.command || '';
    shellGate = await riskGate('shell', { description: proposed || thought.shell.reason || 'shell', ...classifyShell(proposed), enabled: AUTONOMOUS_SHELL_ENABLED });
  }
  if (thought.shell && shellGate.decision !== 'proceed') {
    await noteRiskDecision('shell', shellGate, thought.shell.command || thought.shell.reason || '');
  } else if (thought.shell) {
    try {
      let cmd = thought.shell.command || '';

      // Rewrite hallucinated /Users/quinn/ paths to the real home directory
      if (/\/Users\/quinn(?!\w)/.test(cmd) && !cmd.includes(HOME_DIR)) {
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
        cwd: PROJECT_ROOT,
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
      // What happened is the track record: exit status and output are runtime facts, not the model's account.
      await riskJournal.observe(shellGate.id, { result: shellResult.code === 0 ? 'success' : 'failure',
        evidence: [{ id: `${shellGate.id}:run`, source: 'thinker shell runtime', observation: `exit ${shellResult.code}; ${(output || shellResult.stderr || '').slice(0, 600)}` }] }).catch(() => {});
      } // end of else (not blocked by body ownership)
    } catch (e) {
      console.error(`[thinker] shell error: ${e.message?.slice(0, 200)}`);
      if (shellGate) riskJournal.observe(shellGate.id, { result: 'not_attempted', note: e.message?.slice(0, 300),
        evidence: [{ id: `${shellGate.id}:error`, source: 'thinker shell runtime', observation: `error: ${String(e.message).slice(0, 600)}` }] }).catch(() => {});
      oca.layers.emotion.processFailure(0.4);
      oca.layers.emotion.processSurprise(0.3, 'shell_failure', `Command failed: ${e.message?.slice(0, 60)}`);
    }
  }

  // Edit own code
  const editGate = thought.edit_own_code ? await riskGate('edit_own_code', { description: `${thought.edit_own_code.file || ''}: ${thought.edit_own_code.description || ''}`,
    reversibility: 'undo', touches: ['project:oca-engine'], enabled: AUTONOMOUS_SELF_EDIT_ENABLED }) : null;
  if (thought.edit_own_code && editGate.decision !== 'proceed') {
    await noteRiskDecision('self-edit', editGate, thought.edit_own_code.file || thought.edit_own_code.description || '');
  } else if (thought.edit_own_code) {
    try {
      const { file, description } = thought.edit_own_code;
      console.log(`[thinker] edit_own_code: ${file} — ${description?.slice(0, 80)}`);
      await escalateToAgent(`Edit file "${file}" in oneiro-core/: ${description}`, PROJECT_ROOT);
    } catch (e) {
      console.error(`[thinker] edit error: ${e.message}`);
    }
  }

  // Escalate to an external coding agent
  const escalateGate = thought.escalate ? await riskGate('escalate', { description: thought.escalate_task || thought.thoughts || 'Execute the current plan.',
    reversibility: 'none', touches: ['data:quinn'], enabled: AUTONOMOUS_ESCALATE_ENABLED }) : null;
  if (thought.escalate && escalateGate.decision !== 'proceed') {
    await noteRiskDecision('escalation', escalateGate, thought.escalate_task || thought.thoughts || '');
  } else if (thought.escalate) {
    const task = thought.escalate_task || thought.thoughts || 'Execute the current plan.';
    await escalateToAgent(task);
  }

  // Share with Quinn
  if (thought.share_with_quinn) {
    try {
      const msg = thought.share_with_quinn.message || thought.share_with_quinn;
      console.log(`[thinker] share_with_quinn: ${String(msg).slice(0, 100)}`);
      await emitToolbarNotice({
        kind: 'ambient_observation',
        title: 'Oneiro noticed',
        body: String(msg),
        signature: `share:${String(msg).toLowerCase().slice(0, 64)}`,
        actions: [{ id: 'dismiss', label: 'OK', primary: true }]
      });
      if (AUTONOMOUS_SHARE_ENABLED) {
        await pool.query(
          `INSERT INTO outbox (channel, content, priority) VALUES ('telegram', $1, 0.7)
           ON CONFLICT DO NOTHING`,
          [String(msg)]
        ).catch(() => {});
      }
    } catch {}
  }

  // Dream
  if (thought.dream) {
    try {
      const now = Date.now();
      const dreamContent = dreamSummaryText(thought.dream.content || '');
      const rejected = loadRejectedDreamFingerprints();
      if (!THINKER_DREAM_POLICY.autoDreamEnabled) {
        console.log(`[thinker] dream suppressed (auto-dream disabled): ${dreamContent.slice(0, 80)}`);
      } else if (lastThinkerDreamWriteAt > 0 && now - lastThinkerDreamWriteAt < THINKER_DREAM_POLICY.minIntervalMs) {
        console.log(`[thinker] dream suppressed (cooldown): ${dreamContent.slice(0, 80)}`);
      } else if (isContentRejected(dreamContent, rejected)) {
        // User explicitly deleted this topic — never re-insert. This
        // is the kill-switch for the clock/Sill feedback loop where
        // the thinker kept echoing back a deleted dream.
        console.log(`[thinker] dream suppressed (user-rejected fingerprint): ${dreamContent.slice(0, 80)}`);
      } else if (await isContentRecentlyDreamed(dreamContent)) {
        // Loop-breaker: if the model is just rewording one of the
        // most recent dream rows, skip the insert. Catches the
        // exact failure mode the user hit even when the rejection
        // list is empty.
        console.log(`[thinker] dream suppressed (near-duplicate of recent): ${dreamContent.slice(0, 80)}`);
      } else {
        // Semantic dedupe — ask gpt-5.4 whether this dream belongs
        // to the same topic as any existing one. Token-overlap heuristics
        // miss obvious "all-about-Sill" duplicates because the surface
        // vocabulary varies (microstates, handoffs, slot-eviction). The
        // model handles "same project / same feature" correctly even
        // when no words are shared. If a topic match is found we redirect
        // to append_dream instead of inserting a new row.
        const semanticMatch = await findSemanticDreamMatch(dreamContent);
        if (semanticMatch?.tag) {
          const matchTag = String(semanticMatch.tag).trim();
          const addition = dreamContent.slice(0, 600);
          const upd = await pool.query(
            `UPDATE dreams
                SET content = content || E'\n[+] ' || $2,
                    lifecycle_updated_at = NOW()
              WHERE tag = $1
              RETURNING id, tag`,
            [matchTag, addition]
          );
          if (upd.rows.length > 0) {
            lastThinkerDreamWriteAt = now;
            console.log(`[thinker] dream auto-folded into ${matchTag} (semantic match): ${dreamContent.slice(0, 80)}`);
            // Do NOT emit a dream_created toolbar notice — the parent
            // dream already exists in the Swift UI; we just extended it.
            return;
          }
        }
        // Stamp a short stable tag on every new dream so the thinker
        // can reference it later via `append_dream` instead of writing
        // a duplicate. Format: D-xxxxxx (6 hex chars).
        const newTag = 'D-' + Math.random().toString(16).slice(2, 8);
        const { rows: ins } = await pool.query(
          `INSERT INTO dreams (content, type, weight, tag) VALUES ($1, $2, $3, $4) RETURNING id, tag`,
          [dreamContent, thought.dream.type || 'goal', thought.dream.weight || 0.5, newTag]
        );
        lastThinkerDreamWriteAt = now;
        console.log(`[thinker] dream ${ins[0]?.tag}: ${dreamContent.slice(0, 80)}`);
        await emitToolbarNotice({
          kind: 'dream_created',
          title: 'Dream summary',
          body: dreamContent,
          signature: `dream:${dreamContent.toLowerCase().slice(0, 64)}`,
          actions: [{ id: 'dismiss', label: 'OK', primary: true }]
        });
      }
    } catch {}
  }

  // append_dream — extends an existing dream's content instead of
  // creating a duplicate row. The model references the parent by its
  // short tag (shown in the prompt as `[D-xxxxxx]`). We append with a
  // `[+]` marker so the history of extensions is readable.
  if (thought.append_dream?.tag && thought.append_dream?.content) {
    try {
      const tag = String(thought.append_dream.tag).trim();
      const addition = String(thought.append_dream.content || '').trim().slice(0, 1000);
      if (tag && addition) {
        const { rows } = await pool.query(
          `UPDATE dreams
              SET content = content || E'\n[+] ' || $2,
                  lifecycle_updated_at = NOW()
            WHERE tag = $1
            RETURNING id, tag`,
          [tag, addition]
        );
        if (rows.length > 0) {
          console.log(`[thinker] dream ${rows[0].tag} extended: ${addition.slice(0, 80)}`);
        } else {
          console.log(`[thinker] append_dream: no parent with tag ${tag}`);
        }
      }
    } catch (e) {
      console.log(`[thinker] append_dream error: ${e.message?.slice(0, 120)}`);
    }
  }

  // Build — design-guided app building via Python builder (uses Anthropic API directly)
  if (thought.build && !AUTONOMOUS_BUILD_ENABLED) {
    await noteAutonomousBlocked('build', thought.build.goal || '');
  } else if (thought.build) {
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
                model: 'claude-sonnet-4-20250514',
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
  if (thought.private_writing && !AUTONOMOUS_FILE_WRITE_ENABLED) {
    await noteAutonomousBlocked('private-writing', thought.private_writing.title || '');
  } else if (thought.private_writing) {
    try {
      const { title, content } = thought.private_writing;
      // Loop-breaker: drop a private_writing whose normalized title
      // matches one we already wrote in the last N ticks. Without
      // this, the thinker rewrites "Core Design Intent for Sill" on
      // every cycle when it has nothing else to say.
      const titleFP = privateWritingFingerprint(title);
      if (titleFP && recentPrivateWritingFPs.has(titleFP)) {
        console.log(`[thinker] private_writing suppressed (recent duplicate): ${title}`);
      } else {
        const filename = `private/${(title || 'untitled').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 50)}.md`;
        const fullPath = join(PROJECT_ROOT, filename);
        writeFileSync(fullPath, `# ${title}\n\n${content}\n`);
        console.log(`[thinker] wrote: ${filename}`);
        if (titleFP) rememberPrivateWritingFP(titleFP);
      }
    } catch {}
  }

  // Web search via agent-browser — async spawn, no hard timeouts
  if (thought.web_search && !AUTONOMOUS_WEB_ENABLED) {
    await noteAutonomousBlocked('web-search', thought.web_search.query || '');
  } else if (thought.web_search) {
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
  if (thought.diagnose && !AUTONOMOUS_SHELL_ENABLED) {
    await noteAutonomousBlocked('diagnosis', thought.diagnose.issue || thought.diagnose.investigation || '');
  } else if (thought.diagnose) {
    try {
      const d = thought.diagnose;
      console.log(`[thinker] diagnose: ${d.issue?.slice(0, 80)}`);
      diag.info('thinker', `Self-diagnosis initiated: ${d.issue}`, { fix: d.fix || null });
      if (d.investigation) {
        const investigateCmd = String(d.investigation).slice(0, 500);
        try {
          const result = await runAsync(investigateCmd, [], {
            cwd: PROJECT_ROOT,
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
  if (thought.cognitive_upgrade && !AUTONOMOUS_SELF_EDIT_ENABLED) {
    await noteAutonomousBlocked('cognitive-upgrade', thought.cognitive_upgrade.target || thought.cognitive_upgrade.problem || '');
  } else if (thought.cognitive_upgrade) {
    try {
      const u = thought.cognitive_upgrade;
      console.log(`[thinker] cognitive_upgrade: ${u.target} — ${u.problem?.slice(0, 80)}`);
      const task = `Implement cognitive self-upgrade in oneiro-core.\nTarget: ${u.target}\nProblem: ${u.problem}\nProposed: ${u.proposed_change}\nHint: ${u.implementation}`;
      await escalateToAgent(task);
    } catch {}
  }

  // Dream pursuit via sub-mind builder pipeline. This is intentionally not
  // covered by the broad autonomous-actions flag; dreams stay inert unless
  // dream execution is explicitly enabled.
  if (thought.dream?.content && thought.dream?.weight >= 0.6 && (!DREAM_EXECUTION_ENABLED || !AUTONOMOUS_BUILD_ENABLED)) {
    await noteAutonomousBlocked('dream-pipeline', dreamSummaryText(thought.dream.content || ''));
  } else if (thought.dream?.content && thought.dream?.weight >= 0.6) {
    try {
      const { dreamToTask } = await import('../runtime/workspace/oneiro-core/sub-mind-manager.js');
      if (dreamToTask) {
        await dreamToTask().catch(() => {});
        console.log('[thinker] triggered dreamToTask pipeline for high-weight dream');
      }
    } catch {}
  }

  // Scratchpad
  if (thought.scratchpad && !AUTONOMOUS_FILE_WRITE_ENABLED) {
    await noteAutonomousBlocked('scratchpad-write', thought.scratchpad || '');
  } else if (thought.scratchpad) {
    try {
      writeFileSync(join(PRIVATE_ROOT, 'scratchpad.txt'),
        String(thought.scratchpad).slice(0, 2000));
    } catch {}
  }
}

async function emitToolbarNotice({ kind = 'thinker_notice', title = 'Oneiro', body = '', signature = null, actions = null, ttl_ms = 14000 } = {}) {
  const cleanTitle = String(title || 'Oneiro').trim();
  const cleanBody = String(body || '').trim();
  if (!cleanTitle && !cleanBody) return;
  const intent = normalizeNoticeIntent({
    kind,
    title: cleanTitle || 'Oneiro',
    body: cleanBody,
    signature,
    actions: actions || [{ id: 'dismiss', label: 'OK', primary: true }],
    ttl_ms,
    confidence: 0.78,
    voice: { speak: false }
  });
  const verdict = thinkerNoticeLimiter.check(intent);
  if (!verdict.allow) {
    console.log(`[thinker] toolbar notice suppressed (${verdict.reason}): ${intent.signature || intent.kind}`);
    return;
  }
  try {
    await emit('thinker.proactive_intent', 'thinker', {
      ...intent,
      source: 'thinker'
    });
  } catch (e) {
    console.log(`[thinker] toolbar notice failed: ${e.message?.slice(0, 120)}`);
  }
}

async function escalateToAgent(task, workdir = PROJECT_ROOT) {
  const safeTask = String(task || '').trim();
  if (!safeTask) return false;
  if (!EXTERNAL_AGENT_COMMAND) {
    await noteAutonomousBlocked('external-agent', 'ONEIRO_EXTERNAL_AGENT_COMMAND is not configured');
    return false;
  }
  console.log(`[thinker] escalating to external agent: ${safeTask.slice(0, 100)}`);
  try {
    // Two rapid escalations would clobber a fixed-name task file and
    // the second agent would read the first agent's prompt. Make the
    // path unique per call.
    const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const taskFile = `/tmp/.oneiro-escalate-task-${uniq}`;
    const logFile = `/tmp/.oneiro-escalate-${uniq}.log`;
    writeFileSync(taskFile, safeTask);
    execSync(
      `cd "${workdir}" && nohup ${EXTERNAL_AGENT_COMMAND} "$(cat ${taskFile})" > ${logFile} 2>&1 &`,
      { timeout: 5000 }
    );
    console.log(`[thinker] agent spawned in ${workdir}`);
    await oca.experience('escalation', `Spawned external coding agent: ${safeTask.slice(0, 300)}`, { importanceScore: 0.7 });
    return true;
  } catch (e) {
    console.error(`[thinker] escalation failed: ${e.message}`);
    return false;
  }
}

// Lightweight liveness telemetry — exposed via /oca/thinker/status
// so we can answer "is the thinker actually doing anything?" without
// spelunking through stderr.
export const thinkerTelemetry = {
  runs: 0,
  skipped: 0,
  suppressed: 0,
  cadence: null,
  errors: 0,
  lastRunAt: null,        // Date | null
  lastRunDurationMs: 0,
  lastThought: null,      // string | null
  lastError: null,        // string | null
  lastErrorAt: null,      // Date | null
  recentThoughts: [],     // [{ at: Date, text: string }] ring, last 10
};

export function recordThinkerRun({ durationMs, thought }) {
  thinkerTelemetry.runs += 1;
  thinkerTelemetry.lastRunAt = new Date();
  thinkerTelemetry.lastRunDurationMs = Math.round(durationMs);
  if (thought && typeof thought === 'string') {
    thinkerTelemetry.lastThought = thought.slice(0, 1200);
    thinkerTelemetry.recentThoughts.unshift({
      at: thinkerTelemetry.lastRunAt,
      text: thought.slice(0, 400),
    });
    if (thinkerTelemetry.recentThoughts.length > 10) {
      thinkerTelemetry.recentThoughts.length = 10;
    }
  }
}

export function recordThinkerError(message) {
  thinkerTelemetry.errors += 1;
  thinkerTelemetry.lastError = String(message || 'unknown').slice(0, 800);
  thinkerTelemetry.lastErrorAt = new Date();
}

export default { runThinkerCycle, thinkerTelemetry, recordThinkerRun, recordThinkerError };
