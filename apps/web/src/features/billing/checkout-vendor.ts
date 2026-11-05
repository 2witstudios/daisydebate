import type Stripe from 'stripe';
import type { Clock } from '@daisy/clock';
import { z } from 'zod';
import {
  purchaseIdempotencyKey,
  purchaseSchema,
  type Purchase,
} from '@daisy/protocol/billing';
import {
  checkoutParameters,
  normalizeCheckoutSession,
  type CheckoutObservation,
} from './checkout-session';

export type CheckoutPort = {
  readonly create: (
    parameters: Stripe.Checkout.SessionCreateParams,
    key: string,
  ) => Promise<unknown>;
  readonly retrieve: (sessionId: string) => Promise<unknown>;
  readonly expire: (sessionId: string) => Promise<unknown>;
};
export function stripeCheckoutPort(
  stripe: Pick<Stripe, 'checkout'>,
): CheckoutPort {
  const options = {
    apiVersion: '2026-10-28.endive',
    timeout: 5_000,
    maxNetworkRetries: 0,
  } as const;
  const expand = ['line_items.data.price'];
  return {
    create: (parameters, idempotencyKey) =>
      stripe.checkout.sessions.create(parameters, {
        ...options,
        idempotencyKey,
      }),
    retrieve: (id) =>
      stripe.checkout.sessions.retrieve(id, { expand }, options),
    expire: (id) => stripe.checkout.sessions.expire(id, { expand }, options),
  };
}
type Result = CheckoutObservation | { readonly kind: 'unknown' };
const refuse = { kind: 'refuse' } as const;
const instant = z.iso.datetime({ precision: 3 });

/** The database owns admission and current account fencing; no untrusted form values enter this port. */
export function createCheckoutVendor(input: {
  readonly port: CheckoutPort;
  readonly clock: Clock;
  readonly mode: Purchase['mode'];
}) {
  const valid = (purchase: Purchase) =>
    purchaseSchema.safeParse(purchase).success && purchase.mode === input.mode;
  const observe = async (
    purchase: Purchase,
    run: () => Promise<unknown>,
  ): Promise<Result> => {
    try {
      return normalizeCheckoutSession(purchase, await run());
    } catch {
      return { kind: 'unknown' };
    }
  };
  return {
    create(purchase: Purchase, claimId: string): Promise<Result> {
      if (!valid(purchase)) return Promise.resolve(refuse);
      const now = input.clock.now();
      const { state } = purchase;
      if (
        !instant.safeParse(now).success ||
        state.kind !== 'creating' ||
        state.claim.id !== claimId ||
        Date.parse(now) < Date.parse(state.claim.claimedAt) ||
        Date.parse(now) >= Date.parse(state.claim.expiresAt)
      )
        return Promise.resolve(refuse);
      return observe(purchase, () =>
        input.port.create(
          checkoutParameters(purchase),
          purchaseIdempotencyKey(purchase),
        ),
      );
    },
    retrieve(purchase: Purchase): Promise<Result> {
      if (!valid(purchase) || !('sessionId' in purchase.state))
        return Promise.resolve(refuse);
      const id = purchase.state.sessionId;
      return observe(purchase, () => input.port.retrieve(id));
    },
    expire(purchase: Purchase): Promise<Result> {
      if (!valid(purchase) || purchase.state.kind !== 'open')
        return Promise.resolve(refuse);
      const id = purchase.state.sessionId;
      return observe(purchase, () => input.port.expire(id));
    },
  };
}
