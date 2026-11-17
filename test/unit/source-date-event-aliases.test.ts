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
const positive:[string,string[]][]=[
 ['5·18 민주화운동',['518','5.18','5·18','5ㆍ18','5.18 민주화 운동','518민주화운동',' 5 . 18 민주화 운동 ']],
 ['4·19 혁명',['419','4.19','4·19','4ㆍ19','4.19 혁명','419혁명']],
 ['6·3 시위',['63','6.3','6·3','6.3 시위','63시위']],
 ['3·1 운동',['31','3.1','3·1','3.1 운동','31운동','삼일운동']],
 ['6·10 만세운동',['6.10 만세운동','610만세운동','6ㆍ10 만세 운동']],
 ['6월 민주항쟁',['6.10항쟁','6ㆍ10 항쟁','610항쟁','6월항쟁']]
];
test('date event typing aliases are authoritative for explicit canonical events and preserve saved input',()=>{
 for(const [canonical,values] of positive){const q=item(canonical),before=JSON.stringify(q);
 for(const value of values){assert(sourceGrade(q,[value],2),canonical+' <- '+value);
 const initial=workspaceFromLegacy(initialSourceProgress(),1);
 const saved=applySourceBatch([q],initial,{version:'fixture',revision:0,mutationId:randomUUID(),cursor:0,status:'active',updates:[{itemId:q.id,values:[value],submitted:true,checkedSlots:[true]}]},2);
 assert.equal(saved.responses[q.id].correct,true);assert.deepEqual(saved.responses[q.id].values,[value]);assert.equal(JSON.stringify(q),before);
 assert.equal(sourceGrade(q,[value],1),value.replace(/\s/g,'')===canonical.replace(/\s/g,''),'legacy grading contract stays strict');
 }}
});
test('dates are not generic stripped numbers or fuzzy matches; same-date movements remain distinct',()=>{
 for(const [canonical,value] of [
 ['5·18 민주화운동','5.16 민주화 운동'],['5·18 민주화운동','516'],['5·18 민주화운동','5.18혁명'],['5·18 민주화운동','518 기타'],['5·18 민주화운동','51.8'],['5·18 민주화운동','0518'],
 ['4·19 혁명','4.18'],['4·19 혁명','419민주화운동'],['6·3 시위','6.25'],['3·1 운동','31명'],
 ['6·10 만세운동','610'],['6·10 만세운동','6.10'],['6·10 만세운동','6.10항쟁'],['6월 민주항쟁','610'],['6월 민주항쟁','6.10'],['6월 민주항쟁','6.10만세운동'],
 ['518','5·18민주화운동'],['518년','518'],['4·19 혁명 이후','419'],['5·18 민주화운동/4·19 혁명','518']
 ])assert.equal(sourceGrade(item(canonical),[value],2),false,canonical+' <- '+value);
});
test('bare date aliases do not apply to classification, sequence, multiple or partitioned slots',()=>{
 for(const kind of ['classification','sequence']){const q=item('5·18 민주화운동');q.kind=kind;if(kind==='classification')q.responseSlots=q.blanks;assert.equal(sourceGrade(q,['518'],2),false);}
 const q=item('5·18 민주화운동');q.blanks=[{id:'parent',answerIds:[],parts:q.blanks}];assert.equal(sourceGrade(q,['518'],2),false);
 const two=item('5·18 민주화운동');two.answers.push({id:'other',text:'4·19 혁명'});two.blanks.push({id:'other-blank',answerIds:['other']});assert.equal(sourceGrade(two,['518','419'],2),false);
});

test('actual source workspace service grades aliases with isolated ownership and idempotency (in-memory DB adapter)',async()=>{
 const files=(process.env.HANQ_DATE_QUIZ_FIXTURES||'').split(';').filter(Boolean);
 const fixtures=files.length?files.map(file=>JSON.parse(readFileSync(file,'utf8'))):[{schemaVersion:'hanq-source-quiz/1',source:{sha256:'a'.repeat(64)},items:[item('5·18 민주화운동'),{...item('4·19 혁명'),id:'other'}]}];
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
 assert.equal(saved.workspace.responses[q.id].correct,true);assert.deepEqual(saved.workspace.responses[q.id].values,[value]);
 assert.deepEqual(await svc.saveWorkspace('synthetic-owner','modern',mutation,textbook),saved);
 }}
 assert.deepEqual(await svc.getWorkspace('other-owner','modern',textbook,2),untouched);
 assert.equal(JSON.stringify(data),before);
 }
});
