import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, realpath, rm, symlink, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TextbookController } from '../../src/textbook/textbook.controller';
import { TextbookService, SEMANTIC_REPOSITORY_ROOT } from '../../src/textbook/textbook.service';
import { TextbookMemberGuard } from '../../src/textbook/textbook-member.guard';
import { SourceBlankProgressService } from '../../src/textbook/source-blank-progress';
import { JwtAuthGuard } from '../../src/auth/guards';
import { AuthService } from '../../src/auth/auth.service';
import { APP_CONFIG } from '../../src/common/tokens';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter';
import { loadConfig } from '../../src/config/config';
import { writeSyntheticBundle, syntheticSemanticBundle, syntheticHash } from '../helpers/semantic-source-fixture';
import { writeSyntheticRevision, OLD_PDF_SHA, NEW_PDF_SHA } from '../helpers/textbook-revision-fixture';
const env={NODE_ENV:'test',HANQ_TEST_DATABASE_URL:'postgresql://test:test@127.0.0.1/revisions_test'};
async function fixture(){
 const temp=await realpath(await mkdtemp(join(tmpdir(),'revision-routing-unit-'))),root=join(temp,'revisions');
 const old=await writeSyntheticRevision(root,OLD_PDF_SHA,144),next=await writeSyntheticRevision(root,NEW_PDF_SHA,147);
 const legacy=join(temp,'legacy');await writeSyntheticBundle(legacy,syntheticSemanticBundle(OLD_PDF_SHA,144));
 const config=loadConfig({...env,HANQ_TEXTBOOK_DATA_DIR:old.raw,HANQ_TEXTBOOK_REVISIONS_DIR:root});let revoked=false;
 const module=await Test.createTestingModule({controllers:[TextbookController],providers:[TextbookService,TextbookMemberGuard,JwtAuthGuard,
  {provide:APP_CONFIG,useValue:config},{provide:SEMANTIC_REPOSITORY_ROOT,useValue:legacy},{provide:SourceBlankProgressService,useValue:{}},
  {provide:AuthService,useValue:{authenticate:async(token:string)=>!revoked&&token==='synthetic-revision-unit-session'?{userId:'synthetic-member',sessionId:'synthetic-revision-unit-session'}:null}},
 ]}).compile();const app=module.createNestApplication({logger:false});app.useGlobalFilters(new ApiExceptionFilter());await app.init();
 return {temp,root,old,next,config,app,http:request(app.getHttpServer()),revoke:()=>{revoked=true;},close:async()=>{await app.close();await rm(temp,{recursive:true,force:true});}};
}
const auth={Authorization:'Bearer synthetic-revision-unit-session'},base='/api/v1/textbook',route=(sha:string,suffix:string)=>`${base}/revisions/${sha}/${suffix}`;
test('revision root is opt-in; legacy config shape is unchanged and explicit nonabsolute revision paths fail',()=>{
 assert.deepEqual(loadConfig(env).textbook,{dataDir:null});
 assert.equal((loadConfig({...env,HANQ_TEXTBOOK_REVISIONS_DIR:'/private/test-revisions'}).textbook as {revisionsDir?:string}).revisionsDir,'/private/test-revisions');
 assert.throws(()=>loadConfig({...env,HANQ_TEXTBOOK_REVISIONS_DIR:'relative'}));
});
test('two fixed revisions bind raw/semantic reads, image zoom and exact page bounds; default144 is unchanged',async()=>{
 const f=await fixture();try{
  for(const [sha,pages] of [[OLD_PDF_SHA,144],[NEW_PDF_SHA,147]] as const){
   const manifest=await f.http.get(route(sha,'manifest')).set(auth).expect(200);assert.equal(manifest.body.source.sha256,sha);assert.equal(manifest.body.source.pageCount,pages);
   const semantic=await f.http.get(route(sha,'semantic/manifest')).set(auth).expect(200);assert.equal(semantic.body.source.sha256,sha);
   for(const suffix of [`pages/${pages}`,`pages/${pages}/image`,`semantic/pages/${pages}`,`semantic/figures/p${pages}-figure-1`,'semantic/quizzes/prehistory','semantic/choices/prehistory']){
    const res=await f.http.get(route(sha,suffix)).set(auth).expect(200).expect('Cache-Control',/private, no-store/);assert(!JSON.stringify(res.body).includes(f.temp));
   }
   await f.http.get(route(sha,`pages/${pages}/enhanced`)).set(auth).expect(404);await f.http.get(route(sha,`pages/${pages+1}`)).set(auth).expect(404);
  }
  assert.equal((await f.http.get(base+'/manifest').set(auth).expect(200)).body.source.pageCount,144);
  assert.equal((await f.http.get(base+'/semantic/manifest').set(auth).expect(200)).body.source.sha256,OLD_PDF_SHA);
  await f.http.get(base+'/semantic/pages/147').set(auth).expect(404);
 }finally{await f.close();}
});
test('unconfigured revision routes fail503 without disturbing default; unknown SHA fails404; all new routes keep live private auth',async()=>{
 const f=await fixture();try{
  for(const suffix of ['manifest','pages/1','pages/1/image','pages/1/enhanced','semantic/manifest','semantic/pages/147','semantic/figures/p147-figure-1','semantic/quizzes/prehistory','semantic/choices/prehistory','semantic/progress/prehistory','semantic/workspaces/prehistory'])await f.http.get(route(NEW_PDF_SHA,suffix)).expect(401);
  await f.http.put(route(NEW_PDF_SHA,'semantic/workspaces/prehistory')).send({}).expect(401);await f.http.put(route(NEW_PDF_SHA,'semantic/progress/prehistory')).send({}).expect(401);
  await f.http.get(route('a'.repeat(64),'manifest')).set(auth).expect(404);
  delete (f.config.textbook as {revisionsDir?:string}).revisionsDir;
  await f.http.get(route(NEW_PDF_SHA,'manifest')).set(auth).expect(503);await f.http.get(base+'/manifest').set(auth).expect(200);await f.http.get(base+'/semantic/manifest').set(auth).expect(200);
  f.revoke();await f.http.get(route(NEW_PDF_SHA,'semantic/manifest')).set(auth).expect(401);
 }finally{await f.close();}
});
test('revision metadata, integrity, missing half-bundles, traversal and symlinks fail closed',async()=>{
 const f=await fixture();try{
  const manifest=join(f.next.raw,'manifest.json'),saved=await readFile(manifest);
  await writeFile(manifest,JSON.stringify({...f.next.manifest,source:{...f.next.manifest.source,sha256:OLD_PDF_SHA}}));await f.http.get(route(NEW_PDF_SHA,'semantic/manifest')).set(auth).expect(503);
  await writeFile(manifest,JSON.stringify({...f.next.manifest,source:{...f.next.manifest.source,pageCount:144}}));await f.http.get(route(NEW_PDF_SHA,'manifest')).set(auth).expect(503);
  await writeFile(manifest,saved);const data=join(f.next.raw,'pages/page-147.json'),dataSaved=await readFile(data);await writeFile(data,'{}');await f.http.get(route(NEW_PDF_SHA,'pages/147')).set(auth).expect(503);await writeFile(data,dataSaved);
  const image=join(f.next.raw,'renders/page-147.png'),imageSaved=await readFile(image);await writeFile(image,'<svg/>');await f.http.get(route(NEW_PDF_SHA,'pages/147/image')).set(auth).expect(503);await writeFile(image,imageSaved);
  await rm(data);await symlink(join(f.old.raw,'pages/page-144.json'),data);await f.http.get(route(NEW_PDF_SHA,'pages/147')).set(auth).expect(503);
  const semanticManifest=join(f.next.semantic,'manifest.json'),semSaved=await readFile(semanticManifest);await rm(semanticManifest);await f.http.get(route(NEW_PDF_SHA,'manifest')).set(auth).expect(503);await writeFile(semanticManifest,semSaved);
  for(const sha of ['../raw',NEW_PDF_SHA.toUpperCase(),'unknown'])await f.http.get(route(sha,'semantic/manifest')).set(auth).expect(404);
  await f.http.get(route(NEW_PDF_SHA,'pages/%2e%2e%2fmanifest.json')).set(auth).expect(404);
  const alias=join(f.temp,'alias');await symlink(f.root,alias);(f.config.textbook as {revisionsDir?:string}).revisionsDir=alias;await f.http.get(route(NEW_PDF_SHA,'manifest')).set(auth).expect(503);
 }finally{await f.close();}
});

