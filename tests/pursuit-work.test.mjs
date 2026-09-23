import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { createPonderQueue } from '../reasoning/ponder-queue.js';
import { createPursuitWork, visibleWorkEvent, verifyWorkSources } from '../reasoning/pursuit-work.js';
import { createAsks } from '../reasoning/asks.js';
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


test('Aside page evidence survives six calls and two view actions, but cannot leak into a later slice', async()=>fixture(async({pool,queue,chain,root})=>{
  const url = 'https://analytics.example.test/report';
  const quote = 'August revenue was $120 from 8 subscribers.';
  const observations = [];
  let attempt = 0;
  const service = createPursuitWork({pool,queue,root:join(root,'work'),sourceRoots:[root],
    risk:{decide:async()=>({decision:'proceed'}),observe:async(id,outcome)=>observations.push(outcome)},
    runner:async(prompt,options)=>{
      attempt++;
      if (attempt === 1) {
        const calls = ['aside_read', 'aside_snapshot_tab', 'aside_click', 'aside_select', 'aside_read_tab', 'aside_read_tab'];
        for (const [i,tool] of calls.entries()) {
          const page = {url, text:i < 3 ? 'Choose a reporting period to see revenue.' : quote};
          const result = i === 3 ? {structured_content:page} : {content:[{type:'text',text:JSON.stringify(page)}],isError:false};
          await options.onEvent({type:'item.completed',item:{type:'mcp_tool_call',server:'aside',tool,status:'completed',result}});
        }
      }
      return {text:JSON.stringify({summary:'The filtered page shows August revenue.',nextStep:'Review the revenue observation.',remainingQuestions:[],
        sources:[{path:url,quote}, {path:url,quote:'August revenue was $999 from 8 subscribers.'}, {path:url+'/unseen',quote}]})};
    }});
  await service.init();
  const run = await service.enqueue(chain.chain_id,{requestId:randomUUID()});
  const result = await service.runNext();
  assert.equal(result.evidenceApplied,true,JSON.stringify(result));
  assert.equal(result.evidence.length,1);
  assert.equal(result.rejected.length,2);
  assert.match(result.evidence[0].source,/Aside browser/);
  assert.ok(result.evidence[0].source.includes(url));
  assert.ok(result.evidence[0].observation.includes(quote));
  const saved = await queue.get(chain.chain_id);
  assert.equal(saved.evidence.length,1);
  assert.equal(saved.want.progress,0,'a page observation is not an outcome receipt');
  assert.equal(saved.want.receipts.length,0);
  assert.equal(saved.continuity.dry,0);
  assert.equal(observations[0].result,'success');
  assert.match(observations[0].evidence[0].observation,/2 view actions.*6 Aside calls/);
  assert.equal((await service.events(chain.chain_id,run.id)).run.report.evidenceApplied,true);
  await service.enqueue(chain.chain_id,{requestId:randomUUID()});
  const stale = await service.runNext();
  assert.equal(stale.evidenceApplied,false,'the next slice must observe its own page');
  assert.equal(stale.evidence.length,0);
  assert.equal(observations[1].result,'failure');
}));

test('only successful Aside page text can ground a web quote', async()=>fixture(async({queue,chain,make})=>{
  const quote = 'August revenue was $120 from 8 subscribers.';
  const cases = [
    {status:'failed'},
    {error:{message:'transport failed'}},
    {resultFlags:{isError:true}},
    {pageFlags:{refused:true}},
    {pageFlags:{accessBlocked:{kind:'sign_in'}}},
    {server:'untrusted'},
    {tool:'aside_tabs'},
    {tool:'aside_unknown'},
    {eventType:'item.started'},
    {pageFlags:{text:undefined,title:quote}},
    {pageFlags:{text:undefined,controls:[{name:quote}]}},
    {raw:'not JSON'},
  ];
  const service = make(async(_,options)=>{
    const sources = [];
    for (const [i,c] of cases.entries()) {
      const url = `https://analytics.example.test/rejected/${i}`;
      const page = {url,text:quote,...c.pageFlags};
      await options.onEvent({type:c.eventType || 'item.completed',item:{type:'mcp_tool_call',server:c.server || 'aside',tool:c.tool || 'aside_read_tab',
        status:c.status || 'completed',error:c.error,result:{content:[{type:'text',text:c.raw || JSON.stringify(page)}],...c.resultFlags}}});
      sources.push({path:url,quote});
    }
    return {text:JSON.stringify({summary:'None of the supplied claims have a successful page read.',nextStep:'Read the page successfully.',remainingQuestions:[],sources})};
  });
  await service.init();await service.enqueue(chain.chain_id,{requestId:randomUUID()});
  const result = await service.runNext();
  assert.equal(result.evidence.length,0);
  assert.equal(result.evidenceApplied,false);
  assert.equal(result.rejected.length,cases.length);
  assert.equal((await queue.get(chain.chain_id)).evidence.length,0);
}));


