import { roomInvitationStates, roomSeatKinds } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAtColumn, oneOf, timestampColumn } from './columns';
import { actors } from './actors';
import { rooms } from './rooms';

/**
 * A host's named offer of one seat kind in their Room to one member
 * (ADR 0124). While pending it holds that seat for the invitee (a
 * `room_seat_holds` row it writes and removes); it never seats anyone. It
 * ends accepted when the invitee takes a seat of that kind, declined,
 * withdrawn by the host, or expired (its deadline, Start round or close).
 */
export const roomInvitations = pgTable(
  'room_invitations',
  {
    id: text('id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    inviteeActorId: text('invitee_actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    inviterActorId: text('inviter_actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    seat: text('seat').notNull(),
    state: text('state').notNull(),
    expiresAt: timestampColumn('expires_at').notNull(),
    endedAt: timestampColumn('ended_at'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('room_invitations_one_pending')
      .on(table.roomId, table.inviteeActorId)
      .where(sql`${table.state} = 'pending'`),
    index('room_invitations_room_idx').on(table.roomId),
    index('room_invitations_invitee_idx').on(table.inviteeActorId),
    index('room_invitations_inviter_idx').on(table.inviterActorId),
    index('room_invitations_ended_idx')
      .on(table.endedAt)
      .where(sql`${table.endedAt} is not null`),
    check('room_invitations_seat_check', oneOf(table.seat, roomSeatKinds)),
    check(
      'room_invitations_state_check',
      oneOf(table.state, roomInvitationStates),
    ),
    check(
      'room_invitations_ended_check',
      sql`(${table.state} = 'pending') = (${table.endedAt} is null)`,
    ),
    check(
      'room_invitations_distinct',
      sql`${table.inviteeActorId} <> ${table.inviterActorId}`,
    ),
  ],
);
