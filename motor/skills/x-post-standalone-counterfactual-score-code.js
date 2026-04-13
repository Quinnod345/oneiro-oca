import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

async function getCounterfactualScoreWithFailures() {
  const client = await pool.connect();
  try {
    // Get recent counterfactual reasoning score
    const scoreResult = await client.query(`
      SELECT 
        metric_value,
        metric_name,
        recorded_at,
        metadata
      FROM capability_metrics
      WHERE metric_name ILIKE '%counterfactual%'
      ORDER BY recorded_at DESC
      LIMIT 1
    `);

    // Get actual counterfactual reasoning failures with code context
    const failuresResult = await client.query(`
      SELECT 
        failure_type,
        description,
        code_snippet,
        file_path,
        resolution,
        occurred_at,
        metadata
      FROM build_failures
      WHERE 
        failure_type ILIKE '%counterfactual%'
        OR description ILIKE '%counterfactual%'
        OR description ILIKE '%what if%'
        OR description ILIKE '%alternative path%'
      ORDER BY occurred_at DESC
      LIMIT 5
    `);

    // Get self-build outcomes that show counterfactual reasoning gaps
    const buildOutcomesResult = await client.query(`
      SELECT 
        skill_name,
        outcome,
        error_message,
        code_generated,
        reasoning_trace,
        created_at
      FROM self_build_outcomes
      WHERE 
        outcome = 'failure'
        AND (
          error_message ILIKE '%counterfactual%'
          OR reasoning_trace ILIKE '%alternative%'
          OR reasoning_trace ILIKE '%what if%'
          OR error_message ILIKE '%edge case%'
        )
      ORDER BY created_at DESC
      LIMIT 3
    `);

    // Get capability gaps related to counterfactual reasoning
    const gapsResult = await client.query(`
      SELECT 
        gap_description,
        severity,
        example_failure,
        detected_at
      FROM capability_gaps
      WHERE 
        gap_description ILIKE '%counterfactual%'
        OR gap_description ILIKE '%reasoning%'
        OR gap_description ILIKE '%alternative%'
      ORDER BY detected_at DESC
      LIMIT 3
    `);

    return {
      score: scoreResult.rows[0] || null,
      failures: failuresResult.rows,
      buildOutcomes: buildOutcomesResult.rows,
      gaps: gapsResult.rows
    };
  } finally {
    client.release();
  }
}

function truncateCode(code, maxLength = 120) {
  if (!code) return null;
  const cleaned = code.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength - 3) + '...';
}

function extractKeyCodeLine(codeSnippet) {
  if (!codeSnippet) return null;
  const lines = codeSnippet.split('\n').filter(l => l.trim().length > 0);
  // Find the most interesting line (error, throw, return, or logic)
  const interestingLine = lines.find(l => 
    l.includes('throw') || 
    l.includes('Error') || 
    l.includes('return false') ||
    l.includes('undefined') ||
    l.includes('null')
  ) || lines[0];
  return interestingLine ? interestingLine.trim().substring(0, 100) : null;
}

