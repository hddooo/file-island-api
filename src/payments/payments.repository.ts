import { Injectable } from '@nestjs/common';
import type { Queryable } from '../db/db.service';

export interface OrderRow {
  id: string;
  user_id: string;
  order_ref: string;
  plan_id: string;
  amount: number;
  currency: 'KRW';
  provider: string;
  status: 'pending' | 'paid' | 'failed';
  failure_code: string | null;
  created_at: Date;
  updated_at: Date;
  paid_at: Date | null;
}

@Injectable()
export class PaymentsRepository {
  async insertOrder(q: Queryable, o: { id: string; userId: string; orderRef: string; planId: string; amount: number; currency: string; provider: string; now: Date }): Promise<OrderRow> {
    const r = await q.query<OrderRow>(
      `INSERT INTO hanq.payment_orders (id, user_id, order_ref, plan_id, amount, currency, provider, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $8) RETURNING *`,
      [o.id, o.userId, o.orderRef, o.planId, o.amount, o.currency, o.provider, o.now],
    );
    return r.rows[0];
  }

  /** Owner check is part of the WHERE clause: someone else's order is indistinguishable from a missing one. */
  async findOwned(q: Queryable, id: string, userId: string, forUpdate = false): Promise<OrderRow | null> {
    const r = await q.query<OrderRow>(`SELECT * FROM hanq.payment_orders WHERE id = $1 AND user_id = $2${forUpdate ? ' FOR UPDATE' : ''}`, [id, userId]);
    return r.rows[0] ?? null;
  }

  async listOwned(q: Queryable, userId: string): Promise<OrderRow[]> {
    const r = await q.query<OrderRow>('SELECT * FROM hanq.payment_orders WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT 50', [userId]);
    return r.rows;
  }

  async markFailed(q: Queryable, id: string, code: string, now: Date): Promise<void> {
    await q.query(`UPDATE hanq.payment_orders SET status = 'failed', failure_code = $2, updated_at = $3 WHERE id = $1 AND status = 'pending'`, [id, code, now]);
  }

  async markPaid(q: Queryable, id: string, now: Date): Promise<void> {
    await q.query(`UPDATE hanq.payment_orders SET status = 'paid', paid_at = $2, updated_at = $2 WHERE id = $1 AND status = 'pending'`, [id, now]);
  }

  /** Returns null when this provider payment id was already recorded (for any order). */
  async insertPayment(q: Queryable, p: { id: string; orderId: string; provider: string; providerPaymentId: string; amount: number; currency: string; now: Date }): Promise<string | null> {
    const r = await q.query<{ id: string }>(
      `INSERT INTO hanq.payments (id, order_id, provider, provider_payment_id, amount, currency, verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING RETURNING id`,
      [p.id, p.orderId, p.provider, p.providerPaymentId, p.amount, p.currency, p.now],
    );
    return r.rows[0]?.id ?? null;
  }

  async event(q: Queryable, orderId: string, kind: 'created' | 'declined' | 'mismatch' | 'paid' | 'duplicate', detail: string | null, now: Date): Promise<void> {
    await q.query('INSERT INTO hanq.payment_events (order_id, kind, detail, created_at) VALUES ($1, $2, $3, $4)', [orderId, kind, detail, now]);
  }
}
