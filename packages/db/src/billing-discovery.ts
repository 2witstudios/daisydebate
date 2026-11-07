import { checkBillingPage, type BillingPage } from './billing-pagination';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
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
          .where(
            and(
              eq(billingWebhookEvents.mode, input.mode),
              isNull(billingWebhookEvents.notifiedAt),
              sql`(exists(select 1 from billing_customers where mode=${billingWebhookEvents.mode}
                and vendor_customer_id=${billingWebhookEvents.vendorCustomerId})
                or exists(select 1 from billing_refund_actions where mode=${billingWebhookEvents.mode}
                and vendor_customer_id=${billingWebhookEvents.vendorCustomerId}))`,
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
