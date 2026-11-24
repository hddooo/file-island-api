import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after,before,describe,it } from 'node:test';
import type { Pool } from 'pg';
import request from 'supertest';
import { bearer,signin,signupResponse,startApp,type Session,type TestApp } from '../helpers/app';
import { freshDatabase } from '../helpers/db';
import { testConfig } from '../helpers/env';

type Q={question_id:string;version:string;option_ids:string[];correct_option_id:string;exam_number:number};
describe('Uigeumbu mixed-round wrong practice: isolated DB only',()=>{
 let pool:Pool,t:TestApp,A:Session,B:Session;const rounds:Record<number,Q[]>={};
 const api=()=>request(t.server);
 const post=(path:string,body:object,s=A)=>api().post('/api/v1/cbt'+path).set(bearer(s.access)).send(body);
 const get=(path:string,s=A)=>api().get('/api/v1/cbt'+path).set(bearer(s.access));
 const wrong=(q:Q)=>q.option_ids.find(x=>x!==q.correct_option_id)!;
 const totals=async(s:Session)=>(await pool.query(`SELECT (SELECT count(*)::int FROM hanq.attempts WHERE user_id=$1) attempts,(SELECT coalesce(sum(amount),0)::int FROM hanq.growth_ledger WHERE user_id=$1) growth,(SELECT count(*)::int FROM hanq.cbt_runs WHERE user_id=$1) runs,(SELECT count(*)::int FROM hanq.cbt_reviews WHERE user_id=$1) reviews`,[s.userId])).rows[0];
 async function exam(round:number,pick:(q:Q,i:number)=>string|null,s=A){
  const r=await post('/runs',{round,idempotencyKey:randomUUID(),answerMode:'batch'},s);assert.equal(r.status,201);const id=r.body.run.id;
  // Current uninterrupted exam contract: document token, checkpoint, explicit submit.
  const token=randomUUID(),run=(path:string,body:object)=>api().post('/api/v1/cbt/runs/'+id+path).set(bearer(s.access)).set({'x-cbt-attempt-token':token}).send(body);
  assert.equal((await run('/start',{attemptToken:token})).status,200);
  const answers=rounds[round].map((q,i)=>({position:i,optionId:pick(q,i)}));
  const cp=await run('/checkpoint',{version:1,answers,currentPosition:49});assert.equal(cp.status,200,JSON.stringify(cp.body));
  const done=await run('/submit',{submissionKey:randomUUID(),submissionIntent:'explicit-q50-before-deadline-v1'});assert.equal(done.status,200,JSON.stringify(done.body));
 }
 /** Real signup through the approval flow, approved directly in the disposable DB, then a real sign-in. */
 async function member(){const email='uig.'+randomUUID()+'@example.test';const r=await signupResponse(t,email);assert.equal(r.status,201);assert.equal((await pool.query("UPDATE hanq.users SET approval_status='approved' WHERE email_normalized=$1 AND approval_status='pending'",[email])).rowCount,1);return signin(t,email);}
 const create=(scope:'all'|'last-wrong',s=A,key=randomUUID())=>post('/uigeumbu/sessions',{scope,idempotencyKey:key},s);
 const submit=(id:string,s=A,key=randomUUID())=>(t.clock.advance(1000),post)('/uigeumbu/sessions/'+id+'/submit',{submissionKey:key},s);
 before(async()=>{
  pool=await freshDatabase(testConfig());const dir=mkdtempSync(join(tmpdir(),'hanq-uigeumbu-assets-'));
  for(const round of [78,79])for(let n=1;n<=50;n++){const body=Buffer.from('WEBPVP8Ltest');const size=Buffer.alloc(4);size.writeUInt32LE(body.length);writeFileSync(join(dir,`${round}-${String(n).padStart(2,'0')}.webp`),Buffer.concat([Buffer.from('RIFF'),size,body]));}
  t=await startApp({HANQ_CBT_ASSET_DIR:dir});A=await member();B=await member();
  for(const round of [78,79])rounds[round]=(await pool.query('SELECT question_id,version,option_ids,correct_option_id,exam_number FROM hanq.question_versions WHERE is_current AND exam_round=$1 ORDER BY exam_number',[round])).rows;
  // Round 79: #2 and #5 wrong, #3 unanswered. Round 78: #10 wrong.
  await exam(79,(q,i)=>i===1||i===4?wrong(q):i===2?null:q.correct_option_id);
  await exam(78,(q,i)=>i===9?wrong(q):q.correct_option_id);
 });
 after(async()=>{if(t)await t.close();if(pool)await pool.end();});

 it('pools only real CBT mistakes across rounds, owner-scoped, in round/number order',async()=>{
  assert.equal((await api().get('/api/v1/cbt/uigeumbu')).status,401);
  const s=await get('/uigeumbu');assert.equal(s.status,200);assert.equal(s.body.pool.all,3);assert.equal(s.body.last,null);assert.deepEqual(s.body.rounds,[]);
  assert.equal((await get('/uigeumbu',B)).body.pool.all,0);
  const none=await create('last-wrong');assert.equal(none.status,409);assert.equal(none.body.error.code,'no_previous_round');
  assert.equal((await create('all',B)).body.error.code,'review_empty');
  assert.equal((await post('/uigeumbu/sessions',{scope:'everything',idempotencyKey:randomUUID()})).status,400);
 });
 it('records an untimed round without writing attempts, growth, exams or reviews; 10 most recent rounds',async()=>{
  const before=await totals(A),key=randomUUID(),c=await create('all',A,key);assert.equal(c.status,201);const id=c.body.session.id;
  assert.deepEqual(c.body.items.map((i:{exam:number;number:number})=>[i.exam,i.number]),[[78,10],[79,2],[79,5]]);
  assert.equal(c.body.session.checkMode,true);assert.equal(c.body.session.total,3);assert.ok(c.body.items.every((i:{review:{status:string;correctOptionId:string}})=>i.review.status==='unanswered'&&i.review.correctOptionId),'one-question practice carries answers like the CBT wrong/star review');
  assert.equal((await create('all',A,key)).body.session.id,id);
  assert.equal((await get('/uigeumbu/sessions/'+id,B)).status,404);
  const img=await get('/uigeumbu/sessions/'+id+'/questions/0/image');assert.equal(img.status,200);assert.equal(img.headers['content-type'],'image/webp');
  assert.equal((await get('/uigeumbu/sessions/'+id+'/questions/3/image')).status,404);assert.equal((await get('/uigeumbu/sessions/'+id+'/questions/0/image',B)).status,404);
  const q78=rounds[78][9],q79=rounds[79][1];
  assert.equal((await post('/uigeumbu/sessions/'+id+'/answer',{position:0,optionId:'nope'})).status,400);
  assert.equal((await post('/uigeumbu/sessions/'+id+'/answer',{position:0,optionId:q78.correct_option_id},B)).status,404);
  const a=await post('/uigeumbu/sessions/'+id+'/answer',{position:0,optionId:q78.correct_option_id});assert.equal(a.status,200);assert.equal(a.body.item.selectedOptionId,q78.correct_option_id);assert.equal(a.body.item.checked,true);assert.equal(a.body.item.review.correct,true);
  assert.equal((await post('/uigeumbu/sessions/'+id+'/answer',{position:0,optionId:wrong(q78)})).body.error.code,'answer_checked','a checked answer is locked');
  assert.equal((await post('/uigeumbu/sessions/'+id+'/answer',{position:1,optionId:wrong(q79)})).status,200);
  assert.equal((await post('/uigeumbu/sessions/'+id+'/position',{currentPosition:2})).status,200);
  assert.equal((await post('/uigeumbu/sessions/'+id+'/position',{currentPosition:3})).status,404);
  const subKey=randomUUID(),f=await submit(id,A,subKey);assert.equal(f.status,200);
  assert.deepEqual([f.body.session.result.correct,f.body.session.result.wrong,f.body.session.result.unanswered,f.body.session.sequence],[1,1,1,1]);
  assert.deepEqual(f.body.items.map((i:{review:{status:string}})=>i.review.status),['correct','wrong','unanswered']);
  assert.equal((await submit(id,A,subKey)).status,200);assert.equal((await submit(id)).status,409);
  assert.equal((await post('/uigeumbu/sessions/'+id+'/answer',{position:2,optionId:null})).body.error.code,'session_closed');
  assert.deepEqual(await totals(A),before);
  await assert.rejects(pool.query(`UPDATE hanq.cbt_mixed_reviews SET current_position=1 WHERE id=$1`,[id]));
  const s=(await get('/uigeumbu')).body;assert.equal(s.rounds.length,1);assert.deepEqual([s.rounds[0].sequence,s.rounds[0].scope,s.rounds[0].total,s.rounds[0].correct,s.rounds[0].wrong],[1,'all',3,1,1]);assert.deepEqual(s.last,{id,sequence:1,wrong:2});assert.equal(s.active,null);
 });
 it('round review: wrong + unanswered + starred items, instant check that cannot be changed, recorded under its round',async()=>{
  const round=(await get('/uigeumbu')).body.rounds[0];
  assert.equal((await post('/uigeumbu/sessions/'+round.id+'/triple-stars',{position:0,starred:true})).status,200);
  assert.equal((await post('/uigeumbu/sessions/'+round.id+'/triple-stars',{position:0,starred:true},B)).status,404);
  assert.equal((await post('/uigeumbu/sessions/'+round.id+'/stars',{position:1,starred:true})).status,200,'a CBT star alone does not bring a question back');
  const r=await post('/uigeumbu/sessions/'+round.id+'/reviews',{idempotencyKey:randomUUID()});assert.equal(r.status,201);const id=r.body.session.id;
  assert.equal(r.body.session.checkMode,true);assert.equal(r.body.session.scope,'round-review');assert.equal(r.body.items.length,3);assert.equal(r.body.items[0].tripleStarred,true);
  const q=rounds[78][9],ok=await post('/uigeumbu/sessions/'+id+'/answer',{position:0,optionId:q.correct_option_id});
  assert.equal(ok.body.item.review.correct,true);assert.equal(ok.body.item.checked,true);
  assert.equal((await post('/uigeumbu/sessions/'+id+'/answer',{position:0,optionId:wrong(q)})).body.error.code,'answer_checked');
  assert.equal((await post('/uigeumbu/sessions/'+id+'/answer',{position:0,optionId:q.correct_option_id})).status,200);
  const bad=await post('/uigeumbu/sessions/'+id+'/answer',{position:1,optionId:wrong(rounds[79][1])});assert.equal(bad.body.item.review.correct,false);
  assert.equal((await post('/uigeumbu/sessions/'+id+'/reviews',{idempotencyKey:randomUUID()})).body.error.code,'review_parent_invalid');
  const f=await submit(id);assert.equal(f.status,200);assert.equal(f.body.session.sequence,null);
  const s=(await get('/uigeumbu')).body;assert.equal(s.rounds.length,1);assert.equal(s.rounds[0].reviews.length,1);assert.deepEqual([s.rounds[0].reviews[0].total,s.rounds[0].reviews[0].correct],[3,1]);
 });
 it('last-wrong uses only the latest submitted main round; a new start closes the unfinished one',async()=>{
  const c=await create('last-wrong');assert.equal(c.status,201);assert.deepEqual(c.body.items.map((i:{exam:number;number:number})=>[i.exam,i.number]),[[79,2],[79,5]]);
  const open=await create('all');assert.equal(open.status,201);assert.equal((await get('/uigeumbu/sessions/'+c.body.session.id)).status,404);
  for(const i of open.body.items)await post('/uigeumbu/sessions/'+open.body.session.id+'/answer',{position:i.position,optionId:i.exam===78?rounds[78][9].correct_option_id:rounds[79][i.number-1].correct_option_id});
  const f=await submit(open.body.session.id);assert.equal(f.body.session.result.correct,3);assert.equal(f.body.session.sequence,2);
  assert.equal((await create('last-wrong')).body.error.code,'review_empty');
  for(let n=0;n<10;n++){const x=await create('all');assert.equal((await submit(x.body.session.id)).status,200);}
  const s=(await get('/uigeumbu')).body;assert.equal(s.rounds.length,10);assert.equal(s.rounds[0].sequence,12);assert.equal(s.rounds[9].sequence,3);assert.equal(s.last.wrong,3);
  assert.equal((await get('/uigeumbu',B)).body.rounds.length,0);
 });
 it('all: a CBT exam star does not join the Uigeumbu pool; ★★★ does; last-wrong stays wrong-only',async()=>{
  const q=rounds[79][0];const base=(await get('/uigeumbu')).body.pool.all;
  await pool.query(`INSERT INTO hanq.cbt_question_stars(user_id,question_id,version,starred,updated_at) VALUES($1,$2,$3,true,$4) ON CONFLICT(user_id,question_id,version) DO UPDATE SET starred=true`,[A.userId,q.question_id,q.version,t.clock.now()]);
  assert.equal((await get('/uigeumbu')).body.pool.all,base,'CBT stars stay out of Uigeumbu');
  await pool.query(`INSERT INTO hanq.uigeumbu_stars(user_id,question_id,version,starred,updated_at) VALUES($1,$2,$3,true,$4) ON CONFLICT(user_id,question_id) DO UPDATE SET starred=true`,[A.userId,q.question_id,q.version,t.clock.now()]);
  assert.equal((await get('/uigeumbu')).body.pool.all,base+1);
  const all=await create('all');assert.ok(all.body.items.some((i:{exam:number;number:number;tripleStarred:boolean})=>i.exam===79&&i.number===1&&i.tripleStarred));
  for(const i of all.body.items)await post('/uigeumbu/sessions/'+all.body.session.id+'/answer',{position:i.position,optionId:(i.exam===78?rounds[78][9]:rounds[79][i.number-1]).correct_option_id});
  assert.equal((await submit(all.body.session.id)).body.session.result.correct,4);
  assert.equal((await create('last-wrong')).body.error.code,'review_empty','a starred but correct question is not a last-round mistake');
  await pool.query(`UPDATE hanq.uigeumbu_stars SET starred=false WHERE user_id=$1 AND question_id=$2`,[A.userId,q.question_id]);
  assert.equal((await get('/uigeumbu')).body.pool.all,base,'clearing ★★★ removes it again');
  assert.equal((await get('/uigeumbu',B)).body.pool.all,0);
 });
 it('★★★ is separate from CBT stars: joins the all pool and the round review, then star reset clears it',async()=>{
  const s=(await get('/uigeumbu')).body,q=rounds[79][3],base3=s.tripleStars;
  const all=await create('all');const id=all.body.session.id;const pos=all.body.items.length-1;
  assert.equal((await post('/uigeumbu/sessions/'+id+'/triple-stars',{position:pos,starred:true},B)).status,404);
  const ts=await post('/uigeumbu/sessions/'+id+'/triple-stars',{position:pos,starred:true});assert.equal(ts.status,200);assert.equal(ts.body.tripleStarred,true);
  const view=(await get('/uigeumbu/sessions/'+id)).body;assert.equal(view.items[pos].tripleStarred,true);assert.equal(view.items[pos].starred,false,'CBT star untouched');
  for(const i of view.items)await post('/uigeumbu/sessions/'+id+'/answer',{position:i.position,optionId:i.review.correctOptionId});
  const done=await submit(id);assert.equal(done.body.session.result.correct,view.items.length);
  const rv=await post('/uigeumbu/sessions/'+id+'/reviews',{idempotencyKey:randomUUID()});assert.equal(rv.status,201);assert.ok(rv.body.items.some((i:{position:number;tripleStarred:boolean})=>i.tripleStarred));assert.ok(rv.body.items.every((i:{starred:boolean;tripleStarred:boolean})=>i.starred||i.tripleStarred),'all correct: only starred / ★★★ questions come back');
  await submit(rv.body.session.id);
  // a correct, never-wrong question with ★★★ joins the all pool
  const before=(await get('/uigeumbu')).body.pool.all;
  await pool.query(`INSERT INTO hanq.uigeumbu_stars(user_id,question_id,version,starred,updated_at) VALUES($1,$2,$3,true,$4)`,[A.userId,q.question_id,q.version,t.clock.now()]);
  const after=(await get('/uigeumbu')).body;assert.equal(after.pool.all,before+1);assert.equal(after.tripleStars,base3+2);
  assert.equal((await get('/uigeumbu',B)).body.tripleStars,0);
 });
 it('3별 reset clears only ★★★ and keeps CBT stars',async()=>{
  const q=rounds[79][4];await pool.query(`INSERT INTO hanq.uigeumbu_stars(user_id,question_id,version,starred,updated_at) VALUES($1,$2,$3,true,$4) ON CONFLICT(user_id,question_id) DO UPDATE SET starred=true`,[A.userId,q.question_id,q.version,t.clock.now()]);
  const before=(await get('/uigeumbu')).body;assert.ok(before.tripleStars>=1);
  assert.equal((await post('/uigeumbu/triple-stars/reset',{confirmation:'RESET_STARS'})).status,400);
  const r=await post('/uigeumbu/triple-stars/reset',{confirmation:'RESET_TRIPLE_STARS'});assert.equal(r.status,200);assert.equal(r.body.tripleStars,before.tripleStars);
  const after=(await get('/uigeumbu')).body;assert.equal(after.tripleStars,0);assert.equal(after.stars,before.stars,'CBT stars untouched');
 });
 it('star reset clears every star of the owner only, releasing star-only questions from the all pool',async()=>{
  const q=rounds[79][2];await pool.query(`INSERT INTO hanq.cbt_question_stars(user_id,question_id,version,starred,updated_at) VALUES($1,$2,$3,true,$4) ON CONFLICT(user_id,question_id,version) DO UPDATE SET starred=true`,[A.userId,q.question_id,q.version,t.clock.now()]);
  await pool.query(`INSERT INTO hanq.cbt_question_stars(user_id,question_id,version,starred,updated_at) VALUES($1,$2,$3,true,$4)`,[B.userId,q.question_id,q.version,t.clock.now()]);
  await pool.query(`INSERT INTO hanq.uigeumbu_stars(user_id,question_id,version,starred,updated_at) VALUES($1,$2,$3,true,$4) ON CONFLICT(user_id,question_id) DO UPDATE SET starred=true`,[A.userId,rounds[79][5].question_id,rounds[79][5].version,t.clock.now()]);
  const before=(await get('/uigeumbu')).body;assert.ok(before.stars>=1);assert.ok(before.pool.all>3,'★★★-only questions are in the pool before the reset');
  assert.equal((await post('/uigeumbu/stars/reset',{})).status,400,'explicit confirmation required');
  const r=await post('/uigeumbu/stars/reset',{confirmation:'RESET_STARS'});assert.equal(r.status,200);assert.ok(r.body.cleared>=1);
  const after=(await get('/uigeumbu')).body;assert.equal(after.stars,0);assert.equal(after.tripleStars,0);assert.equal(after.pool.all,3,'ever-wrong questions stay; star-only ones leave');
  assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.cbt_question_stars WHERE user_id=$1 AND starred',[A.userId])).rows[0].n,0);
  assert.equal((await get('/uigeumbu',B)).body.stars,1,'other owners keep their stars');
  assert.equal((await api().post('/api/v1/cbt/uigeumbu/stars/reset').send({confirmation:'RESET_STARS'})).status,401);
 });
});
