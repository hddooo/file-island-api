const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
require('reflect-metadata');
const {migrate}=require('../dist/src/db/migrator'),{DbService}=require('../dist/src/db/db.service'),{CbtService}=require('../dist/src/cbt/cbt.service'),{CbtRepository}=require('../dist/src/cbt/cbt.repository'),{AttemptsRepository}=require('../dist/src/attempts/attempts.repository');
(async()=>{
 const pool=new Pool({host:'127.0.0.1',port:55462,user:'postgres',database:'cbt_uninterrupted_test'});
 // Dedicated newly-created container/database only; never uses .env or production.
 const db=Object.create(DbService.prototype);db.pool=pool;
 let time=Date.parse('2026-11-07T14:00:00Z'),clock={now:()=>new Date(time)};
 const service=new CbtService(clock,db,new CbtRepository(),new AttemptsRepository(),{verify:async()=>{},read:async()=>Buffer.from('synthetic')});
 try{
 await migrate(pool,path.resolve('migrations'));
 const user=randomUUID();await pool.query("INSERT INTO hanq.users(id,email_normalized,email_display,password_hash,display_name,created_at,updated_at,password_changed_at) VALUES($1,'synthetic@test.invalid','synthetic@test.invalid','$argon2id$synthetic','Synthetic',$2,$2,$2)",[user,new Date(time)]);
 await pool.query("INSERT INTO hanq.owned_digimon(user_id,family,xp,stage,equipped,first_partner) VALUES($1,'agumon',0,0,true,true)",[user]);
 for(let n=1;n<=50;n++){let id='exam-79-'+String(n).padStart(2,'0'),options=[1,2,3,4,5].map(i=>id+'-option-'+i);await pool.query("INSERT INTO hanq.question_versions(question_id,version,kind,is_current,exam_round,exam_number,points,option_ids,correct_option_id,public_payload,review_payload,content_hash,seeded_at) VALUES($1,'synthetic','mock',true,79,$2,2,$3,$4,'{}','{}',$5,$6)",[id,n,options,options[0],'0'.repeat(64),new Date(time)]);}
 const make=async()=>{const r=await service.create(user,{round:79,idempotencyKey:randomUUID()}),token=randomUUID();const d=await service.start(user,r.run.id,token);return{id:r.run.id,token,d};};
 const answers=(value)=>Array.from({length:50},(_,position)=>({position,optionId:value?'exam-79-'+String(position+1).padStart(2,'0')+'-option-'+value:null}));
 const cp=(v=1,value=1)=>({version:v,currentPosition:0,answers:answers(value)});
 const counts=async()=>{const r=await pool.query("SELECT (SELECT count(*) FROM hanq.attempts)::int attempts,(SELECT count(*) FROM hanq.growth_ledger)::int ledger");return r.rows[0];};
 let r=await make();const deadline=r.d.run.endsAt;assert.equal(r.d.run.attemptPolicy,'uninterrupted-v1');
 assert.equal((await service.start(user,r.id,r.token)).run.endsAt,deadline);
 assert.notEqual((await pool.query('SELECT attempt_token_hash FROM hanq.cbt_runs WHERE id=$1',[r.id])).rows[0].attempt_token_hash,r.token);
 await assert.rejects(service.get(user,r.id,randomUUID()),e=>e.code==='attempt_session_required');
 await service.checkpoint(user,r.id,cp(),r.token);await service.checkpoint(user,r.id,cp(),r.token);
 await assert.rejects(service.checkpoint(user,r.id,cp(1,2),r.token),e=>e.code==='checkpoint_conflict');
 await assert.rejects(service.pause(user,r.id,false),e=>e.code==='pause_not_allowed');
 await assert.rejects(service.submit(user,r.id,{answers:answers(2)},r.token),e=>e.code==='checkpoint_required');
 let done=await service.submit(user,r.id,{},r.token);assert.equal(done.run.status,'final');assert.equal(done.run.result.score,100);
 await service.submit(user,r.id,{},r.token);assert.deepEqual(await counts(),{attempts:50,ledger:1});
 r=await make();await service.checkpoint(user,r.id,cp(1,2),r.token);const before=await counts();
 assert.equal((await service.get(user,r.id)).run.status,'incomplete');assert.deepEqual(await counts(),before);
 await assert.rejects(service.image(user,r.id,0,'question',r.token));
 r=await make();await service.abandon(user,r.id,'leave',r.token);assert.deepEqual(await counts(),before);
 r=await make();await service.checkpoint(user,r.id,cp(),r.token);time+=4800001;
 await assert.rejects(service.checkpoint(user,r.id,cp(2,2),r.token),e=>e.code==='run_closed');
 done=await service.get(user,r.id);assert.equal(done.run.result.score,100);assert.equal(done.run.finalReason,'expired');
 assert.deepEqual(await counts(),{attempts:100,ledger:2});
 r=await make();time+=4800001;const snapshot=await counts();await service.list(user);
 assert.equal((await service.get(user,r.id)).run.status,'incomplete');assert.deepEqual(await counts(),snapshot);
 r=await make();await pool.query("UPDATE hanq.cbt_runs SET attempt_policy='legacy' WHERE id=$1",[r.id]);const rawBefore=(await pool.query('SELECT to_jsonb(r) val FROM hanq.cbt_runs r WHERE id=$1',[r.id])).rows[0].val;
 assert.equal((await service.get(user,r.id)).run.status,'incomplete');await service.list(user);
 assert.deepEqual((await pool.query('SELECT to_jsonb(r) val FROM hanq.cbt_runs r WHERE id=$1',[r.id])).rows[0].val,rawBefore);
 assert.deepEqual(await counts(),snapshot);
 console.log('PASS: migration, token hash, idempotent start/checkpoint, sequence conflict, no pause, submit saved-only, final immutable/idempotent, abandon/no-token incomplete no XP, deadline saved-only, orphan no XP, legacy row unchanged');
 }finally{await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1});