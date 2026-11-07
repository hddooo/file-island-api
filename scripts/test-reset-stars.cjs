const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
require('reflect-metadata');
const {migrate}=require('../dist/src/db/migrator'),{DbService}=require('../dist/src/db/db.service'),{CbtService}=require('../dist/src/cbt/cbt.service'),{CbtRepository}=require('../dist/src/cbt/cbt.repository'),{AttemptsRepository}=require('../dist/src/attempts/attempts.repository');
(async()=>{
 const pool=new Pool({connectionString:process.env.HANQ_TEST_DATABASE_URL});
 // Dedicated newly-created container/database only; never uses .env or production.
 const db=Object.create(DbService.prototype);db.pool=pool;
 let time=Date.parse('2026-11-07T14:00:00Z'),clock={now:()=>new Date(time)};
 const service=new CbtService(clock,db,new CbtRepository(),new AttemptsRepository(),{verify:async()=>{},read:async()=>Buffer.from('synthetic')});
 try{
 assert.equal((await pool.query('SELECT current_database() n')).rows[0].n,'reset_stars_test');
 await pool.query('DROP SCHEMA IF EXISTS hanq CASCADE');
 await migrate(pool,path.resolve('migrations'));
 const user=randomUUID();await pool.query("INSERT INTO hanq.users(id,email_normalized,email_display,password_hash,display_name,created_at,updated_at,password_changed_at) VALUES($1,'synthetic@test.invalid','synthetic@test.invalid','$argon2id$synthetic','Synthetic',$2,$2,$2)",[user,new Date(time)]);
 await pool.query("INSERT INTO hanq.owned_digimon(user_id,family,xp,stage,equipped,first_partner) VALUES($1,'agumon',0,0,true,true)",[user]);
 for(let n=1;n<=50;n++){let id='exam-79-'+String(n).padStart(2,'0'),options=[1,2,3,4,5].map(i=>id+'-option-'+i);await pool.query("INSERT INTO hanq.question_versions(question_id,version,kind,is_current,exam_round,exam_number,points,option_ids,correct_option_id,public_payload,review_payload,content_hash,seeded_at) VALUES($1,'synthetic','mock',true,79,$2,2,$3,$4,'{}','{}',$5,$6)",[id,n,options,options[0],'0'.repeat(64),new Date(time)]);}
 const make=async()=>{const r=await service.create(user,{round:79,idempotencyKey:randomUUID()}),token=randomUUID();const d=await service.claim(user,r.run.id,token);return{id:r.run.id,token,d};};
 const answers=(value)=>Array.from({length:50},(_,position)=>({position,optionId:value?'exam-79-'+String(position+1).padStart(2,'0')+'-option-'+value:null}));
 const cp=(v=1,value=1)=>({version:v,currentPosition:0,answers:answers(value)});
 const counts=async()=>{const r=await pool.query("SELECT (SELECT count(*) FROM hanq.attempts)::int attempts,(SELECT count(*) FROM hanq.growth_ledger)::int ledger");return r.rows[0];};


 const {CbtReviewService}=require('../dist/src/cbt/cbt-review.service'),{requestLearningReset}=require('../dist/src/profile/learning-resets');
 const reviews=new CbtReviewService(db,clock,{read:async()=>Buffer.from('synthetic')});
 const r=await make();await service.checkpoint(user,r.id,cp(),r.token);await service.submit(user,r.id,{},r.token);
 const before=await reviews.stars(user,r.id,'exam');assert.equal(before.resetAt,null);
 await reviews.saveStar(user,r.id,'exam',{signature:before.signature,position:0,starred:true,resetAt:null});
 const oldReview=await reviews.create(user,{round:79,idempotencyKey:randomUUID()});
 const other=randomUUID();await pool.query("INSERT INTO hanq.users(id,email_normalized,email_display,password_hash,display_name,created_at,updated_at,password_changed_at) VALUES($1,'other@test.invalid','other@test.invalid','$argon2id$synthetic','Other',$2,$2,$2)",[other,clock.now()]);
 await pool.query("INSERT INTO hanq.cbt_question_stars(user_id,question_id,version,starred,updated_at) VALUES($1,'exam-79-01','synthetic',true,$2)",[other,clock.now()]);
 const starsSnapshot=(await pool.query('SELECT * FROM hanq.cbt_question_stars ORDER BY user_id,question_id')).rows;
 const xp=(await pool.query('SELECT * FROM hanq.growth_ledger ORDER BY event_key')).rows;
 time+=1000;const reset=await db.tx(q=>requestLearningReset(q,user,'history','RESET_HISTORY',randomUUID(),clock.now));
 const after=await reviews.stars(user,r.id,'exam');assert.ok(after.flags.every(x=>!x));assert.equal(after.resetAt,reset.history.resetAt);
 assert.deepEqual((await pool.query('SELECT * FROM hanq.cbt_question_stars ORDER BY user_id,question_id')).rows,starsSnapshot);
 await assert.rejects(reviews.create(user,{round:79,idempotencyKey:randomUUID()}),e=>e.code==='review_empty');
 await assert.rejects(reviews.get(user,oldReview.run.id),e=>e.getStatus()===404);assert.equal((await reviews.list(user)).reviews.length,0);
 const flags=Array(50).fill(true);await reviews.importStars(user,r.id,'exam',{signature:after.signature,flags});assert.ok((await reviews.stars(user,r.id,'exam')).flags.every(x=>!x));
 await assert.rejects(reviews.saveStar(user,r.id,'exam',{signature:after.signature,position:0,starred:true,resetAt:null}),e=>e.code==='learning_reset_changed');
 assert.deepEqual((await pool.query('SELECT * FROM hanq.cbt_question_stars ORDER BY user_id,question_id')).rows,starsSnapshot);
 assert.equal((await pool.query("SELECT hanq.wrong_history_visible(user_id,'history',updated_at) visible FROM hanq.cbt_question_stars WHERE user_id=$1",[other])).rows[0].visible,true);
 time+=1000;await reviews.saveStar(user,r.id,'exam',{signature:after.signature,position:0,starred:true,resetAt:after.resetAt});assert.equal((await reviews.stars(user,r.id,'exam')).flags[0],true);
 assert.equal((await reviews.create(user,{round:79,idempotencyKey:randomUUID()})).items.length,1);
 assert.deepEqual((await pool.query('SELECT * FROM hanq.growth_ledger ORDER BY event_key')).rows,xp);
 console.log('PASS stars cutoff, historical row/XP preservation, owner isolation, blocked legacy import/stale-save, new star and review, old review hidden');
 }finally{await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1});
