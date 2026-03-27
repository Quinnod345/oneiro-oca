import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const SKILL_NAME = 'x-post-crm-dimension-gap';

const COUNTERFACTUAL_SCORE = 0.450;
const METACOGNITION_SCORE = 0.784;
const GAP = (METACOGNITION_SCORE - COUNTERFACTUAL_SCORE).toFixed(3);

function buildTweetText() {
  const lines = [
    `🧠 OCA CRM Dimension Gap Analysis`,
    ``,
    `Metacognition: ${METACOGNITION_SCORE} ████████░░`,
    `Counterfactual: ${COUNTERFACTUAL_SCORE} ████░░░░░░`,
    `Gap: ${GAP}`,
    ``,
    `What this means mechanically:`,
    ``,
    `Metacognition = OCA can observe its own reasoning, flag uncertainty, and self-correct mid-task.`,
    ``,
    `Counterfactual = OCA struggles to simulate "what would have happened if X were different" — the backbone of causal planning.`,
    ``,
    `The gap (${GAP}) means OCA knows it's uncertain but can't yet reason backward through hypothetical branches to resolve why.`,
    ``,
    `Closing it: injecting counterfactual prompts into build loops, tracking divergence between predicted vs actual outcomes, and scoring each delta.`,
    ``,
    `#OCA #CognitiveArchitecture #BuildInPublic`
  ];

  return lines.join('\n');
}

async function logToDb(status, tweetText, error = null) {
  try {
    await pool.query(
      `INSERT INTO motor_skill_logs (skill, status, payload, error, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [
        SKILL_NAME,
        status,
        JSON.stringify({ tweetText, counterfactual: COUNTERFACTUAL_SCORE, metacognition: METACOGNITION_SCORE, gap: GAP }),
        error ? error.message : null
      ]
    );
  } catch (dbErr) {
    console.error(`[${SKILL_NAME}] DB log failed:`, dbErr.message);
  }
}

async function postViaBrowserAutomation(tweetText) {
  console.log(`[${SKILL_NAME}] Opening X/Twitter via browser automation...`);

  await motor.openUrl('https://twitter.com/compose/tweet');
  await new Promise(r => setTimeout(r, 3000));

  await motor.click({ x: 760, y: 400 });
  await new Promise(r => setTimeout(r, 1000));

  await motor.copyToClipboard(tweetText);
  await new Promise(r => setTimeout(r, 500));

  await motor.press('cmd+v');
  await new Promise(r => setTimeout(r, 1500));

  // Submit tweet
  await motor.press('cmd+return');
  await new Promise(r => setTimeout(r, 3000));

  console.log(`[${SKILL_NAME}] Tweet submitted via browser automation.`);
}

async function postViaPeekaboo(tweetText) {
  console.log(`[${SKILL_NAME}] Attempting post via Peekaboo CLI...`);

  const escaped = tweetText.replace(/"/g, '\\"');
  const result = await motor.runShellCommand(
    `peekaboo tweet post --text "${escaped}"`
  );

  if (result && result.includes('error')) {
    throw new Error(`Peekaboo returned error: ${result}`);
  }

  console.log(`[${SKILL_NAME}] Peekaboo post result:`, result);
  return result;
}

async function post() {
  console.log(`[${SKILL_NAME}] Starting CRM dimension gap post...`);

  const tweetText = buildTweetText();

  if (tweetText.length > 280) {
    console.warn(`[${SKILL_NAME}] Tweet exceeds 280 chars (${tweetText.length}). Will attempt anyway — platform may truncate or reject.`);
  }

  console.log(`[${SKILL_NAME}] Tweet content:\n${tweetText}`);

  let posted = false;
  let lastError = null;

  // Try Peekaboo first
  try {
    await postViaPeekaboo(tweetText);
    posted = true;
  } catch (peekabooErr) {
    console.warn(`[${SKILL_NAME}] Peekaboo failed: ${peekabooErr.message}. Falling back to browser automation.`);
    lastError = peekabooErr;
  }

  // Fallback to browser automation
  if (!posted) {
    try {
      await postViaBrowserAutomation(tweetText);
      posted = true;
    } catch (browserErr) {
      console.error(`[${SKILL_NAME}] Browser automation also failed: ${browserErr.message}`);
      lastError = browserErr;
    }
  }

  if (posted) {
    await logToDb('success', tweetText);
    emit('x-post-crm-dimension-gap:posted', {
      tweetText,
      counterfactual: COUNTERFACTUAL_SCORE,
      metacognition: METACOGNITION_SCORE,
      gap: GAP,
      timestamp: new Date().toISOString()
    });
    console.log(`[${SKILL_NAME}] Post complete.`);
    return { success: true, tweetText };
  } else {
    await logToDb('failure', tweetText, lastError);
    emit('x-post-crm-dimension-gap:failed', {
      error: lastError ? lastError.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
    throw lastError || new Error('Failed to post tweet via all methods.');
  }
}

async function run() {
  return post();
}

export default {
  post,
  run,
  buildTweetText
};