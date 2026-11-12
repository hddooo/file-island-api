// Run only in an ephemeral, network-disabled container sharing its test PostgreSQL Unix socket.
// No DATABASE_URL, production config, account credentials or application bootstrap are read.
const assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {Pool}=require('pg');
const {History81Service}=require('../dist/src/textbook/history81.service');
const {HISTORY81_PDF,projectHistory81}=require('../dist/src/textbook/history81-quiz');
const pool=new Pool({host:'/pgsocket',user:'postgres',database:'postgres',max:5,connectionTimeoutMillis:5000});
const hash=s=>createHash('sha256').update(s).digest('hex');
async function main(){
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name='hanq'")).rows[0].n,0,'Requires an empty isolated DB');
 await pool.query('CREATE SCHEMA hanq; CREATE TABLE hanq.users(id uuid PRIMARY KEY); CREATE TABLE hanq.source_blank_workspaces(user_id uuid REFERENCES hanq.users(id),quiz_id text,source_version text,revision integer NOT NULL CHECK(revision>0),workspace jsonb NOT NULL,mutation_id uuid NOT NULL,mutation_hash text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,quiz_id,source_version));');
 const a=randomUUID(),b=randomUUID();await pool.query('INSERT INTO hanq.users VALUES($1),($2)',[a,b]);
 const legacy={cursor:2,status:'paused',responses:{original79:{values:['unchanged'],submitted:false,correct:null}}};
 await pool.query('INSERT INTO hanq.source_blank_workspaces VALUES($1,$2,$3,7,$4,$5,$6,now())',[a,'goryeo','legacy79',legacy,randomUUID(),'legacy']);
 const original=(await pool.query('SELECT * FROM hanq.source_blank_workspaces')).rows;
 const prompt='(1) Synthetic test (   )',answer='fixture',markdown=prompt+'\n'+answer,range=(start,end)=>({start,end,sha256:hash(markdown.slice(start,end))});
 const bundle={source:{sha256:hash(markdown)},segments:[{id:'fixture',markdown}]},recipe={id:'q1',group:'group',number:1,page:50,prompt:range(0,prompt.length),answer:range(prompt.length+1,markdown.length),fields:[{id:'f1'}],options:[]};
 const db={pool,tx:async run=>{const client=await pool.connect();try{await client.query('BEGIN');const result=await run(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}};
 function service(){const s=new History81Service(db,{},{});s.quiz=async(rev,era)=>{assert.equal(rev,HISTORY81_PDF);return projectHistory81(era,bundle,[recipe]);};return s;}
 const s=service(),quiz=await s.quiz(HISTORY81_PDF,'goryeo'),batch=()=>({version:quiz.version,revision:0,mutationId:randomUUID(),cursor:0,status:'active',updates:[{itemId:quiz.items[0].id,values:['fixture'],submitted:true}]});
 assert.deepEqual((await s.get(a,HISTORY81_PDF,'goryeo')).workspace.responses,{});
 const one=batch(),two=batch(),races=await Promise.allSettled([s.save(a,HISTORY81_PDF,'goryeo',one),s.save(a,HISTORY81_PDF,'goryeo',two)]);
 assert.equal(races.filter(r=>r.status==='fulfilled').length,1);assert.equal(races.find(r=>r.status==='rejected').reason.code,'source_progress_conflict');
 const winner=races[0].status==='fulfilled'?one:two,saved=await s.get(a,HISTORY81_PDF,'goryeo');assert.equal(saved.revision,1);assert.equal(Object.values(saved.workspace.responses)[0].correct,true);
 assert.deepEqual(await s.save(a,HISTORY81_PDF,'goryeo',winner),saved);
 await assert.rejects(s.save(a,HISTORY81_PDF,'goryeo',{...winner,status:'paused'}),{code:'source_progress_conflict'});
 assert.deepEqual((await s.get(b,HISTORY81_PDF,'goryeo')).workspace.responses,{});assert.deepEqual((await s.get(a,HISTORY81_PDF,'joseon')).workspace.responses,{});
 const paused=await s.save(a,HISTORY81_PDF,'goryeo',{...batch(),revision:1,status:'paused',updates:[{itemId:quiz.items[0].id,values:['unfinished'],submitted:false,checkedSlots:[false]}]});assert.equal(paused.revision,2);
 assert.deepEqual(await service().get(a,HISTORY81_PDF,'goryeo'),paused);
 // Additive selection lives in the same optimistic transaction, independently of graded slots.
 const selected={...batch(),revision:2,status:'paused',updates:[],selectedReviewQuestionIds:[quiz.items[0].id]};
 const marked=await s.save(a,HISTORY81_PDF,'goryeo',selected);assert.deepEqual(marked.workspace.responses,paused.workspace.responses);assert.deepEqual(marked.workspace.selectedReviewQuestionIds,[quiz.items[0].id]);
 assert.deepEqual(await s.save(a,HISTORY81_PDF,'goryeo',selected),marked);assert.deepEqual(await service().get(a,HISTORY81_PDF,'goryeo'),marked);
 assert.deepEqual((await s.get(b,HISTORY81_PDF,'goryeo')).workspace.selectedReviewQuestionIds,[]);assert.deepEqual((await s.get(a,HISTORY81_PDF,'joseon')).workspace.selectedReviewQuestionIds,[]);
 const oldPayload=await s.save(a,HISTORY81_PDF,'goryeo',{...batch(),revision:3,status:'paused',updates:[]});assert.deepEqual(oldPayload.workspace.selectedReviewQuestionIds,[quiz.items[0].id]);
 const unmarked=await s.save(a,HISTORY81_PDF,'goryeo',{...batch(),revision:4,status:'paused',updates:[],selectedReviewQuestionIds:[]});assert.deepEqual(unmarked.workspace.selectedReviewQuestionIds,[]);assert.deepEqual(unmarked.workspace.responses,paused.workspace.responses);
 assert.deepEqual((await pool.query('SELECT * FROM hanq.source_blank_workspaces WHERE source_version=$1',['legacy79'])).rows,original);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM hanq.source_blank_workspaces')).rows[0].n,2);
 console.log(JSON.stringify({isolatedPostgres:true,concurrentInsert:'one success / one conflict',retry:'idempotent',accountAndEraIsolation:true,legacyRowUnchanged:true,pauseResumeAcrossServiceInstances:true,reviewSelectionMarkUnmarkReload:true,oldPayloadPreservesSelection:true,answersAndMasksPreserved:true,productionAccess:false}));
}
main().finally(()=>pool.end()).catch(e=>{console.error(e.message);process.exitCode=1;});
