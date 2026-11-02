import {developmentPremiumOpen} from './development-policy';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config/config';
import { AppError, premiumRequired } from '../common/app-error';
import { APP_CONFIG, CLOCK, type Clock } from '../common/tokens';
import { iso } from '../common/util';
import { DbService, type Queryable } from '../db/db.service';
import { addPremiumPeriod, describePeriod } from './period';
import { PremiumRepository } from './premium.repository';

/** Test free pass: 30 days = 720 hours, once per user. */
const TEST_FREE_PASS_DAYS = 30;
const TEST_FREE_PASS_MS = TEST_FREE_PASS_DAYS * 24 * 3600 * 1000;

/** Premium = a non-renewing pass. The server's clock and ledger decide; no client flag is ever trusted. */
@Injectable()
export class PremiumService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly db: DbService,
    private readonly repo: PremiumRepository,
  ) {}

  plan() {
    const p = { ...this.config.premium, period: 'fixed-days' as const, fixedDays: 30 };
    return {
      ...(developmentPremiumOpen(p.developmentOpen)?{developmentOpen:true,developmentNotice:'개발 기간에는 로그인한 모든 회원에게 프리미엄 기능을 무료로 제공합니다. 이용권 정책은 추후 안내합니다.'}:{}),
      id: p.planId,
      priceKRW: p.priceKRW,
      currency: p.currency,
      renewal: 'none' as const,
      periodPolicy: p.period,
      ...(p.period === 'fixed-days' ? { fixedDays: p.fixedDays } : {}),
      periodDescription: describePeriod(p.period, p.fixedDays),
      policyStatus: 'confirmed' as const,
      includes: ['automatic wrong-note study', 'premium nickname change'],
    };
  }

  /** Active strictly before expiry: at the exact expiry instant the pass is over. */
  static isActiveAt(expiresAt: Date | null, now: Date): boolean {
    return !!expiresAt && now.getTime() < new Date(expiresAt).getTime();
  }

  async status(userId: string, q: Queryable = this.db.pool) {
    const now = this.clock.now();
    const exp = await this.repo.getExpiry(q, userId);
    const paid=PremiumService.isActiveAt(exp,now);return developmentPremiumOpen(this.config.premium.developmentOpen)?{active:true,expiresAt:null,paidExpiresAt:iso(exp),entitlementActive:paid,developmentOpen:true,serverTime:now.toISOString()}:{ active:paid, expiresAt:iso(exp), serverTime:now.toISOString() };
  }

  async history(userId: string) {
    const rows = await this.repo.ledger(this.db.pool, userId);
    return rows.map((r) => ({ id: r.id, planId: r.plan_id, periodPolicy: r.period_policy, grantedFrom: iso(r.granted_from), grantedUntil: iso(r.granted_until), createdAt: iso(r.created_at) }));
  }

  /** Every premium practice action calls this with the action's own `now`. */
  async assertActive(q: Queryable, userId: string, now: Date): Promise<void> {
    if(developmentPremiumOpen(this.config.premium.developmentOpen))return;
    if (!PremiumService.isActiveAt(await this.repo.getExpiry(q, userId), now)) throw premiumRequired();
  }

  /** Inside the payment transaction: lock the user's premium row, extend from max(now, current expiry), append the ledger.
   *  payment_id is UNIQUE in the ledger, so one payment can never grant twice. */
  async grantForPayment(q: Queryable, userId: string, paymentId: string, now: Date) {
    const p = { ...this.config.premium, period: 'fixed-days' as const, fixedDays: 30 };
    const current = await this.repo.lockState(q, userId, now);
    const from = current && current.getTime() > now.getTime() ? new Date(current) : now;
    const until = addPremiumPeriod(from, p.period, p.fixedDays);
    await this.repo.insertLedger(q, { id: randomUUID(), userId, paymentId, planId: p.planId, policy: p.period, from, until, now });
    await this.repo.setExpiry(q, userId, until, now);
    return { grantedFrom: from.toISOString(), grantedUntil: until.toISOString(), durationMs: until.getTime() - from.getTime(), periodPolicy: p.period, periodDescription: describePeriod(p.period, p.fixedDays) };
  }

  /** Public: whether this deployment offers the test free pass (announced test period only). */
  testFreePassInfo() {
    return { available: !developmentPremiumOpen(this.config.premium.developmentOpen)&&this.config.premium.testFreePassEnabled, days: TEST_FREE_PASS_DAYS, oncePerUser: true as const, testMode: true as const };
  }

  /** One free 30-day pass per user, no payment. userId comes only from the verified JWT subject.
   *  The premium row lock serializes concurrent clicks; a prior claim (even expired) never changes the expiry again.
   *  First claim: expiry = max(current expiry, now + 30 days) — never shortens a paid pass and never stacks on top of it.
   *  Writes only the audit row and premium_state: no payment, order or entitlement-ledger rows. */
  async claimTestFreePass(userId: string) {
    if(developmentPremiumOpen(this.config.premium.developmentOpen))return{...(await this.status(userId)),alreadyCovered:true};
    if (!this.config.premium.testFreePassEnabled) throw new AppError(503, 'test_premium_disabled', 'The test free pass is not available');
    return this.db.tx(async (q: Queryable) => {
      const now = this.clock.now();
      const current = await this.repo.lockState(q, userId, now);
      const prior = await this.repo.getTestGrant(q, userId);
      if (prior) {
        return { active: PremiumService.isActiveAt(current, now), expiresAt: iso(current), serverTime: now.toISOString(), testMode: true as const, alreadyClaimed: true, grantedUntil: iso(prior.granted_until) };
      }
      const target = new Date(now.getTime() + TEST_FREE_PASS_MS);
      const until = current && current.getTime() > target.getTime() ? new Date(current) : target;
      await this.repo.insertTestGrant(q, { userId, from: now, until, now });
      if (!current || current.getTime() < until.getTime()) await this.repo.setExpiry(q, userId, until, now);
      return { active: PremiumService.isActiveAt(until, now), expiresAt: until.toISOString(), serverTime: now.toISOString(), testMode: true as const, alreadyClaimed: false, grantedUntil: until.toISOString() };
    });
  }
}
