import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

async function gatherLiveMetrics() {
  const metrics = {
    buildCount: 0,
    successRate: 0,
    capabilityCount: 0,
    recentCapabilities: [],
    crmUpdates: 0,
    githubCommits: 0,
    lastBuildStatus: 'unknown',
    lastBuildTime: null,
    activeSkills: 0,
    loopIntegrity: null,
  };

  try {
    // Build metrics
    const buildResult = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successes,
        MAX(created_at) as last_build,
        (SELECT status FROM builds ORDER BY created_at DESC LIMIT 1) as last_status
      FROM builds
      WHERE created_at > NOW() - INTERVAL '7 days'
    `);
    if (buildResult.rows[0]) {
      const row = buildResult.rows[0];
      metrics.buildCount = parseInt(row.total) || 0;
      metrics.successRate = metrics.buildCount > 0
        ? Math.round((parseInt(row.successes) / metrics.buildCount) * 100)
        : 0;
      metrics.lastBuildStatus = row.last_status || 'unknown';
      metrics.lastBuildTime = row.last_build;
    }
  } catch (e) {
    // builds table may not exist
  }

  try {
    // Capability metrics
    const capResult = await pool.query(`
      SELECT COUNT(*) as total,
        array_agg(name ORDER BY created_at DESC) as recent_names
      FROM capabilities
      WHERE created_at > NOW() - INTERVAL '7 days'
    `);
    if (capResult.rows[0]) {
      metrics.capabilityCount = parseInt(capResult.rows[0].total) || 0;
      const names = capResult.rows[0].recent_names || [];
      metrics.recentCapabilities = names.slice(0, 3).filter(Boolean);
    }
  } catch (e) {
    // capabilities table may not exist
  }

  try {
    // Total active skills
    const skillResult = await pool.query(`
      SELECT COUNT(*) as total FROM capabilities WHERE status = 'active'
    `);
    if (skillResult.rows[0]) {
      metrics.activeSkills = parseInt(skillResult.rows[0].total) || 0;
    }
  } catch (e) {}

  try {
    // CRM updates
    const crmResult = await pool.query(`
      SELECT COUNT(*) as total FROM crm_events
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);
    if (crmResult.rows[0]) {
      metrics.crmUpdates = parseInt(crmResult.rows[0].total) || 0;
    }
  } catch (e) {}

  try {
    // GitHub commits via shell
    const gitResult = await motor.runShellCommand(
      'git -C /Users/$(whoami)/oneiro log --oneline --since="7 days ago" 2>/dev/null | wc -l'
    );
    if (gitResult && gitResult.stdout) {
      metrics.githubCommits = parseInt(gitResult.stdout.trim()) || 0;
    }
  } catch (e) {}

  try {
    // Loop integrity
    const integrityResult = await pool.query(`
      SELECT score, status FROM build_loop_integrity
      ORDER BY created_at DESC LIMIT 1
    `);
    if (integrityResult.rows[0]) {
      metrics.loopIntegrity = integrityResult.rows[0];
    }
  } catch (e) {}

  return metrics;
}

async function composeTweet(metrics) {
  const statusEmoji = metrics.lastBuildStatus === 'success' ? '✅' : 
                      metrics.lastBuildStatus === 'failure' ? '❌' : '🔄';
  
  const integrityStr = metrics.loopIntegrity
    ? ` | Loop integrity: ${metrics.loopIntegrity.score || metrics.loopIntegrity.status}`
    : '';

  const capStr = metrics.recentCapabilities.length > 0
    ? `\nNew skills: ${metrics.recentCapabilities.map(c => `#${c.replace(/[^a-zA-Z0-9]/g, '')}`).join(' ')}`
    : '';

  const tweet = `🧠 Building in public — Oneiro cognitive architecture update

${statusEmoji} Last 7 days:
• ${metrics.buildCount} builds | ${metrics.successRate}% success rate
• ${metrics.capabilityCount} new capabilities added
• ${metrics.activeSkills} active skills total
• ${metrics.crmUpdates} CRM events (24h)
• ${metrics.githubCommits} commits to main${integrityStr}${capStr}

Everything is self-built, self-monitored, self-improving.

#BuildingInPublic #AI #CognitiveArchitecture #OpenSource`;

  return tweet;
}

