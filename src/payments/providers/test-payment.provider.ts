import type { NodeEnv } from '../../config/config';
import type { ConfirmInput, PaymentProvider, ProviderOrder, ProviderVerification } from './payment-provider';

/** DEVELOPMENT/TEST ONLY. Simulates a gateway answer without any network call or money.
 *  Refuses to exist in production (config validation also blocks HANQ_PAYMENT_PROVIDER=test there). */
export class TestPaymentProvider implements PaymentProvider {
  readonly name = 'test' as const;
  readonly testMode = true;

  constructor(env: NodeEnv) {
    if (env === 'production') throw new Error('TestPaymentProvider cannot be used in production');
  }

  async verifyConfirmation(order: ProviderOrder, input: ConfirmInput): Promise<ProviderVerification> {
    const outcome = input.testOutcome ?? 'approve';
    // A real gateway returns its own payment id; here it is derived from the key (or the order) so retries are identical.
    const providerPaymentId = 'test_' + (input.paymentKey ?? order.orderRef);
    switch (outcome) {
      case 'decline':
        return { status: 'declined', reason: 'test-decline' };
      case 'amount-mismatch':
        return { status: 'approved', providerPaymentId, orderRef: order.orderRef, amount: order.amount - 1000, currency: order.currency };
      case 'currency-mismatch':
        return { status: 'approved', providerPaymentId, orderRef: order.orderRef, amount: order.amount, currency: 'USD' };
      case 'reference-mismatch':
        return { status: 'approved', providerPaymentId, orderRef: order.orderRef + 'x', amount: order.amount, currency: order.currency };
      default:
        return { status: 'approved', providerPaymentId, orderRef: order.orderRef, amount: order.amount, currency: order.currency };
    }
  }
}
