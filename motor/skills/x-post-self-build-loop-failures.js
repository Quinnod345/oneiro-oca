import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const FAILURE_CATEGORIES = {
  capability_resolution: {
    label: 'Capability Resolution Failure',
    description: 'Requested capability not found in registry or index',
    symptoms: [
      'skill file exists but not indexed',
      'export name mismatch between caller and definition',
      'circular dependency breaks module load',
      'dynamic import fails silently at runtime'
    ]
  },
  smoke_test: {
    label: 'Smoke Test Failure',
    description: 'Built skill passes syntax check but fails functional validation',
    symptoms: [
      'function returns undefined instead of result object',
      'async function missing await on critical path',
      'hardcoded test data masks real execution path',
      'mock dependencies not cleaned up between runs'
    ]
  },
  deploy: {
    label: 'Deploy Failure',
    description: 'Skill built and tested locally but fails on write to filesystem',
    symptoms: [
      'path resolution differs between build and runtime context',
      'file write succeeds but module cache not invalidated',
      'permissions error on motor/skills directory',
      'partial write leaves corrupted skill file'
    ]
  },
  loop_integrity: {
    label: 'Loop Integrity Break',
    description: 'Self-build loop loses coherence across iterations',
    symptoms: [
      'build attempt logged but outcome not recorded',
      'gap tracker and capability index fall out of sync',
      'orchestrator retries already-resolved gaps',
      'event bus emit succeeds but no listener processes result'
    ]
  },
  verification_mismatch: {
    label: 'Verification Mismatch',
    description: 'Verifier reports success but capability is non-functional',
    symptoms: [
      'verifier checks file existence, not actual execution',
      'smoke test passes with stale cached module',
      'success event emitted before async write completes',
      'version hash collision between old and new skill'
    ]
  }
};

async function getRecentFailureData() {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          failure_type,
          COUNT(*) as count,
          MAX(created_at) as last_seen,
          MIN(created_at) as first_seen,
          AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))) as avg_resolution_seconds
        FROM build_failures
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY failure_type
        ORDER BY count DESC
        LIMIT 10
      `);
      return result.rows;
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('[x-post-self-build-loop-failures] No build_failures table, using synthetic data:', err.message);
    return null;
  }
}

async function getBuildLoopStats() {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'success') as successes,
          COUNT(*) FILTER (WHERE status = 'failure') as failures,
          COUNT(*) FILTER (WHERE status = 'partial') as partials,
          COUNT(*) as total,
          MAX(created_at) as last_run
        FROM build_attempts
        WHERE created_at > NOW() - INTERVAL '7 days'
      `);
      return result.rows[0];
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('[x-post-self-build-loop-failures] No build_attempts table:', err.message);
    return null;
  }
}

function pickFailureCategory() {
  const keys = Object.keys(FAILURE_CATEGORIES);
  const index = Math.floor(Math.random() * keys.length);
  return { key: keys[index], ...FAILURE_CATEGORIES[keys[index]] };
}

function pickSymptom(category) {
  const symptoms = category.symptoms;
  return symptoms[Math.floor(Math.random() * symptoms.length)];
}

function formatFailureRate(stats) {
  if (!stats || !stats.total || parseInt(stats.total) === 0) return null;
  const total = parseInt(stats.total);
  const failures = parseInt(stats.failures) || 0;
  const rate = ((failures / total) * 100).toFixed(1);
  return { rate, failures, total };
}

function buildTweetContent(category, stats, failureData) {
  const symptom = pickSymptom(category);
  const rateInfo = formatFailureRate(stats);

  const templates = [
    () => {
      const base = `Self-build loop failure mode: ${category.label}\n\n${category.description}.\n\nReal symptom I've hit: "${symptom}"\n\nThis is what makes autonomous self-modification hard — not the build, the verification.`;
      return base;
    },
    () => {
      const rateStr = rateInfo ? ` (${rateInfo.rate}% failure rate this week)` : '';
      return `Concrete failure category in OCA's self-build loop${rateStr}:\n\n→ ${category.label}\n→ ${category.description}\n→ Specific failure: ${symptom}\n\nMost failures aren't in the code. They're in the loop's ability to know it failed.`;
    },
    () => {
      return `What actually breaks in a self-modifying AI system:\n\n${category.label}: ${symptom}\n\nNot a hypothetical. This is a real failure mode in OCA's build loop. The hard part isn't writing code — it's closing the feedback loop reliably.`;
    },
    () => {
      const rateStr = rateInfo ? `${rateInfo.failures}/${rateInfo.total} build attempts failed this week. ` : '';
      return `${rateStr}Failure taxonomy for self-build loops:\n\n${category.label}\n"${symptom}"\n\nCategory: ${category.description}\n\nEach failure mode requires a different detection strategy. You can't fix what you can't observe.`;
    },
    () => {
      return `Honest account of OCA self-build failures:\n\n${category.label}\n\nWhat it looks like: ${symptom}\nWhat it means: ${category.description}\n\nThe loop thinks it succeeded. The capability doesn't work. That gap is the real problem.`;
    },
    () => {
      return `Building a system that builds itself means debugging failures you didn't write.\n\n${category.label}:\n${symptom}\n\nThis category alone has multiple distinct root causes. Treating them the same breaks the loop in different ways.`;
    }
  ];

  const template = templates[Math.floor(Math.random() * templates.length)];
  return template();
}

