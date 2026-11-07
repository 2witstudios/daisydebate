import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { createBoundedTransaction } from '../src/bounded-transaction';
import { createLane } from '../src/workload';
import { createBillingInbox } from '../src/billing-inbox';
import { withFixture, type Fixture } from './constraint-helpers';

const { databaseUrl } = requireTestServices(process.env);
type Run = ReturnType<typeof createBoundedTransaction>;
export type RefundSubjectFixture = {
  readonly fixture: Fixture;
  readonly pool: SQL;
  readonly run: Run;
  readonly customerId: string;
  readonly userId: string;
  readonly actorId: string;
  readonly subscriptionId: string;
  readonly vendorCustomerId: string;
  readonly inbox: ReturnType<typeof createBillingInbox>;
};

/** Positive owned vendor routing only; refund-only cohorts never inherit a Checkout purchase or grants. */
export function withRefundSubject(
  work: (input: RefundSubjectFixture) => Promise<void>,
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
    const userId = await fixture.user(),
      actorId = await fixture.actor(userId);
    const customerId = createId(),
      vendorCustomerId = `cus_${customerId}`,
      subscriptionId = createId();
    try {
      const [clock] = await fixture.sql`select clock_timestamp() as at`;
      const at = clock!.at as Date;
      await fixture.sql`insert into billing_customers(id,user_id,vendor_customer_id,mode,created_at,synchronization)
        values(${customerId},${userId},${vendorCustomerId},'test',${new Date(at.getTime() - 60_000)},${JSON.stringify({ kind: 'pending', revision: 1, requestedAt: at.toISOString(), retryAt: at.toISOString() })}::text::jsonb)`;
      await work({
        fixture,
        pool,
        run,
        customerId,
        userId,
        actorId,
        vendorCustomerId,
        subscriptionId,
        inbox: createBillingInbox({ run, nextId: createId }),
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
