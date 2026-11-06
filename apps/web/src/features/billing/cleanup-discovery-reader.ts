import { z } from 'zod';
import {
  cleanupWorkSchema,
  ownedInvoiceObservationSchema,
  type CleanupWork,
} from '@daisy/protocol/billing';
import type { CleanupVendorPort } from './cleanup-vendor';
import { readCleanupInvoiceIdentity } from './cleanup-invoice-identity';
const id = (prefix: string) =>
  z
    .string()
    .max(255)
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`));
const customer = z.union([
  id('cus'),
  z.object({ id: id('cus') }).transform((value) => value.id),
]);
const page = z
  .object({
    object: z.literal('list'),
    has_more: z.boolean(),
    data: z.array(z.unknown()).max(20),
  })
  .refine((value) => !(value.has_more && value.data.length === 0));
const subscription = z.object({
  id: id('sub'),
  object: z.literal('subscription'),
  customer,
  livemode: z.boolean(),
});
const route = z.strictObject({
  mode: z.enum(['test', 'live']),
  customerId: id('cus'),
});
const unavailable = { kind: 'unavailable' } as const;

/** Discovery proves owned identities only. It neither proves payment enumeration nor authorizes money/cancellation. */
export function createCleanupDiscoveryReader(input: {
  readonly port: Pick<CleanupVendorPort, 'subscriptions' | 'invoices'>;
  readonly mode: 'test' | 'live';
}) {
  return async (owner: unknown, work: CleanupWork) => {
    const expected = route.safeParse(owner),
      parsed = cleanupWorkSchema.safeParse(work);
    if (
      !expected.success ||
      expected.data.mode !== input.mode ||
      !parsed.success ||
      parsed.data.kind !== 'scan' ||
      parsed.data.scan.kind !== 'page'
    )
      return unavailable;
    if (!isDiscoveryLane(parsed.data.lane)) return unavailable;
    const request = {
      customer: expected.data.customerId,
      afterId: parsed.data.scan.afterId,
    };
    let raw: unknown;
    try {
      raw = await input.port[parsed.data.lane](request);
    } catch {
      return unavailable;
    }
    const received = page.safeParse(raw);
    if (!received.success) return unavailable;
    return parsed.data.lane === 'invoices'
      ? readInvoices(expected.data, received.data, parsed.data.scan.afterId)
      : readSubscriptions(
          expected.data,
          received.data,
          parsed.data.scan.afterId,
        );
  };
}
function readInvoices(
  owner: z.infer<typeof route>,
  received: z.infer<typeof page>,
  afterId: string | null,
) {
  const reads: ReturnType<typeof ownedInvoiceObservationSchema.parse>[] = [],
    seen = new Set<string>();
  let complete = true;
  for (const value of received.data) {
    const parsed = readCleanupInvoiceIdentity(owner, value);
    if (!parsed) {
      complete = false;
      continue;
    }
    if (seen.has(parsed.invoiceId) || parsed.invoiceId === afterId)
      complete = false;
    seen.add(parsed.invoiceId);
    reads.push(parsed);
  }
  if (complete)
    return { kind: 'invoice-page' as const, reads, more: received.has_more };
  return reads.length ? { kind: 'invoice-reads' as const, reads } : unavailable;
}
function readSubscriptions(
  owner: z.infer<typeof route>,
  received: z.infer<typeof page>,
  afterId: string | null,
) {
  const ids: string[] = [];
  for (const value of received.data) {
    const parsed = subscription.safeParse(value);
    if (
      !parsed.success ||
      parsed.data.customer !== owner.customerId ||
      parsed.data.livemode !== (owner.mode === 'live') ||
      ids.includes(parsed.data.id) ||
      parsed.data.id === afterId
    )
      return unavailable;
    ids.push(parsed.data.id);
  }
  return { kind: 'subscription-page' as const, ids, more: received.has_more };
}

function isDiscoveryLane(lane: string): lane is 'subscriptions' | 'invoices' {
  return lane === 'subscriptions' || lane === 'invoices';
}