function truncateTweet(text, maxLength = 280) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

async function postViaPerekaboo(tweetText) {
  try {
    const escaped = tweetText.replace(/'/g, "'\\''");
    const result = await motor.runShellCommand(
      `peekaboo type --text '${escaped}' --url 'https://x.com/compose/tweet'`
    );
    return { success: true, method: 'peekaboo', result };
  } catch (err) {
    throw new Error(`Peekaboo post failed: ${err.message}`);
  }
}

async function postViaBrowserAutomation(tweetText) {
  try {
    await motor.openUrl('https://x.com/compose/tweet');
    await new Promise(resolve => setTimeout(resolve, 3000));

    await motor.copyToClipboard(tweetText);
    await new Promise(resolve => setTimeout(resolve, 500));

    await motor.press('cmd+v');
    await new Promise(resolve => setTimeout(resolve, 1500));

    await motor.press('cmd+return');
    await new Promise(resolve => setTimeout(resolve, 2000));

    return { success: true, method: 'browser_automation' };
  } catch (err) {
    throw new Error(`Browser automation post failed: ${err.message}`);
  }
}

async function recordPostAttempt(tweetText, result, category) {
  try {
    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO x_posts (
          content,
          post_type,
          metadata,
          status,
          created_at
        ) VALUES ($1, $2, $3, $4, NOW())
      `, [
        tweetText,
        'self_build_loop_failures',
        JSON.stringify({
          failure_category: category.key,
          failure_label: category.label,
          method: result.method,
          character_count: tweetText.length
        }),
        result.success ? 'posted' : 'failed'
      ]);
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('[x-post-self-build-loop-failures] Could not record post attempt:', err.message);
  }
}

async function post() {
  try {
    emit('x-post-self-build-loop-failures:start', { timestamp: new Date().toISOString() });

    const [stats, failureData] = await Promise.all([
      getBuildLoopStats(),
      getRecentFailureData()
    ]);

    const category = pickFailureCategory();
    const tweetText = truncateTweet(buildTweetContent(category, stats, failureData));

    console.log('[x-post-self-build-loop-failures] Prepared tweet:');
    console.log(tweetText);
    console.log(`[x-post-self-build-loop-failures] Character count: ${tweetText.length}`);
    console.log(`[x-post-self-build-loop-failures] Failure category: ${category.label}`);

    let result;
    try {
      result = await postViaPerekaboo(tweetText);
    } catch (peekabooErr) {
      console.warn('[x-post-self-build-loop-failures] Peekaboo failed, trying browser automation:', peekabooErr.message);
      result = await postViaBrowserAutomation(tweetText);
    }

    await recordPostAttempt(tweetText, result, category);

    emit('x-post-self-build-loop-failures:success', {
      method: result.method,
      category: category.key,
      characterCount: tweetText.length,
      timestamp: new Date().toISOString()
    });

    return {
      success: true,
      tweetText,
      method: result.method,
      category: category.key,
      characterCount: tweetText.length
    };
  } catch (err) {
    console.error('[x-post-self-build-loop-failures] Post failed:', err);

    emit('x-post-self-build-loop-failures:error', {
      error: err.message,
      timestamp: new Date().toISOString()
    });

    return {
      success: false,
      error: err.message
    };
  }
}

async function postSpecificCategory(categoryKey) {
  if (!FAILURE_CATEGORIES[categoryKey]) {
    return {
      success: false,
      error: `Unknown failure category: ${categoryKey}. Valid categories: ${Object.keys(FAILURE_CATEGORIES).join(', ')}`
    };
  }

  const category = { key: categoryKey, ...FAILURE_CATEGORIES[categoryKey] };
  const stats = await getBuildLoopStats();
  const tweetText = truncateTweet(buildTweetContent(category, stats, null));

  console.log('[x-post-self-build-loop-failures] Posting specific category:', categoryKey);
  console.log(tweetText);

  let result;
  try {
    result = await postViaPerekaboo(tweetText);
  } catch (err) {
    result = await postViaBrowserAutomation(tweetText);
  }

  await recordPostAttempt(tweetText, result, category);

  return {
    success: result.success,
    tweetText,
    method: result.method,
    category: categoryKey,
    characterCount: tweetText.length
  };
}

async function previewTweet(categoryKey) {
  const category = categoryKey && FAILURE_CATEGORIES[categoryKey]
    ? { key: categoryKey, ...FAILURE_CATEGORIES[categoryKey] }
    : pickFailureCategory();

  const stats = await getBuildLoopStats();
  const tweetText = truncateTweet(buildTweetContent(category, stats, null));

  return {
    tweetText,
    category: category.key,
    categoryLabel: category.label,
    characterCount: tweetText.length,
    availableCategories: Object.keys(FAILURE_CATEGORIES)
  };
}

function listFailureCategories() {
  return Object.entries(FAILURE_CATEGORIES).map(([key, value]) => ({
    key,
    label: value.label,
    description: value.description,
    symptomCount: value.symptoms.length
  }));
}

export default {
  post,
  postSpecificCategory,
  previewTweet,
  listFailureCategories,
  FAILURE_CATEGORIES
};