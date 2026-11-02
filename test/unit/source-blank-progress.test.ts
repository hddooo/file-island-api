import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { applySourceMutation, initialSourceProgress, sourceGrade, sourceSlots, SourceBlankProgressService, type SourceItem, type ProgressMutation, type SourceProgress } from '../../src/textbook/source-blank-progress';
import type { Queryable, DbService } from '../../src/db/db.service';
import {AppError} from '../../src/common/app-error';
import type { TextbookService } from '../../src/textbook/textbook.service';
const eras=['prehistory','ancient','nambuk','goryeo','joseon','opening','colonial','modern'];
const quiz=(era:string)=>JSON.parse(readFileSync(join(process.cwd(),'private-textbook-semantic-data/quizzes',era+'.json'),'utf8'));
const values=(item:SourceItem)=>sourceSlots(item).map(slot=>slot.answerIds.map(id=>item.answers.find(a=>a.id===id)!.text).join(item.kind==='sequence'?(item.answer.sequenceSeparator||''):', '));
const mutation=(position:number,v:string[],action:ProgressMutation['action']='answer'):ProgressMutation=>({version:'fixture',revision:0,mutationId:randomUUID(),position,values:v,action});
test('all 642 original questions: exact slot answers accepted; false responses rejected; source order preserved through completion',()=>{
 let total=0;
 for(const era of eras){const data=quiz(era),items=data.items as SourceItem[];let state=initialSourceProgress();
  for(const [index,item] of items.entries()){
   const v=values(item);assert.equal(sourceGrade(item,v),true,era+'/'+item.id);
   assert.equal(sourceGrade(item,v.map(()=> '원문에 없는 임의의 답')),false);
   const whitespace=v.map(x=>' '+x.normalize('NFD')+' ');assert.equal(sourceGrade(item,whitespace),true);
   state=applySourceMutation(items,state,mutation(index,v));assert.equal(state.responses[index].itemId,item.id);assert.equal(state.responses[index].correct,true);total++;
  }assert.equal(state.status,'completed');assert.equal(state.position,items.length);
 }assert.equal(total,642);
});
test('empty, wrong position and invalid slots never advance; paused drafts remain exact',()=>{
 const items=quiz('prehistory').items,initial=initialSourceProgress(),v=values(items[0]);
 assert.throws(()=>applySourceMutation(items,initial,mutation(0,v.map(()=>''))));
 assert.throws(()=>applySourceMutation(items,initial,mutation(1,v)));
 assert.throws(()=>applySourceMutation(items,initial,mutation(0,[])));
 const paused=applySourceMutation(items,initial,mutation(0,v,'pause'));assert.equal(paused.status,'paused');assert.deepEqual(paused.draft,v);assert.deepEqual(initial,initialSourceProgress());
});
test('service partitions by authenticated owner; idempotent retry and revision conflicts preserve existing responses',async()=>{
 type StoredProgress={revision:number;progress:SourceProgress;mutation_id:string;mutation_hash:string;updated_at:string};
 const rows=new Map<string,StoredProgress>();
 const q={query:async(sql:string,args:unknown[]=[])=>{
  if(sql.includes('pg_advisory'))return {rows:[]};
  const key=args.slice(0,3).join(':');
  if(sql.startsWith('SELECT'))return {rows:rows.has(key)?[structuredClone(rows.get(key))]:[]};
  assert(sql.startsWith('INSERT INTO hanq.source_blank_progress'));rows.set(key,{revision:Number(args[3]),progress:structuredClone(args[4] as SourceProgress),mutation_id:String(args[5]),mutation_hash:String(args[6]),updated_at:'fixture-time'});return {rows:[{updated_at:'fixture-time'}]};
 }};
 const db={pool:q,tx:async<T>(fn:(q:Queryable)=>Promise<T>)=>fn(q as unknown as Queryable)} as unknown as DbService;
 const textbook={semanticQuiz:async()=>quiz('prehistory')} as unknown as TextbookService;
 const svc=new SourceBlankProgressService(db,textbook),a=await svc.get('account-a','prehistory'),b=await svc.get('account-b','prehistory');
 const m={...mutation(0,values(quiz('prehistory').items[0])),version:a.version};
 const first=await svc.save('account-a','prehistory',m),retry=await svc.save('account-a','prehistory',m);
 assert.deepEqual(first,retry);assert.equal(retry.progress.responses.length,1);assert.deepEqual(await svc.get('account-b','prehistory'),b);
 await assert.rejects(svc.save('account-a','prehistory',{...m,mutationId:randomUUID()}),e=>e instanceof AppError&&e.getStatus()===409);
 await assert.rejects(svc.save('account-a','prehistory',{...m,values:['altered']}),e=>e instanceof AppError&&e.getStatus()===409);
 assert.equal((await svc.get('account-a','prehistory')).progress.responses.length,1);
});
