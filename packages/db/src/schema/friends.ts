import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';
import { friendshipStates } from '@daisy/protocol';
import { rooms } from './rooms';
import { oneOf, timestampColumn } from './columns';
import { contactActorColumn, contactPairs } from './contacts';

/**
 * The friendship producer (ADR 0072): one row per asked or accepted pair,
 * fenced by the same contact pair row as blocks and DMs. Declining or
 * removing deletes the row, and a block deletes it too, so unblocking never
 * restores a friendship.
 */
export const friendships = pgTable(
  'friendships',
  {
    lowActorId: contactActorColumn('low_actor_id'),
    highActorId: contactActorColumn('high_actor_id'),
    requesterActorId: text('requester_actor_id').notNull(),
    state: text('state').notNull(),
    requestedAt: timestampColumn('requested_at').notNull(),
    acceptedAt: timestampColumn('accepted_at'),
  },
  (table) => [
    index('friendships_high_actor_idx').on(table.highActorId),
    primaryKey({ columns: [table.lowActorId, table.highActorId] }),
    check(
      'friendships_order',
      sql`${table.lowActorId} < ${table.highActorId}`,
    ),
    check(
      'friendships_requester',
      sql`${table.requesterActorId} in (${table.lowActorId}, ${table.highActorId})`,
    ),
    check('friendships_state', oneOf(table.state, friendshipStates)),
    check(
      'friendships_time',
      sql`(${table.state} = 'pending' and ${table.acceptedAt} is null) or (${table.state} = 'accepted' and ${table.acceptedAt} is not null and ${table.acceptedAt} >= ${table.requestedAt})`,
    ),
    foreignKey({
      name: 'friendships_contact_fk',
      columns: [table.lowActorId, table.highActorId],
      foreignColumns: [
        contactPairs.lowActorId,
        contactPairs.highActorId,
      ],
    }).onDelete('cascade'),
  ],
);

/**
 * A challenge one friend sent another (ADR 0072): the room the challenger
 * opened for them, shown to the challenged friend while it assembles. It
 * goes with its room, and declining deletes it.
 */
export const friendChallenges = pgTable(
  'friend_challenges',
  {
    roomId: text('room_id')
      .primaryKey()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    challengerActorId: contactActorColumn('challenger_actor_id'),
    challengedActorId: contactActorColumn('challenged_actor_id'),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    index('friend_challenges_challenged_idx').on(
      table.challengedActorId,
    ),
    index('friend_challenges_challenger_idx').on(
      table.challengerActorId,
    ),
    check(
      'friend_challenges_distinct',
      sql`${table.challengerActorId} <> ${table.challengedActorId}`,
    ),
  ],
);