test('web verification preserves filtered snapshots, normalizes whitespace, deduplicates quotes and retains file evidence', async()=>fixture(async({queue,chain,root,make})=>{
  const file = join(root,'existing.md');
  const fileQuote = 'The local inventory still needs a comparison.';
  await writeFile(file,fileQuote);
  const quotes = ['August revenue was $120 from 8 subscribers.', 'September revenue was $240 from 16 subscribers.', 'October revenue was $360 from 24 subscribers.'];
  const url = 'https://analytics.example.test/report';
  const service = make(async(_,options)=>{
    for (const [i,quote] of quotes.entries()) {
      const page = {url,text:quote.replaceAll(' ', '\n  ')};
      const result = i === 0 ? {structured_content:page} : i === 1 ? {structuredContent:page} : {content:[{type:'text',text:JSON.stringify(page)}]};
      await options.onEvent({type:'item.completed',item:{type:'mcp_tool_call',server:'aside',tool:'aside_select',status:'completed',result}});
    }
    return {text:JSON.stringify({summary:'Observed three reporting periods and a local file.',nextStep:'Compare the periods.',remainingQuestions:[],
      sources:[...quotes.map(quote=>({path:url,quote})),{path:url,quote:quotes[0]}, {path:file,quote:fileQuote},
        {path:url,quote:'August'}, {path:url,quote:7}, {path:url,quote:'x'.repeat(4001)},
        {path:'https://name:password@analytics.example.test/report',quote:quotes[0]},
        {path:'file:///report',quote:quotes[0]}, {path:url+'?filter='+'x'.repeat(1000),quote:quotes[0]},null]})};
  });
  await service.init();await service.enqueue(chain.chain_id,{requestId:randomUUID()});
  const result = await service.runNext();
  assert.equal(result.evidenceApplied,true,JSON.stringify(result));
  assert.equal(result.evidence.length,4);
  assert.equal(result.rejected.length,7);
  for (const quote of [...quotes,fileQuote]) assert.ok(result.evidence.some(e=>e.observation.includes(quote)));
  assert.equal((await queue.get(chain.chain_id)).evidence.length,4);
}));

test('cancellation also fences captured web evidence', async()=>fixture(async({queue,chain,make})=>{
  const url = 'https://analytics.example.test/report', quote = 'August revenue was $120 from 8 subscribers.';
  let release,started;
  const ready = new Promise(resolve=>started=resolve);
  const service = make(async(_,options)=>{
    await options.onEvent({type:'item.completed',item:{type:'mcp_tool_call',server:'aside',tool:'aside_read',status:'completed',
      result:{content:[{type:'text',text:JSON.stringify({url,text:quote})}]}}});
    started();await new Promise(resolve=>release=resolve);
    return {text:JSON.stringify({summary:'Late web report.',nextStep:'Review it.',remainingQuestions:[],sources:[{path:url,quote}]})};
  });
  await service.init();const run = await service.enqueue(chain.chain_id,{requestId:randomUUID()});
  const running = service.runNext();await ready;
  await service.cancel(chain.chain_id,run.id);release();await running;
  assert.equal((await service.events(chain.chain_id,run.id)).run.status,'cancelled');
  assert.equal((await queue.get(chain.chain_id)).evidence.length,0);
}));


