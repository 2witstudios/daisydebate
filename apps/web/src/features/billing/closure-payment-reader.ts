import type Stripe from 'stripe';
import type { Clock } from '@daisy/clock';
import { z } from 'zod';
import {
  observeClosurePayment,
  readClosurePaymentOwner,
} from './closure-payment';

export type ClosurePaymentReadPort = {
  readonly payment: (id: string) => Promise<unknown>;
};

/** One bounded read expands the owned payment's links; raw vendor data never becomes an artifact. */
export function stripeClosurePaymentReadPort(
  stripe: Pick<Stripe, 'invoicePayments'>,
): ClosurePaymentReadPort {
  return {
    payment: (id) =>
      stripe.invoicePayments.retrieve(
        id,
        {
          expand: [
            'invoice',
            'payment.payment_intent.latest_charge',
            'payment.charge',
          ],
        },
        {
          apiVersion: '2026-10-28.endive',
          timeout: 5_000,
          maxNetworkRetries: 0,
        },
      ),
  };
}
const paymentId = z
  .string()
  .regex(/^inpay_[A-Za-z0-9_]+$/)
  .max(255);
const expanded = z.object({
  id: paymentId,
  object: z.literal('invoice_payment'),
  invoice: z.unknown(),
  payment: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('payment_intent'),
      payment_intent: z.object({ latest_charge: z.unknown() }).passthrough(),
    }),
    z.object({ type: z.literal('charge'), charge: z.unknown() }),
  ]),
});

/** The server supplies the retained owner. Missing links, failures and mismatched replies remain owed. */
export function createClosurePaymentReader(input: {
  readonly port: ClosurePaymentReadPort;
  readonly clock: Clock;
  readonly mode: 'test' | 'live';
}) {
  return async (request: {
    readonly owner: unknown;
    readonly paymentId: string;
    readonly closedAt: string;
  }) => {
    const owner = readClosurePaymentOwner(request.owner);
    if (
      !owner ||
      owner.mode !== input.mode ||
      !z.iso.datetime({ precision: 3 }).safeParse(request.closedAt).success ||
      !paymentId.safeParse(request.paymentId).success
    )
      return { kind: 'unresolved' } as const;
    try {
      const value = await input.port.payment(request.paymentId);
      const parts = expandedClosurePaymentParts(value, request.paymentId);
      if (!parts) return { kind: 'unresolved' } as const;
      return observeClosurePayment({
        owner,
        closedAt: request.closedAt,
        now: input.clock.now(),
        ...parts,
      });
    } catch {
      // SDK exceptions may contain private payment data; an unread fact is never nonpayment.
      return { kind: 'unresolved' } as const;
    }
  };
}

/** One linked SDK read supplies the same exact parts to financial and retained-observation normalizers. */
export function expandedClosurePaymentParts(value: unknown, id: string) {
  const parsed = expanded.safeParse(value);
  if (!parsed.success || parsed.data.id !== id) return null;
  const payment = parsed.data.payment;
  return {
    invoice: parsed.data.invoice,
    invoicePayment: value,
    paymentIntent:
      payment.type === 'payment_intent' ? payment.payment_intent : null,
    charge:
      payment.type === 'charge'
        ? payment.charge
        : payment.payment_intent.latest_charge,
  };
}
