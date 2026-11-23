import type { SQL } from 'bun';
import type { Waits } from '@daisy/clock';
import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql/postgres';
import { createBillingInbox } from './billing-inbox';
import {
  createBillingPurchases,
  type BillingPurchasePolicies,
} from './billing-purchase-store';
import {
  createBillingSynchronization,
  type GrantProjections,
} from './billing-synchronization';
import { createBoundedTransaction } from './bounded-transaction';
import { scopeTransaction } from './tenant-scope';
import { createLane } from './workload';
import { inTransaction } from './tx';
import { run as runStatement, query } from './raw-rows';
import { z } from 'zod';

/**
 * A club with a paid Club plan, for the browser suite (ADR 0148): the
 * organisation and its owner's membership, then a Checkout completed through
 * real admission and mapping, then one verified paid observation applied
 * through the real inbox and reconciliation. No vendor is called; the
 * policies and projections come from the caller, as in production.
 */
export async function fundTestClub(
  client: SQL,
  input: {
    readonly owner: { readonly userId: string; readonly actorId: string };
    readonly name: string;
    readonly seats: number;
    readonly policies: BillingPurchasePolicies;
    readonly grants: GrantProjections;
    /** The time the club's transactions are bounded on. */
    readonly waits: Waits;
  },
) {
  const run = createBoundedTransaction({
    lane: createLane(
      'control',
      client,
      { connections: 4, queue: 16, maxWaitMs: 5_000 },
      { waits: input.waits },
    ),
    waits: input.waits,
  });
  const organizationId = createId();
  await inTransaction(drizzle({ client }), async (tx) => {
    await scopeTransaction(tx, { organizationId });
    await runStatement(
      tx,
      sql`insert into organizations (id, kind, name, handle, owner_user_id)
      values (${organizationId}, 'school', ${input.name}, ${`club-${organizationId}`}, ${input.owner.userId})`,
    );
    await runStatement(
      tx,
      sql`insert into memberships (organization_id, user_id, status, joined_at)
      values (${organizationId}, ${input.owner.userId}, 'active', now())`,
    );
  });
  const subject = { ...input.owner, organizationId };
  const purchases = createBillingPurchases({
    run,
    nextId: createId,
    policies: input.policies,
  });
  const vendorCustomerId = `cus_test${createId()}`;
  const admitted = await purchases.admit(subject, {
    mode: 'test',
    priceId: 'price_e2eClubSeat',
    quantity: input.seats,
    returnOrigin: 'https://localhost',
  });
  await purchases.recover(subject, admitted.purchase.id);
  await purchases.record(subject, admitted.purchase.id, {
    kind: 'observe',
    session: {
      kind: 'complete',
      id: `cs_test_${createId()}`,
      customerId: vendorCustomerId,
      subscriptionId: `sub_test${createId()}`,
    },
  });
  const [ids] = await run(async (tx) => {
    await scopeTransaction(tx, { organizationId });
    return query(
      tx,
      z.object({
        customer_id: z.string(),
        subscription_id: z.string(),
        now: z.date(),
      }),
      sql`select c.id as customer_id, s.id as subscription_id, now() as now
      from billing_customers c join billing_subscriptions s
        on s.organization_id = c.organization_id and s.current
      where c.organization_id = ${organizationId}`,
    );
  });
  if (!ids)
    throw new Error('The test Club purchase established no subscription');
  const now = ids.now.getTime();
  await createBillingInbox({ run, nextId: createId })({
    eventId: `evt_${createId()}`,
    customerId: vendorCustomerId,
    mode: 'test',
  });
  const sync = createBillingSynchronization({
    run,
    nextId: createId,
    grants: input.grants,
  });
  const claim = await sync.claim(String(ids.customer_id));
  if (!claim) throw new Error('The test Club plan could not be claimed');
  await sync.apply(
    claim,
    {
      lifecycle: 'active',
      settlement: {
        kind: 'paid',
        invoiceId: `in_${createId()}`,
        period: {
          subscriptionId: String(ids.subscription_id),
          startsAt: new Date(now - 86_400_000).toISOString(),
          endsAt: new Date(now + 29 * 86_400_000).toISOString(),
        },
      },
    },
    { renewalOff: false, amountMinor: 1000, seatCount: input.seats },
  );
  return organizationId;
}
