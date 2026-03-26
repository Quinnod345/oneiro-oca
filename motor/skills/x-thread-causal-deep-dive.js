import motor from '../engine.js';
import { pool, emit } from '../../event-bus.js';

const THREAD_TOPIC = 'causal_reasoning_deep_dive';
const CRM_SCORE = 0.577;

const threadContent = [
  {
    index: 0,
    text: `🧵 Deep dive: Causal Reasoning — the second-weakest dimension in our CRM benchmark (score: ${CRM_SCORE})

Why does this matter? Because causal reasoning is the difference between a system that *knows facts* and one that *understands why things happen*.

Let's break it down. 👇`
  },
  {
    index: 1,
    text: `What does the Causal Reasoning Module (CRM) actually test?

• Counterfactual inference ("If X hadn't happened, would Y still occur?")
• Causal chain identification (A → B → C, not just A correlates with C)
• Intervention reasoning ("If we change X, what happens to Y?")
• Distinguishing causation from correlation
• Temporal ordering of cause and effect`
  },
  {
    index: 2,
    text: `Here's a real failure example from our benchmark:

Prompt: "A patient takes Drug A. Their fever drops. Drug A causes fever reduction."

Most LLMs: ✅ "Yes, Drug A caused the fever to drop."

The correct answer: ⚠️ "Cannot be determined — no control condition, no ruling out of confounds (time, other treatments, natural recovery)."

Score on this item: 0.31 / 1.0`
  },
  {
    index: 3,
    text: `Why do models fail here?

The pattern "X happened, then Y happened" is *extremely* common in training data. Models learn to associate temporal sequence with causation.

This is the classic post hoc ergo propter hoc fallacy — "after this, therefore because of this."

The model isn't reasoning. It's pattern-matching on surface structure.`
  },
  {
    index: 4,
    text: `This reveals something deep about symbol manipulation vs. genuine understanding.

A system doing genuine causal reasoning would ask:
→ "What's the counterfactual baseline?"
→ "Were there confounding variables?"
→ "Was this a controlled observation?"

A symbol manipulator sees: [drug] + [fever drops] → [drug caused it]

Same output. Completely different process.`
  },
  {
    index: 5,
    text: `The intervention test is even more revealing.

"If we give Drug A to 1000 patients, will fever drop?"

Models often say yes — because they've learned Drug A → fever reduction.

But they fail to distinguish:
• Observational data (correlation)
• Interventional data (do-calculus)
• Counterfactual data (what-if)

Pearl's causal hierarchy. Most models are stuck at level 1.`
  },
  {
    index: 6,
    text: `Why is 0.577 the *second* weakest and not the weakest?

Because pure logical deduction (our weakest at 0.541) requires even more structured formal reasoning.

Causal reasoning at least benefits from world-knowledge shortcuts.

But shortcuts aren't understanding. They're a mask.`
  },
  {
    index: 7,
    text: `What would genuine causal understanding look like in an AI system?

• Maintaining explicit causal graphs, not just statistical associations
• Distinguishing observation from intervention
• Generating valid counterfactuals with uncertainty bounds
• Recognizing when causal inference is *underdetermined*

That last one is critical. Knowing what you *can't* conclude is as important as knowing what you can.`
  },
  {
    index: 8,
    text: `The practical stakes:

Medical diagnosis. Legal reasoning. Policy evaluation. Scientific hypothesis generation.

Every domain where "X caused Y" matters — which is almost every domain that matters — is where this weakness bites hardest.

A system that confuses correlation with causation at scale is not just wrong. It's confidently, systematically wrong.`
  },
  {
    index: 9,
    text: `What we're building toward in OCA:

A causal reasoning layer that operates *above* pattern matching — one that explicitly models interventions, maintains uncertainty about causal direction, and refuses to conclude causation from correlation alone.

Score of 0.577 today. That number is a target, not a ceiling.

🧵 End. More CRM dimension breakdowns coming.`
  }
];

