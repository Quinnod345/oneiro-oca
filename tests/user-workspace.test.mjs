import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import express from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createUserControls, createControlledPonderRunner } from '../user-controls.js';
import { createUserWorkspace } from '../user-workspace.js';
import { createPonderRouter } from '../reasoning/ponder-router.js';
import { createPonderQueue } from '../reasoning/ponder-queue.js';

async function isolated(fn) {
 const schema=`oca_ui_test_${randomBytes(6).toString('hex')}`;
 const admin=new pg.Pool({connectionString:process.env.OCA_TEST_DATABASE_URL||'postgres://localhost/oneiro'});let pool;
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool=new pg.Pool({connectionString:process.env.OCA_TEST_DATABASE_URL||'postgres://localhost/oneiro',options:`-c search_path=${schema}`});
  await pool.query(await readFile(new URL('../migrations/054_user_workspace.sql',import.meta.url),'utf8'));
  await pool.query(`CREATE TABLE thought_chains(id SERIAL PRIMARY KEY, seed TEXT, priority FLOAT8, status TEXT, depth INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), ponder_state JSONB)`);
  await pool.query(await readFile(new URL('../migrations/055_workspace_idempotency.sql',import.meta.url),'utf8'));
  await fn(pool);
 }finally{await pool?.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}

test('persisted queue pause actually prevents work, survives replacement, and drains an active call without overlapping it',()=>isolated(async pool=>{
 const controls=createUserControls(pool);let calls=0,syncs=0,release,entered;
 const arrived=new Promise(r=>entered=r);
 const run=createControlledPonderRunner({controls,syncInterests:async()=>syncs++,refreshHunger:async()=>{},runNext:async()=>{calls++;entered();await new Promise(r=>release=r);return {done:true};}});
 await controls.update({queuePaused:true});
 assert.equal((await createUserControls(pool).get()).queuePaused,true);
 assert.deepEqual(await run(),{paused:true});assert.equal(calls,0);assert.equal(syncs,0);
 await Promise.all([controls.update({queuePaused:false}),controls.update({interestDiscovery:false})]);
 const current=await controls.get();assert.equal(current.queuePaused,false);assert.equal(current.interestDiscovery,false);
 const inFlight=run();await arrived;
 await controls.update({queuePaused:true});
 assert.deepEqual(await run(),{busy:true});release();assert.deepEqual(await inFlight,{done:true});
 assert.deepEqual(await run(),{paused:true});assert.equal(calls,1);assert.equal(syncs,0);
 await assert.rejects(controls.update({queuePaused:'false'}));
 await assert.rejects(controls.update({autonomousActions:true}));
 // which brain the engine thinks with is a control: one of three modes, nothing else
 assert.equal((await controls.update({inference:'cloud'})).inference,'cloud');
 assert.equal((await controls.update({inference:'local'})).inference,'local');
 await assert.rejects(controls.update({inference:'codex'}),/inference must be one of local, auto, cloud/);
 await assert.rejects(controls.update({inference:true}));
}));

test('pause during interest synchronization is rechecked before a new pursuit starts',()=>isolated(async pool=>{
 const controls=createUserControls(pool);let calls=0;
 const run=createControlledPonderRunner({controls,syncInterests:()=>controls.update({queuePaused:true}),refreshHunger:async()=>{},runNext:async()=>calls++});
 assert.deepEqual(await run(),{paused:true});assert.equal(calls,0);
}));