// Exercise runNext and the real ask ledger together; no live browser or notification delivery.
const accessTarget = 'https://app.posthog.com/project/27/dashboard?period=month';
const accessWall = { url: 'https://app.posthog.com/login', title: 'Sign in', targetId: 'tab-27',
  accessBlocked: { kind: 'sign_in', host: 'app.posthog.com', url: 'https://app.posthog.com/login', title: 'Sign in' } };
const accessSuccess = { action: { kind: 'sign in', committed: true, signedIn: true },
  url: accessTarget, title: 'Dashboard', text: 'Protected project dashboard with monthly revenue.' };
const accessPage = { url: accessTarget, title: 'Dashboard', text: 'Protected project dashboard with monthly revenue.' };
const accessEvent = (tool, result, args = {}, overrides = {}) => ({ type: 'item.completed', item: {
  type: 'mcp_tool_call', server: 'aside', tool, arguments: args, status: 'completed', result: { structuredContent: result }, ...overrides } });
async function accessFixture(fn) {
  return fixture(async ({pool,queue,chain,root}) => {
    let now = Date.now(), events = [], summary = 'Access remains unverified.';
    const trace = [], sent = [];
    const realAsks = createAsks({pool,clock:()=>now,log:{log(){},warn(){}},deliverers:{test:async m=>sent.push(m)}});
    await realAsks.init();
    const asks = {...realAsks,ask:async args=>{trace.push(['ask',args]);return realAsks.ask(args);},
      answer:async(...args)=>{trace.push(['answer',...args]);return realAsks.answer(...args);}};
    let browser = async()=>{throw Error('Unexpected browser action');};
    const service = createPursuitWork({pool,queue,root:join(root,'work'),sourceRoots:[root],asks,clock:()=>now,
      asideTool:async(tool,args)=>{trace.push([tool,args]);return browser(tool,args);},
      runner:async(_,options)=>{
        for(const event of events) await options.onEvent(event);
        return {text:JSON.stringify({summary,nextStep:'Inspect the protected target.',remainingQuestions:[],sources:[]})};
      }});
    await service.init();
    const slice = async(nextEvents=[],nextBrowser=null,advance=0)=>{
      now+=advance; events=nextEvents; if(nextBrowser) browser=nextBrowser;
      await service.enqueue(chain.chain_id,{requestId:randomUUID()});
      const result=await service.runNext(); assert.equal(result.error,undefined,JSON.stringify(result));
      return (await queue.get(chain.chain_id)).needs;
    };
    await fn({slice,asks,trace,sent,chain,pool,setSummary:s=>{summary=s;}});
  });
}
const wallEvent = () => accessEvent('aside_read', accessWall, {url:accessTarget});

test('login wall executes gated recovery before one precise credential handoff; unrelated slices preserve it and suppress the 67-minute duplicate', async()=>accessFixture(async({slice,trace,sent,asks,chain,setSummary})=>{
  const blocked={...accessWall, action:{kind:'sign in',committed:true,signedIn:false},asideAgent:'BLOCKED: No saved login is available for PostHog.'};
  let needs=await slice([wallEvent()],async(tool,args)=>{
    assert.equal(tool,'aside_sign_in');assert.equal(args.pursuit,chain.chain_id);assert.equal(args.targetId,'tab-27');assert.ok(args.purpose);
    assert.equal(sent.length,0,'recover before contacting Quinn');return blocked;
  });
  assert.deepEqual(trace.map(t=>t[0]),['aside_sign_in','ask']);
  assert.equal(needs[0].status,'person_required');assert.ok(needs[0].askId);
  assert.match(sent[0],/No saved login is available/);
  const id=needs[0].askId;
  setSummary('Access is unchanged: Apple remains at sign-in, and no invoice files arrived.');
  needs=await slice([accessEvent('aside_tabs',{tabs:[{targetId:'tab-27',url:accessWall.url}]})]);
  assert.equal(needs[0].askId,id);assert.equal((await asks.open()).length,1);
  needs=await slice([wallEvent()],null,67*60_000);
  assert.equal(needs[0].askId,id);assert.equal(sent.length,1);assert.equal(trace.filter(t=>t[0]==='answer').length,0);
}));

