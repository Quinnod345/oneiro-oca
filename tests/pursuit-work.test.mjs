import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { createPonderQueue } from '../reasoning/ponder-queue.js';
import { createPursuitWork, visibleWorkEvent, verifyWorkSources } from '../reasoning/pursuit-work.js';
import { buildCodexArgs } from '../codex-cli.js';

async function fixture(fn) {
  const admin = new pg.Pool({connectionString:process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro'});
  const schema = 'oca_work_' + randomUUID().replaceAll('-','');
  const root = await mkdtemp(join('/private/tmp','pursuit-work-test-'));
  let pool;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({connectionString:process.env.OCA_TEST_DATABASE_URL || 'postgres://localhost/oneiro',max:2,
      connectionTimeoutMillis:2000,options:`-c search_path=${schema},public`});
    await pool.query(`CREATE TABLE thought_chains(id SERIAL PRIMARY KEY,seed TEXT,priority FLOAT8,status TEXT,depth INT DEFAULT 0,
      ponder_state JSONB,created_at TIMESTAMPTZ DEFAULT now(),updated_at TIMESTAMPTZ DEFAULT now());
      CREATE UNIQUE INDEX chain_request ON thought_chains ((ponder_state->>'clientRequestId')) WHERE ponder_state->>'clientRequestId' IS NOT NULL;`);
    const queue = createPonderQueue({pool,reason:async()=>{throw Error('Inference was not expected');}});
    const chain = await queue.enqueue({seed:'Inventory must include all images',doneWhen:'Checked inventory matches the files',learning:false});
    const make = runner => createPursuitWork({pool,queue,runner,root:join(root,'work'),sourceRoots:[root]});
    await fn({pool,queue,chain,root,make});
  } finally { if(pool) await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); await rm(root,{recursive:true,force:true}); }
}

