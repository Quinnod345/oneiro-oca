import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';
import { readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function getSkillsList() {
  try {
    const files = await readdir(__dirname);
    const skills = files
      .filter(f => f.endsWith('.js') && f !== 'index.js')
      .map(f => f.replace('.js', ''));
    return skills;
  } catch (err) {
    console.error('[x-post-capability-inventory] Failed to read skills dir:', err.message);
    return [];
  }
}

async function introspectAutonomousBuilder() {
  try {
    const builderPath = join(__dirname, 'autonomous-builder.js');
    const source = await readFile(builderPath, 'utf8');

    const behaviors = [];

    if (source.includes('runShellCommand') || source.includes('shell')) {
      behaviors.push('runs shell commands');
    }
    if (source.includes('openUrl') || source.includes('browser')) {
      behaviors.push('opens URLs/browser');
    }
    if (source.includes('emit')) {
      behaviors.push('emits events to bus');
    }
    if (source.includes('pool') || source.includes('pg') || source.includes('SELECT') || source.includes('INSERT')) {
      behaviors.push('reads/writes DB');
    }
    if (source.includes('writeFile') || source.includes('readFile')) {
      behaviors.push('reads/writes files');
    }
    if (source.includes('plan') || source.includes('motor.plan')) {
      behaviors.push('uses motor planner');
    }
    if (source.includes('copyToClipboard') || source.includes('getClipboard')) {
      behaviors.push('uses clipboard');
    }
    if (source.includes('showNotification')) {
      behaviors.push('shows notifications');
    }
    if (source.includes('type') || source.includes('motor.type')) {
      behaviors.push('types keystrokes');
    }
    if (source.includes('click') || source.includes('motor.click')) {
      behaviors.push('clicks UI elements');
    }
    if (source.includes('launchApp') || source.includes('activateApp')) {
      behaviors.push('launches/activates apps');
    }
    if (source.includes('peekaboo')) {
      behaviors.push('uses Peekaboo CLI');
    }

    const functionMatches = source.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm) || [];
    const exportedFunctions = functionMatches.map(m => m.replace(/^(?:export\s+)?(?:async\s+)?function\s+/, ''));

    const lineCount = source.split('\n').length;

    return {
      behaviors,
      exportedFunctions,
      lineCount,
      hasDefaultExport: source.includes('export default'),
    };
  } catch (err) {
    console.error('[x-post-capability-inventory] Failed to introspect autonomous-builder:', err.message);
    return { behaviors: [], exportedFunctions: [], lineCount: 0, hasDefaultExport: false };
  }
}

async function buildTweetText(skills, builderInfo) {
  const count = skills.length;
  const behaviorSummary = builderInfo.behaviors.length > 0
    ? builderInfo.behaviors.slice(0, 4).join(', ')
    : 'no detected behaviors';

  const topSkills = skills.slice(0, 6).join(', ');
  const moreCount = skills.length > 6 ? ` +${skills.length - 6} more` : '';

  const tweet = [
    `OCA motor skill inventory snapshot:`,
    ``,
    `📦 ${count} skills loaded`,
    `🔧 autonomous-builder.js (${builderInfo.lineCount} lines): ${behaviorSummary}`,
    ``,
    `Skills: ${topSkills}${moreCount}`,
    ``,
    `#OCA #CognitiveArchitecture #AutonomousAI`,
  ].join('\n');

  return tweet;
}

async function postToX(tweetText) {
  try {
    await emit('x_post_attempt', { skill: 'x-post-capability-inventory', text: tweetText });

    await motor.openUrl('https://twitter.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));

    await motor.click({ x: 760, y: 400 });
    await new Promise(r => setTimeout(r, 500));

    await motor.copyToClipboard(tweetText);
    await new Promise(r => setTimeout(r, 300));

    await motor.press(['command', 'v']);
    await new Promise(r => setTimeout(r, 1000));

    await motor.press(['command', 'Return']);
    await new Promise(r => setTimeout(r, 2000));

    await emit('x_post_success', { skill: 'x-post-capability-inventory', text: tweetText });
    console.log('[x-post-capability-inventory] Tweet posted successfully');
    return { success: true };
  } catch (err) {
    console.error('[x-post-capability-inventory] Failed to post tweet:', err.message);
    await emit('x_post_failure', { skill: 'x-post-capability-inventory', error: err.message });
    return { success: false, error: err.message };
  }
}

async function postCapabilityInventory() {
  try {
    console.log('[x-post-capability-inventory] Starting capability inventory post...');

    const [skills, builderInfo] = await Promise.all([
      getSkillsList(),
      introspectAutonomousBuilder(),
    ]);

    console.log(`[x-post-capability-inventory] Found ${skills.length} skills`);
    console.log(`[x-post-capability-inventory] autonomous-builder behaviors: ${builderInfo.behaviors.join(', ')}`);

    const tweetText = await buildTweetText(skills, builderInfo);
    console.log('[x-post-capability-inventory] Tweet text:\n', tweetText);

    if (tweetText.length > 280) {
      console.warn(`[x-post-capability-inventory] Tweet too long (${tweetText.length} chars), truncating...`);
    }

    const result = await postToX(tweetText);

    await logToDb({ skills, builderInfo, tweetText, result });

    return result;
  } catch (err) {
    console.error('[x-post-capability-inventory] Fatal error:', err.message);
    await emit('x_post_capability_inventory_error', { error: err.message });
    return { success: false, error: err.message };
  }
}

async function logToDb({ skills, builderInfo, tweetText, result }) {
  try {
    await pool.query(
      `INSERT INTO motor_skill_logs (skill_name, event_type, payload, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [
        'x-post-capability-inventory',
        result.success ? 'post_success' : 'post_failure',
        JSON.stringify({ skillCount: skills.length, builderInfo, tweetText, result }),
      ]
    );
  } catch (err) {
    console.warn('[x-post-capability-inventory] DB log failed (non-fatal):', err.message);
  }
}

async function getInventorySnapshot() {
  const [skills, builderInfo] = await Promise.all([
    getSkillsList(),
    introspectAutonomousBuilder(),
  ]);
  return { skills, builderInfo, count: skills.length };
}

export default {
  postCapabilityInventory,
  getInventorySnapshot,
  getSkillsList,
  introspectAutonomousBuilder,
  buildTweetText,
};