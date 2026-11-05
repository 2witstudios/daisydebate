import { z } from 'zod';
import { idSchema } from './primitives';

export const purchaseBounds = {
  creationMs: 300_000,
  checkoutMs: 3_600_000,
  claimMs: 30_000,
  retryMs: 5_000,
} as const;
const instant = z.iso.datetime({ precision: 3 });
const at = Date.parse;
const customerId = z
  .string()
  .regex(/^cus_[A-Za-z0-9_]+$/)
  .max(255);
const sessionId = z
  .string()
  .regex(/^cs_(test|live)_[A-Za-z0-9_]+$/)
  .max(255);
const subscriptionId = z
  .string()
  .regex(/^sub_[A-Za-z0-9_]+$/)
  .max(255);
const started = { startedAt: instant };
const session = { sessionId, customerId: customerId.nullable(), ...started };
export const purchaseStateSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('admitted') }),
  z.strictObject({
    kind: z.literal('creating'),
    ...started,
    claim: z.strictObject({
      id: idSchema,
      claimedAt: instant,
      expiresAt: instant,
    }),
  }),
  z.strictObject({ kind: z.literal('unknown'), ...started, retryAt: instant }),
  z.strictObject({ kind: z.literal('open'), ...session }),
  z.strictObject({ kind: z.literal('expired'), ...session }),
  z.strictObject({
    kind: z.literal('complete'),
    ...session,
    customerId,
    subscriptionId,
  }),
  z.strictObject({ kind: z.literal('abandoned'), abandonedAt: instant }),
]);
export type PurchaseState = z.infer<typeof purchaseStateSchema>;

function validClaimInterval(
  state: Extract<PurchaseState, { kind: 'creating' }>,
  admitted: number,
) {
  const claimed = at(state.claim.claimedAt);
  const expires = at(state.claim.expiresAt);
  return (
    claimed >= at(state.startedAt) &&
    expires > claimed &&
    expires <=
      Math.min(
        claimed + purchaseBounds.claimMs,
        admitted + purchaseBounds.creationMs,
      )
  );
}

/** All create parameters derive from this immutable admission, including on retry. */
export const purchaseSchema = z
  .strictObject({
    id: idSchema,
    userId: idSchema,
    mode: z.enum(['test', 'live']),
    priceId: z
      .string()
      .regex(/^price_[A-Za-z0-9_]+$/)
      .max(255),
    customerId: customerId.nullable(),
    returnOrigin: z
      .url({ protocol: /^https?$/ })
      .regex(
        /^https?:\/\/(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::[1-9][0-9]{0,4})?$/,
      ),
    admittedAt: instant,
    state: purchaseStateSchema,
  })
  .refine((purchase) => {
    const { state } = purchase;
    const admitted = at(purchase.admittedAt);
    if (
      'startedAt' in state &&
      (at(state.startedAt) < admitted ||
        at(state.startedAt) >= admitted + purchaseBounds.creationMs)
    )
      return false;
    if (state.kind === 'abandoned') return at(state.abandonedAt) >= admitted;
    if (state.kind === 'unknown')
      return at(state.retryAt) >= at(state.startedAt);
    if (state.kind === 'creating') return validClaimInterval(state, admitted);
    return (
      !('sessionId' in state) ||
      (state.sessionId.startsWith(`cs_${purchase.mode}_`) &&
        (purchase.customerId === null ||
          purchase.customerId === state.customerId))
    );
  });
export type Purchase = z.infer<typeof purchaseSchema>;
export type PurchaseContext = {
  readonly now: string;
  /** Closure still permits verified facts for cleanup; denial grants no operation. */
  readonly authority: 'active' | 'closed' | 'denied';
};
export type PurchaseWork =
  | 'create'
  | 'discover'
  | 'retrieve'
  | 'expire'
  | 'synchronize'
  | 'cleanup'
  | 'abandon'
  | 'wait'
  | 'none'
  | 'refuse';
export type PurchaseObservation =
  | {
      readonly kind: 'open' | 'expired';
      readonly id: string;
      readonly customerId: string | null;
    }
  | {
      readonly kind: 'complete';
      readonly id: string;
      readonly customerId: string;
      readonly subscriptionId: string;
    };
export type PurchaseEvent =
  | { readonly kind: 'claim' | 'unknown'; readonly claimId: string }
  | { readonly kind: 'abandon' }
  | { readonly kind: 'observe'; readonly session: PurchaseObservation };
export type PurchaseTransition =
  | { readonly kind: 'changed'; readonly state: PurchaseState }
  | { readonly kind: 'unchanged' | 'refuse' };
/** Seconds are frozen from admission, never recalculated from a retry's clock. */
export const purchaseSessionExpiry = (purchase: Pick<Purchase, 'admittedAt'>) =>
  Math.floor((at(purchase.admittedAt) + purchaseBounds.checkoutMs) / 1000);
export const purchaseIdempotencyKey = (purchase: Pick<Purchase, 'id'>) =>
  `daisy-premium:${purchase.id}`;

export function currentPurchase(purchase: Purchase, context: PurchaseContext) {
  if (
    !purchaseSchema.safeParse(purchase).success ||
    !instant.safeParse(context.now).success ||
    context.authority === 'denied'
  )
    return false;
  const { state } = purchase;
  const previous =
    state.kind === 'creating'
      ? state.claim.claimedAt
      : state.kind === 'abandoned'
        ? state.abandonedAt
        : 'startedAt' in state
          ? state.startedAt
          : purchase.admittedAt;
  return at(context.now) >= at(previous);
}
