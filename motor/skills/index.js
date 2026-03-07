// OCA Motor Skills — application-specific motor abilities
export { default as browser } from './browser.js';
export { default as terminal } from './terminal.js';
export { default as xcode } from './xcode.js';
export { default as logicPro } from './logic-pro.js';
export { default as xPoster } from './x-poster.js';
export { default as peekaboo } from './peekaboo.js';
export { default as gapDetector } from './gap-detector.js';
export { default as selfBuildOrchestrator } from './self-build-orchestrator.js';
export { default as selfBuilder } from './self-builder.js';
export { default as selfBuilderPrompt } from './self-builder-prompt.js';
export { default as deploySkill } from './deploy-skill.js';
export { default as selfBuildVerifier } from './self-build-verifier.js';
export { default as autoBuilder } from './auto-builder.js';
export { default as autonomousBuilder } from './autonomous-builder.js';
export { default as capabilityGapTracker } from './capability-gap-tracker.js';
export { default as selfBuildLoopMonitor } from './self-build-loop-monitor.js';
export { default as runtimeGapResponder } from './runtime-gap-responder.js';
export { default as capabilityIntrospector } from './capability-introspector.js';
export { default as capabilityBootstrap } from './capability-bootstrap.js';
export { default as selfAuditor } from './self-auditor.js';
export { default as gapScanner } from './gap-scanner.js';
import buildLoopOrchestrator from './build-loop-orchestrator.js';

const skillsRegistry = {
  'gap-scanner': gapScanner,
  'build-loop-orchestrator': buildLoopOrchestrator,
};

export async function registerSkill(name, modulePath) {
  const module = await import(modulePath);
  skillsRegistry[name] = module.default ?? module;
  return skillsRegistry[name];
}

export function getSkill(name) {
  return skillsRegistry[name];
}

export function listRegisteredSkills() {
  return Object.keys(skillsRegistry);
}