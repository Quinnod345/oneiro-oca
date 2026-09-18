// Mechanistic intervention probe. This measures wiring, NOT model quality or feelings.
// Actual queue/work code, private schema, recorded model boundary, no real inference.
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import pg from 'pg';
import affect, { snapshotState, restoreState } from '../emotion/engine.js';
import { pool as unusedProductionPool } from '../event-bus.js';
import { createPonderQueue } from '../reasoning/ponder-queue.js';
import { createPursuitWork } from '../reasoning/pursuit-work.js';

const output=process.argv[2];
if(!output) throw Error('Usage: node evaluation/pursuit-affect-probe.mjs <report.json>');
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const fixed=Date.parse('2026-09-14T12:00:00Z');
const realNow=Date.now;
const schema='oca_affect_probe_'+randomUUID().replaceAll('-','');
const admin=new pg.Pool({connectionString:process.env.OCA_TEST_DATABASE_URL||'postgres://localhost/oneiro'});
const root=await mkdtemp('/private/tmp/oca-affect-probe-');
let pool;
const results=[];
try {
 await admin.query(`CREATE SCHEMA ${schema}`);
 pool=new pg.Pool({connectionString:process.env.OCA_TEST_DATABASE_URL||'postgres://localhost/oneiro',max:2,options:`-c search_path=${schema},public`});
 await pool.query(`CREATE TABLE thought_chains(id SERIAL PRIMARY KEY,seed TEXT,priority FLOAT8,status TEXT,depth INT DEFAULT 0,
  ponder_state JSONB,created_at TIMESTAMPTZ DEFAULT now(),updated_at TIMESTAMPTZ DEFAULT now());`);
 Date.now=()=>fixed;
 const baseline=snapshotState();
 for(const arm of ['baseline','repeated_failure','repeated_success']) {
  restoreState(baseline);affect.setMotivationalState(null);
  if(arm==='repeated_failure') for(let i=0;i<8;i++) affect.processFailure(10,1);
  if(arm==='repeated_success') for(let i=0;i<8;i++) affect.processSuccess(1);
  restoreState(snapshotState()); // refresh derived policy; does not persist or emit
  const state=affect.getState(), effects=affect.getCognitiveEffects();
  let reasonInput,workInput;
  const queue=createPonderQueue({pool,clock:()=>fixed,reason:async(seed,options)=>{
   const {onCheckpoint,...rest}=options; reasonInput={seed,...rest};
   return {status:'needs_evidence',missingEvidence:['Compare the manifest to the directory.'],checkpoint:{version:1,passes:[]}};
  }});
  const work=createPursuitWork({pool,queue,clock:()=>fixed,root:join(root,'work'),sourceRoots:[root],runner:async(prompt,options)=>{
   workInput={prompt,model:options.model,sandbox:options.sandbox,timeoutMs:options.timeoutMs,
    pursuit:JSON.parse(await readFile(join(options.workingDirectory,'pursuit.json'),'utf8'))};
   return {text:JSON.stringify({summary:'Probe boundary captured; no research was performed.',nextStep:'Run independently graded tasks.',remainingQuestions:['No real model used in this wiring probe.'],sources:[]})};
  }});
  await work.init();
  await pool.query('TRUNCATE pursuit_work_events,pursuit_work,thought_chains RESTART IDENTITY');
  for(const [seed,priority] of [['Repair a missing manifest entry',.8],['Find a source for a draft claim',.5]]) {
   await queue.enqueue({seed,priority,doneWhen:'An independent check confirms the saved result.',learning:false});
  }
  const selected=await queue.runNext();
  // Operational identifiers/timestamps are not affect inputs. Normalize these only.
  await pool.query("UPDATE thought_chains SET updated_at=$1,created_at=$1,ponder_state=ponder_state-'lease'-'leaseUntil'",[new Date(fixed)]);
  await work.enqueue(selected.chain_id,{requestId:randomUUID()});
  await pool.query('UPDATE thought_chains SET updated_at=$1',[new Date(fixed)]);
  await work.runNext();
  assert.ok(reasonInput && workInput,'Both real execution paths must reach their model boundary');
  // Remove run-specific path from a prompt; it is constant within this probe anyway.
  const canonicalWork={...workInput,prompt:workInput.prompt.replaceAll(root,'<private-fixture>')};
  results.push({arm,state,effects,selectedChain:selected.chain_id,reasonInput,workInput:canonicalWork,
   reasonInputHash:hash(reasonInput),workInputHash:hash(canonicalWork)});
 }
 assert.ok(new Set(results.map(x=>hash(x.effects))).size===3,'Interventions must actually alter affect policies');
 const sources={};
 for(const name of ['../emotion/engine.js','../reasoning/ponder-queue.js','../reasoning/pursuit-work.js']) {
  sources[name]=hash(await readFile(fileURLToPath(new URL(name,import.meta.url)),'utf8'));
 }
 const report={version:1,kind:'mechanistic_causal_wiring_probe',generatedAt:new Date(realNow()).toISOString(),sources,
  isolation:{privateSchema:true,productionWrites:false,modelCalls:0},
  controls:['same two pursuits','same evidence and context','same clock','same model/tool/budget configuration','fresh private queue per arm'],
  normalization:['database timestamps held fixed','operational lease UUID removed from all pursuit files','private temporary root replaced in saved prompt'],
  findings:{affectPoliciesChanged:true,selectionChanged:new Set(results.map(x=>x.selectedChain)).size>1,
   reasonInputsChanged:new Set(results.map(x=>x.reasonInputHash)).size>1,workerInputsChanged:new Set(results.map(x=>x.workInputHash)).size>1},
  limits:['No inference or task-quality comparison was run.','Does not establish consciousness or absence of affect influence elsewhere in OCA.','Affect added to prompts alone would not establish usefulness.'],results};
 await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:output,...report.findings}));
} finally {
 Date.now=realNow;
 if(pool) await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();await unusedProductionPool.end();
 await rm(root,{recursive:true,force:true});
}
