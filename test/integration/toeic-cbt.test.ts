import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after,before,describe,it } from 'node:test';
import type { Pool } from 'pg';
import request from 'supertest';
import { freshDatabase } from '../helpers/db';
import { testConfig } from '../helpers/env';
import { bearer,signup,signin,startApp,type TestApp } from '../helpers/app';
import { toeicFixture } from '../helpers/toeic-fixture';
import { storePrivateToeicCollection } from '../../src/toeic-cbt/import';
const base='/api/v1/toeic-cbt';
describe('private TOEIC wrong replay (real PostgreSQL, synthetic test-only content)',()=>{
 let t:TestApp,pool:Pool;
 before(async()=>{pool=await freshDatabase(testConfig());t=await startApp();});
 after(async()=>{if(t)await t.close();if(pool)await pool.end();});
 it('incomplete source cannot create a run or leak scripts/options; no shared seed or ownership bypass',async()=>{
  const a=await signup(t),b=await signup(t),pending=toeicFixture();pending.questions.forEach(q=>{q.correctOptionId=null;q.answerVerified=false;});pending.questions[0].photoUrl=null;pending.questions[2].choices=[];
  const id=await storePrivateToeicCollection(pool,a.userId,pending);
  await request(t.server).get(base+'/collections').expect(401);
  const list=await request(t.server).get(base+'/collections').set(bearer(a.access)).expect(200);
  assert.equal(list.body.collections[0].ready,false);assert.equal(list.body.collections[0].missing.length,4);assert(!JSON.stringify(list.body).includes('Synthetic option'));
  await request(t.server).post(base+'/runs').set(bearer(a.access)).send({collectionId:id,idempotencyKey:'pending-test-key'}).expect(409);
  await request(t.server).get(base+'/runs').set(bearer(a.access)).expect(200,{runs:[]});
  await request(t.server).get(base+'/collections').set(bearer(b.access)).expect(200,{collections:[]});
  await request(t.server).post(base+'/runs').set(bearer(b.access)).send({collectionId:id,idempotencyKey:'foreign-test-key'}).expect(404);
  await request(t.server).post(base+'/runs').set(bearer(a.access)).send({collectionId:id,idempotencyKey:'spoof-owner-key',userId:b.userId}).expect(400);
  assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.toeic_cbt_runs WHERE user_id=$1',[a.userId])).rows[0].n,0);
  for(const table of ['toeic_cbt_collections','toeic_cbt_runs','toeic_cbt_items'])assert.equal((await pool.query("SELECT has_table_privilege('public',$1,'SELECT') readable",['hanq.'+table])).rows[0].readable,false);
 });
 it('new per-round attempts: owner-only pause/relogin/races, immutable idempotent grading and source-version history without history/vocab writes',async()=>{
  const a=await signup(t),b=await signup(t),source=toeicFixture(),collectionId=await storePrivateToeicCollection(pool,a.userId,source);
  assert.equal(await storePrivateToeicCollection(pool,a.userId,source),collectionId);
  const create=()=>request(t.server).post(base+'/runs').set(bearer(a.access)).send({collectionId,idempotencyKey:'concurrent-create-key'});
  const creates=await Promise.all([create(),create()]);assert(creates.every(r=>r.status===201));assert.equal(creates[0].body.run.id,creates[1].body.run.id);assert.deepEqual(creates[0].body.items,[]);
  const id=creates[0].body.run.id,path=base+'/runs/'+id;
  const started=await request(t.server).post(path+'/start').set(bearer(a.access)).send({}).expect(201);
  assert.equal(started.body.run.status,'active');assert.equal(started.body.items.length,4);assert.equal(started.body.run.durationMs,undefined);
  for(const item of started.body.items){assert.equal(item.review,undefined);assert.equal(item.correctOptionId,undefined);assert.equal(item.script,undefined);assert.equal(item.tutorExplanation,undefined);}
  assert.deepEqual(started.body.items[1].options.map((o:{text:string})=>o.text),['A','B','C']);
  assert.notEqual(started.body.items[2].groupId,started.body.items[3].groupId);assert.deepEqual(started.body.items[2].groupQuestionNumbers,[35,36,37]);
  for(const suffix of ['', '/start','/checkpoint','/resume','/submit']){
   const op=suffix===''?request(t.server).get(path):suffix==='/checkpoint'?request(t.server).put(path+suffix).send({revision:1,cursor:0,paused:false,answers:[0,1,2,3].map(position=>({position,optionId:null}))}):request(t.server).post(path+suffix).send(suffix==='/resume'?{revision:1}:suffix==='/submit'?{revision:1,cursor:0,submissionKey:'foreign-submit-key',answers:[0,1,2,3].map(position=>({position,optionId:null}))}:{});
   await op.set(bearer(b.access)).expect(404);
  }
  const answers=['B','A',null,'D'].map((optionId,position)=>({position,optionId}));
  await request(t.server).put(path+'/checkpoint').set(bearer(a.access)).send({revision:1,cursor:0,paused:false,answers:answers.slice(0,3)}).expect(400);
  await request(t.server).put(path+'/checkpoint').set(bearer(a.access)).send({revision:1,cursor:0,paused:false,answers:answers.map((v,i)=>i===1?{...v,optionId:'D'}:v)}).expect(400);
  const saved=await request(t.server).put(path+'/checkpoint').set(bearer(a.access)).send({revision:1,cursor:2,paused:false,answers}).expect(200);
  const pause={revision:saved.body.run.revision,cursor:2,paused:true,answers};
  const paused=await request(t.server).put(path+'/checkpoint').set(bearer(a.access)).send(pause).expect(200);assert.deepEqual(paused.body.items,[]);
  assert.equal((await request(t.server).put(path+'/checkpoint').set(bearer(a.access)).send(pause).expect(200)).body.run.revision,paused.body.run.revision);
  await request(t.server).post(path+'/submit').set(bearer(a.access)).send({revision:paused.body.run.revision,cursor:2,answers,submissionKey:'while-paused-key'}).expect(409);
  const resumed=await request(t.server).post(path+'/resume').set(bearer(a.access)).send({revision:paused.body.run.revision}).expect(201);
  const again=await signin(t,a.email);const restored=await request(t.server).get(path).set(bearer(again.access)).expect(200);assert.equal(restored.body.run.cursor,2);assert.deepEqual(restored.body.items.map((i:{selectedOptionId:string|null})=>i.selectedOptionId),answers.map(a=>a.optionId));
  const changes=['B','C'].map(o=>request(t.server).put(path+'/checkpoint').set(bearer(again.access)).send({revision:resumed.body.run.revision,cursor:2,paused:false,answers:answers.map((a,i)=>i===1?{...a,optionId:o}:a)}));
  const races=await Promise.all(changes);assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);const revision=races.find(r=>r.status===200)!.body.run.revision;
  const submission={revision,cursor:3,answers,submissionKey:'immutable-final-key'};
  const beforeFailure=(await pool.query('SELECT position,selected_option,correct FROM hanq.toeic_cbt_items WHERE run_id=$1 ORDER BY position',[id])).rows;
  await pool.query("CREATE FUNCTION hanq.toeic_test_fail_final() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='final' THEN RAISE EXCEPTION 'synthetic rollback test'; END IF;RETURN NEW;END $$");
  await pool.query('CREATE TRIGGER toeic_test_fail_final BEFORE UPDATE ON hanq.toeic_cbt_runs FOR EACH ROW EXECUTE FUNCTION hanq.toeic_test_fail_final()');
  await request(t.server).post(path+'/submit').set(bearer(again.access)).send(submission).expect(500);
  assert.deepEqual((await pool.query('SELECT position,selected_option,correct FROM hanq.toeic_cbt_items WHERE run_id=$1 ORDER BY position',[id])).rows,beforeFailure,'failed final write rolls back every item grade/selection');
  assert.equal((await pool.query('SELECT status FROM hanq.toeic_cbt_runs WHERE id=$1',[id])).rows[0].status,'active');
  await pool.query('DROP TRIGGER toeic_test_fail_final ON hanq.toeic_cbt_runs');await pool.query('DROP FUNCTION hanq.toeic_test_fail_final()');
  const finals=await Promise.all([0,1].map(()=>request(t.server).post(path+'/submit').set(bearer(again.access)).send(submission)));assert(finals.every(r=>r.status===201));
  const final=finals[0].body;assert.equal(final.items[1].studyHistory.wrongCount,2);assert.equal(final.items[1].studyHistory.repeatedWrong,true);assert.equal(final.items[0].studyHistory.wrongCount,1);assert.deepEqual(final.run.result,{kind:'toeic-wrong-replay',total:4,answered:3,correct:2,wrong:1,unanswered:1});assert.equal(final.items[0].review.correctOptionId,'B');assert.equal(final.items[2].review.status,'unanswered');assert.equal(final.items[0].review.script,'Synthetic script for p1');
  await request(t.server).post(path+'/submit').set(bearer(again.access)).send({...submission,submissionKey:'different-final-key'}).expect(409);
  await assert.rejects(pool.query('UPDATE hanq.toeic_cbt_items SET selected_option=$2 WHERE run_id=$1',[id,'A']));
  await assert.rejects(pool.query("UPDATE hanq.toeic_cbt_runs SET cursor=0 WHERE id=$1",[id]));
  await assert.rejects(pool.query("UPDATE hanq.toeic_cbt_collections SET title='changed' WHERE id=$1",[collectionId]));
  const newer=structuredClone(source);newer.questions[0].correctOptionId='A';await storePrivateToeicCollection(pool,a.userId,newer);
  assert.equal((await request(t.server).get(path).set(bearer(again.access)).expect(200)).body.items[0].review.correctOptionId,'B','old attempt remains bound to its immutable source');
  const retry=await request(t.server).post(base+'/runs').set(bearer(again.access)).send({collectionId,idempotencyKey:'brand-new-replay-key'}).expect(201);assert.notEqual(retry.body.run.id,id);assert.equal(retry.body.run.status,'ready');
  const history=await request(t.server).get(base+'/runs').set(bearer(again.access)).expect(200);assert.equal(history.body.runs.length,2);await request(t.server).get(base+'/runs').set(bearer(b.access)).expect(200,{runs:[]});
  for(const table of ['attempts','cbt_runs','toeic_notes','toeic_recall_progress'])assert.equal((await pool.query(`SELECT count(*)::int n FROM hanq.${table} WHERE user_id=$1`,[a.userId])).rows[0].n,0);
 });
 it('Part 6/7 full-passage replay runs independently of incomplete LC and retains provenance after grading',async()=>{
  const a=await signup(t),source=toeicFixture(),template=source.questions[2];
  source.wrongNumbers=[1,132,148];source.questions=[source.questions[0],...[131,132,133,134,147,148].map(number=>({...structuredClone(template),number,part:number<147?6:7,groupId:number<147?'rc6':'rc7',photoUrl:null,photoVerified:false}))];
  source.groups.push(...[{id:'rc6',questionNumbers:[131,132,133,134]},{id:'rc7',questionNumbers:[147,148]}].map(g=>({...g,audioUrl:null,audioVerified:false,script:'',scriptStatus:'verified' as const,passage:'Synthetic verified shared document',passageVerified:true})));
  source.replayNumbers=[1,131,132,133,134,147,148];source.groups[0].audioVerified=false;
  const collectionId=await storePrivateToeicCollection(pool,a.userId,source);
  await request(t.server).post(base+'/runs').set(bearer(a.access)).send({collectionId,idempotencyKey:'whole-pending-rc'}).expect(409);
  for(const part of [6,7]){
   const key='part-ready-rc-'+part,created=await request(t.server).post(base+'/runs').set(bearer(a.access)).send({collectionId,idempotencyKey:key,parts:[part]}).expect(201),id=created.body.run.id;
   await request(t.server).post(base+'/runs').set(bearer(a.access)).send({collectionId,idempotencyKey:key,parts:[part===6?7:6]}).expect(409);
   const started=await request(t.server).post(base+'/runs/'+id+'/start').set(bearer(a.access)).send({}).expect(201);
   assert.equal(started.body.items.length,part===6?4:2);assert.equal(started.body.items.filter((i:{originalWrong:boolean})=>i.originalWrong).length,1);assert(started.body.items.every((i:{part:number;passage:string;review:unknown})=>i.part===part&&i.passage==='Synthetic verified shared document'&&!i.review));
   const final=await request(t.server).post(base+'/runs/'+id+'/submit').set(bearer(a.access)).send({revision:started.body.run.revision,cursor:0,submissionKey:'part-submit-key-'+part,answers:started.body.items.map((_:unknown,position:number)=>({position,optionId:'A'}))}).expect(201);
   assert.equal(final.body.run.result.correct,part===6?4:2);assert(final.body.items.every((i:{review:{explanation:string}})=>i.review.explanation));
  }
 });
 it('private diagrams require the existing live owner session and never become public static URLs',async()=>{
  const a=await signup(t),b=await signup(t),collectionId=await storePrivateToeicCollection(pool,a.userId,toeicFixture()),key='a'.repeat(64),bytes=Buffer.from('89504e470d0a1a0a','hex');
  await pool.query('INSERT INTO hanq.toeic_cbt_images(user_id,collection_id,asset_key,media_type,bytes) VALUES($1,$2,$3,$4,$5)',[a.userId,collectionId,key,'image/png',bytes]);
  const path=base+'/collections/'+collectionId+'/images/'+key;
  await request(t.server).get(path).expect(401);
  await request(t.server).get(path).set(bearer(b.access)).expect(404);
  const response=await request(t.server).get(path).set(bearer(a.access)).expect(200).expect('Cache-Control','private, no-store');assert.deepEqual(response.body,bytes);
  await request(t.server).get(base+'/collections/'+collectionId+'/images/bad').set(bearer(a.access)).expect(404);
 });
 it('tutor content stays private before submission and is included only in the owned final review',async()=>{
  const a=await signup(t),source=toeicFixture();
  const tutor={answerReason:'PRIVATE_TUTOR_REASON',reading:[{chunk:'PRIVATE_READING_CHUNK',translation:'합성 해석'}],steps:['PRIVATE_TUTOR_STEP'],options:source.questions[0].choices.map(o=>({id:o.id,explanation:'PRIVATE_OPTION_REASON'})),traps:['PRIVATE_TUTOR_TRAP'],checklist:['PRIVATE_TUTOR_CHECK']};source.questions[0].tutorExplanation=tutor;
  const collectionId=await storePrivateToeicCollection(pool,a.userId,source),created=await request(t.server).post(base+'/runs').set(bearer(a.access)).send({collectionId,idempotencyKey:'tutor-private-run'}).expect(201),id=created.body.run.id;
  const list=await request(t.server).get(base+'/collections').set(bearer(a.access)).expect(200);assert(!JSON.stringify(list.body).includes('PRIVATE_TUTOR'));
  const active=await request(t.server).post(base+'/runs/'+id+'/start').set(bearer(a.access)).send({}).expect(201);assert(!JSON.stringify(active.body).includes('PRIVATE_'));assert.equal(active.body.items[0].review,undefined);
  const final=await request(t.server).post(base+'/runs/'+id+'/submit').set(bearer(a.access)).send({revision:active.body.run.revision,cursor:0,submissionKey:'tutor-private-submit',answers:active.body.items.map((_:unknown,position:number)=>({position,optionId:null}))}).expect(201);assert.deepEqual(final.body.items[0].review.tutorExplanation,tutor);
 });
 it('unverified study is owner-only and cannot create grading attempts',async()=>{
  const a=await signup(t),b=await signup(t),source=toeicFixture();source.questions.forEach(q=>{q.answerStatus='assistant_inferred_not_officially_verified';q.answerVerified=false;});const collectionId=await storePrivateToeicCollection(pool,a.userId,source),path=base+'/collections/'+collectionId+'/study';
  await request(t.server).get(path).expect(401);await request(t.server).get(path).set(bearer(b.access)).expect(404);const study=await request(t.server).get(path).set(bearer(a.access)).expect(200);assert.equal(study.body.gradingEnabled,false);assert.equal(study.body.officiallyVerified,false);assert.equal(study.body.questions.length,4);await request(t.server).post(base+'/runs').set(bearer(a.access)).send({collectionId,idempotencyKey:'unverified-study-block'}).expect(409);
 });

 it('122-item batch create/checkpoint/submit retains all positions and idempotent wrong counts',async()=>{
  const a=await signup(t),source=toeicFixture(),numbers=Array.from({length:122},(_,i)=>i+1),template=source.questions[2];source.wrongNumbers=[1];source.replayNumbers=numbers;source.groups=[{...source.groups[2],questionNumbers:numbers,passage:'Synthetic batch passage',passageVerified:true}];source.questions=numbers.map(number=>({...structuredClone(template),number,part:7,groupId:source.groups[0].id}));const collectionId=await storePrivateToeicCollection(pool,a.userId,source);const created=await request(t.server).post(base+'/runs').set(bearer(a.access)).send({collectionId,idempotencyKey:'batch-122-create'}).expect(201),path=base+'/runs/'+created.body.run.id;const active=await request(t.server).post(path+'/start').set(bearer(a.access)).send({}).expect(201);assert.equal(active.body.items.length,122);const answers=numbers.map((n,position)=>({position,optionId:n===1?'B':'A'}));const saved=await request(t.server).put(path+'/checkpoint').set(bearer(a.access)).send({revision:active.body.run.revision,cursor:121,paused:false,answers}).expect(200);const payload={revision:saved.body.run.revision,cursor:121,answers,submissionKey:'batch-122-submit'};const final=await request(t.server).post(path+'/submit').set(bearer(a.access)).send(payload).expect(201);assert.equal(final.body.run.result.correct,121);assert.equal(final.body.items[0].studyHistory.wrongCount,2);assert.equal(final.body.items[121].studyHistory.wrongCount,0);const retry=await request(t.server).post(path+'/submit').set(bearer(a.access)).send(payload).expect(201);assert.equal(retry.body.items[0].studyHistory.wrongCount,2);assert.equal(retry.body.items.length,122);await pool.query("INSERT INTO hanq.toeic_cbt_verification_runs(user_id,run_id,purpose) VALUES($1,$2,'deployment-verification')",[a.userId,created.body.run.id]);const annotated=await request(t.server).get(path).set(bearer(a.access)).expect(200);assert.equal(annotated.body.run.verification,true);assert.equal(annotated.body.items[0].studyHistory.wrongCount,1);assert.equal(annotated.body.items[0].studyHistory.repeatedWrong,false);const listing=await request(t.server).get(base+'/runs').set(bearer(a.access)).expect(200);assert.equal(listing.body.runs[0].verification,true);await request(t.server).post(path+'/submit').set(bearer(a.access)).send(payload).expect(409);
 });

 it('annotated ready verification attempts cannot become real study attempts',async()=>{const a=await signup(t),source=toeicFixture(),collectionId=await storePrivateToeicCollection(pool,a.userId,source);const created=await request(t.server).post(base+'/runs').set(bearer(a.access)).send({collectionId,idempotencyKey:'readonly-verification-create'}).expect(201);const id=created.body.run.id;await pool.query("INSERT INTO hanq.toeic_cbt_verification_runs(user_id,run_id,purpose) VALUES($1,$2,'deployment-verification')",[a.userId,id]);const rejected=await request(t.server).post(base+'/runs/'+id+'/start').set(bearer(a.access)).send({}).expect(409);assert.equal(rejected.body.error.code,'toeic_verification_readonly');});

});
