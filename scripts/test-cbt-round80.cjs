const assert=require('node:assert/strict'),path=require('node:path'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
require('reflect-metadata');
const {migrate}=require('../dist/src/db/migrator'),{DbService}=require('../dist/src/db/db.service'),{CbtService}=require('../dist/src/cbt/cbt.service'),{CbtRepository}=require('../dist/src/cbt/cbt.repository'),{AttemptsRepository}=require('../dist/src/attempts/attempts.repository');
(async()=>{
 const pool=new Pool({host:'127.0.0.1',port:55462,user:'postgres',database:'cbt_round80_v2_test'});
 // Dedicated newly-created container/database only; never uses .env or production.
 const db=Object.create(DbService.prototype);db.pool=pool;
 let time=Date.parse('2026-11-07T14:00:00Z'),clock={now:()=>new Date(time)};
 const service=new CbtService(clock,db,new CbtRepository(),new AttemptsRepository(),{verify:async()=>{},read:async()=>Buffer.from('synthetic')});
 try{
 assert.equal((await pool.query('SELECT current_database() n')).rows[0].n,'cbt_round80_v2_test');
 assert.equal((await pool.query("SELECT count(*)::int n FROM pg_namespace WHERE nspname='hanq'")).rows[0].n,0);
 await migrate(pool,path.resolve(__dirname,'../migrations'));
 const user=randomUUID();await pool.query("INSERT INTO hanq.users(id,email_normalized,email_display,password_hash,display_name,created_at,updated_at,password_changed_at) VALUES($1,'synthetic@test.invalid','synthetic@test.invalid','$argon2id$synthetic','Synthetic',$2,$2,$2)",[user,new Date(time)]);
 await pool.query("INSERT INTO hanq.owned_digimon(user_id,family,xp,stage,equipped,first_partner) VALUES($1,'agumon',0,0,true,true)",[user]);
 for(let n=1;n<=50;n++){let id='exam-80-'+String(n).padStart(2,'0'),options=[1,2,3,4,5].map(i=>id+'-option-'+i);await pool.query("INSERT INTO hanq.question_versions(question_id,version,kind,is_current,exam_round,exam_number,points,option_ids,correct_option_id,public_payload,review_payload,content_hash,seeded_at) VALUES($1,'synthetic','mock',true,80,$2,2,$3,$4,'{}','{}',$5,$6)",[id,n,options,options[0],'0'.repeat(64),new Date(time)]);}

 const before=(await pool.query("SELECT md5(string_agg(row_to_json(q)::text,'' ORDER BY question_id,version)) h FROM hanq.question_versions q")).rows;

 assert.deepEqual((await pool.query("SELECT md5(string_agg(row_to_json(q)::text,'' ORDER BY question_id,version)) h FROM hanq.question_versions q")).rows,before);
 const make=async()=>{const r=await service.create(user,{round:80,idempotencyKey:randomUUID()}),token=randomUUID();const d=await service.claim(user,r.run.id,token);return{id:r.run.id,token,d};};
 const answers=(value)=>Array.from({length:50},(_,position)=>({position,optionId:value?'exam-80-'+String(position+1).padStart(2,'0')+'-option-'+value:null}));
 const cp=(v=1,value=1)=>({version:v,currentPosition:0,answers:answers(value)});
 const counts=async()=>{const r=await pool.query("SELECT (SELECT count(*) FROM hanq.attempts)::int attempts,(SELECT count(*) FROM hanq.growth_ledger)::int ledger");return r.rows[0];};

 const key=randomUUID();const [first,second]=await Promise.all([service.create(user,{round:80,idempotencyKey:key}),service.create(user,{round:80,idempotencyKey:randomUUID()})]);assert.equal(first.run.id,second.run.id);
 let r=await make();const deadline=r.d.run.endsAt;assert.equal(r.id,first.run.id);assert.equal(r.d.run.progressPolicy,'automatic-restore-v1');
 await service.checkpoint(user,r.id,cp(),r.token);assert.deepEqual(await counts(),{attempts:0,ledger:0});
 assert.equal((await service.get(user,r.id)).run.status,'active');
 const newToken=randomUUID();let restored=await service.claim(user,r.id,newToken);assert.equal(restored.run.endsAt,deadline);assert.equal(restored.run.checkpointVersion,1);assert.equal(restored.items[0].selectedOptionId,answers(1)[0].optionId);
 await assert.rejects(service.checkpoint(user,r.id,cp(2,2),r.token),e=>e.code==='attempt_session_required');
 r.token=newToken;await service.checkpoint(user,r.id,{...cp(3,1),currentPosition:17},r.token);
 await assert.rejects(service.checkpoint(user,r.id,cp(2,2),r.token),e=>e.code==='checkpoint_conflict');
 restored=await service.get(user,r.id);assert.equal(restored.run.currentPosition,17);
 await service.abandon(user,r.id,'reload',randomUUID());assert.equal((await service.get(user,r.id)).run.status,'active');assert.deepEqual(await counts(),{attempts:0,ledger:0});
 assert.equal((await service.create(user,{round:80,idempotencyKey:randomUUID()})).run.id,r.id);
 await assert.rejects(service.pause(user,r.id,false),e=>e.code==='pause_not_allowed');
 await assert.rejects(service.submit(user,r.id,{answers:answers(2)},r.token),e=>e.code==='checkpoint_required');
 let done=await service.submit(user,r.id,{},r.token);assert.equal(done.run.result.score,100);await service.submit(user,r.id,{},r.token);assert.deepEqual(await counts(),{attempts:50,ledger:1});
 r=await make();await service.checkpoint(user,r.id,cp(1,2),r.token);time+=4800001;
 await assert.rejects(service.checkpoint(user,r.id,cp(2,1),r.token),e=>e.code==='run_closed');
 done=await service.claim(user,r.id,randomUUID());assert.equal(done.run.status,'final');assert.equal(done.run.result.score,0);assert.equal(done.run.finalReason,'expired');
 r=await make();await service.checkpoint(user,r.id,cp(),r.token);time+=4800001;await service.list(user);assert.equal((await service.get(user,r.id)).run.result.score,100);assert.deepEqual(await counts(),{attempts:150,ledger:3});
 r=await make();await pool.query("UPDATE hanq.cbt_runs SET status='incomplete',incomplete_at=$2,incomplete_reason='synthetic-existing' WHERE id=$1",[r.id,new Date(time)]);const oldIncomplete=(await pool.query('SELECT to_jsonb(r) val FROM hanq.cbt_runs r WHERE id=$1',[r.id])).rows[0].val;assert.equal((await service.claim(user,r.id,randomUUID())).run.status,'incomplete');assert.deepEqual((await pool.query('SELECT to_jsonb(r) val FROM hanq.cbt_runs r WHERE id=$1',[r.id])).rows[0].val,oldIncomplete);
 r=await make();await pool.query("UPDATE hanq.cbt_runs SET attempt_policy='legacy' WHERE id=$1",[r.id]);const rawBefore=(await pool.query('SELECT to_jsonb(r) val FROM hanq.cbt_runs r WHERE id=$1',[r.id])).rows[0].val;
 assert.equal((await service.claim(user,r.id,randomUUID())).run.status,'incomplete');await service.list(user);assert.deepEqual((await pool.query('SELECT to_jsonb(r) val FROM hanq.cbt_runs r WHERE id=$1',[r.id])).rows[0].val,rawBefore);assert.deepEqual(await counts(),{attempts:150,ledger:3});
 assert(require('../dist/src/cbt/cbt-policy').CBT_ROUNDS.includes(80));
 const {CbtReviewService}=require('../dist/src/cbt/cbt-review.service'); const reviews=new CbtReviewService(db,clock,{verify:async()=>{}}); const review=await reviews.create(user,{round:80,selection:'exam-wrong-only',idempotencyKey:randomUUID()}); assert.equal(review.run.round,80); await reviews.start(user,review.run.id);
 console.log('PASS round80 constraint expansion + existing-question hash preservation + actual80 create/claim/save/reload/submit/timeout/retry + wrong review start. Automatic restore: simultaneous ready/active reuse, claim token rotation, saved answers/position/version/deadline preserved, old-tab writes rejected, v3 before v2, stale abandon no-op, no pause, deadline saved-only, list expiry grading, legacy/incomplete immutable, round80 preserved');
 }finally{await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1});