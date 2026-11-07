import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {after,before,it} from 'node:test';
import type {Pool} from 'pg';
import request from 'supertest';
import {bearer,signup,startApp,type TestApp} from '../helpers/app';
import {freshDatabase,sampleQuestions} from '../helpers/db';
import {testConfig} from '../helpers/env';
let t:TestApp,pool:Pool;
before(async()=>{pool=await freshDatabase(testConfig());t=await startApp();});
after(async()=>{await t?.close();await pool?.end();});
it('owner/island reset is non-destructive, idempotent, XP-preserving and blocks stale wrong imports',async()=>{
 const a=await signup(t),b=await signup(t),{quiz,wrongOf}=sampleQuestions();
 const old=t.clock.now().getTime()-1000, q=quiz[0];
 async function put(owner:typeof a,optionId:string,ts:number=old){
  return request(t.server).post('/api/v1/imports/local-attempts').set(bearer(owner.access)).send({importKey:randomBytes(24).toString('base64url'),entries:[{localId:'a'+randomBytes(7).toString('hex'),mode:'quiz',questionId:q.questionId,contentVersion:q.version,optionId,ts}]});
 }
 assert.equal((await put(a,wrongOf(q))).body.imported,1);
 assert.equal((await put(a,q.correctOptionId)).body.imported,1);
 assert.equal((await put(b,wrongOf(q))).body.imported,1);
 const xp=await pool.query('SELECT * FROM hanq.growth_ledger ORDER BY user_id,event_key');
 const id=randomUUID(),body={island:'history',confirmation:'RESET_HISTORY',requestId:id};
 assert.equal((await request(t.server).post('/api/v1/me/learning-resets').send(body)).status,401);
 assert.equal((await request(t.server).post('/api/v1/me/learning-resets').set(bearer(a.access)).send({...body,userId:b.userId})).status,400);
 const reset=await request(t.server).post('/api/v1/me/learning-resets').set(bearer(a.access)).send(body);
 assert.equal(reset.status,200,JSON.stringify(reset.body));assert.equal(reset.body.scope,'wrong_answers_only');
 assert.equal(reset.body.toeic.resetAt,null);assert.ok(reset.body.history.resetAt);
 assert.equal((await request(t.server).post('/api/v1/me/learning-resets').set(bearer(a.access)).send(body)).body.replayed,true);
 assert.equal((await request(t.server).post('/api/v1/me/learning-resets').set(bearer(a.access)).send({...body,island:'toeic',confirmation:'RESET_TOEIC'})).status,409);
 assert.equal((await pool.query('SELECT * FROM hanq.attempts WHERE user_id=$1',[a.userId])).rowCount,2);
 const visible=await pool.query('SELECT correct FROM hanq.visible_wrong_attempts WHERE user_id=$1',[a.userId]);assert.deepEqual(visible.rows,[{correct:true}]);
 assert.equal((await pool.query('SELECT * FROM hanq.visible_wrong_attempts WHERE user_id=$1',[b.userId])).rowCount,1);
 assert.deepEqual((await pool.query('SELECT * FROM hanq.growth_ledger ORDER BY user_id,event_key')).rows,xp.rows);
 assert.equal((await put(a,wrongOf(q))).body.skipped[0].reason,'before-wrong-history-reset');
 assert.equal((await put(a,q.correctOptionId)).body.imported,1,'correct offline entries survive');
 assert.equal((await pool.query("SELECT hanq.wrong_history_visible($1,'toeic',$2) visible",[a.userId,new Date(old)])).rows[0].visible,true);
 assert.equal((await pool.query("SELECT hanq.wrong_history_visible($1,'history',$2) visible",[a.userId,new Date(old)])).rows[0].visible,false);
});

