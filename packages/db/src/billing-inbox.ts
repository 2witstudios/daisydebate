import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { z } from 'zod';
import { advanceBillingSync } from '@daisy/protocol/billing';
import type { BoundedTransaction } from './bounded-transaction';
import { lockBillingCustomer } from './billing-authority';
import { readDatabaseTime } from './database-clock';
import { billingCustomers } from './schema/billing-customers';
import { billingWebhookEvents } from './schema/billing-webhook-events';
import { enqueuePrivacyJob } from './privacy/enqueue-job';

const receiptSchema = z.strictObject({
  eventId: z
    .string()
    .regex(/^evt_[A-Za-z0-9]+$/)
    .max(255),
  customerId: z
    .string()
    .regex(/^cus_[A-Za-z0-9]+$/)
    .max(255),
  mode: z.enum(['test', 'live']),
});
export type BillingReceipt = z.infer<typeof receiptSchema>;
type Tx = Parameters<Parameters<BoundedTransaction>[0]>[0];

async function notifyCustomer(
  tx: Tx,
  locked: NonNullable<Awaited<ReturnType<typeof lockBillingCustomer>>>,
  nextId: () => string,
  now: Date,
) {
  if (locked.account.erased || locked.customer.closedAt) {
    await enqueuePrivacyJob(tx, {
      id: nextId(),
      subjectRef: locked.customer.userId,
      vendor: 'stripe',
      createdAt: now.toISOString(),
    });
    return 'closed' as const;
  }
  const transition = advanceBillingSync(
    locked.customer.synchronization,
    { kind: 'notify', newReceipt: true },
    now.toISOString(),
  );
  if (transition.kind !== 'changed') throw createAppError('CONFLICT');
  await tx
    .update(billingCustomers)
    .set({ synchronization: transition.state })
    .where(eq(billingCustomers.id, locked.customer.id));
  return 'recorded' as const;
}

async function writeReceipt(
  tx: Tx,
  input: BillingReceipt,
  nextId: () => string,
) {
  await tx
    .insert(billingWebhookEvents)
    .values({
      id: nextId(),
      vendorEventId: input.eventId,
      vendorCustomerId: input.customerId,
      mode: input.mode,
    })
    .onConflictDoNothing({
      target: [billingWebhookEvents.mode, billingWebhookEvents.vendorEventId],
    });
  const [row] = await tx
    .select()
    .from(billingWebhookEvents)
    .where(
      and(
        eq(billingWebhookEvents.mode, input.mode),
        eq(billingWebhookEvents.vendorEventId, input.eventId),
      ),
    )
    .for('update');
  if (!row || row.vendorCustomerId !== input.customerId)
    throw createAppError('CONFLICT');
  return row;
}

/** A successful HTTP receipt is durable even if the service dies before fetching Stripe. */
export function createBillingInbox(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  return async (receipt: BillingReceipt) => {
    const parsed = receiptSchema.safeParse(receipt);
    if (!parsed.success) throw createAppError('VALIDATION');
    return input.run(async (tx) => {
      const [target] = await tx
        .select({ id: billingCustomers.id })
        .from(billingCustomers)
        .where(
          and(
            eq(billingCustomers.mode, receipt.mode),
            eq(billingCustomers.vendorCustomerId, receipt.customerId),
          ),
        );
      const locked = target ? await lockBillingCustomer(tx, target.id) : null;
      const row = await writeReceipt(tx, receipt, input.nextId);
      if (row.notifiedAt) return 'duplicate' as const;
      // Unknown customers remain pending; purchase completion or the bounded inbox sweep links them.
      if (!locked) return 'pending' as const;
      if (
        locked.customer.mode !== receipt.mode ||
        locked.customer.vendorCustomerId !== receipt.customerId
      )
        throw createAppError('CONFLICT');
      const now = await readDatabaseTime(tx);
      const outcome = await notifyCustomer(tx, locked, input.nextId, now);
      await tx
        .update(billingWebhookEvents)
        .set({ notifiedAt: now })
        .where(eq(billingWebhookEvents.id, row.id));
      return outcome;
    });
  };
}

/** Retain only bounded receipts; replay after retention still rereads current vendor facts. */
export async function eraseBillingReceipts(
  tx: Pick<Tx, 'execute'>,
  userId: string,
) {
  await tx.execute(sql`delete from billing_webhook_events where (mode,vendor_customer_id) in
    (select mode,vendor_customer_id from billing_customers where user_id=${userId})`);
}
