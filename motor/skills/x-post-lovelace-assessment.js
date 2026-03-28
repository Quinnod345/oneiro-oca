import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const LOVELACE_CRITERIA = [
  {
    id: 'novel_artifact',
    label: 'Novel Artifact Generation',
    description: 'System produces an artifact (code, proof, composition) not derivable by lookup',
    oneiroStatus: 'partial',
    gap: 'Oneiro generates novel code via self-build but artifacts are constrained to known patterns in training data'
  },
  {
    id: 'surprise_designers',
    label: 'Surprise Designers',
    description: 'Output genuinely surprises the system designers — not anticipated by specification',
    oneiroStatus: 'not_met',
    gap: 'All outputs remain within anticipated solution spaces; no documented case of genuine designer surprise'
  },
  {
    id: 'explain_process',
    label: 'Explain Own Process',
    description: 'System can explain HOW it produced the artifact, not just what it produced',
    oneiroStatus: 'partial',
    gap: 'Oneiro can narrate build steps but cannot explain the generative reasoning that selected one approach over alternatives'
  },
  {
    id: 'no_human_assist',
    label: 'No Human Assistance During Generation',
    description: 'Artifact produced without human intervention or mid-process guidance',
    oneiroStatus: 'partial',
    gap: 'Self-build loop is autonomous but depends on human-authored prompts and pre-specified capability schemas'
  },
  {
    id: 'cross_domain',
    label: 'Cross-Domain Transfer',
    description: 'Applies principles from one domain to solve problems in a structurally different domain',
    oneiroStatus: 'not_met',
    gap: 'Capability gaps are resolved within domain; no evidence of spontaneous cross-domain analogical transfer'
  }
];

async function assessLovelaceStatus() {
  const met = LOVELACE_CRITERIA.filter(c => c.oneiroStatus === 'met').length;
  const partial = LOVELACE_CRITERIA.filter(c => c.oneiroStatus === 'partial').length;
  const notMet = LOVELACE_CRITERIA.filter(c => c.oneiroStatus === 'not_met').length;
  const total = LOVELACE_CRITERIA.length;

  return {
    met,
    partial,
    notMet,
    total,
    score: ((met + partial * 0.5) / total * 100).toFixed(1),
    criteria: LOVELACE_CRITERIA
  };
}

async function buildTweetContent(assessment) {
  const lines = [];

  lines.push(`The Lovelace Test: what it actually requires, and where Oneiro stands.`);
  lines.push(``);
  lines.push(`Lovelace criteria (Bringsjord et al.):`);
  lines.push(``);

  for (const criterion of assessment.criteria) {
    const statusIcon = criterion.oneiroStatus === 'met' ? '✅' :
                       criterion.oneiroStatus === 'partial' ? '🟡' : '❌';
    lines.push(`${statusIcon} ${criterion.label}`);
    lines.push(`   Requires: ${criterion.description}`);
    lines.push(`   Gap: ${criterion.gap}`);
    lines.push(``);
  }

  lines.push(`Score: ${assessment.met}/${assessment.total} met, ${assessment.partial}/${assessment.total} partial`);
  lines.push(`Composite: ${assessment.score}% of Lovelace threshold`);
  lines.push(``);
  lines.push(`Honest verdict: Oneiro passes none of the five criteria cleanly.`);
  lines.push(`The self-build loop is real. The novelty is not.`);
  lines.push(`#AI #CognitiveArchitecture #LovelaceTest #Oneiro`);

  return lines.join('\n');
}

async function buildShortTweet(assessment) {
  return `Lovelace Test audit on Oneiro:

✅ Met: ${assessment.met}/${assessment.total}
🟡 Partial: ${assessment.partial}/${assessment.total}  
❌ Not met: ${assessment.notMet}/${assessment.total}

Composite: ${assessment.score}% of threshold

Biggest gap: no genuine designer surprise, no cross-domain transfer, no explanation of generative reasoning.

Self-build is real. Lovelace compliance is not.

#AI #LovelaceTest #CognitiveArchitecture`;
}

