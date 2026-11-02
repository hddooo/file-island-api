import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Pool } from 'pg';
import request from 'supertest';
import { bearer, csrf, PASSWORD, refreshCookie, signup, startApp, uniqueEmail, type TestApp } from '../helpers/app';
import { freshDatabase } from '../helpers/db';
import { ORIGIN, testConfig } from '../helpers/env';

describe('auth: signup / signin / cookies / CSRF / rotation / logout', () => {
  let t: TestApp;
  let pool: Pool;
  before(async () => {
    pool = await freshDatabase(testConfig());
    t = await startApp();
  });
  after(async () => {
    await t.close();
    await pool.end();
  });

  it('signup returns an access token in the body and the refresh token only as an HttpOnly cookie', async () => {
    const email = uniqueEmail('signup');
    const res = await request(t.server).post('/api/v1/auth/signup').set(csrf).send({ email, password: PASSWORD, displayName: '한동' });
    assert.equal(res.status, 201);
    assert.equal(typeof res.body.accessToken, 'string');
    assert.equal(res.body.user.email, email);
    assert.equal(res.body.user.displayName, '한동');
    assert.equal(res.body.refreshToken, undefined);
    const raw = ([] as string[]).concat(res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('hanq_rt='))!;
    assert.match(raw, /HttpOnly/i);
    assert.match(raw, /Path=\/api\/v1\/auth/);
    assert.match(raw, /SameSite=Lax/i);
    assert.doesNotMatch(raw, /Domain=/i);
    assert.equal(res.headers['access-control-allow-origin'], ORIGIN);
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.ok(res.headers['x-content-type-options']);
    const stored = await pool.query<{ password_hash: string }>(`SELECT password_hash FROM hanq.users WHERE email_normalized = $1`, [email.toLowerCase()]);
    assert.match(stored.rows[0].password_hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    assert.ok(!stored.rows[0].password_hash.includes(PASSWORD));
  });

  it('Secure cookie when configured (production forces it)', async () => {
    const s = await startApp({ HANQ_COOKIE_SECURE: 'true', HANQ_COOKIE_SAMESITE: 'strict' });
    try {
      const res = await request(s.server).post('/api/v1/auth/signup').set(csrf).send({ email: uniqueEmail('secure'), password: PASSWORD });
      const raw = ([] as string[]).concat(res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('hanq_rt='))!;
      assert.match(raw, /;\s*Secure/i);
      assert.match(raw, /SameSite=Strict/i);
    } finally {
      await s.close();
    }
  });

  it('e-mail is unique case-insensitively; weak passwords and unknown fields are rejected', async () => {
    const email = uniqueEmail('dup');
    await signup(t, email);
    const dup = await request(t.server).post('/api/v1/auth/signup').set(csrf).send({ email: email.toUpperCase(), password: PASSWORD });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'email_taken');
    const weak = await request(t.server).post('/api/v1/auth/signup').set(csrf).send({ email: uniqueEmail(), password: 'short' });
    assert.equal(weak.body.error.code, 'weak_password');
    const extra = await request(t.server).post('/api/v1/auth/signup').set(csrf).send({ email: uniqueEmail(), password: PASSWORD, userId: '00000000-0000-4000-8000-000000000000' });
    assert.equal(extra.status, 400);
  });

  it('signin: correct password works, wrong password and unknown e-mail fail identically', async () => {
    const s = await signup(t);
    const ok = await request(t.server).post('/api/v1/auth/signin').set(csrf).send({ email: s.email.toUpperCase(), password: PASSWORD });
    assert.equal(ok.status, 200);
    assert.ok(refreshCookie(ok));
    const bad = await request(t.server).post('/api/v1/auth/signin').set(csrf).send({ email: s.email, password: PASSWORD + 'x' });
    const unknown = await request(t.server).post('/api/v1/auth/signin').set(csrf).send({ email: uniqueEmail('nobody'), password: PASSWORD });
    assert.equal(bad.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(bad.body, unknown.body);
    assert.equal(refreshCookie(bad), null);
  });

  it('cookie routes require an allowed Origin and the CSRF header', async () => {
    const body = { email: uniqueEmail(), password: PASSWORD };
    assert.equal((await request(t.server).post('/api/v1/auth/signup').send(body)).status, 403);
    assert.equal((await request(t.server).post('/api/v1/auth/signup').set({ Origin: ORIGIN }).send(body)).status, 403);
    assert.equal((await request(t.server).post('/api/v1/auth/signup').set({ Origin: 'https://evil.example', 'X-HanQ-CSRF': '1' }).send(body)).status, 403);
    const s = await signup(t);
    const r = await request(t.server).post('/api/v1/auth/refresh').set('Cookie', s.cookie).set({ Origin: 'https://evil.example', 'X-HanQ-CSRF': '1' });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'csrf_rejected');
    // CORS preflight is not granted to a foreign origin
    const pre = await request(t.server).options('/api/v1/auth/refresh').set({ Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-hanq-csrf' });
    assert.notEqual(pre.headers['access-control-allow-origin'], 'https://evil.example');
  });

  it('refresh rotates; re-using an old refresh token revokes the whole family (and its access tokens)', async () => {
    const s = await signup(t);
    const r1 = await request(t.server).post('/api/v1/auth/refresh').set(csrf).set('Cookie', s.cookie);
    assert.equal(r1.status, 200);
    const c1 = refreshCookie(r1)!;
    assert.ok(c1 && c1 !== s.cookie);
    const a1 = r1.body.accessToken;
    assert.equal((await request(t.server).get('/api/v1/me').set(bearer(a1))).status, 200);

    const replay = await request(t.server).post('/api/v1/auth/refresh').set(csrf).set('Cookie', s.cookie);
    assert.equal(replay.status, 401);
    assert.equal(replay.body.error.code, 'refresh_reused');
    // family revoked: the newest refresh token and the access tokens die too
    assert.equal((await request(t.server).post('/api/v1/auth/refresh').set(csrf).set('Cookie', c1)).status, 401);
    assert.equal((await request(t.server).get('/api/v1/me').set(bearer(a1))).status, 401);
    assert.equal((await request(t.server).get('/api/v1/me').set(bearer(s.access))).status, 401);
    const fam = await pool.query(`SELECT revoke_reason FROM hanq.session_families WHERE user_id = $1`, [s.userId]);
    assert.deepEqual(fam.rows.map((r) => r.revoke_reason), ['replay']);
  });

  it('concurrent use of the same refresh token: exactly one rotation wins', async () => {
    const s = await signup(t);
    const results = await Promise.all([1, 2, 3].map(() => request(t.server).post('/api/v1/auth/refresh').set(csrf).set('Cookie', s.cookie)));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
  });

  it('refresh fails without cookie, with garbage, and after expiry', async () => {
    assert.equal((await request(t.server).post('/api/v1/auth/refresh').set(csrf)).status, 401);
    assert.equal((await request(t.server).post('/api/v1/auth/refresh').set(csrf).set('Cookie', 'hanq_rt=abc.def.ghi')).status, 401);
    const s = await signup(t);
    t.clock.advance(15 * 86400_000); // beyond the 14-day refresh lifetime
    try {
      assert.equal((await request(t.server).post('/api/v1/auth/refresh').set(csrf).set('Cookie', s.cookie)).status, 401);
    } finally {
      t.clock.advance(-15 * 86400_000);
    }
  });

  it('access tokens expire; refresh tokens and malformed headers are not access tokens', async () => {
    const s = await signup(t);
    assert.equal((await request(t.server).get('/api/v1/me').set(bearer(s.access))).status, 200);
    t.clock.advance(7 * 86400_000);
    try {
      const r = await request(t.server).get('/api/v1/me').set(bearer(s.access));
      assert.equal(r.status, 401);
      assert.equal(r.body.error.code, 'invalid_token');
    } finally {
      t.clock.advance(-7 * 86400_000);
    }
    const refreshJwt = s.cookie.slice('hanq_rt='.length);
    assert.equal((await request(t.server).get('/api/v1/me').set(bearer(refreshJwt))).status, 401);
    assert.equal((await request(t.server).get('/api/v1/me').set('Authorization', s.access)).status, 401);
    assert.equal((await request(t.server).get('/api/v1/me')).status, 401);
  });

  it('logout revokes the session: refresh and existing access tokens stop working', async () => {
    const s = await signup(t);
    const out = await request(t.server).post('/api/v1/auth/logout').set(csrf).set('Cookie', s.cookie);
    assert.equal(out.status, 204);
    assert.match(String(out.headers['set-cookie']), /hanq_rt=;/);
    assert.equal((await request(t.server).get('/api/v1/me').set(bearer(s.access))).status, 401);
    assert.equal((await request(t.server).post('/api/v1/auth/refresh').set(csrf).set('Cookie', s.cookie)).status, 401);
  });

  it('logout-all revokes every session of the user only', async () => {
    const s = await signup(t);
    const second = await request(t.server).post('/api/v1/auth/signin').set(csrf).send({ email: s.email, password: PASSWORD });
    const other = await signup(t);
    const r = await request(t.server).post('/api/v1/auth/logout-all').set(bearer(s.access));
    assert.equal(r.body.revokedSessions, 2);
    assert.equal((await request(t.server).get('/api/v1/me').set(bearer(second.body.accessToken))).status, 401);
    assert.equal((await request(t.server).get('/api/v1/me').set(bearer(other.access))).status, 200);
  });

  it('failed sign-ins are limited per account (shared in the database)', async () => {
    const s2 = await startApp({ HANQ_LOGIN_FAILURES_PER_15MIN: '3' });
    try {
      const u = await signup(s2);
      for (let i = 0; i < 3; i++) assert.equal((await request(s2.server).post('/api/v1/auth/signin').set(csrf).send({ email: u.email, password: 'wrong-password-123' })).status, 401);
      const locked = await request(s2.server).post('/api/v1/auth/signin').set(csrf).send({ email: u.email, password: PASSWORD });
      assert.equal(locked.status, 429);
      assert.equal(locked.body.error.code, 'too_many_failed_signins');
      s2.clock.advance(16 * 60_000);
      assert.equal((await request(s2.server).post('/api/v1/auth/signin').set(csrf).send({ email: u.email, password: PASSWORD })).status, 200);
    } finally {
      await s2.close();
    }
  });

  it('credential routes are rate-limited per IP', async () => {
    const s3 = await startApp({ HANQ_AUTH_RATE_LIMIT_PER_MINUTE: '3' });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await request(s3.server).post('/api/v1/auth/signin').set(csrf).send({ email: uniqueEmail(), password: 'whatever-123456' })).status);
      assert.deepEqual(codes.slice(0, 3), [401, 401, 401]);
      assert.equal(codes[4], 429);
      // non-credential routes are not affected by the strict limiter
      assert.equal((await request(s3.server).get('/api/v1/premium/plan')).status, 200);
    } finally {
      await s3.close();
    }
  });

  it('errors are redacted and bodies are bounded', async () => {
    const bad = await request(t.server).post('/api/v1/auth/signin').set(csrf).set('Content-Type', 'application/json').send('{"email":');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'invalid_json');
    const big = await request(t.server).post('/api/v1/auth/signin').set(csrf).set('Content-Type', 'application/json').send(JSON.stringify({ email: 'x', password: 'y'.repeat(300_000) }));
    assert.equal(big.status, 413);
    const nf = await request(t.server).get('/api/v1/does-not-exist');
    assert.deepEqual(nf.body, { error: { code: 'not_found', message: 'Not found' } });
  });
});
