import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { friendshipStates } from '@daisy/protocol';
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
    state: text('state').$type<(typeof friendshipStates)[number]>().notNull(),
    requestedAt: timestampColumn('requested_at').notNull(),
    acceptedAt: timestampColumn('accepted_at'),
  },
  (table) => [
    index('friendships_high_actor_idx').on(table.highActorId),
    primaryKey({ columns: [table.lowActorId, table.highActorId] }),
    check('friendships_order', sql`${table.lowActorId} < ${table.highActorId}`),
    check(
      'friendships_requester',
      sql`${table.requesterActorId} in (${table.lowActorId}, ${table.highActorId})`,
    ),
    check('friendships_state', oneOf(table.state, friendshipStates)),
    check(
      'friendships_time',
      sql`(${table.state} in ('pending', 'waiting-for-guardian') and ${table.acceptedAt} is null) or (${table.state} = 'accepted' and ${table.acceptedAt} is not null and ${table.acceptedAt} >= ${table.requestedAt})`,
    ),
    foreignKey({
      name: 'friendships_contact_fk',
      columns: [table.lowActorId, table.highActorId],
      foreignColumns: [contactPairs.lowActorId, contactPairs.highActorId],
    }).onDelete('cascade'),
  ],
);

/** A decision for one child on one live request; ending the request removes it. */
export const friendGuardianApprovals = pgTable(
  'friend_guardian_approvals',
  {
    id: text('id').primaryKey(),
    lowActorId: contactActorColumn('low_actor_id'),
    highActorId: contactActorColumn('high_actor_id'),
    childActorId: text('child_actor_id').notNull(),
    cleared: boolean('cleared').notNull().default(false),
  },
  (table) => [
    unique('friend_guardian_approvals_pair_child').on(
      table.lowActorId,
      table.highActorId,
      table.childActorId,
    ),
    index('friend_guardian_approvals_child_idx').on(table.childActorId),
    check(
      'friend_guardian_approvals_child',
      sql`${table.childActorId} in (${table.lowActorId}, ${table.highActorId})`,
    ),
    foreignKey({
      name: 'friend_guardian_approvals_friendship_fk',
      columns: [table.lowActorId, table.highActorId],
      foreignColumns: [friendships.lowActorId, friendships.highActorId],
    }).onDelete('cascade'),
  ],
);
