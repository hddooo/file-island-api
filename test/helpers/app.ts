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
/** Synthetic existing-member setup only. Does not emulate approval rewards or grant ADMIN.
 * Actual approval API/security/reward behavior remains covered by member-approval.test.ts. */
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
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string; approval_status: string; created_at: Date }>('SELECT id,approval_status,created_at FROM hanq.users WHERE email_normalized=$1 FOR UPDATE', [normalized]);
      assert.equal(result.rowCount, 1);
      const row = result.rows[0];
      assert.equal(row.approval_status, 'pending');
      assert.equal(new Date(row.created_at).getTime(), t.clock.now().getTime());
      for (const table of ['member_roles', 'session_families', 'growth_ledger']) assert.equal((await client.query('SELECT 1 FROM hanq.' + table + ' WHERE user_id=$1', [row.id])).rowCount, 0);
      const updated = await client.query("UPDATE hanq.users SET approval_status='approved' WHERE id=$1 AND email_normalized=$2 AND approval_status='pending'", [row.id, normalized]);
      assert.equal(updated.rowCount, 1);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
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
