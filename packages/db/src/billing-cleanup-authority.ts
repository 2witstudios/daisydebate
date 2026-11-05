import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  billingCleanupSchema,
  type CleanupContext,
} from '@daisy/protocol/billing';
import type { BoundedTransactionContext } from './transaction-context';
import { privacyJobs } from './schema/privacy-jobs';
import { lockRefundAccount } from './billing-refund-authority';
import { readDatabaseTime } from './database-clock';

export async function lockCleanupJob(
  tx: BoundedTransactionContext,
  jobId: string,
) {
  if (!idSchema.safeParse(jobId).success) throw createAppError('VALIDATION');
  const [selector] = await tx
    .select({ userId: privacyJobs.subjectRef })
    .from(privacyJobs)
    .where(and(eq(privacyJobs.id, jobId), eq(privacyJobs.vendor, 'stripe')));
  if (!selector) return null;
  const closedAt = await lockRefundAccount(tx, selector.userId);
  const [row] = await tx
    .select()
    .from(privacyJobs)
    .where(
      and(
        eq(privacyJobs.id, jobId),
        eq(privacyJobs.subjectRef, selector.userId),
        eq(privacyJobs.vendor, 'stripe'),
      ),
    )
    .for('update');
  if (!row || row.status !== 'pending') return null;
  const state =
    row.billingCleanup === null
      ? null
      : billingCleanupSchema.parse(row.billingCleanup);
  if (state && state.jobId !== jobId) throw createAppError('CONFLICT');
  return { row, state, userId: selector.userId, closedAt };
}

/** Positive current absence includes retained financial routing, not merely a missing customer. */
export async function cleanupFacts(
  tx: BoundedTransactionContext,
  userId: string,
) {
  const [effects] = await tx.execute(sql`select
    (select count(*)::int from billing_customers where user_id=${userId}) as "mappedCustomers",
    (select count(*)::int from billing_purchases where user_id=${userId} and state->>'kind' not in ('admitted','abandoned','expired')) as "possiblePurchases",
    (select count(*)::int from billing_refund_actions where user_id=${userId}) as "retainedFinancialRoutes"`);
  if (
    !effects ||
    !['mappedCustomers', 'possiblePurchases', 'retainedFinancialRoutes'].every(
      (key) => Number.isSafeInteger(effects[key]) && Number(effects[key]) >= 0,
    )
  )
    throw createAppError('INVARIANT');
  const routes = await tx.execute(sql`select mode,"customerId" from (
    select mode,vendor_customer_id as "customerId" from billing_customers where user_id=${userId}
    union select mode,state->>'customerId' as "customerId" from billing_purchases where user_id=${userId} and state->>'customerId' is not null
    union select mode,vendor_customer_id as "customerId" from billing_refund_actions where user_id=${userId}
  ) owned_routes limit 2`);
  return {
    effects: effects as {
      mappedCustomers: number;
      possiblePurchases: number;
      retainedFinancialRoutes: number;
    },
    route: cleanupRoute(routes),
  };
}
function cleanupRoute(
  routes: readonly { readonly mode?: unknown; readonly customerId?: unknown }[],
) {
  if (routes.length === 0) return { kind: 'absent' as const };
  const route = routes[0];
  if (
    routes.length !== 1 ||
    !route ||
    (route.mode !== 'test' && route.mode !== 'live') ||
    typeof route.customerId !== 'string' ||
    route.customerId.length > 255 ||
    !/^cus_[A-Za-z0-9]+$/.test(route.customerId)
  )
    return { kind: 'unresolved' as const };
  return {
    kind: 'owned' as const,
    mode: route.mode,
    customerId: route.customerId,
  };
}
export async function cleanupContext(
  tx: BoundedTransactionContext,
  jobId: string,
  effects: CleanupContext['effects'],
): Promise<CleanupContext> {
  return {
    now: (await readDatabaseTime(tx)).toISOString(),
    jobId,
    closed: true,
    ...(effects === undefined ? {} : { effects }),
  };
}
