import 'reflect-metadata';
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

export async function signup(t: TestApp, email = uniqueEmail(), password = PASSWORD): Promise<Session> {
  const res = await request(t.server).post('/api/v1/auth/signup').set(csrf).send({ email, password });
  if (res.status !== 201) throw new Error(`signup failed ${res.status} ${JSON.stringify(res.body)}`);
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
