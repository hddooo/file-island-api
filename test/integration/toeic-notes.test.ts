import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Pool } from 'pg';
import request from 'supertest';
import { bearer, signup, startApp, type Session, type TestApp } from '../helpers/app';
import { freshDatabase, migrationsDir } from '../helpers/db';
import { migrate } from '../../src/db/migrator';
import { testConfig } from '../helpers/env';
// Never run with production: helpers require NODE_ENV=test, loopback and a *_test database before reset.
describe('TOEIC notes: real PostgreSQL ownership, unique keys, transactions and concurrent revision checks',()=>{
 let t:TestApp,pool:Pool;
 before(async()=>{pool=await freshDatabase(testConfig());t=await startApp();});
 after(async()=>{if(t)await t.close();if(pool)await pool.end();});
 const data=(expression:string,revision=0)=>({part:'3-4',expression,meaning:'synthetic test meaning',structure:'',example:'',confusion:'',sourceText:'',sourceReference:'',revision});
 const save=(s:Session,id:string,d:ReturnType<typeof data>)=>request(t.server).put('/api/v1/toeic-notes/'+id).set(bearer(s.access)).send(d);
 const list=(s:Session)=>request(t.server).get('/api/v1/toeic-notes').set(bearer(s.access));
 it('empty by default; owner-local uniqueness; atomic merge; no graded attempts; stale concurrent save cannot overwrite',async()=>{
  const a=await signup(t),b=await signup(t),id=randomUUID(),other=randomUUID(),foreign=randomUUID();
  await request(t.server).get('/api/v1/toeic-notes').expect(401);
  assert.deepEqual((await list(a)).body,{notes:[],archived:[],visibility:'private',canManage:true});
  await save(a,id,data('Synthetic Phrase')).expect(200);
  await save(b,id,data('Synthetic Phrase')).expect(200); // same IDs and normalized expression remain independent
  await save(a,other,data('  SYNTHETIC   PHRASE  ')).expect(409);
  await save(a,other,data('synthetic variant')).expect(200);
  await save(b,foreign,data('foreign phrase')).expect(200);
  await request(t.server).post('/api/v1/toeic-notes/'+id+'/merge').set(bearer(a.access)).send({sourceId:foreign,sourceRevision:1,targetRevision:1}).expect(404);
  const updates=await Promise.all([save(a,id,{...data('Synthetic Phrase',1),meaning:'first competing edit'}),save(a,id,{...data('Synthetic Phrase',1),meaning:'second competing edit'})]);
  assert.deepEqual(updates.map(r=>r.status).sort(),[200,409]);
  const current=(await list(a)).body.notes.find((n:{id:string})=>n.id===id);
  const merged=await request(t.server).post('/api/v1/toeic-notes/'+id+'/merge').set(bearer(a.access)).send({sourceId:other,sourceRevision:1,targetRevision:current.revision}).expect(201);
  assert.match(merged.body.note.sourceReference,/synthetic variant/);
  assert.equal((await list(a)).body.notes.length,1);
  assert.equal((await list(b)).body.notes.length,2);
  assert.equal((await list(b)).body.notes.find((n:{id:string})=>n.id===id).meaning,'synthetic test meaning');
  await request(t.server).put('/api/v1/toeic-notes/'+other+'/archive').set(bearer(a.access)).send({archived:false}).expect(200);
  await save(a,other,{...data('oversize merge',1),meaning:'x'.repeat(6000)}).expect(200);
  await request(t.server).post('/api/v1/toeic-notes/'+id+'/merge').set(bearer(a.access)).send({sourceId:other,sourceRevision:2,targetRevision:merged.body.note.revision}).expect(400);
  assert.equal((await list(a)).body.notes.length,2,'overflow must roll back both notes');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM hanq.attempts WHERE user_id=ANY($1::uuid[])',[[a.userId,b.userId]])).rows[0].n,0);
 });
 it('019 is applied once, new table is private, rerunning migrations preserves all stored notes',async()=>{
  const applied=await pool.query("SELECT version FROM hanq.schema_migrations WHERE version='019_toeic_notes.sql'");
  assert.equal(applied.rowCount,1);
  const privacy=await pool.query("SELECT has_table_privilege('public','hanq.toeic_notes','SELECT') AS readable, has_schema_privilege('public','hanq','USAGE') AS usable");
  assert.deepEqual(privacy.rows[0],{readable:false,usable:false});
  for(const table of ['toeic_recall_progress','toeic_recall_view'])assert.equal((await pool.query("SELECT has_table_privilege('public',$1,'SELECT') AS readable",['hanq.'+table])).rows[0].readable,false);
  const before=(await pool.query('SELECT user_id,id,revision,meaning FROM hanq.toeic_notes ORDER BY user_id,id')).rows;
  assert.ok(before.length>0);
  const rerun=await migrate(pool,migrationsDir());
  assert.deepEqual(rerun.applied,[]);
  assert.equal(rerun.alreadyApplied,25);
  assert.deepEqual((await pool.query('SELECT user_id,id,revision,meaning FROM hanq.toeic_notes ORDER BY user_id,id')).rows,before);
 });

 it('recall persists Korean answers and explicit self-assessment per account, detects concurrent writes and invalidates changed notes',async()=>{
  const a=await signup(t),b=await signup(t),id=randomUUID(),source=randomUUID();
  await save(a,id,data('synthetic recall word')).expect(200);
  const route='/api/v1/toeic-recall';
  const read=(s:Session)=>request(t.server).get(route).set(bearer(s.access));
  const put=(s:Session,noteId:string,d:object)=>request(t.server).put(route+'/'+noteId).set(bearer(s.access)).send(d);
  await request(t.server).get(route).expect(401);
  await read(a).expect(200,{progress:[],view:{part:'',batch:0}});
  const answer={noteRevision:1,revision:0,answer:'완전일치가 아닌 한국어 회상',revealed:false,evaluation:''};
  await put(b,id,answer).expect(404);
  await put(a,id,{...answer,userId:b.userId}).expect(400);
  await put(a,id,{...answer,answer:' ',revealed:true}).expect(400);
  await put(a,id,{...answer,evaluation:'known'}).expect(400);
  const initial=await put(a,id,answer).expect(200);
  assert.equal(initial.body.progress.answer,answer.answer);
  assert.equal('correct' in initial.body.progress,false,'no automatic exact-match grading');
  assert.equal((await read(b)).body.progress.length,0);
  await request(t.server).put(route+'/view').set(bearer(a.access)).send({part:'3-4',batch:2}).expect(200);
  assert.deepEqual((await read(a)).body.view,{part:'3-4',batch:2});
  assert.deepEqual((await read(b)).body.view,{part:'',batch:0});
  await put(a,id,{...answer,revision:1,revealed:true}).expect(200);
  const evaluated={...answer,revision:2,revealed:true,evaluation:'review'};
  await put(a,id,evaluated).expect(200);
  const retry=await put(a,id,evaluated).expect(200);
  assert.equal(retry.body.progress.revision,3);
  assert.equal((await read(a)).body.progress[0].evaluation,'review');
  const races=await Promise.all([put(a,id,{...answer,revision:3,answer:'동시 입력 하나'}),put(a,id,{...answer,revision:3,answer:'동시 입력 둘'})]);
  assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
  await save(a,id,{...data('synthetic recall word',1),meaning:'바뀐 뜻'}).expect(200);
  assert.equal((await read(a)).body.progress.length,0,'source edit hides stale self-assessment');
  await put(a,id,{...answer,revision:4}).expect(409);
  await put(a,id,{...answer,noteRevision:2}).expect(200);
  await save(a,source,data('synthetic merged word')).expect(200);
  await put(a,source,answer).expect(200);
  await request(t.server).post('/api/v1/toeic-notes/'+id+'/merge').set(bearer(a.access)).send({sourceId:source,sourceRevision:1,targetRevision:2}).expect(201);
  assert.equal((await read(a)).body.progress.length,0,'merged target revision and archived source cannot reuse old progress');
  assert.equal((await pool.query('SELECT 1 FROM hanq.toeic_recall_progress WHERE user_id=$1 AND note_id=$2',[a.userId,source])).rowCount,1);
  assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.attempts WHERE user_id=ANY($1::uuid[])',[[a.userId,b.userId]])).rows[0].n,0);
 });

 it('vocabulary-only refinement stores unknown source classification, original example, translation, POS and up to three related expressions',async()=>{
  const a=await signup(t),id=randomUUID();
  const d={...data('synthetic contextual word'),part:'unclassified',example:'Original English fixture sentence.',translation:'원문 테스트 해석',partOfSpeech:'동사구',synonyms:['contextual paraphrase (의미 차이 메모)']};
  const created=await save(a,id,d).expect(200);assert.equal(created.body.note.part,'unclassified');assert.equal(created.body.note.translation,d.translation);assert.equal(created.body.note.partOfSpeech,d.partOfSpeech);assert.deepEqual(created.body.note.synonyms,d.synonyms);
  const legacy=await save(a,id,{...data('synthetic contextual word',1),part:'unclassified'}).expect(200);assert.equal(legacy.body.note.translation,d.translation);assert.deepEqual(legacy.body.note.synonyms,d.synonyms,'older clients omitting new fields preserve their data');
  await save(a,randomUUID(),{...d,expression:'bad related list',synonyms:['a','b','c','d']} as typeof d).expect(400);
  await request(t.server).put('/api/v1/toeic-recall/view').set(bearer(a.access)).send({part:'unclassified',batch:0}).expect(200);
  assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.toeic_cbt_runs WHERE user_id=$1',[a.userId])).rows[0].n,0,'editing vocabulary never creates a replay run');
 });

 it('one published owner notebook is shared with current and future members, while all mutations remain owner-only',async()=>{
  const a=await signup(t),b=await signup(t),id=randomUUID(),privateId=randomUUID(),hidden=randomUUID();
  await save(a,id,data('shared fixture')).expect(200);await save(a,hidden,data('archived owner fixture')).expect(200);
  await request(t.server).put('/api/v1/toeic-notes/'+hidden+'/archive').set(bearer(a.access)).send({archived:true}).expect(200);
  await save(b,privateId,data('unrelated private fixture')).expect(200);
  const privateBefore=(await pool.query('SELECT * FROM hanq.toeic_notes WHERE user_id=$1',[b.userId])).rows;
  await pool.query('INSERT INTO hanq.toeic_member_notebook(owner_id) VALUES($1)',[a.userId]);
  try{
   const c=await signup(t);
   await request(t.server).get('/api/v1/toeic-notes').expect(401);
   for(const member of [a,b,c]){const r=await list(member).expect(200);assert.deepEqual(r.body.notes.map((n:{id:string})=>n.id),[id]);assert.equal(r.body.visibility,'members');assert.equal(r.body.canManage,member===a);assert.equal(r.body.archived.length,member===a?1:0);assert.equal(JSON.stringify(r.body).includes(a.userId),false);}
   for(const member of [b,c]){
    await save(member,randomUUID(),data('unauthorized create')).expect(403);
    await save(member,id,data('unauthorized overwrite',1)).expect(403);
    await save(member,privateId,data('unauthorized private edit',1)).expect(403);
    for(const archived of [true,false])await request(t.server).put('/api/v1/toeic-notes/'+id+'/archive').set(bearer(member.access)).send({archived}).expect(403);
    await request(t.server).post('/api/v1/toeic-notes/'+id+'/merge').set(bearer(member.access)).send({sourceId:hidden,sourceRevision:1,targetRevision:1}).expect(403);
    await request(t.server).delete('/api/v1/toeic-notes/'+id).set(bearer(member.access)).expect(404);
    await request(t.server).put('/api/v1/toeic-notes/'+id).set(bearer(member.access)).send({...data('injected'),userId:a.userId}).expect(400);
   }
   assert.deepEqual((await pool.query('SELECT * FROM hanq.toeic_notes WHERE user_id=$1',[b.userId])).rows,privateBefore);
   const future=randomUUID();await save(a,future,data('future shared fixture')).expect(200);
   assert.equal((await list(c)).body.notes.length,2);
   await save(a,id,{...data('shared fixture',1),meaning:'owner revision'}).expect(200);
   assert.equal((await list(b)).body.notes.find((n:{id:string})=>n.id===id).meaning,'owner revision');
   await request(t.server).post('/api/v1/toeic-notes/'+id+'/merge').set(bearer(a.access)).send({sourceId:future,sourceRevision:1,targetRevision:2}).expect(201);
   assert.equal((await list(c)).body.notes.length,1);
   assert.equal((await pool.query('SELECT 1 FROM hanq.toeic_notes WHERE user_id=$1 AND id=$2 AND archived_at IS NOT NULL',[a.userId,future])).rowCount,1,'merge retains physical source');
  }finally{await pool.query('DELETE FROM hanq.toeic_member_notebook');}
 });

});
// Archive/restore is tested separately from merging to prove no physical deletion or recall mutation.
describe('reversible notebook archive',()=>{
 let t:TestApp,pool:Pool;
 before(async()=>{pool=await freshDatabase(testConfig());t=await startApp();});
 after(async()=>{if(t)await t.close();if(pool)await pool.end();});
 it('owner archive hides one note, blocks other owners, restores identical note and recall record',async()=>{
 const a=await signup(t),b=await signup(t),id=randomUUID();
 const d={part:'2',expression:'synthetic archive note',meaning:'synthetic meaning',structure:'',example:'English original.',translation:'합성 해석',confusion:'',sourceText:'',sourceReference:'',revision:0};
 await request(t.server).put('/api/v1/toeic-notes/'+id).set(bearer(a.access)).send(d).expect(200);
 await request(t.server).put('/api/v1/toeic-recall/'+id).set(bearer(a.access)).send({noteRevision:1,revision:0,answer:'synthetic answer',revealed:true,evaluation:'known'}).expect(200);
 const before=(await pool.query('SELECT * FROM hanq.toeic_recall_progress WHERE user_id=$1 AND note_id=$2',[a.userId,id])).rows[0];
 await request(t.server).put('/api/v1/toeic-notes/'+id+'/archive').set(bearer(b.access)).send({archived:true}).expect(404);
 await request(t.server).put('/api/v1/toeic-notes/'+id+'/archive').set(bearer(a.access)).send({archived:true}).expect(200);
 let list=await request(t.server).get('/api/v1/toeic-notes').set(bearer(a.access)).expect(200);assert.equal(list.body.notes.length,0);assert.equal(list.body.archived.length,1);
 await request(t.server).put('/api/v1/toeic-notes/'+id+'/archive').set(bearer(a.access)).send({archived:false}).expect(200);
 list=await request(t.server).get('/api/v1/toeic-notes').set(bearer(a.access)).expect(200);assert.equal(list.body.notes.length,1);assert.equal(list.body.notes[0].example,d.example);assert.equal(list.body.notes[0].revision,1);
 assert.deepEqual((await pool.query('SELECT * FROM hanq.toeic_recall_progress WHERE user_id=$1 AND note_id=$2',[a.userId,id])).rows[0],before);
 });
});
