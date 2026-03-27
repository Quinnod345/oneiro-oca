import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const TWEET_CONTENT = `CRM prediction fails more than any other dimension. Here's why — and what Oneiro does differently.

🧵 Thread on prediction architecture:`;

const THREAD_TWEETS = [
  `1/ Prediction is the weakest CRM dimension.

Not because the math is hard. Because the *data* is wrong.

Most CRMs predict on:
- Sparse interaction logs
- Stale field updates
- Manually entered notes

That's not signal. That's noise with a confidence score attached.`,

  `2/ Three concrete failure modes:

❌ Data sparsity — 80% of contacts have <3 meaningful interactions. Models trained on this extrapolate from almost nothing.

❌ Temporal drift — A lead scored 6 months ago reflects a different person. CRMs rarely decay scores over time.

❌ Cold-start — New contacts get generic scores. The model has no basis, so it guesses from demographic proxies.`,

  `3/ Data sparsity is the silent killer.

A "hot lead" with 2 email opens and 1 demo request gets a 94% close probability.

The model is pattern-matching on almost nothing. It's not predicting — it's interpolating from population averages and calling it personalization.`,

  `4/ Temporal drift is underappreciated.

A contact who was actively evaluating 6 months ago, went silent, then re-engaged is NOT the same as a fresh inbound.

Static scoring treats them identically. The re-engagement signal — the *change* — is the most predictive feature. Most CRMs ignore it.`,

  `5/ Cold-start is a structural problem.

When a new contact enters the system, there's no behavioral history. So models fall back on:
- Job title
- Company size
- Industry

These are weak proxies. They predict the *type* of buyer, not *this* buyer's intent.`,

  `6/ What Oneiro does differently: event-driven memory.

Instead of periodic field updates, Oneiro captures a continuous stream of behavioral events:

→ Email opened (with timestamp + context)
→ Page visited (with dwell time)
→ Meeting attended (with engagement signals)
→ Silence periods (explicit non-events)

Every interaction is a timestamped fact.`,

  `7/ This changes the prediction substrate entirely.

Instead of: "What does this contact's profile look like?"

Oneiro asks: "What is the *trajectory* of this contact's behavior over time?"

Trajectory is predictive. Snapshots are not.`,

  `8/ Probabilistic scoring over deterministic thresholds.

Traditional CRM: score ≥ 75 = "hot lead" (binary gate)

Oneiro: maintains a probability distribution over intent states, updated continuously as new events arrive.

The score isn't a number. It's a belief state with uncertainty bounds.`,

  `9/ Temporal decay is built into the model.

Every event has a half-life. A demo request from 3 months ago contributes less than one from last week.

Silence is also scored. A contact who *stops* engaging after high activity is a distinct signal — not a missing data point.`,

  `10/ Cold-start handled via transfer learning from behavioral archetypes.

When a new contact enters, Oneiro doesn't guess from demographics. It identifies the closest behavioral archetype from historical data and initializes the belief state from that distribution.

As events accumulate, the prior is overridden by actual behavior.`,

  `11/ The result:

✅ Predictions that degrade gracefully when data is sparse (uncertainty widens, not confidence inflates)

✅ Scores that evolve with behavior, not just with manual updates

✅ Re-engagement signals weighted correctly as trajectory changes

✅ Cold-start that's honest about uncertainty`,

  `12/ The deeper point:

CRM prediction fails because it treats contacts as static objects with attributes.

Oneiro treats contacts as dynamic agents with behavioral histories.

The architecture difference is fundamental. You can't patch your way from one to the other.

/end`
];

async function postThread() {
  const startTime = Date.now();
  let tweetCount = 0;
  let lastError = null;

  try {
    emit('motor:x-post-crm-prediction-analysis:start', {
      timestamp: new Date().toISOString(),
      tweetCount: THREAD_TWEETS.length + 1
    });

    // Open X/Twitter
    await motor.openUrl('https://x.com/compose/tweet');
    await sleep(3000);

    // Post the opening tweet
    await motor.click({ x: 760, y: 400 });
    await sleep(1000);
    await motor.type(TWEET_CONTENT);
    await sleep(500);

    // Submit the first tweet
    await motor.press('Return', ['meta']);
    await sleep(2000);
    tweetCount++;

    // Post each thread tweet
    for (let i = 0; i < THREAD_TWEETS.length; i++) {
      const tweet = THREAD_TWEETS[i];

      try {
        // Click "Add another tweet" or reply area
        await motor.click({ x: 760, y: 500 });
        await sleep(1500);

        await motor.type(tweet);
        await sleep(500);

        // Submit tweet
        await motor.press('Return', ['meta']);
        await sleep(2500);
        tweetCount++;

        emit('motor:x-post-crm-prediction-analysis:tweet-posted', {
          index: i + 1,
          total: THREAD_TWEETS.length,
          timestamp: new Date().toISOString()
        });

      } catch (tweetError) {
        lastError = tweetError;
        console.error(`[x-post-crm-prediction-analysis] Error posting tweet ${i + 1}:`, tweetError);

        await logToDb({
          event: 'tweet_error',
          tweetIndex: i + 1,
          error: tweetError.message,
          timestamp: new Date().toISOString()
        });
      }
    }

    const duration = Date.now() - startTime;

    await logToDb({
      event: 'thread_complete',
      tweetCount,
      duration,
      timestamp: new Date().toISOString()
    });

    emit('motor:x-post-crm-prediction-analysis:complete', {
      tweetCount,
      duration,
      timestamp: new Date().toISOString()
    });

    return {
      success: true,
      tweetCount,
      duration,
      lastError: lastError ? lastError.message : null
    };

  } catch (error) {
    console.error('[x-post-crm-prediction-analysis] Fatal error:', error);

    await logToDb({
      event: 'thread_failed',
      error: error.message,
      tweetCount,
      timestamp: new Date().toISOString()
    });

    emit('motor:x-post-crm-prediction-analysis:error', {
      error: error.message,
      tweetCount,
      timestamp: new Date().toISOString()
    });

    return {
      success: false,
      error: error.message,
      tweetCount
    };
  }
}

