import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { memberships } from './organizations';
import { timestampColumn } from './columns';

/**
 * Each period a person was an active member of an organization. The one
 * `memberships` row is reopened on a rejoin, so its times describe only the
 * latest period; these rows keep every one. A trigger on `memberships` writes
 * them (opened when a membership becomes active, closed when it ends), so no
 * writer can forget a period.
 */
export const membershipPeriods = pgTable(
  'membership_periods',
  {
    organizationId: text('organization_id').notNull(),
    userId: text('user_id').notNull(),
    joinedAt: timestampColumn('joined_at').notNull(),
    endedAt: timestampColumn('ended_at'),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.userId, table.joinedAt],
    }),
    foreignKey({
      name: 'membership_periods_membership_fk',
      columns: [table.organizationId, table.userId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }).onDelete('cascade'),
    uniqueIndex('membership_periods_open_unique')
      .on(table.organizationId, table.userId)
      .where(sql`${table.endedAt} is null`),
    index('membership_periods_user_idx').on(table.userId),
    check(
      'membership_periods_time_check',
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.joinedAt}`,
    ),
  ],
);
