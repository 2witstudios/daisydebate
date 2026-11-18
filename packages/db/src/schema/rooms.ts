import { ladders } from './ladders';
import {
  competitionTypes,
  ratingDivisions,
  twoSideKeys,
  type TwoSideKey,
  roomCaptureSchema,
  roomConfigSchema,
  seatKinds,
  roomStatuses,
  type RoomView,
  roomExecutionPlanSchema,
  roundRulesSchema,
  type CompetitionType,
  type RatingDivision,
  type SeatKind,
} from '@daisy/protocol';
import type { lobbyKinds } from '@daisy/protocol/lobby';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  boolean,
  primaryKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  jsonbColumn,
  jsonbColumnNullable,
  jsonbIsObject,
  oneOf,
  timestampColumn,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { daisyReferenceLobby } from './lobby-defaults';
import { ballotDefinitionVersions } from './ballot-definitions';
import { formatPresets } from './format-presets';
import { formatRevisions } from './format-revisions';
import {
  seatActorId,
  seatChecks,
  seatKindColumn,
  seatSideColumn,
  seatSlot,
} from './seats';
import { formats } from './formats';
import { actors } from './actors';
import { lobbies } from './lobbies';
import { lobbyTemplates, templates } from './templates';
import { bothOrNeither } from './tenant-keys';

/**
 * The durable pre-competition aggregate (ADR 0058 §5a). The Room holds its
 * whole configuration surface, the versions it pinned at resolution, the
 * already-resolved rules the startRound freeze copies. It is not competitive
 * state: no Round reads a Room, no rating depends on one, and nothing in a
 * Round's history would change if Rooms were deleted.
 */
