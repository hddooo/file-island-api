import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createPool } from '../../src/db/db.service';
import { migrate } from '../../src/db/migrator';
import { projectRoot } from '../../src/common/project-root';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { sourceSlots, type SourceItem } from '../../src/textbook/source-blank-progress';
import { testConfig } from '../helpers/env';
import {resetSchema,migrationsDir} from '../helpers/db';
const current61=process.env.HANQ_QUAL_QUALIFICATION_PROFILE==='schema61-local-private-retained-base';
import { bearer, csrf, signin, signup, startApp } from '../helpers/app';

test('real loopback DB/API: additive migration, authenticated account isolation, draft/pause/relogin, race and retry; no exam records',async()=>{
 const config=testConfig(),pool=current61?await resetSchema(config):createPool(config.database);let app:Awaited<ReturnType<typeof startApp>>|undefined;
 try{
  await migrate(pool,current61?migrationsDir():join(projectRoot(),'migrations'));app=await startApp();const a=await signup(app),b=await signup(app),route='/api/v1/textbook/semantic/progress/prehistory';
  await request(app.server).get(route).expect(401).expect('Cache-Control',/no-store/);
  await request(app.server).put(route).send({}).expect(401);
  const get=async(token:string)=>(await request(app!.server).get(route).set(bearer(token)).expect(200).expect('Cache-Control',/private, no-store/)).body;
  const start=await get(a.access),untouched=await get(b.access),item=JSON.parse(readFileSync(join(projectRoot(),'private-textbook-semantic-data/quizzes/prehistory.json'),'utf8')).items[0] as SourceItem;
  const v=sourceSlots(item).map(slot=>slot.answerIds.map(id=>item.answers.find(x=>x.id===id)!.text).join(','));
  const mutation={version:start.version,revision:0,mutationId:randomUUID(),position:0,values:v,action:'answer'};
  const secondMutation={...mutation,mutationId:randomUUID()};
  const races=await Promise.all([request(app.server).put(route).set(bearer(a.access)).send(mutation),request(app.server).put(route).set(bearer(a.access)).send(secondMutation)]);
  assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);let saved=await get(a.access);assert.equal(saved.progress.responses.length,1);assert.equal(saved.progress.responses[0].correct,true);assert.deepEqual(await get(b.access),untouched);
  const winner=races.find(r=>r.status===200)!;const winningId=winner===races[0]?mutation.mutationId:secondMutation.mutationId;
  // Repeat a known completed request exactly; it must not append or increment.
  const known={...mutation,mutationId:winningId};const retried=await request(app.server).put(route).set(bearer(a.access)).send(known).expect(200);assert.equal(retried.body.revision,1);
  const nextItem=JSON.parse(readFileSync(join(projectRoot(),'private-textbook-semantic-data/quizzes/prehistory.json'),'utf8')).items[1] as SourceItem;
  const draft=sourceSlots(nextItem).map(()=> '아직 적는 답');
  const paused=await request(app.server).put(route).set(bearer(a.access)).send({version:saved.version,revision:saved.revision,mutationId:randomUUID(),position:1,values:draft,action:'pause'}).expect(200);assert.equal(paused.body.progress.status,'paused');
  await request(app.server).post('/api/v1/auth/logout').set(csrf).set('Cookie',a.cookie).expect(204);
  await request(app.server).get(route).set(bearer(a.access)).expect(401);
  const again=await signin(app,a.email);saved=await get(again.access);assert.equal(saved.progress.position,1);assert.deepEqual(saved.progress.draft,draft);assert.equal(saved.progress.responses.length,1);
  const forbidden=await request(app.server).put(route).set(bearer(again.access)).send({version:saved.version,revision:saved.revision,mutationId:randomUUID(),position:1,values:draft,action:'answer',userId:b.userId});assert.equal(forbidden.status,400);
  const workspaceRoute='/api/v1/textbook/semantic/workspaces/prehistory';
  await request(app.server).get(workspaceRoute).expect(401);
  const workspaceStart=(await request(app.server).get(workspaceRoute).set(bearer(again.access)).expect(200)).body;
  assert.equal(workspaceStart.workspace.responses[item.id].correct,true);assert.deepEqual(workspaceStart.workspace.responses[nextItem.id].values,draft);
  const otherStart=(await request(app.server).get(workspaceRoute).set(bearer(b.access)).expect(200)).body;assert.deepEqual(otherStart.workspace.responses,{});
  const edits={version:workspaceStart.version,revision:0,mutationId:randomUUID(),cursor:1,status:'active',updates:[{itemId:item.id,values:v.map(()=> '원문에 없는 답'),submitted:true},{itemId:nextItem.id,values:draft,submitted:false}]};
  const editSaved=await request(app.server).put(workspaceRoute).set(bearer(again.access)).send(edits).expect(200);assert.equal(editSaved.body.workspace.responses[item.id].correct,false);
  const repeated=await request(app.server).put(workspaceRoute).set(bearer(again.access)).send(edits).expect(200);assert.equal(repeated.body.revision,editSaved.body.revision);
  const unchangedLegacy=await get(again.access);assert.deepEqual(unchangedLegacy.progress,saved.progress);
  await request(app.server).put(workspaceRoute).set(bearer(again.access)).send({...edits,mutationId:randomUUID()}).expect(409);
  await request(app.server).put(workspaceRoute).set(bearer(again.access)).send({...edits,revision:1,mutationId:randomUUID(),updates:[{...edits.updates[0],correct:true}]}).expect(400);
  const relogin=await signin(app,a.email);const readBack=(await request(app.server).get(workspaceRoute).set(bearer(relogin.access)).expect(200)).body;assert.deepEqual(readBack.workspace,editSaved.body.workspace);
  assert.deepEqual((await request(app.server).get(workspaceRoute).set(bearer(b.access)).expect(200)).body,otherStart);
  assert.equal(Number((await pool.query('SELECT count(*) FROM hanq.attempts')).rows[0].count),0);
  assert.equal(Number((await pool.query('SELECT count(*) FROM hanq.source_blank_progress WHERE user_id=$1',[a.userId])).rows[0].count),1);
 }finally{if(app)await app.close();await pool.end();}
});

