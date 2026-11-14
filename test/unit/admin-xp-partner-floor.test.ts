import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PortalService,likePattern} from '../../src/portal/portal.service';
import {AppError} from '../../src/common/app-error';

// Synthetic DB: ledger balance and equipped partner XP can differ (a newly claimed partner starts at 0 XP).
function setup(ledger:number,partner:number|null){
 const inserts:{sql:string,args:unknown[]}[]=[];
 const q={query:async(sql:string,args:unknown[]=[])=>{
  if(sql.includes('hanq.member_roles'))return{rows:[{}],rowCount:1};
  if(sql.includes('FROM hanq.admin_xp_adjustments WHERE actor_id'))return{rows:[],rowCount:0};
  if(sql.includes('sum(amount)'))return{rows:[{points:String(ledger)}],rowCount:1};
  if(sql.includes('hanq.owned_digimon'))return partner===null?{rows:[],rowCount:0}:{rows:[{points:String(partner)}],rowCount:1};
  if(sql.startsWith('INSERT INTO hanq.admin_xp_adjustments')){inserts.push({sql,args});return{rows:[{applied_delta:args[6]}],rowCount:1};}
  if(sql.startsWith('INSERT')){inserts.push({sql,args});return{rows:[],rowCount:1};}
  return{rows:[{}],rowCount:1};
 }};
 const db={tx:async<T>(fn:(x:typeof q)=>Promise<T>)=>fn(q)};
 const service=new PortalService(db as never,{now:()=>new Date('2026-11-15T00:00:00Z')} as never);
 return{service,inserts};
}
const dto=(delta:number,expectedBalance:number)=>({requestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',delta,expectedBalance,reason:'test'});

test('deduction larger than the equipped partner XP is a clear 409, not a CHECK violation',async()=>{
 const {service,inserts}=setup(3000,200);
 await assert.rejects(service.adjustXp('admin','member',dto(-1000,3000)),(e:unknown)=>e instanceof AppError&&e.getStatus()===409&&e.code==='xp_partner_insufficient');
 assert.equal(inserts.length,0);
});
test('deduction within the partner XP applies exactly the requested amount (matches the 046 CHECK)',async()=>{
 const {service,inserts}=setup(3000,500);
 await service.adjustXp('admin','member',dto(-200,3000));
 const row=inserts.find(i=>i.sql.startsWith('INSERT INTO hanq.admin_xp_adjustments'))!;
 assert.equal(row.args[4],-200);assert.equal(row.args[6],-200);assert.equal(row.args[7],2800);
});
test('deduction beyond the ledger balance floors at the balance like the CHECK expects',async()=>{
 const {service,inserts}=setup(300,300);
 await service.adjustXp('admin','member',dto(-1000,300));
 const row=inserts.find(i=>i.sql.startsWith('INSERT INTO hanq.admin_xp_adjustments'))!;
 assert.equal(row.args[6],-300);assert.equal(row.args[7],0);
});
test('additions never look at the partner, and a missing partner blocks deductions only',async()=>{
 assert.equal((await setup(100,null).service.adjustXp('admin','member',dto(50,100))).confirmed,true);
 await assert.rejects(setup(100,null).service.adjustXp('admin','member',dto(-50,100)),(e:unknown)=>e instanceof AppError&&e.code==='xp_partner_insufficient');
});
test('admin search text is matched literally',()=>{
 assert.equal(likePattern('a%b_c\\'),'%a\\%b\\_c\\\\%');
 assert.equal(likePattern(''),'%%');
});
