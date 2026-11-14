import {
  judgeStrikeSources,
  tournamentJudgeStatuses,
} from '@daisy/protocol/lobby';
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
import { actors } from './actors';
import {
  createdAtColumn,
  oneOf,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { entries } from './entries';
import { events, timeSlots } from './events';
import { tournaments } from './lobbies';
import { organizations } from './organizations';
import { constantText } from './tenant-keys';

/**
 * A person accepted to judge at a tournament. The school is an affiliation
 * only, an input to conflict detection.
 */
export const tournamentJudges = pgTable(
  'tournament_judges',
  {
    id: text('id').primaryKey(),
    lobbyId: text('lobby_id')
      .notNull()
      .references(() => tournaments.lobbyId, { onDelete: 'restrict' }),
    actorId: text('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'restrict' }),
    schoolOrganizationId: text('school_organization_id'),
    schoolOrganizationKind: constantText('school_organization_kind', 'school'),
    status: text('status')
      .$type<(typeof tournamentJudgeStatuses)[number]>()
      .notNull(),
    chairQualified: boolean('chair_qualified').notNull().default(false),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    unique('tournament_judges_id_lobby_unique').on(table.id, table.lobbyId),
    unique('tournament_judges_actor_unique').on(table.lobbyId, table.actorId),
    index('tournament_judges_actor_idx').on(table.actorId),
    index('tournament_judges_school_idx').on(
      table.schoolOrganizationId,
      table.schoolOrganizationKind,
    ),
    foreignKey({
      name: 'tournament_judges_school_fk',
      columns: [table.schoolOrganizationId, table.schoolOrganizationKind],
      foreignColumns: [organizations.id, organizations.kind],
    }).onDelete('restrict'),
    check(
      'tournament_judges_status_check',
      oneOf(table.status, tournamentJudgeStatuses),
    ),
    versionPositive('tournament_judges', table.version),
  ],
);

/**
 * Whether a judge is available in a time slot: one row per judge and slot,
 * never per tab round. A windowed stage has no slot and no rows here.
 */
export const judgeAvailability = pgTable(
  'judge_availability',
  {
    tournamentJudgeId: text('tournament_judge_id').notNull(),
    timeSlotId: text('time_slot_id').notNull(),
    lobbyId: text('lobby_id').notNull(),
    available: boolean('available').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tournamentJudgeId, table.timeSlotId] }),
    index('judge_availability_judge_idx').on(
      table.tournamentJudgeId,
      table.lobbyId,
    ),
    index('judge_availability_time_slot_idx').on(
      table.timeSlotId,
      table.lobbyId,
    ),
    foreignKey({
      name: 'judge_availability_judge_fk',
      columns: [table.tournamentJudgeId, table.lobbyId],
      foreignColumns: [tournamentJudges.id, tournamentJudges.lobbyId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'judge_availability_time_slot_fk',
      columns: [table.timeSlotId, table.lobbyId],
      foreignColumns: [timeSlots.id, timeSlots.lobbyId],
    }).onDelete('cascade'),
  ],
);

/** The events of its own lobby a judge may judge; no rows means every event. */
export const judgeEvents = pgTable(
  'judge_events',
  {
    tournamentJudgeId: text('tournament_judge_id').notNull(),
    eventId: text('event_id').notNull(),
    lobbyId: text('lobby_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tournamentJudgeId, table.eventId] }),
    index('judge_events_judge_idx').on(table.tournamentJudgeId, table.lobbyId),
    index('judge_events_event_idx').on(table.eventId, table.lobbyId),
    foreignKey({
      name: 'judge_events_judge_fk',
      columns: [table.tournamentJudgeId, table.lobbyId],
      foreignColumns: [tournamentJudges.id, tournamentJudges.lobbyId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'judge_events_event_fk',
      columns: [table.eventId, table.lobbyId],
      foreignColumns: [events.id, events.lobbyId],
    }).onDelete('cascade'),
  ],
);

/**
 * A judge who may not judge an entry. `source` tells an entry's strike
 * (`entry`, the `judging.strike` setting) from a conflict a judge or tab
 * declared (`judge`, `tab`, the `judging.conflict` setting).
 */
export const judgeStrikes = pgTable(
  'judge_strikes',
  {
    entryId: text('entry_id').notNull(),
    tournamentJudgeId: text('tournament_judge_id').notNull(),
    eventId: text('event_id').notNull(),
    lobbyId: text('lobby_id').notNull(),
    source: text('source').$type<(typeof judgeStrikeSources)[number]>().notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.entryId, table.tournamentJudgeId] }),
    index('judge_strikes_entry_idx').on(
      table.entryId,
      table.eventId,
      table.lobbyId,
    ),
    index('judge_strikes_judge_idx').on(table.tournamentJudgeId, table.lobbyId),
    foreignKey({
      name: 'judge_strikes_entry_fk',
      columns: [table.entryId, table.eventId, table.lobbyId],
      foreignColumns: [entries.id, entries.eventId, entries.lobbyId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'judge_strikes_judge_fk',
      columns: [table.tournamentJudgeId, table.lobbyId],
      foreignColumns: [tournamentJudges.id, tournamentJudges.lobbyId],
    }).onDelete('cascade'),
    check('judge_strikes_source_check', oneOf(table.source, judgeStrikeSources)),
  ],
);
