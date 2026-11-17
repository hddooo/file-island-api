import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import type {DbService,Queryable} from '../../src/db/db.service';
import type {TextbookService} from '../../src/textbook/textbook.service';
import {SourceBlankProgressService} from '../../src/textbook/source-blank-progress';
import {randomUUID} from 'node:crypto';
import {sourceGrade,applySourceBatch,initialSourceProgress,workspaceFromLegacy,type SourceItem,type SourceBatch} from '../../src/textbook/source-blank-progress';
function item(answer:string):SourceItem{return {id:'synthetic-date-event',kind:'fill-in',verification:{status:'source-verified'},answers:[{id:'a',text:answer}],answer:{text:answer,orderMatters:false},blanks:[{id:'b',answerIds:['a']}]};}
const {positive,negative}:{positive:[string,string[]][];negative:[string,string][]}=JSON.parse(readFileSync('test/fixtures/canonical-input-aliases.json','utf8'));
test('audited canonical typing aliases are authoritative for explicit canonical events and preserve saved input',()=>{
 for(const [canonical,values] of positive){const q=item(canonical),before=JSON.stringify(q);
 for(const value of values){assert(sourceGrade(q,[value],2),canonical+' <- '+value);
 const initial=workspaceFromLegacy(initialSourceProgress(),1);
 const saved=applySourceBatch([q],initial,{version:'fixture',revision:0,mutationId:randomUUID(),cursor:0,status:'active',updates:[{itemId:q.id,values:[value],submitted:true,checkedSlots:[true]}]},2);
 assert.equal(saved.responses[q.id].correct,true);assert.deepEqual(saved.responses[q.id].values,[value]);assert.equal(JSON.stringify(q),before);
 assert.equal(sourceGrade(q,[value],1),value.replace(/\s/g,'')===canonical.replace(/\s/g,''),'legacy grading contract stays strict');
 }}
});
test('canonical aliases reject different facts and ambiguous partial answers',()=>{for(const [canonical,value] of negative)assert.equal(sourceGrade(item(canonical),[value],2),false,canonical+' <- '+value);});

test('actual source workspace service grades aliases with isolated ownership and idempotency (in-memory DB adapter)',async()=>{
 const files=(process.env.HANQ_ALIAS_QUIZ_FIXTURES||'').split(';').filter(Boolean);
 const fixtures=files.length?files.map(file=>JSON.parse(readFileSync(file,'utf8'))):[{schemaVersion:'hanq-source-quiz/1',source:{sha256:'a'.repeat(64)},items:positive.map(([c],i)=>({...item(c),id:'synthetic-'+i}))}];
 for(const data of fixtures){
 const before=JSON.stringify(data),rows=new Map<string,Record<string,unknown>>();
 const query={query:async(sql:string,args:unknown[]=[])=>{
  if(sql.includes('pg_advisory'))return {rows:[]};
  const key=args.slice(0,3).join(':');
  if(sql.startsWith('SELECT'))return {rows:rows.has(key)?[structuredClone(rows.get(key))]:[]};
  assert(sql.startsWith('INSERT INTO hanq.source_blank_workspaces'));
  rows.set(key,{revision:Number(args[3]),workspace:structuredClone(args[4]),mutation_id:String(args[5]),mutation_hash:String(args[6]),updated_at:'fixture-time'});
  return {rows:[{updated_at:'fixture-time'}]};
 }};
 const db={pool:query,tx:async<T>(fn:(q:Queryable)=>Promise<T>)=>fn(query as unknown as Queryable)} as unknown as DbService;
 const textbook={semanticQuiz:async()=>data} as unknown as TextbookService,svc=new SourceBlankProgressService(db,textbook);
 const untouched=await svc.getWorkspace('other-owner','modern',textbook,2);
 for(const [canonical,values] of positive){
 const q=(data.items as SourceItem[]).find(i=>i.answer.text.replace(/\s/g,'')===canonical.replace(/\s/g,''));if(!q)continue;
 for(const value of values){
 const current=await svc.getWorkspace('synthetic-owner','modern',textbook,2);
 const mutation:SourceBatch={gradingVersion:2 as const,version:current.version,revision:current.revision,mutationId:randomUUID(),cursor:0,status:'active' as const,updates:[{itemId:q.id,values:[value],submitted:true,checkedSlots:[true]}]};
 const saved=await svc.saveWorkspace('synthetic-owner','modern',mutation,textbook);
 assert.equal(saved.workspace.responses[q.id].correct,true,q.id+' '+canonical+' <- '+value);assert.deepEqual(saved.workspace.responses[q.id].values,[value]);
 assert.deepEqual(await svc.saveWorkspace('synthetic-owner','modern',mutation,textbook),saved);
 }}
 assert.deepEqual(await svc.getWorkspace('other-owner','modern',textbook,2),untouched);
 assert.equal(JSON.stringify(data),before);
 }
});
