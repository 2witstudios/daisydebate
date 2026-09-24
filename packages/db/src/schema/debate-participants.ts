import { debateRoles } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
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

/** What a snapshot participant can say about its seat: joined or ready. */
export const participantStatuses = ['joined', 'ready'] as const;

/**
 * One row per seat, keyed by the debate and the seated actor. The debater
 * seats (`affirmative`, `negative`) are a projection of the snapshot's
 * `participants` (whose ids are actor ids, ADR 0029), rewritten in the same
 * transaction as every snapshot write, so they always equal the snapshot's
 * seats (ADR 0038). The snapshot does not carry judges: a snapshot write
 * scopes its delete and upsert to the debater roles, never touches a judge
 * seat (whose `ballots` cascade from it), and refuses a snapshot that seats
 * an actor already holding one (ISSUE-43). `joined_at` is the database time
 * of the write that seated the actor (ADR 0033 §3.2). Every role, including judges, is a
 * `(role, slot)` pair, so team formats and judge panels are extra slots, not
 * extra tables. Which seats a format allows comes from `formats.rules.seats`
 * (the domain checks it); the database enforces seat and actor uniqueness.
 * No per-participant result column exists: a result derives from
 * `debates.outcome` and `role`.
 */
export const debateParticipants = pgTable(
  'debate_participants',
  {
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
    /** The seat's identity; `ballots` and `rating_changes` reference it. */
    primaryKey({ columns: [table.debateId, table.actorId] }),
    uniqueIndex('debate_participants_seat_unique').on(
      table.debateId,
      table.role,
      table.slot,
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
