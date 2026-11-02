import { Injectable } from '@nestjs/common';
import type { Queryable } from '../db/db.service';

export interface LedgerRow {
  id: string;
  user_id: string;
  payment_id: string;
  plan_id: string;
  period_policy: string;
  granted_from: Date;
  granted_until: Date;
  created_at: Date;
}

export interface TestGrantRow {
  user_id: string;
  granted_from: Date;
  granted_until: Date;
  created_at: Date;
}

@Injectable()
export class PremiumRepository {
  async getExpiry(q: Queryable, userId: string): Promise<Date | null> {
    const r = await q.query<{ expires_at: Date | null }>('SELECT expires_at FROM hanq.premium_state WHERE user_id = $1', [userId]);
    return r.rows[0]?.expires_at ?? null;
  }

  /** Creates the state row if needed, then locks it: concurrent grants for one user run one after another. */
  async lockState(q: Queryable, userId: string, now: Date): Promise<Date | null> {
    await q.query('INSERT INTO hanq.premium_state (user_id, expires_at, updated_at) VALUES ($1, NULL, $2) ON CONFLICT (user_id) DO NOTHING', [userId, now]);
    const r = await q.query<{ expires_at: Date | null }>('SELECT expires_at FROM hanq.premium_state WHERE user_id = $1 FOR UPDATE', [userId]);
    return r.rows[0]?.expires_at ?? null;
  }

  async setExpiry(q: Queryable, userId: string, expiresAt: Date, now: Date): Promise<void> {
    await q.query('UPDATE hanq.premium_state SET expires_at = $2, updated_at = $3 WHERE user_id = $1', [userId, expiresAt, now]);
  }

  async insertLedger(q: Queryable, e: { id: string; userId: string; paymentId: string; planId: string; policy: string; from: Date; until: Date; now: Date }): Promise<void> {
    await q.query(
      `INSERT INTO hanq.entitlement_ledger (id, user_id, payment_id, plan_id, period_policy, granted_from, granted_until, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [e.id, e.userId, e.paymentId, e.planId, e.policy, e.from, e.until, e.now],
    );
  }

  async ledger(q: Queryable, userId: string): Promise<LedgerRow[]> {
    const r = await q.query<LedgerRow>('SELECT * FROM hanq.entitlement_ledger WHERE user_id = $1 ORDER BY created_at, id LIMIT 200', [userId]);
    return r.rows;
  }

  /** The user's one test free pass, if ever claimed. Call after lockState so concurrent claims see each other. */
  async getTestGrant(q: Queryable, userId: string): Promise<TestGrantRow | null> {
    const r = await q.query<TestGrantRow>('SELECT user_id, granted_from, granted_until, created_at FROM hanq.test_premium_grants WHERE user_id = $1', [userId]);
    return r.rows[0] ?? null;
  }

  /** Audit row for a test free pass (one per user: user_id is the primary key). Not a payment and not in the entitlement ledger. */
  async insertTestGrant(q: Queryable, e: { userId: string; from: Date; until: Date; now: Date }): Promise<void> {
    await q.query('INSERT INTO hanq.test_premium_grants (user_id, granted_from, granted_until, created_at) VALUES ($1, $2, $3, $4)', [e.userId, e.from, e.until, e.now]);
  }
}