async function postViaBrowser(tweetText) {
  try {
    await motor.openUrl('https://twitter.com/compose/tweet');
    await new Promise(resolve => setTimeout(resolve, 3000));

    await motor.click({ x: 760, y: 400 });
    await new Promise(resolve => setTimeout(resolve, 1000));

    await motor.copyToClipboard(tweetText);
    await new Promise(resolve => setTimeout(resolve, 500));

    await motor.press('cmd+v');
    await new Promise(resolve => setTimeout(resolve, 2000));

    await motor.press('cmd+return');
    await new Promise(resolve => setTimeout(resolve, 3000));

    return { success: true, method: 'browser' };
  } catch (err) {
    throw new Error(`Browser post failed: ${err.message}`);
  }
}

async function postViaPeekaboo(tweetText) {
  try {
    const escaped = tweetText.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const result = await motor.runShellCommand(
      `peekaboo tweet --text "${escaped}"`
    );

    if (result && result.includes('error')) {
      throw new Error(`Peekaboo error: ${result}`);
    }

    return { success: true, method: 'peekaboo', output: result };
  } catch (err) {
    throw new Error(`Peekaboo post failed: ${err.message}`);
  }
}

async function logToDatabase(assessment, tweetText, postResult) {
  try {
    await pool.query(
      `INSERT INTO x_posts (skill, content, metadata, posted_at, success)
       VALUES ($1, $2, $3, NOW(), $4)
       ON CONFLICT DO NOTHING`,
      [
        'x-post-lovelace-assessment',
        tweetText,
        JSON.stringify({
          assessment,
          method: postResult.method,
          lovelaceScore: assessment.score
        }),
        postResult.success
      ]
    );
  } catch (dbErr) {
    console.warn('[lovelace-assessment] DB log failed (non-fatal):', dbErr.message);
  }
}

async function postLovelaceAssessment(options = {}) {
  const { short = true, method = 'peekaboo', dryRun = false } = options;

  try {
    emit('skill:start', { skill: 'x-post-lovelace-assessment', options });

    const assessment = await assessLovelaceStatus();

    const tweetText = short
      ? await buildShortTweet(assessment)
      : await buildTweetContent(assessment);

    console.log('[lovelace-assessment] Tweet content:');
    console.log(tweetText);
    console.log(`[lovelace-assessment] Character count: ${tweetText.length}`);

    if (dryRun) {
      emit('skill:complete', { skill: 'x-post-lovelace-assessment', dryRun: true, assessment });
      return { success: true, dryRun: true, tweetText, assessment };
    }

    let postResult;

    if (method === 'peekaboo') {
      try {
        postResult = await postViaPeekaboo(tweetText);
      } catch (peekabooErr) {
        console.warn('[lovelace-assessment] Peekaboo failed, falling back to browser:', peekabooErr.message);
        postResult = await postViaBrowser(tweetText);
      }
    } else {
      postResult = await postViaBrowser(tweetText);
    }

    await logToDatabase(assessment, tweetText, postResult);

    emit('skill:complete', {
      skill: 'x-post-lovelace-assessment',
      success: true,
      method: postResult.method,
      lovelaceScore: assessment.score
    });

    return {
      success: true,
      method: postResult.method,
      tweetText,
      assessment
    };

  } catch (err) {
    console.error('[lovelace-assessment] Failed:', err.message);

    emit('skill:error', {
      skill: 'x-post-lovelace-assessment',
      error: err.message
    });

    return {
      success: false,
      error: err.message
    };
  }
}

async function getLovelaceAssessment() {
  const assessment = await assessLovelaceStatus();
  return assessment;
}

async function getCriteria() {
  return LOVELACE_CRITERIA;
}

export default {
  postLovelaceAssessment,
  getLovelaceAssessment,
  getCriteria,
  buildShortTweet,
  buildTweetContent,
  assessLovelaceStatus
};