// Real PG/application/auth remain in use. Only source delivery is synthetic and instance-local.
import { TextbookService } from '../../src/textbook/textbook.service';
import { History81Service } from '../../src/textbook/history81.service';
import { HISTORY81_PDF } from '../../src/textbook/history81-quiz';

test('real PG v2 storage: five HTTP routes complete, race/retry, preserve v1 rows and isolate accounts', async () => {
 const config=testConfig(),pool=current61?await resetSchema(config):createPool(config.database);let app:Awaited<ReturnType<typeof startApp>>|undefined;
 try {
  await migrate(pool,current61?migrationsDir():join(projectRoot(),'migrations'));
  app=await startApp();const a=await signup(app),b=await signup(app);
  const items:SourceItem[]=[{id:'synthetic-pg-v2-one',kind:'fill-in',verification:{status:'source-verified'},answers:[{id:'a',text:'동의보감(광해군)'}],answer:{text:'동의보감(광해군)',orderMatters:false},blanks:[{id:'b',answerIds:['a']}]}];
  const textbook=app.app.get(TextbookService),history=app.app.get(History81Service);
  textbook.semanticQuiz=async(id:string)=>({schemaVersion:'synthetic-real-pg-v2',source:{id},items}) as Awaited<ReturnType<TextbookService['semanticQuiz']>>;
  textbook.forRevision=async()=>textbook;
  history.quiz=async()=>({schemaVersion:'synthetic-real-pg-v2',version:'a'.repeat(64),source:{scriptSha256:'b'.repeat(64)},items}) as Awaited<ReturnType<History81Service['quiz']>>;
  const req=request(app.server),routes=[
   {route:'/api/v1/textbook/semantic/workspaces/prehistory',workspace:true},
   {route:`/api/v1/textbook/revisions/${HISTORY81_PDF}/semantic/workspaces/ancient`,workspace:true},
   {route:`/api/v1/textbook/revisions/${HISTORY81_PDF}/semantic/workspaces/goryeo`,workspace:true},
   {route:'/api/v1/textbook/semantic/progress/modern',workspace:false},
   {route:`/api/v1/textbook/revisions/${HISTORY81_PDF}/semantic/progress/colonial`,workspace:false},
  ];
  const snapshot=async()=>{
   const result=[];
   for(const table of ['source_blank_progress','source_blank_workspaces']) {
    const rows=await pool.query(`SELECT to_jsonb(t) AS row FROM hanq.${table} t WHERE user_id=$1 AND quiz_id NOT LIKE 'grading:v2:%' ORDER BY quiz_id,source_version`,[a.userId]);
    result.push({table,rows:rows.rows});
   }
   return result;
  };
  for(const {route,workspace} of routes) {
   const get=async(version:1|2,token=a.access)=>(await req.get(route+(version===2?'?gradingVersion=2':'')).set(bearer(token)).expect(200)).body;
   const put=(body:object)=>req.put(route).set(bearer(a.access)).send(body);
   await req.get(route+'?gradingVersion=2').expect(401);
   const oldStart=await get(1),values=['동의보감/광해군'];
   const payload=workspace?{cursor:0,status:'completed',updates:[{itemId:items[0].id,values,submitted:true}]}:{position:0,action:'answer',values};
   const oldMutation={...payload,version:oldStart.version,revision:0,mutationId:randomUUID()};
   const old=(await put(oldMutation).expect(200)).body;
   assert.equal(workspace?old.workspace.responses[items[0].id].correct:old.progress.responses[0].correct,false);
   const legacyBefore=await snapshot(),modernStart=await get(2),otherBefore=await get(2,b.access);
   assert.equal(modernStart.version,oldStart.version);assert.equal(modernStart.gradingVersion,2);assert.equal(modernStart.gradingStorageScope,'isolated-v2');assert.equal(modernStart.revision,0);
   assert.deepEqual(workspace?modernStart.workspace.responses:modernStart.progress.responses,workspace?{}:[]);
   const left={...oldMutation,gradingVersion:2,mutationId:randomUUID()},right={...left,mutationId:randomUUID()};
   const raced=await Promise.all([put(left),put(right)]);assert.deepEqual(raced.map(x=>x.status).sort(),[200,409]);
   const winner=raced[0].status===200?left:right,saved=raced.find(x=>x.status===200)!.body;
   assert.equal(saved.revision,1);assert.equal(saved.version,old.version);assert.equal(saved.gradingVersion,2);
   assert.equal(workspace?saved.workspace.status:saved.progress.status,'completed');
   const response=workspace?saved.workspace.responses[items[0].id]:saved.progress.responses[0];
   assert.equal(response.correct,true);assert.deepEqual(response.values,values);
   assert.deepEqual((await put(winner).expect(200)).body,saved);
   const changed=workspace?{...winner,updates:[{itemId:items[0].id,values:['different'],submitted:true}]}:{...winner,values:['different']};
   await put(changed).expect(409);
   assert.deepEqual(await get(2),saved);assert.deepEqual(await get(1),old);assert.deepEqual(await snapshot(),legacyBefore);
   assert.deepEqual(await get(2,b.access),otherBefore);
   const table=workspace?'source_blank_workspaces':'source_blank_progress';
   const persisted=await pool.query(`SELECT quiz_id,source_version,revision,${workspace?'workspace':'progress'} AS payload FROM hanq.${table} WHERE user_id=$1 AND source_version=$2 AND quiz_id LIKE 'grading:v2:%'`,[a.userId,saved.version]);
   // Distinct textbook quiz versions and history81 source version make this selection unambiguous.
   assert.equal(persisted.rows.length,1);assert.equal(persisted.rows[0].revision,1);assert.equal(persisted.rows[0].source_version,saved.version);
   assert(persisted.rows[0].quiz_id.startsWith('grading:v2:'));assert.deepEqual(persisted.rows[0].payload,workspace?saved.workspace:saved.progress);
   assert.equal(Number((await pool.query(`SELECT count(*) FROM hanq.${table} WHERE user_id=$1`,[b.userId])).rows[0].count),0);
  }
  assert.equal(Number((await pool.query('SELECT count(*) FROM hanq.attempts WHERE user_id=$1',[a.userId])).rows[0].count),0);
 } finally {if(app)await app.close();await pool.end();}
});
