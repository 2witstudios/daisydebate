import type { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { subscriptionGrants } from '@daisy/auth/authorization';
import type { SubscriptionEvidence } from '@daisy/protocol/billing';
import type { BoundedTransaction } from '../src/bounded-transaction';
import { createBillingSynchronization } from '../src/billing-synchronization';
import { createBillingInbox } from '../src/billing-inbox';
import type { Fixture } from './constraint-helpers';
import { withBillingPurchases, offer } from './billing-purchases.test-support';
import { flagCommand } from './flags.test-support';
import { completeControlledBillingPurchase } from '../src/testing-billing-purchase';

export function withBillingSynchronization(
  work: (input: {
    readonly fixture: Fixture;
    readonly pool: SQL;
    readonly run: BoundedTransaction;
    readonly customerId: string;
    readonly userId: string;
    readonly actorId: string;
    readonly subscriptionId: string;
    readonly vendorCustomerId: string;
    readonly paid: SubscriptionEvidence;
    readonly inbox: ReturnType<typeof createBillingInbox>;
    readonly store: ReturnType<typeof createBillingSynchronization>;
  }) => Promise<void>,
) {
  return withBillingPurchases(async (input) => {
    const { fixture, pool, run, userId, actorId, purchases, subject } = input;
    const vendorCustomerId = `cus_${createId()}`;
    const vendorSubscriptionId = `sub_${createId()}`;
    await input.store.runFlagCommand(flagCommand(input.key, 0));
    await completeControlledBillingPurchase({
      purchases,
      subject,
      offer,
      session: {
        kind: 'complete',
        id: `cs_test_${createId()}`,
        customerId: vendorCustomerId,
        subscriptionId: vendorSubscriptionId,
      },
    });
    const [customer] =
      await fixture.sql`select id from billing_customers where user_id=${userId}`;
    const [subscription] =
      await fixture.sql`select id from billing_subscriptions where user_id=${userId} and current`;
    const customerId = customer!.id as string,
      subscriptionId = subscription!.id as string;
    await fixture.sql`delete from account_entitlement_grants where user_id=${userId} and source='beta'`;
    const [clock] = await fixture.sql`select clock_timestamp() as now`;
    const now = (clock!.now as Date).toISOString();
    const paid: SubscriptionEvidence = {
      lifecycle: 'active',
      settlement: {
        kind: 'paid',
        invoiceId: `in_${subscriptionId}`,
        period: {
          subscriptionId,
          startsAt: now,
          endsAt: new Date(Date.parse(now) + 30 * 86400000).toISOString(),
        },
      },
    };
    try {
      await work({
        fixture,
        pool,
        run,
        customerId,
        userId,
        actorId,
        vendorCustomerId,
        subscriptionId,
        paid,
        inbox: createBillingInbox({ run, nextId: createId }),
        store: createBillingSynchronization({
          run,
          nextId: createId,
          grants: subscriptionGrants,
        }),
      });
    } finally {
      await fixture.sql`delete from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
      await fixture.sql`delete from billing_webhook_events where vendor_customer_id=${vendorCustomerId}`;
      await fixture.sql`delete from account_entitlement_grants where user_id=${userId}`;
    }
  });
}
