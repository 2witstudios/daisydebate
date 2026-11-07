import { z } from 'zod';
import {
  ownedInvoiceObservationSchema,
  type OwnedInvoiceObservation,
} from '@daisy/protocol/billing';
import { invoiceSchema } from './subscription-vendor-facts';
const id = (prefix: string) =>
  z
    .string()
    .max(255)
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`));
const reference = (prefix: string) =>
  z.union([
    id(prefix),
    z.object({ id: id(prefix) }).transform((value) => value.id),
  ]);
const ownerSchema = ownedInvoiceObservationSchema.pick({
  mode: true,
  customerId: true,
});
const invoice = z.object({
  id: id('in'),
  object: z.literal('invoice'),
  customer: reference('cus'),
  livemode: z.boolean(),
});
const parent = z.object({
  parent: z.object({
    type: z.literal('subscription_details'),
    subscription_details: z.object({ subscription: reference('sub') }),
  }),
});

/** Positive identity and original subscription provenance only; no amount, period, coverage or refund authority. */
export function readCleanupInvoiceIdentity(
  owner: Pick<OwnedInvoiceObservation, 'mode' | 'customerId'>,
  value: unknown,
) {
  const expected = ownerSchema.safeParse(owner),
    actual = invoice.safeParse(value);
  if (
    !expected.success ||
    !actual.success ||
    actual.data.customer !== expected.data.customerId ||
    actual.data.livemode !== (expected.data.mode === 'live')
  )
    return null;
  const original = parent.safeParse(value);
  const read = ownedInvoiceObservationSchema.safeParse({
    ...expected.data,
    invoiceId: actual.data.id,
    source: {
      kind: 'unresolved',
      vendorSubscriptionId: original.success
        ? original.data.parent.subscription_details.subscription
        : null,
      priceId: discoveredPrice(
        value,
        original.success
          ? original.data.parent.subscription_details.subscription
          : null,
        actual.data.livemode,
      ),
    },
  });
  return read.success ? read.data : null;
}

function discoveredPrice(
  value: unknown,
  subscriptionId: string | null,
  livemode: boolean,
) {
  const full = invoiceSchema.safeParse(value);
  if (!full.success || subscriptionId === null) return null;
  const line = full.data.lines.data[0]!;
  return full.data.parent.subscription_details.subscription ===
    subscriptionId &&
    line.parent.subscription_item_details.subscription === subscriptionId &&
    line.livemode === livemode
    ? line.pricing.price_details.price
    : null;
}
