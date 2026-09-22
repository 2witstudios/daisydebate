import { debateRoles } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { actors } from './actors';
import {
  oneOf,
  timestampColumn,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { debates } from './debates';

export const participantStatuses = [
  'joined',
  'ready',
  'declined',
  'removed',
] as const;

/**
 * One row per seat: every role, including judges, is a `(role, slot)` pair,
 * so team formats and judge panels are extra slots, not extra tables. Which
 * seats a format allows comes from `formats.rules.seats` (the domain checks
 * it); the database enforces seat and actor uniqueness. No per-participant
 * result column exists: a result derives from `debates.outcome` and `role`.
 * A projection of the snapshot, written in its transaction.
 */
export const debateParticipants = pgTable(
  'debate_participants',
  {
    id: text('id').primaryKey(),
    debateId: text('debate_id')
      .notNull()
      .references(() => debates.id, { onDelete: 'cascade' }),
    actorId: text('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'restrict' }),
    role: text('role').notNull(),
    slot: integer('slot').notNull().default(0),
    status: text('status').notNull(),
    joinedAt: timestampColumn('joined_at').notNull(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    uniqueIndex('debate_participants_seat_unique').on(
      table.debateId,
      table.role,
      table.slot,
    ),
    uniqueIndex('debate_participants_actor_unique').on(
      table.debateId,
      table.actorId,
    ),
    index('debate_participants_actor_joined_idx').on(
      table.actorId,
      table.joinedAt.desc(),
    ),
    check('debate_participants_role_check', oneOf(table.role, debateRoles)),
    check('debate_participants_slot_check', sql`${table.slot} >= 0`),
    check(
      'debate_participants_status_check',
      oneOf(table.status, participantStatuses),
    ),
    versionPositive('debate_participants', table.version),
  ],
);