test('successful recovery plus a fresh exact protected-target read clears the wall without an ask',async()=>accessFixture(async({slice,trace,sent})=>{
  const needs=await slice([wallEvent()],async(tool,args)=>{
    if(tool==='aside_sign_in') return accessSuccess;
    assert.equal(tool,'aside_read');assert.equal(args.url,accessTarget);return accessPage;
  });
  assert.deepEqual(trace.map(t=>t[0]),['aside_sign_in','aside_read']);assert.deepEqual(needs,[]);assert.deepEqual(sent,[]);
}));

test('a claimed recovery is not access: public, unrelated, wrong-filter, empty, errored and still-blocked reads cannot resolve',async()=>{
  for(const read of [
    {...accessPage,url:'https://app.posthog.com/'},
    {...accessPage,url:'https://apple.com/apps'},
    {...accessPage,url:accessTarget.replace('month','week')},
    {...accessPage,text:''},
    {isError:true,content:[{type:'text',text:'timeout'}]},
    accessWall,
  ]) await accessFixture(async({slice,asks,sent,chain})=>{
    const first=await asks.ask({chainId:chain.chain_id,kind:'sign_in',host:'app.posthog.com',detail:'SMS code required.'});
    const needs=await slice([wallEvent()],async tool=>tool==='aside_sign_in'?accessSuccess:read);
    assert.equal(needs.length,1);assert.equal(sent.length,1);
    assert.equal((await asks.recent({chainId:chain.chain_id})).find(a=>a.id===first.id).replied_at,null);
  });
});

test('only the matching host ask is resolved after observed recovery and a fresh protected read',async()=>accessFixture(async({slice,asks,trace,chain})=>{
  const own=await asks.ask({chainId:chain.chain_id,kind:'sign_in',host:'app.posthog.com',detail:'SMS code required.'});
  const apple=await asks.ask({chainId:chain.chain_id,kind:'sign_in',host:'idmsa.apple.com',detail:'Approve on the phone.'});
  await slice([wallEvent()],async tool=>tool==='aside_sign_in'?accessSuccess:accessPage);
  assert.deepEqual(trace.filter(t=>t[0]==='answer').map(t=>t[1]),[own.id]);
  assert.deepEqual((await asks.open()).map(a=>a.id),[apple.id]);
}));

test('held approvals reuse the existing ask id on the next gated attempt without a second handoff',async()=>accessFixture(async({slice,asks,trace,sent,chain})=>{
  const held=await asks.ask({chainId:chain.chain_id,kind:'question',detail:'Sign in to PostHog with the saved login?'});
  let needs=await slice([wallEvent()],async()=>({held:true,askId:held.id,question:'Sign in to PostHog with the saved login?',why:'one yes required'}));
  assert.equal(needs[0].askId,held.id);assert.equal(needs[0].status,'held');
  needs=await slice([wallEvent()],async(tool,args)=>{
    assert.equal(args.approval,held.id);return {held:true,askId:held.id,question:'Sign in to PostHog with the saved login?'};
  });
  assert.equal(sent.length,1);assert.equal(trace.filter(t=>t[0]==='ask').length,1);
  await asks.answer(held.id,'yes');
  needs=await slice([wallEvent()],async(tool,args)=>{
    if(tool==='aside_sign_in'){assert.equal(args.approval,held.id);return accessSuccess;}
    return accessPage;
  });
  assert.deepEqual(needs,[]);assert.equal(sent.length,1);
}));

test('person-only refusals are handed off precisely and never bypassed with another action',async()=>accessFixture(async({slice,trace,sent})=>{
  const needs=await slice([wallEvent(),accessEvent('aside_click',{refused:true,control:'button "Create Reports"',why:'would commit something; the person does that.'},{targetId:'tab-27',ref:'r8'})]);
  assert.deepEqual(trace.map(t=>t[0]),['ask']);assert.equal(needs[0].status,'person_required');
  assert.match(sent[0],/Create Reports.*would commit something; the person does that/);
}));

