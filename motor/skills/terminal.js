// OCA Motor Skill: Terminal
// Run commands, read output, navigate directories
import motor from '../engine.js';
import { execSync } from 'child_process';

// Run a command and get output (without UI — direct shell)
export async function run(command, { timeout = 30000 } = {}) {
  return motor.runShellCommand(command, { timeout });
}

// Open a new terminal window
export async function openTerminal() {
  await motor.launchApp('Terminal');
}

// Open a new tab in Terminal
export async function newTab() {
  await motor.press('t', ['cmd'], { app: 'Terminal' });
}

// Run a command in the visible terminal (types it)
export async function typeCommand(command, { app = 'Terminal' } = {}) {
  await motor.activateApp(app);
  await sleep(300);
  await motor.type(command, { speed: 'instant' });
  await motor.press('return');
}

// Get current directory
export function cwd() {
  try {
    return execSync('pwd', { encoding: 'utf8' }).trim();
  } catch { return '~'; }
}

// List files
export function ls(path = '.', opts = '-la') {
  try {
    return execSync(`ls ${opts} "${path}"`, { encoding: 'utf8' }).trim();
  } catch { return ''; }
}

// Read a file
export function cat(path) {
  try {
    return execSync(`cat "${path}"`, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  } catch { return ''; }
}

// Git status
export function gitStatus(repoPath = '.') {
  try {
    return execSync(`cd "${repoPath}" && git status --short`, { encoding: 'utf8' }).trim();
  } catch { return ''; }
}

// Git log
export function gitLog(repoPath = '.', count = 5) {
  try {
    return execSync(`cd "${repoPath}" && git log --oneline -${count}`, { encoding: 'utf8' }).trim();
  } catch { return ''; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default { run, openTerminal, newTab, typeCommand, cwd, ls, cat, gitStatus, gitLog };
