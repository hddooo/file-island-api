import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {DbService,Queryable} from '../../src/db/db.service';
import {PortalService} from '../../src/portal/portal.service';
import {AppError} from '../../src/common/app-error';

/** Transaction model reproduces migration046's exact check; native PostgreSQL is tested separately. */
function fixture(total:number,equipped:number) {
 const calls:string[]=[];let audit:Record<string,unknown>|null=null,ledgerWrites=0;
 const q={query:async(sql:string,args:unknown[]=[])=>{
  calls.push(sql);
  if(sql.includes('FROM hanq.member_roles')||sql==='SELECT 1 FROM hanq.users WHERE id=$1')return{rows:[{}],rowCount:1};
  if(sql.includes('pg_advisory_xact_lock')||sql==='SELECT 1 FROM hanq.users WHERE id = $1 FOR UPDATE')return{rows:[],rowCount:0};
  if(sql.startsWith('SELECT * FROM hanq.admin_xp_adjustments'))return{rows:audit?[audit]:[],rowCount:audit?1:0};
  if(sql.includes('sum(amount)')||sql.includes('sum(xp)'))return{rows:[{points:String(total)}],rowCount:1};
  if(sql.startsWith('SELECT xp::text points'))return{rows:[{points:String(equipped)}],rowCount:1};
  if(sql.startsWith('SELECT xp::text xp'))return{rows:[{xp:String(equipped)}],rowCount:1};
  if(sql.startsWith('INSERT INTO hanq.admin_xp_adjustments')){
   const selected=sql.includes('digimon_balance_before'),requested=Number(args[4]),before=Number(args[5]),applied=Number(selected?args[4]:args[6]);
   if(applied!==Math.max(requested,-before))throw Object.assign(new Error('migration046 exact clamp check'),{code:'23514',constraint:'admin_xp_adjustments_check1'});
   audit={id:args[0],actor_id:args[1],user_id:args[2],request_id:args[3],requested_delta:requested,balance_before:String(before),applied_delta:applied,balance_after:String(selected?args[6]:args[7]),reason:selected?args[7]:args[8],digimon_id:selected?args[9]:null,digimon_balance_before:selected?String(args[10]):null,digimon_balance_after:selected?String(args[11]):null};
   return{rows:[audit],rowCount:1};
  }
  if(sql.startsWith('INSERT INTO hanq.growth_ledger')){const delta=Number(args[2]);total+=delta;equipped+=delta;ledgerWrites++;return{rows:[],rowCount:1};}
  if(sql.startsWith('INSERT INTO hanq.admin_audit'))return{rows:[],rowCount:1};
  throw Error('Unexpected boundary-test query');
 }};
 const db={tx:async<T>(fn:(client:Queryable)=>Promise<T>)=>{const before={total,equipped,audit,ledgerWrites};try{return await fn(q as unknown as Queryable);}catch(error){({total,equipped,audit,ledgerWrites}=before);throw error;}}} as unknown as DbService;
 return{service:new PortalService(db,{now:()=>new Date('2026-10-31T01:43:00Z')}),calls,state:()=>({total,equipped,audit,ledgerWrites})};
}
const body=(delta:number,total:number)=>({requestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',delta,expectedBalance:total,reason:'합성 경계 검사'});

for(const [total,equipped,delta] of [[110,10,-111],[110,10,-11],[100,0,-1]])test(`legacy split XP rejects unsupported clamp before writes (${total}/${equipped}/${delta})`,async()=>{
 const f=fixture(total,equipped),before=f.state();
 await assert.rejects(f.service.adjustXp('admin','owner',body(delta,total)),error=>error instanceof AppError&&error.getStatus()===400&&error.code==='invalid_xp_adjustment');
 assert.deepEqual(f.state(),before);assert(!f.calls.some(sql=>sql.startsWith('INSERT')));
});

for(const [total,equipped,requested,applied] of [[110,10,-4,-4],[110,10,-10,-10],[10,10,-11,-10],[0,0,-1,0],[100,0,3,3]])test(`legacy valid audit retains original request, actual delta and replay (${total}/${equipped}/${requested})`,async()=>{
 const f=fixture(total,equipped),input=body(requested,total);
 const first=await f.service.adjustXp('admin','owner',input),after=f.state();
 assert.equal(first.replayed,false);assert.equal(first.adjustment.requested_delta,requested);assert.equal(first.adjustment.applied_delta,applied);assert.equal(after.total,total+applied);assert.equal(after.equipped,equipped+applied);assert.equal(after.total-after.equipped,total-equipped);assert.equal(after.ledgerWrites,1);
 assert.equal((await f.service.adjustXp('admin','owner',input)).replayed,true);assert.deepEqual(f.state(),after);
});

for(const [total,equipped,delta] of [[110,10,-11],[100,0,-1]])test(`selected XP rejects an overdraw without clamping or audit (${total}/${equipped}/${delta})`,async()=>{
 const f=fixture(total,equipped),before=f.state();
 await assert.rejects(f.service.adjustPartnerXp('admin','owner','partner',{...body(delta,total),expectedPartnerXp:equipped}),error=>error instanceof AppError&&error.getStatus()===400);
 assert.deepEqual(f.state(),before);assert(!f.calls.some(sql=>sql.startsWith('INSERT')));
});

test('selected XP exact debit preserves requested=applied and immutable replay',async()=>{
 const f=fixture(110,10),input={...body(-10,110),expectedPartnerXp:10};
 const first=await f.service.adjustPartnerXp('admin','owner','partner',input),after=f.state();assert.equal(first.adjustment.requested_delta,-10);assert.equal(first.adjustment.applied_delta,-10);assert.equal(after.equipped,0);assert.equal(after.total,100);
 assert.equal((await f.service.adjustPartnerXp('admin','owner','partner',input)).replayed,true);assert.deepEqual(f.state(),after);
});
