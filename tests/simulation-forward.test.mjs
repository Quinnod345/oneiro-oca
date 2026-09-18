import test from 'node:test';
import assert from 'node:assert/strict';
import { createForwardSimulator, parseSimulation, simulationQuality, simulationGrounding } from '../simulation/forward.js';
const scenario={predicted_states:[{step:1,state:'Keeping the item out of the manifest leaves it undiscoverable.',confidence:0.6}],branch_points:[{step:1,description:'Include or omit the image',alternatives:['Include it and validate the path.','Omit it and keep the inventory incomplete.']}],risks:['A filename might not refer to an existing file.'],expected_outcome:'An accurate manifest needs a matching file for every entry.'};
test('inference failure, malformed output and prompt echo never manufacture a prediction or write a simulation',async()=>{
 let saves=0;
 for(const generate of [async()=>{throw Error('offline');},async()=>({content:[{text:'unparseable response'}]}),async()=>({content:[{text:JSON.stringify({...scenario,expected_outcome:'Prompt'})}]})]) {
  const simulate=createForwardSimulator({generate,save:async()=>{saves++;return 2;}});
  const r=await simulate('Prompt',{},[]);
  assert.equal(r.quality,'analysis_unavailable');assert.deepEqual(r.predicted_states,[]);assert.equal(r.id,undefined);
 }
 assert.equal(saves,0);
 assert.equal(parseSimulation(JSON.stringify({...scenario,predicted_states:[{step:1,state:'State',confidence:4}]}),'P').quality,'analysis_unavailable');
});
test('valid structured prediction is stored with bounded prioritized inference and no outcome credit',async()=>{
 let stored;
 const simulate=createForwardSimulator({generate:async(p,o)=>{assert.ok(o.signal);assert.equal(o.priority,10);assert.ok(o.responseSchema);return {content:[{text:JSON.stringify(scenario)}]};},save:async input=>{stored=input;return 41;}});
 const r=await simulate('Manifest trade-off',{file:'sprite.png'},[],{purpose:'test'});
 assert.equal(r.id,41);assert.equal(r.quality,'generated_prediction');assert.equal(stored.purpose,'test');assert.deepEqual(stored.result.branch_points,scenario.branch_points);assert.equal(r.success,undefined);assert.equal(r.accuracy,undefined);
 const failed=createForwardSimulator({generate:async()=>({content:[{text:JSON.stringify(scenario)}]}),save:async()=>{throw Error('db offline');}});
 assert.equal((await failed('P',{},[])).quality,'analysis_unavailable');
});
test('unprovided narrative numbers are flagged without treating matching inputs as verification or altering the prediction',()=>{
 const r = {...scenario, expected_outcome:'Scan 200 images; perhaps 15 missing and 3 duplicates.', predicted_states:[{step:1,state:'Allow 2.5 hours; 80% may be ready.',confidence:0.9}]};
 const before = JSON.stringify(r);
 const result=simulationGrounding(r,{context:'Assume 200 images, nothing checked'});
 assert.deepEqual(result.unsupportedQuantities,['15','3','2.5','80%']);
 assert.equal(result.status,'not_independently_verified');assert.equal(JSON.stringify(r),before);
 assert.deepEqual(simulationGrounding(scenario,{}).unsupportedQuantities,[]);
 assert.equal(simulationGrounding(scenario,{}).status,'not_independently_verified');
 assert.deepEqual(simulationGrounding({...scenario,expected_outcome:'2,000 files'}, {context:'Assume 2000 files'}).unsupportedQuantities,[]);
 assert.deepEqual(simulationGrounding(null).unsupportedQuantities,[]);
});
test('historical heuristic and parse-failure receipts are unavailable rather than useful analysis',()=>{
 for(const r of [null, {}, {quality:'verified',expected_outcome:'No states'}, {expected_outcome:'Heuristic simulation fallback: park question'}, {risks:['simulation_output_parse_failure'],expected_outcome:'partial words'},{quality:'analysis_unavailable'}]) assert.equal(simulationQuality(r),'analysis_unavailable');
 assert.equal(simulationQuality(scenario),'generated_prediction');
});
