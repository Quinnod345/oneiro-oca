import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

async function getRecentBuildFailure() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        b.id,
        b.skill_name,
        b.error_message,
        b.stack_trace,
        b.build_output,
        b.failure_type,
        b.created_at,
        b.metadata
      FROM build_history b
      WHERE b.status = 'failed'
        AND b.error_message IS NOT NULL
      ORDER BY b.created_at DESC
      LIMIT 1
    `);
    return result.rows[0] || null;
  } catch (err) {
    // Try alternate table names
    try {
      const result = await client.query(`
        SELECT 
          id,
          skill_name,
          error_message,
          stack_trace,
          build_output,
          created_at
        FROM builds
        WHERE status = 'failed'
          AND error_message IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1
      `);
      return result.rows[0] || null;
    } catch (err2) {
      console.error('[x-post-standalone] DB query failed:', err2.message);
      return null;
    }
  } finally {
    client.release();
  }
}

async function getCapabilityGapContext() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT gap_description, skill_name, severity, created_at
      FROM capability_gaps
      WHERE resolved = false
      ORDER BY created_at DESC
      LIMIT 3
    `);
    return result.rows;
  } catch (err) {
    return [];
  } finally {
    client.release();
  }
}

function truncateStackTrace(stackTrace, maxLines = 8) {
  if (!stackTrace) return null;
  const lines = stackTrace.split('\n').filter(l => l.trim());
  if (lines.length <= maxLines) return lines.join('\n');
  return lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines)`;
}

function extractKeyError(errorMessage, stackTrace) {
  if (!errorMessage && !stackTrace) return 'Unknown error';
  
  const msg = errorMessage || '';
  
  // Extract the most meaningful part
  const patterns = [
    /Cannot find module '([^']+)'/,
    /SyntaxError: ([^\n]+)/,
    /TypeError: ([^\n]+)/,
    /ReferenceError: ([^\n]+)/,
    /Error: ([^\n]+)/,
    /ENOENT: ([^\n]+)/,
    /EACCES: ([^\n]+)/,
    /MODULE_NOT_FOUND/,
  ];
  
  for (const pattern of patterns) {
    const match = msg.match(pattern);
    if (match) return match[0].substring(0, 120);
  }
  
  return msg.substring(0, 120);
}

function buildTweetContent(failure, gaps) {
  const skillName = failure.skill_name || 'unknown-skill';
  const errorKey = extractKeyError(failure.error_message, failure.stack_trace);
  const failureType = failure.failure_type || 'build_error';
  const timestamp = new Date(failure.created_at).toISOString().split('T')[0];
  
  // Build raw, unfiltered failure content
  const lines = [];
  
  lines.push(`🔴 OCA BUILD FAILURE — raw & unfiltered`);
  lines.push(``);
  lines.push(`Skill: ${skillName}`);
  lines.push(`Type: ${failureType}`);
  lines.push(`Date: ${timestamp}`);
  lines.push(``);
  lines.push(`Error:`);
  lines.push(errorKey);
  
  if (failure.stack_trace) {
    const truncated = truncateStackTrace(failure.stack_trace, 4);
    if (truncated) {
      lines.push(``);
      lines.push(`Stack:`);
      lines.push(truncated.substring(0, 200));
    }
  }
  
  // What it means for the architecture
  lines.push(``);
  lines.push(`What this breaks:`);
  
  if (failureType === 'module_not_found' || errorKey.includes('Cannot find module')) {
    lines.push(`→ Dependency resolution failed. Skill cannot load.`);
    lines.push(`→ Cognitive loop stalls at capability invocation.`);
  } else if (failureType === 'syntax_error' || errorKey.includes('SyntaxError')) {
    lines.push(`→ Malformed code generated. Self-build produced invalid JS.`);
    lines.push(`→ Autonomous builder needs syntax validation gate.`);
  } else if (failureType === 'type_error' || errorKey.includes('TypeError')) {
    lines.push(`→ Runtime type mismatch. Interface contract violated.`);
    lines.push(`→ Motor engine API assumptions wrong.`);
  } else if (errorKey.includes('ENOENT')) {
    lines.push(`→ File system miss. Path assumptions broken.`);
    lines.push(`→ Build environment state diverged from expected.`);
  } else {
    lines.push(`→ Skill execution blocked. Capability unavailable.`);
    lines.push(`→ Gap logged. Auto-resolver queued.`);
  }
  
  if (gaps.length > 0) {
    lines.push(``);
    lines.push(`Open gaps: ${gaps.length}`);
    lines.push(`Latest: ${gaps[0].gap_description?.substring(0, 80) || 'unresolved capability miss'}`);
  }
  
  lines.push(``);
  lines.push(`Building in public. Failures included.`);
  lines.push(`#OCA #BuildInPublic #CognitiveArchitecture #AIFails`);
  
  const tweet = lines.join('\n');
  
  // Twitter limit is 280 chars for simple tweets, but threads can be longer
  // For standalone, keep under 280 or trim
  if (tweet.length <= 280) return tweet;
  
  // Trim to fit
  const essential = [
    `🔴 OCA BUILD FAILURE`,
    ``,
    `Skill: ${skillName}`,
    `Error: ${errorKey.substring(0, 100)}`,
    ``,
    failureType === 'syntax_error' || errorKey.includes('SyntaxError')
      ? `Self-build generated invalid JS. Syntax gate needed.`
      : failureType === 'module_not_found' || errorKey.includes('Cannot find module')
      ? `Dependency resolution failed. Cognitive loop stalled.`
      : `Skill execution blocked. Capability gap logged.`,
    ``,
    `Building in public. Failures included.`,
    `#OCA #BuildInPublic #AIFails`
  ].join('\n');
  
  return essential.substring(0, 280);
}

