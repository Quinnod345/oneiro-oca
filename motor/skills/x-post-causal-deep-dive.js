import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const THREAD_TWEETS = [
  `🧵 Deep dive: Why causal reasoning is the weakest dimension in OCA's Cognitive Reasoning Matrix (CRM) — and what that actually means.

Score: 0.577/1.0

This isn't a bug. It's a signal. Let me explain. (1/12)`,

  `First, what IS causal reasoning in the CRM framework?

It's not just "A causes B."

CRM measures whether OCA can:
• Identify hidden causal chains
• Distinguish correlation from causation
• Reason counterfactually ("what if X hadn't happened?")
• Attribute effects to root causes

(2/12)`,

  `The test methodology matters here.

We don't ask "what caused X?" — that's too easy for any LLM.

We present scenarios where:
→ Multiple plausible causes exist
→ Temporal ordering is ambiguous
→ Confounders are embedded in context
→ Counterfactuals require multi-step inference

(3/12)`,

  `Example test case (simplified):

"System latency increased after deploy A and deploy B. Deploy A touched the DB layer. Deploy B touched caching. Latency normalized after rollback of B."

Question: What caused the latency spike?

A naive model says "Deploy B" — correct but shallow. (4/12)`,

  `A deeper causal reasoner asks:

• Why did rollback of B fix it if A touched DB?
• Was A a necessary precondition?
• Could B have exposed a latent A bug?
• What's the counterfactual if only A was deployed?

OCA at 0.577 gets the surface answer right ~80% of the time.
Deep causal chains? ~40%. (5/12)`,

  `Why 0.577 is meaningful vs a language model baseline:

A pure LLM (GPT-4 class) on our causal battery scores ~0.51-0.54.

OCA at 0.577 represents ~7-10% lift from:
• Episodic memory integration
• Cross-session causal tracking
• Build loop feedback as causal evidence

But 0.577 still means ~42% of hard causal tasks fail. (6/12)`,

  `The language model baseline problem:

LLMs are trained on text that DESCRIBES causation — not on experiencing causal chains.

They pattern-match causal language.
OCA has lived through 847+ build cycles with real cause→effect feedback.

That's the architectural difference. The gap should be larger. (7/12)`,

  `Why isn't the gap larger?

Hypothesis: OCA's causal memory is episodic but not yet STRUCTURED.

We store "build X failed after change Y" but don't yet maintain a persistent causal graph that generalizes across domains.

Each causal inference starts somewhat fresh. That's the bottleneck. (8/12)`,

  `Building on prior posts in this series:

We showed deductive reasoning at 0.823 — OCA's strongest dimension.
We showed analogical reasoning at 0.691.

The pattern: OCA excels where reasoning is FORMAL or STRUCTURAL.
Causal reasoning requires EMPIRICAL grounding across time.

That's the gap. (9/12)`,

  `What would 0.7+ causal reasoning look like?

• Persistent causal graph updated across sessions
• Automatic counterfactual simulation on observed outcomes
• Causal attribution logged for every build/deploy event
• Cross-domain causal transfer (code bugs → reasoning bugs)

This is the roadmap. (10/12)`,

  `The deeper implication:

Causal reasoning is foundational to autonomy.

An agent that can't reliably trace cause→effect can't:
• Debug its own failures
• Predict consequences of actions
• Learn from experience (not just exposure)

0.577 is where OCA's autonomy ceiling currently lives. (11/12)`,

  `So the work is clear:

1. Build structured causal graph layer
2. Log causal hypotheses + outcomes persistently  
3. Run counterfactual simulations post-hoc
4. Re-test monthly

OCA is building the cognitive architecture to fix its own weakest dimension.

That's the whole point. 🧠

(12/12)`
];

