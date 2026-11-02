import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import request from 'supertest';
import type { Pool } from 'pg';
import { freshDatabase } from '../helpers/db';
import { testConfig } from '../helpers/env';
import { startApp, signup, signin, bearer, type TestApp } from '../helpers/app';

describe('self-only test free premium, isolated database', () => {
  let pool: Pool, t: TestApp;
  before(async () => { pool = await freshDatabase(testConfig()); t = await startApp({ HANQ_TEST_FREE_PREMIUM_ENABLED: 'true' }); });
  after(async () => { await t.close(); await pool.end(); });
  it('defaults off and requires authentication', async () => {
    assert.equal(testConfig().premium.testFreePassEnabled, false);
    await request(t.server).post('/api/v1/premium/test-free-pass').expect(401);
    const disabled = await startApp();
    try { const s = await signup(disabled); const r = await request(disabled.server).post('/api/v1/premium/test-free-pass').set(bearer(s.access)).expect(503); assert.equal(r.body.error.code, 'test_premium_disabled'); assert.equal((await pool.query('SELECT 1 FROM hanq.test_premium_grants WHERE user_id=$1',[s.userId])).rowCount,0); } finally { await disabled.close(); }
  });
  it('concurrent claims grant exactly once, no payment or role change, immutable audit', async () => {
    const s = await signup(t), other = await signup(t);
    const beforePayments = await pool.query('SELECT (SELECT count(*) FROM hanq.payments)::int AS payments, (SELECT count(*) FROM hanq.payment_orders)::int AS orders, (SELECT count(*) FROM hanq.entitlement_ledger)::int AS ledger');
    const results = await Promise.all(Array.from({length:8},()=>request(t.server).post('/api/v1/premium/test-free-pass').set(bearer(s.access)).send({userId:other.userId}).expect(200)));
    const expected = new Date(t.clock.now().getTime()+30*86400000).toISOString();
    assert.equal(results.filter(r=>!r.body.alreadyClaimed).length,1);
    assert.ok(results.every(r=>r.body.expiresAt===expected && r.body.active && r.body.testMode));
    assert.equal((await pool.query('SELECT 1 FROM hanq.test_premium_grants WHERE user_id=$1',[s.userId])).rowCount,1);
    assert.equal((await pool.query('SELECT 1 FROM hanq.test_premium_grants WHERE user_id=$1',[other.userId])).rowCount,0);
    assert.deepEqual((await pool.query('SELECT (SELECT count(*) FROM hanq.payments)::int AS payments, (SELECT count(*) FROM hanq.payment_orders)::int AS orders, (SELECT count(*) FROM hanq.entitlement_ledger)::int AS ledger')).rows,beforePayments.rows);
    assert.equal((await pool.query('SELECT 1 FROM hanq.member_roles WHERE user_id=$1',[s.userId])).rowCount,0);
    await assert.rejects(pool.query("UPDATE hanq.test_premium_grants SET granted_until=granted_until+interval '1 day' WHERE user_id=$1",[s.userId]),/immutable/);
    await assert.rejects(pool.query('DELETE FROM hanq.test_premium_grants WHERE user_id=$1',[s.userId]),/immutable/);
  });
  it('an expired prior claim cannot be renewed, even after authenticating again', async () => {
    const s=await signup(t);
    const first=await request(t.server).post('/api/v1/premium/test-free-pass').set(bearer(s.access)).expect(200);
    t.clock.advance(31*86400000);
    const fresh=await signin(t,s.email);
    const repeat=await request(t.server).post('/api/v1/premium/test-free-pass').set(bearer(fresh.access)).expect(200);
    assert.equal(repeat.body.active,false); assert.equal(repeat.body.alreadyClaimed,true); assert.equal(repeat.body.expiresAt,first.body.expiresAt);
  });
  it('does not shorten or stack on an existing longer pass', async () => {
    const s=await signup(t),until=new Date(t.clock.now().getTime()+90*86400000);
    await pool.query('INSERT INTO hanq.premium_state(user_id,expires_at,updated_at) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET expires_at=EXCLUDED.expires_at',[s.userId,until,t.clock.now()]);
    const r=await request(t.server).post('/api/v1/premium/test-free-pass').set(bearer(s.access)).expect(200);
    assert.equal(r.body.expiresAt,until.toISOString());
    const repeat=await request(t.server).post('/api/v1/premium/test-free-pass').set(bearer(s.access)).expect(200);
    assert.equal(repeat.body.expiresAt,until.toISOString()); assert.equal(repeat.body.alreadyClaimed,true);
  });
});
