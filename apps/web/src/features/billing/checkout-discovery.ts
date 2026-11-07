import type Stripe from 'stripe';
import { z } from 'zod';
import {
  purchaseBounds,
  purchaseSchema,
  type Purchase,
} from '@daisy/protocol/billing';
import {
  normalizeCheckoutSession,
  type CheckoutObservation,
} from './checkout-session';

export type CheckoutSearchPort = {
  readonly list: (
    parameters: Stripe.Checkout.SessionListParams,
  ) => Promise<unknown>;
  readonly retrieve: (id: string) => Promise<unknown>;
};
type Discovery =
  | CheckoutObservation
  | { readonly kind: 'unknown' }
  | {
      readonly kind: 'searched';
      readonly beforeSessionId: string | null;
      readonly afterSessionId: string | null;
    };
const sessionId = z
  .string()
  .regex(/^cs_(test|live)_[A-Za-z0-9_]+$/)
  .max(255);
const pageSchema = z.object({
  object: z.literal('list'),
  has_more: z.boolean(),
  data: z
    .array(
      z.object({
        id: sessionId,
        created: z.number().int().nonnegative(),
        livemode: z.boolean(),
        client_reference_id: z.string().max(200).nullable(),
        metadata: z
          .object({ daisy_purchase_id: z.string().max(500).optional() })
          .nullable(),
      }),
    )
    .max(100),
});
type Page = z.infer<typeof pageSchema>;
const cursor = (purchase: Purchase) =>
  purchase.state.kind === 'unknown' ? purchase.state.afterSessionId : null;

export function checkoutSearchParameters(purchase: Purchase) {
  const after = cursor(purchase);
  return {
    created: {
      gte: Math.floor(Date.parse(purchase.admittedAt) / 1000),
      lt: Math.ceil(
        (Date.parse(purchase.admittedAt) + purchaseBounds.creationMs) / 1000,
      ),
    },
    limit: 100,
    ...(purchase.customerId === null ? {} : { customer: purchase.customerId }),
    ...(after === null ? {} : { starting_after: after }),
  } satisfies Stripe.Checkout.SessionListParams;
}

function validPage(purchase: Purchase, page: Page) {
  const { created } = checkoutSearchParameters(purchase);
  if (page.has_more && page.data.length === 0) return false;
  if (new Set(page.data.map((row) => row.id)).size !== page.data.length)
    return false;
  return page.data.every(
    (row) =>
      row.livemode === (purchase.mode === 'live') &&
      row.id.startsWith(`cs_${purchase.mode}_`) &&
      row.id !== cursor(purchase) &&
      row.created >= created.gte &&
      row.created < created.lt,
  );
}

/** At most one 100-item list page and one selected retrieval; the purchase stores cursor progress. */
export async function discoverCheckout(
  input: { readonly port: CheckoutSearchPort; readonly mode: Purchase['mode'] },
  purchase: Purchase,
): Promise<Discovery> {
  if (
    !purchaseSchema.safeParse(purchase).success ||
    purchase.mode !== input.mode ||
    !['creating', 'unknown'].includes(purchase.state.kind)
  )
    return { kind: 'refuse' };
  const { port } = input;
  try {
    const parsed = pageSchema.safeParse(
      await port.list(checkoutSearchParameters(purchase)),
    );
    if (!parsed.success || !validPage(purchase, parsed.data))
      return { kind: 'refuse' };
    const page = parsed.data;
    const matching = page.data.filter(
      (row) =>
        row.metadata?.daisy_purchase_id === purchase.id ||
        row.client_reference_id === purchase.id,
    );
    if (matching.length > 1) return { kind: 'refuse' };
    const found = matching[0];
    if (found)
      return normalizeCheckoutSession(purchase, await port.retrieve(found.id));
    return {
      kind: 'searched',
      beforeSessionId: cursor(purchase),
      afterSessionId: page.has_more
        ? page.data[page.data.length - 1]!.id
        : null,
    };
  } catch {
    return { kind: 'unknown' };
  }
}
