import { sql } from 'drizzle-orm';
import { check, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  oneOf,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { users } from './users';

/** Widened when bots arrived as round participants (ADR 0058 §8). */
export const actorKinds = ['human', 'bot'] as const;

/**
 * Competitive identity, separate from the Better Auth account. Competitive
 * rows reference actors so that tombstoning a user (`users.deleted_at`) never
 * touches history. Public identity (`username`) stays on `users`; actors hold
 * no PII. Nothing here constrains ratings: ratedness comes from a round's
 * `competition_type`, never from who is seated.
 */
export const actors = pgTable(
  'actors',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    userId: text('user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    uniqueIndex('actors_user_id_unique').on(table.userId),
    check('actors_kind_check', oneOf(table.kind, actorKinds)),
    check(
      'actors_human_has_user',
      sql`${table.kind} <> 'human' or ${table.userId} is not null`,
    ),
    versionPositive('actors', table.version),
  ],
);
