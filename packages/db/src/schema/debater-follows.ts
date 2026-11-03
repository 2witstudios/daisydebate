import { index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { createdAtColumn } from './columns';
import { actors } from './actors';
import { users } from './users';

/**
 * An account following a debater (SPECT-1.4): one way, private to the follower,
 * and no kind of access. It decides who hears that the debater is on air.
 */
export const debaterFollows = pgTable(
  'debater_follows',
  {
    followerUserId: text('follower_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    debaterActorId: text('debater_actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.followerUserId, table.debaterActorId] }),
    index('debater_follows_debater_idx').on(table.debaterActorId),
  ],
);
