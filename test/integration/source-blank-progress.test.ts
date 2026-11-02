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
import { bearer, csrf, signin, signup, startApp } from '../helpers/app';

test('real loopback DB/API: additive migration, authenticated account isolation, draft/pause/relogin, race and retry; no exam records',async()=>{
 const config=testConfig(),pool=createPool(config.database);let app:Awaited<ReturnType<typeof startApp>>|undefined;
 try{
  await migrate(pool,join(projectRoot(),'migrations'));app=await startApp();const a=await signup(app),b=await signup(app),route='/api/v1/textbook/semantic/progress/prehistory';
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