async function postStandaloneTweet(tweetContent) {
  try {
    // Try peekaboo first for bot-protected X/Twitter
    const peekabooResult = await motor.runShellCommand(
      `peekaboo post-tweet --content ${JSON.stringify(tweetContent)}`
    );
    
    if (peekabooResult && !peekabooResult.includes('error') && !peekabooResult.includes('Error')) {
      return { success: true, method: 'peekaboo', result: peekabooResult };
    }
  } catch (err) {
    console.log('[x-post-standalone] Peekaboo not available, falling back to browser automation');
  }
  
  // Fall back to browser automation
  try {
    await motor.openUrl('https://x.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));
    
    // Click compose area
    await motor.click(760, 400);
    await new Promise(r => setTimeout(r, 1000));
    
    // Copy tweet to clipboard and paste (handles special chars better)
    await motor.copyToClipboard(tweetContent);
    await new Promise(r => setTimeout(r, 500));
    
    await motor.press(['command', 'v']);
    await new Promise(r => setTimeout(r, 1500));
    
    // Post the tweet
    await motor.press(['command', 'return']);
    await new Promise(r => setTimeout(r, 2000));
    
    return { success: true, method: 'browser_automation' };
  } catch (err) {
    throw new Error(`Browser automation failed: ${err.message}`);
  }
}

async function logPostAttempt(failure, tweetContent, result) {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO x_posts (
        post_type,
        content,
        skill_name,
        build_failure_id,
        success,
        method,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [
      'standalone_failure',
      tweetContent,
      failure?.skill_name || null,
      failure?.id || null,
      result.success,
      result.method || 'unknown'
    ]);
  } catch (err) {
    // Table might not exist yet, log to events instead
    console.log('[x-post-standalone] Could not log to x_posts table:', err.message);
  } finally {
    client.release();
  }
}

async function run(options = {}) {
  console.log('[x-post-standalone] Starting standalone failure post...');
  
  try {
    // Get the most recent real build failure
    const failure = await getRecentBuildFailure();
    
    if (!failure && !options.forcePost) {
      console.log('[x-post-standalone] No recent build failures found');
      
      await emit('x_post_standalone_skipped', {
        reason: 'no_failures_found',
        timestamp: new Date().toISOString()
      });
      
      return {
        success: false,
        reason: 'no_failures_found',
        message: 'No build failures in database to post about'
      };
    }
    
    // Get capability gap context
    const gaps = await getCapabilityGapContext();
    
    // Build tweet content with real failure data
    const tweetContent = failure 
      ? buildTweetContent(failure, gaps)
      : buildFallbackTweet();
    
    console.log('[x-post-standalone] Tweet content prepared:');
    console.log(tweetContent);
    console.log(`[x-post-standalone] Character count: ${tweetContent.length}`);
    
    if (options.dryRun) {
      return {
        success: true,
        dryRun: true,
        tweetContent,
        failure: failure ? {
          id: failure.id,
          skill_name: failure.skill_name,
          failure_type: failure.failure_type
        } : null
      };
    }
    
    // Post the tweet
    const result = await postStandaloneTweet(tweetContent);
    
    // Log the attempt
    await logPostAttempt(failure, tweetContent, result);
    
    // Emit success event
    await emit('x_post_standalone_success', {
      skill_name: failure?.skill_name,
      failure_type: failure?.failure_type,
      method: result.method,
      tweet_length: tweetContent.length,
      timestamp: new Date().toISOString()
    });
    
    console.log('[x-post-standalone] Successfully posted standalone failure tweet');
    
    return {
      success: true,
      method: result.method,
      tweetContent,
      failure: failure ? {
        id: failure.id,
        skill_name: failure.skill_name,
        failure_type: failure.failure_type
      } : null
    };
    
  } catch (err) {
    console.error('[x-post-standalone] Failed:', err.message);
    
    await emit('x_post_standalone_error', {
      error: err.message,
      timestamp: new Date().toISOString()
    });
    
    return {
      success: false,
      error: err.message
    };
  }
}

function buildFallbackTweet() {
  return `🔴 OCA BUILD FAILURE — no DB record yet

The failure logging system itself failed to record failures.

Meta-failure: Can't introspect what broke because the introspection layer is broken.

This is what building a cognitive architecture from scratch looks like.

Fixing the observer before fixing the observed.

#OCA #BuildInPublic #CognitiveArchitecture #AIFails`.substring(0, 280);
}

async function postAboutSpecificFailure(failureData) {
  if (!failureData || !failureData.error_message) {
    throw new Error('failureData must include error_message');
  }
  
  const gaps = await getCapabilityGapContext();
  const tweetContent = buildTweetContent(failureData, gaps);
  
  const result = await postStandaloneTweet(tweetContent);
  await logPostAttempt(failureData, tweetContent, result);
  
  return { success: true, tweetContent, result };
}

async function previewTweet(options = {}) {
  return run({ ...options, dryRun: true });
}

export default {
  run,
  postAboutSpecificFailure,
  previewTweet,
  buildTweetContent,
  getRecentBuildFailure,
  getCapabilityGapContext
};