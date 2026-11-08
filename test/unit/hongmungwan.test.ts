import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HongmungwanService,hongEra} from '../../src/wrong-notes/hongmungwan.service';
import type {DbService,Queryable} from '../../src/db/db.service';
import type {PremiumService} from '../../src/premium/premium.service';
const source={question_id:'q1',version:'v1',era:'goryeo',option_ids:['1','2'],correct_option_id:'2',public_payload:{q:'Q'},review_payload:{explanation:'E'},personal_review:null};
function fixture(opts:{source?:boolean;old?:Record<string,unknown>;reset?:Date}={}){
 const calls:{sql:string;args:unknown[]}[]=[];
 const q={query:async(sql:string,args:unknown[]=[])=>{calls.push({sql,args});
  if(sql.includes('FROM hanq.manual_wrong_notes'))return {rows:opts.source===false?[]:[source]};
  if(sql.startsWith('SELECT question_id,version,option_id,correct'))return {rows:opts.old?[opts.old]:[]};
  if(sql.includes('SELECT reset_at FROM'))return {rows:opts.reset?[{reset_at:opts.reset}]:[]};
  return {rows:[]};
 }} as unknown as Queryable;
 const db={tx:async(fn:(q:Queryable)=>unknown)=>fn(q)} as unknown as DbService;
 const premium={assertActive:async()=>undefined} as unknown as PremiumService;
 return {service:new HongmungwanService(db,premium,{now:()=>new Date('2026-11-09T00:00:00Z')}),calls};
}
const dto={questionId:'q1',version:'v1',optionId:'2',submissionId:'hm-1'};
test('era mapping does not misclassify unassigned material',()=>{assert.equal(hongEra('gojoseon'),'prehistory');assert.equal(hongEra('joseon-late'),'joseon');assert.equal(hongEra('ancient'),null);});
test('review-only grades but never writes records or XP',async()=>{const f=fixture();const r=await f.service.answer('owner',{...dto,reviewOnly:true});assert.equal(r.correct,true);assert.equal(r.recorded,false);assert.ok(!f.calls.some(c=>/INSERT|UPDATE|DELETE/.test(c.sql)&&!c.sql.includes('FOR UPDATE')));});
test('normal practice records isolated owner row',async()=>{const f=fixture();await f.service.answer('owner',dto);const insert=f.calls.filter(c=>c.sql.startsWith('INSERT'));assert.equal(insert.length,1);assert.ok(insert[0].sql.includes('hongmungwan_answers'));assert.equal(insert[0].args[0],'owner');assert.ok(!f.calls.some(c=>c.sql.includes('growth_ledger')));});
test('cannot answer or star another owner private source',async()=>{const f=fixture({source:false});await assert.rejects(f.service.answer('other',dto));await assert.rejects(f.service.star('other',{...dto,starred:true}));assert.equal(f.calls.filter(c=>c.sql.startsWith('INSERT')).length,0);});
test('idempotent replay does not add a fourth result',async()=>{const f=fixture({old:{...source,option_id:'2',correct:true}});const r=await f.service.answer('owner',dto);assert.equal(r.replayed,true);assert.ok(!f.calls.some(c=>c.sql.startsWith('INSERT')));await assert.rejects(f.service.answer('owner',{...dto,optionId:'1'}));});
test('invalid option cannot be written',async()=>{const f=fixture();await assert.rejects(f.service.answer('owner',{...dto,optionId:'9'}));assert.ok(!f.calls.some(c=>c.sql.startsWith('INSERT')));});
test('reset epoch stops stale queued answer and star',async()=>{const f=fixture({reset:new Date('2026-11-08T00:00:00Z')});await assert.rejects(f.service.answer('owner',dto));await assert.rejects(f.service.star('owner',{...dto,starred:true}));assert.ok(!f.calls.some(c=>c.sql.startsWith('INSERT')));});
test('empty source is honest and isolated from mock wrong notes',async()=>{const f=fixture({source:false});const r=await f.service.list('owner');assert.deepEqual(r.items,[]);assert.equal(r.eras.length,8);assert.ok(r.eras.every(e=>e.count===0));assert.ok(!f.calls.some(c=>c.sql.includes('visible_wrong_attempts')||c.sql.includes('cbt_runs')));});
