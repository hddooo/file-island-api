import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import type { TestOutcome } from './providers/payment-provider';

export class CreateOrderDto {
  @IsIn(['premium-1m']) planId: string;
}

export class ConfirmOrderDto {
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{1,100}$/) paymentKey?: string;
  @IsOptional() @IsIn(['approve', 'decline', 'amount-mismatch', 'currency-mismatch', 'reference-mismatch']) testOutcome?: TestOutcome;
}
