import { sql } from 'drizzle-orm';
import { readDatabaseTime } from './database-clock';
import { eraseBillingReceipts } from './billing-inbox';
import type { PrivacyAdopter } from './privacy/contracts';

/** The canonical account fence also excludes receipt, claim and subscription application. */
export const billingPrivacyAdopter: PrivacyAdopter = {
  id: 'billing',
  phase: 'after-close',
  erase: async (tx, subject) => {
    const now = await readDatabaseTime(tx);
    await eraseBillingReceipts(tx, subject.userId);
    await tx.execute(
      sql`delete from billing_subscriptions where user_id=${subject.userId}`,
    );
    // A claimed or observed purchase may still have vendor effects. Preserve that
    // cleanup obligation; never infer non-execution from an expired lease.
    await tx.execute(sql`delete from billing_purchases where user_id=${subject.userId}
      and state->>'kind' in ('admitted','abandoned','expired')`);
    // The minimal mapping remains an owed vendor-cleanup obligation; it never authorizes access.
    await tx.execute(sql`update billing_customers set closed_at=coalesce(closed_at,${now}),
      synchronization=jsonb_build_object('kind','settled','revision',synchronization->'revision',
        'observedAt',${now.toISOString()}::text,'nextAt',${now.toISOString()}::text) where user_id=${subject.userId}`);
  },
  export: async (tx, subject) => {
    const customers = await tx.execute(sql`select id,vendor_customer_id,mode,
      to_char(closed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as closed_at,
      to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
      from billing_customers where user_id=${subject.userId} order by id`);
    const subscriptions =
      await tx.execute(sql`select id,vendor_subscription_id,evidence,current,
      to_char(observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as observed_at,
      to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
      from billing_subscriptions where user_id=${subject.userId} order by created_at,id`);
    const receipts = await tx.execute(sql`select vendor_event_id,
      to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as received_at
      from billing_webhook_events where (mode,vendor_customer_id) in
        (select mode,vendor_customer_id from billing_customers where user_id=${subject.userId}
          union select mode,vendor_customer_id from billing_refund_actions where user_id=${subject.userId}) order by received_at,id`);
    const purchases =
      await tx.execute(sql`select id,mode,price_id,vendor_customer_id,return_origin,
      to_char(admitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as admitted_at,
      state-'claim'-'afterSessionId' as state
      from billing_purchases where user_id=${subject.userId} order by admitted_at,id`);
    const refunds =
      await tx.execute(sql`select id,mode,vendor_customer_id,vendor_charge_id,vendor_invoice_id,vendor_subscription_id,
      amount_minor::text as amount_minor,currency,paid_at_seconds::text as paid_at_seconds,
      to_char(period_starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as period_starts_at,
      to_char(period_ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as period_ends_at,
      to_char(closed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as closed_at,
      to_char(admitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as admitted_at,
      state-'afterRefundId' as state from billing_refund_actions where user_id=${subject.userId} order by admitted_at,id`);
    return {
      billing_customers: customers as unknown as Record<string, unknown>[],
      billing_subscriptions: subscriptions as unknown as Record<
        string,
        unknown
      >[],
      billing_webhook_events: receipts as unknown as Record<string, unknown>[],
      billing_purchases: purchases as unknown as Record<string, unknown>[],
      billing_refund_actions: refunds as unknown as Record<string, unknown>[],
    };
  },
};
