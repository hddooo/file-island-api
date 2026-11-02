import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createPool } from '../../src/db/db.service';
import { migrate } from '../../src/db/migrator';
import { projectRoot } from '../../src/common/project-root';
import { testConfig } from '../helpers/env';
import { bearer, csrf, signup, startApp } from '../helpers/app';
import { writeSyntheticRevision, OLD_PDF_SHA, NEW_PDF_SHA } from '../helpers/textbook-revision-fixture';
const base='/api/v1/textbook',route=(sha:string,suffix:string)=>`${base}/revisions/${sha}/${suffix}`;

test('real createApp/JWT/PG: concurrent immutable old/new source contexts preserve independent CAS, grading, resume and default144',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'textbook-revision-http-test-'))),pool=createPool(testConfig().database);let app:Awaited<ReturnType<typeof startApp>>|undefined;
 try{
  const old=await writeSyntheticRevision(root,OLD_PDF_SHA,144),next=await writeSyntheticRevision(root,NEW_PDF_SHA,147);
  await migrate(pool,join(projectRoot(),'migrations'));app=await startApp({HANQ_TEXTBOOK_DATA_DIR:old.raw,HANQ_TEXTBOOK_REVISIONS_DIR:root});const a=await signup(app),b=await signup(app),http=request(app.server);
  const get=async(path:string,token=a.access)=>(await http.get(path).set(bearer(token)).expect(200).expect('Cache-Control',/private, no-store/)).body;
  for(const sha of [OLD_PDF_SHA,NEW_PDF_SHA]){
   await http.get(route(sha,'semantic/workspaces/prehistory')).expect(401);await http.put(route(sha,'semantic/progress/prehistory')).send({}).expect(401);
   await http.get(route(sha,'semantic/manifest')).set(bearer('synthetic-invalid-token')).expect(401);
  }
  const defaultManifest=await get(base+'/semantic/manifest'),defaultProgress=await get(base+'/semantic/progress/prehistory');assert.equal(defaultManifest.source.sha256,OLD_PDF_SHA);
  const [o,n]=await Promise.all([get(route(OLD_PDF_SHA,'semantic/progress/prehistory')),get(route(NEW_PDF_SHA,'semantic/progress/prehistory'))]);
  assert.equal(o.version,defaultProgress.version);assert.notEqual(o.version,n.version);assert.notEqual(o.version,OLD_PDF_SHA);assert.notEqual(n.version,NEW_PDF_SHA);assert.equal(o.revision,0);assert.equal(n.revision,0);
  const tables=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='hanq' AND tablename NOT IN ('source_blank_progress','source_blank_workspaces') ORDER BY tablename")).rows.map(x=>x.tablename as string);
  const untouched=async()=>{const hashes:Record<string,string>={};for(const table of tables){assert.match(table,/^[a-z_]+$/);const rows=(await pool.query(`SELECT to_jsonb(t) AS row FROM hanq.${table} t ORDER BY to_jsonb(t)::text`)).rows;hashes[table]=createHash('sha256').update(JSON.stringify(rows)).digest('hex');}return hashes;};
  const before=await untouched(),progress=(sha:string)=>route(sha,'semantic/progress/prehistory'),workspace=(sha:string)=>route(sha,'semantic/workspaces/prehistory');
  const put=async(path:string,body:object)=>(await http.put(path).set(bearer(a.access)).send(body).expect(200)).body;
  const oldAnswer={version:o.version,revision:0,mutationId:randomUUID(),action:'answer',position:0,values:['SYNTHETIC A']},newAnswer={...oldAnswer,version:n.version,values:['SYNTHETIC WRONG']};
  const [oa,na]=await Promise.all([put(progress(OLD_PDF_SHA),oldAnswer),put(progress(NEW_PDF_SHA),newAnswer)]);assert.equal(oa.progress.responses[0].correct,true);assert.equal(na.progress.responses[0].correct,false);
  const oldPause={...oldAnswer,revision:1,mutationId:randomUUID(),action:'pause',position:1,values:['SYNTHETIC OLD DRAFT']},newPause={...newAnswer,revision:1,mutationId:randomUUID(),action:'pause',position:1,values:['SYNTHETIC NEW DRAFT']};
  const [op,np]=await Promise.all([put(progress(OLD_PDF_SHA),oldPause),put(progress(NEW_PDF_SHA),newPause)]);
  const [recoveredOld,recoveredNew]=await Promise.all([get(workspace(OLD_PDF_SHA)),get(workspace(NEW_PDF_SHA))]);assert.deepEqual(recoveredOld.workspace.responses[old.bundle.quiz.items[1].id],{values:['SYNTHETIC OLD DRAFT'],submitted:false,correct:null});assert.deepEqual(recoveredNew.workspace.responses[next.bundle.quiz.items[1].id],{values:['SYNTHETIC NEW DRAFT'],submitted:false,correct:null});assert.equal(recoveredOld.workspace.responses[next.bundle.quiz.items[1].id],undefined);assert.equal(recoveredNew.workspace.responses[old.bundle.quiz.items[1].id],undefined);
  const mutationId=randomUUID(),oldBatch={version:o.version,revision:0,mutationId,cursor:2,status:'paused',updates:[{itemId:old.bundle.quiz.items[0].id,values:['SYNTHETIC WRONG'],submitted:true,checkedSlots:[true]},{itemId:old.bundle.quiz.items[1].id,values:['SYNTHETIC OLD EDIT'],submitted:false,checkedSlots:[false]}]},newBatch={version:n.version,revision:0,mutationId,cursor:3,status:'paused',updates:[{itemId:next.bundle.quiz.items[0].id,values:['SYNTHETIC A'],submitted:true,checkedSlots:[true]}]};
  const [ow,nw]=await Promise.all([put(workspace(OLD_PDF_SHA),oldBatch),put(workspace(NEW_PDF_SHA),newBatch)]);assert.equal(ow.workspace.responses[old.bundle.quiz.items[0].id].correct,false);assert.equal(nw.workspace.responses[next.bundle.quiz.items[0].id].correct,true);assert.deepEqual(ow.workspace.responses[old.bundle.quiz.items[1].id].checkedSlots,[false]);
  for(let iteration=0;iteration<3;iteration++){
   const results=await Promise.all([get(workspace(OLD_PDF_SHA)),get(workspace(NEW_PDF_SHA)),get(progress(OLD_PDF_SHA)),get(progress(NEW_PDF_SHA)),put(workspace(OLD_PDF_SHA),oldBatch),put(workspace(NEW_PDF_SHA),newBatch),get(base+'/semantic/progress/prehistory')]);
   assert.deepEqual(results,[ow,nw,op,np,ow,nw,op]);
  }
  const rows=async()=>(await pool.query('SELECT to_jsonb(t) AS row FROM hanq.source_blank_workspaces t WHERE user_id=$1 ORDER BY source_version',[a.userId])).rows;
  const progressRows=async()=>(await pool.query('SELECT to_jsonb(t) AS row FROM hanq.source_blank_progress t WHERE user_id=$1 ORDER BY source_version',[a.userId])).rows;const savedProgressRows=await progressRows();const savedRows=await rows();await http.put(workspace(NEW_PDF_SHA)).set(bearer(a.access)).send(oldBatch).expect(400);await http.put(progress(OLD_PDF_SHA)).set(bearer(a.access)).send(newPause).expect(400);
  await http.put(workspace(OLD_PDF_SHA)).set(bearer(a.access)).send({...oldBatch,mutationId:randomUUID()}).expect(409);await http.put(workspace(OLD_PDF_SHA)).set(bearer(a.access)).send({...oldBatch,userId:b.userId}).expect(400);assert.deepEqual(await rows(),savedRows);assert.deepEqual(await progressRows(),savedProgressRows);
  for(const sha of [OLD_PDF_SHA,NEW_PDF_SHA]){assert.deepEqual((await get(workspace(sha),b.access)).workspace.responses,{});assert.deepEqual((await get(progress(sha),b.access)).progress.responses,[]);}
  for(const [sha,count] of [[OLD_PDF_SHA,144],[NEW_PDF_SHA,147]] as const){const image=await http.get(route(sha,`pages/${count}/image`)).set(bearer(a.access)).expect(200).expect('Content-Type',/image\/png/).expect('X-Content-Type-Options','nosniff');assert.equal(image.body.length,8);await http.get(route(sha,`pages/${count}/enhanced`)).set(bearer(a.access)).expect(404);assert.equal((await get(route(sha,'semantic/quizzes/prehistory'))).source.sha256,sha);}
  assert.deepEqual(await get(base+'/semantic/manifest'),defaultManifest);assert.deepEqual(await get(base+'/semantic/progress/prehistory'),op);assert.deepEqual(await get(base+'/semantic/workspaces/prehistory'),ow);assert.equal((await get(base+'/manifest')).source.sha256,OLD_PDF_SHA);assert.deepEqual(await untouched(),before);
  assert.equal(Number((await pool.query('SELECT count(*) FROM hanq.source_blank_progress WHERE user_id=$1',[a.userId])).rows[0].count),2);assert.equal(savedRows.length,2);
  await http.post('/api/v1/auth/logout').set(csrf).set('Cookie',a.cookie).expect(204);for(const sha of [OLD_PDF_SHA,NEW_PDF_SHA])await http.get(workspace(sha)).set(bearer(a.access)).expect(401);
 }finally{if(app)await app.close();await pool.end();await rm(root,{recursive:true,force:true});}
});

test('real createApp: absent optional revision root affects only new routes; legacy raw/semantic keep old source',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'textbook-revision-unconfigured-test-'))),pool=createPool(testConfig().database);let app:Awaited<ReturnType<typeof startApp>>|undefined;
 try{const old=await writeSyntheticRevision(root,OLD_PDF_SHA,144);await migrate(pool,join(projectRoot(),'migrations'));app=await startApp({HANQ_TEXTBOOK_DATA_DIR:old.raw});const a=await signup(app),http=request(app.server);await http.get(route(NEW_PDF_SHA,'semantic/manifest')).set(bearer(a.access)).expect(503);await http.get(route('a'.repeat(64),'manifest')).set(bearer(a.access)).expect(404);assert.equal((await http.get(base+'/manifest').set(bearer(a.access)).expect(200)).body.source.sha256,OLD_PDF_SHA);assert.equal((await http.get(base+'/semantic/manifest').set(bearer(a.access)).expect(200)).body.source.sha256,OLD_PDF_SHA);
 }finally{if(app)await app.close();await pool.end();await rm(root,{recursive:true,force:true});}
});
