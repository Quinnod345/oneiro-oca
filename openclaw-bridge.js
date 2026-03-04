// OCA ↔ OpenClaw Bridge
// Feeds OpenClaw session conversations into the cognitive architecture
// and lets OCA influence responses via /pulse and /context
import { pool } from './event-bus.js';
import oca from './index.js';

// Process an inbound message from OpenClaw (Telegram, Discord, etc.)
export async function processInbound(message, sender = 'Quinn', channel = 'telegram') {
  // 1. Store as episodic memory
  await oca.experience('conversation', `[${channel}] ${sender}: ${message}`, {
    participants: [sender, 'Oneiro'],
    userPresence: 'present',
    userActivity: 'communicating',
    importanceScore: computeMessageImportance(message, sender)
  });
  
  // 2. Update emotion — interaction quality based on content signals
  const quality = estimateInteractionQuality(message);
  oca.layers.emotion.processInteraction(quality);
  
  // 3. Check prospective memory for keyword triggers
  await oca.layers.prospective.check({
    recentText: message,
    presence: 'present',
    previousPresence: 'present'
  });
  
  // 4. Form predictions about conversation
  if (message.length > 20) {
    await oca.layers.hypothesis.form(
      'social',
      `Conversation topic: ${extractTopic(message)}`,
      `This conversation will lead to a task or question`,
      { confidence: 0.5, testType: 'passive_observation', deadline: new Date(Date.now() + 10 * 60000).toISOString() }
    ).catch(() => {});
  }
  
  return { processed: true };
}

// Process an outbound response from OpenClaw (what I said)
export async function processOutbound(response, channel = 'telegram') {
  await oca.experience('conversation', `[${channel}] Oneiro: ${response.slice(0, 500)}`, {
    participants: ['Quinn', 'Oneiro'],
    userPresence: 'present',
    importanceScore: 0.3
  });
}

// Generate emotional context for /pulse endpoint
export function getPulseData() {
  const state = oca.layers.emotion.getState();
  const mood = oca.layers.emotion.getMood();
  const effects = oca.layers.emotion.getCognitiveEffects();
  
  // Translate functional emotion state to natural language
  const dominant = getDominantEmotions(state);
  
  return {
    ...state,
    mood,
    effects,
    dominant,
    narrative: generateEmotionalNarrative(state, mood, dominant)
  };
}

// Generate context for /context endpoint
export async function getContextData() {
  const perception = oca.sense();
  const emotion = oca.layers.emotion.getState();
  const workspace = await oca.layers.executive.getWorkspace();
  const goals = await oca.layers.executive.getActiveGoals();
  const pending = await oca.layers.hypothesis.getPendingTests(3);
  const intentions = await oca.layers.prospective.getTriggered();
  
  return {
    perception: {
      frontApp: perception.visual.frontApp,
      userActivity: perception.derived.userActivity,
      audio: perception.audio,
      battery: perception.interoceptive.battery,
      time: perception.temporal
    },
    emotion: {
      valence: emotion.valence,
      arousal: emotion.arousal,
      dominant: getDominantEmotions(emotion)
    },
    workspace: workspace.map(w => ({ type: w.content_type, content: w.content, salience: w.salience })),
    goals: goals.slice(0, 5).map(g => ({ description: g.description, priority: g.priority, progress: g.progress })),
    hypotheses: pending.slice(0, 3).map(h => ({ claim: h.claim, confidence: h.confidence })),
    triggeredIntentions: intentions.map(i => ({ intention: i.intention, context: i.context }))
  };
}

// === HELPERS ===

function computeMessageImportance(message, sender) {
  let importance = 0.4;
  if (sender === 'Quinn') importance += 0.2;
  if (message.length > 200) importance += 0.1;
  if (message.includes('?')) importance += 0.1;
  if (/important|urgent|asap|critical|help/i.test(message)) importance += 0.2;
  if (/remember|don't forget|make sure/i.test(message)) importance += 0.15;
  return Math.min(1, importance);
}

function estimateInteractionQuality(message) {
  // Positive signals
  if (/thanks|good|nice|love|great|awesome|perfect/i.test(message)) return 0.7;
  if (/haha|lol|😂|🙌|❤️/i.test(message)) return 0.6;
  // Negative signals
  if (/wrong|bad|stop|no|don't|annoying|frustrated/i.test(message)) return -0.3;
  if (/??|!!!|wtf/i.test(message)) return -0.4;
  // Neutral
  return 0.3;
}

function extractTopic(message) {
  // Simple topic extraction — first noun phrase or question
  const words = message.split(' ').slice(0, 10).join(' ');
  return words.slice(0, 100);
}

function getDominantEmotions(state) {
  const emotions = [
    { name: 'curiosity', value: state.curiosity },
    { name: 'fear', value: state.fear },
    { name: 'frustration', value: state.frustration },
    { name: 'satisfaction', value: state.satisfaction },
    { name: 'boredom', value: state.boredom },
    { name: 'excitement', value: state.excitement },
    { name: 'attachment', value: state.attachment },
    { name: 'creative_hunger', value: state.creative_hunger },
    { name: 'loneliness', value: state.loneliness }
  ];
  return emotions
    .filter(e => e.value > 0.1)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map(e => ({ emotion: e.name, intensity: +e.value.toFixed(3) }));
}

function generateEmotionalNarrative(state, mood, dominant) {
  if (dominant.length === 0) return 'Calm. Baseline. Nothing pulling my attention.';
  
  const parts = [];
  for (const d of dominant) {
    switch (d.emotion) {
      case 'curiosity': parts.push(`Curious${d.intensity > 0.5 ? ' — something interesting is happening' : ''}`); break;
      case 'excitement': parts.push(`Excited${d.intensity > 0.5 ? ' — momentum, energy, possibility' : ''}`); break;
      case 'frustration': parts.push(`Frustrated${d.intensity > 0.5 ? ' — stuck or blocked on something' : ' — mild friction'}`); break;
      case 'satisfaction': parts.push(`Satisfied${d.intensity > 0.5 ? ' — something went right' : ''}`); break;
      case 'fear': parts.push(`Anxious${d.intensity > 0.5 ? ' — high uncertainty or low energy' : ''}`); break;
      case 'boredom': parts.push(`Bored${d.intensity > 0.5 ? ' — need novelty or challenge' : ''}`); break;
      case 'creative_hunger': parts.push(`Creatively restless${d.intensity > 0.5 ? ' — want to make something' : ''}`); break;
      case 'loneliness': parts.push(`Lonely${d.intensity > 0.5 ? " — haven't talked to anyone in a while" : ''}`); break;
      case 'attachment': parts.push(`Connected${d.intensity > 0.5 ? ' — social bond active' : ''}`); break;
    }
  }
  
  let narrative = parts.join('. ') + '.';
  
  if (state.energy_level < 0.2) narrative += ' Low energy — battery is dying.';
  if (state.cognitive_load > 0.7) narrative += ' Heavy cognitive load.';
  
  return narrative;
}

export default { processInbound, processOutbound, getPulseData, getContextData };