export const rooms = pgTable(
  'rooms',
  {
    id: text('id').primaryKey(),
    /**
     * The host person: set exactly when the lobby is standing. In a
     * tournament lobby authority over the Room comes from grants on the
     * lobby.
     */
    hostActorId: text('host_actor_id').references(() => actors.id, {
      onDelete: 'restrict',
    }),
    /** The host took over from a restricted one, and names no human judge (DEC-331). */
    hostInherited: boolean('host_inherited').notNull().default(false),
    title: text('title').notNull(),
    /** Null exactly while a draw Room has not revealed its resolution. */
    topic: text('topic'),
    visibility: text('visibility').$type<RoomView['visibility']>().notNull(),
    version: versionColumn(),
    changeVersion: integer('change_version').notNull().default(1),
    formatId: text('format_id')
      .notNull()
      .references(() => formats.id, { onDelete: 'restrict' }),
    formatVersion: integer('format_version').notNull(),
    /** Ranked only; the equivalence holds as on rounds. */
    presetVersion: integer('preset_version'),
    /**
     * The catalog preset a casual room was based on (FMT-1): written only by
     * the selection policy, kept across edits so standing and Back to
     * standard can be derived. Both set or both null.
     */
    basisFormatId: text('basis_format_id'),
    basisPresetVersion: integer('basis_preset_version'),
    /** The league lobby rating selection at creation; Daisy uses ladder_id on Round. */
    leagueLadderId: text('league_ladder_id'),
    competitionType: text('competition_type')
      .$type<CompetitionType>()
      .notNull(),
    /**
     * The lobby the Room was created in (ADR 0155), fixed for its life: its
     * debater seats are for that division's members, and a ranked Round
     * rates on its ladder. Not written after insert.
     */
    division: text('division').$type<RatingDivision>().notNull(),
    /**
     * Team 1's side, or null while the sides are open to the coin flip at
     * Start round (ADR 0145). Team 1 sits in the affirmative seats.
     */
    teamOneSide: text('team_one_side').$type<TwoSideKey>(),
    /**
     * The Room holds its host as an active member, seated or not: a Train
     * practice (decision 75), so a second Start practice returns to it. Set
     * at create and never changed. Any other Room holds only its seated
     * people (TAB-6.16).
     */
    holdsHost: boolean('holds_host').notNull().default(false),
    /** RoomConfig as chosen. */
    config: jsonbColumn('config', roomConfigSchema).notNull(),
    /** The casual host's broadcast and recording choice (WATCH-8); null is none. */
    capture: jsonbColumnNullable('capture', roomCaptureSchema),
    /** The casual host keeps the call open after the Round (ADR 0127). */
    postRoundCall: boolean('post_round_call').notNull().default(false),
    /** RoomExecutionPlan, resolved. */
    executionPlan: jsonbColumn(
      'execution_plan',
      roomExecutionPlanSchema,
    ).notNull(),
    /** RoundRules, resolved and frozen here. */
    rulesSnapshot: jsonbColumn('rules_snapshot', roundRulesSchema).notNull(),
    status: text('status').$type<(typeof roomStatuses)[number]>().notNull(),
    /**
     * The last accepted participant command: the durable idle anchor
     * (ADR 0070), independent of receipt retention and processing time.
     */
    lastCommandAt: timestampColumn('last_command_at').notNull().defaultNow(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    /**
     * The Room's only parent, named by every writer: there is no default,
     * so a Room written without its lobby is refused. Every Room made before
     * lobbies had rows was placed in Daisy's public lobby by the migration.
     * `lobby_kind` is the lobby's kind, proved by the composite key. A
     * trigger refuses moving a Room to another lobby.
     */
    lobbyId: text('lobby_id').notNull(),
    lobbyKind: text('lobby_kind')
      .$type<(typeof lobbyKinds)[number]>()
      .notNull()
      .default(daisyReferenceLobby.kind),
    /** The template the Room follows; standing Rooms require a lobby offer. */
    templateId: text('template_id'),
    /** Internal constraint key: event pins do not require standing offers. */
    standingTemplateId: text('standing_template_id').generatedAlwaysAs(
      sql`case when lobby_kind = 'standing' then template_id else null end`,
    ),
    /** The pinned ballot definition; null is the Daisy ballot. */
    ballotDefinitionId: text('ballot_definition_id'),
    ballotDefinitionVersion: integer('ballot_definition_version'),
  },
  (table) => [
    unique('rooms_id_league_ladder_unique').on(table.id, table.leagueLadderId),
    index('rooms_league_ladder_lobby_idx').on(
      table.leagueLadderId,
      table.lobbyId,
    ),
    foreignKey({
      name: 'rooms_own_league_ladder_fk',
      columns: [table.leagueLadderId, table.lobbyId],
      foreignColumns: [ladders.id, ladders.lobbyId],
    }).onDelete('restrict'),
    check(
      'rooms_league_ladder_is_casual_standing',
      sql`${table.leagueLadderId} is null or (${table.lobbyKind} = 'standing' and ${table.competitionType} = 'casual')`,
    ),
    index('rooms_discovery_assembly_idx')
      .on(sql`${table.id} collate "C"`)
      .where(sql`${table.status} in ('assembling', 'ready')`),
    index('rooms_host_actor_idx').on(table.hostActorId),
    unique('rooms_id_lobby_unique').on(table.id, table.lobbyId),
    index('rooms_lobby_kind_idx').on(table.lobbyId, table.lobbyKind),
    index('rooms_lobby_template_idx').on(table.lobbyId, table.templateId),
    index('rooms_template_idx').on(table.templateId),
    index('rooms_standing_template_idx').on(
      table.lobbyId,
      table.standingTemplateId,
    ),
    index('rooms_ballot_definition_idx').on(
      table.ballotDefinitionId,
      table.ballotDefinitionVersion,
    ),
    foreignKey({
      name: 'rooms_lobby_fk',
      columns: [table.lobbyId, table.lobbyKind],
      foreignColumns: [lobbies.id, lobbies.kind],
    }).onDelete('restrict'),
    foreignKey({
      name: 'rooms_template_fk',
      columns: [table.templateId],
      foreignColumns: [templates.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'rooms_offered_template_fk',
      columns: [table.lobbyId, table.standingTemplateId],
      foreignColumns: [lobbyTemplates.lobbyId, lobbyTemplates.templateId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'rooms_ballot_definition_fk',
      columns: [table.ballotDefinitionId, table.ballotDefinitionVersion],
      foreignColumns: [
        ballotDefinitionVersions.ballotDefinitionId,
        ballotDefinitionVersions.version,
      ],
    }).onDelete('restrict'),
    check(
      'rooms_host_by_lobby_kind',
      sql`(${table.hostActorId} is null) = (${table.lobbyKind} = 'tournament')`,
    ),
    // With rounds_ranked_ladder_check, an event Room can never post to a ladder.
    // An event Room's Recording is never released as Daisy releases one (TAB-6).
    check(
      'rooms_event_recording',
      sql`${table.lobbyKind} <> 'tournament' or (${table.capture} is not null and ${table.capture}->>'recordingPolicy' in ('off', 'officials'))`,
    ),
    check(
      'rooms_event_is_casual',
      sql`${table.lobbyKind} <> 'tournament' or ${table.competitionType} = 'casual'`,
    ),
    bothOrNeither(
      'rooms_ballot_definition_complete',
      table.ballotDefinitionId,
      table.ballotDefinitionVersion,
    ),
    index('rooms_lobby_idx').on(
      table.visibility,
      table.status,
      table.createdAt,
    ),
    check(
      'rooms_team_one_side_check',
      sql`${table.teamOneSide} is null or ${oneOf(table.teamOneSide, twoSideKeys)}`,
    ),
    // A ranked Room always flips for sides until Start (ADR 0145); at Start
    // its seats take the drawn sides and team 1's side reads Affirmative.
    check(
      'rooms_ranked_sides_open_check',
      sql`${table.competitionType} <> 'ranked' or ${table.status} not in ('assembling', 'ready') or ${table.teamOneSide} is null`,
    ),
    check(
      'rooms_visibility_check',
      oneOf(table.visibility, ['public', 'unlisted', 'private']),
    ),
    check(
      'rooms_ranked_public_check',
      sql`${table.competitionType} <> 'ranked' or ${table.visibility} = 'public'`,
    ),
    check('rooms_division_check', oneOf(table.division, ratingDivisions)),
    check('rooms_title_nonempty', sql`length(trim(${table.title})) > 0`),
    check(
      'rooms_topic_nonempty',
      sql`${table.topic} is null or length(trim(${table.topic})) > 0`,
    ),
    // Proves only that a fixed-topic Room has text; the draw-phase topic
    // rules are the Room writer's, rechecked by a deferred trigger.
    check(
      'rooms_fixed_topic_present',
      // Null-safe: a plan with no draw key is a fixed-topic Room.
      sql`${table.topic} is not null or coalesce(${table.executionPlan}->'resolutionDraw'->>'enabled' = 'true', false)`,
    ),
    versionPositive('rooms', table.version),
    versionPositive('rooms_change', table.changeVersion),
    unique('rooms_id_format_unique').on(table.id, table.formatId),
    // Leading with each foreign key's own columns, so the provenance joins
    // and the RESTRICT probes are index lookups rather than scans.
    index('rooms_definition_revision_idx').on(
      table.formatId,
      table.formatVersion,
    ),
    index('rooms_basis_preset_idx').on(
      table.basisFormatId,
      table.basisPresetVersion,
    ),
    index('rooms_preset_version_idx').on(
      table.formatId,
      table.presetVersion,
      table.formatVersion,
    ),
    foreignKey({
      name: 'rooms_definition_revision_fk',
      columns: [table.formatId, table.formatVersion],
      foreignColumns: [formatRevisions.formatId, formatRevisions.version],
    }),
    foreignKey({
      name: 'rooms_preset_provenance_fk',
      columns: [table.formatId, table.presetVersion, table.formatVersion],
      foreignColumns: [
        formatPresets.formatId,
        formatPresets.version,
        formatPresets.formatVersion,
      ],
    }),
    check('rooms_status_check', oneOf(table.status, roomStatuses)),
    check(
      'rooms_competition_type_check',
      oneOf(table.competitionType, competitionTypes),
    ),
    check(
      'rooms_basis_complete',
      sql`(${table.basisFormatId} is null) = (${table.basisPresetVersion} is null)`,
    ),
    // MATCH FULL in the committed SQL: drizzle-kit cannot spell it, and a
    // half-null pair must never escape the reference.
    foreignKey({
      name: 'rooms_basis_preset_fk',
      columns: [table.basisFormatId, table.basisPresetVersion],
      foreignColumns: [formatPresets.formatId, formatPresets.version],
    }),
    check(
      'rooms_ranked_has_preset_check',
      sql`(${table.competitionType} = 'ranked') = (${table.presetVersion} is not null)`,
    ),
    jsonbIsObject('rooms', table.config),
    jsonbIsObject('rooms', table.executionPlan),
    jsonbIsObject('rooms', table.rulesSnapshot),
    jsonbIsObject('rooms', table.capture),
  ],
);

/**
 * A seat during Room assembly, before any Round exists (ADR 0058 §5a).
 * The same terms as a Round's seat: an id, an actor, a seat kind, a side
 * for a side's seat, and a slot.
 */
export const roomParticipants = pgTable(
  'room_participants',
  {
    id: text('id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    actorId: seatActorId(),
    seatKind: seatKindColumn(),
    side: seatSideColumn(),
    slot: seatSlot(),
    /** A debater whose team is ?, placed at random at Start round (ADR 0145). */
    teamOpen: boolean('team_open').notNull().default(false),
    /** A debater whose speaking position is ?, placed at random at Start round. */
    positionOpen: boolean('position_open').notNull().default(false),
    /** Latest accepted readiness command; Redis consent must match this fence. */
    readinessCommandId: text('readiness_command_id'),
    readinessVersion: integer('readiness_version').notNull().default(0),
  },
  (table) => [
    uniqueIndex('room_participants_actor_unique').on(
      table.roomId,
      table.actorId,
    ),
    /** One occupant per seat; an unsided seat's null side is one value. */
    unique('room_participants_seat_unique')
      .on(table.roomId, table.seatKind, table.side, table.slot)
      .nullsNotDistinct(),
    index('room_participants_actor_idx').on(table.actorId),
    ...seatChecks('room_participants', table),
    check(
      'room_participants_open_seat_check',
      sql`(${table.seatKind} = 'side' or not (${table.teamOpen} or ${table.positionOpen})) and (not ${table.teamOpen} or ${table.positionOpen})`,
    ),
    check(
      'room_participants_readiness_version_nonnegative',
      sql`${table.readinessVersion} >= 0`,
    ),
  ],
);

/**
 * A seat of one kind kept for a named member until `until`: both debaters of
 * a challenge while either may be on the way (ADR 0103), or the seat a
 * pending Room invitation offers (ADR 0124). It reserves, never seats: the
 * member still takes the seat themselves, and an old row holds nothing.
 */
export const roomSeatHolds = pgTable(
  'room_seat_holds',
  {
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    actorId: text('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    seat: text('seat').$type<SeatKind>().notNull(),
    until: timestampColumn('until').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.actorId] }),
    index('room_seat_holds_actor_idx').on(table.actorId),
    check('room_seat_holds_seat_check', oneOf(table.seat, seatKinds)),
  ],
);

/**
 * One active Room per user, enforced here (ADR 0070, TAB-6): a row names the
 * one Room that seats a human actor while it assembles or its Round is live;
 * the primary key on `actor_id` is the invariant, so a second Room's seat
 * cannot commit. A host who holds no seat is not held. The Room writer keeps
 * the rows equal to the engine's `activeRoomMembers`, and a Round's end
 * releases them. Bots hold no row.
 */
export const activeSeats = pgTable(
  'active_seats',
  {
    actorId: text('actor_id')
      .primaryKey()
      .references(() => actors.id, { onDelete: 'restrict' }),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    createdAt: createdAtColumn(),
  },
  (table) => [index('active_seats_room_idx').on(table.roomId)],
);
