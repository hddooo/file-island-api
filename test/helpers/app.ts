import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { Pool } from 'pg';
import { createPool } from '../../src/db/db.service';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';
import type { AppConfig } from '../../src/config/config';
import { ORIGIN, TestClock, testConfig } from './env';

export interface TestApp {
  app: INestApplication;
  server: Parameters<typeof request>[0];
  clock: TestClock;
  config: AppConfig;
  close: () => Promise<void>;
}

export async function startApp(overrides: Record<string, string> = {}, clock = new TestClock()): Promise<TestApp> {
  const config = testConfig(overrides);
  const app = await createApp(config, clock);
  await app.init();
  const server = app.getHttpServer();
  return { app, server, clock, config, close: () => app.close() };
}

export const csrf = { Origin: ORIGIN, 'X-HanQ-CSRF': '1' };
export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

export function uniqueEmail(tag = 'user'): string {
  return `${tag}.${randomBytes(6).toString('hex')}@Example.test`;
}
export const PASSWORD = 'correct horse 42 battery';

export function refreshCookie(res: { headers: Record<string, unknown> }): string | null {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  const c = list.find((x) => x.startsWith('hanq_rt='));
  if (!c) return null;
  const v = c.split(';')[0];
  return v === 'hanq_rt=' ? null : v;
}

export interface Session {
  access: string;
  cookie: string;
  userId: string;
  email: string;
}

export const current61MembershipFixture = () => process.env.HANQ_QUAL_QUALIFICATION_PROFILE === 'schema61-local-private-retained-base';
type MembershipFixture = { scope(config: AppConfig): unknown; verifyDatabase(pool: Pool, config: AppConfig): Promise<unknown> };
const loadMembershipFixture = createRequire(__filename);
/** Exactly one synthetic bootstrap administrator per owned DB. Never a production role seed. */
const fixtureAdministrators = new Map<string, string>();
async function approvedFixtureAdministrator(t: TestApp, pool: Pool, fixture: MembershipFixture): Promise<Session> {
  fixture.scope(t.config);
  await fixture.verifyDatabase(pool,t.config);
  const database=t.config.database.database;
  const token=process.env.HANQ_QUAL_ISOLATION_TOKEN!;
  const email='qualification-admin.'+token+'@example.test';
  const client=await pool.connect();
  let locked=false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('current61-fixture-admin'),hashtext(current_database()))");locked=true;
    await fixture.verifyDatabase(pool,t.config);
    const existing=await client.query<{id:string;approval_status:string}>('SELECT id,approval_status FROM hanq.users WHERE email_normalized=$1',[email]);
    assert.ok(existing.rowCount===0 || existing.rowCount===1);
    if(existing.rowCount===0){
      // Schema reset invalidates the remembered identity; never blindly reuse a cached session.
      fixtureAdministrators.delete(database);
      const pending=await request(t.server).post('/api/v1/auth/signup').set(csrf).send({email,password:PASSWORD});
      assert.equal(pending.status,201);assert.equal(pending.body.accessToken,undefined);assert.equal(pending.headers['set-cookie'],undefined);assert.deepEqual(pending.body,{status:'pending'});
      await client.query('BEGIN');
      try{
        const rows=await client.query<{id:string;approval_status:string;created_at:Date}>('SELECT id,approval_status,created_at FROM hanq.users WHERE email_normalized=$1 FOR UPDATE',[email]);
        assert.equal(rows.rowCount,1);const row=rows.rows[0];
        assert.equal(row.approval_status,'pending');assert.equal(new Date(row.created_at).getTime(),t.clock.now().getTime());
        for(const table of ['member_roles','session_families','growth_ledger'])assert.equal((await client.query('SELECT 1 FROM hanq.'+table+' WHERE user_id=$1',[row.id])).rowCount,0);
        assert.equal((await client.query("UPDATE hanq.users SET approval_status='approved' WHERE id=$1 AND email_normalized=$2 AND approval_status='pending'",[row.id,email])).rowCount,1);
        await client.query("INSERT INTO hanq.member_roles(user_id,role) VALUES($1,'ADMIN')",[row.id]);
        await client.query('COMMIT');fixtureAdministrators.set(database,row.id);
      }catch(error){await client.query('ROLLBACK');throw error;}
    }
    const admin=await client.query<{id:string;approval_status:string}>('SELECT id,approval_status FROM hanq.users WHERE email_normalized=$1',[email]);
    assert.equal(admin.rowCount,1);const id=admin.rows[0].id;
    assert.equal(id,fixtureAdministrators.get(database),'refuse an administrator not created by this fixture');
    assert.equal(admin.rows[0].approval_status,'approved');
    assert.deepEqual((await client.query('SELECT role FROM hanq.member_roles WHERE user_id=$1 ORDER BY role',[id])).rows,[{role:'ADMIN'}]);
    const assertAdminRewards=async()=>{
      assert.equal((await client.query("SELECT 1 FROM hanq.growth_ledger WHERE user_id=$1 AND event_key='signup'",[id])).rowCount,0,'bootstrap admin receives no fabricated signup grant');
      // Only actual sign-in attendance is allowed: exact day key, matching attendance row and fixed reward ladder.
      assert.equal((await client.query("SELECT 1 FROM hanq.growth_ledger g WHERE g.user_id=$1 AND (g.kind IS DISTINCT FROM 'attendance' OR g.attendance_day IS NULL OR g.event_key IS DISTINCT FROM 'attendance:'||g.attendance_day::text OR g.amount NOT IN (10,20,30,40,50) OR NOT EXISTS(SELECT 1 FROM hanq.attendance a WHERE a.user_id=g.user_id AND a.day=g.attendance_day))",[id])).rowCount,0,'only legitimate attendance rewards belong to bootstrap admin');
    };
    await assertAdminRewards();
    const session=await signin(t,email);assert.equal(session.userId,id);
    await assertAdminRewards();
    const day=new Date(t.clock.now().getTime()+9*60*60*1000).toISOString().slice(0,10);
    assert.equal((await client.query("SELECT 1 FROM hanq.growth_ledger WHERE user_id=$1 AND kind='attendance' AND event_key=$2 AND attendance_day=$3::date",[id,'attendance:'+day,day])).rowCount,1,'real sign-in awards today exactly once');
    return session;
  }finally{try{if(locked)await client.query("SELECT pg_advisory_unlock(hashtext('current61-fixture-admin'),hashtext(current_database()))");}finally{client.release();}}
}
/** Ordinary members use the real approval API, including its one-time signup reward.
 * Extra fixture administrator affects global users/roles/session counts; member rows remain non-admin. */
