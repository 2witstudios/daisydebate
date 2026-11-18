import { subscriptionEvidenceSchema } from '@daisy/protocol/billing';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
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
import { organizations } from './organizations';
import { users } from './users';

/** Vendor identity stays here; immutable usage attribution names the local id. */
export const billingSubscriptions = pgTable(
  'billing_subscriptions',
  {
    id: text('id').primaryKey(),
    /** Exactly one billing owner (ADR 0148): an account (Premium) or an organisation (Club). */
    userId: text('user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    organizationId: text('organization_id').references(() => organizations.id, {
      onDelete: 'restrict',
    }),
    vendorSubscriptionId: text('vendor_subscription_id').notNull(),
    evidence: jsonbColumn('evidence', subscriptionEvidenceSchema).notNull(),
    current: boolean('current').notNull(),
    /** The verified observation's cancel-at-period-end: renewal is off. */
    renewalOff: boolean('renewal_off').notNull().default(false),
    /** The verified subscription price in minor units; null before its first observation. */
    amountMinor: integer('amount_minor'),
    /** A Club plan's verified seat count (item quantity); null for Premium and before the first observation. */
    seatCount: integer('seat_count'),
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
    uniqueIndex('billing_subscriptions_current_organization_unique')
      .on(table.organizationId)
      .where(sql`${table.current}`),
    index('billing_subscriptions_organization_idx').on(table.organizationId),
    check(
      'billing_subscriptions_one_owner',
      sql`num_nonnulls(${table.userId}, ${table.organizationId}) = 1`,
    ),
    check(
      'billing_subscriptions_seat_count_check',
      sql`${table.seatCount} is null or (${table.organizationId} is not null and ${table.seatCount} between 1 and 200)`,
    ),
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
