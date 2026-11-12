import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import request from 'supertest';
import {join} from 'node:path';
import {DbService} from '../../src/db/db.service';
import {migrate} from '../../src/db/migrator';
import {projectRoot} from '../../src/common/project-root';
import {History81Service} from '../../src/textbook/history81.service';
import {HISTORY81_PDF,quizDigest,type Quiz81} from '../../src/textbook/history81-quiz';
import {testConfig} from '../helpers/env';
import {resetSchema,migrationsDir} from '../helpers/db';
import {startApp,signup,signin,bearer,csrf} from '../helpers/app';

test('opening real DB and HTTP: account/era isolation, split checks, races, retry, relogin and no exam writes',async()=>{
 const current61=process.env.HANQ_QUAL_QUALIFICATION_PROFILE === 'schema61-local-private-retained-base';
 if(current61){const reset=await resetSchema(testConfig());await reset.end();}
 const db=new DbService(testConfig());let app:Awaited<ReturnType<typeof startApp>>|undefined;
 try {
  await migrate(db.pool,current61 ? migrationsDir() : join(projectRoot(),'migrations'));app=await startApp();
  const id='81-2026:opening:synthetic-pair',items=[{id,kind:'fill-in',verification:{status:'source-verified'},blanks:[{id:id+':blank1',answerIds:['a1']},{id:id+':blank2',answerIds:['a2']}],answers:[{id:'a1',text:'first'},{id:'a2',text:'second'}],answer:{text:'first, second',orderMatters:true}}];
  const source={scriptSha256:'255c37fb68122a329cca00ae1c15035590b6a7b21f601e4a5b5f7515fdfbf695'};
  const quiz:Quiz81={schemaVersion:'hanq-source-quiz/1',source,items,version:quizDigest({source,items})};
  app.app.get(History81Service).quiz=async()=>quiz;
  const a=await signup(app),b=await signup(app),route='/api/v1/textbook/revisions/'+HISTORY81_PDF+'/semantic/workspaces/opening';
  const get=async(token:string)=>(await request(app!.server).get(route).set(bearer(token)).expect(200)).body;
  await request(app.server).get(route).expect(401).expect('Cache-Control','private, no-store');
  const mutation={version:quiz.version,revision:0,mutationId:randomUUID(),cursor:0,status:'active',updates:[{itemId:id,values:['first','second'],submitted:false,checkedSlots:[true,false]}],selectedReviewQuestionIds:[id]};
  const races=await Promise.all([request(app.server).put(route).set(bearer(a.access)).send(mutation),request(app.server).put(route).set(bearer(a.access)).send({...mutation,mutationId:randomUUID()})]);
  assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
  const saved=await get(a.access);assert.deepEqual(saved.workspace.responses[id].checkedSlots,[true,false]);assert.equal(saved.workspace.responses[id].correct,null);assert.deepEqual(saved.workspace.selectedReviewQuestionIds,[id]);
  assert.equal((await get(b.access)).revision,0);
  const legacy=await request(app.server).get(route.replace('/opening','/goryeo')).set(bearer(a.access)).expect(200);assert.equal(legacy.body.revision,0);
  const completed={...mutation,revision:1,mutationId:randomUUID(),updates:[{...mutation.updates[0],submitted:true,checkedSlots:[true,true]}]};
  const final=await request(app.server).put(route).set(bearer(a.access)).send(completed).expect(200);assert.equal(final.body.workspace.responses[id].correct,true);
  const retry=await request(app.server).put(route).set(bearer(a.access)).send(completed).expect(200);assert.equal(retry.body.revision,2);
  await request(app.server).post('/api/v1/auth/logout').set(csrf).set('Cookie',a.cookie).send({}).expect(204);
  await request(app.server).get(route).set(bearer(a.access)).expect(401);
  const again=await signin(app,a.email);assert.deepEqual((await get(again.access)).workspace,final.body.workspace);
  assert.equal(Number((await db.pool.query('SELECT count(*) FROM hanq.attempts')).rows[0].count),0);
  assert.equal(Number((await db.pool.query('SELECT count(*) FROM hanq.source_blank_workspaces WHERE user_id=$1',[a.userId])).rows[0].count),1);
 }finally{if(app)await app.close();await db.onModuleDestroy();}
});
