#!/usr/bin/env node
/**
 * Run the design flywheel from the command line.
 *
 * Usage:
 *   node run-flywheel.js                    # Run 1 cycle
 *   node run-flywheel.js --cycles 5         # Run 5 cycles
 *   node run-flywheel.js --type modal-dialog  # Specific component type
 *   node run-flywheel.js --status           # Show flywheel state
 */

import { runCycles, getState } from './flywheel.js';
import { writeFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';

// Claude CLI as the LLM backend
function claudePrompt(prompt) {
  const tmpFile = join(tmpdir(), `flywheel-${Date.now()}.txt`);
  writeFileSync(tmpFile, prompt);
  try {
    return execSync(`cat "${tmpFile}" | claude -p --model sonnet`, {
      encoding: 'utf-8', timeout: 120000, maxBuffer: 2 * 1024 * 1024, shell: '/bin/zsh',
    }).trim();
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function main() {
  if (process.argv.includes('--status')) {
    const state = getState();
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  const cycles = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--cycles') || '1');
  const type = process.argv.find((a, i) => process.argv[i - 1] === '--type') || undefined;

  console.log(`\n═══ Design Flywheel ═══`);
  console.log(`Cycles: ${cycles}`);
  if (type) console.log(`Type: ${type}`);

  const results = await runCycles(cycles, claudePrompt, { artifactType: type });

  console.log(`\n═══ Results ═══`);
  for (const r of results) {
    if (r.status && r.status !== 'complete') {
      console.log(`  cycle ${r.cycle}: ${r.status}${r.error ? ` — ${String(r.error).slice(0, 80)}` : ''}`);
      continue;
    }
    const improvement = typeof r.improvement === 'number' ? r.improvement : 0;
    const delta = improvement > 0 ? `+${improvement.toFixed(3)}` : improvement.toFixed(3);
    const orig = typeof r.originalScore === 'number' ? r.originalScore.toFixed(3) : 'n/a';
    const improved = typeof r.improvedScore === 'number' ? r.improvedScore.toFixed(3) : 'n/a';
    console.log(`  cycle ${r.cycle}: ${r.type ?? '?'} | ${orig} → ${improved} (${delta}) | +${r.samplesAdded ?? 0} samples | ${r.backend ?? '?'}`);
  }

  const state = getState();
  console.log(`\nTotal: ${state.totalCycles} cycles, ${state.samplesAddedSinceLastRetrain} since last retrain`);
}

main().catch(e => { console.error(e); process.exit(1); });