export async function signupResponse(t: TestApp, email: string, password = PASSWORD, displayName?: string) {
  const body = { email, password, ...(displayName === undefined ? {} : { displayName }) };
  if (!current61MembershipFixture()) return request(t.server).post('/api/v1/auth/signup').set(csrf).send(body);
  assert.match(email, /^[^@]+@example\.test$/i);
  const fixture = loadMembershipFixture('/run/current-runtime-fixture.cjs') as MembershipFixture;
  fixture.scope(t.config);
  const pool = createPool(t.config.database);
  try {
    await fixture.verifyDatabase(pool, t.config);
    const normalized = email.trim().toLowerCase();
    assert.equal((await pool.query('SELECT id FROM hanq.users WHERE email_normalized=$1', [normalized])).rowCount, 0, 'Only a new synthetic account may be prepared');
    const pending = await request(t.server).post('/api/v1/auth/signup').set(csrf).send(body);
    assert.equal(pending.status, 201);
    assert.equal(pending.body.accessToken, undefined);
    assert.equal(pending.body.refreshToken, undefined);
    assert.deepEqual(pending.body, { status: 'pending' });
    assert.equal(pending.headers['set-cookie'], undefined);
    assert.equal(pending.headers['access-control-allow-origin'], ORIGIN);
    assert.equal(pending.headers['access-control-allow-credentials'], 'true');
    assert.equal(pending.headers['cache-control'], 'no-store');
    assert.ok(pending.headers['x-content-type-options']);
    let memberId: string;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string; approval_status: string; created_at: Date }>('SELECT id,approval_status,created_at FROM hanq.users WHERE email_normalized=$1 FOR UPDATE', [normalized]);
      assert.equal(result.rowCount, 1);
      const row = result.rows[0];
      assert.equal(row.approval_status, 'pending');
      assert.equal(new Date(row.created_at).getTime(), t.clock.now().getTime());
      for (const table of ['member_roles', 'session_families', 'growth_ledger']) assert.equal((await client.query('SELECT 1 FROM hanq.' + table + ' WHERE user_id=$1', [row.id])).rowCount, 0);
      memberId=row.id;
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    const admin=await approvedFixtureAdministrator(t,pool,fixture);
    const decision=await request(t.server).post('/api/v1/ops/membership-requests/'+memberId+'/decision').set(bearer(admin.access)).send({decision:'approved'});
    assert.equal(decision.status,201);assert.equal(decision.body.changed,true);
    assert.equal((await pool.query('SELECT 1 FROM hanq.member_roles WHERE user_id=$1',[memberId])).rowCount,0,'normal member never becomes ADMIN');
    assert.equal((await pool.query("SELECT count(*)::int n FROM hanq.growth_ledger WHERE user_id=$1 AND event_key='signup'",[memberId])).rows[0].n,1);
    const signed = await request(t.server).post('/api/v1/auth/signin').set(csrf).send({ email, password });
    assert.equal(signed.status, 200);
    assert.equal(typeof signed.body.accessToken, 'string');
    assert.equal(typeof signed.body.user?.id, 'string');
    assert.ok(refreshCookie(signed));
    return signed;
  } finally { await pool.end(); }
}
export async function signup(t: TestApp, email = uniqueEmail(), password = PASSWORD): Promise<Session> {
  const res = await signupResponse(t, email, password);
  if (res.status !== (current61MembershipFixture() ? 200 : 201)) throw new Error(`signup failed ${res.status} ${JSON.stringify(res.body)}`);
  return { access: res.body.accessToken, cookie: refreshCookie(res)!, userId: res.body.user.id, email };
}

/** Real sign-in at the app's CURRENT (test) clock. Use after moving the clock past the 10-minute access-token lifetime:
 *  tests never lengthen token lifetimes or bypass authentication. */
export async function signin(t: TestApp, email: string, password = PASSWORD): Promise<Session> {
  const res = await request(t.server).post('/api/v1/auth/signin').set(csrf).send({ email, password });
  if (res.status !== 200) throw new Error(`signin failed ${res.status} ${JSON.stringify(res.body)}`);
  return { access: res.body.accessToken, cookie: refreshCookie(res)!, userId: res.body.user.id, email };
}

/** Buys one premium pass through the development test provider. */
export async function buyPremium(t: TestApp, s: Session, outcome = 'approve') {
  const o = await request(t.server).post('/api/v1/payments/orders').set(bearer(s.access)).send({ planId: 'premium-1m' });
  if (o.status !== 201) throw new Error(`order failed ${o.status} ${JSON.stringify(o.body)}`);
  return request(t.server).post(`/api/v1/payments/orders/${o.body.order.id}/confirm`).set(bearer(s.access)).send({ testOutcome: outcome });
}

let seq = 0;
export const subId = (tag = 's') => `${tag}-${Date.now().toString(36)}-${(seq++).toString(36)}-${randomBytes(3).toString('hex')}`;
