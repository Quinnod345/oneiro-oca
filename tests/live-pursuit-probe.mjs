// Explicit opt-in real subscription probe; never loaded by the test glob.
import pg from 'pg'; import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises'; import { join,resolve } from 'node:path';
import { createPonderQueue } from '../reasoning/ponder-queue.js';
import { createPursuitWork } from '../reasoning/pursuit-work.js';
const base=resolve(process.argv[2]); await mkdir(base,{recursive:true});
const source=join(base,'source');await mkdir(source,{recursive:true});
await writeFile(join(source,'directory.txt'),'Observed directory listing: alpha.png, beta.png, gamma.png.\n');
await writeFile(join(source,'inventory.md'),'Inventory draft: alpha.png, beta.png. Not submitted.\n');
const schema='oca_live_'+randomUUID().replaceAll('-','');const admin=new pg.Pool({connectionString:'postgres://localhost/oneiro'});let pool;
try{
 await admin.query(`CREATE SCHEMA ${schema}`);pool=new pg.Pool({connectionString:'postgres://localhost/oneiro',options:`-c search_path=${schema},public`});
 await pool.query(`CREATE TABLE thought_chains(id SERIAL PRIMARY KEY,seed TEXT,priority FLOAT8,status TEXT,depth INT DEFAULT 0,ponder_state JSONB,created_at TIMESTAMPTZ DEFAULT now(),updated_at TIMESTAMPTZ DEFAULT now())`);
 const queue=createPonderQueue({pool,reason:async()=>{throw Error('Only research is tested');}});
 const pursuit=await queue.enqueue({seed:`Resolve why this inventory draft is incomplete. Compare ${source}/inventory.md with ${source}/directory.txt. Read both files and quote them as sources.`,doneWhen:'The repaired inventory is independently checked against the listing.',learning:false});
 const work=createPursuitWork({pool,queue,root:join(base,'work'),sourceRoots:[source]});await work.init();
 const first=await work.enqueue(pursuit.chain_id,{requestId:randomUUID()});const start=Date.now();await work.runNext();
 const firstLog=await work.events(pursuit.chain_id,first.id);console.log(JSON.stringify({stage:'first',elapsedMs:Date.now()-start,run:firstLog.run,events:firstLog.events}));
 if(firstLog.run.status==='failed')throw Error(firstLog.run.error);
 const second=await work.enqueue(pursuit.chain_id,{requestId:randomUUID(),instruction:'Continue from your saved research. Write repaired-inventory.md in your work directory including the missing filename. Do not claim independent verification or submission. Cite the original unchanged sources again.'});
 await work.runNext();const secondLog=await work.events(pursuit.chain_id,second.id);const saved=await queue.get(pursuit.chain_id);
 console.log(JSON.stringify({stage:'resume',run:secondLog.run,events:secondLog.events,evidence:saved.evidence,progress:saved.want.progress,outcomes:saved.want.receipts}));
 if(secondLog.run.status==='failed'||saved.evidence.length<2||saved.want.progress!==0)throw Error('The live research acceptance conditions did not pass');
}finally{if(pool)await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