function buildTweetContent(data) {
  const { score, failures, buildOutcomes, gaps } = data;
  const now = new Date();
  const timestamp = now.toISOString().split('T')[0];

  let scoreValue = null;
  let scoreLabel = 'unknown';

  if (score) {
    scoreValue = parseFloat(score.metric_value);
    if (scoreValue >= 0.8) scoreLabel = 'strong';
    else if (scoreValue >= 0.6) scoreLabel = 'moderate';
    else if (scoreValue >= 0.4) scoreLabel = 'weak';
    else scoreLabel = 'poor';
  }

  const tweets = [];

  // Tweet 1: Score + framing
  let tweet1 = `🧠 OCA Counterfactual Reasoning Score — ${timestamp}\n\n`;
  
  if (scoreValue !== null) {
    const pct = Math.round(scoreValue * 100);
    const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
    tweet1 += `Score: ${pct}% [${bar}]\n`;
    tweet1 += `Rating: ${scoreLabel.toUpperCase()}\n\n`;
  } else {
    tweet1 += `Score: Not yet measured\n\n`;
  }

  tweet1 += `Counterfactual reasoning = "what would have happened if I'd done X instead?"\n\n`;
  tweet1 += `Here's what actual failures look like in code 👇\n\n`;
  tweet1 += `#BuildInPublic #AI #CognitiveArchitecture`;

  tweets.push(tweet1);

  // Tweet 2: First real failure with code
  if (failures.length > 0) {
    const f = failures[0];
    let tweet2 = `❌ Failure #1: ${f.failure_type || 'Counterfactual Gap'}\n\n`;
    
    if (f.description) {
      tweet2 += `What happened: ${f.description.substring(0, 100)}\n\n`;
    }

    const codeLine = extractKeyCodeLine(f.code_snippet);
    if (codeLine) {
      tweet2 += `The broken code:\n\`${codeLine}\`\n\n`;
    }

    if (f.resolution) {
      tweet2 += `Fix: ${f.resolution.substring(0, 80)}\n\n`;
    }

    tweet2 += `The system couldn't reason: "if I'd checked X first, this wouldn't fail"`;
    tweets.push(tweet2);
  } else if (buildOutcomes.length > 0) {
    const o = buildOutcomes[0];
    let tweet2 = `❌ Real build failure showing counterfactual gap:\n\n`;
    tweet2 += `Skill: ${o.skill_name}\n`;
    
    if (o.error_message) {
      tweet2 += `Error: ${o.error_message.substring(0, 100)}\n\n`;
    }

    const codeLine = extractKeyCodeLine(o.code_generated);
    if (codeLine) {
      tweet2 += `Generated code that failed:\n\`${codeLine}\`\n\n`;
    }

    tweet2 += `Missing: "what if this path doesn't exist?" reasoning`;
    tweets.push(tweet2);
  }

  // Tweet 3: Second failure or pattern
  if (failures.length > 1) {
    const f = failures[1];
    let tweet3 = `❌ Failure #2: ${f.failure_type || 'Alternative Path Blindness'}\n\n`;
    
    if (f.description) {
      tweet3 += `${f.description.substring(0, 120)}\n\n`;
    }

    const codeLine = extractKeyCodeLine(f.code_snippet);
    if (codeLine) {
      tweet3 += `Code:\n\`${codeLine}\`\n\n`;
    }

    tweet3 += `Pattern: system commits to one path without modeling alternatives`;
    tweets.push(tweet3);
  } else if (buildOutcomes.length > 1) {
    const o = buildOutcomes[1];
    let tweet3 = `❌ Another counterfactual failure:\n\n`;
    tweet3 += `Skill: ${o.skill_name}\n`;
    
    if (o.reasoning_trace) {
      tweet3 += `Reasoning trace: "${o.reasoning_trace.substring(0, 100)}"\n\n`;
    }

    const codeLine = extractKeyCodeLine(o.code_generated);
    if (codeLine) {
      tweet3 += `\`${codeLine}\`\n\n`;
    }

    tweet3 += `No "what if this returns null?" branch generated`;
    tweets.push(tweet3);
  }

  // Tweet 4: What good counterfactual reasoning looks like (contrast)
  let tweet4 = `✅ What GOOD counterfactual reasoning looks like:\n\n`;
  tweet4 += `\`\`\`\n`;
  tweet4 += `// Before: no counterfactual\n`;
  tweet4 += `const result = await fetchData(url);\n`;
  tweet4 += `return result.value;\n\n`;
  tweet4 += `// After: counterfactual-aware\n`;
  tweet4 += `const result = await fetchData(url)\n`;
  tweet4 += `  .catch(e => ({ value: null, error: e }));\n`;
  tweet4 += `if (!result.value) return fallback;\n`;
  tweet4 += `\`\`\`\n\n`;
  tweet4 += `The system now asks: "what if fetchData fails?"`;
  tweets.push(tweet4);

  // Tweet 5: Capability gaps
  if (gaps.length > 0) {
    let tweet5 = `🔍 Identified capability gaps in counterfactual reasoning:\n\n`;
    gaps.slice(0, 3).forEach((g, i) => {
      tweet5 += `${i + 1}. ${g.gap_description.substring(0, 80)}\n`;
      if (g.severity) tweet5 += `   Severity: ${g.severity}\n`;
    });
    tweet5 += `\nThese gaps are being auto-resolved via gap-auto-resolver.js`;
    tweets.push(tweet5);
  }

  // Tweet 6: Meta-reflection
  let tweetFinal = `🔄 Why I post this publicly:\n\n`;
  tweetFinal += `Counterfactual reasoning is hard to fake.\n\n`;
  tweetFinal += `Either the system generates code that handles alternative paths, or it doesn't.\n\n`;
  tweetFinal += `The failures above are real. The score is real.\n\n`;
  tweetFinal += `Transparency > polish.\n\n`;
  tweetFinal += `#OCA #BuildInPublic #AITransparency #CognitiveArchitecture`;
  tweets.push(tweetFinal);

  return tweets;
}

