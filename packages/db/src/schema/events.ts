import {
  entryKinds,
  stageKinds,
  stagePlaces,
  stageTimings,
} from '@daisy/protocol/lobby';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { ballotDefinitionVersions } from './ballot-definitions';
import {
  createdAtColumn,
  oneOf,
  timestampColumn,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { formatRevisions } from './format-revisions';
import { tournaments } from './lobbies';
import { poolResolutions, resolutionPools } from './resolution-pools';
import { templates } from './templates';
import { bothOrNeither, nonEmpty } from './tenant-keys';

/**
 * One competition in a tournament: a pinned format, a pinned ballot
 * definition (null is the Daisy ballot), entries, and its own draws and
 * standings. `template_id` is set when the event follows a template, and
 * the composite key proves it then has the template's format; an event that
 * copied a template keeps no link. `entries_version` moves with every entry
 * command and `settings_version` with this scope's settings.
 */
export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    lobbyId: text('lobby_id')
      .notNull()
      .references(() => tournaments.lobbyId, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    /** The short name a schedule shows, such as "VLD". */
    label: text('label'),
    formatId: text('format_id').notNull(),
    formatVersion: integer('format_version').notNull(),
    ballotDefinitionId: text('ballot_definition_id'),
    ballotDefinitionVersion: integer('ballot_definition_version'),
    templateId: text('template_id'),
    entryKind: text('entry_kind')
      .$type<(typeof entryKinds)[number]>()
      .notNull(),
    teamSize: integer('team_size').notNull().default(1),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
    entriesVersion: integer('entries_version').notNull().default(1),
    settingsVersion: integer('settings_version').notNull().default(1),
  },
  (table) => [
    unique('events_id_lobby_unique').on(table.id, table.lobbyId),
    uniqueIndex('events_name_unique').on(
      table.lobbyId,
      sql`lower(${table.name})`,
    ),
    index('events_format_revision_idx').on(table.formatId, table.formatVersion),
    index('events_ballot_definition_idx').on(
      table.ballotDefinitionId,
      table.ballotDefinitionVersion,
    ),
    index('events_template_idx').on(
      table.templateId,
      table.formatId,
      table.formatVersion,
    ),
    foreignKey({
      name: 'events_format_revision_fk',
      columns: [table.formatId, table.formatVersion],
      foreignColumns: [formatRevisions.formatId, formatRevisions.version],
    }).onDelete('restrict'),
    foreignKey({
      name: 'events_ballot_definition_fk',
      columns: [table.ballotDefinitionId, table.ballotDefinitionVersion],
      foreignColumns: [
        ballotDefinitionVersions.ballotDefinitionId,
        ballotDefinitionVersions.version,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'events_template_format_fk',
      columns: [table.templateId, table.formatId, table.formatVersion],
      foreignColumns: [
        templates.id,
        templates.formatId,
        templates.formatVersion,
      ],
    }).onDelete('restrict'),
    bothOrNeither(
      'events_ballot_definition_complete',
      table.ballotDefinitionId,
      table.ballotDefinitionVersion,
    ),
    check('events_entry_kind_check', oneOf(table.entryKind, entryKinds)),
    check(
      'events_team_size_check',
      sql`${table.teamSize} >= 1 and (${table.entryKind} = 'person') = (${table.teamSize} = 1)`,
    ),
    nonEmpty('events_name_nonempty', table.name),
    versionPositive('events', table.version),
    versionPositive('events_entries', table.entriesVersion),
    versionPositive('events_settings', table.settingsVersion),
  ],
);

/**
 * A part of an event with one structure: preliminary or elimination. It
 * carries place and timing, and an elimination stage may be for one
 * division, a name from the event's `entry.divisions` setting.
 */
export const stages = pgTable(
  'stages',
  {
    id: text('id').primaryKey(),
    lobbyId: text('lobby_id').notNull(),
    eventId: text('event_id').notNull(),
    kind: text('kind').$type<(typeof stageKinds)[number]>().notNull(),
    sequence: integer('sequence').notNull(),
    division: text('division'),
    place: text('place').$type<(typeof stagePlaces)[number]>().notNull(),
    timing: text('timing').$type<(typeof stageTimings)[number]>().notNull(),
    windowOpensAt: timestampColumn('window_opens_at'),
    windowClosesAt: timestampColumn('window_closes_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    unique('stages_id_event_unique').on(table.id, table.eventId, table.lobbyId),
    unique('stages_sequence_unique').on(table.eventId, table.sequence),
    index('stages_event_idx').on(table.eventId, table.lobbyId),
    foreignKey({
      name: 'stages_event_fk',
      columns: [table.eventId, table.lobbyId],
      foreignColumns: [events.id, events.lobbyId],
    }).onDelete('restrict'),
    check('stages_kind_check', oneOf(table.kind, stageKinds)),
    check('stages_place_check', oneOf(table.place, stagePlaces)),
    check('stages_timing_check', oneOf(table.timing, stageTimings)),
    check('stages_sequence_positive', sql`${table.sequence} > 0`),
    check(
      'stages_division_is_elimination',
      sql`${table.division} is null or (${table.kind} = 'elimination' and length(trim(${table.division})) > 0)`,
    ),
    check(
      'stages_window_check',
      sql`case when ${table.timing} = 'windowed'
        then ${table.windowOpensAt} is not null and ${table.windowClosesAt} is not null and ${table.windowClosesAt} > ${table.windowOpensAt}
        else ${table.windowOpensAt} is null and ${table.windowClosesAt} is null end`,
    ),
    versionPositive('stages', table.version),
  ],
);

/**
 * A start time and a name in a tournament. Tab rounds sit in slots, and
 * events sharing a slot run together. `version` is the slot's guard: every
 * command that seats a person in a Room in the slot updates this row where
 * the version is the one it read, so two such commands serialise and the
 * second rechecks "one person, one Room per slot" against the first.
 */
export const timeSlots = pgTable(
  'time_slots',
  {
    id: text('id').primaryKey(),
    lobbyId: text('lobby_id')
      .notNull()
      .references(() => tournaments.lobbyId, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    startsAt: timestampColumn('starts_at').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    unique('time_slots_id_lobby_unique').on(table.id, table.lobbyId),
    uniqueIndex('time_slots_name_unique').on(
      table.lobbyId,
      sql`lower(${table.name})`,
    ),
    nonEmpty('time_slots_name_nonempty', table.name),
    versionPositive('time_slots', table.version),
  ],
);

/**
 * One numbered round within a stage: "Round 3", "Quarterfinals". A tab
 * round in a live stage sits in one of its own lobby's time slots once it
 * is scheduled; one in a windowed stage never does. It keeps its resolution
 * pool, its one wording (drawn from that pool) and the fact that the wording
 * was released; the method and its release timing are the event's
 * `resolution.rule` setting.
 */
export const tabRounds = pgTable(
  'tab_rounds',
  {
    id: text('id').primaryKey(),
    lobbyId: text('lobby_id').notNull(),
    eventId: text('event_id').notNull(),
    stageId: text('stage_id').notNull(),
    number: integer('number').notNull(),
    name: text('name'),
    timeSlotId: text('time_slot_id'),
    resolutionPoolId: text('resolution_pool_id').references(
      () => resolutionPools.id,
      { onDelete: 'restrict' },
    ),
    poolResolutionId: text('pool_resolution_id'),
    resolutionReleasedAt: timestampColumn('resolution_released_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    unique('tab_rounds_id_event_unique').on(
      table.id,
      table.eventId,
      table.lobbyId,
    ),
    unique('tab_rounds_number_unique').on(table.stageId, table.number),
    index('tab_rounds_stage_idx').on(
      table.stageId,
      table.eventId,
      table.lobbyId,
    ),
    index('tab_rounds_time_slot_idx').on(table.timeSlotId, table.lobbyId),
    index('tab_rounds_resolution_pool_idx').on(table.resolutionPoolId),
    index('tab_rounds_pool_resolution_idx').on(
      table.poolResolutionId,
      table.resolutionPoolId,
    ),
    foreignKey({
      name: 'tab_rounds_stage_fk',
      columns: [table.stageId, table.eventId, table.lobbyId],
      foreignColumns: [stages.id, stages.eventId, stages.lobbyId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'tab_rounds_time_slot_fk',
      columns: [table.timeSlotId, table.lobbyId],
      foreignColumns: [timeSlots.id, timeSlots.lobbyId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'tab_rounds_pool_resolution_fk',
      columns: [table.poolResolutionId, table.resolutionPoolId],
      foreignColumns: [poolResolutions.id, poolResolutions.poolId],
    }).onDelete('restrict'),
    check('tab_rounds_number_positive', sql`${table.number} > 0`),
    check(
      'tab_rounds_name_nonempty',
      sql`${table.name} is null or length(trim(${table.name})) > 0`,
    ),
    check(
      'tab_rounds_wording_from_pool',
      sql`${table.poolResolutionId} is null or ${table.resolutionPoolId} is not null`,
    ),
    check(
      'tab_rounds_released_wording',
      sql`${table.resolutionReleasedAt} is null or ${table.poolResolutionId} is not null`,
    ),
    versionPositive('tab_rounds', table.version),
  ],
);
