import assert from 'node:assert/strict';
import {before,after,describe,it} from 'node:test';
import request from 'supertest';
import type {Pool} from 'pg';
import {bearer,buyPremium,signup,startApp,subId,type TestApp,type Session} from '../helpers/app';
import {freshDatabase,sampleQuestions} from '../helpers/db';
import {testConfig} from '../helpers/env';
import {importBookWrongNotes,type ManualEntry} from '../../src/wrong-notes/manual-import';
import {seedQuestions} from '../../src/questions/question-seeder';

describe('book memberships and unlimited owner part practice',()=>{
 let t:TestApp,pool:Pool;const {mock,all}=sampleQuestions();
 before(async()=>{pool=await freshDatabase(testConfig());t=await startApp();});
 after(async()=>{await t.close();await pool.end();});
 const entry=(i=0):ManualEntry=>({questionId:mock[i].questionId,version:mock[i].version,exam:mock[i].examRound!,number:mock[i].examNumber!,answer:mock[i].optionIds.indexOf(mock[i].correctOptionId)+1,sourceKey:'fixture-book/'+mock[i].questionId,personalReview:{era:'ancient',part:'ancient',focus:{group:'fixture',cue:'검증한 단서',contrast:'비교',question:'회상',answer:'정답'},questionReview:mock[i].reviewPayload}});
 async function add(s:Session,entries:ManualEntry[]){const q=await pool.connect();try{await q.query('BEGIN');const out=await importBookWrongNotes(q,s.userId,entries,t.clock.now());await q.query('COMMIT');return out;}catch(e){await q.query('ROLLBACK');throw e;}finally{q.release();}}
 async function member(){const s=await signup(t);await buyPremium(t,s);return s;}
 const notes=(s:Session)=>request(t.server).get('/api/v1/wrong-notes?status=all').set(bearer(s.access));
 const parts=(s:Session)=>request(t.server).get('/api/v1/wrong-notes/parts').set(bearer(s.access));
 const replay=(s:Session,era='ancient')=>request(t.server).post('/api/v1/wrong-notes/replays').set(bearer(s.access)).send({list:'all',order:'random',era,size:100});
 async function totals(s:Session){return (await pool.query(`SELECT (SELECT count(*)::int FROM hanq.attempts WHERE user_id=$1) attempts,(SELECT count(*)::int FROM hanq.growth_ledger WHERE user_id=$1) growth,(SELECT count(*)::int FROM hanq.runs WHERE user_id=$1) runs,(SELECT count(*)::int FROM hanq.cbt_runs WHERE user_id=$1) cbt`,[s.userId])).rows[0];}
 it('deduplicates manual links without inventing attempts, selected options, wrong dates, scores or runs; owner-only',async()=>{
  const s=await member(),other=await member(),before=await totals(s);const a=await add(s,[entry(),entry()]);assert.equal(a.added,1);assert.equal(a.alreadyLinked,1);assert.equal((await add(s,[entry()])).alreadyLinked,1);assert.deepEqual(await totals(s),before);
  const n=(await notes(s)).body.items[0];assert.equal(n.source,'book-manual');assert.equal(n.attemptCount,0);assert.equal(n.wrongCount,0);assert.equal(n.lastWrongAt,null);assert.equal(n.lastWrongOptionId,null);assert.ok(n.manualAddedAt);assert.equal((await notes(other)).body.items.length,0);
  assert.equal((await request(t.server).get('/api/v1/wrong-notes/focused-review')).status,401);assert.equal((await request(t.server).get('/api/v1/wrong-notes/focused-review').set(bearer(other.access))).body.notes.length,0);
 });
 it('accurate part counts, zero parts, bad part validation, premium boundary and private focused payload',async()=>{
  const s=await member();await add(s,[entry(0),entry(1)]);const n=(await notes(s)).body.items,p=(await parts(s)).body;assert.equal(p.total,n.length);assert.equal(p.practice.waitHours,0);assert.equal(p.practice.reward,false);
  for(const part of p.parts){const f=await request(t.server).get('/api/v1/wrong-notes').query({status:'all',era:part.id}).set(bearer(s.access));assert.equal(part.count,f.body.items.length);}
  const zero=p.parts.find((x:{count:number})=>!x.count);assert.equal((await replay(s,zero.id)).body.error.code,'nothing_to_replay');assert.equal((await replay(s,'invalid-part')).status,400);
  const free=await signup(t);assert.equal((await parts(free)).status,403);const focus=await request(t.server).get('/api/v1/wrong-notes/focused-review').set(bearer(s.access));assert.equal(focus.body.notes.length,2);assert.equal(JSON.stringify((await request(t.server).get('/api/v1/questions?limit=5')).body).includes('fixture-book'),false);
 });
 it('every catalog era remains accessible, including mixed-era notes; counts partition the owner list',async()=>{
  const s=await member(),mixed=mock.findIndex(q=>q.era==='comprehensive');assert.ok(mixed>=0);
  const e=entry(mixed);e.personalReview={questionReview:mock[mixed].reviewPayload};await add(s,[e,entry()]);
  const p=(await parts(s)).body;assert.equal(p.parts.find((x:{id:string})=>x.id==='comprehensive').count,1);
  assert.equal(p.parts.reduce((sum:number,x:{count:number})=>sum+x.count,0),p.total);
  const r=await replay(s,'comprehensive');assert.equal(r.status,201);assert.equal(r.body.items.length,1);assert.equal(r.body.replay.part,'comprehensive');assert.equal(r.body.items[0].questionId,e.questionId);
 });
 it('correct answers remain repeatable immediately, regardless of former 24h/7day dates; genuine attempts and original-point growth are idempotent',async()=>{
  const s=await member();await add(s,[entry()]);const before=await totals(s),r=(await replay(s)).body,it=r.items[0],submissionId=subId();
  const answer=()=>request(t.server).post(`/api/v1/wrong-notes/replays/${r.replay.id}/answers`).set(bearer(s.access)).send({submissionId,position:0,optionId:mock[0].correctOptionId});
  assert.equal((await answer()).status,200);assert.equal((await answer()).body.replayed,true);const after=await totals(s);assert.equal(after.attempts,before.attempts+1);assert.equal(after.growth,before.growth+1);assert.deepEqual((await pool.query("SELECT g.kind,g.amount FROM hanq.growth_ledger g JOIN hanq.attempts a ON a.id=g.attempt_id WHERE a.user_id=$1 AND a.submission_id=$2 AND a.source='wrong-replay'",[s.userId,submissionId])).rows,[{kind:'practice-mock',amount:mock[0].points}]);assert.equal(after.runs,before.runs);assert.equal(after.cbt,before.cbt);
  await pool.query(`INSERT INTO hanq.wrong_note_review_state(user_id,question_id,version,next_review_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,question_id,version) DO UPDATE SET next_review_at=EXCLUDED.next_review_at`,[s.userId,it.questionId,it.version,new Date(t.clock.now().getTime()+7*86400000)]);
  assert.equal((await notes(s)).body.items[0].status,'resolved');assert.equal((await parts(s)).body.total,1);const again=await replay(s);assert.equal(again.status,201);assert.equal(again.body.items.length,1);assert.equal(again.body.replay.rewardEligible,false);assert.notEqual(again.body.replay.id,r.replay.id);
  assert.deepEqual((await request(t.server).get('/api/v1/wrong-notes/replays/'+r.replay.id).set(bearer(s.access))).body.items.map((x:{questionId:string})=>x.questionId),[it.questionId]);
 });
 it('new canonical source questions persist through a normal seed; wrong official answers roll back atomically',async()=>{
  const s=await member(),e=entry(),id='exam-90-01',raw={...mock[0].reviewPayload,id,v:'official-test-v1',exam:90,number:1,image:'media/exam-book/90-01.webp',options:mock[0].optionIds.map((_,i)=>({id:id+'-option-'+(i+1),text:String(i+1),correct:i===0})),answer:1,points:1};
  const newer:ManualEntry={...e,questionId:id,version:undefined,exam:90,number:1,answer:1,newQuestion:raw,sourceKey:'fixture-book-new'};assert.equal((await add(s,[newer])).createdQuestions,1);await seedQuestions(pool,all,t.clock.now());assert.equal((await pool.query('SELECT is_current FROM hanq.question_versions WHERE question_id=$1',[id])).rows[0].is_current,true);
  const before=(await notes(s)).body.items.length;await assert.rejects(()=>add(s,[entry(2),{...entry(3),answer:entry(3).answer%5+1}]),/mismatch/);assert.equal((await notes(s)).body.items.length,before);
 });
 it('completed reward challenges keep the five-per-day cap; part practice does not consume or bypass it',async()=>{
  const s=await member();await add(s,Array.from({length:20},(_,i)=>entry(i)));
  for(let i=0;i<5;i++){const a=(await request(t.server).post('/api/v1/wrong-notes/study').set(bearer(s.access)).send({})).body;t.clock.advance(3000);assert.equal((await request(t.server).post(`/api/v1/runs/${a.run.id}/submit`).set(bearer(s.access)).send({})).status,200);}
  const sixth=await request(t.server).post('/api/v1/wrong-notes/study').set(bearer(s.access)).send({});assert.equal(sixth.body.error.code,'daily_study_limit');const before=await totals(s);assert.equal((await replay(s)).status,201);assert.deepEqual(await totals(s),before);
 });
});
