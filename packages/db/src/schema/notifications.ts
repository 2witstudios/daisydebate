import { notificationKinds } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, oneOf, timestampColumn } from './columns';
import { actors } from './actors';
import { rounds } from './rounds';
import { users } from './users';

/**
 * A stored notification (WATCH-12). There is no text, result or score column,
 * so an outcome cannot be stored in one: a row says what kind of thing happened
 * and to which Round, and the words come from the kind when it is read. Rows are
 * written only after release, and kept for 90 days after they are read.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    /** The followed debater a `followed_debater_live` row is about. */
    debaterActorId: text('debater_actor_id').references(() => actors.id, {
      onDelete: 'cascade',
    }),
    readAt: timestampColumn('read_at'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('notifications_once_unique').on(
      table.userId,
      table.kind,
      table.roundId,
    ),
    index('notifications_user_idx').on(
      table.userId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('notifications_read_idx')
      .on(table.readAt)
      .where(sql`${table.readAt} is not null`),
    index('notifications_round_idx').on(table.roundId),
    index('notifications_debater_idx').on(table.debaterActorId),
    check('notifications_kind_check', oneOf(table.kind, notificationKinds)),
    check(
      'notifications_debater_check',
      sql`(${table.kind} = 'followed_debater_live') = (${table.debaterActorId} is not null)`,
    ),
  ],
);

/** What a member has turned off. A kind with no row is on. */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    enabled: boolean('enabled').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.kind] }),
    check(
      'notification_preferences_kind_check',
      oneOf(table.kind, notificationKinds),
    ),
  ],
);

/**
 * One event of one Round has told everyone it was going to. Notifications reads
 * Broadcast and Recording as named inputs and writes nothing to them, so the
 * sweep's memory of what it has done lives here.
 */
export const notificationFanouts = pgTable(
  'notification_fanouts',
  {
    kind: text('kind').notNull(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.kind, table.roundId] }),
    check(
      'notification_fanouts_kind_check',
      oneOf(table.kind, notificationKinds),
    ),
  ],
);
