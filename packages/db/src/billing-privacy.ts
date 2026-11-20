import { sql } from 'drizzle-orm';
import { readDatabaseTime } from './database-clock';
import { eraseBillingReceipts } from './billing-inbox';
import type { PrivacyAdopter } from './privacy/contracts';
import { run, query } from './raw-rows';
import { z } from 'zod';

/** The canonical account fence also excludes receipt, claim and subscription application. */
export const billingPrivacyAdopter: PrivacyAdopter = {
  id: 'billing',
  phase: 'after-close',
  erase: async (tx, subject) => {
    const now = await readDatabaseTime(tx);
    await eraseBillingReceipts(tx, subject.userId);
    await run(
      tx,
      sql`delete from billing_subscriptions where user_id=${subject.userId}`,
    );
    // A claimed or observed purchase may still have vendor effects. Preserve that
    // cleanup obligation; never infer non-execution from an expired lease.
    await run(
      tx,
      sql`delete from billing_purchases where user_id=${subject.userId}
      and state->>'kind' in ('admitted','abandoned','expired')`,
    );
    // The minimal mapping remains an owed vendor-cleanup obligation; it never authorizes access.
    await run(
      tx,
      sql`update billing_customers set closed_at=coalesce(closed_at,${now}),
      synchronization=jsonb_build_object('kind','settled','revision',synchronization->'revision',
        'observedAt',${now.toISOString()}::text,'nextAt',${now.toISOString()}::text) where user_id=${subject.userId}`,
    );
  },
  export: async (tx, subject) => {
    const customers = await query(
      tx,
      z.object({
        id: z.string(),
        vendor_customer_id: z.string(),
        mode: z.string(),
        closed_at: z.string().nullable(),
        created_at: z.string(),
      }),
      sql`select id,vendor_customer_id,mode,
      to_char(closed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as closed_at,
      to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
      from billing_customers where user_id=${subject.userId} order by id`,
    );
    const subscriptions = await query(
      tx,
      z.object({
        id: z.string(),
        vendor_subscription_id: z.string(),
        evidence: z.json(),
        current: z.boolean(),
        renewal_off: z.boolean(),
        amount_minor: z.int().nullable(),
        observed_at: z.string(),
        created_at: z.string(),
      }),
      sql`select id,vendor_subscription_id,evidence,current,renewal_off,amount_minor,
      to_char(observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as observed_at,
      to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
      from billing_subscriptions where user_id=${subject.userId} order by created_at,id`,
    );
    const receipts = await query(
      tx,
      z.object({ vendor_event_id: z.string(), received_at: z.string() }),
      sql`select vendor_event_id,
      to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as received_at
      from billing_webhook_events where (mode,vendor_customer_id) in
        (select mode,vendor_customer_id from billing_customers where user_id=${subject.userId}
          union select mode,vendor_customer_id from billing_refund_actions where user_id=${subject.userId}
          union select mode,vendor_customer_id from billing_payment_observations where user_id=${subject.userId}) order by received_at,id`,
    );
    const purchases = await query(
      tx,
      z.object({
        id: z.string(),
        mode: z.string(),
        price_id: z.string(),
        vendor_customer_id: z.string().nullable(),
        return_origin: z.string(),
        admitted_at: z.string(),
        state: z.json(),
      }),
      sql`select id,mode,price_id,vendor_customer_id,return_origin,
      to_char(admitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as admitted_at,
      state-'claim'-'afterSessionId' as state
      from billing_purchases where user_id=${subject.userId} order by admitted_at,id`,
    );
    const refunds = await query(
      tx,
      z.object({
        id: z.string(),
        mode: z.string(),
        vendor_customer_id: z.string(),
        vendor_charge_id: z.string(),
        vendor_invoice_id: z.string(),
        vendor_subscription_id: z.string(),
        amount_minor: z.string(),
        currency: z.string(),
        paid_at_seconds: z.string(),
        period_starts_at: z.string(),
        period_ends_at: z.string(),
        closed_at: z.string(),
        admitted_at: z.string(),
        state: z.json(),
      }),
      sql`select id,mode,vendor_customer_id,vendor_charge_id,vendor_invoice_id,vendor_subscription_id,
      amount_minor::text as amount_minor,currency,paid_at_seconds::text as paid_at_seconds,
      to_char(period_starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as period_starts_at,
      to_char(period_ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as period_ends_at,
      to_char(closed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as closed_at,
      to_char(admitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as admitted_at,
      state-'afterRefundId' as state from billing_refund_actions where user_id=${subject.userId} order by admitted_at,id`,
    );
    const observations = await query(
      tx,
      z.object({
        id: z.string(),
        mode: z.string(),
        vendor_customer_id: z.string(),
        vendor_invoice_id: z.string(),
        kind: z.string(),
        vendor_invoice_payment_id: z.string().nullable(),
        refund_action_id: z.string().nullable(),
        source: z.json(),
        state: z.json(),
        closed_at: z.string(),
        created_at: z.string(),
        observed_at: z.string(),
      }),
      sql`select id,mode,vendor_customer_id,vendor_invoice_id,kind,vendor_invoice_payment_id,refund_action_id,source,state,
      to_char(closed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as closed_at,
      to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
      to_char(observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as observed_at
      from billing_payment_observations where user_id=${subject.userId} order by id`,
    );
    const unroutedInvoices = await query(
      tx,
      z.object({ vendor_invoice_id: z.string() }),
      sql`select identity as vendor_invoice_id
      from privacy_jobs job cross join lateral
        jsonb_array_elements_text(job.billing_cleanup->'invoiceDebt'->'ids') identity
      where job.subject_ref=${subject.userId} and job.vendor='stripe'
        and job.billing_cleanup->'invoiceDebt'->>'kind'='owed' order by identity`,
    );
    return {
      billing_customers: customers,
      billing_subscriptions: subscriptions,
      billing_webhook_events: receipts,
      billing_purchases: purchases,
      billing_refund_actions: refunds,
      billing_payment_observations: observations,
      billing_unrouted_invoices: unroutedInvoices,
    };
  },
};
