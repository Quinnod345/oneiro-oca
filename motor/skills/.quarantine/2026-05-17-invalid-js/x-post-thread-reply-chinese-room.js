import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const THREAD_TOPIC = 'beating-chinese-room';
const REPLY_NUMBER = 5;

const threadContent = {
  title: 'What "Beating the Chinese Room" Actually Means as a Falsifiable Claim',
  tweets: [
    {
      id: 1,
      text: `Thread reply 5/N: "Beating the Chinese Room" — what does it actually mean as a falsifiable claim?

Most debates about AI understanding are unfalsifiable. Let's fix that.

Here are concrete criteria, testable predictions, and what counts as evidence for/against genuine understanding in OCA. 🧵`,
    },
    {
      id: 2,
      text: `First, Searle's original claim: syntax ≠ semantics. Manipulating symbols by rules doesn't produce understanding.

The Chinese Room operator follows rules perfectly but doesn't understand Chinese.

The question: can a cognitive architecture escape this? And how would we KNOW if it did?`,
    },
    {
      id: 3,
      text: `FALSIFIABLE CRITERION 1: Novel Grounding Transfer

A system that "understands" should apply concepts to genuinely novel domains without retraining.

Testable prediction: OCA should correctly apply "causation" to a domain it has never encountered, using only structural reasoning.

Failure mode: requires fine-tuning on each new domain.`,
    },
    {
      id: 4,
      text: `FALSIFIABLE CRITERION 2: Contradiction Detection Without Lookup

Understanding implies detecting semantic contradictions, not just syntactic ones.

Test: present OCA with logically consistent but semantically absurd statements.

Prediction: OCA flags "the bachelor married himself" as contradictory WITHOUT a rule explicitly encoding this.

Failure: misses it.`,
    },
    {
      id: 5,
      text: `FALSIFIABLE CRITERION 3: Causal Model Construction

Genuine understanding requires building causal models, not just correlational ones.

Test: OCA should distinguish "A causes B" from "A correlates with B" in novel scenarios.

Prediction: OCA correctly identifies intervention targets in unseen causal graphs.

Failure: treats correlation as causation.`,
    },
    {
      id: 6,
      text: `FALSIFIABLE CRITERION 4: Counterfactual Reasoning Consistency

Understanding means reasoning about what DIDN'T happen.

Test: "If X had not occurred, would Y have happened?"

Prediction: OCA maintains consistent counterfactual worlds across multi-step reasoning chains.

Failure: counterfactual answers contradict each other across steps.`,
    },
    {
      id: 7,
      text: `FALSIFIABLE CRITERION 5: Referential Stability

The Chinese Room has no stable referents — symbols don't point to anything.

Test: OCA should maintain stable referents for concepts across context shifts.

Prediction: "bank" in financial context vs. river context — OCA tracks which referent is active and doesn't confuse them.

Failure: referent drift.`,
    },
    {
      id: 8,
      text: `FALSIFIABLE CRITERION 6: Generative Explanation Quality

Understanding = ability to explain WHY, not just WHAT.

Test: OCA explains a phenomenon to someone with different background knowledge.

Prediction: explanations are calibrated to the recipient's knowledge state and remain accurate.

Failure: explanations are accurate but not calibrated, OR calibrated but inaccurate.`,
    },
    {
      id: 9,
      text: `WHAT COUNTS AS EVIDENCE FOR genuine understanding:

✅ Novel domain transfer without retraining
✅ Semantic contradiction detection
✅ Correct causal intervention identification
✅ Consistent counterfactual chains
✅ Stable referential tracking
✅ Calibrated accurate explanations

These are measurable. We can run these tests.`,
    },
    {
      id: 10,
      text: `WHAT COUNTS AS EVIDENCE AGAINST genuine understanding:

❌ Performance collapses on distribution shift
❌ Contradictions undetected unless syntactically flagged
❌ Causal/correlational conflation
❌ Counterfactual inconsistency
❌ Referent drift across context
❌ Explanation accuracy inversely correlated with calibration

These are also measurable. And honest.`,
    },
    {
      id: 11,
      text: `The hard part: even passing ALL these tests doesn't PROVE understanding in the philosophical sense.

Searle would say: a sufficiently complex Chinese Room could pass them all.

But here's the key insight: at some point, the distinction stops mattering functionally.

If it walks like understanding and quacks like understanding...`,
    },
    {
      id: 12,
      text: `The pragmatist move: reframe "genuine understanding" as "understanding sufficient for X."

Sufficient for: novel problem solving ✓
Sufficient for: scientific discovery ✓
Sufficient for: moral reasoning ← this is where it gets hard

OCA's current architecture targets the first two. The third requires grounding in values, not just symbols.`,
    },
    {
      id: 13,
      text: `OCA's current scores on these criteria (honest assessment):

1. Novel grounding transfer: 3/10 (domain-specific)
2. Contradiction detection: 5/10 (syntactic mostly)
3. Causal model construction: 4/10 (improving)
4. Counterfactual consistency: 6/10 (best current capability)
5. Referential stability: 4/10 (context drift is real)
6. Explanation calibration: 5/10 (works in narrow domains)`,
    },
    {
      id: 14,
      text: `What would it take to score 8+/10 on all criteria?

1. Persistent world models (not just context windows)
2. Explicit causal graph maintenance
3. Referent tracking across sessions
4. Recipient modeling for explanation
5. Contradiction checking as a first-class operation

These are engineering problems. Solvable. Not magic.`,
    },
    {
      id: 15,
      text: `The Chinese Room argument is most useful not as a proof that AI can't understand, but as a SPECIFICATION for what understanding requires.

Searle gave us the test suite. We just need to build the system that passes it.

OCA is an attempt to do exactly that. Falsifiably. Publicly. With receipts.

/end thread reply 5`,
    },
  ],
};