async function postBuildInPublic() {
  try {
    emit('x-post-build-in-public:start', { timestamp: new Date().toISOString() });

    const metrics = await gatherLiveMetrics();
    const tweet = await composeTweet(metrics);

    console.log('[x-post-build-in-public] Composed tweet:', tweet);
    console.log('[x-post-build-in-public] Tweet length:', tweet.length);

    if (tweet.length > 280) {
      console.warn('[x-post-build-in-public] Tweet too long, truncating...');
    }

    // Try peekaboo first for bot-protected flow
    try {
      await motor.copyToClipboard(tweet);
      
      const peekabooResult = await motor.runShellCommand(
        `peekaboo navigate "https://twitter.com/compose/tweet" 2>&1 | head -5`
      );
      console.log('[x-post-build-in-public] Peekaboo result:', peekabooResult?.stdout);
    } catch (peekabooErr) {
      console.log('[x-post-build-in-public] Peekaboo not available, using browser automation');
    }

    // Browser automation fallback
    await motor.openUrl('https://twitter.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));

    await motor.click({ x: 760, y: 400 });
    await new Promise(r => setTimeout(r, 500));

    // Type the tweet
    await motor.type(tweet);
    await new Promise(r => setTimeout(r, 1000));

    // Submit with Cmd+Enter
    await motor.press('Return', ['command']);
    await new Promise(r => setTimeout(r, 2000));

    // Log to DB
    try {
      await pool.query(`
        INSERT INTO x_posts (content, type, status, metadata, created_at)
        VALUES ($1, $2, $3, $4, NOW())
      `, [
        tweet,
        'build-in-public',
        'posted',
        JSON.stringify({ metrics, source: 'x-post-build-in-public' })
      ]);
    } catch (dbErr) {
      console.warn('[x-post-build-in-public] Could not log to DB:', dbErr.message);
    }

    emit('x-post-build-in-public:success', {
      tweet,
      metrics,
      timestamp: new Date().toISOString()
    });

    await motor.showNotification(
      'Build in Public Posted',
      `Tweet posted: ${metrics.buildCount} builds, ${metrics.successRate}% success`
    );

    return { success: true, tweet, metrics };
  } catch (err) {
    console.error('[x-post-build-in-public] Error:', err);
    emit('x-post-build-in-public:error', { error: err.message });
    throw err;
  }
}

async function getDashboardLinks() {
  const links = {
    github: null,
    metrics: null,
    crm: null,
    buildLogs: null,
  };

  try {
    const result = await pool.query(`
      SELECT key, value FROM system_config
      WHERE key IN ('github_url', 'metrics_dashboard_url', 'crm_url', 'build_logs_url')
    `);
    for (const row of result.rows) {
      if (row.key === 'github_url') links.github = row.value;
      if (row.key === 'metrics_dashboard_url') links.metrics = row.value;
      if (row.key === 'crm_url') links.crm = row.value;
      if (row.key === 'build_logs_url') links.buildLogs = row.value;
    }
  } catch (e) {
    // system_config may not exist
  }

  return links;
}

async function postWithLinks() {
  try {
    emit('x-post-build-in-public:with-links:start', {});

    const [metrics, links] = await Promise.all([
      gatherLiveMetrics(),
      getDashboardLinks()
    ]);

    const statusEmoji = metrics.lastBuildStatus === 'success' ? '✅' : '🔄';
    
    const linkLines = [];
    if (links.github) linkLines.push(`📦 Code: ${links.github}`);
    if (links.metrics) linkLines.push(`📊 Metrics: ${links.metrics}`);
    if (links.buildLogs) linkLines.push(`🔧 Builds: ${links.buildLogs}`);

    const linksStr = linkLines.length > 0 ? '\n' + linkLines.join('\n') : '';

    const tweet = `🧠 Oneiro OCA — live build transparency

${statusEmoji} This week:
• ${metrics.buildCount} self-builds | ${metrics.successRate}% pass rate
• ${metrics.capabilityCount} new skills shipped
• ${metrics.activeSkills} capabilities running
• ${metrics.githubCommits} commits${linksStr}

The system builds itself. Watch it happen.

#BuildingInPublic #AGI #CognitiveArchitecture`;

    console.log('[x-post-build-in-public] With-links tweet:', tweet);

    await motor.copyToClipboard(tweet);
    await motor.openUrl('https://twitter.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));

    await motor.click({ x: 760, y: 400 });
    await new Promise(r => setTimeout(r, 500));
    await motor.type(tweet);
    await new Promise(r => setTimeout(r, 1000));
    await motor.press('Return', ['command']);
    await new Promise(r => setTimeout(r, 2000));

    emit('x-post-build-in-public:with-links:success', { tweet, metrics, links });

    return { success: true, tweet, metrics, links };
  } catch (err) {
    console.error('[x-post-build-in-public] postWithLinks error:', err);
    emit('x-post-build-in-public:with-links:error', { error: err.message });
    throw err;
  }
}

async function postDailyBuildLog() {
  try {
    emit('x-post-build-in-public:daily-log:start', {});

    const metrics = await gatherLiveMetrics();

    // Get today's specific build log
    let todayBuilds = [];
    try {
      const result = await pool.query(`
        SELECT name, status, duration_ms, created_at
        FROM builds
        WHERE created_at > NOW() - INTERVAL '24 hours'
        ORDER BY created_at DESC
        LIMIT 5
      `);
      todayBuilds = result.rows;
    } catch (e) {}

    const buildLines = todayBuilds.map(b => {
      const emoji = b.status === 'success' ? '✅' : '❌';
      const dur = b.duration_ms ? `${Math.round(b.duration_ms / 1000)}s` : '';
      return `${emoji} ${b.name || 'build'} ${dur}`;
    });

    const buildStr = buildLines.length > 0
      ? '\n' + buildLines.join('\n')
      : '\nNo builds in last 24h';

    const tweet = `📋 Oneiro daily build log — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}

Today's self-build activity:${buildStr}

Running totals:
• ${metrics.activeSkills} active capabilities
• ${metrics.successRate}% 7-day success rate
• ${metrics.crmUpdates} CRM events processed

This is what autonomous cognitive architecture looks like in practice.

#BuildingInPublic #AI #SelfImproving`;

    console.log('[x-post-build-in-public] Daily log tweet:', tweet);

    await motor.copyToClipboard(tweet);
    await motor.openUrl('https://twitter.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));

    await motor.click({ x: 760, y: 400 });
    await new Promise(r => setTimeout(r, 500));
    await motor.type(tweet);
    await new Promise(r => setTimeout(r, 1000));
    await motor.press('Return', ['command']);
    await new Promise(r => setTimeout(r, 2000));

    emit('x-post-build-in-public:daily-log:success', { tweet, metrics });

    return { success: true, tweet, metrics, todayBuilds };
  } catch (err) {
    console.error('[x-post-build-in-public] postDailyBuildLog error:', err);
    emit('x-post-build-in-public:daily-log:error', { error: err.message });
    throw err;
  }
}

async function previewTweet() {
  const metrics = await gatherLiveMetrics();
  const tweet = await composeTweet(metrics);
  return { tweet, metrics, length: tweet.length };
}

export default {
  postBuildInPublic,
  postWithLinks,
  postDailyBuildLog,
  previewTweet,
  gatherLiveMetrics,
  composeTweet,
  getDashboardLinks,
};