import { lifecycleSql, lifecycleSqlList } from '../lifecycle-sql';
import {
  competitionTypes,
  type CompetitionType,
  ratingDivisions,
  ratingStyles,
  roundRulesSchema,
  frozenRoomConfigSchema,
  roomCaptureSchema,
  roundStageSchema,
  roundStatuses,
  roundStatus,
  runningRoundStatuses,
  runtimeCheckpointSchema,
  roundJudgingSchema,
  daisyBallotDefinitionIds,
  type RoundPlatformEnding,
  type SideKey,
  roundDecisionReleases,
  type RoundDecisionRelease,
  type RoundStage,
  type RoundStatus,
  type RatingDivision,
  type RatingStyle,
  seatDrawSchema,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  boolean,
} from 'drizzle-orm/pg-core';
import { actors } from './actors';
import { ballotDefinitionVersions } from './ballot-definitions';
import {
  createdAtColumn,
  jsonbColumn,
  jsonbArrayColumnNullable,
  jsonbColumnNullable,
  jsonbIsObject,
  isSideKeyOrNull,
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
import { resolutionDrawEvidenceSchema } from '@daisy/protocol/resolution-draw';

/** A ranking's places as stored: best place first, a shared place as one group. */
const rankingPlacesSchema = z
  .array(z.array(z.string().min(1).max(64)).min(1))
  .min(1);
/** The frozen judging as stored: present, or the column is null. */
const storedJudgingSchema = roundJudgingSchema.unwrap();

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
    /** The host took over from a restricted one, and names no human judge (DEC-331). */
    hostInherited: boolean('host_inherited').notNull().default(false),
    visibility: text('visibility').$type<'public' | 'unlisted' | 'private'>(),
    /** Null until a draw's reveal; stays null if the Round ended before it. */
    resolution: text('resolution'),
    /** Pre-round prep's full length, or null when the Round has none. */
    preRoundPrepMs: integer('pre_round_prep_ms'),
    competitionType: text('competition_type')
      .$type<CompetitionType>()
      .notNull(),
    formatId: text('format_id')
      .notNull()
      .references(() => formats.id, { onDelete: 'restrict' }),
    /** The FormatDefinition revision the rules were resolved against. */
    formatVersion: integer('format_version').notNull(),
    /** Which approved preset resolved this; null for casual. */
    presetVersion: integer('preset_version'),
    /** The viewer-independent config: a host list appears only as its length. */
    roomConfigSnapshot: jsonbColumn(
      'room_config_snapshot',
      frozenRoomConfigSchema,
    ),
    /** What every participant was told is captured, frozen at Launch (WATCH-8). */
    capture: jsonbColumnNullable('capture', roomCaptureSchema),
    /** The Room's post-round call choice, frozen at Launch (ADR 0127). */
    postRoundCall: boolean('post_round_call').notNull().default(false),
    /** Proof metadata of the Room's draw, frozen at Launch; null without one. */
    resolutionEvidence: jsonbColumn(
      'resolution_evidence',
      resolutionDrawEvidenceSchema,
    ),
    /**
     * What Start round's seat draw did (ADR 0145): the coin, the open seats
     * placed and the commitment. Public, immutable once written, and null on
     * Rounds started before it existed.
     */
    seatDraw: jsonbColumn('seat_draw', seatDrawSchema),
    rulesSnapshot: jsonbColumn('rules_snapshot', roundRulesSchema).notNull(),
    status: text('status').$type<RoundStatus>().notNull(),
    currentStage: text('current_stage').$type<RoundStage>(),
    /**
     * What the Round decided (TAB-6.2): the side that won, or a ranking's
     * places (side keys or round participant ids, best first); at most one,
     * and neither is no result. A ranking's subject is the rules' outcome.
     */
    winningSide: text('winning_side').$type<SideKey>(),
    ranking: jsonbArrayColumnNullable('ranking', rankingPlacesSchema),
    /**
     * What the Round is judged on, frozen when it launches (TAB-6.11): its
     * ballot definition and panel rule; null when its outcome is judged by
     * nobody.
     */
    judging: jsonbColumnNullable('judging', storedJudgingSchema),
    /** Internal relational integrity keys, derived only from the frozen source. */
    ballotDefinitionId: text('ballot_definition_id').generatedAlwaysAs(
      sql`case when judging->'source'->>'kind' = 'stored' then judging->'source'->>'id' else null end`,
    ),
    ballotDefinitionVersion: integer(
      'ballot_definition_version',
    ).generatedAlwaysAs(
      sql`case when judging->'source'->>'kind' = 'stored' then (judging->'source'->>'version')::integer else null end`,
    ),
    /** The one authority for ratedness: null when this round never rates. */
    /** Own standing league ladder frozen from the source Room at Start. */
    leagueLadderId: text('league_ladder_id'),
    ladderId: text('ladder_id').$type<RatingStyle>(),
    /**
     * The division of the ladder the Round rates on (ADR 0147), frozen at
     * Start from who sat: the ladder is (`ladder_id`, `ladder_division`), and
     * both are null together on a casual Round.
     */
    ladderDivision: text('ladder_division').$type<RatingDivision>(),
    startedAt: timestampColumn('started_at'),
    completedAt: timestampColumn('completed_at'),
    /** The Daisy checkpoint (ADR 0058 §4); only what has no durable row. */
    runtimeState: jsonbColumn(
      'runtime_state',
      runtimeCheckpointSchema,
    ).notNull(),
    /** The platform ended this Round: it gives no outcome, rating, penalty or charge. */
    platformEnding: text('platform_ending').$type<RoundPlatformEnding>(),
    finalSegmentEndedAt: timestampColumn('final_segment_ended_at'),
    transcriptAdmissionCutoff: timestampColumn('transcript_admission_cutoff'),
    /** Set once at the transcript freeze from the injected policy; judges rule before it (DEC-201, DEC-207). */
    ballotDeadlineAt: timestampColumn('ballot_deadline_at'),
    /** Past this, a window settled evidence cannot resolve stops waiting (DEC-276). */
    attendanceResolutionCutoffAt: timestampColumn(
      'attendance_resolution_cutoff_at',
    ),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
    /** SHA3-256 of an unlisted Round's current link; the token is never stored. */
    audienceLinkHash: text('audience_link_hash'),
    /** When participants are told the decision (ADR 0144), frozen at the Start. */
    decisionRelease: text('decision_release')
      .$type<RoundDecisionRelease>()
      .notNull()
      .default('on_finalize'),
  },
  (table) => {
    const noOutcome = sql`${table.winningSide} is null and ${table.ranking} is null`;
    const opening = sql`${table.status} = ${lifecycleSql(roundStatus.opening)} and ${table.currentStage} is null and ${noOutcome} and ${table.startedAt} is null and ${table.completedAt} is null`;
    const active = sql`${table.status} = ${lifecycleSql(roundStatus.active)} and ${table.resolution} is not null and ${table.currentStage} is not null and ${noOutcome} and ${table.startedAt} is not null and ${table.completedAt} is null`;
    /** A null outcome is a real ending on any ladder and writes no rating (DEC-277). */
    const completed = sql`${table.status} = ${lifecycleSql(roundStatus.completed)} and ${table.currentStage} is null and ${table.startedAt} is not null and ${table.completedAt} is not null`;
    const abandoned = sql`${table.status} = ${lifecycleSql(roundStatus.abandoned)} and ${table.currentStage} is null and ${noOutcome} and ${table.completedAt} is not null`;
    return [
      index('rounds_room_league_ladder_idx').on(
        table.roomId,
        table.leagueLadderId,
      ),
      index('rounds_league_ladder_completed_idx').on(
        table.leagueLadderId,
        table.completedAt,
      ),
      foreignKey({
        name: 'rounds_room_league_ladder_fk',
        columns: [table.roomId, table.leagueLadderId],
        foreignColumns: [rooms.id, rooms.leagueLadderId],
      }).onDelete('restrict'),
      check(
        'rounds_league_ladder_source_check',
        sql`${table.leagueLadderId} is null or (${table.roomId} is not null and ${table.ladderId} is null and ${table.competitionType} = 'casual')`,
      ),
      /** Lets `rating_changes` pin a change to the round's own format. */
      unique('rounds_id_format_unique').on(table.id, table.formatId),
      unique('rounds_id_ladder_division_unique').on(
        table.id,
        table.ladderDivision,
      ),
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
      index('rounds_discovery_live_room_idx')
        .on(sql`${table.roomId} collate "C"`)
        .where(
          sql`${table.status} in ${lifecycleSqlList(runningRoundStatuses)} and ${table.roomId} is not null`,
        ),
      unique('rounds_room_unique').on(table.roomId),
      index('rounds_created_by_actor_idx').on(table.createdByActorId),
      index('rounds_definition_revision_idx').on(
        table.formatId,
        table.formatVersion,
      ),
      index('rounds_preset_provenance_idx').on(
        table.formatId,
        table.presetVersion,
        table.formatVersion,
      ),
      versionPositive('rounds', table.version),
      check(
        'rounds_platform_ending_check',
        sql`${table.platformEnding} is null or (${table.platformEnding} = 'recovery_bound' and ${table.status} = ${lifecycleSql(roundStatus.abandoned)}) or (${table.platformEnding} = 'capture_shortfall' and ${table.status} = ${lifecycleSql(roundStatus.completed)} and ${noOutcome})`,
      ),
      check(
        'rounds_transcript_cutoff_check',
        sql`(${table.finalSegmentEndedAt} is null and ${table.transcriptAdmissionCutoff} is null) or (${table.finalSegmentEndedAt} is not null and ${table.transcriptAdmissionCutoff} is not null and ${table.transcriptAdmissionCutoff} = ${table.finalSegmentEndedAt} + interval '120 seconds')`,
      ),
      check(
        'rounds_attendance_cutoff_check',
        sql`(${table.finalSegmentEndedAt} is null and ${table.attendanceResolutionCutoffAt} is null) or (${table.finalSegmentEndedAt} is not null and ${table.attendanceResolutionCutoffAt} is not null and ${table.attendanceResolutionCutoffAt} = ${table.finalSegmentEndedAt} + interval '60 minutes')`,
      ),
      check(
        'rounds_visibility_check',
        sql`${table.visibility} is null or ${oneOf(table.visibility, ['public', 'unlisted', 'private'])}`,
      ),
      check(
        'rounds_room_freeze_complete',
        sql`${table.roomId} is null or (${table.roomConfigSnapshot} is not null and ${table.visibility} is not null)`,
      ),
      jsonbIsObject('rounds', table.roomConfigSnapshot),
      jsonbIsObject('rounds', table.resolutionEvidence),
      jsonbIsObject('rounds', table.seatDraw),
      jsonbIsObject('rounds', table.runtimeState),
      jsonbIsObject('rounds', table.rulesSnapshot),
      jsonbIsObject('rounds', table.capture),
      check(
        'rounds_completed_after_started',
        notBefore(table.completedAt, table.startedAt),
      ),
      check(
        'rounds_pre_round_prep_positive',
        sql`${table.preRoundPrepMs} is null or ${table.preRoundPrepMs} > 0`,
      ),
      check('rounds_status_check', oneOf(table.status, roundStatuses)),
      check(
        'rounds_current_stage_check',
        sql`${table.currentStage} is null or ${oneOf(table.currentStage, roundStageSchema.options)}`,
      ),
      check(
        'rounds_competition_type_check',
        oneOf(table.competitionType, competitionTypes),
      ),
      check(
        'rounds_decision_release_check',
        oneOf(table.decisionRelease, roundDecisionReleases),
      ),
      check(
        'rounds_outcome_check',
        sql`(${table.winningSide} is null or ${table.ranking} is null) and (${isSideKeyOrNull(table.winningSide)})`,
      ),
      // Places: a non-empty array of non-empty arrays of strings.
      check(
        'rounds_ranking_shape_check',
        sql`${table.ranking} is null or (jsonb_typeof(${table.ranking}) = 'array' and jsonb_array_length(${table.ranking}) > 0 and not jsonb_path_exists(${table.ranking}, 'strict $[*] ? (@.type() != "array" || @.size() == 0)') and not jsonb_path_exists(${table.ranking}, 'strict $[*][*] ? (@.type() != "string")'))`,
      ),
      jsonbIsObject('rounds', table.judging),
      index('rounds_ballot_definition_idx').on(
        table.ballotDefinitionId,
        table.ballotDefinitionVersion,
      ),
      foreignKey({
        name: 'rounds_ballot_definition_fk',
        columns: [table.ballotDefinitionId, table.ballotDefinitionVersion],
        foreignColumns: [
          ballotDefinitionVersions.ballotDefinitionId,
          ballotDefinitionVersions.version,
        ],
      }).onDelete('restrict'),
      check(
        'rounds_judging_source_check',
        sql`${table.judging} is null or coalesce(
        jsonb_typeof(${table.judging}->'source') = 'object' and
        case ${table.judging}->'source'->>'kind'
          when 'daisy' then
            ${table.judging}->'source'->>'key' = ${table.judging}->'ballot'->>'key' and
            ${table.judging}->'source'->'revision' = ${table.judging}->'ballot'->'revision' and
            ((${table.judging}->'source'->>'key') || '@' || (${table.judging}->'source'->>'revision')) in (${sql.raw(daisyBallotDefinitionIds.map((id) => `'${id}'`).join(', '))})
          when 'stored' then
            ${table.judging}->'source'->>'id' ~ '^[a-z0-9]{24}$' and
            jsonb_typeof(${table.judging}->'source'->'version') = 'number' and
            ${table.judging}->'source'->'version' = ${table.judging}->'ballot'->'revision' and
            ${table.ballotDefinitionVersion} > 0
          else false end, false)`,
      ),
      check(
        'rounds_ladder_check',
        sql`${table.ladderId} is null or ${oneOf(table.ladderId, ratingStyles)}`,
      ),
      check(
        'rounds_ladder_division_check',
        sql`(${table.ladderId} is null) = (${table.ladderDivision} is null) and (${table.ladderDivision} is null or ${oneOf(table.ladderDivision, ratingDivisions)})`,
      ),
      check(
        'rounds_lifecycle_check',
        sql`(${opening}) or (${active}) or (${completed}) or (${abandoned})`,
      ),
      check(
        'rounds_ranked_ladder_check',
        sql`(${table.competitionType} = 'ranked' and ${table.ladderId} is not null and ${table.ladderId} = ${table.formatId}) or (${table.competitionType} <> 'ranked' and ${table.ladderId} is null)`,
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
        columns: [table.formatId, table.presetVersion, table.formatVersion],
        foreignColumns: [
          formatPresets.formatId,
          formatPresets.version,
          formatPresets.formatVersion,
        ],
      }),
    ];
  },
);
