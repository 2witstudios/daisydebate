import { sql } from 'drizzle-orm';
import { entitlementKinds, entitlementSources } from '@daisy/protocol';
import { check, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { createdAtColumn, oneOf, timestampColumn } from './columns';
import { users } from './users';

/**
 * An account's named entitlement grants (DEC-247, ISSUE-779), one row per
 * entitlement and source. The beta access command writes and removes its
 * `beta` grants in its own transaction; premium checks read these rows,
 * never beta state. Erasure deletes them.
 */
export const accountEntitlementGrants = pgTable(
  'account_entitlement_grants',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entitlement: text('entitlement').notNull(),
    source: text('source').notNull(),
    startsAt: timestampColumn('starts_at'),
    expiresAt: timestampColumn('expires_at'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    check(
      'account_entitlement_grants_validity_check',
      sql`
      (${table.source} = 'beta' and ${table.startsAt} is null and ${table.expiresAt} is null)
      or (${table.source} = 'subscription' and ${table.startsAt} is not null and ${table.expiresAt} is not null
        and isfinite(${table.startsAt}) and isfinite(${table.expiresAt}) and ${table.startsAt} < ${table.expiresAt})
    `,
    ),
    primaryKey({
      name: 'account_entitlement_grants_pkey',
      columns: [table.userId, table.entitlement, table.source],
    }),
    check(
      'account_entitlement_grants_entitlement_check',
      oneOf(table.entitlement, entitlementKinds),
    ),
    check(
      'account_entitlement_grants_source_check',
      oneOf(table.source, entitlementSources),
    ),
  ],
);
