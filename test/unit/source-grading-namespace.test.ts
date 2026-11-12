import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Test} from '@nestjs/testing';
import {ValidationPipe} from '@nestjs/common';
import request from 'supertest';
import {AuthService} from '../../src/auth/auth.service';
import {JwtAuthGuard} from '../../src/auth/guards';
import {ApiExceptionFilter} from '../../src/common/api-exception.filter';
import type {DbService,Queryable} from '../../src/db/db.service';
import {TextbookService} from '../../src/textbook/textbook.service';
import {TextbookController} from '../../src/textbook/textbook.controller';
import {TextbookMemberGuard} from '../../src/textbook/textbook-member.guard';
import {History81Service} from '../../src/textbook/history81.service';
import {History81Controller} from '../../src/textbook/history81.controller';
import {HISTORY81_PDF} from '../../src/textbook/history81-quiz';
import {ScriptHeadersGuard} from '../../src/textbook/joseon-script.controller';
import type {JoseonScriptService} from '../../src/textbook/joseon-script.service';
import type {GoryeoScriptService} from '../../src/textbook/goryeo-script.service';
import type {OpeningScriptService} from '../../src/textbook/opening-script.service';
import {semanticQuizId} from '../../src/textbook/semantic-data';
import {notFound} from '../../src/common/app-error';
import {gradingStorageKey,queryGradingVersion,requestedGradingVersion,SourceBlankProgressService,type SourceItem} from '../../src/textbook/source-blank-progress';

const items:SourceItem[]=[{id:'one',kind:'fill-in',verification:{status:'source-verified'},answers:[{id:'a',text:'동의보감(광해군)'}],answer:{text:'동의보감(광해군)',orderMatters:false},blanks:[{id:'b',answerIds:['a']}]}];
test('explicit version and namespace reject malformed values, prefix collisions and oversized keys',()=>{
 assert.equal(requestedGradingVersion(undefined),1);assert.equal(queryGradingVersion(undefined),1);
 assert.equal(gradingStorageKey('prehistory',1),'prehistory');assert.equal(gradingStorageKey('prehistory',2),'grading:v2:prehistory');
 for(const v of [null,'2',3,[],true])assert.throws(()=>requestedGradingVersion(v));
 for(const v of [null,2,'02','3',['2']])assert.throws(()=>queryGradingVersion(v));
 for(const key of ['', 'grading:v2:prehistory','grading:v1:prehistory','../prehistory','x'.repeat(246)])assert.throws(()=>gradingStorageKey(key,2));
 assert.equal(gradingStorageKey('x'.repeat(245),2).length,256);
});

function database(){
 type Row={revision:number;progress?:unknown;workspace?:unknown;mutation_id:string;mutation_hash:string;updated_at:string};
 const rows=new Map<string,Row>(),calls:{sql:string;args:unknown[]}[]=[];let queue=Promise.resolve();
 const query=async(sql:string,args:unknown[]=[])=>{
  calls.push({sql,args:structuredClone(args)});if(sql.includes('pg_advisory'))return {rows:[]};
  assert(sql.includes('hanq.source_blank_progress')||sql.includes('hanq.source_blank_workspaces'));const field=sql.includes('hanq.source_blank_workspaces')?'workspace':'progress',key=field+JSON.stringify(args.slice(0,3));
  if(sql.startsWith('SELECT'))return {rows:rows.has(key)?[structuredClone(rows.get(key))]:[]};
  assert(sql.startsWith('INSERT'));const row={revision:Number(args[3]),[field]:structuredClone(args[4]),mutation_id:String(args[5]),mutation_hash:String(args[6]),updated_at:'fixture'};rows.set(key,row);return {rows:[{updated_at:row.updated_at}]};
 };
 const db={pool:{query},tx:async<T>(fn:(q:Queryable)=>Promise<T>)=>{const old=queue;let release!:()=>void;queue=new Promise<void>(resolve=>{release=resolve});await old;try{return await fn({query} as unknown as Queryable)}finally{release()}}} as unknown as DbService;
 return {db,rows,calls};
}

