import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  billingCleanupSchema,
  type CleanupContext,
} from '@daisy/protocol/billing';
import { privacyJobs } from './schema/privacy-jobs';
import { lockRefundAccount } from './billing-refund-authority';
import { readDatabaseTime } from './database-clock';
import type { Tx } from './tx';
import { query } from './raw-rows';
import { z } from 'zod';

export async function lockCleanupRecord(tx: Tx, jobId: string) {
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
  return row ? { row, userId: selector.userId, closedAt } : null;
}

export async function lockCleanupJob(tx: Tx, jobId: string) {
  const locked = await lockCleanupRecord(tx, jobId);
  if (!locked || locked.row.status !== 'pending') return null;
  const { row } = locked;
  const state =
    row.billingCleanup === null
      ? null
      : billingCleanupSchema.parse(row.billingCleanup);
  if (state && state.jobId !== jobId) throw createAppError('CONFLICT');
  return { ...locked, state };
}

/** Positive current absence includes retained financial routing, not merely a missing customer. */
export async function cleanupFacts(tx: Tx, userId: string) {
  const [effects] = await query(
    tx,
    z.object({
      mappedCustomers: z.int().nonnegative(),
      possiblePurchases: z.int().nonnegative(),
      retainedFinancialRoutes: z.int().nonnegative(),
      owedFinancialEffects: z.boolean(),
    }),
    sql`select
    (select count(*)::int from billing_customers where user_id=${userId}) as "mappedCustomers",
    (select count(*)::int from billing_purchases where user_id=${userId} and state->>'kind' not in ('admitted','abandoned','expired')) as "possiblePurchases",
    (select count(*)::int from billing_refund_actions where user_id=${userId})+
      (case when exists(select 1 from billing_payment_observations where user_id=${userId}) then 1 else 0 end) as "retainedFinancialRoutes",
    (exists(select 1 from billing_refund_actions action where action.user_id=${userId}
      and not coalesce(action.state->>'kind'='known' and action.state->>'status'='succeeded',false)) or
    exists(select 1 from billing_payment_observations observation left join billing_refund_actions action on action.id=observation.refund_action_id
      where observation.user_id=${userId} and (observation.state->>'kind'='owed' or
        (observation.state->>'kind'='refund-linked' and not coalesce(action.state->>'kind'='known' and action.state->>'status'='succeeded',false)))) ) as "owedFinancialEffects"`,
  );
  if (!effects) throw createAppError('INVARIANT');
  const routes = await query(
    tx,
    z.object({ mode: z.string(), customerId: z.string() }),
    sql`select mode,"customerId" from (
    select mode,vendor_customer_id as "customerId" from billing_customers where user_id=${userId}
    union select mode,state->>'customerId' as "customerId" from billing_purchases where user_id=${userId} and state->>'customerId' is not null
    union select mode,vendor_customer_id as "customerId" from billing_refund_actions where user_id=${userId}
    union select mode,vendor_customer_id as "customerId" from billing_payment_observations where user_id=${userId}
  ) owned_routes limit 2`,
  );
  return {
    effects,
    route: cleanupRoute(routes),
  };
}
function cleanupRoute(
  routes: readonly { readonly mode?: unknown; readonly customerId?: unknown }[],
):
  | { readonly kind: 'absent' }
  | { readonly kind: 'unresolved' }
  | {
      readonly kind: 'owned';
      readonly mode: 'test' | 'live';
      readonly customerId: string;
    } {
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
  tx: Tx,
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
