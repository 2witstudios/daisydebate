import { refundClaimSchema, refundStateSchema } from '@daisy/protocol/billing';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  jsonbColumn,
  jsonbColumnNullable,
  jsonbIsObject,
  oneOf,
  timestampColumn,
} from './columns';
import { users } from './users';

/** Financial cleanup identity survives ordinary customer deletion; job retries never replace it. */
export const billingRefundActions = pgTable(
  'billing_refund_actions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    mode: text('mode').notNull(),
    vendorCustomerId: text('vendor_customer_id').notNull(),
    vendorChargeId: text('vendor_charge_id').notNull(),
    vendorInvoiceId: text('vendor_invoice_id').notNull(),
    vendorSubscriptionId: text('vendor_subscription_id').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    periodStartsAt: timestampColumn('period_starts_at').notNull(),
    periodEndsAt: timestampColumn('period_ends_at').notNull(),
    closedAt: timestampColumn('closed_at').notNull(),
    paidAtSeconds: bigint('paid_at_seconds', { mode: 'number' }).notNull(),
    admittedAt: timestampColumn('admitted_at').notNull(),
    state: jsonbColumn('state', refundStateSchema).notNull(),
    claim: jsonbColumnNullable('claim', refundClaimSchema),
  },
  (table) => [
    uniqueIndex('billing_refund_actions_charge_unique').on(
      table.mode,
      table.vendorChargeId,
    ),
    uniqueIndex('billing_refund_actions_refund_unique').on(
      table.mode,
      sql`(${table.state}->>'refundId')`,
    ),
    index('billing_refund_actions_user_idx').on(table.userId, table.id),
    index('billing_refund_actions_mode_idx').on(table.mode, table.id),
    check(
      'billing_refund_actions_mode_check',
      oneOf(table.mode, ['test', 'live']),
    ),
    check(
      'billing_refund_actions_identity_check',
      sql`${table.id} ~ '^[a-z0-9]{24}$'
    and ${table.vendorCustomerId} ~ '^cus_[A-Za-z0-9_]+$' and length(${table.vendorCustomerId}) <= 255
    and ${table.vendorChargeId} ~ '^ch_[A-Za-z0-9_]+$' and length(${table.vendorChargeId}) <= 255
    and ${table.vendorInvoiceId} ~ '^in_[A-Za-z0-9_]+$' and length(${table.vendorInvoiceId}) <= 255
    and ${table.vendorSubscriptionId} ~ '^sub_[A-Za-z0-9_]+$' and length(${table.vendorSubscriptionId}) <= 255`,
    ),
    check(
      'billing_refund_actions_payment_check',
      sql`${table.currency}='usd' and ${table.amountMinor}>0 and ${table.amountMinor}<=9007199254740991
    and ${table.periodStartsAt}<${table.periodEndsAt} and ${table.paidAtSeconds}>=0 and ${table.paidAtSeconds}<=8640000000000
    and to_timestamp(${table.paidAtSeconds})>=${table.closedAt} and to_timestamp(${table.paidAtSeconds})<=${table.admittedAt}`,
    ),
    jsonbIsObject('billing_refund_actions', table.state),
    jsonbIsObject('billing_refund_actions', table.claim),
    check(
      'billing_refund_actions_state_check',
      sql`coalesce(case ${table.state}->>'kind'
    when 'ready' then ${table.state}='{"kind":"ready"}'::jsonb and ${table.claim} is null
    else (${table.state}->>'startedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      and (${table.state}->>'startedAt')::timestamptz>=${table.admittedAt}
      and case ${table.state}->>'kind'
        when 'unknown' then ${table.state}-array['kind','startedAt','retryAt','afterRefundId']::text[]='{}'::jsonb
          and (${table.state}->>'retryAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
          and (${table.state}->>'retryAt')::timestamptz>=(${table.state}->>'startedAt')::timestamptz
          and (${table.state}->'afterRefundId'='null'::jsonb or (jsonb_typeof(${table.state}->'afterRefundId')='string'
            and (${table.state}->>'afterRefundId') ~ '^re_[A-Za-z0-9_]+$' and length(${table.state}->>'afterRefundId')<=255))
        when 'known' then ${table.state}-array['kind','startedAt','refundId','status','observedAt']::text[]='{}'::jsonb
          and jsonb_typeof(${table.state}->'refundId')='string' and (${table.state}->>'refundId') ~ '^re_[A-Za-z0-9_]+$' and length(${table.state}->>'refundId')<=255
          and ${table.state}->>'status' in ('pending','requires_action','succeeded','failed','canceled')
          and (${table.state}->>'observedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
          and (${table.state}->>'observedAt')::timestamptz>=(${table.state}->>'startedAt')::timestamptz
        else false end end,false)`,
    ),
    check(
      'billing_refund_actions_claim_check',
      sql`${table.claim} is null or coalesce(
    ${table.claim}-array['id','work','claimedAt','expiresAt']::text[]='{}'::jsonb
    and jsonb_typeof(${table.claim}->'id')='string' and (${table.claim}->>'id') ~ '^[a-z0-9]{24}$'
    and (${table.claim}->>'claimedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
    and (${table.claim}->>'expiresAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
    and (${table.claim}->>'claimedAt')::timestamptz>=(${table.state}->>'startedAt')::timestamptz
    and (${table.claim}->>'expiresAt')::timestamptz>(${table.claim}->>'claimedAt')::timestamptz
    and (${table.claim}->>'expiresAt')::timestamptz<=(${table.claim}->>'claimedAt')::timestamptz+interval '30 seconds'
    and case ${table.state}->>'kind'
      when 'known' then ${table.claim}->>'work'='retrieve'
        and (${table.claim}->>'claimedAt')::timestamptz>=(${table.state}->>'observedAt')::timestamptz
      when 'unknown' then (${table.claim}->>'claimedAt')::timestamptz>=(${table.state}->>'retryAt')::timestamptz
        and case ${table.claim}->>'work'
          when 'create' then (${table.claim}->>'expiresAt')::timestamptz<=(${table.state}->>'startedAt')::timestamptz+interval '5 minutes'
          when 'discover' then (${table.claim}->>'claimedAt')::timestamptz>=(${table.state}->>'startedAt')::timestamptz+interval '5 minutes'
          else false end
      else false end,false)`,
    ),
  ],
);
