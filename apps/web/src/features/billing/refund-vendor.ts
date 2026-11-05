import type Stripe from 'stripe';
import type { Clock } from '@daisy/clock';
import { z } from 'zod';
import {
  ownsRefundClaim,
  refundIdempotencyKey,
  refundStatuses,
  type RefundAction,
  type RefundEvent,
} from '@daisy/protocol/billing';

export type RefundPort = {
  readonly create: (
    parameters: Stripe.RefundCreateParams,
    key: string,
  ) => Promise<unknown>;
  readonly retrieve: (id: string) => Promise<unknown>;
  readonly list: (parameters: Stripe.RefundListParams) => Promise<unknown>;
};
export function stripeRefundPort(stripe: Pick<Stripe, 'refunds'>): RefundPort {
  const options = {
    apiVersion: '2026-10-28.endive',
    timeout: 5_000,
    maxNetworkRetries: 0,
  } as const;
  return {
    create: (parameters, idempotencyKey) =>
      stripe.refunds.create(parameters, { ...options, idempotencyKey }),
    retrieve: (id) => stripe.refunds.retrieve(id, {}, options),
    list: (parameters) => stripe.refunds.list(parameters, options),
  };
}
const vendorId = (prefix: string) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`))
    .max(255);
const reference = (prefix: string) =>
  z.union([
    vendorId(prefix),
    z.object({ id: vendorId(prefix) }).transform((value) => value.id),
  ]);
const refundSchema = z.object({
  object: z.literal('refund'),
  id: vendorId('re'),
  charge: reference('ch'),
  customer: reference('cus').nullable(),
  amount: z.number().int().positive(),
  currency: z.literal('usd'),
  status: z.enum(refundStatuses),
  metadata: z.object({ daisy_refund_action_id: z.string() }),
});
type Result =
  | Extract<RefundEvent, { kind: 'observe' | 'searched' | 'unresolved' }>
  | { readonly kind: 'refuse' };
const refuse = { kind: 'refuse' } as const;
function observation(
  action: RefundAction,
  claimId: string,
  value: unknown,
): Result {
  const parsed = refundSchema.safeParse(value);
  if (!parsed.success) return refuse;
  const refund = parsed.data;
  if (
    refund.charge !== action.chargeId ||
    refund.amount !== action.amountMinor ||
    (refund.customer !== null && refund.customer !== action.customerId) ||
    refund.metadata.daisy_refund_action_id !== action.id ||
    (action.state.kind === 'known' && action.state.refundId !== refund.id)
  )
    return refuse;
  return {
    kind: 'observe',
    claimId,
    refundId: refund.id,
    status: refund.status,
  };
}
const pageSchema = z.object({
  object: z.literal('list'),
  has_more: z.boolean(),
  data: z
    .array(
      z.object({
        id: vendorId('re'),
        charge: reference('ch'),
        metadata: z
          .object({ daisy_refund_action_id: z.string().optional() })
          .nullable(),
      }),
    )
    .max(100),
});
type Page = z.infer<typeof pageSchema>;
function validPage(action: RefundAction, page: Page, cursor: string | null) {
  return (
    !(page.has_more && page.data.length === 0) &&
    new Set(page.data.map((row) => row.id)).size === page.data.length &&
    page.data.every(
      (row) => row.charge === action.chargeId && row.id !== cursor,
    )
  );
}

/** The action supplies original charge/amount/key. Privacy-job identity never enters a vendor request. */
export function createRefundVendor(input: {
  readonly port: RefundPort;
  readonly clock: Clock;
  readonly mode: 'test' | 'live';
}) {
  const permitted = (action: RefundAction, claimId: string) =>
    action.mode === input.mode &&
    ownsRefundClaim(action, claimId, {
      now: input.clock.now(),
      authority: 'closed',
    });
  async function discover(
    action: RefundAction,
    claimId: string,
  ): Promise<Result> {
    if (action.state.kind !== 'unknown') return refuse;
    const cursor = action.state.afterRefundId;
    const parsed = pageSchema.safeParse(
      await input.port.list({
        charge: action.chargeId,
        limit: 100,
        ...(cursor === null ? {} : { starting_after: cursor }),
      }),
    );
    if (!parsed.success || !validPage(action, parsed.data, cursor))
      return refuse;
    const matches = parsed.data.data.filter(
      (row) => row.metadata?.daisy_refund_action_id === action.id,
    );
    if (matches.length > 1) return refuse;
    const found = matches[0];
    if (found) {
      if (!permitted(action, claimId)) return refuse;
      return observation(action, claimId, await input.port.retrieve(found.id));
    }
    return {
      kind: 'searched',
      claimId,
      beforeRefundId: cursor,
      afterRefundId: parsed.data.has_more ? parsed.data.data.at(-1)!.id : null,
    };
  }
  return {
    async run(action: RefundAction, claimId: string): Promise<Result> {
      if (!permitted(action, claimId) || action.claim === null) return refuse;
      try {
        switch (action.claim.work) {
          case 'create':
            return observation(
              action,
              claimId,
              await input.port.create(
                {
                  charge: action.chargeId,
                  amount: action.amountMinor,
                  metadata: { daisy_refund_action_id: action.id },
                },
                refundIdempotencyKey(action),
              ),
            );
          case 'discover':
            return await discover(action, claimId);
          case 'retrieve':
            return action.state.kind === 'known'
              ? observation(
                  action,
                  claimId,
                  await input.port.retrieve(action.state.refundId),
                )
              : refuse;
        }
      } catch {
        return { kind: 'unresolved', claimId };
      }
    },
  };
}
