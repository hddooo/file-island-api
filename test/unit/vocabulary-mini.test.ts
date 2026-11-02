import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validate} from 'class-validator';
import {randomUUID} from 'node:crypto';
import {WeaknessPracticeService,FocusAnswerDto,focusBank,VOCABULARY_MINI_RELEASED} from '../../src/toeic-notes/weakness-practice';
import {VOCABULARY_MINI_KEYS as keys} from '../../src/toeic-notes/vocabulary-mini-answer-key';
import {DbService} from '../../src/db/db.service';
import {Test} from '@nestjs/testing';
import {CLOCK} from '../../src/common/tokens';
import {ToeicNotesModule} from '../../src/toeic-notes/toeic-notes.module';
interface FixtureRow {owner:string;event_id:string;bank_id:string;question_id:string;question_version:number;selected_option:number;correct_option:number;tags:string[];attempted_at:string;received_at:string;}
interface FixtureResult {items:{correct:boolean}[];correct:number;wrong:number;unanswered:number;}
const bank='vocab-mini-001-v1',at='2026-10-24T12:00:00.000Z';
test('mini IDs and three-response questions are bounded without changing old banks',async()=>{
 assert.equal(Object.keys(keys).filter(id=>id.startsWith(bank+'-')).length,50);assert.equal(focusBank(bank),bank);assert.equal(focusBank('focus-adj-adv-100'),'focus-adj-adv-100');
 for(const number of [1,6,20,21,50]){const id=bank+'-q'+String(number).padStart(3,'0'),d=Object.assign(new FocusAnswerDto(),{eventId:randomUUID(),questionId:id,version:1,selected:0,attemptedAt:at});assert.equal((await validate(d)).length,0);assert.equal(keys[id].choiceCount,number===6?3:4);}
 for(const suffix of ['q000','q051','q100','001']){const d=Object.assign(new FocusAnswerDto(),{eventId:randomUUID(),questionId:bank+'-'+suffix,version:1,selected:0,attemptedAt:at});assert((await validate(d)).some(x=>x.property==='questionId'));}
 const s=new WeaknessPracticeService({} as DbService,{now:()=>new Date(at)},true);
 await assert.rejects(s.answer('fixture-A',bank,{eventId:randomUUID(),questionId:bank+'-q006',version:1,selected:3,attemptedAt:at}),/Invalid choice/);
 await assert.rejects(s.answer('fixture-A',bank,{eventId:randomUUID(),questionId:bank+'-q001',version:2,selected:0,attemptedAt:at}),/Reload/);
});
test('mini server grades all 50, repeated event adds no XP, retry keeps first snapshot and owner scope',async()=>{
 const rows=new Map<string,FixtureRow>(),results=new Map<string,FixtureResult>(),ledger=new Map<string,number>();let sequence=0;
 const query=async(sql:string,v:unknown[])=>{
  if(sql.includes('FROM hanq.users'))return{rows:[]};
  if((sql.includes('coalesce(sum(amount)') || sql.includes('SELECT xp::text points FROM hanq.owned_digimon')))return{rows:[{points:String([...ledger].filter(([key])=>key.startsWith(v[0]+':')).reduce((sum,[,n])=>sum+n,100))}]};
  if(sql.startsWith('INSERT INTO hanq.growth_ledger')){const k=String(v[0])+':'+String(v[1]);assert(!ledger.has(k));ledger.set(k,Number(v[2]));return{rows:[]};}
  if(sql.startsWith('INSERT INTO hanq.weakness_practice_attempts')){const k=String(v[0])+':'+String(v[1]);if(rows.has(k))return{rows:[]};const row={event_id:String(v[1]),bank_id:String(v[2]),question_id:String(v[3]),question_version:Number(v[4]),selected_option:Number(v[5]),correct_option:Number(v[6]),tags:JSON.parse(String(v[7])) as string[],attempted_at:String(v[8]),received_at:new Date(Date.parse(at)+sequence++).toISOString()};rows.set(k,{...row,owner:String(v[0])});return{rows:[row]};}
  if(sql.includes('event_id=$2'))return{rows:[rows.get(String(v[0])+':'+String(v[1]))]};
  if(sql.startsWith('INSERT INTO hanq.weakness_practice_results')){const k=String(v[0])+':'+String(v[1]);if(!results.has(k))results.set(k,JSON.parse(String(v[2])) as FixtureResult);return{rows:[]};}
  if(sql.startsWith('SELECT result'))return{rows:results.has(String(v[0])+':'+String(v[1]))?[{result:results.get(String(v[0])+':'+String(v[1]))}]:[]};
  if(sql.startsWith('SELECT count')||sql.startsWith('SELECT DISTINCT')){
   assert(sql.includes('user_id=$1 AND bank_id=$2'));const all=[...rows.values()].filter(r=>r.owner===v[0]&&r.bank_id===v[1]&&(!v[2]||r.question_id===v[2])),ids=[...new Set(all.map(r=>r.question_id))];
   return{rows:ids.map(id=>{const a=all.filter(r=>r.question_id===id),first=a[0],last=a.at(-1);return{...last,attempt_count:a.length,wrong_count:a.filter(r=>r.selected_option!==r.correct_option).length,first_selected_option:first.selected_option,first_correct_option:first.correct_option,first_question_version:first.question_version,first_attempted_at:first.attempted_at,recent_attempts:a.slice(-3).reverse().map(r=>({eventId:r.event_id,selected:r.selected_option,answer:r.correct_option,correct:r.selected_option===r.correct_option,version:r.question_version,attemptedAt:r.attempted_at}))};})};
  }throw Error('Unexpected fixture SQL: '+sql);
 };
 const db={pool:{query},tx:async(fn:(q:{query:typeof query})=>Promise<unknown>)=>fn({query})} as unknown as DbService,s=new WeaknessPracticeService(db,{now:()=>new Date(at)},true),ids=Object.keys(keys).filter(id=>id.startsWith(bank+'-'));
 for(let i=0;i<ids.length;i++){const key=keys[ids[i]],d={eventId:randomUUID(),questionId:ids[i],version:1,selected:i===0?(key.answer+1)%4:key.answer,attemptedAt:at};const a=await s.answer('fixture-A',bank,d);assert.equal(a.attempt.correct,i!==0);assert.equal(a.growth?.delta,i===0?-1:1);assert.equal((await s.answer('fixture-A',bank,d)).growth,null);}
 assert.equal(rows.size,50);assert.equal(ledger.size,50);const first=await s.finish('fixture-A',bank,{questionIds:ids});assert.equal((first.firstResult as FixtureResult).correct,49);assert.equal((first.firstResult as FixtureResult).wrong,1);assert.equal((first.firstResult as FixtureResult).unanswered,0);
 const id=ids[0];for(const selected of [keys[id].answer,(keys[id].answer+1)%4,keys[id].answer])await s.answer('fixture-A',bank,{eventId:randomUUID(),questionId:id,version:1,selected,attemptedAt:at});
 const p=await s.progress('fixture-A',bank),q=p.items.find(x=>x.questionId===id)!;assert.equal(q.attemptCount,4);assert.equal(q.firstAttempt?.correct,false);assert.deepEqual(q.recentAttempts?.map(x=>x.correct),[true,false,true]);assert.equal(ledger.size,53);assert.deepEqual(await s.finish('fixture-A',bank,{questionIds:[]}),first);assert.equal((await s.progress('fixture-B',bank)).items.length,0);
 const partial=await s.finish('fixture-B',bank,{questionIds:[]});assert.equal((partial.firstResult as FixtureResult).unanswered,50);assert.equal(ledger.size,53,'result reads/submissions never award growth');
});

