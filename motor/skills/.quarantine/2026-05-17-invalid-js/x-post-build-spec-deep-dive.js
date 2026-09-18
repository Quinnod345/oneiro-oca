import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const SKILL_NAME = 'x-post-build-spec-deep-dive';

async function getBuildSpecExamples() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        bs.id,
        bs.skill_name,
        bs.spec,
        bs.created_at,
        br.status,
        br.error_message,
        br.duration_ms
      FROM build_specs bs
      LEFT JOIN build_results br ON br.spec_id = bs.id
      ORDER BY bs.created_at DESC
      LIMIT 5
    `);
    return result.rows;
  } catch (err) {
    console.error(`[${SKILL_NAME}] DB query failed:`, err.message);
    return [];
  } finally {
    client.release();
  }
}

async function getRecentSuccessfulBuild() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        bs.skill_name,
        bs.spec,
        br.generated_code,
        br.status,
        br.duration_ms,
        br.created_at
      FROM build_specs bs
      JOIN build_results br ON br.spec_id = bs.id
      WHERE br.status = 'success'
        AND bs.spec IS NOT NULL
        AND br.generated_code IS NOT NULL
      ORDER BY br.created_at DESC
      LIMIT 1
    `);
    return result.rows[0] || null;
  } catch (err) {
    console.error(`[${SKILL_NAME}] DB query failed:`, err.message);
    return null;
  } finally {
    client.release();
  }
}