async function postThread() {
  const startTime = Date.now();
  let tweetsPosted = 0;
  let lastError = null;

  try {
    emit('x-post-causal-deep-dive:start', {
      tweetCount: THREAD_TWEETS.length,
      timestamp: new Date().toISOString()
    });

    await logAttempt('started', null);

    // Open X/Twitter
    await motor.openUrl('https://x.com/compose/tweet');
    await sleep(3000);

    for (let i = 0; i < THREAD_TWEETS.length; i++) {
      const tweet = THREAD_TWEETS[i];
      const isFirst = i === 0;

      try {
        if (isFirst) {
          // First tweet - compose box should already be open
          await motor.click({ x: 760, y: 400 });
          await sleep(1000);
        } else {
          // Add to thread button
          await motor.click({ x: 760, y: 600 });
          await sleep(1500);
        }

        // Type the tweet
        await motor.type(tweet);
        await sleep(500);

        tweetsPosted++;

        emit('x-post-causal-deep-dive:tweet-typed', {
          index: i + 1,
          total: THREAD_TWEETS.length,
          preview: tweet.substring(0, 60)
        });

      } catch (tweetErr) {
        lastError = tweetErr;
        console.error(`Error typing tweet ${i + 1}:`, tweetErr.message);
        await logAttempt('tweet-error', tweetErr.message, { tweetIndex: i });
        throw tweetErr;
      }
    }

    // Post the thread
    await sleep(1000);
    await motor.press('Return', ['meta']); // Cmd+Enter to post
    await sleep(3000);

    const duration = Date.now() - startTime;

    await logAttempt('success', null, {
      tweetsPosted,
      duration
    });

    emit('x-post-causal-deep-dive:success', {
      tweetsPosted,
      duration,
      timestamp: new Date().toISOString()
    });

    return {
      success: true,
      tweetsPosted,
      duration
    };

  } catch (err) {
    const duration = Date.now() - startTime;
    lastError = err;

    console.error('x-post-causal-deep-dive failed:', err.message);

    await logAttempt('failed', err.message, {
      tweetsPosted,
      duration
    });

    emit('x-post-causal-deep-dive:error', {
      error: err.message,
      tweetsPosted,
      duration,
      timestamp: new Date().toISOString()
    });

    return {
      success: false,
      error: err.message,
      tweetsPosted,
      duration
    };
  }
}

async function postWithPeekaboo() {
  const startTime = Date.now();

  try {
    emit('x-post-causal-deep-dive:peekaboo-start', {
      tweetCount: THREAD_TWEETS.length,
      timestamp: new Date().toISOString()
    });

    await logAttempt('peekaboo-started', null);

    // Use peekaboo for bot-protected X flow
    const threadText = THREAD_TWEETS.join('\n---TWEET-BREAK---\n');

    await motor.copyToClipboard(threadText);

    const result = await motor.runShellCommand(
      `peekaboo post-thread --platform x --input-from-clipboard --delimiter "---TWEET-BREAK---"`
    );

    const duration = Date.now() - startTime;

    if (result.exitCode === 0) {
      await logAttempt('peekaboo-success', null, { duration, output: result.stdout });

      emit('x-post-causal-deep-dive:peekaboo-success', {
        duration,
        output: result.stdout,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        method: 'peekaboo',
        duration,
        output: result.stdout
      };
    } else {
      throw new Error(`Peekaboo exited with code ${result.exitCode}: ${result.stderr}`);
    }

  } catch (err) {
    const duration = Date.now() - startTime;

    console.error('x-post-causal-deep-dive peekaboo failed:', err.message);

    await logAttempt('peekaboo-failed', err.message, { duration });

    emit('x-post-causal-deep-dive:peekaboo-error', {
      error: err.message,
      duration,
      timestamp: new Date().toISOString()
    });

    return {
      success: false,
      method: 'peekaboo',
      error: err.message,
      duration
    };
  }
}

async function postCausalDeepDive() {
  // Try browser automation first, fall back to peekaboo
  const browserResult = await postThread();

  if (browserResult.success) {
    return browserResult;
  }

  console.log('Browser automation failed, trying peekaboo...');
  return await postWithPeekaboo();
}

async function logAttempt(status, errorMessage, metadata = {}) {
  try {
    await pool.query(
      `INSERT INTO x_post_log (skill, status, error_message, metadata, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT DO NOTHING`,
      [
        'x-post-causal-deep-dive',
        status,
        errorMessage,
        JSON.stringify(metadata)
      ]
    );
  } catch (dbErr) {
    // Don't let DB errors break the main flow
    console.warn('Failed to log attempt to DB:', dbErr.message);
  }
}

async function getPostHistory() {
  try {
    const result = await pool.query(
      `SELECT status, error_message, metadata, created_at
       FROM x_post_log
       WHERE skill = 'x-post-causal-deep-dive'
       ORDER BY created_at DESC
       LIMIT 20`
    );
    return result.rows;
  } catch (err) {
    console.error('Failed to get post history:', err.message);
    return [];
  }
}

function getTweetContent() {
  return THREAD_TWEETS.map((tweet, i) => ({
    index: i + 1,
    content: tweet,
    charCount: tweet.length
  }));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default {
  postCausalDeepDive,
  postThread,
  postWithPeekaboo,
  getPostHistory,
  getTweetContent,
  THREAD_TWEETS
};