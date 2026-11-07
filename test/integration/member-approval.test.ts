
import assert from 'node:assert/strict';
import {before,after,describe,it} from 'node:test';
import type {Pool} from 'pg';
import request from 'supertest';
import {csrf,PASSWORD,startApp,uniqueEmail,bearer,refreshCookie,type TestApp} from '../helpers/app';
import {freshDatabase} from '../helpers/db';
import {testConfig} from '../helpers/env';
describe('approved-only membership and static gate',()=>{
 let t:TestApp,pool:Pool,admin:{access:string,id:string},member:{access:string,id:string};
 async function pending(){
  const email=uniqueEmail('membership');
  const r=await request(t.server).post('/api/v1/auth/signup').set(csrf).send({email,password:PASSWORD});
  assert.equal(r.status,201);assert.equal(r.body.status,'pending');assert.equal(r.body.accessToken,undefined);assert.equal(r.headers['set-cookie'],undefined);
  const row=await pool.query('SELECT id FROM hanq.users WHERE email_normalized=$1',[email.toLowerCase()]);
  return {id:row.rows[0].id as string,email};
 }
 async function existing(isAdmin=false){
  const p=await pending();
  // Synthetic existing-member fixture in a disposable loopback *_test DB only.
  await pool.query("UPDATE hanq.users SET approval_status='approved' WHERE id=$1",[p.id]);
  if(isAdmin)await pool.query("INSERT INTO hanq.member_roles(user_id,role) VALUES($1,'ADMIN')",[p.id]);
  const r=await request(t.server).post('/api/v1/auth/signin').set(csrf).send({email:p.email,password:PASSWORD});
  assert.equal(r.status,200);return {access:r.body.accessToken,id:p.id};
 }
 before(async()=>{pool=await freshDatabase(testConfig());t=await startApp();admin=await existing(true);member=await existing();});
 after(async()=>{await t.close();await pool.end();});
 it('new requests cannot sign in or get rewards/sessions; wrong password stays generic',async()=>{
  const p=await pending();
  const r=await request(t.server).post('/api/v1/auth/signin').set(csrf).send({email:p.email,password:PASSWORD});
  assert.equal(r.status,403);assert.equal(r.body.error.code,'membership_pending');
  assert.equal((await request(t.server).post('/api/v1/auth/signin').set(csrf).send({email:p.email,password:'incorrect password'})).status,401);
  assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.session_families WHERE user_id=$1',[p.id])).rows[0].n,0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM hanq.growth_ledger WHERE user_id=$1',[p.id])).rows[0].n,0);
 });
 it('only ADMIN lists/decides; concurrent repeated approval awards exactly once',async()=>{
  const p=await pending(),url='/api/v1/ops/membership-requests/'+p.id+'/decision';
  assert.equal((await request(t.server).get('/api/v1/ops/membership-requests').set(bearer(member.access))).status,403);
  assert.equal((await request(t.server).post(url).set(bearer(member.access)).send({decision:'approved'})).status,403);
  const results=await Promise.all([1,2].map(()=>request(t.server).post(url).set(bearer(admin.access)).send({decision:'approved'})));
  assert.ok(results.every(r=>r.status===201));assert.equal(results.filter(r=>r.body.changed).length,1);
  assert.equal((await pool.query("SELECT count(*)::int n FROM hanq.growth_ledger WHERE user_id=$1 AND event_key='signup'",[p.id])).rows[0].n,1);
  assert.equal((await pool.query("SELECT count(*)::int n FROM hanq.admin_audit WHERE target_id=$1 AND action='membership.approved'",[p.id])).rows[0].n,1);
  const login=await request(t.server).post('/api/v1/auth/signin').set(csrf).send({email:p.email,password:PASSWORD});
  assert.equal(login.status,200);
 });
 it('rejection preserves request and existing approved members/admin cannot be rejected',async()=>{
  const p=await pending();
  const url='/api/v1/ops/membership-requests/'+p.id+'/decision';
  assert.equal((await request(t.server).post(url).set(bearer(admin.access)).send({decision:'rejected'})).status,201);
  assert.equal((await request(t.server).post('/api/v1/auth/signin').set(csrf).send({email:p.email,password:PASSWORD})).body.error.code,'membership_rejected');
  for(const id of [admin.id,member.id])assert.equal((await request(t.server).post('/api/v1/ops/membership-requests/'+id+'/decision').set(bearer(admin.access)).send({decision:'rejected'})).status,409);
 });
 it('public learning APIs now require bearer; health/auth remain available',async()=>{
  for(const path of ['/api/v1/questions','/api/v1/questions/example','/api/v1/ops','/api/v1/me'])assert.equal((await request(t.server).get(path)).status,401,path);
  assert.equal((await request(t.server).get('/api/v1/questions').set(bearer(member.access))).status,200);
  assert.equal((await request(t.server).get('/api/v1/health')).status,200);
 });
 it('site cookie is host-only HttpOnly root, cannot authorize API mutations; logout revokes immediately',async()=>{
  const p=await pending();await request(t.server).post('/api/v1/ops/membership-requests/'+p.id+'/decision').set(bearer(admin.access)).send({decision:'approved'});
  const login=await request(t.server).post('/api/v1/auth/signin').set(csrf).send({email:p.email,password:PASSWORD});
  const raw=(login.headers['set-cookie'] as unknown as string[]).find(x=>x.startsWith('hanq_site_dev='))!;
  assert.match(raw,/HttpOnly/);assert.match(raw,/Path=\//);assert.doesNotMatch(raw,/Domain=/);
  const cookie=raw.split(';')[0];
  assert.equal((await request(t.server).get('/api/v1/auth/site-check').set('Cookie',cookie)).status,204);
  assert.equal((await request(t.server).get('/api/v1/questions').set('Cookie',cookie)).status,401);
  await request(t.server).post('/api/v1/auth/logout').set(csrf).set('Cookie',refreshCookie(login)!);
  assert.equal((await request(t.server).get('/api/v1/auth/site-check').set('Cookie',cookie)).status,401);
 });
 it('pending state rejects existing forged-fixture session, refresh and static cookie',async()=>{
  const p=await pending();await pool.query("UPDATE hanq.users SET approval_status='approved' WHERE id=$1",[p.id]);
  const login=await request(t.server).post('/api/v1/auth/signin').set(csrf).send({email:p.email,password:PASSWORD});
  await pool.query("UPDATE hanq.users SET approval_status='pending' WHERE id=$1",[p.id]);
  assert.equal((await request(t.server).get('/api/v1/questions').set(bearer(login.body.accessToken))).status,401);
  assert.equal((await request(t.server).post('/api/v1/auth/refresh').set(csrf).set('Cookie',refreshCookie(login)!)).status,401);
 });

 it('migration preserves existing synthetic members and defaults only future inserts to pending',async()=>{
  await pool.query('CREATE SCHEMA approval_migration_probe; CREATE TABLE approval_migration_probe.users(id uuid PRIMARY KEY,created_at timestamptz NOT NULL)');
  await pool.query("INSERT INTO approval_migration_probe.users VALUES('00000000-0000-4000-8000-000000000001',now()),('00000000-0000-4000-8000-000000000002',now())");
  const fs=await import('node:fs');await pool.query(fs.readFileSync('migrations/058_member_approval.sql','utf8').replaceAll('hanq.','approval_migration_probe.'));
  assert.equal((await pool.query("SELECT count(*)::int n FROM approval_migration_probe.users WHERE approval_status='approved'")).rows[0].n,2);
  await pool.query("INSERT INTO approval_migration_probe.users(id,created_at) VALUES('00000000-0000-4000-8000-000000000003',now())");
  assert.equal((await pool.query("SELECT approval_status FROM approval_migration_probe.users WHERE id='00000000-0000-4000-8000-000000000003'")).rows[0].approval_status,'pending');
 });
 it('static check rejects expired or malformed cookie; secure deployment cookie has no domain',async()=>{
  const p=await pending();await pool.query("UPDATE hanq.users SET approval_status='approved' WHERE id=$1",[p.id]);
  const secure=await startApp({HANQ_COOKIE_SECURE:'true'});
  try{
   const login=await request(secure.server).post('/api/v1/auth/signin').set(csrf).send({email:p.email,password:PASSWORD});
   const raw=(login.headers['set-cookie'] as unknown as string[]).find(x=>x.startsWith('__Host-hanq_site='))!;
   assert.match(raw,/Secure/);assert.match(raw,/HttpOnly/);assert.doesNotMatch(raw,/Domain=/);
   assert.equal((await request(secure.server).get('/api/v1/auth/site-check').set('Cookie',raw.split(';')[0])).status,204);
   secure.clock.advance(1000*60*60*24*100);
   assert.equal((await request(secure.server).get('/api/v1/auth/site-check').set('Cookie',raw.split(';')[0])).status,401);
   assert.equal((await request(secure.server).get('/api/v1/auth/site-check').set('Cookie','__Host-hanq_site=garbage')).status,401);
  }finally{await secure.close();}
 });

 it('static checks survive 180 asset requests even with the normal 120/min API budget',async()=>{
  const p=await pending();await pool.query("UPDATE hanq.users SET approval_status='approved' WHERE id=$1",[p.id]);
  const bounded=await startApp({HANQ_RATE_LIMIT_PER_MINUTE:'120'});
  try{
   const login=await request(bounded.server).post('/api/v1/auth/signin').set(csrf).send({email:p.email,password:PASSWORD});
   const raw=(login.headers['set-cookie'] as unknown as string[]).find(x=>x.startsWith('hanq_site_dev='))!;
   for(let i=0;i<180;i++)assert.equal((await request(bounded.server).get('/api/v1/auth/site-check').set('Cookie',raw.split(';')[0])).status,204);
   await request(bounded.server).post('/api/v1/auth/logout').set(csrf).set('Cookie',refreshCookie(login)!);
   assert.equal((await request(bounded.server).get('/api/v1/auth/site-check').set('Cookie',raw.split(';')[0])).status,401);
  }finally{await bounded.close();}
 });
});
