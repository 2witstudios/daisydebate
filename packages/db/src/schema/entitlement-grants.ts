import { sql } from 'drizzle-orm';
import { accountEntitlementKinds, entitlementSources } from '@daisy/protocol';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, oneOf, timestampColumn } from './columns';
import { organizations } from './organizations';
import { users } from './users';
import { accountHostingEntitlementVersions } from './hosting-entitlement-versions';

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
    hostingVersionId: text('hosting_version_id'),
    /** The club paying for an `organization_seat` grant (ADR 0148); null otherwise. */
    organizationId: text('organization_id').references(() => organizations.id, {
      onDelete: 'restrict',
    }),
    revokedAt: timestampColumn('revoked_at'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    check(
      'account_entitlement_grants_validity_check',
      sql`
      (${table.entitlement} = 'tournament_hosting' and ${table.source} in ('administrative', 'subscription') and ${table.hostingVersionId} is not null and ${table.startsAt} is null and ${table.expiresAt} is null)
      or (${table.entitlement} <> 'tournament_hosting' and ${table.hostingVersionId} is null and (( ${table.source} = 'beta' and ${table.startsAt} is null and ${table.expiresAt} is null)
      or (${table.source} in ('subscription', 'organization_seat') and ${table.startsAt} is not null and ${table.expiresAt} is not null
        and isfinite(${table.startsAt}) and isfinite(${table.expiresAt}) and ${table.startsAt} < ${table.expiresAt})))
    `,
    ),
    foreignKey({
      name: 'account_entitlement_grants_hosting_version_fk',
      columns: [table.hostingVersionId, table.userId, table.source],
      foreignColumns: [
        accountHostingEntitlementVersions.id,
        accountHostingEntitlementVersions.userId,
        accountHostingEntitlementVersions.source,
      ],
    }).onDelete('restrict'),
    index('account_entitlement_grants_hosting_version_idx').on(
      table.hostingVersionId,
      table.userId,
      table.source,
    ),
    check(
      'account_entitlement_grants_seat_organization_check',
      sql`(${table.source} = 'organization_seat') = (${table.organizationId} is not null)`,
    ),
    index('account_entitlement_grants_organization_idx').on(
      table.organizationId,
    ),
    check(
      'account_entitlement_grants_revocation_finite',
      sql`${table.revokedAt} is null or isfinite(${table.revokedAt})`,
    ),
    primaryKey({
      name: 'account_entitlement_grants_pkey',
      columns: [table.userId, table.entitlement, table.source],
    }),
    check(
      'account_entitlement_grants_entitlement_check',
      oneOf(table.entitlement, accountEntitlementKinds),
    ),
    check(
      'account_entitlement_grants_source_check',
      oneOf(table.source, entitlementSources),
    ),
  ],
);
