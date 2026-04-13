#!/usr/bin/env node
/**
 * Run one skill evolution cycle from the command line.
 *
 * Usage:
 *   node run-evolve.js                  # Run one evolution
 *   node run-evolve.js --force          # Skip cooldown check
 */

import { evolveSkill } from './skill-evolver.js';
import { writeFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';

function claudeCall(prompt, systemPrompt) {
  const tmpFile = join(tmpdir(), `evolve-${Date.now()}.txt`);
  const fullPrompt = systemPrompt
    ? `${systemPrompt}\n\n---\n\n${prompt}`
    : prompt;
  writeFileSync(tmpFile, fullPrompt);
  try {
    return execSync(`cat "${tmpFile}" | claude -p --model sonnet`, {
      encoding: 'utf-8', timeout: 180000, maxBuffer: 4 * 1024 * 1024, shell: '/bin/zsh',
    }).trim();
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function main() {
  const force = process.argv.includes('--force');

  console.log('\n=== Skill Evolution Cycle ===\n');

  const result = await evolveSkill(claudeCall, {
    currentCycle: force ? 999999 : 0,
    designDriveDeficit: force ? 1.0 : 0.6,
  });

  console.log('\nResult:', JSON.stringify(result, null, 2));

  if (result.applied) {
    console.log('\n✨ Skill evolved successfully!');
    console.log(`Score: ${result.scoreBefore.toFixed(3)} → ${result.scoreAfter.toFixed(3)}`);
  } else if (result.skipped) {
    console.log(`\nSkipped: ${result.reason}`);
  } else {
    console.log(`\nRejected: ${result.reason}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