test('real credential and user-presence barriers send one exact handoff; transient failures do not',async()=>{
  for(const barrier of ['An SMS code is required.','Approve sign-in on another device.','Complete the CAPTCHA.','No saved password is available.']) {
    await accessFixture(async({slice,trace,sent})=>{
      const needs=await slice([wallEvent()],async()=>({...accessWall,action:{committed:true,signedIn:false},asideAgent:`BLOCKED: ${barrier}`}));
      assert.deepEqual(trace.map(t=>t[0]),['aside_sign_in','ask']);assert.equal(needs[0].status,'person_required');assert.ok(sent[0].includes(barrier));
      await slice([wallEvent()]);assert.equal(sent.length,1);
    });
  }
  await accessFixture(async({slice,sent})=>{
    const needs=await slice([wallEvent()],async()=>{throw Error('Aside transport timed out');});
    assert.equal(needs[0].status,'recovery_failed');assert.equal(sent.length,0);
  });
});

test('saved-login tool redirects recover; untrusted or incomplete tool events cannot create needs',async()=>accessFixture(async({slice,trace,sent})=>{
  await slice([
    accessEvent('aside_read',accessWall,{url:accessTarget},{server:'untrusted'}),
    accessEvent('aside_read',accessWall,{url:accessTarget},{status:'failed'}),
    {...wallEvent(),type:'item.started'},
    accessEvent('aside_read',accessWall,{url:accessTarget},{result:{isError:true,structuredContent:accessWall}}),
  ]);
  assert.deepEqual(trace,[]);
  const needs=await slice([wallEvent(),accessEvent('aside_click',{refused:true,why:'it submits a sign-in form: use aside_sign_in, which signs in with the saved login'},{targetId:'tab-27'})],async tool=>tool==='aside_sign_in'?accessSuccess:accessPage);
  assert.deepEqual(needs,[]);assert.deepEqual(sent,[]);assert.deepEqual(trace.map(t=>t[0]),['aside_sign_in','aside_read']);
}));

test('agent-performed recovery is not repeated, stale page reads cannot resolve, and later fresh reads can',async()=>accessFixture(async({slice,trace,sent})=>{
  let needs=await slice([wallEvent(),accessEvent('aside_read',accessPage,{url:accessTarget}),
    accessEvent('aside_sign_in',accessSuccess,{targetId:'tab-27'})],async()=>({...accessPage,url:'https://app.posthog.com/'}));
  assert.equal(needs[0].status,'unverified');assert.deepEqual(trace.map(t=>t[0]),['aside_read']);
  needs=await slice([accessEvent('aside_read',accessPage,{url:accessTarget})]);
  assert.deepEqual(needs,[]);assert.deepEqual(sent,[]);
}));

test('cross-host login redirects retain the protected target and verify that target, not the identity provider',async()=>accessFixture(async({slice,trace})=>{
  const wall={...accessWall,url:'https://accounts.google.com/login',accessBlocked:{kind:'sign_in',host:'accounts.google.com',url:'https://accounts.google.com/login'}};
  const needs=await slice([accessEvent('aside_read',wall,{url:accessTarget})],async tool=>tool==='aside_sign_in'?accessSuccess:accessPage);
  assert.deepEqual(needs,[]);assert.equal(trace[1][1].url,accessTarget);
}));

test('an approved recovery can still hit a new person-only barrier without losing its precise handoff',async()=>accessFixture(async({slice,asks,chain,sent,trace})=>{
  const approval=await asks.ask({chainId:chain.chain_id,kind:'question',detail:'Use the saved login on PostHog?'});
  await slice([wallEvent()],async()=>({held:true,askId:approval.id,question:'Use the saved login on PostHog?'}));
  await asks.answer(approval.id,'yes');
  const needs=await slice([wallEvent()],async(tool,args)=>{
    assert.equal(args.approval,approval.id);
    return {...accessWall,action:{committed:true,signedIn:false},asideAgent:'BLOCKED: An SMS code is required.'};
  });
  assert.equal(needs[0].status,'person_required');assert.notEqual(needs[0].askId,approval.id);
  assert.equal(sent.length,2);assert.match(sent[1],/An SMS code is required/);
  await slice([wallEvent()]);assert.equal(sent.length,2);
  assert.equal(trace.filter(t=>t[0]==='aside_sign_in').length,2);
}));