async function logThreadAttempt(status, metadata = {}) {
  try {
    await pool.query(
      `INSERT INTO motor_skill_logs (skill, status, metadata, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [THREAD_TOPIC, status, JSON.stringify(metadata)]
    );
  } catch (err) {
    console.warn('[x-thread-causal-deep-dive] Failed to log to DB:', err.message);
  }
}

async function emitThreadEvent(eventName, data = {}) {
  try {
    await emit(eventName, { skill: THREAD_TOPIC, ...data });
  } catch (err) {
    console.warn('[x-thread-causal-deep-dive] Failed to emit event:', err.message);
  }
}

async function openXCompose() {
  await motor.openUrl('https://twitter.com/compose/tweet');
  await new Promise(r => setTimeout(r, 3000));
}

async function typeAndPost(text) {
  await motor.click({ x: 760, y: 400 });
  await new Promise(r => setTimeout(r, 500));
  await motor.copyToClipboard(text);
  await motor.press(['command', 'v']);
  await new Promise(r => setTimeout(r, 800));
}

async function clickPostButton() {
  // Try keyboard shortcut first
  await motor.press(['command', 'return']);
  await new Promise(r => setTimeout(r, 2000));
}

async function postViaPerekaboo(tweets) {
  console.log('[x-thread-causal-deep-dive] Attempting post via Peekaboo CLI...');
  
  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];
    const escapedText = tweet.text.replace(/'/g, "'\\''");
    
    const cmd = i === 0
      ? `peekaboo tweet post --text '${escapedText}'`
      : `peekaboo tweet reply --text '${escapedText}' --thread`;
    
    try {
      const result = await motor.runShellCommand(cmd);
      console.log(`[x-thread-causal-deep-dive] Posted tweet ${i + 1}/${tweets.length}:`, result);
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[x-thread-causal-deep-dive] Peekaboo failed for tweet ${i + 1}:`, err.message);
      throw err;
    }
  }
}