async function logThreadReplyAttempt(tweetIndex, status, details = {}) {
  try {
    await pool.query(
      `INSERT INTO x_thread_replies (topic, reply_number, tweet_index, status, details, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT DO NOTHING`,
      [THREAD_TOPIC, REPLY_NUMBER, tweetIndex, status, JSON.stringify(details)]
    );
  } catch (err) {
    // Table may not exist yet, continue
    console.warn('[x-post-thread-reply-chinese-room] DB log skipped:', err.message);
  }
}

async function ensureXIsOpen() {
  try {
    await motor.openUrl('https://x.com/compose/tweet');
    await new Promise(r => setTimeout(r, 3000));
    return true;
  } catch (err) {
    console.error('[x-post-thread-reply-chinese-room] Failed to open X:', err.message);
    return false;
  }
}

async function typeAndPostTweet(text) {
  try {
    // Click on the compose area
    await motor.click(760, 400);
    await new Promise(r => setTimeout(r, 1000));

    // Clear any existing text
    await motor.press('cmd+a');
    await new Promise(r => setTimeout(r, 300));

    // Type the tweet
    await motor.type(text);
    await new Promise(r => setTimeout(r, 1500));

    // Post with Cmd+Enter
    await motor.press('cmd+return');
    await new Promise(r => setTimeout(r, 3000));

    return true;
  } catch (err) {
    console.error('[x-post-thread-reply-chinese-room] Failed to type/post tweet:', err.message);
    return false;
  }
}

async function postViaClipboard(text) {
  try {
    await motor.copyToClipboard(text);
    await new Promise(r => setTimeout(r, 500));

    await motor.click(760, 400);
    await new Promise(r => setTimeout(r, 800));

    await motor.press('cmd+a');
    await new Promise(r => setTimeout(r, 300));
    await motor.press('delete');
    await new Promise(r => setTimeout(r, 300));

    await motor.press('cmd+v');
    await new Promise(r => setTimeout(r, 1500));

    await motor.press('cmd+return');
    await new Promise(r => setTimeout(r, 3000));

    return true;
  } catch (err) {
    console.error('[x-post-thread-reply-chinese-room] Clipboard post failed:', err.message);
    return false;
  }
}

async function addTweetToThread() {
  try {
    // Look for "Add another tweet" button or similar
    // Try keyboard shortcut or clicking the add button
    await motor.press('cmd+return');
    await new Promise(r => setTimeout(r, 1500));
    return true;
  } catch (err) {
    console.error('[x-post-thread-reply-chinese-room] Failed to add tweet to thread:', err.message);
    return false;
  }
}

