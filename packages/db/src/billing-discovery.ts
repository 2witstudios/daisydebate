import { checkBillingPage, type BillingPage } from './billing-pagination';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import type { BoundedTransaction } from './bounded-transaction';
import { billingCustomers } from './schema/billing-customers';
import { billingWebhookEvents } from './schema/billing-webhook-events';

/** Page over durable identities, not only recently received events; claims recheck all authority/time. */
export function createBillingDiscovery(run: BoundedTransaction) {
  return {
    customers(input: BillingPage) {
      checkBillingPage(input);
      return run(async (tx) => {
        const rows = await tx
          .select({ customerId: billingCustomers.id })
          .from(billingCustomers)
          .where(
            and(
              eq(billingCustomers.mode, input.mode),
              isNull(billingCustomers.closedAt),
              ...(input.afterId === undefined
                ? []
                : [gt(billingCustomers.id, input.afterId)]),
            ),
          )
          .orderBy(asc(billingCustomers.id))
          .limit(input.limit);
        return {
          rows,
          afterId: rows.at(-1)?.customerId ?? null,
          exhausted: rows.length < input.limit,
        };
      });
    },
    receipts(input: BillingPage) {
      checkBillingPage(input);
      return run(async (tx) => {
        const rows = await tx
          .select({
            id: billingWebhookEvents.id,
            eventId: billingWebhookEvents.vendorEventId,
            customerId: billingWebhookEvents.vendorCustomerId,
          })
          .from(billingWebhookEvents)
          .innerJoin(
            billingCustomers,
            and(
              eq(billingCustomers.mode, billingWebhookEvents.mode),
              eq(
                billingCustomers.vendorCustomerId,
                billingWebhookEvents.vendorCustomerId,
              ),
            ),
          )
          .where(
            and(
              eq(billingWebhookEvents.mode, input.mode),
              isNull(billingWebhookEvents.notifiedAt),
              ...(input.afterId === undefined
                ? []
                : [gt(billingWebhookEvents.id, input.afterId)]),
            ),
          )
          .orderBy(asc(billingWebhookEvents.id))
          .limit(input.limit);
        return {
          rows: rows.map((row) => ({ ...row, mode: input.mode })),
          afterId: rows.at(-1)?.id ?? null,
          exhausted: rows.length < input.limit,
        };
      });
    },
  };
}