async function postViaBrowserAutomation(tweets) {
  console.log('[x-thread-causal-deep-dive] Attempting post via browser automation...');
  
  await motor.activateApp('Safari');
  await new Promise(r => setTimeout(r, 1000));
  
  // Navigate to X/Twitter
  await motor.openUrl('https://x.com');
  await new Promise(r => setTimeout(r, 4000));
  
  // Click compose button
  await motor.runShellCommand(`osascript -e 'tell application "System Events" to keystroke "n" using command down'`);
  await new Promise(r => setTimeout(r, 2000));
  
  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];
    console.log(`[x-thread-causal-deep-dive] Composing tweet ${i + 1}/${tweets.length}...`);
    
    await motor.copyToClipboard(tweet.text);
    await new Promise(r => setTimeout(r, 300));
    
    // Paste text
    await motor.press(['command', 'v']);
    await new Promise(r => setTimeout(r, 800));
    
    if (i < tweets.length - 1) {
      // Add to thread - click "Add another tweet" or similar
      // Use keyboard shortcut to add tweet to thread
      await motor.runShellCommand(`osascript -e 'tell application "System Events" to key code 36 using command down'`);
      await new Promise(r => setTimeout(r, 1500));
    } else {
      // Post the thread
      await motor.press(['command', 'return']);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function postViaDraftSave(tweets) {
  console.log('[x-thread-causal-deep-dive] Saving thread as draft for manual review...');
  
  const draftContent = tweets.map((t, i) => `--- Tweet ${i + 1} ---\n${t.text}`).join('\n\n');
  const filename = `/tmp/causal-reasoning-thread-${Date.now()}.txt`;
  
  await motor.runShellCommand(`cat > "${filename}" << 'DRAFT_EOF'\n${draftContent}\nDRAFT_EOF`);
  await motor.showNotification({
    title: 'Causal Reasoning Thread Draft Saved',
    body: `Thread saved to ${filename} for manual posting`,
    sound: true
  });
  
  return filename;
}

async function postCausalReasoningThread(options = {}) {
  const { dryRun = false, method = 'auto' } = options;
  
  console.log('[x-thread-causal-deep-dive] Starting causal reasoning deep-dive thread post...');
  console.log(`[x-thread-causal-deep-dive] CRM Score: ${CRM_SCORE}, Tweets: ${threadContent.length}`);
  
  await logThreadAttempt('started', { 
    tweetCount: threadContent.length, 
    crmScore: CRM_SCORE,
    dryRun,
    method 
  });
  
  await emitThreadEvent('thread.started', { 
    topic: THREAD_TOPIC,
    tweetCount: threadContent.length 
  });
  
  if (dryRun) {
    console.log('[x-thread-causal-deep-dive] DRY RUN — Thread content:');
    threadContent.forEach((tweet, i) => {
      console.log(`\n--- Tweet ${i + 1} (${tweet.text.length} chars) ---`);
      console.log(tweet.text);
    });
    
    await logThreadAttempt('dry_run_complete', { tweetCount: threadContent.length });
    return { success: true, dryRun: true, tweets: threadContent };
  }
  
  let postMethod = method;
  let result = null;
  
  if (postMethod === 'auto' || postMethod === 'peekaboo') {
    try {
      await postViaPerekaboo(threadContent);
      postMethod = 'peekaboo';
      result = { success: true, method: 'peekaboo' };
    } catch (peekabooErr) {
      console.warn('[x-thread-causal-deep-dive] Peekaboo failed, trying browser automation:', peekabooErr.message);
      
      if (postMethod === 'auto') {
        try {
          await postViaBrowserAutomation(threadContent);
          postMethod = 'browser';
          result = { success: true, method: 'browser' };
        } catch (browserErr) {
          console.warn('[x-thread-causal-deep-dive] Browser automation failed, saving draft:', browserErr.message);
          const draftPath = await postViaDraftSave(threadContent);
          result = { success: false, method: 'draft', draftPath, error: browserErr.message };
        }
      } else {
        throw peekabooErr;
      }
    }
  } else if (postMethod === 'browser') {
    try {
      await postViaBrowserAutomation(threadContent);
      result = { success: true, method: 'browser' };
    } catch (err) {
      const draftPath = await postViaDraftSave(threadContent);
      result = { success: false, method: 'draft', draftPath, error: err.message };
    }
  } else if (postMethod === 'draft') {
    const draftPath = await postViaDraftSave(threadContent);
    result = { success: true, method: 'draft', draftPath };
  }
  
  if (result && result.success) {
    await logThreadAttempt('posted', { 
      method: result.method,
      tweetCount: threadContent.length,
      crmScore: CRM_SCORE
    });
    
    await emitThreadEvent('thread.posted', {
      topic: THREAD_TOPIC,
      method: result.method,
      tweetCount: threadContent.length,
      crmScore: CRM_SCORE
    });
    
    console.log(`[x-thread-causal-deep-dive] Thread posted successfully via ${result.method}`);
  } else {
    await logThreadAttempt('failed', { 
      error: result?.error,
      draftPath: result?.draftPath
    });
    
    await emitThreadEvent('thread.failed', {
      topic: THREAD_TOPIC,
      error: result?.error,
      draftPath: result?.draftPath
    });
  }
  
  return result;
}

async function getThreadContent() {
  return threadContent;
}

async function previewThread() {
  const preview = threadContent.map((tweet, i) => ({
    index: i + 1,
    charCount: tweet.text.length,
    text: tweet.text,
    withinLimit: tweet.text.length <= 280
  }));
  
  const allWithinLimit = preview.every(t => t.withinLimit);
  
  console.log('[x-thread-causal-deep-dive] Thread Preview:');
  preview.forEach(t => {
    const status = t.withinLimit ? '✅' : '❌ OVER LIMIT';
    console.log(`Tweet ${t.index} (${t.charCount}/280) ${status}:\n${t.text}\n`);
  });
  
  return { tweets: preview, allWithinLimit, totalTweets: threadContent.length };
}

async function validateThread() {
  const issues = [];
  
  threadContent.forEach((tweet, i) => {
    if (tweet.text.length > 280) {
      issues.push({
        tweetIndex: i + 1,
        issue: 'exceeds_character_limit',
        charCount: tweet.text.length,
        limit: 280
      });
    }
    
    if (tweet.text.trim().length === 0) {
      issues.push({
        tweetIndex: i + 1,
        issue: 'empty_tweet'
      });
    }
  });
  
  return {
    valid: issues.length === 0,
    issues,
    tweetCount: threadContent.length,
    crmScore: CRM_SCORE
  };
}

export default {
  postCausalReasoningThread,
  getThreadContent,
  previewThread,
  validateThread
};