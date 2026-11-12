import assert from 'node:assert/strict';
import {after,before,beforeEach,describe,it} from 'node:test';
import type {Pool} from 'pg';
import request from 'supertest';
import {migrate} from '../../src/db/migrator';
import {resetSchema,migrationsDir} from '../helpers/db';
import {testConfig} from '../helpers/env';
import {startApp,signup,uniqueEmail,bearer,type TestApp} from '../helpers/app';
// Local focused proposal: materialize under test/integration only after reviewed integration.
describe('current61 real approved-member fixture (owned UUID database only)',()=>{
 let pool:Pool,t:TestApp;
 before(async()=>{assert.equal(process.env.HANQ_QUAL_QUALIFICATION_PROFILE,'schema61-local-private-retained-base');t=await startApp();});
 beforeEach(async()=>{if(pool)await pool.end();pool=await resetSchema(testConfig());await migrate(pool,migrationsDir());});
 after(async()=>{if(t)await t.close();if(pool)await pool.end();});
 const adminCount=async()=>(await pool.query("SELECT count(*)::int n FROM hanq.member_roles WHERE role='ADMIN'")).rows[0].n;
 const assertAdminAttendance=async()=>{
  const id=(await pool.query("SELECT user_id FROM hanq.member_roles WHERE role='ADMIN'")).rows[0].user_id;
  const day=new Date(t.clock.now().getTime()+9*60*60*1000).toISOString().slice(0,10);
  assert.deepEqual((await pool.query('SELECT event_key,kind,amount,attendance_day::text AS day FROM hanq.growth_ledger WHERE user_id=$1 ORDER BY event_key',[id])).rows,[{event_key:'attendance:'+day,kind:'attendance',amount:10,day}]);
  assert.equal((await pool.query('SELECT 1 FROM hanq.attendance WHERE user_id=$1 AND day=$2::date',[id,day])).rowCount,1);
 };
 it('ordinary member receives actual approval reward exactly once and has no ADMIN access',async()=>{
  const s=await signup(t);
  assert.equal(await adminCount(),1);
  assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.users')).rows[0].n,2);
  assert.equal((await pool.query("SELECT count(*)::int n FROM hanq.growth_ledger WHERE user_id=$1 AND event_key='signup'",[s.userId])).rows[0].n,1);
  assert.equal((await pool.query('SELECT 1 FROM hanq.member_roles WHERE user_id=$1',[s.userId])).rowCount,0);
  await request(t.server).get('/api/v1/ops/membership-requests').set(bearer(s.access)).expect(403);
 });
 it('parallel ordinary signups share exactly one bootstrap administrator',async()=>{
  const sessions=await Promise.all([signup(t,uniqueEmail('parallel-a')),signup(t,uniqueEmail('parallel-b'))]);
  assert.equal(new Set(sessions.map(x=>x.userId)).size,2);assert.equal(await adminCount(),1);await assertAdminAttendance();
  for(const s of sessions)assert.equal((await pool.query("SELECT count(*)::int n FROM hanq.growth_ledger WHERE user_id=$1 AND event_key='signup'",[s.userId])).rows[0].n,1);
 });
 it('schema reset recreates the admin with a new verified ID, not a cached session',async()=>{
  await signup(t);const first=(await pool.query("SELECT user_id FROM hanq.member_roles WHERE role='ADMIN'")).rows[0].user_id;
  await pool.end();pool=await resetSchema(testConfig());await migrate(pool,migrationsDir());
  await signup(t);const second=(await pool.query("SELECT user_id FROM hanq.member_roles WHERE role='ADMIN'")).rows[0].user_id;
  assert.notEqual(second,first);assert.equal(await adminCount(),1);await assertAdminAttendance();
 });
 it('duplicate parallel signup never approves or rewards a second account',async()=>{
  const email=uniqueEmail('duplicate');const results=await Promise.allSettled([signup(t,email),signup(t,email)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected').length,1);
  const rows=await pool.query('SELECT id FROM hanq.users WHERE email_normalized=$1',[email.toLowerCase()]);assert.equal(rows.rowCount,1);
  assert.equal((await pool.query("SELECT count(*)::int n FROM hanq.growth_ledger WHERE user_id=$1 AND event_key='signup'",[rows.rows[0].id])).rows[0].n,1);
 });
});
