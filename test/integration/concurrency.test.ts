import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as argon2 from 'argon2';
import type { Pool, PoolClient } from 'pg';
import request from 'supertest';
import { bearer, csrf, PASSWORD, signup, startApp, type TestApp } from '../helpers/app';
import { freshDatabase } from '../helpers/db';
import { testConfig } from '../helpers/env';

/** Deterministic races: the test holds the user's row lock (SELECT … FOR UPDATE) as a barrier, waits until the API
 *  requests are really blocked on that lock (pg_stat_activity), then decides what happens "first". */
async function waitForLockWaiters(pool: Pool, n: number): Promise<void> {
  const until = Date.now() + 15_000;
  for (;;) {
    const r = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND state = 'active'`);
    if (r.rows[0].n >= n) return;
    if (Date.now() > until) throw new Error(`expected ${n} request(s) waiting on the row lock, saw ${r.rows[0].n}`);
    await new Promise((res) => setTimeout(res, 25));
  }
}

async function lockUser(pool: Pool, userId: string): Promise<PoolClient> {
  const c = await pool.connect();
  await c.query('BEGIN');
  await c.query('SELECT id FROM hanq.users WHERE id = $1 FOR UPDATE', [userId]);
  return c;
}

describe('password change / sign-in races (row lock + stored-hash recheck)', () => {
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

  it('a sign-in with the old password that is in flight when a password change commits gets no session', async () => {
    const s = await signup(t);
    const holder = await lockUser(pool, s.userId);
    // supertest sends only when .then() is called: start the request now, await it later.
    const pending = request(t.server).post('/api/v1/auth/signin').set(csrf).send({ email: s.email, password: PASSWORD }).then((r) => r);
    try {
      await waitForLockWaiters(pool, 1); // the old password was already verified; the request now waits for the row
      const newHash = await argon2.hash('brand new password 77', { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
      await holder.query('UPDATE hanq.users SET password_hash = $2, password_changed_at = now() WHERE id = $1', [s.userId, newHash]);
      await holder.query(`UPDATE hanq.session_families SET revoked_at = now(), revoke_reason = 'password-change' WHERE user_id = $1 AND revoked_at IS NULL`, [s.userId]);
      await holder.query('COMMIT');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined); // no-op after COMMIT; releases the barrier if a step failed
      holder.release();
    }
    const res = await pending;
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'invalid_credentials');
    const live = await pool.query(`SELECT count(*)::int n FROM hanq.session_families WHERE user_id = $1 AND revoked_at IS NULL`, [s.userId]);
    assert.equal(live.rows[0].n, 0, 'no session may exist after the change');
    assert.equal((await request(t.server).post('/api/v1/auth/signin').set(csrf).send({ email: s.email, password: 'brand new password 77' })).status, 200);
  });

  it('two concurrent password changes with the same current password: exactly one wins', async () => {
    const s = await signup(t);
    const holder = await lockUser(pool, s.userId);
    const a = request(t.server).post('/api/v1/me/password').set(bearer(s.access)).send({ currentPassword: PASSWORD, newPassword: 'first winner pass 111' });
    const b = request(t.server).post('/api/v1/me/password').set(bearer(s.access)).send({ currentPassword: PASSWORD, newPassword: 'second winner pass 222' });
    const both = Promise.all([a.then((r) => r), b.then((r) => r)]);
    try {
      await waitForLockWaiters(pool, 2);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    const [ra, rb] = await both;
    const statuses = [ra.status, rb.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const loser = ra.status === 409 ? ra : rb;
    assert.equal(loser.body.error.code, 'password_changed');
    const winnerPw = ra.status === 200 ? 'first winner pass 111' : 'second winner pass 222';
    const loserPw = ra.status === 200 ? 'second winner pass 222' : 'first winner pass 111';
    assert.equal((await request(t.server).post('/api/v1/auth/signin').set(csrf).send({ email: s.email, password: winnerPw })).status, 200);
    assert.equal((await request(t.server).post('/api/v1/auth/signin').set(csrf).send({ email: s.email, password: loserPw })).status, 401);
    assert.equal((await request(t.server).post('/api/v1/auth/signin').set(csrf).send({ email: s.email, password: PASSWORD })).status, 401);
  });

  it('a password change whose session is revoked meanwhile is refused and changes nothing', async () => {
    const s = await signup(t);
    const holder = await lockUser(pool, s.userId);
    const pending = request(t.server).post('/api/v1/me/password').set(bearer(s.access)).send({ currentPassword: PASSWORD, newPassword: 'should never apply 99' }).then((r) => r);
    try {
      await waitForLockWaiters(pool, 1);
      await holder.query(`UPDATE hanq.session_families SET revoked_at = now(), revoke_reason = 'logout' WHERE user_id = $1`, [s.userId]);
      await holder.query('COMMIT');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
    const res = await pending;
    assert.equal(res.status, 401);
    assert.equal((await request(t.server).post('/api/v1/auth/signin').set(csrf).send({ email: s.email, password: PASSWORD })).status, 200);
    assert.equal((await request(t.server).post('/api/v1/auth/signin').set(csrf).send({ email: s.email, password: 'should never apply 99' })).status, 401);
  });

  it('the current password is still required (wrong current password never reaches the lock)', async () => {
    const s = await signup(t);
    const r = await request(t.server).post('/api/v1/me/password').set(bearer(s.access)).send({ currentPassword: 'not my password 1', newPassword: 'another good one 55' });
    assert.equal(r.status, 403);
    assert.ok(!JSON.stringify(r.body).includes('argon2'));
  });
});