test('native workspace API persists operation results, returns errors, preserves history, and rejects fake controls',()=>isolated(async pool=>{
 const queue=createPonderQueue({pool,reason:async()=>({status:'needs_evidence'})});
 const p=await queue.enqueue({seed:'Review the actual test result',learning:false});
 const closed=await queue.enqueue({seed:'Keep cancelled history',learning:false});await queue.cancel(closed.chain_id);
 let release,started;const entered=new Promise(r=>started=r);
 const operations={imagine:async()=>{started();await new Promise(r=>release=r);return {simulation:'An explicit generated prediction, not a real outcome'};},consolidate:async()=>{throw new Error('Observation source unavailable');}};
 const service=createUserWorkspace({pool,queue,operations,runPending:async()=>{},llmStatus:()=>({backend:'test'})});await service.recover();
 const app=express();app.use(express.json());app.use(service.router);app.use(createPonderRouter({ponderQueue:queue,runPendingPonder:async()=>{}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const request=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
 try{
  assert.equal((await request('/oca/ui/pursuits')).body.items.length,1);
  assert.equal((await request('/oca/ui/pursuits?filter=closed')).body.items[0].chain_id,closed.chain_id);
  assert.equal((await request('/oca/ui/pursuits?q=no-match')).body.total,0);
  const beyond = (await request('/oca/ui/pursuits?offset=90')).body;
  assert.equal(beyond.items.length,0);assert.equal(beyond.total,1, 'total survives an empty later page');
  assert.equal((await request('/oca/ui/records/unknown')).status,404);
  const requestKey=randomUUID();
  const creation=await request('/ponder','POST',{seed:'Pursuit through packaged router',learning:false,clientRequestId:requestKey});
  assert.equal(creation.status,202);
  assert.equal((await request('/ponder/request/'+requestKey)).body.chain_id,creation.body.chain_id);
  assert.equal((await request('/ponder/'+creation.body.chain_id+'/cancel','POST',{})).body.status,'cancelled');
  assert.equal((await request('/oca/ui/controls','PATCH',{permissions:true})).status,400);
  await request('/oca/ui/controls','PATCH',{queuePaused:true});
  assert.equal((await request(`/oca/ui/pursuits/${p.chain_id}/run`,'POST')).status,409);
  assert.equal((await request('/oca/ui/jobs','POST',{kind:'imagine',input:{}})).status,400);
  assert.equal((await request('/oca/ui/jobs','POST',{kind:'shell',input:{command:'bad'}})).status,400);
  const clientRequestId=randomUUID();
  const submission={kind:'imagine',title:'Test scenario',clientRequestId,input:{description:'A bounded synthetic scenario'}};
  const job=await request('/oca/ui/jobs','POST',submission);
  assert.equal(job.status,202);await entered;
  const retry=await request('/oca/ui/jobs','POST',submission);assert.equal(retry.body.id,job.body.id);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM oca_user_jobs')).rows[0].n,1);
  assert.equal((await request('/oca/ui/jobs','POST',{...submission,input:{description:'changed request'}})).status,409);
  const saved=await request(`/oca/ui/jobs/${job.body.id}`);assert.equal(saved.body.status,'running');assert.equal(saved.body.result,null,'running is not success');
  release();
  const until=Date.now()+5000;let outcome;
  do{outcome=(await request(`/oca/ui/jobs/${job.body.id}`)).body;if(outcome.status==='completed')break;await new Promise(r=>setTimeout(r,10));}while(Date.now()<until);
  assert.equal(outcome.status,'completed');assert.match(outcome.result.simulation,/not a real outcome/);
  assert.equal((await request('/oca/ui/jobs')).body.items[0].id,job.body.id);
  const fail=await request('/oca/ui/jobs','POST',{kind:'consolidate',input:{}});let failed;
  do{failed=(await request(`/oca/ui/jobs/${fail.body.id}`)).body;if(failed.status==='failed')break;await new Promise(r=>setTimeout(r,10));}while(Date.now()<until);
  assert.equal(failed.status,'failed');assert.equal(failed.error,'Observation source unavailable');
  const legacyID=randomUUID();
  await pool.query("INSERT INTO oca_user_jobs(id,kind,title,input,status,result) VALUES($1,'imagine','Old fallback','{}','completed',$2)", [legacyID,JSON.stringify({expected_outcome:'Heuristic simulation fallback: private test',predicted_states:[],risks:['simulation_llm_unavailable']})]);
  assert.equal((await request(`/oca/ui/jobs/${legacyID}`)).body.result_quality,'analysis_unavailable');
  assert.equal((await request('/oca/ui/jobs')).body.items.find(j=>j.id===legacyID).result_quality,'analysis_unavailable');
  assert.equal((await request(`/oca/ui/jobs/${legacyID}`)).body.status,'completed','old receipt is preserved, its quality is interpreted honestly');
  const crashID=randomUUID();await pool.query("INSERT INTO oca_user_jobs(id,kind,title,input,status) VALUES($1,'imagine','Interrupted','{}','running')",[crashID]);
  await service.recover();
  const crashed=(await request(`/oca/ui/jobs/${crashID}`)).body;
  assert.equal(crashed.status,'interrupted');assert.equal(crashed.result,null);
  assert.equal((await request(`/oca/ui/jobs/${job.body.id}`)).body.status,'completed','restart does not erase completed receipts');
 }finally{await new Promise(r=>server.close(r));}
}));

test('uncertain transport retries create one durable pursuit and reject changed payload under the same identity', () => isolated(async pool => {
 const q = createPonderQueue({pool,reason:async()=>({status:'needs_evidence'})});
 const input = {seed:'Private request identity test',learning:false,clientRequestId:randomUUID()};
 const results = await Promise.all(Array.from({length:5},()=>q.enqueue(input)));
 assert.equal(new Set(results.map(p=>p.chain_id)).size,1);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM thought_chains')).rows[0].n,1);
 assert.equal((await q.findRequest(input.clientRequestId)).chain_id,results[0].chain_id);
 await assert.rejects(q.enqueue({...input,seed:'Different intended work'}), /earlier version/);
}));

test('original memory inspection returns exact provenance without changing recall or confidence, reports missing links, and bounds sources',()=>isolated(async pool=>{
 for(const table of ['episodic_memory','semantic_memory','semantic_evidence']) {
  await pool.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
  await pool.query(`ALTER TABLE ${table} ALTER COLUMN id DROP DEFAULT`);
  await pool.query(`ALTER TABLE ${table} ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY`);
 }
 await pool.query("INSERT INTO episodic_memory(id,event_type,content) SELECT n,'test_observation','Private source '||n FROM generate_series(1,35) n");
 await pool.query("INSERT INTO semantic_memory(id,concept,source_type,source_episodes,confidence) VALUES(1,'Private generated claim','abstraction',ARRAY[1,1,999],0.9),(2,'Many sources','abstraction',ARRAY(SELECT generate_series(1,35)),0.4)");
 await pool.query("INSERT INTO semantic_evidence(concept_id,episode_id,source_type,supports,evidence_text) VALUES(1,1,'observation',true,'Private support'),(1,NULL,'user_feedback',false,'Private correction')");
 const service=createUserWorkspace({pool,queue:{},operations:{},runPending:async()=>{},llmStatus:()=>({})});
 const app=express();app.use(service.router);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const get=async path=>{const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`);return {status:r.status,body:await r.json()};};
 const snapshot=async()=>JSON.stringify((await pool.query('SELECT id,access_count,last_accessed,confidence,evidence_count FROM semantic_memory ORDER BY id')).rows)+JSON.stringify((await pool.query('SELECT id,access_count,last_accessed FROM episodic_memory ORDER BY id')).rows);
 const before=await snapshot();
 try {
  const exact=await get('/oca/ui/memory/knowledge/1');assert.equal(exact.status,200);
  assert.equal(exact.body.record.concept,'Private generated claim');
  assert.equal(exact.body.verification,'not_independently_verified');
  assert.deepEqual(exact.body.sources.map(r=>r.id),[1]);assert.deepEqual(exact.body.missingSourceIds,[999]);
  assert.equal(exact.body.sourceTotal,2);assert.equal(exact.body.evidenceTotal,2);
  assert.deepEqual(new Set(exact.body.evidence.map(r=>r.supports)),new Set([true,false]));
  assert.equal(exact.body.record.embedding,undefined);
  const episode=await get('/oca/ui/memory/experience/1');assert.equal(episode.body.record.content,'Private source 1');
  const bounded=await get('/oca/ui/memory/knowledge/2');assert.equal(bounded.body.sourceTotal,35);assert.equal(bounded.body.sources.length,30);
  assert.equal((await get('/oca/ui/memory/knowledge/900')).status,404);
  assert.equal((await get('/oca/ui/memory/knowledge/1.5')).status,400);
  assert.equal((await get('/oca/ui/memory/knowledge/9007199254740992')).status,400);
  assert.equal((await get('/oca/ui/memory/other/1')).status,404);
  const words = await get('/oca/ui/memory-search?kind=experience&q=Private%20source');
  assert.equal(words.status,200);assert.equal(words.body.retrieval,'word_search');assert.equal(words.body.results.length,20);
  assert.equal(words.body.results[0].id,35);assert.equal(words.body.results[0].embedding,undefined);
  assert.equal((await get('/oca/ui/memory-search?kind=knowledge&q=absentterm')).body.results.length,0);
  assert.equal((await get('/oca/ui/memory-search?kind=knowledge&q=claim')).body.results[0].id,1);
  assert.equal((await get('/oca/ui/memory-search?kind=knowledge&q=')).status,400);
  assert.equal((await get('/oca/ui/memory-search?kind=other&q=source')).status,400);
  assert.equal(await snapshot(),before,'source inspection must not manufacture access or learning signals');
 } finally { await new Promise(r=>server.close(r)); }
}));
