import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Queryable, DbService} from '../../src/db/db.service';
import {PortalService} from '../../src/portal/portal.service';
import {AppError} from '../../src/common/app-error';

const payload = {requestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',delta:10,expectedBalance:1000,reason:'합성 조정'};
function replayService(digimonId:string|null) {
 const queries:string[]=[];
 const old={id:'existing-adjustment',user_id:'synthetic-owner',requested_delta:10,balance_before:'1000',reason:payload.reason,digimon_id:digimonId};
 const q={query:async(sql:string)=>{
  queries.push(sql);
  if(sql.includes('FROM hanq.member_roles')||sql==='SELECT 1 FROM hanq.users WHERE id=$1')return{rows:[{}],rowCount:1};
  if(sql.includes('FROM hanq.admin_xp_adjustments'))return{rows:[old],rowCount:1};
  if(sql.includes('pg_advisory_xact_lock')||sql.includes('FOR UPDATE'))return{rows:[],rowCount:0};
  throw new Error('Unexpected query in immutable replay test');
 }};
 const db={tx:async<T>(fn:(client:Queryable)=>Promise<T>)=>fn(q as unknown as Queryable)} as unknown as DbService;
 return{service:new PortalService(db,{now:()=>new Date('2026-10-31T01:43:00Z')}),queries,old};
}

test('legacy XP route cannot reuse the request identity of an explicitly targeted Digimon adjustment',async()=>{
 const {service,queries}=replayService('synthetic-partner');
 await assert.rejects(service.adjustXp('synthetic-admin','synthetic-owner',payload),error=>error instanceof AppError&&error.getStatus()===409);
 assert(!queries.some(sql=>/^(INSERT|UPDATE|DELETE)\b/.test(sql)));
});

test('legacy XP route replays its own immutable adjustment without new audit or ledger writes',async()=>{
 const {service,queries,old}=replayService(null);
 assert.deepEqual(await service.adjustXp('synthetic-admin','synthetic-owner',payload),{confirmed:true,replayed:true,adjustment:old});
 assert(!queries.some(sql=>/^(INSERT|UPDATE|DELETE)\b/.test(sql)));
});
