import { moderationKinds } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text } from 'drizzle-orm/pg-core';
import { oneOf, timestampColumn } from './columns';
import { users } from './users';

/**
 * What a reviewer did to an account (ADR 0098): a warning the member reads,
 * a timed suspension or a ban. It outlives the report that caused it and names
 * no report. Erasing the account keeps it through the proposed retention
 * (DEC-298). A suspension or ban in force withdraws participant access; lifting
 * it keeps the row for the record.
 */
export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    startsAt: timestampColumn('starts_at').notNull(),
    endsAt: timestampColumn('ends_at'),
    liftedAt: timestampColumn('lifted_at'),
    acknowledgedAt: timestampColumn('acknowledged_at'),
    operatorRef: text('operator_ref').notNull(),
  },
  (table) => [
    index('moderation_actions_user_idx').on(table.userId, table.startsAt),
    check('moderation_actions_kind_check', oneOf(table.kind, moderationKinds)),
    check(
      'moderation_actions_ends_check',
      sql`(${table.kind} = 'suspension') = (${table.endsAt} is not null)`,
    ),
    check(
      'moderation_actions_lifted_check',
      sql`${table.liftedAt} is null or ${table.kind} in ('suspension', 'ban')`,
    ),
    check(
      'moderation_actions_acknowledged_check',
      sql`${table.acknowledgedAt} is null or ${table.kind} = 'warning'`,
    ),
  ],
);