test('scoped sources reject semantic range/child drift and hash-valid raw children from the other PDF',async()=>{
 const f=await fixture();try{
  const manifestFile=join(f.next.semantic,'manifest.json'),manifest=JSON.parse(await readFile(manifestFile,'utf8'));
  await writeFile(manifestFile,JSON.stringify({...manifest,eraRanges:[{id:'synthetic-era',fromPage:8,toPage:148}]}));await f.http.get(route(NEW_PDF_SHA,'semantic/manifest')).set(auth).expect(503);await writeFile(manifestFile,JSON.stringify(manifest));
  const quizFile=join(f.old.semantic,'quizzes/prehistory.json'),quiz=JSON.parse(await readFile(quizFile,'utf8'));quiz.items[0].source.sha256=NEW_PDF_SHA;await writeFile(quizFile,JSON.stringify(quiz));await f.http.get(route(OLD_PDF_SHA,'semantic/quizzes/prehistory')).set(auth).expect(503);
  const rawFile=join(f.old.raw,'pages/page-144.json'),raw=JSON.parse(await readFile(rawFile,'utf8'));raw.sourceSha256=NEW_PDF_SHA;const bytes=JSON.stringify(raw);await writeFile(rawFile,bytes);f.old.manifest.pages[143].dataSha256=syntheticHash(bytes);await writeFile(join(f.old.raw,'manifest.json'),JSON.stringify(f.old.manifest));await f.http.get(route(OLD_PDF_SHA,'pages/144')).set(auth).expect(503);
  assert.equal((await f.http.get(base+'/semantic/quizzes/prehistory').set(auth).expect(200)).body.source.sha256,OLD_PDF_SHA);
 }finally{await f.close();}
});