it('English wrong history disappears while correct answers/source and other user remain',async()=>{
 const a=await signup(t),b=await signup(t),id=randomUUID(),at=t.clock.now();
 const content={questions:[{number:1,part:5,groupId:'g1',stem:'Synthetic question',choices:[{id:'A',text:'A'},{id:'B',text:'B'}],correctOptionId:'A',answerVerified:true}],groups:[{id:'g1',questionNumbers:[1]}],wrongNumbers:[1]};
 await pool.query('INSERT INTO hanq.toeic_cbt_collections(id,user_id,source_key,version,title,content) VALUES($1,$2,$3,$4,$5,$6)',[id,a.userId,'synthetic','v1','Synthetic',JSON.stringify(content)]);
 for(const [opt,correct] of [['B',false],['A',true]] as const)await pool.query('INSERT INTO hanq.toeic_cbt_practice_answers(id,user_id,collection_id,question_number,selected_option,answer_verified,correct,request_key,created_at) VALUES($1,$2,$3,1,$4,true,$5,$6,$7)',[randomUUID(),a.userId,id,opt,correct,randomUUID(),at]);
 const before=await request(t.server).get('/api/v1/me/records?subject=toeic').set(bearer(a.access));assert.equal(before.body.total,2,JSON.stringify(before.body));
 const reset=await request(t.server).post('/api/v1/me/learning-resets').set(bearer(a.access)).send({island:'toeic',confirmation:'RESET_TOEIC',requestId:randomUUID()});
 assert.equal(reset.status,200);assert.equal(reset.body.history.resetAt,null);
 const after=await request(t.server).get('/api/v1/me/records?subject=toeic').set(bearer(a.access));assert.equal(after.body.total,1);assert.equal(after.body.items[0].detail.correct,true);
 assert.equal((await pool.query('SELECT * FROM hanq.toeic_cbt_practice_answers WHERE user_id=$1',[a.userId])).rowCount,2);
 assert.deepEqual((await pool.query('SELECT content FROM hanq.toeic_cbt_collections WHERE id=$1',[id])).rows[0].content,content);
 const {loadStudyHistory}=await import('../../src/toeic-cbt/history');
 const client=await pool.connect();try{const h=await loadStudyHistory(client,a.userId);assert.equal(h.get('synthetic\0'+'1')?.everWrong,false);assert.deepEqual(h.get('synthetic\0'+'1')?.recentResults,[true]);}finally{client.release();}
 assert.equal((await request(t.server).get('/api/v1/me/learning-resets').set(bearer(b.access))).body.toeic.resetAt,null);
});

it('completed-exam notebook 76 old wrong questions honors the already-saved reset, without deleting source or XP',async()=>{
 const a=await signup(t),b=await signup(t),now=t.clock.now(),old=new Date(now.getTime()-10000);
 const questions=(await pool.query('SELECT question_id,version,exam_round,exam_number,points,option_ids,correct_option_id FROM hanq.question_versions WHERE is_current AND kind=\'mock\' AND exam_round IN(78,79) ORDER BY exam_round,exam_number')).rows;
 assert.equal(questions.length,100);
 async function seed(owner:string,at:Date,onlyOne=false){let n=0;
  for(const round of onlyOne?[78]:[78,79]){const id=randomUUID();await pool.query("INSERT INTO hanq.cbt_runs(id,user_id,idempotency_key,exam_round,status,duration_ms,created_at,updated_at,started_at,ends_at,final_at,final_reason,result) VALUES($1,$2,$3,$4,'final',4800000,$5,$5,$5,$5::timestamptz+interval '80 minutes',$5::timestamptz+interval '1 second','submit','{}')",[id,owner,randomUUID(),round,at]);
   const picked=questions.filter(q=>q.exam_round===round).slice(0,onlyOne?1:50);
   for(const q of picked){const wrong=onlyOne||n++<76;await pool.query('INSERT INTO hanq.cbt_run_items(run_id,user_id,position,question_id,version,exam_number,points,option_ids,answer_option_id,answered_at,correct) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,owner,q.exam_number-1,q.question_id,q.version,q.exam_number,q.points,q.option_ids,wrong?q.option_ids.find((x:string)=>x!==q.correct_option_id):q.correct_option_id,at,!wrong]);}
  }
 }
 await seed(a.userId,old);await seed(b.userId,old);
 const get=(s:typeof a)=>request(t.server).get('/api/v1/cbt/notebook').set(bearer(s.access));
 assert.equal((await get(a)).body.items.length,76);
 const xp=(await pool.query('SELECT * FROM hanq.growth_ledger WHERE user_id=$1 ORDER BY event_key',[a.userId])).rows;
 const reset=await request(t.server).post('/api/v1/me/learning-resets').set(bearer(a.access)).send({island:'history',confirmation:'RESET_HISTORY',requestId:randomUUID()});assert.equal(reset.status,200);
 const resetBefore=(await pool.query('SELECT * FROM hanq.wrong_history_resets WHERE user_id=$1',[a.userId])).rows;
 assert.equal((await get(a)).body.items.length,0,'existing reset must apply at read time');
 assert.equal((await get(a)).body.items.length,0,'refresh must not resurrect old questions');
 assert.equal((await get(b)).body.items.length,76,'other owner remains unchanged');
 assert.equal((await pool.query('SELECT * FROM hanq.cbt_run_items WHERE user_id=$1',[a.userId])).rowCount,100);
 assert.equal((await pool.query('SELECT * FROM hanq.cbt_run_items WHERE user_id=$1 AND correct',[a.userId])).rowCount,24);
 assert.deepEqual((await pool.query('SELECT * FROM hanq.growth_ledger WHERE user_id=$1 ORDER BY event_key',[a.userId])).rows,xp);
 assert.deepEqual((await pool.query('SELECT * FROM hanq.wrong_history_resets WHERE user_id=$1',[a.userId])).rows,resetBefore);
 await seed(a.userId,new Date(now.getTime()+1000),true);
 assert.equal((await get(a)).body.items.length,1,'new wrong after reset still appears');
});
