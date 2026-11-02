import { challengeModes, challengeFormats } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { oneOf, timestampColumn } from './columns';
import { contactActorColumn } from './contacts';
import { rooms } from './rooms';

/**
 * One member's offer to debate another (ADR 0098). Pending while `room_id`
 * is null and `expires_at` is ahead; accepting sets `room_id` to the room the
 * acceptor just opened. Declining or cancelling deletes the row, and it goes
 * with its room.
 */
export const challenges = pgTable(
  'challenges',
  {
    id: text('id').primaryKey(),
    challengerActorId: contactActorColumn('challenger_actor_id'),
    challengedActorId: contactActorColumn('challenged_actor_id'),
    mode: text('mode').notNull(),
    formatId: text('format_id').notNull(),
    roomId: text('room_id')
      .unique()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    createdAt: timestampColumn('created_at').notNull(),
    expiresAt: timestampColumn('expires_at').notNull(),
    /** Set on acceptance: how long the challenger is still sent to the room. */
    followUntil: timestampColumn('follow_until'),
  },
  (table) => [
    index('challenges_challenged_idx').on(table.challengedActorId),
    index('challenges_challenger_idx').on(table.challengerActorId),
    index('challenges_expiry_idx')
      .on(table.expiresAt)
      .where(sql`${table.roomId} is null`),
    uniqueIndex('challenges_one_pending_per_direction')
      .on(table.challengerActorId, table.challengedActorId)
      .where(sql`${table.roomId} is null`),
    check(
      'challenges_distinct',
      sql`${table.challengerActorId} <> ${table.challengedActorId}`,
    ),
    check('challenges_mode_check', oneOf(table.mode, challengeModes)),
    check('challenges_format_check', oneOf(table.formatId, challengeFormats)),
  ],
);
