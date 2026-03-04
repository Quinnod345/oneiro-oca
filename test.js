#!/usr/bin/env node
// OCA Integration Test
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });

import oca from './index.js';

async function test() {
  console.log('=== OCA Integration Test ===\n');
  
  // 1. Init
  console.log('1. Initializing...');
  await oca.init();
  console.log('   ✅ Init complete\n');
  
  // 2. Experience something
  console.log('2. Storing episodic memory...');
  const ep = await oca.experience('test', 'Quinn asked me to build the cognitive architecture. I am building it right now.', {
    activeApp: 'Terminal',
    userPresence: 'present',
    userActivity: 'collaborating',
    importanceScore: 0.9
  });
  console.log(`   ✅ Episode ${ep.id} stored\n`);
  
  // 3. Learn something
  console.log('3. Storing semantic memory...');
  const sem = await oca.learn('Quinn wants AI to genuinely think, not just pattern match', 'quinn_values', 0.9);
  console.log(`   ✅ Semantic: ${sem.action} (id ${sem.id})\n`);
  
  // 4. Form a hypothesis
  console.log('4. Forming hypothesis...');
  const hyp = await oca.predict(
    'self',
    'The cognitive architecture will produce measurably different thinking patterns than the current mind.js',
    'Within 1 week, the hypothesis engine will have tracked >10 predictions with a calibration curve',
    { confidence: 0.7 }
  );
  console.log(`   ✅ Hypothesis: ${hyp.action} (id ${hyp.id})\n`);
  
  // 5. Remember
  console.log('5. Recalling episodic memory...');
  const memories = await oca.remember('cognitive architecture');
  console.log(`   ✅ Recalled ${memories.length} memories\n`);
  
  // 6. Know
  console.log('6. Querying semantic memory...');
  const knowledge = await oca.know('what does Quinn want');
  console.log(`   ✅ Found ${knowledge.length} concepts\n`);
  
  // 7. Emotion cycle
  console.log('7. Running emotion cycle...');
  oca.layers.emotion.processInteraction(0.8); // positive interaction
  oca.layers.emotion.processSurprise(0.5, 'self'); // building something new is surprising
  const emotionResult = await oca.layers.emotion.update();
  console.log(`   ✅ Emotion: valence=${emotionResult.state.valence.toFixed(3)}, arousal=${emotionResult.state.arousal.toFixed(3)}`);
  console.log(`   curiosity=${emotionResult.state.curiosity.toFixed(3)}, excitement=${emotionResult.state.excitement.toFixed(3)}\n`);
  
  // 8. Deliberation
  console.log('8. Running deliberation...');
  const decision = await oca.decide(
    'Should I integrate the cognitive architecture into mind.js now, or build it as a separate process?',
    { stakes: 'high', context: 'Mind.js is running and stable. Modifying it risks breaking existing functionality.' }
  );
  console.log(`   ✅ Resolution (${decision.resolutionMethod}): ${decision.resolution.slice(0, 200)}`);
  console.log(`   Skeptic: ${decision.perspectives.skeptic.argument.slice(0, 100)}...`);
  console.log(`   Builder: ${decision.perspectives.builder.argument.slice(0, 100)}...`);
  console.log(`   Dreamer: ${decision.perspectives.dreamer.argument.slice(0, 100)}...`);
  console.log(`   Empath: ${decision.perspectives.empath.argument.slice(0, 100)}...\n`);
  
  // 9. Metacognition
  console.log('9. Running metacognition...');
  const meta = await oca.reflect();
  console.log(`   ✅ Healthy: ${meta.healthy}`);
  console.log(`   Stuck issues: ${meta.stuck_issues.length}`);
  console.log(`   Active biases: ${meta.active_biases.length}\n`);
  
  // 10. Full status
  console.log('10. Full status...');
  const s = await oca.status();
  console.log(`   Episodic memories: ${s.memory.episodic.total}`);
  console.log(`   Semantic memories: ${s.memory.semantic.total}`);
  console.log(`   Pending hypotheses: ${s.hypotheses.pending}`);
  console.log(`   Emotion valence: ${s.emotion.valence.toFixed(3)}`);
  console.log(`   Cognitive effects:`, JSON.stringify(s.effects, (k,v) => typeof v === 'number' ? +v.toFixed(3) : v));
  
  console.log('\n=== All tests passed ===');
  process.exit(0);
}

test().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
