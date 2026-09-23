import { spawn } from 'child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASIDE_TOOL_NAMES } from './aside-mcp.js';

const DEFAULT_WORKING_DIRECTORY = '/Users/quinnodonnell/oneiro/runtime/workspace';
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_DIAGNOSTIC_CHARS = 8_000;

function clampTimeout(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.max(10_000, Math.min(parsed, 30 * 60_000));
}

function resolveCodexCLI(env = process.env) {
  const configured = String(env.ONEIRO_CODEX_CLI || env.OCA_CODEX_CLI || '').trim();
  const candidates = [
    configured,
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
  ].filter(Boolean);

  return candidates.find(candidate => existsSync(candidate)) || configured || 'codex';
}

export function buildCodexEnvironment(env = process.env) {
  const childEnv = { ...env };

  // Codex must use its cached ChatGPT login. Never let a provider key inherited
  // from Oneiro silently switch this path to metered API billing.
  delete childEnv.OPENAI_API_KEY;
  delete childEnv.ANTHROPIC_API_KEY;
  delete childEnv.OPENAI_BASE_URL;

  childEnv.HOME = env.HOME || env.USERPROFILE || '/Users/quinnodonnell';
  childEnv.PATH = [
    `${childEnv.HOME}/.local/bin`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ].join(':');
  childEnv.TERM = 'dumb';
  return childEnv;
}

export const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'];

// The engine's one browser, offered to every Codex run as a read-only MCP tool server. Codex spawns MCP
// servers outside its command sandbox, so this is how a sandboxed slice reaches Aside. Read tools only —
// open, read, snapshot, search, tabs — auto-approved because none of them can act on the world.
export const ASIDE_MCP_SERVER = new URL('./aside-mcp.js', import.meta.url).pathname;
export const ASIDE_MCP_TOOLS = ASIDE_TOOL_NAMES;   // every tool the server offers is pre-approved: the server itself is the boundary
export function asideMcpArgs({ server = ASIDE_MCP_SERVER, node = process.execPath } = {}) {
  return [
    '-c', `mcp_servers.aside.command=${JSON.stringify(node)}`,
    '-c', `mcp_servers.aside.args=${JSON.stringify([server])}`,
    '-c', 'mcp_servers.aside.startup_timeout_sec=30',
    '-c', 'mcp_servers.aside.tool_timeout_sec=960',   // a delegated sign-in or post runs minutes, not seconds
    ...ASIDE_MCP_TOOLS.flatMap(t => ['-c', `mcp_servers.aside.tools.${t}.approval_mode="approve"`]),
  ];
}

export function buildCodexArgs({
  workingDirectory = DEFAULT_WORKING_DIRECTORY,
  model = '',
  sandbox = 'read-only',
  persistent = false, threadId = null, outputSchemaPath = null,
  reasoningEffort = '', aside = true,
} = {}) {
  const args = [
    'exec',
    '--json',
    ...(!persistent ? ['--ephemeral'] : []),
    '--ignore-user-config',
    '--skip-git-repo-check',
    '--sandbox',
    sandbox,
    '--config',
    'approval_policy="never"',
    '--cd',
    workingDirectory,
  ];

  const selectedModel = String(model || '').trim();
  if (selectedModel && /^[A-Za-z0-9._:-]+$/.test(selectedModel)) {
    args.push('--model', selectedModel);
  }
  // --ignore-user-config drops ~/.codex/config.toml, so the effort the engine wants is stated explicitly.
  const effort = String(reasoningEffort || '').trim().toLowerCase();
  if (REASONING_EFFORTS.includes(effort)) args.push('--config', `model_reasoning_effort="${effort}"`);
  if (aside) args.push(...asideMcpArgs());
  if (outputSchemaPath) args.push('--output-schema', outputSchemaPath);
  if (threadId) {
    if (!/^[a-f0-9-]{36}$/i.test(threadId)) throw new Error('Invalid Codex session ID');
    args.splice(1, 0, 'resume');
    const sandboxIndex = args.indexOf('--sandbox'); args.splice(sandboxIndex, 2);
    const cwdIndex = args.indexOf('--cd'); args.splice(cwdIndex, 2);
    args.push('--config', `sandbox_mode="${sandbox}"`, threadId);
  }
  args.push('-');
  return args;
}

export function parseCodexEvent(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  if (event?.type === 'item.completed' && event?.item?.type === 'agent_message') {
    return { type: 'text', text: String(event.item.text || '') };
  }
  if (event?.type === 'turn.completed') {
    return { type: 'usage', usage: event.usage || null };
  }
  return { type: 'event', event };
}

export function codexAvailable(env = process.env) {
  const binary = resolveCodexCLI(env);
  return binary !== 'codex' ? existsSync(binary) : true;
}

