/** Adapter boundary for a payment gateway. The server never trusts what the browser says was paid:
 *  a provider adapter asks the gateway (server-to-server) what really happened, and the payments service then compares
 *  amount, currency and order reference with the order it created. */
export interface ProviderOrder {
  orderRef: string;
  amount: number;
  currency: 'KRW';
}

export interface ConfirmInput {
  /** Provider's payment key/receipt id as returned to the browser after checkout (opaque, verified server-side). */
  paymentKey?: string;
  /** Only understood by the development test adapter. */
  testOutcome?: TestOutcome;
}

export type TestOutcome = 'approve' | 'decline' | 'amount-mismatch' | 'currency-mismatch' | 'reference-mismatch';

export type ProviderVerification =
  | { status: 'approved'; providerPaymentId: string; orderRef: string; amount: number; currency: string }
  | { status: 'declined'; reason: string };

export interface PaymentProvider {
  readonly name: 'test';
  readonly testMode: boolean;
  verifyConfirmation(order: ProviderOrder, input: ConfirmInput): Promise<ProviderVerification>;
}