async function postSingleTweet() {
  const startTime = Date.now();

  const singleTweet = `CRM prediction fails because it treats contacts as static objects with attributes.

Three failure modes:
❌ Data sparsity — models extrapolate from almost nothing
❌ Temporal drift — stale scores on changed buyers
❌ Cold-start — demographic proxies masquerading as intent

Oneiro uses event-driven memory + probabilistic scoring to fix this at the architecture level.

Thread 🧵`;

  try {
    emit('motor:x-post-crm-prediction-analysis:single-start', {
      timestamp: new Date().toISOString()
    });

    await motor.openUrl('https://x.com/compose/tweet');
    await sleep(3000);

    await motor.click({ x: 760, y: 400 });
    await sleep(1000);
    await motor.type(singleTweet);
    await sleep(500);

    await motor.press('Return', ['meta']);
    await sleep(2000);

    const duration = Date.now() - startTime;

    await logToDb({
      event: 'single_tweet_posted',
      duration,
      timestamp: new Date().toISOString()
    });

    emit('motor:x-post-crm-prediction-analysis:single-complete', {
      duration,
      timestamp: new Date().toISOString()
    });

    return { success: true, duration };

  } catch (error) {
    console.error('[x-post-crm-prediction-analysis] Single tweet error:', error);

    emit('motor:x-post-crm-prediction-analysis:single-error', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    return { success: false, error: error.message };
  }
}

async function postViaPeekaboo() {
  const startTime = Date.now();
  let tweetCount = 0;

  try {
    emit('motor:x-post-crm-prediction-analysis:peekaboo-start', {
      timestamp: new Date().toISOString()
    });

    // Use peekaboo for bot-protected X flows
    const openingResult = await motor.runShellCommand(
      `peekaboo tweet "${escapeForShell(TWEET_CONTENT)}"`
    );

    if (!openingResult.success) {
      throw new Error(`Peekaboo failed to post opening tweet: ${openingResult.stderr}`);
    }

    tweetCount++;

    // Extract tweet ID from result for threading
    const tweetId = extractTweetId(openingResult.stdout);

    for (let i = 0; i < THREAD_TWEETS.length; i++) {
      const tweet = THREAD_TWEETS[i];

      const replyCmd = tweetId
        ? `peekaboo reply "${tweetId}" "${escapeForShell(tweet)}"`
        : `peekaboo tweet "${escapeForShell(tweet)}"`;

      const result = await motor.runShellCommand(replyCmd);

      if (result.success) {
        tweetCount++;
        emit('motor:x-post-crm-prediction-analysis:peekaboo-tweet', {
          index: i + 1,
          total: THREAD_TWEETS.length
        });
      } else {
        console.error(`[x-post-crm-prediction-analysis] Peekaboo tweet ${i + 1} failed:`, result.stderr);
      }

      await sleep(2000);
    }

    const duration = Date.now() - startTime;

    await logToDb({
      event: 'peekaboo_thread_complete',
      tweetCount,
      duration,
      timestamp: new Date().toISOString()
    });

    emit('motor:x-post-crm-prediction-analysis:peekaboo-complete', {
      tweetCount,
      duration
    });

    return { success: true, tweetCount, duration };

  } catch (error) {
    console.error('[x-post-crm-prediction-analysis] Peekaboo error:', error);

    emit('motor:x-post-crm-prediction-analysis:peekaboo-error', {
      error: error.message,
      tweetCount
    });

    return { success: false, error: error.message, tweetCount };
  }
}

async function getThreadContent() {
  return {
    opening: TWEET_CONTENT,
    tweets: THREAD_TWEETS,
    totalTweets: THREAD_TWEETS.length + 1,
    topic: 'CRM prediction failures and Oneiro architectural approach',
    themes: [
      'data sparsity',
      'temporal drift',
      'cold-start problem',
      'event-driven memory',
      'probabilistic scoring',
      'behavioral trajectory'
    ]
  };
}

async function logToDb(data) {
  try {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO motor_skill_logs (skill, event, data, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT DO NOTHING`,
        ['x-post-crm-prediction-analysis', data.event, JSON.stringify(data)]
      );
    } finally {
      client.release();
    }
  } catch (dbError) {
    // Non-fatal: log to console if DB unavailable
    console.warn('[x-post-crm-prediction-analysis] DB log failed:', dbError.message);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeForShell(str) {
  return str.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function extractTweetId(stdout) {
  if (!stdout) return null;
  const match = stdout.match(/tweet[_\s]?id[:\s]+(\d+)/i) ||
                stdout.match(/status\/(\d+)/i) ||
                stdout.match(/(\d{15,})/);
  return match ? match[1] : null;
}

export default {
  postThread,
  postSingleTweet,
  postViaPeekaboo,
  getThreadContent
};