export function runCodex(prompt, {
  workingDirectory = DEFAULT_WORKING_DIRECTORY,
  model = process.env.OCA_CODEX_MODEL || process.env.ONEIRO_CODEX_MODEL || '',
  sandbox = 'read-only',
  timeoutMs = process.env.OCA_CODEX_TIMEOUT_MS || process.env.LLM_CLI_TIMEOUT_MS,
  signal = null,
  onText = null, onEvent = null,
  persistent = false, threadId = null, outputSchema = null,
  reasoningEffort = process.env.OCA_CODEX_REASONING_EFFORT || process.env.ONEIRO_CODEX_REASONING_EFFORT || '',
  aside = !/^(0|false|no|off)$/i.test(String(process.env.OCA_CODEX_ASIDE || '')),
  env = process.env,
} = {}) {
  const codexCLI = resolveCodexCLI(env);
  const schemaDir = outputSchema ? mkdtempSync(join(tmpdir(), 'oneiro-codex-schema-')) : null;
  const outputSchemaPath = schemaDir ? join(schemaDir, 'response.json') : null;
  if (outputSchemaPath) writeFileSync(outputSchemaPath, JSON.stringify(outputSchema), { mode: 0o600 });
  let args;
  try { args = buildCodexArgs({ workingDirectory, model, sandbox, persistent, threadId, outputSchemaPath, reasoningEffort, aside }); }
  catch (error) { if (schemaDir) rmSync(schemaDir, { recursive: true, force: true }); throw error; }
  const childEnv = buildCodexEnvironment(env);
  const timeout = clampTimeout(timeoutMs);

  return new Promise((resolve, reject) => {
    const child = spawn(codexCLI, args, {
      cwd: workingDirectory,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });

    let stdoutBuffer = '';
    let stderr = '';
    let responseText = '';
    let usage = null;
    let finished = false;
    let actualThreadId = threadId;
    let eventWrites = Promise.resolve();
    let eventError = null;
    const stopChild = () => {
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      const escalation = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } }, 2000);
      escalation.unref();
    };

    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (schemaDir) rmSync(schemaDir, { recursive: true, force: true });
      if (signal) signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(result);
    };

    const consumeLine = line => {
      if (!line.trim()) return;
      const parsed = parseCodexEvent(line);
      let raw; try { raw = JSON.parse(line); } catch {}
      if (raw?.type === 'thread.started') actualThreadId = raw.thread_id;
      if (raw && typeof onEvent === 'function') {
        eventWrites = eventWrites.then(() => onEvent(raw)).catch(error => { eventError = error; stopChild(); });
      }
      if (parsed?.type === 'text' && parsed.text) {
        // Completed assistant items include commentary. Only the final item is the answer.
        responseText = parsed.text;
        if (typeof onText === 'function') onText(parsed.text);
      } else if (parsed?.type === 'usage') {
        usage = parsed.usage;
      }
    };

    const abort = () => {
      stopChild();
      finish(new Error('Codex request cancelled'));
    };

    const timer = setTimeout(() => {
      stopChild();
      finish(new Error(`Codex CLI timed out after ${Math.round(timeout / 1000)} seconds`));
    }, timeout);

    if (signal) {
      if (signal.aborted) return abort();
      signal.addEventListener('abort', abort, { once: true });
    }

    child.stdout.on('data', chunk => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) consumeLine(line);
    });

    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-MAX_DIAGNOSTIC_CHARS);
    });

    child.on('error', error => {
      finish(new Error(`Could not start Codex CLI: ${error.message}`));
    });

    child.on('close', async code => {
      if (stdoutBuffer.trim()) consumeLine(stdoutBuffer);
      await eventWrites;
      if (finished) return;
      if (eventError) return finish(eventError);
      if (code === 0 && responseText.trim()) {
        finish(null, {
          text: responseText.trim(),
          usage,
          model: model || 'codex-default',
          via: 'codex_chatgpt_subscription', threadId: actualThreadId,
        });
        return;
      }

      // Prefer the lines that explain the failure over skill-loader warnings that precede them.
      const lines = stderr.trim().split('\n').filter(l => l.trim());
      const explanatory = lines.filter(l => /^ERROR:|usage limit|unauthori|not logged|rate limit|quota|timed out|ECONN|network/i.test(l) && !/failed to load skill/i.test(l));
      const detail = (explanatory.length ? explanatory.slice(-2) : lines.filter(l => !/failed to load skill/i.test(l)).slice(-4)).join(' | ');
      finish(new Error(`Codex CLI exited ${code}${detail ? `: ${detail}` : ''}`));
    });

    child.stdin.on('error', error => {
      if (error.code !== 'EPIPE') finish(new Error(`Could not send prompt to Codex CLI: ${error.message}`));
    });
    child.stdin.end(String(prompt || ''));
  });
}

export default { runCodex, codexAvailable };