test('three workspace routes and both progress routes isolate v1/v2, owners, retries and concurrent old/new tabs',async()=>{
 const memory=database(),textbook={semanticQuiz:async(id:string)=>{if(!semanticQuizId(id))throw notFound();return {schemaVersion:'fixture',source:{id},items}},forRevision:async()=>textbook} as unknown as TextbookService;
 const source=new SourceBlankProgressService(memory.db,textbook),history=new History81Service(memory.db,{} as JoseonScriptService,{} as GoryeoScriptService,{} as OpeningScriptService);
 history.quiz=async(_revision,_era)=>({schemaVersion:'fixture',version:'a'.repeat(64),source:{scriptSha256:'b'.repeat(64)},items});
 const tokens={a:'synthetic-owner-a-session-123456789',b:'synthetic-owner-b-session-123456789'};
 const module=await Test.createTestingModule({controllers:[TextbookController,History81Controller],providers:[JwtAuthGuard,TextbookMemberGuard,ScriptHeadersGuard,{provide:AuthService,useValue:{authenticate:async(token:string)=>token===tokens.a?{userId:'a',sessionId:'fixture'}:token===tokens.b?{userId:'b',sessionId:'fixture'}:null}},{provide:TextbookService,useValue:textbook},{provide:SourceBlankProgressService,useValue:source},{provide:History81Service,useValue:history}]}).compile();
 const app=module.createNestApplication({logger:false});app.useGlobalFilters(new ApiExceptionFilter());app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.init();
 try{const req=request(app.getHttpServer());
  for(const route of ['/api/v1/textbook/semantic/workspaces/prehistory',`/api/v1/textbook/revisions/${HISTORY81_PDF}/semantic/workspaces/ancient`,`/api/v1/textbook/revisions/${HISTORY81_PDF}/semantic/workspaces/goryeo`]){
   const get=async(version:1|2,owner:'a'|'b'='a')=>(await req.get(route+(version===2?'?gradingVersion=2':'')).set('Authorization','Bearer '+tokens[owner]).expect(200)).body;
   const put=(body:object)=>req.put(route).set('Authorization','Bearer '+tokens.a).send(body);
   const oldStart=await get(1),body={version:oldStart.version,revision:0,mutationId:randomUUID(),cursor:0,status:'completed',updates:[{itemId:'one',values:['동의보감/광해군'],submitted:true}]};
   const old=(await put(body).expect(200)).body;assert.equal(old.workspace.responses.one.correct,false);assert.equal(old.gradingVersion,1);
   const originalRows=structuredClone([...memory.rows].filter(([key])=>!key.includes('grading:v2:')));
   const newStart=await get(2);assert.equal(newStart.version,old.version);assert.equal(newStart.revision,0);assert.deepEqual(newStart.workspace.responses,{});assert.equal(newStart.gradingStorageScope,'isolated-v2');
   const modern={...body,gradingVersion:2,mutationId:randomUUID()},saved=(await put(modern).expect(200)).body;assert.equal(saved.workspace.responses.one.correct,true);assert.deepEqual(saved.workspace.responses.one.values,body.updates[0].values);assert.equal(saved.gradingVersion,2);
   assert.deepEqual(await get(1),old);assert.deepEqual([...memory.rows].filter(([key])=>!key.includes('grading:v2:')),originalRows);assert.equal((await get(2,'b')).revision,0);
   assert.deepEqual((await put(modern).expect(200)).body,saved);await put({...modern,updates:[]}).expect(409);
   const race=await Promise.all([put({...body,revision:1,mutationId:randomUUID()}),put({...modern,revision:1,mutationId:randomUUID()})]);assert.deepEqual(race.map(r=>r.status),[200,200]);
   const collide=await Promise.all([put({...modern,revision:2,mutationId:randomUUID()}),put({...modern,revision:2,mutationId:randomUUID()})]);assert.deepEqual(collide.map(r=>r.status).sort(),[200,409]);
   for(const version of [null,0,3,'2',false])await put({...modern,revision:3,mutationId:randomUUID(),gradingVersion:version}).expect(400);
   for(const query of ['02','3','2&gradingVersion=1'])await req.get(route+'?gradingVersion='+query).set('Authorization','Bearer '+tokens.a).expect(400);
  }
  for(const base of ['/api/v1/textbook/semantic',`/api/v1/textbook/revisions/${HISTORY81_PDF}/semantic`]){
   const era=base.includes('revisions')?'colonial':'modern',route=base+'/progress/'+era,read=async(version:1|2)=>(await req.get(route+(version===2?'?gradingVersion=2':'')).set('Authorization','Bearer '+tokens.a).expect(200)).body;
   const v1=await read(1),m={version:v1.version,revision:0,mutationId:randomUUID(),position:0,action:'answer',values:['동의보감/광해군']};
   const old=(await req.put(route).set('Authorization','Bearer '+tokens.a).send(m).expect(200)).body;assert.equal(old.progress.responses[0].correct,false);
   const v2=await read(2);assert.equal(v2.revision,0);assert.deepEqual(v2.progress.responses,[]);assert.equal(v2.version,v1.version);
   const saved=(await req.put(route).set('Authorization','Bearer '+tokens.a).send({...m,gradingVersion:2,mutationId:randomUUID()}).expect(200)).body;assert.equal(saved.progress.responses[0].correct,true);assert.deepEqual(await read(1),old);
   const workspace=(await req.get(base+'/workspaces/'+era+'?gradingVersion=2').set('Authorization','Bearer '+tokens.a).expect(200)).body;assert.equal(workspace.revision,0);assert.deepEqual(workspace.workspace.responses,{});
  }
  await req.get('/api/v1/textbook/semantic/workspaces/grading:v2:prehistory?gradingVersion=2').set('Authorization','Bearer '+tokens.a).expect(400);
  assert(memory.calls.filter(c=>c.sql.startsWith('INSERT')).some(c=>String(c.args[1]).startsWith('grading:v2:history:81-2026:')));
  assert(memory.calls.every(c=>!c.sql.includes('source_blank_attempts')));
 }finally{await app.close();}
});
