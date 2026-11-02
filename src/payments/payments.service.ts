import{developmentPremiumOpen}from'../premium/development-policy';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config/config';
import { AppError, notFound } from '../common/app-error';
import { APP_CONFIG, CLOCK, type Clock } from '../common/tokens';
import { iso, randomToken, requireUuid } from '../common/util';
import { DbService } from '../db/db.service';
import { PremiumService } from '../premium/premium.service';
import { PaymentsRepository, type OrderRow } from './payments.repository';
import type { ConfirmInput, PaymentProvider } from './providers/payment-provider';
import { TestPaymentProvider } from './providers/test-payment.provider';

const unavailable = () =>
  new AppError(503, 'payment_provider_unavailable', 'Online payment is not available yet on this server. No order was created and nothing was charged');

export const orderView = (o: OrderRow) => ({
  id: o.id,
  orderRef: o.order_ref,
  planId: o.plan_id,
  amount: o.amount,
  currency: o.currency,
  provider: o.provider,
  testMode: o.provider === 'test',
  status: o.status,
  failureCode: o.failure_code,
  createdAt: iso(o.created_at),
  paidAt: iso(o.paid_at),
});

@Injectable()
export class PaymentsService {
  private readonly provider: PaymentProvider | null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly db: DbService,
    private readonly repo: PaymentsRepository,
    private readonly premium: PremiumService,
  ) {
    // Only adapters that really exist. "none" (the default) means checkout honestly answers 503.
    this.provider = config.payment.provider === 'test' ? new TestPaymentProvider(config.env) : null;
  }

  checkoutInfo() {
    if(developmentPremiumOpen(this.config.premium.developmentOpen))return{available:false,provider:null,testMode:false,reason:'development-premium-open'};
    if (!this.provider) return { available: false, provider: null, testMode: false, reason: 'provider-not-configured' };
    return { available: true, provider: this.provider.name, testMode: this.provider.testMode, notice: this.provider.testMode ? 'Development test payments only. No real money moves.' : null };
  }

  async createOrder(userId: string, planId: string) {
    if(developmentPremiumOpen(this.config.premium.developmentOpen))throw new AppError(503,'development_premium_open','Premium features are free for signed-in members during development. No order was created');
    if (!this.provider) throw unavailable();
    const plan = this.premium.plan();
    if (planId !== plan.id) throw new AppError(400, 'unknown_plan', 'Unknown plan');
    const now = this.clock.now();
    const provider = this.provider;
    return this.db.tx(async (q) => {
      // Price, currency and owner come from the server only.
      const order = await this.repo.insertOrder(q, { id: randomUUID(), userId, orderRef: 'hq_' + randomToken(18), planId: plan.id, amount: plan.priceKRW, currency: plan.currency, provider: provider.name, now });
      await this.repo.event(q, order.id, 'created', null, now);
      return { order: orderView(order), checkout: this.checkoutInfo() };
    });
  }

  async getOrder(userId: string, orderId: string) {
    const o = await this.repo.findOwned(this.db.pool, requireUuid(orderId), userId);
    if (!o) throw notFound();
    return { order: orderView(o) };
  }

  async listOrders(userId: string) {
    return { orders: (await this.repo.listOwned(this.db.pool, userId)).map(orderView) };
  }

  /** Verify with the provider, then settle in ONE transaction holding the order row lock:
   *  duplicate confirmations/callbacks see "paid" and grant nothing; failures and mismatches grant nothing. */
  async confirm(userId: string, orderId: string, input: ConfirmInput) {
    const id = requireUuid(orderId);
    const first = await this.repo.findOwned(this.db.pool, id, userId);
    if (!first) throw notFound();
    if (first.status === 'paid') return { order: orderView(first), alreadyPaid: true, grant: null };
    if (first.status === 'failed') throw new AppError(409, 'order_closed', 'This order has already failed; create a new order');
    if (!this.provider || this.provider.name !== first.provider) throw unavailable();
    const provider = this.provider;
    const verification = await provider.verifyConfirmation({ orderRef: first.order_ref, amount: first.amount, currency: first.currency }, input);
    const now = this.clock.now();

    const result = await this.db.tx(async (q) => {
      const order = await this.repo.findOwned(q, id, userId, true);
      if (!order) return { kind: 'missing' as const };
      if (order.status === 'paid') {
        await this.repo.event(q, order.id, 'duplicate', 'confirm-after-paid', now);
        return { kind: 'already' as const, order };
      }
      if (order.status === 'failed') return { kind: 'closed' as const };
      if (verification.status === 'declined') {
        await this.repo.markFailed(q, order.id, 'declined', now);
        await this.repo.event(q, order.id, 'declined', verification.reason.slice(0, 100), now);
        return { kind: 'declined' as const };
      }
      const mismatch = [
        verification.amount !== order.amount && 'amount',
        verification.currency !== order.currency && 'currency',
        verification.orderRef !== order.order_ref && 'reference',
      ].filter(Boolean) as string[];
      if (mismatch.length) {
        await this.repo.markFailed(q, order.id, 'mismatch', now);
        await this.repo.event(q, order.id, 'mismatch', mismatch.join(','), now);
        return { kind: 'mismatch' as const, fields: mismatch };
      }
      const paymentId = await this.repo.insertPayment(q, { id: randomUUID(), orderId: order.id, provider: provider.name, providerPaymentId: verification.providerPaymentId, amount: verification.amount, currency: verification.currency, now });
      if (!paymentId) {
        await this.repo.markFailed(q, order.id, 'payment_reused', now);
        await this.repo.event(q, order.id, 'duplicate', 'provider-payment-id-reused', now);
        return { kind: 'reused' as const };
      }
      const grant = await this.premium.grantForPayment(q, userId, paymentId, now);
      await this.repo.markPaid(q, order.id, now);
      await this.repo.event(q, order.id, 'paid', null, now);
      return { kind: 'paid' as const, grant, order: (await this.repo.findOwned(q, order.id, userId))! };
    });

    switch (result.kind) {
      case 'paid':
        return { order: orderView(result.order), alreadyPaid: false, grant: result.grant };
      case 'already':
        return { order: orderView(result.order), alreadyPaid: true, grant: null };
      case 'declined':
        throw new AppError(402, 'payment_declined', 'The payment was declined. Nothing was granted');
      case 'mismatch':
        throw new AppError(409, 'payment_mismatch', 'The provider result did not match the order. Nothing was granted', { fields: result.fields });
      case 'reused':
        throw new AppError(409, 'payment_reused', 'This payment was already used for another order. Nothing was granted');
      case 'closed':
        throw new AppError(409, 'order_closed', 'This order has already failed; create a new order');
      default:
        throw notFound();
    }
  }
}
