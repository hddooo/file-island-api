import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validate} from 'class-validator';
import {CbtRehearsalService,normalizeRehearsal} from '../../src/cbt/cbt-rehearsal.service';
import {RehearsalResultDto} from '../../src/cbt/cbt-rehearsal.dto';
import type {DbService} from '../../src/db/db.service';
const now=new Date('2026-11-18T12:00:00Z');
function sample():RehearsalResultDto{return {round:75,right:1,total:2,marked:true,at:'2026-11-18T11:00:00Z',resetAt:null,rows:[{questionId:'q1',version:'v1',exam:75,number:1,status:'correct'},{questionId:'q2',version:'v1',exam:75,number:2,status:'empty'}]};}
function harness(reset:string|null=null,old?:RehearsalResultDto,allowed=true){
 const calls:{sql:string;values:unknown[]}[]=[];
 const q={query:async(sql:string,values:unknown[]=[])=>{
  calls.push({sql,values});
  if(sql.includes('SELECT island,reset_at'))return {rows:reset?[{island:'history',reset_at:new Date(reset)}]:[]};
  if(sql.includes('SELECT DISTINCT i.question_id'))return {rows:allowed?sample().rows.map(r=>({question_id:r.questionId,version:r.version,exam_number:r.number})):[]};
  if(sql.includes('SELECT result,reset_at'))return {rows:old?[{result:old,reset_at:reset?new Date(reset):null}]:[]};
  if(sql.includes('SELECT result FROM'))return {rows:old?[{result:old}]:[]};
  return {rows:[]};
 }};
 const db={tx:async(fn:(query:typeof q)=>Promise<unknown>)=>fn(q)} as unknown as DbService;
 return {service:new CbtRehearsalService(db,{now:()=>now}),calls};
}
test('snapshot preserves empty rows, canonical timestamp, no fabricated answers',()=>{
 const s=normalizeRehearsal('75',sample(),now);assert.equal(s.at,'2026-11-18T11:00:00.000Z');assert.equal(s.rows[1].status,'empty');assert.equal('selectedOptionId' in s.rows[0],false);
});
test('reject inconsistent counts, duplicate identity, wrong round, future timestamp',()=>{
 const a=sample();a.right=2;assert.throws(()=>normalizeRehearsal('75',a,now));
 const b=sample();b.rows[1].questionId='q1';assert.throws(()=>normalizeRehearsal('75',b,now));
 assert.throws(()=>normalizeRehearsal('74',sample(),now));
 const c=sample();c.at='2027-01-01T00:00:00Z';assert.throws(()=>normalizeRehearsal('75',c,now));
});
test('authenticated owner only; snapshot is only write and does not award XP or attempts',async()=>{
 const h=harness();await h.service.save('owner','75',sample());
 const writes=h.calls.filter(c=>/^\s*(INSERT|UPDATE)/.test(c.sql));assert.equal(writes.length,1);assert.match(writes[0].sql,/INSERT INTO hanq.cbt_rehearsal_results/);assert.equal(writes[0].values[0],'owner');
 assert.ok(h.calls.every(c=>!c.sql.includes('hanq.attempts')&&!c.sql.includes('growth')));
});
test('old and equal device replay return latest unchanged',async()=>{
 for(const at of ['2026-11-18T11:00:00.000Z','2026-11-18T11:30:00.000Z']){
  const old={...sample(),at};const h=harness(null,old);assert.deepEqual(await h.service.save('owner','75',sample()),{result:old});assert.ok(!h.calls.some(c=>c.sql.includes('INSERT')));
 }
});
test('reset race rejects old epoch, before cutoff snapshot cannot revive',async()=>{
 const reset='2026-11-18T10:00:00.000Z';const h=harness(reset);
 await assert.rejects(h.service.save('owner','75',sample()),/초기화/);assert.ok(!h.calls.some(c=>c.sql.includes('INSERT')));
 const s=sample();s.resetAt='2026-11-18T11:30:00.000Z';assert.throws(()=>normalizeRehearsal('75',s,now));
});
test('question not in owner finalized history rejected',async()=>{
 const h=harness(null,undefined,false);await assert.rejects(h.service.save('owner','75',sample()),/복습 가능한/);assert.ok(!h.calls.some(c=>c.sql.includes('INSERT')));
});
test('GET is owner scoped and returns authoritative reset generation',async()=>{
 const reset='2026-11-18T10:00:00.000Z';const h=harness(reset);assert.deepEqual(await h.service.list('owner'),{results:[],resetAt:reset});
 const read=h.calls.find(c=>c.sql.includes('SELECT result FROM'));assert.deepEqual(read?.values,['owner',reset]);assert.match(read?.sql||'',/wrong_history_visible/);
});
test('DTO rejects injected owner and private scoring fields',async()=>{
 const d=Object.assign(new RehearsalResultDto(),sample(),{userId:'other',xp:100});
 const errors=await validate(d,{whitelist:true,forbidNonWhitelisted:true});assert.ok(errors.some(e=>e.property==='userId'));assert.ok(errors.some(e=>e.property==='xp'));
});
