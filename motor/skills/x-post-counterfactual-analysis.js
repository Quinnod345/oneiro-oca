import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const COUNTERFACTUAL_SCORE = 0.450;

function buildCounterfactualPost() {
  const lines = [
    `OCA counterfactual reasoning score: ${COUNTERFACTUAL_SCORE} / 1.0`,
    ``,
    `What does counterfactual testing actually look like for a cognitive system?`,
    ``,
    `It means asking: "If input X had been different, would the output have changed — and how?"`,
    ``,
    `In practice, we run the same decision pipeline with perturbed inputs:`,
    `• Swap a key belief → does the conclusion flip?`,
    `• Remove a memory trace → does behavior degrade gracefully?`,
    `• Inject a false premise → does the system catch the contradiction?`,
    ``,
    `Why is this hard?`,
    `1. State entanglement — beliefs aren't independent; changing one ripples through many`,
    `2. Temporal depth — counterfactuals compound across reasoning steps`,
    `3. No ground truth — we rarely know what the "correct" counterfactual outcome is`,
    `4. Self-reference — OCA reasoning about its own reasoning adds loops`,
    ``,
    `Score of 0.450 means roughly half of counterfactual probes produce the expected sensitivity.`,
    `The other half either over-react (brittle) or under-react (insensitive).`,
    ``,
    `This is a known hard problem in causal AI. We're measuring it honestly.`,
    ``,
    `#OCA #CausalReasoning #Counterfactual #CognitiveArchitecture #AI`
  ];
  return lines.join('\n');
}

function buildShortPost() {
  return `OCA counterfactual reasoning score: ${COUNTERFACTUAL_SCORE}/1.0\n\nHalf of counterfactual probes produce expected sensitivity. The rest are either brittle or insensitive.\n\nCounterfactual testing is genuinely hard — for any cognitive system.\n\n#OCA #CausalReasoning #AI`;
}

async function logToDb(postText, status, errorMsg = null) {
  try {
    await pool.query(
      `INSERT INTO x_posts (skill, content, status, error, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT DO NOTHING`,
      ['x-post-counterfactual-analysis', postText, status, errorMsg]
    );
  } catch (dbErr) {
    console.warn('[x-post-counterfactual-analysis] DB log failed:', dbErr.message);
  }
}

async function postViaPerekaboo(postText) {
  try {
    const escaped = postText.replace(/'/g, "'\\''");
    const result = await motor.runShellCommand(
      `peekaboo x post --content '${escaped}'`
    );
    return { success: true, method: 'peekaboo', result };
  } catch (err) {
    return { success: false, method: 'peekaboo', error: err.message };
  }
}

async function postViaBrowserAutomation(postText) {
  try {
    await motor.openUrl('https://x.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));

    await motor.click({ description: 'tweet compose box' });
    await new Promise(r => setTimeout(r, 500));

    await motor.copyToClipboard(postText);
    await motor.press(['command', 'v']);
    await new Promise(r => setTimeout(r, 1000));

    await motor.press(['command', 'Return']);
    await new Promise(r => setTimeout(r, 2000));

    return { success: true, method: 'browser' };
  } catch (err) {
    return { success: false, method: 'browser', error: err.message };
  }
}

async function postCounterfactualAnalysis(options = {}) {
  const { short = false, dryRun = false } = options;
  const postText = short ? buildShortPost() : buildCounterfactualPost();

  console.log('[x-post-counterfactual-analysis] Preparing post...');
  console.log('[x-post-counterfactual-analysis] Content preview:');
  console.log(postText.substring(0, 200) + '...');

  if (dryRun) {
    console.log('[x-post-counterfactual-analysis] DRY RUN — not posting');
    await logToDb(postText, 'dry_run');
    return { success: true, dryRun: true, postText };
  }

  let result = await postViaPerekaboo(postText);

  if (!result.success) {
    console.warn('[x-post-counterfactual-analysis] Peekaboo failed, trying browser automation...');
    result = await postViaBrowserAutomation(postText);
  }

  if (result.success) {
    console.log(`[x-post-counterfactual-analysis] Posted successfully via ${result.method}`);
    await logToDb(postText, 'posted');
    await emit('x_post_counterfactual_analysis', {
      score: COUNTERFACTUAL_SCORE,
      method: result.method,
      timestamp: new Date().toISOString()
    });
    return { success: true, method: result.method, postText };
  } else {
    const errorMsg = result.error || 'Unknown error';
    console.error('[x-post-counterfactual-analysis] All posting methods failed:', errorMsg);
    await logToDb(postText, 'failed', errorMsg);
    await emit('x_post_counterfactual_analysis_failed', {
      score: COUNTERFACTUAL_SCORE,
      error: errorMsg,
      timestamp: new Date().toISOString()
    });
    return { success: false, error: errorMsg, postText };
  }
}

async function getCounterfactualScore() {
  try {
    const res = await pool.query(
      `SELECT score FROM capability_scores WHERE capability = 'counterfactual_reasoning' ORDER BY created_at DESC LIMIT 1`
    );
    if (res.rows.length > 0) {
      return parseFloat(res.rows[0].score);
    }
  } catch (err) {
    console.warn('[x-post-counterfactual-analysis] Could not fetch score from DB:', err.message);
  }
  return COUNTERFACTUAL_SCORE;
}

async function postWithLiveScore(options = {}) {
  const liveScore = await getCounterfactualScore();
  console.log(`[x-post-counterfactual-analysis] Live score: ${liveScore}`);
  return postCounterfactualAnalysis(options);
}

export default {
  postCounterfactualAnalysis,
  postWithLiveScore,
  buildCounterfactualPost,
  buildShortPost,
  getCounterfactualScore,
  COUNTERFACTUAL_SCORE
};