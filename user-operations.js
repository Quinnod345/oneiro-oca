import { randomUUID } from 'node:crypto';
import { capabilities, validateInput } from './user-capabilities.js';
export function createUserOperations(oca, benchmarkHarness) {
 const operations={
  decide: p=>oca.decide(p.decision,{context:p.context||'',stakes:p.stakes}),
  imagine: p=>oca.imagine(p.description,{context:p.context||''},(p.actionsText||'').split('\n').filter(Boolean),{purpose:'decision'}),
  create: p=>oca.create(p.method), reflect: ()=>oca.reflect(),
  predict: p=>oca.predict(p.domain,p.claim,p.prediction,{confidence:p.confidence}),
  test: p=>oca.layers.hypothesis.test(p.hypothesisId,p.actualOutcome),
  experiment: p=>oca.layers.causal.designExperiment(p),
  experimentStarted: async p=>{const result=await oca.layers.causal.startExperiment(p.experimentId);if(!result)throw new Error('Experiment not found or already started/closed. Refresh its saved record.');return result;},
  experimentOutcome: async p=>{const result=await oca.layers.causal.completeExperiment(p.experimentId,{actualOutcome:p.actualOutcome,metadata:{outcomeEvidence:[{id:randomUUID(),source:p.source,observation:p.observation}],origin:'user_workspace'}});if(!result)throw new Error('Record when you actually began this experiment before completing it. Closed or unknown experiments cannot accept results.');return result;},
  simulationOutcome: async p=>{const result=await oca.layers.simulation.evaluateSimulation(p.simulationId,p.actualOutcome);if(!result)throw new Error('Scenario not found. Choose a saved scenario.');return result;},
  experience: p=>oca.experience('user_observation',p.content,{metadata:{source:p.source,subject:'user_report',origin:'user_workspace'}}),
  learn: p=>oca.learn(p.concept,{...p,sourceType:'user_report',metadata:{origin:'user_workspace'}}),
  contradict: p=>oca.layers.semantic.contradict(p.conceptId,p.reason,{}),
  intend: p=>oca.layers.prospective.intend(p.intention,'time',{at:new Date(p.at).toISOString()},{priority:p.priority}),
  completeIntention: p=>oca.layers.prospective.complete(p.id),
  consolidate: ()=>oca.layers.consolidation.consolidate(),
  benchmark: p=>benchmarkHarness.runBenchmark({runSource:'user_workspace',notes:p.notes||null}),
  antiDecay: async ()=>{const {default:a}=await import('./evaluation/anti-decay.js');return a.runAntiDecayEvaluation();}
 };
 return Object.fromEntries(capabilities.map(c=>[c.id,p=>operations[c.id](validateInput(c.id,p))]));
}
