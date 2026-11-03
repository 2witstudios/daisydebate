import { index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { timestampColumn } from './columns';
import { rounds } from './rounds';
import { users } from './users';

/** The Rounds an account has watched, newest visit kept (SPECT-1.4). */
export const watchHistory = pgTable(
  'watch_history',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    watchedAt: timestampColumn('watched_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roundId] }),
    index('watch_history_user_idx').on(table.userId, table.watchedAt.desc()),
    index('watch_history_retention_idx').on(table.watchedAt),
    index('watch_history_round_idx').on(table.roundId),
  ],
);
