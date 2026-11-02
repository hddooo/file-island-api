import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validate} from 'class-validator';
import type {Queryable} from '../../src/db/db.service';
import {loginAnalytics} from '../../src/portal/login-analytics';
import {LoginAnalyticsQuery} from '../../src/portal/portal.dto';
import {PortalService} from '../../src/portal/portal.service';
import type {DbService} from '../../src/db/db.service';

test('login analytics only accepts 7 or 30 days',async()=>{
  for(const days of [7,30]) assert.equal((await validate(Object.assign(new LoginAnalyticsQuery(),{days}))).length,0);
  for(const days of [0,8,31,7.5,'7']) assert((await validate(Object.assign(new LoginAnalyticsQuery(),{days}))).length>0);
});
test('missing history stays unavailable and earliest evidence uses KST',async()=>{
  const now=new Date('2026-10-28T01:00:00Z');
  const run=(first:string|null)=>loginAnalytics({query:async()=>({rows:[{first_recorded_login_at:first,login_count:3,unique_users:1,daily:[{date:'2026-10-27',recordedLogins:0,recordedUsers:0},{date:'2026-10-28',recordedLogins:3,recordedUsers:1}]}]})} as unknown as Queryable,now,7);
  const empty=await run(null);assert.equal(empty.recordedLoginCount,null);assert.equal(empty.daily[1].recordedLogins,null);
  const actual=await run('2026-10-27T15:01:00Z');assert.equal(actual.daily[0].recordedLogins,null);assert.equal(actual.daily[1].recordedLogins,3);assert.equal(actual.recordedUniqueUsers,1);assert.equal(actual.collectionStartedAt,null);assert.equal(actual.coverage,'unverified');
});
test('non-admin cannot execute analytics query',async()=>{
  let calls=0;
  const q={query:async()=>{calls++;return {rowCount:0,rows:[]};}} as unknown as Queryable;
  const db={tx:async(fn:(q:Queryable)=>Promise<unknown>)=>fn(q)} as DbService;
  const service=new PortalService(db,{now:()=>new Date()});
  await assert.rejects(service.loginAnalytics('non-admin',7),/Administrator access required/);assert.equal(calls,1);
});
