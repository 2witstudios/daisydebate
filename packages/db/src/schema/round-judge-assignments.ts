import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { timestampColumn } from './columns';
import { roundCommands } from './round-commands';
import { roundParticipants } from './round-participants';
import { rounds } from './rounds';

const assignmentKey = (): [AnyPgColumn, AnyPgColumn, AnyPgColumn] => [
  roundJudgeAssignments.roundId,
  roundJudgeAssignments.slot,
  roundJudgeAssignments.version,
];
const assignmentOccupantKey = (): [
  AnyPgColumn,
  AnyPgColumn,
  AnyPgColumn,
  AnyPgColumn,
  AnyPgColumn,
] => [
  roundJudgeAssignments.roundId,
  roundJudgeAssignments.slot,
  roundJudgeAssignments.version,
  roundJudgeAssignments.participantId,
  roundJudgeAssignments.actorId,
];

/** Judge slots freeze with the execution grammar. Only their current assignment pointer changes. */
export const roundJudgeSlots = pgTable(
  'round_judge_slots',
  {
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    slot: integer('slot').notNull(),
    currentVersion: integer('current_version'),
    participantId: text('participant_id'),
    actorId: text('actor_id'),
  },
  (table) => [
    primaryKey({ columns: [table.roundId, table.slot] }),
    check('round_judge_slots_slot_check', sql`${table.slot}>=0`),
    check(
      'round_judge_slots_version_check',
      sql`${table.currentVersion} is null or ${table.currentVersion}>0`,
    ),
    check(
      'round_judge_slots_occupant_check',
      sql`(${table.participantId} is null)=(${table.actorId} is null) and (${table.currentVersion} is not null or ${table.participantId} is null)`,
    ),
    index('round_judge_slots_assignment_idx').on(
      table.roundId,
      table.slot,
      table.currentVersion,
      table.participantId,
      table.actorId,
    ),
    uniqueIndex('round_judge_slots_current_actor_unique')
      .on(table.roundId, table.actorId)
      .where(sql`${table.actorId} is not null`),
    uniqueIndex('round_judge_slots_current_participant_unique')
      .on(table.participantId)
      .where(sql`${table.participantId} is not null`),
    foreignKey({
      name: 'round_judge_slots_assignment_fk',
      columns: [table.roundId, table.slot, table.currentVersion],
      foreignColumns: assignmentKey(),
    }),
    foreignKey({
      name: 'round_judge_slots_occupant_fk',
      columns: [
        table.roundId,
        table.slot,
        table.currentVersion,
        table.participantId,
        table.actorId,
      ],
      foreignColumns: assignmentOccupantKey(),
    }),
  ],
);

/** Immutable occupant versions, including an explicit empty assignment after unassignment. */
export const roundJudgeAssignments = pgTable(
  'round_judge_assignments',
  {
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    slot: integer('slot').notNull(),
    version: integer('version').notNull(),
    previousVersion: integer('previous_version').generatedAlwaysAs(
      sql`case when version>1 then version-1 else null end`,
    ),
    participantId: text('participant_id'),
    actorId: text('actor_id'),
    /** An upgrade observes the actual existing relationship; it invents no old command or assignment instant. */
    source: text('source')
      .$type<'initial' | 'observed' | 'command'>()
      .notNull(),
    commandId: text('command_id'),
    recordedAt: timestampColumn('recorded_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roundId, table.slot, table.version] }),
    unique('round_judge_assignments_occupant_unique').on(
      table.roundId,
      table.slot,
      table.version,
      table.participantId,
      table.actorId,
    ),
    unique('round_judge_assignments_participant_unique').on(
      table.roundId,
      table.slot,
      table.version,
      table.participantId,
    ),
    index('round_judge_assignments_participant_idx').on(
      table.participantId,
      table.roundId,
      table.slot,
      table.actorId,
    ),
    index('round_judge_assignments_previous_idx').on(
      table.roundId,
      table.slot,
      table.previousVersion,
    ),
    index('round_judge_assignments_actor_idx').on(table.actorId, table.roundId),
    index('round_judge_assignments_command_idx').on(
      table.commandId,
      table.roundId,
    ),
    check(
      'round_judge_assignments_version_check',
      sql`${table.slot}>=0 and ${table.version}>0`,
    ),
    check(
      'round_judge_assignments_occupant_check',
      sql`(${table.participantId} is null)=(${table.actorId} is null)`,
    ),
    check(
      'round_judge_assignments_source_check',
      sql`${table.source} in ('initial','observed','command') and (${table.commandId} is not null)=(${table.source}='command') and (${table.source}='command' or ${table.version}=1) and isfinite(${table.recordedAt})`,
    ),
    foreignKey({
      name: 'round_judge_assignments_slot_fk',
      columns: [table.roundId, table.slot],
      foreignColumns: [roundJudgeSlots.roundId, roundJudgeSlots.slot],
    }).onDelete('cascade'),
    foreignKey({
      name: 'round_judge_assignments_previous_fk',
      columns: [table.roundId, table.slot, table.previousVersion],
      foreignColumns: assignmentKey(),
    }),
    foreignKey({
      name: 'round_judge_assignments_identity_fk',
      columns: [table.participantId, table.roundId, table.slot, table.actorId],
      foreignColumns: [
        roundParticipants.id,
        roundParticipants.roundId,
        roundParticipants.slot,
        roundParticipants.actorId,
      ],
    }),
    foreignKey({
      name: 'round_judge_assignments_command_fk',
      columns: [table.commandId, table.roundId],
      foreignColumns: [roundCommands.commandId, roundCommands.roundId],
    }),
  ],
);