test('unreleased mini rejects answer and final-result writes before touching the database',async()=>{
 const s=new WeaknessPracticeService({} as DbService,{now:()=>new Date(at)});
 await assert.rejects(s.answer('fixture-A',bank,{eventId:randomUUID(),questionId:bank+'-q001',version:1,selected:0,attemptedAt:at}),/Listening audio is not ready/);
 await assert.rejects(s.finish('fixture-A',bank,{questionIds:[]}),/Listening audio is not ready/);
});

test('mini release metadata is account-scoped and older practice contracts remain unchanged',async()=>{
 const calls:{sql:string;values:unknown[]}[]=[];
 const db={pool:{query:async(sql:string,values:unknown[])=>{calls.push({sql,values});return{rows:[]};}}} as unknown as DbService;
 for(const enabled of [false,true]){
  const service=new WeaknessPracticeService(db,{now:()=>new Date(at)},enabled);
  assert.deepEqual((await service.progress('fixture-only-owner',bank)).release,{ready:enabled,contentVersion:1});
  assert.equal('release' in await service.progress('fixture-only-owner','focus-adj-adv-100'),false);
 }
 assert.equal(calls.length,8);for(const q of calls){assert(q.sql.startsWith('SELECT'));assert(q.sql.includes('user_id=$1 AND bank_id=$2'));assert.equal(q.values[0],'fixture-only-owner');}
});

test('published module wires Chapter 1 readiness into the existing service',async()=>{
 const declared=Reflect.getMetadata('providers',ToeicNotesModule) as {provide?:unknown;useValue?:unknown}[];
 const release=declared.find(p=>p.provide===VOCABULARY_MINI_RELEASED);
 assert(release);assert.equal(release.useValue,true);
 const mod=await Test.createTestingModule({providers:[WeaknessPracticeService,{provide:VOCABULARY_MINI_RELEASED,useValue:release.useValue},{provide:DbService,useValue:{pool:{query:async()=>({rows:[]})}}},{provide:CLOCK,useValue:{now:()=>new Date(at)}}]}).compile();
 try{assert.deepEqual((await mod.get(WeaknessPracticeService).progress('fixture-published',bank)).release,{ready:true,contentVersion:1});}finally{await mod.close();}
});
