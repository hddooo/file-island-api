import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Pool } from 'pg';
import request from 'supertest';
const addThirtyDays=(d:Date)=>new Date(d.getTime()+30*86400000);
import { bearer, signin, signup, startApp, type Session, type TestApp } from '../helpers/app';
import { freshDatabase } from '../helpers/db';
import { testConfig } from '../helpers/env';

describe('premium pass purchase (5,000 KRW / one month, non-renewing) through the test provider', () => {
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

  const order = async (s: Session) => {
    const r = await request(t.server).post('/api/v1/payments/orders').set(bearer(s.access)).send({ planId: 'premium-1m' });
    assert.equal(r.status, 201, `order creation must succeed before its id is used: ${JSON.stringify(r.body)}`);
    return r;
  };
  const confirm = (s: Session, id: string, body: object = { testOutcome: 'approve' }) => request(t.server).post(`/api/v1/payments/orders/${id}/confirm`).set(bearer(s.access)).send(body);
  const ledger = async (userId: string) => (await pool.query(`SELECT * FROM hanq.entitlement_ledger WHERE user_id = $1 ORDER BY granted_from`, [userId])).rows;
  const expiry = async (userId: string) => (await pool.query(`SELECT expires_at FROM hanq.premium_state WHERE user_id = $1`, [userId])).rows[0]?.expires_at as Date | undefined;

  it('plan is public and states price, currency, period policy and test mode honestly', async () => {
    const r = await request(t.server).get('/api/v1/premium/plan');
    assert.equal(r.body.plan.priceKRW, 5000);
    assert.equal(r.body.plan.currency, 'KRW');
    assert.equal(r.body.plan.renewal, 'none');
    assert.equal(r.body.plan.periodPolicy, 'fixed-days');
    assert.equal(r.body.plan.policyStatus, 'confirmed');
    assert.deepEqual(r.body.checkout, { available: true, provider: 'test', testMode: true, notice: 'Development test payments only. No real money moves.' });
  });

  it('without a configured provider: plan says unavailable, ordering answers 503, nothing is created', async () => {
    const none = await startApp({ HANQ_PAYMENT_PROVIDER: 'none' });
    try {
      const plan = await request(none.server).get('/api/v1/premium/plan');
      assert.equal(plan.body.checkout.available, false);
      const s = await signup(none);
      const o = await request(none.server).post('/api/v1/payments/orders').set(bearer(s.access)).send({ planId: 'premium-1m' });
      assert.equal(o.status, 503);
      assert.equal(o.body.error.code, 'payment_provider_unavailable');
      const n = await pool.query(`SELECT count(*)::int n FROM hanq.payment_orders WHERE user_id = $1`, [s.userId]);
      assert.equal(n.rows[0].n, 0);
      assert.equal((await request(none.server).post('/api/v1/payments/webhooks/toss').send({})).status, 503);
    } finally {
      await none.close();
    }
  });

  it('price, currency and owner come from the server; the client cannot set them', async () => {
    const s = await signup(t);
    const o = await order(s);
    assert.equal(o.status, 201);
    assert.equal(o.body.order.amount, 5000);
    assert.equal(o.body.order.currency, 'KRW');
    assert.equal(o.body.order.status, 'pending');
    assert.equal(o.body.order.testMode, true);
    for (const extra of [{ amount: 1 }, { currency: 'USD' }, { userId: randomUUID() }, { planId: 'premium-1y' }]) {
      assert.equal((await request(t.server).post('/api/v1/payments/orders').set(bearer(s.access)).send({ planId: 'premium-1m', ...extra })).status, 400);
    }
    assert.equal((await request(t.server).post('/api/v1/payments/orders').send({ planId: 'premium-1m' })).status, 401);
  });

  it('approval grants exactly one calendar month from now and reports the duration', async () => {
    const s = await signup(t);
    const o = await order(s);
    const r = await confirm(s, o.body.order.id);
    assert.equal(r.status, 200);
    assert.equal(r.body.order.status, 'paid');
    const now = t.clock.now();
    assert.equal(r.body.grant.grantedFrom, now.toISOString());
    assert.equal(r.body.grant.grantedUntil, addThirtyDays(now).toISOString());
    assert.equal(r.body.grant.durationMs, addThirtyDays(now).getTime() - now.getTime());
    const st = await request(t.server).get('/api/v1/premium').set(bearer(s.access));
    assert.equal(st.body.active, true);
    assert.equal(st.body.expiresAt, r.body.grant.grantedUntil);
    assert.equal(st.body.grants.length, 1);
    const me = await request(t.server).get('/api/v1/me').set(bearer(s.access));
    assert.equal(me.body.premium.active, true);
  });

  it('concurrent duplicate confirmations of one order grant once', async () => {
    const s = await signup(t);
    const o = await order(s);
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => confirm(s, o.body.order.id)));
    assert.ok(rs.every((r) => r.status === 200), JSON.stringify(rs.map((r) => r.status)));
    assert.equal(rs.filter((r) => r.body.alreadyPaid === false).length, 1);
    const l = await ledger(s.userId);
    assert.equal(l.length, 1);
    assert.equal((await expiry(s.userId))!.toISOString(), addThirtyDays(t.clock.now()).toISOString());
    const pays = await pool.query(`SELECT count(*)::int n FROM hanq.payments WHERE order_id = $1`, [o.body.order.id]);
    assert.equal(pays.rows[0].n, 1);
  });

  it('repeated distinct purchases extend from the existing expiry (sequential and concurrent)', async () => {
    const s = await signup(t);
    const now = t.clock.now();
    await confirm(s, (await order(s)).body.order.id);
    const second = await confirm(s, (await order(s)).body.order.id);
    const m1 = addThirtyDays(now), m2 = addThirtyDays(m1);
    assert.equal(second.body.grant.grantedFrom, m1.toISOString());
    assert.equal(second.body.grant.grantedUntil, m2.toISOString());
    // two more at the same time: both count, chained, never overlapping
    const [a, b] = await Promise.all([order(s), order(s)]);
    const rs = await Promise.all([confirm(s, a.body.order.id), confirm(s, b.body.order.id)]);
    assert.ok(rs.every((r) => r.status === 200 && r.body.alreadyPaid === false));
    const l = await ledger(s.userId);
    assert.equal(l.length, 4);
    for (let i = 1; i < l.length; i++) assert.equal(l[i].granted_from.toISOString(), l[i - 1].granted_until.toISOString());
    assert.equal((await expiry(s.userId))!.toISOString(), addThirtyDays(addThirtyDays(m2)).toISOString());
  });

  it('after expiry a new purchase starts from now, not from the old expiry', async () => {
    const s = await signup(t);
    const first = await confirm(s, (await order(s)).body.order.id);
    assert.equal(first.status, 200);
    const saved = t.clock.t;
    try {
      t.clock.set(new Date(new Date(first.body.grant.grantedUntil).getTime() + 5 * 86400_000));
      // a month later every token and the session itself have expired: sign in for real at the new time
      assert.equal((await request(t.server).get('/api/v1/premium').set(bearer(s.access))).status, 401);
      const fresh = await signin(t, s.email);
      const st = await request(t.server).get('/api/v1/premium').set(bearer(fresh.access));
      assert.equal(st.body.active, false);
      const again = await confirm(fresh, (await order(fresh)).body.order.id);
      assert.equal(again.status, 200);
      assert.equal(again.body.grant.grantedFrom, t.clock.now().toISOString());
      assert.equal(again.body.grant.grantedUntil, addThirtyDays(t.clock.now()).toISOString());
      assert.equal((await ledger(s.userId)).length, 2);
    } finally {
      t.clock.t = saved;
    }
  });

  it('retrying a confirmation after success is idempotent (no second grant, same expiry)', async () => {
    const s = await signup(t);
    const o = await order(s);
    const one = await confirm(s, o.body.order.id);
    const exp1 = (await expiry(s.userId))!.toISOString();
    const two = await confirm(s, o.body.order.id);
    const three = await confirm(s, o.body.order.id, { testOutcome: 'amount-mismatch' }); // a late, different callback changes nothing
    assert.equal(one.body.alreadyPaid, false);
    assert.equal(two.body.alreadyPaid, true);
    assert.equal(three.status, 200);
    assert.equal(three.body.alreadyPaid, true);
    assert.equal((await ledger(s.userId)).length, 1);
    assert.equal((await expiry(s.userId))!.toISOString(), exp1);
  });

  for (const [outcome, status, code] of [
    ['decline', 402, 'payment_declined'],
    ['amount-mismatch', 409, 'payment_mismatch'],
    ['currency-mismatch', 409, 'payment_mismatch'],
    ['reference-mismatch', 409, 'payment_mismatch'],
  ] as const) {
    it(`${outcome}: grants nothing and closes the order`, async () => {
      const s = await signup(t);
      const o = await order(s);
      const r = await confirm(s, o.body.order.id, { testOutcome: outcome });
      assert.equal(r.status, status);
      assert.equal(r.body.error.code, code);
      assert.equal((await ledger(s.userId)).length, 0);
      assert.equal(await expiry(s.userId), undefined);
      const st = await request(t.server).get(`/api/v1/payments/orders/${o.body.order.id}`).set(bearer(s.access));
      assert.equal(st.body.order.status, 'failed');
      const retry = await confirm(s, o.body.order.id);
      assert.equal(retry.status, 409);
      assert.equal(retry.body.error.code, 'order_closed');
      assert.equal((await ledger(s.userId)).length, 0);
    });
  }

  it('one provider payment can never pay two orders', async () => {
    const s = await signup(t);
    const o1 = await order(s), o2 = await order(s);
    assert.equal((await confirm(s, o1.body.order.id, { testOutcome: 'approve', paymentKey: 'same-key' })).status, 200);
    const r = await confirm(s, o2.body.order.id, { testOutcome: 'approve', paymentKey: 'same-key' });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'payment_reused');
    assert.equal((await ledger(s.userId)).length, 1);
  });

  it('orders are owner-only', async () => {
    const s = await signup(t), other = await signup(t);
    const o = await order(s);
    assert.equal((await request(t.server).get(`/api/v1/payments/orders/${o.body.order.id}`).set(bearer(other.access))).status, 404);
    assert.equal((await confirm(other, o.body.order.id)).status, 404);
    assert.equal((await ledger(other.userId)).length, 0);
    const list = await request(t.server).get('/api/v1/payments/orders').set(bearer(other.access));
    assert.deepEqual(list.body.orders, []);
  });
});
