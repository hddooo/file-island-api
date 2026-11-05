import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {Test} from '@nestjs/testing';
import {ValidationPipe} from '@nestjs/common';
import request from 'supertest';
import {History81Controller} from '../../src/textbook/history81.controller';
import {History81Service} from '../../src/textbook/history81.service';
import {HISTORY81_PDF,projectHistory81} from '../../src/textbook/history81-quiz';
import {sourceSlots,sourceGrade} from '../../src/textbook/source-blank-progress';
import {DbService} from '../../src/db/db.service';
import {JoseonScriptService} from '../../src/textbook/joseon-script.service';
import {GoryeoScriptService} from '../../src/textbook/goryeo-script.service';
import {JwtAuthGuard} from '../../src/auth/guards';
import {AuthService} from '../../src/auth/auth.service';
import {TextbookMemberGuard} from '../../src/textbook/textbook-member.guard';
import {ScriptHeadersGuard} from '../../src/textbook/joseon-script.controller';
import {ApiExceptionFilter} from '../../src/common/api-exception.filter';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
function fixture(prompt='(1) Synthetic prompt (    )',answer='synthetic'){
 const markdown=prompt+'\n'+answer,range=(start:number,end:number)=>({start:Buffer.byteLength(markdown.slice(0,start)),end:Buffer.byteLength(markdown.slice(0,end)),sha256:sha(markdown.slice(start,end))});
 const bundle={source:{sha256:sha(markdown)},segments:[{id:'synthetic',markdown}]},recipe={id:'q-synthetic',group:'synthetic',number:1,page:50,prompt:range(0,prompt.length),answer:range(prompt.length+1,markdown.length),fields:[{id:'field-synthetic'}],options:[]};
 return {bundle,recipe,quiz:projectHistory81('goryeo',bundle,[recipe])};
}
type Row={revision:number;workspace:unknown;mutation_id:string;mutation_hash:string;updated_at:string};
function memoryDb(){const rows=new Map<string,Row>(),calls:{sql:string;values:unknown[]}[]=[];let queue=Promise.resolve();
 const query=async(sql:string,values:unknown[])=>{calls.push({sql,values});ensureSql(sql);if(sql.startsWith('SELECT pg_advisory'))return {rows:[]};const key=JSON.stringify(values.slice(0,3));if(sql.startsWith('SELECT'))return {rows:rows.has(key)?[structuredClone(rows.get(key))]:[]};
 const row={revision:values[3] as number,workspace:structuredClone(values[4]),mutation_id:values[5] as string,mutation_hash:values[6] as string,updated_at:'2026-01-01T00:00:00Z'};rows.set(key,row);return {rows:[{updated_at:row.updated_at}]};};
 function ensureSql(sql:string){assert(!/DELETE|UPDATE hanq|source_blank_progress|attempts|users/.test(sql));assert(sql.startsWith('SELECT pg_advisory')||sql.includes('hanq.source_blank_workspaces'));}
 const db={pool:{query},tx:async<T>(run:(q:{query:typeof query})=>Promise<T>)=>{const prior=queue;let release!:()=>void;queue=new Promise<void>(r=>{release=r;});await prior;try{return await run({query});}finally{release();}}} as unknown as DbService;
 return {db,rows,calls};
}
function service(){const mem=memoryDb(),f=fixture(),api=new History81Service(mem.db,{} as JoseonScriptService,{} as GoryeoScriptService);
 api.quiz=async(revision,era)=>{assert.equal(revision,HISTORY81_PDF);assert(era==='goryeo'||era==='joseon');return projectHistory81(era,f.bundle,[f.recipe]);};
 const batch=()=>({version:f.quiz.version,revision:0,mutationId:randomUUID(),cursor:0,status:'active' as const,updates:[{itemId:f.quiz.items[0].id,values:['synthetic'],submitted:true}]});return {...mem,...f,api,batch};}

