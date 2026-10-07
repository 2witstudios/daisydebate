import {
  competitionTypes,
  debateRoles,
  roomConfigSchema,
  roomExecutionPlanSchema,
  roundLengthSchema,
  roundRulesSchema,
  type CompetitionType,
  type RoundLength,
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
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  jsonbColumn,
  jsonbIsObject,
  oneOf,
  timestampColumn,
  updatedAtColumn,
} from './columns';
import { formatPresets } from './format-presets';
import { formatRevisions } from './format-revisions';
import { seatActorId, seatRole, seatSlot, seatSlotCheck } from './seats';
import { formats } from './formats';

/** The Room's assembly lifecycle, before and after its freeze. */
export const roomStatuses = [
  'assembling',
  'ready',
  'started',
  'abandoned',
] as const;

/**
 * The durable pre-competition aggregate (ADR 0058 §5a). The Room holds its
 * whole configuration surface, the versions it pinned at resolution, the
 * already-resolved rules the startRound freeze copies, and its own
 * pre-round prep anchor — a running clock with no row behind it, the same
 * reason a Round holds `active_prep`. Persisting it does not make it
 * competitive state: no Round reads a Room, no rating depends on one, and
 * nothing in a Round's history would change if Rooms were deleted.
 */
export const rooms = pgTable(
  'rooms',
  {
    id: text('id').primaryKey(),
    formatId: text('format_id')
      .notNull()
      .references(() => formats.id, { onDelete: 'restrict' }),
    formatVersion: integer('format_version').notNull(),
    /** Ranked only; the equivalence holds as on rounds. */
    presetVersion: integer('preset_version'),
    competitionType: text('competition_type')
      .$type<CompetitionType>()
      .notNull(),
    length: text('length').$type<RoundLength>().notNull(),
    /** RoomConfig as chosen. */
    config: jsonbColumn('config', roomConfigSchema).notNull(),
    /** RoomExecutionPlan, resolved. */
    executionPlan: jsonbColumn(
      'execution_plan',
      roomExecutionPlanSchema,
    ).notNull(),
    /** RoundRules, resolved and frozen here. */
    rulesSnapshot: jsonbColumn('rules_snapshot', roundRulesSchema).notNull(),
    /** The pre-round prep clock anchor. */
    prepStartedAt: timestampColumn('prep_started_at'),
    /** Survives a crash mid-prep. */
    prepRemainingMs: integer('prep_remaining_ms'),
    status: text('status').$type<(typeof roomStatuses)[number]>().notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique('rooms_id_format_unique').on(table.id, table.formatId),
    // Leading with each foreign key's own columns, so the provenance joins
    // and the RESTRICT probes are index lookups rather than scans.
    index('rooms_definition_revision_idx').on(
      table.formatId,
      table.formatVersion,
    ),
    index('rooms_preset_version_idx').on(
      table.formatId,
      table.length,
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
    check('rooms_status_check', oneOf(table.status, roomStatuses)),
    check(
      'rooms_competition_type_check',
      oneOf(table.competitionType, competitionTypes),
    ),
    check('rooms_length_check', oneOf(table.length, roundLengthSchema.options)),
    check(
      'rooms_ranked_has_preset_check',
      sql`(${table.competitionType} = 'ranked') = (${table.presetVersion} is not null)`,
    ),
    jsonbIsObject('rooms', table.config),
    jsonbIsObject('rooms', table.executionPlan),
    jsonbIsObject('rooms', table.rulesSnapshot),
  ],
);

/**
 * A seat during Room assembly, before any Round exists (ADR 0058 §5a).
 * The same terms as a Round's seat: an id, an actor, a role and a slot.
 */
export const roomParticipants = pgTable(
  'room_participants',
  {
    id: text('id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    actorId: seatActorId(),
    role: seatRole(),
    slot: seatSlot(),
  },
  (table) => [
    uniqueIndex('room_participants_actor_unique').on(
      table.roomId,
      table.actorId,
    ),
    uniqueIndex('room_participants_seat_unique').on(
      table.roomId,
      table.role,
      table.slot,
    ),
    index('room_participants_actor_idx').on(table.actorId),
    check('room_participants_role_check', oneOf(table.role, debateRoles)),
    check('room_participants_slot_check', seatSlotCheck(table.slot)),
  ],
);
