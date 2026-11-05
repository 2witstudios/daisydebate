import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { subscriptionGrants } from '@daisy/auth/authorization';
import type { SubscriptionEvidence } from '@daisy/protocol/billing';
import {
  createBoundedTransaction,
  type BoundedTransaction,
} from '../src/bounded-transaction';
import { createLane } from '../src/workload';
import { createBillingSynchronization } from '../src/billing-synchronization';
import { createBillingInbox } from '../src/billing-inbox';
import { withFixture, type Fixture } from './constraint-helpers';

const { databaseUrl } = requireTestServices(process.env);
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
  return withFixture(databaseUrl, async (fixture) => {
    const pool = new SQL(databaseUrl, { max: 6 });
    const run = createBoundedTransaction({
      lane: createLane('control', pool, {
        connections: 6,
        queue: 64,
        maxWaitMs: 1000,
      }),
      now: performance.now,
    });
    const userId = await fixture.user();
    const actorId = await fixture.actor(userId);
    const customerId = createId();
    const vendorCustomerId = `cus_${customerId}`;
    const subscriptionId = createId();
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
      await fixture.sql`insert into billing_customers(id,user_id,vendor_customer_id,mode,synchronization)
        values(${customerId},${userId},${vendorCustomerId},'test',${JSON.stringify({ kind: 'pending', revision: 1, requestedAt: now, retryAt: now })}::text::jsonb)`;
      await fixture.sql`insert into billing_subscriptions(id,user_id,vendor_subscription_id,evidence,current,observed_at)
        values(${subscriptionId},${userId},${`sub_${subscriptionId}`},${JSON.stringify({ lifecycle: 'incomplete', settlement: { kind: 'unpaid' } })}::text::jsonb,true,${now}::timestamptz)`;
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
      await pool.close({ timeout: 0 });
      await fixture.sql`delete from privacy_jobs where subject_ref=${userId} and vendor='stripe'`;
      await fixture.sql`delete from billing_webhook_events where vendor_customer_id=${vendorCustomerId}`;
      await fixture.sql`delete from account_entitlement_grants where user_id=${userId}`;
      await fixture.sql`delete from billing_subscriptions where user_id=${userId}`;
      await fixture.sql`delete from billing_customers where user_id=${userId}`;
    }
  });
}
