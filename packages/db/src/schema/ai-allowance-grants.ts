import { sql } from 'drizzle-orm';
import { check, index, pgTable, text } from 'drizzle-orm/pg-core';
import { timestampColumn } from './columns';
import { actors } from './actors';

/** Read authority for DEC-183's fixed premium allowance; no public grant writer. */
export const aiAllowanceGrants = pgTable(
  'ai_allowance_grants',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'restrict' }),
    periodStart: timestampColumn('period_start').notNull(),
    periodEnd: timestampColumn('period_end').notNull(),
    revokedAt: timestampColumn('revoked_at'),
  },
  (table) => [
    index('ai_allowance_grants_actor_period_idx').on(
      table.actorId,
      table.periodStart,
      table.periodEnd,
    ),
    check(
      'ai_allowance_grants_period_check',
      sql`${table.periodEnd} > ${table.periodStart}`,
    ),
  ],
);
