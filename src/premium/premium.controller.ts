import type { AppConfig } from '../config/config';
import { APP_CONFIG } from '../common/tokens';
import { Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { CurrentAuth, JwtAuthGuard, type AuthContext } from '../auth/guards';
import { PaymentsService } from '../payments/payments.service';
import { PremiumService } from './premium.service';

@Controller('api/v1/premium')
export class PremiumController {
  constructor(
    private readonly premium: PremiumService,
    private readonly payments: PaymentsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Public: price/period and whether checkout is actually available on this deployment (no fake checkout). */
  @Get('plan')
  plan() {
    return { plan: this.premium.plan(), checkout: this.payments.checkoutInfo(), testFreePass: this.premium.testFreePassInfo(), auth: { rememberMe: { available: this.config.jwt.rememberEnabled === true, maxDays: 90 } } };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async status(@CurrentAuth() who: AuthContext) {
    return { ...(await this.premium.status(who.userId)), plan: this.premium.plan(), grants: await this.premium.history(who.userId) };
  }

  /** Self only: the account is the JWT subject; no body is read, so no other identity can be named. */
  @Post('test-free-pass')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async testFreePass(@CurrentAuth() who: AuthContext) {
    return this.premium.claimTestFreePass(who.userId);
  }
}
