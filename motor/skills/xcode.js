// OCA Motor Skill: Xcode
// Build, run, navigate, manage Xcode projects
import motor from '../engine.js';
import { execSync } from 'child_process';

// Build the current project
export async function build() {
  await motor.activateApp('Xcode');
  await sleep(300);
  await motor.press('b', ['cmd']);
}

// Run the current project
export async function run() {
  await motor.activateApp('Xcode');
  await sleep(300);
  await motor.press('r', ['cmd']);
}

// Stop running
export async function stop() {
  await motor.activateApp('Xcode');
  await sleep(300);
  await motor.press('.', ['cmd']);
}

// Clean build folder
export async function clean() {
  await motor.activateApp('Xcode');
  await sleep(300);
  await motor.press('k', ['cmd', 'shift']);
}

// Open a file in the project navigator
export async function openFile(filename) {
  await motor.activateApp('Xcode');
  await sleep(300);
  await motor.press('o', ['cmd', 'shift']); // Open Quickly
  await sleep(500);
  await motor.type(filename, { speed: 'instant' });
  await sleep(300);
  await motor.press('return');
}

// Show/hide navigator
export async function toggleNavigator() {
  await motor.press('0', ['cmd']);
}

// Show/hide debug area
export async function toggleDebugArea() {
  await motor.press('y', ['cmd', 'shift']);
}

// Build via command line (no UI needed)
export function xcodebuild(projectPath, scheme = null) {
  try {
    const schemeArg = scheme ? `-scheme "${scheme}"` : '';
    return execSync(
      `cd "${projectPath}" && xcodebuild ${schemeArg} build 2>&1 | tail -20`,
      { encoding: 'utf8', timeout: 120000 }
    );
  } catch (e) {
    return e.stdout || e.message;
  }
}

// Build with xcodegen + xcodebuild
export function xcodegen(projectPath) {
  try {
    return execSync(
      `cd "${projectPath}" && xcodegen generate 2>&1`,
      { encoding: 'utf8', timeout: 30000 }
    );
  } catch (e) {
    return e.stdout || e.message;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default { build, run, stop, clean, openFile, toggleNavigator, toggleDebugArea, xcodebuild, xcodegen };
