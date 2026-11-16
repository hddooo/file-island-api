import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {validate} from 'class-validator';
import {CreatePaperResultDto} from '../../src/cbt/paper-results.dto';
import {paperInput,PaperResultsService} from '../../src/cbt/paper-results.service';
import type {DbService} from '../../src/db/db.service';
import type {CbtAssetsService} from '../../src/cbt/cbt-assets.service';
const owner='11111111-1111-4111-8111-111111111111',valid:CreatePaperResultDto={examRound:72,wrongNumbers:[3,1],idempotencyKey:'paper-test-01',completed:true};
test('paper input requires explicit completed flag and finite unique original numbers',async()=>{
 for(const change of [{completed:false},{wrongNumbers:[0]},{wrongNumbers:[51]},{wrongNumbers:[1.5]},{wrongNumbers:[1,1]},{wrongNumbers:null},{examRound:69},{idempotencyKey:'tiny'}]){
  const dto={...valid,...change} as CreatePaperResultDto;assert.throws(()=>paperInput(dto));assert.ok((await validate(Object.assign(new CreatePaperResultDto(),dto))).length);
 }
 for(const nums of [[],Array.from({length:50},(_,i)=>i+1)])assert.equal((await validate(Object.assign(new CreatePaperResultDto(),{...valid,wrongNumbers:nums}))).length,0);
});
test('payload hashing ignores report ordering but does not mutate input',()=>{const a=paperInput(valid);assert.deepEqual(a.wrongNumbers,[1,3]);assert.deepEqual(valid.wrongNumbers,[3,1]);assert.equal(a.hash,paperInput({...valid,wrongNumbers:[1,3]}).hash);assert.notEqual(a.hash,paperInput({...valid,examRound:73}).hash);});
test('DTO rejects fabricated score, owner, choices and timestamps under production whitelist',async()=>{
 const dto=Object.assign(new CreatePaperResultDto(),valid,{score:100,userId:owner,startedAt:'now',answers:[]});const errors=await validate(dto,{whitelist:true,forbidNonWhitelisted:true});for(const name of ['score','userId','startedAt','answers'])assert.ok(errors.some(e=>e.property===name));
});
test('paper history reads owner-scoped and never expire/write online runs',async()=>{
 const queries:string[]=[];const db={pool:{query:async(sql:string,args:unknown[])=>{queries.push(sql);assert.equal(args[0],owner);return {rows:[]};}}} as unknown as DbService;
 const svc=new PaperResultsService(db,{now:()=>new Date()},{} as CbtAssetsService);assert.deepEqual((await svc.list(owner)).items,[]);assert.deepEqual((await svc.notebook(owner)).items,[]);
 assert.ok(queries.every(s=>s.startsWith('SELECT')));assert.ok(queries.every(s=>s.includes('user_id=$1')));assert.ok(!queries.some(s=>s.includes('cbt_runs')));
});
