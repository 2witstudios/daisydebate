import { purchaseStateSchema } from '@daisy/protocol/billing';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { jsonbColumn, jsonbIsObject, oneOf, timestampColumn } from './columns';
import { users } from './users';

/** One admitted offer and vendor key, retained until every possible side effect is resolved. */
export const billingPurchases = pgTable(
  'billing_purchases',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    mode: text('mode').notNull(),
    priceId: text('price_id').notNull(),
    vendorCustomerId: text('vendor_customer_id'),
    returnOrigin: text('return_origin').notNull(),
    admittedAt: timestampColumn('admitted_at').notNull(),
    state: jsonbColumn('state', purchaseStateSchema).notNull(),
  },
  (table) => [
    index('billing_purchases_user_idx').on(
      table.userId,
      table.admittedAt,
      table.id,
    ),
    uniqueIndex('billing_purchases_pending_user_unique')
      .on(table.userId)
      .where(
        sql`${table.state}->>'kind' in ('admitted','creating','unknown','open')`,
      ),
    uniqueIndex('billing_purchases_session_unique').on(
      sql`(${table.state}->>'sessionId')`,
    ),
    index('billing_purchases_mode_discovery_idx')
      .on(table.mode, table.id)
      .where(
        sql`${table.state}->>'kind' in ('creating','unknown','open','complete')`,
      ),
    check('billing_purchases_mode_check', oneOf(table.mode, ['test', 'live'])),
    check(
      'billing_purchases_identity_check',
      sql`${table.id} ~ '^[a-z0-9]{24}$'
    and ${table.priceId} ~ '^price_[A-Za-z0-9_]+$' and length(${table.priceId}) <= 255
    and (${table.vendorCustomerId} is null or (${table.vendorCustomerId} ~ '^cus_[A-Za-z0-9_]+$' and length(${table.vendorCustomerId}) <= 255))`,
    ),
    check(
      'billing_purchases_origin_check',
      sql`${table.returnOrigin} ~ '^https?://([a-z0-9.-]+|\\[[a-f0-9:]+\\])(:[1-9][0-9]{0,4})?$'`,
    ),
    jsonbIsObject('billing_purchases', table.state),
    check(
      'billing_purchases_state_check',
      sql`coalesce(case ${table.state}->>'kind'
    when 'admitted' then ${table.state} = '{"kind":"admitted"}'::jsonb
    when 'abandoned' then ${table.state} - array['kind','abandonedAt']::text[] = '{}'::jsonb
      and (${table.state}->>'abandonedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      and (${table.state}->>'abandonedAt')::timestamptz >= ${table.admittedAt}
    else
      (${table.state}->>'startedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      and (${table.state}->>'startedAt')::timestamptz >= ${table.admittedAt}
      and (${table.state}->>'startedAt')::timestamptz < ${table.admittedAt} + interval '5 minutes'
      and case ${table.state}->>'kind'
        when 'creating' then ${table.state} - array['kind','startedAt','claim']::text[] = '{}'::jsonb
          and jsonb_typeof(${table.state}->'claim')='object'
          and (${table.state}->'claim') - array['id','claimedAt','expiresAt']::text[] = '{}'::jsonb
          and jsonb_typeof(${table.state}->'claim'->'id')='string'
          and (${table.state}->'claim'->>'id') ~ '^[a-z0-9]{24}$'
          and (${table.state}->'claim'->>'claimedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
          and (${table.state}->'claim'->>'expiresAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
          and (${table.state}->'claim'->>'claimedAt')::timestamptz >= (${table.state}->>'startedAt')::timestamptz
          and (${table.state}->'claim'->>'expiresAt')::timestamptz > (${table.state}->'claim'->>'claimedAt')::timestamptz
          and (${table.state}->'claim'->>'expiresAt')::timestamptz <= least(
            (${table.state}->'claim'->>'claimedAt')::timestamptz + interval '30 seconds', ${table.admittedAt} + interval '5 minutes')
        when 'unknown' then ${table.state} - array['kind','startedAt','retryAt','afterSessionId']::text[] = '{}'::jsonb
          and (${table.state}->>'retryAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
          and (${table.state}->>'retryAt')::timestamptz >= (${table.state}->>'startedAt')::timestamptz
          and (${table.state}->'afterSessionId'='null'::jsonb or (jsonb_typeof(${table.state}->'afterSessionId')='string'
            and (${table.state}->>'afterSessionId') ~ ('^cs_' || ${table.mode} || '_[A-Za-z0-9_]+$')
            and length(${table.state}->>'afterSessionId') <= 255))
        when 'open' then ${table.state} - array['kind','startedAt','sessionId','customerId']::text[] = '{}'::jsonb
        when 'expired' then ${table.state} - array['kind','startedAt','sessionId','customerId']::text[] = '{}'::jsonb
        when 'complete' then ${table.state} - array['kind','startedAt','sessionId','customerId','subscriptionId']::text[] = '{}'::jsonb
          and jsonb_typeof(${table.state}->'subscriptionId')='string'
          and (${table.state}->>'subscriptionId') ~ '^sub_[A-Za-z0-9_]+$' and length(${table.state}->>'subscriptionId') <= 255
          and jsonb_typeof(${table.state}->'customerId')='string'
        else false end
    end, false)`,
    ),
    check(
      'billing_purchases_session_check',
      sql`coalesce(${table.state}->>'kind' not in ('open','expired','complete') or (
    jsonb_typeof(${table.state}->'sessionId')='string'
    and (${table.state}->>'sessionId') ~ ('^cs_' || ${table.mode} || '_[A-Za-z0-9_]+$')
    and length(${table.state}->>'sessionId') <= 255
    and (${table.state}->'customerId'='null'::jsonb or (jsonb_typeof(${table.state}->'customerId')='string'
      and (${table.state}->>'customerId') ~ '^cus_[A-Za-z0-9_]+$' and length(${table.state}->>'customerId') <= 255))
    and (${table.vendorCustomerId} is null or ${table.vendorCustomerId}=${table.state}->>'customerId')
  ), false)`,
    ),
  ],
);