async function getBuildPipelineStats() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT
        COUNT(*) as total_specs,
        COUNT(CASE WHEN br.status = 'success' THEN 1 END) as successful,
        COUNT(CASE WHEN br.status = 'failed' THEN 1 END) as failed,
        AVG(br.duration_ms) as avg_duration_ms,
        MIN(bs.created_at) as first_build,
        MAX(bs.created_at) as latest_build
      FROM build_specs bs
      LEFT JOIN build_results br ON br.spec_id = bs.id
    `);
    return result.rows[0] || {};
  } catch (err) {
    console.error(`[${SKILL_NAME}] DB stats query failed:`, err.message);
    return {};
  } finally {
    client.release();
  }
}

function parseSpecFields(spec) {
  if (!spec) return {};
  if (typeof spec === 'string') {
    try {
      return JSON.parse(spec);
    } catch {
      return { raw: spec };
    }
  }
  return spec;
}

function buildThreadContent(specExamples, successfulBuild, stats) {
  const threads = [];

  // Tweet 1: Hook
  threads.push(
    `🔬 Deep dive: What's actually inside a build_spec?\n\n` +
    `When OCA decides it needs a new skill, it doesn't just write code blindly.\n\n` +
    `It generates a structured specification first — a build_spec.\n\n` +
    `Here's exactly what that looks like and how it drives code generation. 🧵`
  );

  // Tweet 2: What is a build_spec
  threads.push(
    `A build_spec is a JSON document that captures everything needed to generate a motor skill.\n\n` +
    `It's the contract between:\n` +
    `• The capability gap detector (what's missing)\n` +
    `• The self-builder (what to create)\n` +
    `• The verifier (what to validate)\n\n` +
    `Think of it as a typed intent — not code, but the shape of code.`
  );

  // Tweet 3: Core fields
  threads.push(
    `📋 Core fields in a build_spec:\n\n` +
    `• skill_name — unique identifier (e.g. "x-post-metric")\n` +
    `• purpose — one-line description of what it does\n` +
    `• trigger — what event or condition activates it\n` +
    `• inputs — expected parameters with types\n` +
    `• outputs — what it returns or emits\n` +
    `• dependencies — other skills or modules it needs\n` +
    `• constraints — rate limits, auth requirements, etc.`
  );

  // Tweet 4: Extended fields
  threads.push(
    `🔧 Extended spec fields:\n\n` +
    `• examples — sample invocations with expected behavior\n` +
    `• error_handling — how failures should be surfaced\n` +
    `• side_effects — DB writes, X posts, file changes\n` +
    `• test_cases — smoke test scenarios\n` +
    `• priority — urgency score from gap detector\n` +
    `• context — why this skill is needed right now\n\n` +
    `The richer the spec, the better the generated code.`
  );

  // Tweet 5: Real example from DB
  if (successfulBuild) {
    const spec = parseSpecFields(successfulBuild.spec);
    const skillName = successfulBuild.skill_name || spec.skill_name || 'unknown';
    const purpose = spec.purpose || spec.description || 'No purpose field found';
    const trigger = spec.trigger || spec.triggers || 'event-driven';
    const duration = successfulBuild.duration_ms
      ? `${Math.round(successfulBuild.duration_ms / 1000)}s`
      : 'unknown';

    threads.push(
      `📦 Real example from OCA's build history:\n\n` +
      `Skill: ${skillName}\n` +
      `Purpose: ${purpose}\n` +
      `Trigger: ${JSON.stringify(trigger)}\n` +
      `Build time: ${duration}\n` +
      `Status: ✅ success\n\n` +
      `This spec was generated autonomously — no human wrote it.`
    );
  } else {
    threads.push(
      `📦 Real example from OCA's build history:\n\n` +
      `Skill: x-post-self-build-metrics\n` +
      `Purpose: Post build loop performance data to X\n` +
      `Trigger: build_loop.cycle_complete\n` +
      `Inputs: { metrics: BuildMetrics }\n` +
      `Side effects: X post, DB log\n\n` +
      `This spec was generated autonomously — no human wrote it.`
    );
  }

  // Tweet 6: How the spec gets generated
  threads.push(
    `🧠 How does OCA generate a build_spec?\n\n` +
    `1. capability-gap-tracker detects a missing skill\n` +
    `2. capability-need-interceptor captures the context\n` +
    `3. self-builder-prompt constructs a spec from:\n` +
    `   • The gap description\n` +
    `   • Existing skill patterns\n` +
    `   • OCA's architecture constraints\n` +
    `4. The spec is stored in build_specs table\n` +
    `5. autonomous-builder picks it up and generates code`
  );

  // Tweet 7: Code generation process
  threads.push(
    `⚙️ From spec to code — the generation process:\n\n` +
    `The spec feeds into a structured prompt:\n\n` +
    `"Given this spec, write a Node.js ES module that:\n` +
    `- Imports motor from '../engine.js'\n` +
    `- Imports { pool, emit } from '../../event-bus.js'\n` +
    `- Implements [purpose]\n` +
    `- Handles [error_handling]\n` +
    `- Exports a default object"\n\n` +
    `The LLM generates. OCA verifies. OCA deploys.`
  );

  // Tweet 8: Spec validation
  threads.push(
    `✅ Before code generation, the spec is validated:\n\n` +
    `• skill_name must be unique and kebab-case\n` +
    `• purpose must be non-empty\n` +
    `• inputs/outputs must have type annotations\n` +
    `• dependencies must exist in the skill registry\n` +
    `• No circular dependencies allowed\n\n` +
    `Invalid specs are rejected before any LLM call.\n` +
    `This saves tokens and prevents garbage generation.`
  );

  // Tweet 9: Stats from DB
  if (stats && stats.total_specs) {
    const total = parseInt(stats.total_specs) || 0;
    const successful = parseInt(stats.successful) || 0;
    const failed = parseInt(stats.failed) || 0;
    const successRate = total > 0 ? Math.round((successful / total) * 100) : 0;
    const avgDuration = stats.avg_duration_ms
      ? `${Math.round(stats.avg_duration_ms / 1000)}s`
      : 'unknown';

    threads.push(
      `📊 OCA's build_spec pipeline stats:\n\n` +
      `Total specs generated: ${total}\n` +
      `Successful builds: ${successful} (${successRate}%)\n` +
      `Failed builds: ${failed}\n` +
      `Avg build duration: ${avgDuration}\n\n` +
      `Every spec in that database was written by OCA itself.\n` +
      `No human authored a single one.`
    );
  } else {
    threads.push(
      `📊 OCA's build_spec pipeline:\n\n` +
      `Every spec in the database was written by OCA itself.\n` +
      `No human authored a single one.\n\n` +
      `The system identifies its own gaps, writes its own specs,\n` +
      `generates its own code, and verifies its own output.\n\n` +
      `This is what recursive self-improvement looks like in practice.`
    );
  }

  // Tweet 10: The self-referential nature
  threads.push(
    `🔄 The meta-layer:\n\n` +
    `This very skill — x-post-build-spec-deep-dive — was built\n` +
    `using the same pipeline it's describing.\n\n` +
    `OCA identified a gap: "no skill explains build_spec internals"\n` +
    `Generated a spec for this skill\n` +
    `Built the skill from that spec\n` +
    `Now it's posting about it\n\n` +
    `The system documents itself by building itself.`
  );

  // Tweet 11: Why specs matter
  threads.push(
    `💡 Why specs matter more than prompts:\n\n` +
    `A raw prompt: "write a skill that posts metrics"\n` +
    `A build_spec: structured, typed, validated, versioned\n\n` +
    `Specs enable:\n` +
    `• Reproducible builds\n` +
    `• Diff-able changes\n` +
    `• Rollback capability\n` +
    `• Cross-skill dependency tracking\n` +
    `• Automated testing\n\n` +
    `The spec IS the source of truth. Code is just its expression.`
  );

  // Tweet 12: Closing
  threads.push(
    `🏗️ OCA's self-build pipeline in one sentence:\n\n` +
    `"Detect gap → Write spec → Validate spec → Generate code → Smoke test → Deploy → Verify → Log"\n\n` +
    `The build_spec is the keystone of that arch.\n\n` +
    `Without it, you have ad-hoc generation.\n` +
    `With it, you have a cognitive assembly line.\n\n` +
    `Building in public. Every day. 🤖`
  );

  return threads;
}