test('projection validates immutable byte ranges and source geometry; ordered split blank',()=>{
 const f=fixture();assert(sourceGrade(f.quiz.items[0],['synthetic']));assert(!sourceGrade(f.quiz.items[0],['wrong']));
 assert.throws(()=>projectHistory81('goryeo',{...f.bundle,segments:[{id:'synthetic',markdown:'tampered'}]},[f.recipe]),{code:'source_quiz_unavailable'});
 for(const patch of [{start:-1},{end:99999},{sha256:'0'.repeat(64)}])assert.throws(()=>projectHistory81('goryeo',f.bundle,[{...f.recipe,prompt:{...f.recipe.prompt,...patch}}]),{code:'source_quiz_unavailable'});
 const split=fixture('(1) Synthetic pair (  ,   )','first/second').quiz.items[0];assert.equal(sourceSlots(split).length,2);assert(sourceGrade(split,['first','second']));assert(!sourceGrade(split,['second','first']));
 assert.throws(()=>fixture('(1) No blank','x'),{code:'source_quiz_unavailable'});
});
test('GET does not write or import79; owner/era/version keys isolate drafts; grading and completion',async()=>{
 const f=service();assert.deepEqual((await f.api.get('a',HISTORY81_PDF,'goryeo')).workspace.responses,{});assert.equal(f.rows.size,0);
 const result=await f.api.save('a',HISTORY81_PDF,'goryeo',f.batch());assert.equal(result.revision,1);assert.equal(result.workspace.status,'completed');assert.equal(Object.values(result.workspace.responses)[0].correct,true);
 assert.deepEqual((await f.api.get('b',HISTORY81_PDF,'goryeo')).workspace.responses,{});assert.deepEqual((await f.api.get('a',HISTORY81_PDF,'joseon')).workspace.responses,{});
 assert(f.calls.filter(c=>!c.sql.startsWith('SELECT pg_advisory')).every(c=>String(c.values[1]).startsWith('history:81-2026:')));
 const paused=await f.api.save('a',HISTORY81_PDF,'goryeo',{...f.batch(),revision:1,status:'paused',updates:[{...f.batch().updates[0],values:['wrong']}]});assert.equal(paused.workspace.status,'paused');assert.equal(Object.values(paused.workspace.responses)[0].correct,false);
 const clear=await f.api.save('a',HISTORY81_PDF,'goryeo',{...f.batch(),revision:2,updates:[{...f.batch().updates[0],values:[''],checkedSlots:[true]}]});assert.equal(Object.values(clear.workspace.responses)[0].correct,null);assert.equal(Object.values(clear.workspace.responses)[0].submitted,false);
});
test('same mutation retry is idempotent; conflicting retry and concurrent stale revisions fail',async()=>{
 const f=service(),b=f.batch(),first=await f.api.save('a',HISTORY81_PDF,'goryeo',b);assert.deepEqual(await f.api.save('a',HISTORY81_PDF,'goryeo',b),first);
 await assert.rejects(f.api.save('a',HISTORY81_PDF,'goryeo',{...b,status:'paused'}),{code:'source_progress_conflict'});
 const races=await Promise.allSettled([f.api.save('a',HISTORY81_PDF,'goryeo',{...f.batch(),revision:1}),f.api.save('a',HISTORY81_PDF,'goryeo',{...f.batch(),revision:1})]);assert.equal(races.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.api.get('a',HISTORY81_PDF,'goryeo')).revision,2);
});
test('invalid mutations cannot enter a transaction or alter records',async()=>{
 const f=service(),b=f.batch();for(const patch of [{version:'old79'},{revision:-1},{mutationId:'bad'},{cursor:1},{updates:[{...b.updates[0],itemId:'old79'}]},{updates:[b.updates[0],b.updates[0]]},{updates:[{...b.updates[0],values:[]}]},{updates:[{...b.updates[0],values:['x'.repeat(2001)]}]},{updates:[{...b.updates[0],checkedSlots:[]}]}])await assert.rejects(f.api.save('a',HISTORY81_PDF,'goryeo',{...b,...patch}),{code:'invalid_source_progress'});assert.equal(f.calls.length,0);assert.equal(f.rows.size,0);
});
test('unsupported revision/era never consult source or DB, and missing data fails only its route',async()=>{
 const mem=memoryDb();let calls=0;const provider={bundle:async()=>{calls++;throw new Error('missing');}},api=new History81Service(mem.db,provider as unknown as JoseonScriptService,provider as unknown as GoryeoScriptService);
 for(const [rev,era] of [['old79','goryeo'],[HISTORY81_PDF,'opening'],[HISTORY81_PDF,'../joseon']])await assert.rejects(api.quiz(rev,era),{code:'not_found'});assert.equal(calls,0);await assert.rejects(api.quiz(HISTORY81_PDF,'goryeo'));assert.equal(mem.calls.length,0);
});
test('HTTP guards, private errors, DTO owner/grade rejection, bounded save and revoked session',async()=>{
 const f=service();let revoked=false;const token='synthetic-test-session-1234567890';
 const module=await Test.createTestingModule({controllers:[History81Controller],providers:[ScriptHeadersGuard,JwtAuthGuard,TextbookMemberGuard,{provide:History81Service,useValue:f.api},{provide:AuthService,useValue:{authenticate:async(t:string)=>t===token&&!revoked?{userId:'a',sessionId:'synthetic'}:null}}]}).compile();
 const app=module.createNestApplication({logger:false});app.useGlobalFilters(new ApiExceptionFilter());app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));await app.init();
 try{const req=request(app.getHttpServer()),base=`/api/v1/textbook/revisions/${HISTORY81_PDF}/semantic`,route=base+'/workspaces/goryeo';
  for(const endpoint of [route,base+'/quizzes/goryeo']){await req.get(endpoint).expect(401).expect('Cache-Control','private, no-store').expect('X-Content-Type-Options','nosniff').expect('Cross-Origin-Resource-Policy','same-site');await req.get(endpoint).set('Authorization','Bearer invalid-token-1234567890').expect(401);await req.get(endpoint).set('Authorization','Bearer '+token).expect(200);}
  await req.put(route).send(f.batch()).expect(401);for(const patch of [{userId:'b'},{updates:[{...f.batch().updates[0],correct:true}]},{updates:Array(201).fill(f.batch().updates[0])}])await req.put(route).set('Authorization','Bearer '+token).send({...f.batch(),...patch}).expect(400);
  await req.put(route).set('Authorization','Bearer '+token).send(f.batch()).expect(200);revoked=true;await req.get(route).set('Authorization','Bearer '+token).expect(401);await req.put(route).set('Authorization','Bearer '+token).send(f.batch()).expect(401);assert.equal(f.rows.size,1);
 }finally{await app.close();}
});
