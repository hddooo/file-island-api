import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after,before,describe,it } from 'node:test';
import type { Pool } from 'pg';
import request from 'supertest';
import { bearer,signin,signup,startApp,type Session,type TestApp } from '../helpers/app';
import { freshDatabase } from '../helpers/db';
import { testConfig } from '../helpers/env';

describe('CBT server stars and partial reviews: isolated DB only',()=>{
 let pool:Pool,t:TestApp,A:Session,B:Session,full:string,signature:string,review:string;
 let questions:{question_id:string;version:string;option_ids:string[];correct_option_id:string}[];
 const api=()=>request(t.server);
 const post=(path:string,body:object,s=A)=>api().post('/api/v1/cbt'+path).set(bearer(s.access)).send(body);
 const get=(path:string,s=A)=>api().get('/api/v1/cbt'+path).set(bearer(s.access));
 const wrong=(n:number)=>questions[n].option_ids.find(x=>x!==questions[n].correct_option_id)!;
 const star=(position:number,starred:boolean)=>post('/runs/'+full+'/stars',{signature,position,starred});
 const makeReview=()=>post('/reviews',{round:79,idempotencyKey:randomUUID()});
 before(async()=>{
  pool=await freshDatabase(testConfig());const dir=mkdtempSync(join(tmpdir(),'hanq-review-assets-'));
  for(let n=1;n<=50;n++){const body=Buffer.from('WEBPVP8Ltest');const size=Buffer.alloc(4);size.writeUInt32LE(body.length);writeFileSync(join(dir,`79-${String(n).padStart(2,'0')}.webp`),Buffer.concat([Buffer.from('RIFF'),size,body]));}
  t=await startApp({HANQ_CBT_ASSET_DIR:dir});A=await signup(t);B=await signup(t);
  questions=(await pool.query('SELECT question_id,version,option_ids,correct_option_id FROM hanq.question_versions WHERE is_current AND exam_round=79 ORDER BY exam_number')).rows;
  const r=await post('/runs',{round:79,idempotencyKey:randomUUID(),answerMode:'batch'});assert.equal(r.status,201);full=r.body.run.id;
  const s=await get('/runs/'+full+'/stars');assert.equal(s.status,200);signature=s.body.signature;
 });
 after(async()=>{if(t)await t.close();if(pool)await pool.end();});
 it('auth, exact owner and exact question/version/option order are required',async()=>{
  assert.equal((await api().get('/api/v1/cbt/runs/'+full+'/stars')).status,401);
  assert.equal((await get('/runs/'+full+'/stars',B)).status,404);
  assert.equal((await post('/runs/'+full+'/stars',{signature,position:0,starred:true},B)).status,404);
  assert.equal((await post('/runs/'+full+'/stars',{signature:signature+'x',position:0,starred:true})).status,409);
  const changed=JSON.parse(signature);changed[0][2].reverse();assert.equal((await post('/runs/'+full+'/stars',{signature:JSON.stringify(changed),position:0,starred:true})).status,409);
  assert.equal((await post('/runs/'+full+'/stars',{signature,position:0,starred:true,userId:B.userId})).status,400);
  assert.equal((await post('/reviews',{round:78,idempotencyKey:randomUUID()})).status,409);
 });
 it('stores, clears and reloads a star in another authenticated session',async()=>{
  assert.equal((await star(0,true)).status,200);assert.equal((await star(0,true)).status,200);
  const second=await signin(t,A.email);assert.equal((await get('/runs/'+full+'/stars',second)).body.flags[0],true);
  await star(0,false);assert.equal((await get('/runs/'+full+'/stars',second)).body.flags[0],false);
  assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.cbt_question_stars WHERE user_id=$1 AND question_id=$2',[A.userId,questions[0].question_id])).rows[0].n,1);
 });
 it('legacy migration is exact, atomic, idempotent and never resurrects a cleared star',async()=>{
  const flags=questions.map((_,i)=>i<2);const body={signature,flags};
  assert.equal((await post('/runs/'+full+'/stars/import',{signature,flags:[true]})).status,409);
  let r=await post('/runs/'+full+'/stars/import',body);assert.equal(r.status,200);assert.equal(r.body.flags[0],false);assert.equal(r.body.flags[1],true);
  await star(1,false);r=await post('/runs/'+full+'/stars/import',body);assert.equal(r.body.flags[1],false);
  assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.cbt_star_imports WHERE user_id=$1',[A.userId])).rows[0].n,1);
 });
 it('selects the union of real past wrong answers and stars, excluding unanswered items',async()=>{
  await star(3,true);assert.equal((await post('/runs/'+full+'/start',{})).status,200);
  const answers=questions.map((q,i)=>({position:i,optionId:i===1?wrong(i):i===2?null:q.correct_option_id}));
  const final=await post('/runs/'+full+'/submit',{submissionKey:randomUUID(),answers,currentPosition:0});assert.equal(final.status,200);
  const key=randomUUID(),one=await post('/reviews',{round:79,idempotencyKey:key});assert.equal(one.status,201);review=one.body.run.id;
  assert.deepEqual(one.body.items.map((i:{number:number})=>i.number),[2,4]);assert.equal(one.body.run.kind,'review');
  assert.equal((await post('/reviews',{round:79,idempotencyKey:key})).body.run.id,review);
  assert.equal((await post('/reviews',{round:78,idempotencyKey:key})).status,409);
  assert.equal((await get('/reviews/'+review,B)).status,404);
  assert.equal((await post('/reviews/'+review+'/start',{},B)).status,404);
  assert.equal((await post('/reviews/'+review+'/start',{})).status,200);
 });
 it('checkpoint saves choices without grading; stale different drafts are refused',async()=>{
  const before=(await pool.query('SELECT count(*)::int n FROM hanq.attempts WHERE user_id=$1',[A.userId])).rows[0].n;
  const draft={submissionKey:randomUUID(),checkpointVersion:0,currentPosition:1,answers:[{position:0,optionId:questions[1].correct_option_id},{position:1,optionId:wrong(3)}]};
  const p='/reviews/'+review+'/pause';let r=await post(p,draft);assert.equal(r.status,200);assert.equal(r.body.run.paused,true);assert.equal(r.body.run.pauseSubmissionKey,draft.submissionKey);
  assert.equal((await post(p,draft)).status,200);
  assert.equal((await post(p,{...draft,answers:[{position:0,optionId:wrong(1)},{position:1,optionId:null}]})).status,409);
  r=await get('/reviews/'+review);assert.equal(r.body.items[0].selectedOptionId,questions[1].correct_option_id);assert.equal(r.body.items[0].review,undefined);
  assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.attempts WHERE user_id=$1',[A.userId])).rows[0].n,before);
  assert.equal((await post('/reviews/'+review+'/resume',{})).body.run.paused,false);
 });
 it('one atomic immutable batch, safe retries, no growth or full-exam-score changes',async()=>{
  const body={submissionKey:randomUUID(),currentPosition:1,answers:[{position:0,optionId:questions[1].correct_option_id},{position:1,optionId:wrong(3)}]};
  assert.equal((await post('/reviews/'+review+'/submit',{...body,answers:body.answers.slice(1)})).status,400);
  assert.equal((await post('/reviews/'+review+'/submit',{...body,answers:[body.answers[1],body.answers[0]]})).status,400);
  assert.equal((await post('/reviews/'+review+'/submit',{...body,answers:[{position:0,optionId:'foreign-option'},body.answers[1]]})).status,400);
  const before=await get('/runs/'+full);const growth=(await pool.query('SELECT count(*)::int n FROM hanq.growth_ledger WHERE user_id=$1',[A.userId])).rows[0].n;
  const results=await Promise.all([post('/reviews/'+review+'/submit',body),post('/reviews/'+review+'/submit',body)]);assert.deepEqual(results.map(x=>x.status),[200,200]);
  assert.deepEqual(results[0].body.run.result,{kind:'review',total:2,answered:2,correct:1,wrong:1,unanswered:0});
  assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.attempts WHERE user_id=$1 AND cbt_review_id=$2',[A.userId,review])).rows[0].n,2);
  assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.growth_ledger WHERE user_id=$1',[A.userId])).rows[0].n,growth);
  assert.deepEqual((await get('/runs/'+full)).body.run.result,before.body.run.result);
  assert.equal((await post('/reviews/'+review+'/submit',{...body,submissionKey:randomUUID()})).status,409);
  assert.equal((await post('/reviews/'+review+'/pause',{...body,checkpointVersion:1})).status,409);
  const sr=await get('/reviews/'+review+'/stars');assert.equal((await post('/reviews/'+review+'/stars',{signature:sr.body.signature,position:1,starred:false})).status,200);
 });
 it('a database save failure rolls the whole batch back and the same submission can be retried',async()=>{
  const made=await makeReview(),id=made.body.run.id;await post('/reviews/'+id+'/start',{});
  const body={submissionKey:randomUUID(),currentPosition:0,answers:[{position:0,optionId:questions[1].correct_option_id},{position:1,optionId:wrong(3)}]};
  await pool.query(`CREATE FUNCTION hanq.test_review_save_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.cbt_review_id IS NOT NULL AND NEW.question_id='exam-79-04' THEN RAISE EXCEPTION 'isolated save failure'; END IF; RETURN NEW; END $$`);
  await pool.query('CREATE TRIGGER test_review_save_failure BEFORE INSERT ON hanq.attempts FOR EACH ROW EXECUTE FUNCTION hanq.test_review_save_failure()');
  try{
   const fail=await post('/reviews/'+id+'/submit',body);assert.equal(fail.status,500);
   assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.attempts WHERE user_id=$1 AND cbt_review_id=$2',[A.userId,id])).rows[0].n,0);
   const saved=await get('/reviews/'+id);assert.equal(saved.body.run.status,'active');assert.ok(saved.body.items.every((x:{selectedOptionId:string|null})=>x.selectedOptionId===null));
  }finally{await pool.query('DROP TRIGGER test_review_save_failure ON hanq.attempts');await pool.query('DROP FUNCTION hanq.test_review_save_failure()');}
  assert.equal((await post('/reviews/'+id+'/submit',body)).status,200);
 });
 it('cumulative full + partial mistakes survive a later correct; unanswered adds no attempts',async()=>{
  const next=await makeReview();assert.deepEqual(next.body.items.map((i:{number:number})=>i.number),[2,4]);
  const id=next.body.run.id;await post('/reviews/'+id+'/start',{});
  const before=(await pool.query('SELECT count(*)::int n FROM hanq.attempts WHERE user_id=$1',[A.userId])).rows[0].n;
  const r=await post('/reviews/'+id+'/submit',{submissionKey:randomUUID(),currentPosition:0,answers:[{position:0,optionId:null},{position:1,optionId:null}]});
  assert.deepEqual(r.body.run.result,{kind:'review',total:2,answered:0,correct:0,wrong:0,unanswered:2});
  assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.attempts WHERE user_id=$1',[A.userId])).rows[0].n,before);
  assert.deepEqual((await makeReview()).body.items.map((i:{number:number})=>i.number),[2,4]);
  assert.equal((await get('/reviews',B)).body.reviews.length,0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.cbt_runs WHERE user_id=$1',[A.userId])).rows[0].n,1);
 });
});