test('a scoped page accepts a single render SHA hash while quiz render maps retain bounded numeric page keys',async()=>{
 const f=await fixture();try{
  const page=join(f.old.semantic,'pages/page-144.json'),data=JSON.parse(await readFile(page,'utf8'));data.sourceRenderSha256='a'.repeat(64);await writeFile(page,JSON.stringify(data));await f.http.get(route(OLD_PDF_SHA,'semantic/pages/144')).set(auth).expect(200);
  data.sourceRenderSha256={145:'a'.repeat(64)};await writeFile(page,JSON.stringify(data));await f.http.get(route(OLD_PDF_SHA,'semantic/pages/144')).set(auth).expect(503);
 }finally{await f.close();}
});


test('scoped render provenance accepts single hashes and hash maps; rejects malformed values, arrays, null and out-of-range keys',async()=>{
 const f=await fixture();try{
  for(const [sha,pages,semantic] of [[OLD_PDF_SHA,144,f.old.semantic],[NEW_PDF_SHA,147,f.next.semantic]] as const){
   const page=join(semantic,`pages/page-${pages}.json`),original=JSON.parse(await readFile(page,'utf8'));
   for(const value of ['a'.repeat(64),{1:'a'.repeat(64),[pages]:'B'.repeat(64)}]){
    await writeFile(page,JSON.stringify({...original,sourceRenderSha256:value,pageDimensions:{[pages]:[100,100]}}));
    await f.http.get(route(sha,`semantic/pages/${pages}`)).set(auth).expect(200);
   }
   for(const value of [{[pages]:'not-a-sha256'},{[pages]:null},{[pages]:['a'.repeat(64)]},{[pages]:147},['a'.repeat(64)],null,{[pages+1]:'a'.repeat(64)},{0:'a'.repeat(64)},'not-a-sha256']){
    await writeFile(page,JSON.stringify({...original,sourceRenderSha256:value}));
    await f.http.get(route(sha,`semantic/pages/${pages}`)).set(auth).expect(503);
   }
  }
  await f.http.get(base+'/semantic/pages/144').set(auth).expect(200);
 }finally{await f.close();}
});
