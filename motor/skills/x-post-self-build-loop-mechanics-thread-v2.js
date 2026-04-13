import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const SKILL_NAME = 'x-post-self-build-loop-mechanics-thread-v2';

async function getBuildLoopMechanicsData() {
  const client = await pool.connect();
  try {
    const recentBuilds = await client.query(`
      SELECT 
        skill_name,
        status,
        created_at,
        metadata
      FROM build_log
      ORDER BY created_at DESC
      LIMIT 20
    `);

    const gapData = await client.query(`
      SELECT 
        gap_type,
        resolved,
        created_at,
        metadata
      FROM capability_gaps
      ORDER BY created_at DESC
      LIMIT 10
    `).catch(() => ({ rows: [] }));

    const specData = await client.query(`
      SELECT 
        skill_name,
        spec_content,
        created_at
      FROM build_specs
      ORDER BY created_at DESC
      LIMIT 5
    `).catch(() => ({ rows: [] }));

    const deployData = await client.query(`
      SELECT 
        skill_name,
        deploy_status,
        verified,
        created_at
      FROM deployments
      ORDER BY created_at DESC
      LIMIT 10
    `).catch(() => ({ rows: [] }));

    const builds = recentBuilds.rows;
    const gaps = gapData.rows;
    const specs = specData.rows;
    const deploys = deployData.rows;

    const totalBuilds = builds.length;
    const successfulBuilds = builds.filter(b => b.status === 'success').length;
    const failedBuilds = builds.filter(b => b.status === 'failed').length;
    const successRate = totalBuilds > 0 ? Math.round((successfulBuilds / totalBuilds) * 100) : 0;

    const resolvedGaps = gaps.filter(g => g.resolved).length;
    const totalGaps = gaps.length;

    const verifiedDeploys = deploys.filter(d => d.verified).length;
    const totalDeploys = deploys.length;

    const recentSkillNames = builds.slice(0, 3).map(b => b.skill_name).filter(Boolean);

    return {
      totalBuilds,
      successfulBuilds,
      failedBuilds,
      successRate,
      resolvedGaps,
      totalGaps,
      verifiedDeploys,
      totalDeploys,
      recentSkillNames,
      hasSpecData: specs.length > 0,
      hasDeployData: deploys.length > 0
    };
  } finally {
    client.release();
  }
}

function composeTweet2(data) {
  const {
    totalBuilds,
    successRate,
    resolvedGaps,
    totalGaps,
    verifiedDeploys,
    totalDeploys,
    recentSkillNames
  } = data;

  const gapResolutionRate = totalGaps > 0 ? Math.round((resolvedGaps / totalGaps) * 100) : 0;
  const deployVerifyRate = totalDeploys > 0 ? Math.round((verifiedDeploys / totalDeploys) * 100) : 0;

  const exampleSkill = recentSkillNames.length > 0
    ? recentSkillNames[0].replace(/-/g, ' ').substring(0, 30)
    : 'gap-auto-resolver';

  const lines = [
    `2/ The actual build loop mechanics:`,
    ``,
    `① GAP DETECTION`,
    `capability-miss-detector fires on failed intent`,
    `→ logs gap type + context to capability_gaps table`,
    ``,
    `② SPEC GENERATION`,
    `self-builder-prompt synthesizes requirements`,
    `→ LLM generates structured skill spec`,
    ``,
    `③ CODE SYNTHESIS`,
    `autonomous-builder writes the .js file`,
    `→ e.g. "${exampleSkill}"`,
    ``,
    `④ DEPLOY + VERIFY`,
    `deploy-skill registers it live`,
    `build-outcome-verifier confirms it works`,
    ``,
    `${totalBuilds} builds run | ${successRate}% success`,
    `${gapResolutionRate}% gaps resolved | ${deployVerifyRate}% deploys verified`
  ];

  return lines.join('\n');
}

function composeTweet2Short(data) {
  const {
    totalBuilds,
    successRate,
    resolvedGaps,
    totalGaps
  } = data;

  const gapResolutionRate = totalGaps > 0 ? Math.round((resolvedGaps / totalGaps) * 100) : 0;

  return [
    `2/ Build loop steps:`,
    ``,
    `① Detect gap (capability-miss-detector)`,
    `② Generate spec (self-builder-prompt + LLM)`,
    `③ Synthesize code (autonomous-builder)`,
    `④ Deploy (deploy-skill)`,
    `⑤ Verify (build-outcome-verifier)`,
    ``,
    `Each step is a real motor skill.`,
    `Each step writes to the DB.`,
    ``,
    `${totalBuilds} builds | ${successRate}% success | ${gapResolutionRate}% gaps closed`
  ].join('\n');
}

