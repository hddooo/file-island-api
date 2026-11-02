import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { CurrentAuth, JwtAuthGuard, type AuthContext } from '../auth/guards';
import { ConfirmOrderDto, CreateOrderDto } from './payments.dto';
import { PaymentsService } from './payments.service';

@Controller('api/v1/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('orders')
  @UseGuards(JwtAuthGuard)
  async create(@CurrentAuth() who: AuthContext, @Body() dto: CreateOrderDto) {
    return this.payments.createOrder(who.userId, dto.planId);
  }

  @Get('orders')
  @UseGuards(JwtAuthGuard)
  list(@CurrentAuth() who: AuthContext) {
    return this.payments.listOrders(who.userId);
  }

  @Get('orders/:id')
  @UseGuards(JwtAuthGuard)
  get(@CurrentAuth() who: AuthContext, @Param('id') id: string) {
    return this.payments.getOrder(who.userId, id);
  }

  @Post('orders/:id/confirm')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  confirm(@CurrentAuth() who: AuthContext, @Param('id') id: string, @Body() dto: ConfirmOrderDto) {
    return this.payments.confirm(who.userId, id, dto);
  }

  /** Server-to-server gateway callbacks. No real gateway adapter exists yet, so this answers honestly instead of pretending. */
  @Post('webhooks/:provider')
  webhook(@Param('provider') _provider: string): never {
    throw new AppError(503, 'payment_provider_unavailable', 'No payment provider webhook is configured on this server');
  }
}
