import { z } from 'zod';
import { idSchema } from './primitives';

const instant = z.iso.datetime({ precision: 3 });
const vendorId = (prefix: string) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`))
    .max(255);
const at = Date.parse;
export const refundBounds = {
  creationMs: 300_000,
  claimMs: 30_000,
  retryMs: 5_000,
} as const;
export const refundStatuses = [
  'pending',
  'requires_action',
  'succeeded',
  'failed',
  'canceled',
] as const;
export type RefundStatus = (typeof refundStatuses)[number];
const chronologySchema = z.strictObject({
  closedAt: instant,
  paidAtSeconds: z.number().int().nonnegative().nullable(),
  now: instant,
});

/** Vendor payment timestamps have second precision. An overlapping second is not proof of ordering. */
export function closurePaymentDisposition(input: {
  readonly closedAt: string;
  readonly paidAtSeconds: number | null;
  readonly now: string;
}): 'refund' | 'pre-closure' | 'unresolved' {
  if (
    !chronologySchema.safeParse(input).success ||
    at(input.now) < at(input.closedAt) ||
    input.paidAtSeconds === null
  )
    return 'unresolved';
  const paid = input.paidAtSeconds * 1000;
  if (!Number.isSafeInteger(paid) || paid > at(input.now)) return 'unresolved';
  if (paid > at(input.closedAt)) return 'refund';
  return paid + 1000 <= at(input.closedAt) ? 'pre-closure' : 'unresolved';
}

export const refundStateSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ready') }),
  z.strictObject({
    kind: z.literal('unknown'),
    startedAt: instant,
    retryAt: instant,
    afterRefundId: vendorId('re').nullable(),
  }),
  z.strictObject({
    kind: z.literal('known'),
    startedAt: instant,
    refundId: vendorId('re'),
    status: z.enum(refundStatuses),
    observedAt: instant,
  }),
]);
export type RefundState = z.infer<typeof refundStateSchema>;
export const refundClaimSchema = z.strictObject({
  id: idSchema,
  work: z.enum(['create', 'discover', 'retrieve']),
  claimedAt: instant,
  expiresAt: instant,
});
function validStateTime(state: RefundState, admittedAt: string) {
  if (state.kind === 'ready') return true;
  if (at(state.startedAt) < at(admittedAt)) return false;
  return state.kind === 'unknown'
    ? at(state.retryAt) >= at(state.startedAt)
    : at(state.observedAt) >= at(state.startedAt);
}
function validClaim(
  state: RefundState,
  claim: z.infer<typeof refundClaimSchema> | null,
) {
  if (!claim) return true;
  if (state.kind === 'ready' || at(claim.claimedAt) < at(state.startedAt))
    return false;
  const claimed = at(claim.claimedAt),
    expires = at(claim.expiresAt);
  if (expires <= claimed || expires > claimed + refundBounds.claimMs)
    return false;
  if (state.kind === 'known')
    return claim.work === 'retrieve' && claimed >= at(state.observedAt);
  return validUnknownClaim(state, claim);
}
function validUnknownClaim(
  state: Extract<RefundState, { kind: 'unknown' }>,
  claim: z.infer<typeof refundClaimSchema>,
) {
  const claimed = at(claim.claimedAt);
  if (claimed < at(state.retryAt)) return false;
  const cutoff = at(state.startedAt) + refundBounds.creationMs;
  return claim.work === 'create'
    ? at(claim.expiresAt) <= cutoff
    : claim.work === 'discover' && claimed >= cutoff;
}

/** Private financial cleanup identity, retained independently of ordinary customer deletion and job retries. */
export const refundActionSchema = z
  .strictObject({
    id: idSchema,
    userId: idSchema,
    mode: z.enum(['test', 'live']),
    customerId: vendorId('cus'),
    chargeId: vendorId('ch'),
    invoiceId: vendorId('in'),
    vendorSubscriptionId: vendorId('sub'),
    amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    currency: z.literal('usd'),
    period: z
      .strictObject({ startsAt: instant, endsAt: instant })
      .refine((value) => at(value.startsAt) < at(value.endsAt)),
    closedAt: instant,
    paidAtSeconds: z.number().int().nonnegative(),
    admittedAt: instant,
    state: refundStateSchema,
    claim: refundClaimSchema.nullable(),
  })
  .refine(
    (value) =>
      // Preserve already-recorded boundary facts; new creation authority is a
      // separate decision and never derives subsecond ordering from equality.
      Number.isSafeInteger(value.paidAtSeconds * 1000) &&
      value.paidAtSeconds * 1000 >= at(value.closedAt) &&
      value.paidAtSeconds * 1000 <= at(value.admittedAt) &&
      validStateTime(value.state, value.admittedAt) &&
      validClaim(value.state, value.claim),
  );
export type RefundAction = z.infer<typeof refundActionSchema>;
export type RefundContext = {
  readonly now: string;
  readonly authority: 'closed' | 'denied';
};
export type RefundWork = 'create' | 'discover' | 'retrieve' | 'wait' | 'refuse';
export type RefundEvent =
  | { readonly kind: 'claim'; readonly claimId: string }
  | { readonly kind: 'unresolved'; readonly claimId: string }
  | {
      readonly kind: 'searched';
      readonly claimId: string;
      readonly beforeRefundId: string | null;
      readonly afterRefundId: string | null;
    }
  | {
      readonly kind: 'observe';
      readonly claimId: string;
      readonly refundId: string;
      readonly status: RefundStatus;
    };
export type RefundTransition =
  | { readonly kind: 'changed'; readonly action: RefundAction }
  | { readonly kind: 'refuse' };
export const refundIdempotencyKey = (action: Pick<RefundAction, 'id'>) =>
  `daisy-closure-refund:${action.id}`;

export function currentRefund(action: RefundAction, context: RefundContext) {
  if (
    !refundActionSchema.safeParse(action).success ||
    !instant.safeParse(context.now).success ||
    context.authority !== 'closed'
  )
    return false;
  const state = action.state;
  const previous =
    action.claim?.claimedAt ??
    (state.kind === 'known'
      ? state.observedAt
      : state.kind === 'unknown'
        ? state.startedAt
        : action.admittedAt);
  return at(context.now) >= at(previous);
}

export function ownsRefundClaim(
  action: RefundAction,
  claimId: string,
  context: RefundContext,
) {
  return (
    currentRefund(action, context) &&
    action.claim !== null &&
    action.claim.id === claimId &&
    at(context.now) < at(action.claim.expiresAt)
  );
}

/** Accounting a prior possible call and authorizing another vendor dispatch are distinct. */
export function mayDispatchRefund(
  action: RefundAction,
  claimId: string,
  context: RefundContext,
) {
  return (
    ownsRefundClaim(action, claimId, context) &&
    (action.claim?.work !== 'create' ||
      closurePaymentDisposition({
        closedAt: action.closedAt,
        paidAtSeconds: action.paidAtSeconds,
        now: context.now,
      }) === 'refund')
  );
}
