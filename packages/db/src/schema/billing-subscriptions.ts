import { subscriptionEvidenceSchema } from '@daisy/protocol/billing';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  jsonbColumn,
  jsonbIsObject,
  timestampColumn,
} from './columns';
import { users } from './users';

/** Vendor identity stays here; immutable usage attribution names the local id. */
export const billingSubscriptions = pgTable(
  'billing_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    vendorSubscriptionId: text('vendor_subscription_id').notNull(),
    evidence: jsonbColumn('evidence', subscriptionEvidenceSchema).notNull(),
    current: boolean('current').notNull(),
    observedAt: timestampColumn('observed_at').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('billing_subscriptions_vendor_unique').on(
      table.vendorSubscriptionId,
    ),
    uniqueIndex('billing_subscriptions_current_user_unique')
      .on(table.userId)
      .where(sql`${table.current}`),
    index('billing_subscriptions_user_idx').on(table.userId),
    jsonbIsObject('billing_subscriptions', table.evidence),
    check(
      'billing_subscriptions_period_identity_check',
      sql`coalesce(
    ${table.evidence}->'settlement'->>'kind'='unpaid' or
    (${table.evidence}->'settlement'->'period'->>'subscriptionId'=${table.id}
      and (${table.evidence}->'settlement'->>'kind'<>'renewal_failed' or
        ${table.evidence}->'settlement'->'previous'->'period'->>'subscriptionId'=${table.id})), false)`,
    ),
  ],
);