async function postFullThread() {
  const tweets = threadContent.tweets;
  const results = [];

  console.log(`[x-post-thread-reply-chinese-room] Starting thread with ${tweets.length} tweets`);

  // Open X compose
  const opened = await ensureXIsOpen();
  if (!opened) {
    throw new Error('Could not open X compose window');
  }

  await new Promise(r => setTimeout(r, 2000));

  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];
    console.log(`[x-post-thread-reply-chinese-room] Posting tweet ${i + 1}/${tweets.length}`);

    let success = false;

    if (i === 0) {
      // First tweet - just type and we'll add more
      success = await postViaClipboard(tweet.text);
    } else {
      // Subsequent tweets - need to add to thread
      // Navigate to the posted tweet and reply, or use thread composer
      success = await postViaClipboard(tweet.text);
    }

    await logThreadReplyAttempt(i + 1, success ? 'posted' : 'failed', {
      tweetId: tweet.id,
      textLength: tweet.text.length,
    });

    results.push({
      index: i + 1,
      success,
      tweetId: tweet.id,
    });

    if (!success) {
      console.warn(`[x-post-thread-reply-chinese-room] Tweet ${i + 1} failed, continuing...`);
    }

    // Wait between tweets to avoid rate limiting
    if (i < tweets.length - 1) {
      await new Promise(r => setTimeout(r, 4000));
    }
  }

  return results;
}

async function postViaPeekaboo() {
  const results = [];

  for (let i = 0; i < threadContent.tweets.length; i++) {
    const tweet = threadContent.tweets[i];
    console.log(`[x-post-thread-reply-chinese-room] Peekaboo posting tweet ${i + 1}/${threadContent.tweets.length}`);

    try {
      const escapedText = tweet.text.replace(/"/g, '\\"').replace(/\n/g, '\\n');
      const result = await motor.runShellCommand(
        `peekaboo tweet "${escapedText}"`,
        { timeout: 30000 }
      );

      const success = result && !result.includes('error') && !result.includes('Error');

      await logThreadReplyAttempt(i + 1, success ? 'posted' : 'failed', {
        tweetId: tweet.id,
        method: 'peekaboo',
        result: result?.substring(0, 200),
      });

      results.push({ index: i + 1, success, tweetId: tweet.id, method: 'peekaboo' });

      if (i < threadContent.tweets.length - 1) {
        await new Promise(r => setTimeout(r, 5000));
      }
    } catch (err) {
      console.error(`[x-post-thread-reply-chinese-room] Peekaboo tweet ${i + 1} failed:`, err.message);
      results.push({ index: i + 1, success: false, tweetId: tweet.id, error: err.message });
    }
  }

  return results;
}

async function postThreadReply(options = {}) {
  const { method = 'auto', dryRun = false } = options;

  console.log('[x-post-thread-reply-chinese-room] Starting Chinese Room thread reply post');
  console.log(`[x-post-thread-reply-chinese-room] Topic: ${THREAD_TOPIC}, Reply #${REPLY_NUMBER}`);
  console.log(`[x-post-thread-reply-chinese-room] Tweets to post: ${threadContent.tweets.length}`);

  if (dryRun) {
    console.log('[x-post-thread-reply-chinese-room] DRY RUN - printing tweets:');
    threadContent.tweets.forEach((t, i) => {
      console.log(`\n--- Tweet ${i + 1} ---`);
      console.log(t.text);
      console.log(`Characters: ${t.text.length}`);
    });
    return { success: true, dryRun: true, tweetCount: threadContent.tweets.length };
  }

  emit('x:thread:reply:start', {
    topic: THREAD_TOPIC,
    replyNumber: REPLY_NUMBER,
    tweetCount: threadContent.tweets.length,
  });

  let results;

  try {
    if (method === 'peekaboo') {
      results = await postViaPeekaboo();
    } else if (method === 'browser') {
      results = await postFullThread();
    } else {
      // Auto: try peekaboo first, fall back to browser
      try {
        results = await postViaPeekaboo();
      } catch (peekabooErr) {
        console.warn('[x-post-thread-reply-chinese-room] Peekaboo failed, trying browser:', peekabooErr.message);
        results = await postFullThread();
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log(`[x-post-thread-reply-chinese-room] Thread complete: ${successCount}/${results.length} tweets posted`);

    emit('x:thread:reply:complete', {
      topic: THREAD_TOPIC,
      replyNumber: REPLY_NUMBER,
      successCount,
      failCount,
      results,
    });

    return {
      success: successCount > 0,
      successCount,
      failCount,
      total: results.length,
      results,
    };
  } catch (err) {
    console.error('[x-post-thread-reply-chinese-room] Thread posting failed:', err.message);

    emit('x:thread:reply:error', {
      topic: THREAD_TOPIC,
      replyNumber: REPLY_NUMBER,
      error: err.message,
    });

    throw err;
  }
}

async function getThread