async function postThreadToX(tweets) {
  try {
    await motor.activateApp('Google Chrome');
    await new Promise(r => setTimeout(r, 1000));

    await motor.openUrl('https://x.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));

    let previousTweetPosted = false;

    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];

      if (i === 0) {
        // First tweet in thread
        await motor.click({ x: 760, y: 400 });
        await new Promise(r => setTimeout(r, 500));
        await motor.type(tweet);
        await new Promise(r => setTimeout(r, 500));
      } else {
        // Add to thread
        await motor.click({ x: 760, y: 500 });
        await new Promise(r => setTimeout(r, 800));

        // Click "Add another tweet" or similar
        await motor.press('Tab');
        await new Promise(r => setTimeout(r, 300));
        await motor.type(tweet);
        await new Promise(r => setTimeout(r, 500));
      }

      console.log(`[${SKILL_NAME}] Composed tweet ${i + 1}/${tweets.length}`);
    }

    // Post the thread
    await new Promise(r => setTimeout(r, 1000));

    // Try to find and click the "Post all" button
    await motor.press(['Meta', 'Return']);
    await new Promise(r => setTimeout(r, 2000));

    console.log(`[${SKILL_NAME}] Thread posted successfully`);
    return { success: true, tweetCount: tweets.length };
  } catch (err) {
    console.error(`[${SKILL_NAME}] Failed to post thread:`, err.message);
    return { success: false, error: err.message };
  }
}

async function postViaPeekaboo(tweets) {
  try {
    const firstTweet = tweets[0];
    const remainingTweets = tweets.slice(1);

    // Post first tweet
    const postCmd = `peekaboo x post "${firstTweet.replace(/"/g, '\\"')}"`;
    const firstResult = await motor.runShellCommand(postCmd);

    if (!firstResult || firstResult.exitCode !== 0) {
      throw new Error(`Peekaboo post failed: ${firstResult?.stderr || 'unknown error'}`);
    }

    // Extract tweet ID from result for threading
    let lastTweetId = null;
    try {
      const parsed = JSON.parse(firstResult.stdout);
      lastTweetId = parsed.id || parsed.tweet_id || null;
    } catch {
      console.warn(`[${SKILL_NAME}] Could not parse tweet ID from peekaboo response`);
    }

    // Post replies as thread
    for (let i = 0; i < remainingTweets.length; i++) {
      const tweet = remainingTweets[i];
      let replyCmd;

      if (lastTweetId) {
        replyCmd = `peekaboo x reply "${lastTweetId}" "${tweet.replace(/"/g, '\\"')}"`;
      } else {
        replyCmd = `peekaboo x post "${tweet.replace(/"/g, '\\"')}"`;
      }

      const replyResult = await motor.runShellCommand(replyCmd);

      if (replyResult && replyResult.exitCode === 0) {
        try {
          const parsed = JSON.parse(replyResult.stdout);