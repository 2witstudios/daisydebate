import { billingSyncStateSchema } from '@daisy/protocol/billing';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  jsonbColumn,
  jsonbIsObject,
  oneOf,
  timestampColumn,
} from './columns';
import { users } from './users';

/** Only a verified server-owned Checkout attempt may establish this mapping. */
export const billingCustomers = pgTable(
  'billing_customers',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    vendorCustomerId: text('vendor_customer_id').notNull(),
    mode: text('mode').notNull(),
    synchronization: jsonbColumn(
      'synchronization',
      billingSyncStateSchema,
    ).notNull(),
    closedAt: timestampColumn('closed_at'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('billing_customers_user_unique').on(table.userId),
    uniqueIndex('billing_customers_vendor_unique').on(
      table.mode,
      table.vendorCustomerId,
    ),
    index('billing_customers_closed_idx').on(table.closedAt, table.id),
    check('billing_customers_mode_check', oneOf(table.mode, ['test', 'live'])),
    check(
      'billing_customers_vendor_check',
      sql`${table.vendorCustomerId} ~ '^cus_[A-Za-z0-9]+$' and length(${table.vendorCustomerId}) <= 255`,
    ),
    check(
      'billing_customers_closure_check',
      sql`${table.closedAt} is null or ${table.closedAt} >= ${table.createdAt}`,
    ),
    jsonbIsObject('billing_customers', table.synchronization),
    check(
      'billing_customers_synchronization_check',
      sql`coalesce(
    jsonb_typeof(${table.synchronization}->'revision')='number'
    and (${table.synchronization}->>'revision') ~ '^[1-9][0-9]*$'
    and (${table.synchronization}->>'revision')::numeric <= 9007199254740991
    and case ${table.synchronization}->>'kind'
      when 'pending' then ${table.synchronization} - array['kind','revision','requestedAt','retryAt']::text[] = '{}'::jsonb
        and (${table.synchronization}->>'requestedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
        and (${table.synchronization}->>'retryAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
        and (${table.synchronization}->>'requestedAt')::timestamptz <= (${table.synchronization}->>'retryAt')::timestamptz
      when 'claimed' then ${table.synchronization} - array['kind','revision','requestedAt','claim']::text[] = '{}'::jsonb
        and jsonb_typeof(${table.synchronization}->'claim')='object'
        and (${table.synchronization}->'claim') - array['id','claimedAt','expiresAt']::text[] = '{}'::jsonb
        and jsonb_typeof(${table.synchronization}->'claim'->'id')='string'
        and (${table.synchronization}->'claim'->>'id') ~ '^[a-z0-9]{24}$'
        and (${table.synchronization}->>'requestedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
        and (${table.synchronization}->'claim'->>'claimedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
        and (${table.synchronization}->'claim'->>'expiresAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
        and (${table.synchronization}->>'requestedAt')::timestamptz <= (${table.synchronization}->'claim'->>'claimedAt')::timestamptz
        and (${table.synchronization}->'claim'->>'claimedAt')::timestamptz < (${table.synchronization}->'claim'->>'expiresAt')::timestamptz
        and (${table.synchronization}->'claim'->>'expiresAt')::timestamptz <= (${table.synchronization}->'claim'->>'claimedAt')::timestamptz + interval '30 seconds'
      when 'settled' then ${table.synchronization} - array['kind','revision','observedAt','nextAt']::text[] = '{}'::jsonb
        and (${table.synchronization}->>'observedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
        and (${table.synchronization}->>'nextAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
        and (${table.synchronization}->>'observedAt')::timestamptz <= (${table.synchronization}->>'nextAt')::timestamptz
      else false end, false)`,
    ),
  ],
);
