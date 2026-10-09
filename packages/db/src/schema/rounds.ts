import {
  competitionTypes,
  debateSides,
  type CompetitionType,
  emptyRuntimeCheckpoint,
  ratingLadders,
  roundLengthSchema,
  roundRulesSchema,
  roomConfigSchema,
  roundStageSchema,
  roundStatusSchema,
  runtimeCheckpointSchema,
  type RatedOutcome,
  type RoundLength,
  type RoundStage,
  type RoundStatus,
  type RatingLadder,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { actors } from './actors';
import {
  createdAtColumn,
  jsonbColumn,
  jsonbIsObject,
  notBefore,
  oneOf,
  timestampColumn,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { formatPresets } from './format-presets';
import { formatRevisions } from './format-revisions';
import { formats } from './formats';
import { rooms } from './rooms';

/** A side wins, or nobody does. Abandonment is a status, not an outcome. */
export const roundOutcomes = [...debateSides, 'draw'] as const;

/**
 * The durable competitive occurrence (ADR 0058 §6). Every actual debate is
 * a row here — how it was created, whether it is rated, and whether a seat
 * is held by a human or a bot do not create different round types. The
 * rules snapshot is the already-resolved RoundRules the startRound freeze
 * copies from the Room; provenance is pinned structurally with composite
 * FKs, so Postgres itself proves a round's preset was approved against the
 * definition revision that same round pins.
 */
export const rounds = pgTable(
  'rounds',
  {
    id: text('id').primaryKey(),
    /** The Room it froze from; null for a round created without one. */
    roomId: text('room_id').references(() => rooms.id, {
      onDelete: 'restrict',
    }),
    /** Nullable for service-created proof rounds. */
    createdByActorId: text('created_by_actor_id').references(() => actors.id, {
      onDelete: 'restrict',
    }),
    resolution: text('resolution').notNull(),
    competitionType: text('competition_type')
      .$type<CompetitionType>()
      .notNull(),
    /** A preset dimension: which sanctioned config a ranked round resolves from. */
    length: text('length').$type<RoundLength>().notNull(),
    formatId: text('format_id')
      .notNull()
      .references(() => formats.id, { onDelete: 'restrict' }),
    /** The FormatDefinition revision the rules were resolved against. */
    formatVersion: integer('format_version').notNull(),
    /** Which approved preset resolved this; null for casual and practice. */
    presetVersion: integer('preset_version'),
    roomConfigSnapshot: jsonbColumn('room_config_snapshot', roomConfigSchema),
    rulesSnapshot: jsonbColumn('rules_snapshot', roundRulesSchema).notNull(),
    status: text('status').$type<RoundStatus>().notNull(),
    currentStage: text('current_stage').$type<RoundStage>(),
    outcome: text('outcome').$type<RatedOutcome>(),
    /** The one authority for ratedness: null when this round never rates. */
    ladderId: text('ladder_id').$type<RatingLadder>(),
    startedAt: timestampColumn('started_at'),
    completedAt: timestampColumn('completed_at'),
    /** The Daisy checkpoint (ADR 0058 §4); only what has no durable row. */
    runtimeState: jsonbColumn('runtime_state', runtimeCheckpointSchema)
      .notNull()
      .default(emptyRuntimeCheckpoint),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => {
    const scheduled = sql`${table.status} = 'scheduled' and ${table.currentStage} is null and ${table.outcome} is null and ${table.startedAt} is null and ${table.completedAt} is null`;
    const active = sql`${table.status} = 'active' and ${table.currentStage} is not null and ${table.outcome} is null and ${table.startedAt} is not null and ${table.completedAt} is null`;
    const completed = sql`${table.status} = 'completed' and ${table.currentStage} is null and ${table.outcome} is not null and ${table.startedAt} is not null and ${table.completedAt} is not null`;
    const abandoned = sql`${table.status} = 'abandoned' and ${table.currentStage} is null and ${table.outcome} is null and ${table.completedAt} is not null`;
    return [
      /** Lets `rating_changes` pin a change to the round's own format. */
      unique('rounds_id_format_unique').on(table.id, table.formatId),
      index('rounds_status_competition_created_idx').on(
        table.status,
        table.competitionType,
        table.createdAt,
      ),
      index('rounds_format_completed_idx').on(
        table.formatId,
        table.completedAt,
      ),
      // Every foreign key gets an index leading with its columns, so a
      // RESTRICT probe and the provenance joins never scan the table.
      unique('rounds_room_unique').on(table.roomId),
      index('rounds_created_by_actor_idx').on(table.createdByActorId),
      index('rounds_definition_revision_idx').on(
        table.formatId,
        table.formatVersion,
      ),
      index('rounds_preset_provenance_idx').on(
        table.formatId,
        table.length,
        table.presetVersion,
        table.formatVersion,
      ),
      versionPositive('rounds', table.version),
      jsonbIsObject('rounds', table.runtimeState),
      jsonbIsObject('rounds', table.rulesSnapshot),
      check(
        'rounds_completed_after_started',
        notBefore(table.completedAt, table.startedAt),
      ),
      check(
        'rounds_status_check',
        oneOf(table.status, roundStatusSchema.options),
      ),
      check(
        'rounds_current_stage_check',
        sql`${table.currentStage} is null or ${oneOf(table.currentStage, roundStageSchema.options)}`,
      ),
      check(
        'rounds_competition_type_check',
        oneOf(table.competitionType, competitionTypes),
      ),
      check(
        'rounds_length_check',
        oneOf(table.length, roundLengthSchema.options),
      ),
      check(
        'rounds_outcome_check',
        sql`${table.outcome} is null or ${oneOf(table.outcome, roundOutcomes)}`,
      ),
      check(
        'rounds_ladder_check',
        sql`${table.ladderId} is null or ${oneOf(table.ladderId, ratingLadders)}`,
      ),
      check(
        'rounds_lifecycle_check',
        sql`(${scheduled}) or (${active}) or (${completed}) or (${abandoned})`,
      ),
      check(
        'rounds_rated_ladder_check',
        sql`(${table.competitionType} = 'ranked' and ${table.ladderId} is not null) or (${table.competitionType} <> 'ranked' and ${table.ladderId} is null)`,
      ),
      check(
        'rounds_ladder_derivation_check',
        sql`${table.ladderId} = case
          when ${table.competitionType} <> 'ranked' then null
          when ${table.length} = 'full' then 'ranked'
          when ${table.length} = 'quick' then 'quick' end`,
      ),
      check(
        'rounds_ranked_has_preset_check',
        sql`(${table.competitionType} = 'ranked') = (${table.presetVersion} is not null)`,
      ),
      foreignKey({
        name: 'rounds_definition_revision_fk',
        columns: [table.formatId, table.formatVersion],
        foreignColumns: [formatRevisions.formatId, formatRevisions.version],
      }),
      foreignKey({
        name: 'rounds_preset_provenance_fk',
        columns: [
          table.formatId,
          table.length,
          table.presetVersion,
          table.formatVersion,
        ],
        foreignColumns: [
          formatPresets.formatId,
          formatPresets.length,
          formatPresets.version,
          formatPresets.formatVersion,
        ],
      }),
    ];
  },
);
