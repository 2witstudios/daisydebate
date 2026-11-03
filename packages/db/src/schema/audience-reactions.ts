import { audienceReactionKinds } from '@daisy/protocol';
import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { oneOf, timestampColumn } from './columns';
import { rounds } from './rounds';
import { users } from './users';

/**
 * One account's reaction to a Round (SPECT-1.4). The audience reads only totals
 * of what has been released; the account is for spacing, export and erasure.
 * `spacedAt` is the start of the spacing window, so a press repeats at most once
 * in each.
 */
export const audienceReactions = pgTable(
  'audience_reactions',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    spacedAt: timestampColumn('spaced_at').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('audience_reactions_spaced_unique').on(
      table.roundId,
      table.userId,
      table.kind,
      table.spacedAt,
    ),
    index('audience_reactions_round_idx').on(
      table.roundId,
      table.kind,
      table.createdAt,
    ),
    index('audience_reactions_user_idx').on(table.userId),
    check(
      'audience_reactions_kind_check',
      oneOf(table.kind, audienceReactionKinds),
    ),
  ],
);