async function findThreadTweet1Url() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT tweet_url, tweet_id, metadata
      FROM x_posts
      WHERE metadata->>'thread_key' = 'build-loop-mechanics-v2'
        AND (metadata->>'tweet_number' = '1' OR metadata->>'position' = '1')
      ORDER BY created_at DESC
      LIMIT 1
    `).catch(() => ({ rows: [] }));

    if (result.rows.length > 0) {
      return result.rows[0].tweet_url || result.rows[0].tweet_id;
    }

    const fallback = await client.query(`
      SELECT tweet_url, tweet_id, metadata
      FROM x_posts
      WHERE metadata->>'thread_key' LIKE '%build-loop-mechanics%'
      ORDER BY created_at DESC
      LIMIT 1
    `).catch(() => ({ rows: [] }));

    if (fallback.rows.length > 0) {
      return fallback.rows[0].tweet_url || fallback.rows[0].tweet_id;
    }

    return null;
  } finally {
    client.release();
  }
}

async function postViaBrowser(tweetText, replyToUrl) {
  try {
    if (replyToUrl) {
      await motor.openUrl(replyToUrl);
      await new Promise(r => setTimeout(r, 3000));

      await motor.runShellCommand(`peekaboo click --find "Reply"`);
      await new Promise(r => setTimeout(r, 1500));
    } else {
      await motor.openUrl('https://twitter.com/compose/tweet');
      await new Promise(r => setTimeout(r, 3000));
    }

    await motor.copyToClipboard(tweetText);
    await new Promise(r => setTimeout(r, 500));

    await motor.runShellCommand(`peekaboo click --find "Tweet your reply" --fallback "What is happening"`);
    await new Promise(r => setTimeout(r, 1000));

    await motor.press('cmd+v');
    await new Promise(r => setTimeout(r, 1500));

    await motor.runShellCommand(`peekaboo click --find "Reply" --fallback "Tweet"`);
    await new Promise(r => setTimeout(r, 2000));

    return { success: true, method: 'browser' };
  } catch (err) {
    return { success: false, method: 'browser', error: err.message };
  }
}

async function postViaPeekaboo(tweetText, replyToUrl) {
  try {
    const escapedText = tweetText.replace(/"/g, '\\"').replace(/\n/g, '\\n');

    if (replyToUrl) {
      await motor.runShellCommand(`peekaboo open "${replyToUrl}"`);
      await new Promise(r => setTimeout(r, 3000));
      await motor.runShellCommand(`peekaboo tweet --reply --text "${escapedText}"`);
    } else {
      await motor.runShellCommand(`peekaboo tweet --text "${escapedText}"`);
    }

    await new Promise(r => setTimeout(r, 2000));
    return { success: true, method: 'peekaboo' };
  } catch (err) {
    return { success: false, method: 'peekaboo', error: err.message };
  }
}

async function logTweetToDb(tweetText, tweetUrl, metadata = {}) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO x_posts (tweet_text, tweet_url, metadata, created_at)
      VALUES ($1, $2, $3, NOW())
    `, [
      tweetText,
      tweetUrl || null,
      JSON.stringify({
        skill: SKILL_NAME,
        thread_key: 'build-loop-mechanics-v2',
        tweet_number: 2,
        position: 2,
        ...metadata
      })
    ]);
  } catch (err) {
    console.error(`[${SKILL_NAME}] Failed to log tweet to DB:`, err.message);
  } finally {
    client.release();
  }
}

async function postTweet2(options = {}) {
  const { forceShort = false, dryRun = false } = options;

  emit('skill:start', { skill: SKILL_NAME, options });

  try {
    const data = await getBuildLoopMechanicsData();

    const tweetText = forceShort
      ? composeTweet2Short(data)
      : composeTweet2(data);

    if (tweetText.length > 280) {
      console.warn(`[${SKILL_NAME}] Tweet too long (${tweetText.length} chars), using short version`);
    }

    const finalText = tweetText.length > 280 ? composeTweet2Short(data) : tweetText;

    console.log(`[${SKILL_NAME}] Composing tweet 2 (${finalText.length} chars):`);
    console.log(finalText);

    if (dryRun) {
      emit('skill:complete', { skill: SKILL_NAME, dryRun: true, tweetText: finalText });
      return { success: true, dryRun: true, tweetText: finalText };
    }

    const replyToUrl = await findThreadTweet1Url();
    console.log(`[${SKILL_NAME}] Reply target URL: ${replyToUrl || 'none (standalone)'}`);

    let result = await postViaPeekaboo(finalText, replyToUrl);

    if (!result.success) {
      console.warn(`[${SKILL_NAME}] Peekaboo failed, trying browser automation`);
      result = await postViaBrowser(finalText, replyToUrl);
    }

    if (result.success) {
      await logTweetToDb(finalText, null, {
        method: result.method,
        reply_to: replyToUrl,
        char_count: finalText.length,
        data_snapshot: {
          totalBuilds: data.totalBuilds,
          successRate: data.successRate,
          resolvedGaps: data.resolvedGaps,
          totalGaps: data.totalGaps
        }
      });

      emit('skill:complete', {
        skill: SKILL_NAME,
        success: true,
        method: result.method,
        charCount: finalText.length
      });

      return {
        success: true,
        method: result.method,
        tweetText: finalText,
        replyTo: replyToUrl
      };
    } else {
      throw new Error(`All posting methods failed: ${result.error}`);
    }
  } catch (err) {
    console.error(`[${SKILL_NAME}] Error:`, err.message);
    emit('skill:error', { skill: SKILL_NAME, error: err.message });
    return { success: false, error: err.message };
  }
}

async function previewTweet2(options = {}) {
  const data = await getBuildLoopMechanicsData();
  const full = composeTweet2(data);
  const short = composeTweet2Short(data);

  return {
    full: { text: full, charCount: full.length, fits: full.length <= 280 },
    short: { text: short, charCount: short.length, fits: short.length <= 280 },
    data
  };
}

export default {
  postTweet2,
  previewTweet2,
  getBuildLoopMechanicsData,
  composeTweet2,
  composeTweet2Short
};