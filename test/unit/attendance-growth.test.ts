import assert from 'node:assert/strict';
import {test} from 'node:test';
import {attendance} from '../../src/portal/member-state';
import {isGrowthReason} from '../../src/profile/growth-history';
import type {Queryable} from '../../src/db/db.service';
test('attendance confirmation clock is read after owner lock and repeat does not insert XP',async()=>{
 const order:string[]=[];let now=new Date('2026-11-01T14:59:59.999Z');
 const q={query:async(sql:string,args:unknown[])=>{if(sql.includes('FOR UPDATE')){order.push('lock');now=new Date('2026-11-01T15:00:00Z');return{rows:[{}]};}if(sql.startsWith('INSERT INTO hanq.attendance')){order.push('attendance');assert.equal(args[1],'2026-11-02');return{rows:[]};}if(sql.includes('INSERT INTO hanq.growth_ledger'))throw Error('must not award an existing attendance');if(sql.includes('bool_or'))return{rows:[{today:true,total:1}]};if(sql.includes('count(*)::int consecutive'))return{rows:[{consecutive:1}]};if(sql.includes('a.day::text'))return{rows:[{attendance_day:'2026-11-02',earned:10}]};if(sql.includes('sum(amount)'))return{rows:[{points:'1010'}]};return{rows:[]};}} as unknown as Queryable;
 const result=await attendance(q,'owner',()=>{order.push('clock');return now;},true);assert.deepEqual(order,['lock','clock','attendance']);assert.equal(result.reward.awarded,0);assert.equal(result.growth.points,1010);
});
test('attendance is a growth history reason while imports remain excluded',()=>{assert(isGrowthReason('attendance'));assert(!isGrowthReason('import'));});