test('durable Codex resume names a specific session and retains sandbox, without bypassing rules',()=>{
  const id = randomUUID(); const args = buildCodexArgs({persistent:true,threadId:id,sandbox:'workspace-write'});
  assert.deepEqual(args.slice(0,2),['exec','resume']);
  assert.ok(args.includes(id));assert.ok(!args.includes('--ephemeral'));assert.ok(!args.includes('--ignore-rules'));
  assert.ok(args.includes('sandbox_mode="workspace-write"'));assert.equal(args.at(-1),'-');
});
test('work logs exclude private reasoning and redact credentials',()=>{
  assert.equal(visibleWorkEvent({type:'item.completed',item:{type:'reasoning',text:'private'}}),null);
  const e=visibleWorkEvent({type:'item.completed',item:{type:'command_execution',command:'curl x',aggregated_output:'api_key=abcde',status:'completed'}});
  assert.equal(e.output,'api_key=[redacted]');
});
test('source verifier rejects fabricated quotations, secrets, changed files and model-created work', async()=>{
  const root=await mkdtemp(join('/private/tmp','verify-source-'));try{
    const work=join(root,'work');await mkdir(work);
    await writeFile(join(root,'inventory.md'),'Inventory: alpha.png, gamma.png.');
    await writeFile(join(root,'.env'),'PRIVATE_TOKEN=not-an-observation');
    await writeFile(join(work,'fake.md'),'Claimed proof of completion.');
    const r=await verifyWorkSources([
      {path:join(root,'inventory.md'),quote:'Inventory: alpha.png, gamma.png.'},
      {path:join(root,'inventory.md'),quote:'This was deployed successfully.'},
      {path:join(root,'.env'),quote:'PRIVATE_TOKEN=not-an-observation'},
      {path:join(work,'fake.md'),quote:'Claimed proof of completion.'}
    ],{roots:[root],workRoot:work,startedAt:Date.now()+1});
    assert.equal(r.evidence.length,1);assert.equal(r.rejected.length,3);
    assert.match(r.evidence[0].observation,/not proof/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('concurrent start is idempotent, blocks queue competition, records real sources and resumes work',async()=>fixture(async({pool,queue,chain,root,make})=>{
  const source=join(root,'inventory.md');await writeFile(source,'Inventory lacks gamma.png; this is a draft.');
  let calls=0;const thread=randomUUID();
  const service=make(async(_,options)=>{
    calls++; assert.equal(options.model,'gpt-6-astra');assert.equal(options.threadId,calls===1?null:thread);
    await options.onEvent({type:'thread.started',thread_id:thread});
    await options.onEvent({type:'item.completed',item:{type:'command_execution',command:'cat inventory.md',aggregated_output:'Inventory lacks gamma.png; this is a draft.',status:'completed',exit_code:0}});
    return {threadId:thread,text:JSON.stringify({summary:'The draft inventory omits gamma.png.',nextStep:'Update the inventory and compare it with the directory.',remainingQuestions:[],sources:[{path:source,quote:'Inventory lacks gamma.png; this is a draft.'}]})};
  });await service.init();
  const req={requestId:randomUUID()};const runs=await Promise.all([service.enqueue(chain.chain_id,req),service.enqueue(chain.chain_id,req)]);
  assert.equal(runs[0].id,runs[1].id);assert.equal(await queue.runNext(chain.chain_id),null);
  await service.runNext();
  const saved=await queue.get(chain.chain_id);assert.equal(saved.evidence.length,1);assert.equal(saved.want.progress,0);assert.equal(saved.want.receipts.length,0);
  assert.equal(saved.researchActive,false);assert.equal(saved.status,'pondering');
  const restored=make(async()=>{});await restored.init();const log=await restored.events(chain.chain_id,runs[0].id);
  assert.equal(log.run.status,'completed');assert.equal(log.run.thread_id,thread);assert.ok(log.events.some(x=>x.event.kind==='command'));
  await service.enqueue(chain.chain_id,{requestId:randomUUID(),instruction:'Continue with the next step'});await service.runNext();assert.equal(calls,2);
}));
test('cancellation fences a late result and parent closure prevents new work',async()=>fixture(async({queue,chain,make})=>{
  let release,started;const ready=new Promise(r=>started=r);
  const service=make(async(_,options)=>{started();await new Promise(r=>release=r);return {text:JSON.stringify({summary:'Late answer',nextStep:'Do a thing',remainingQuestions:[],sources:[]})};});
  await service.init();const run=await service.enqueue(chain.chain_id,{requestId:randomUUID()});
  const running=service.runNext();await ready;await service.cancel(chain.chain_id,run.id);release();await running;
  assert.equal((await service.events(chain.chain_id,run.id)).run.status,'cancelled');
  assert.equal((await queue.get(chain.chain_id)).want.progress,0);
  await queue.cancel(chain.chain_id);await assert.rejects(()=>service.enqueue(chain.chain_id,{requestId:randomUUID()}),/closed/);
}));
test('expired worker is honestly interrupted, keeps its logs, and releases the queue',async()=>fixture(async({pool,queue,chain,make})=>{
  const service=make(async()=>{});await service.init();const run=await service.enqueue(chain.chain_id,{requestId:randomUUID()});
  await pool.query("UPDATE pursuit_work SET status='running',lease=$2,lease_until=now()-interval '1 second' WHERE id=$1",[run.id,randomUUID()]);
  assert.equal(await service.runNext(),null);
  const saved=await service.events(chain.chain_id,run.id);assert.equal(saved.run.status,'interrupted');assert.ok(saved.events.length);
  assert.equal((await queue.get(chain.chain_id)).researchActive,false);
}));

test('saved artifact versions survive continuation, exclude symlinks, and detect tampering',async()=>fixture(async({queue,chain,root,make})=>{
  let attempt=0;
  const service=make(async(_,options)=>{
    attempt++;
    await writeFile(join(options.workingDirectory,'draft.md'),`Draft version ${attempt}`);
    if(attempt===1) await symlink(join(root,'outside.txt'),join(options.workingDirectory,'linked.txt'));
    return {threadId:randomUUID(),text:JSON.stringify({summary:'A draft, not a verified outcome.',nextStep:'Check the draft.',remainingQuestions:[],sources:[]})};
  });
  await writeFile(join(root,'outside.txt'),'Not an artifact');await service.init();
  const first=await service.enqueue(chain.chain_id,{requestId:randomUUID()});await service.runNext();
  await service.enqueue(chain.chain_id,{requestId:randomUUID()});await service.runNext();
  const saved=await service.artifact(chain.chain_id,first.id,'draft.md');
  assert.equal(saved.content,'Draft version 1');assert.equal(saved.verifiedOutcome,false);
  await assert.rejects(()=>service.artifact(chain.chain_id,first.id,'linked.txt'),/not found/);
  await assert.rejects(()=>service.artifact(chain.chain_id+1,first.id,'draft.md'),/not found/);
  await assert.rejects(()=>service.artifact(chain.chain_id,first.id,'../outside.txt'),/Invalid/);
  await writeFile(join(root,'work',String(chain.chain_id),'.history',first.id,'draft.md'),'Tampered');
  await assert.rejects(()=>service.artifact(chain.chain_id,first.id,'draft.md'),/changed/);
  assert.equal((await queue.get(chain.chain_id)).want.progress,0);
}));

test('long-term pursuits retain more than 64 observations and more than eight revisions',async()=>fixture(async({pool,queue,chain})=>{
  for(let i=0;i<70;i++) await queue.addEvidence(chain.chain_id,[{id:'history-'+i,source:'Synthetic saved observation',observation:'Observed revision '+i}]);
  const restored=await queue.get(chain.chain_id);assert.equal(restored.evidence.length,70);assert.equal(restored.priorRuns.length,70);
  const bounded=createPonderQueue({pool,reason:async(_,options)=>{
    assert.equal(options.evidence.length,64);assert.equal(options.evidence[0].id,'history-6');
    assert.match(options.context,/do not imply exhaustive review/);
    return {status:'needs_evidence',checkpoint:{version:1,passes:[]}};
  }});
  const review=await bounded.runNext(chain.chain_id);assert.equal(review.result.evidenceCoverage.omitted,6);
  assert.equal(review.evidence.length,70);assert.equal(review.want.progress,0);
  await assert.rejects(()=>queue.addEvidence(chain.chain_id,[{id:'history-0',source:'Synthetic saved observation',observation:'Changed'}]),/cannot be rewritten/);
}));

test('a continuous want is never left idle: the engine fires its own slices on a cadence that backs off while they come back dry, one at a time, and stops when the person turns it off',async()=>fixture(async({pool,queue,chain,root,make})=>{
  let now=Date.now();const calls=[];
  const service=createPursuitWork({pool,queue,runner:async(prompt,options)=>{calls.push(prompt);
      // the first slice finds nothing usable; the second quotes a real file
      if(calls.length===1) return {threadId:null,text:JSON.stringify({summary:'Nothing in the sources about revenue.',nextStep:'Ask for the Stripe export.',remainingQuestions:['Last month revenue?'],sources:[]})};
      const source=join(root,'notes.md');await writeFile(source,'Revenue last month was $0; zero subscribers.');
      return {threadId:null,text:JSON.stringify({summary:'Found the note.',nextStep:'Price a launch offer.',remainingQuestions:[],sources:[{path:source,quote:'Revenue last month was $0; zero subscribers.'}]})};
    },root:join(root,'work'),sourceRoots:[root],clock:()=>now});
  await service.init();
  // not continuous: nothing happens while it waits
  await pool.query(`UPDATE thought_chains SET status='awaiting_evidence', ponder_state=jsonb_set(ponder_state,'{result}','{"status":"needs_evidence","missingEvidence":["Last month revenue and costs"]}') WHERE id=$1`,[chain.chain_id]);
  assert.deepEqual((await service.keepWorking()).started,[]);
  await queue.setContinuous(chain.chain_id,true);
  assert.equal((await queue.get(chain.chain_id)).continuous,true);
  // continuous and due: one engine-fired slice, appraised as a sandboxed research slice that proceeds with the switch off
  assert.deepEqual((await service.keepWorking()).started,[chain.chain_id]);
  assert.deepEqual((await service.keepWorking()).started,[],'one slice per want at a time');
  const queued=(await pool.query("SELECT * FROM pursuit_work WHERE chain_id=$1",[chain.chain_id])).rows;
  assert.equal(queued.length,1);assert.match(queued[0].instruction,/always working on it/);assert.match(queued[0].instruction,/Last month revenue and costs/);
  await service.runNext();
  let saved=await queue.get(chain.chain_id);
  assert.equal(saved.continuity.dry,1,'a dry slice counts');assert.deepEqual(saved.continuity.remaining,['Last month revenue?']);
  assert.equal(saved.status,'awaiting_evidence','nothing found: still waiting');
  // not due yet: the cadence doubled after a dry run
  assert.deepEqual((await service.keepWorking()).started,[]);
  now+=21*60_000; assert.deepEqual((await service.keepWorking()).started,[],'20 min is not enough after one dry slice');
  now+=21*60_000; assert.deepEqual((await service.keepWorking()).started,[chain.chain_id],'40 min is');
  const second=(await pool.query("SELECT instruction FROM pursuit_work WHERE chain_id=$1 ORDER BY created_at DESC LIMIT 1",[chain.chain_id])).rows[0];
  assert.match(second.instruction,/OPEN QUESTIONS FROM YOUR LAST SLICE:\n- Last month revenue\?/);
  await service.runNext();
  saved=await queue.get(chain.chain_id);
  assert.equal(saved.continuity.dry,0,'evidence found resets the backoff');assert.equal(saved.status,'pondering','new evidence reopens the want');
  assert.ok(saved.evidence.some(e=>/zero subscribers/.test(e.observation)));
  // off again: the engine leaves it alone
  await pool.query(`UPDATE thought_chains SET status='awaiting_evidence' WHERE id=$1`,[chain.chain_id]);
  await queue.setContinuous(chain.chain_id,false); now+=60*60_000;
  assert.deepEqual((await service.keepWorking()).started,[]);
  assert.equal(calls.length,2);
}));