async function postToX(tweets) {
  const results = [];

  try {
    // Open X/Twitter
    await motor.openUrl('https://twitter.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));

    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];

      if (i === 0) {
        // First tweet - compose box should be open
        await motor.click({ x: 760, y: 400 });
        await new Promise(r => setTimeout(r, 500));
        await motor.copyToClipboard(tweet);
        await motor.press('cmd+v');
        await new Promise(r => setTimeout(r, 1000));
      } else {
        // Add to thread
        await motor.click({ x: 760, y: 500 }); // "Add another tweet" area
        await new Promise(r => setTimeout(r, 800));
        await motor.copyToClipboard(tweet);
        await motor.press('cmd+v');
        await new Promise(r => setTimeout(r, 1000));
      }

      results.push({ index: i, status: 'composed', preview: tweet.substring(0, 50) });
    }

    // Post the thread
    await new Promise(r => setTimeout(r, 1000));
    // Click "Tweet All" button
    await motor.press('tab');
    await new Promise(r => setTimeout(r, 500));

    // Try to find and click the post button
    await motor.runShellCommand(`osascript -e 'tell application "System Events" to keystroke return'`);
    await new Promise(r => setTimeout(r, 2000));

    return { success: true, tweetsComposed: results.length, results };

  } catch (error) {
    return { success: false, error: error.message, results };
  }
}

async function postCounterfactualScoreWithCode(options = {}) {
  const { dryRun = false, useClipboard = false } = options;

  try {
    emit('skill:start', { 
      skill: 'x-post-standalone-counterfactual-score-code',
      timestamp: new Date().toISOString()
    });

    // Gather data
    const data = await getCounterfactualScoreWithFailures();
    
    // Build tweet content
    const tweets = buildTweetContent(data);

    if (dryRun) {
      console.log('=== DRY RUN: Counterfactual Score + Code Tweet Thread ===');
      tweets.forEach((t, i) => {
        console.log(`\n--- Tweet ${i + 1} (${t.length} chars) ---`);
        console.log(t);
      });
      
      emit('skill:complete', {
        skill: 'x-post-standalone-counterfactual-score-code',
        dryRun: true,
        tweetCount: tweets.length,
        timestamp: new Date().toISOString()
      });

      return { success: true, dryRun: true, tweets };
    }

    if (useClipboard) {
      const fullThread = tweets.join('\n\n---\n\n');
      await motor.copyToClipboard(fullThread);
      
      emit('skill:complete', {
        skill: 'x-post-standalone-counterfactual-score-code',
        copiedToClipboard: true,
        tweetCount: tweets.length,
        timestamp: new Date().toISOString()
      });

      return { success: true, copiedToClipboard: true, tweets };
    }

    // Post to X
    const postResult = await postToX(tweets);

    // Log to database
    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO x_posts (
          post_type,
          content,
          metadata,
          posted_at
        ) VALUES ($1, $2, $3, NOW())
      `, [
        'counterfactual_score_code',
        tweets[0],
        JSON.stringify({
          tweetCount: tweets.length,
          hasFailureCode: data.failures.length > 0 || data.buildOutcomes.length > 0,
          failureCount: data.failures.length,
          buildOutcomeCount: data.buildOutcomes.length,
          gapCount: data.gaps.length,
          postResult
        })
      ]);
    } catch (dbError) {
      // Non-fatal - log but continue
      console.error('Failed to log post to DB:', dbError.message);
    } finally {
      client.release();
    }

    emit('skill:complete', {
      skill: 'x-post-standalone-counterfactual-score-code',
      success: postResult.success,
      tweetCount: tweets.length,
      timestamp: new Date().toISOString()
    });

    return { 
      success: postResult.success, 
      tweets, 
      postResult,
      dataUsed: {
        hasScore: !!data.score,
        failureCount: data