test('a declined approval or policy refusal is not retried or turned into another request',async()=>accessFixture(async({slice,trace,sent})=>{
  let needs=await slice([wallEvent()],async()=>({refused:true,why:'Quinn declined (ask #71: "no")'}));
  assert.equal(needs[0].status,'refused');assert.deepEqual(trace.map(t=>t[0]),['aside_sign_in']);
  needs=await slice([wallEvent()]);assert.equal(needs[0].status,'refused');assert.equal(trace.length,1);assert.deepEqual(sent,[]);
}));

test('a wall without a usable tab remains an observation, and report prose cannot resolve it',async()=>accessFixture(async({slice,trace,setSummary})=>{
  const wall={...accessWall,targetId:undefined};
  let needs=await slice([accessEvent('aside_read',wall,{url:accessTarget})]);
  assert.equal(needs[0].status,'observed');assert.deepEqual(trace,[]);
  setSummary('Signed in successfully; everything is fixed.');
  needs=await slice([]);assert.equal(needs[0].status,'observed');assert.deepEqual(trace,[]);
}));

test('an in-slice recovery followed by a fresh protected read removes stale walls before handoff',async()=>accessFixture(async({slice,trace,sent})=>{
  const needs=await slice([wallEvent(),accessEvent('aside_sign_in',accessSuccess,{targetId:'tab-27'}),
    accessEvent('aside_read_tab',accessPage,{targetId:'tab-27'})]);
  assert.deepEqual(needs,[]);assert.deepEqual(trace,[]);assert.deepEqual(sent,[]);
}));

test('approval for a different held action or tab is never reused for automatic sign-in',async()=>{
  await accessFixture(async({slice,trace,sent})=>{
    let needs=await slice([wallEvent(),accessEvent('aside_click',{held:true,askId:91,question:'Create Reports?'},{targetId:'tab-27',ref:'r8'})]);
    assert.equal(needs[0].askId,91);
    needs=await slice([wallEvent()]);assert.equal(needs[0].status,'held');assert.deepEqual(trace,[]);assert.deepEqual(sent,[]);
  });
  await accessFixture(async({slice,trace})=>{
    await slice([wallEvent()],async()=>({held:true,askId:91,question:'Sign in on this tab?'}));
    await slice([accessEvent('aside_read',{...accessWall,targetId:'different-tab'},{url:accessTarget})]);
    assert.equal(trace.length,1,'do not carry the prior tab approval to another tab');
  });
});

test('a person recovery reply still requires a fresh protected-target read before clearing the need',async()=>accessFixture(async({slice,asks,trace})=>{
  const needs=await slice([wallEvent()],async()=>({...accessWall,action:{committed:true,signedIn:false},asideAgent:'BLOCKED: An SMS code is required.'}));
  await asks.answer(needs[0].askId,'signed in');
  let pending=await slice([accessEvent('aside_tabs',{tabs:[{url:accessTarget}]})]);
  assert.equal(pending.length,1,'a reply and a tab title are not verification');
  pending=await slice([accessEvent('aside_read',accessPage,{url:accessTarget})]);
  assert.deepEqual(pending,[]);assert.equal(trace.filter(t=>t[0]==='aside_sign_in').length,1);
}));


test('a held sign-in approval cannot follow a tab to another host',async()=>accessFixture(async({slice,trace})=>{
  await slice([wallEvent()],async()=>({held:true,askId:91,question:'Sign in to PostHog?'}));
  const wall={...accessWall,url:'https://accounts.google.com/login',accessBlocked:{kind:'sign_in',host:'accounts.google.com',url:'https://accounts.google.com/login'}};
  const needs=await slice([accessEvent('aside_read',wall,{url:accessTarget})]);
  assert.equal(needs[0].host,'accounts.google.com');assert.equal(needs[0].status,'held');
  assert.equal(trace.length,1,'the original approval is not authorization for a different host');
}));
