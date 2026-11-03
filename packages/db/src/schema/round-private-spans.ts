import { sql } from 'drizzle-orm';
import {
  check,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { oneOf, timestampColumn } from './columns';
import { rounds } from './rounds';

/**
 * When a Round was known to be private (ADR 0099), committed in the same transaction
 * as the transition: in-round prep, and judging after the final segment. With
 * `round_segments` this is what tells a known countdown from a known private span, so
 * the audience's feed can say which it is.
 */
export const roundPrivateSpans = pgTable(
  'round_private_spans',
  {
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'prep' | 'judging'>().notNull(),
    startedAt: timestampColumn('started_at').notNull(),
    endedAt: timestampColumn('ended_at'),
  },
  (table) => [
    primaryKey({ columns: [table.roundId, table.kind, table.startedAt] }),
    /** At most one open span of each kind per Round. */
    uniqueIndex('round_private_spans_single_open')
      .on(table.roundId, table.kind)
      .where(sql`${table.endedAt} is null`),
    check(
      'round_private_spans_kind_check',
      oneOf(table.kind, ['prep', 'judging']),
    ),
  ],
);
