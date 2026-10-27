import {
  drawPrivateInputsSchema,
  resolutionCategories,
  resolutionDrawManifestSchema,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  type PgColumn,
} from 'drizzle-orm/pg-core';
import { jsonbColumn, jsonbIsObject, oneOf, timestampColumn } from './columns';
import { actors } from './actors';
import { rooms } from './rooms';
import { rounds } from './rounds';

const hex64 = (column: PgColumn) => sql`${column} ~ '^[0-9a-f]{64}$'`;

/**
 * Curated resolution bank revisions (FMT-7). Published append-only by one
 * operation; a revision is never rewritten or backdated.
 */
export const resolutionBankRevisions = pgTable('resolution_bank_revisions', {
  revision: integer('revision').primaryKey(),
  note: text('note').notNull(),
  publishedAt: timestampColumn('published_at').notNull().defaultNow(),
});

/**
 * One curated resolution. Every field a draw filters on is immutable; the
 * one permitted change is its one-way retirement at a later revision.
 */
export const resolutionBankEntries = pgTable(
  'resolution_bank_entries',
  {
    id: text('id').primaryKey(),
    text: text('text').notNull(),
    category: text('category')
      .$type<(typeof resolutionCategories)[number]>()
      .notNull(),
    difficulty: text('difficulty')
      .$type<'intro' | 'standard' | 'advanced'>()
      .notNull(),
    locale: text('locale').notNull(),
    provenance: text('provenance').notNull(),
    addedInRevision: integer('added_in_revision')
      .notNull()
      .references(() => resolutionBankRevisions.revision, {
        onDelete: 'restrict',
      }),
    retiredInRevision: integer('retired_in_revision').references(
      () => resolutionBankRevisions.revision,
      { onDelete: 'restrict' },
    ),
  },
  (table) => [
    check(
      'resolution_bank_entries_category_check',
      oneOf(table.category, resolutionCategories),
    ),
    check(
      'resolution_bank_entries_difficulty_check',
      oneOf(table.difficulty, ['intro', 'standard', 'advanced']),
    ),
    check(
      'resolution_bank_entries_text_check',
      sql`length(trim(${table.text})) between 1 and 300`,
    ),
    check(
      'resolution_bank_entries_retired_after_added',
      sql`${table.retiredInRevision} is null or ${table.retiredInRevision} > ${table.addedInRevision}`,
    ),
  ],
);

/**
 * A Room's one draw (assembly state, written only by the Room writer).
 * `source_kind` and `draw_size` are denormalized so children can key on
 * them; the row is never updated.
 */
export const roomResolutionDraws = pgTable(
  'room_resolution_draws',
  {
    id: text('id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .unique()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    sourceKind: text('source_kind').$type<'bank' | 'host'>().notNull(),
    drawSize: integer('draw_size').notNull(),
    manifest: jsonbColumn('manifest', resolutionDrawManifestSchema).notNull(),
    manifestDigest: text('manifest_digest').notNull(),
    commitment: text('commitment').notNull(),
    /** Secret: never delivered. 32 bytes, lowercase hex. */
    seed: text('seed').notNull(),
    startedAt: timestampColumn('started_at').notNull(),
  },
  (table) => [
    unique('room_resolution_draws_kind_unique').on(table.id, table.sourceKind),
    unique('room_resolution_draws_size_unique').on(table.id, table.drawSize),
    check(
      'room_resolution_draws_source_kind_check',
      oneOf(table.sourceKind, ['bank', 'host']),
    ),
    check(
      'room_resolution_draws_manifest_match',
      sql`${table.manifest}->'source'->>'kind' = ${table.sourceKind} and (${table.manifest}->>'drawSize')::int = ${table.drawSize}`,
    ),
    check(
      'room_resolution_draws_size_check',
      sql`${table.drawSize} between 2 and 20`,
    ),
    check('room_resolution_draws_seed_hex', hex64(table.seed)),
    check('room_resolution_draws_digest_hex', hex64(table.manifestDigest)),
    check('room_resolution_draws_commitment_hex', hex64(table.commitment)),
    jsonbIsObject('room_resolution_draws', table.manifest),
  ],
);

/** The draw's private inputs, durable before Launch; erasable. */
export const roomResolutionDrawInputs = pgTable(
  'room_resolution_draw_inputs',
  {
    drawId: text('draw_id')
      .primaryKey()
      .references(() => roomResolutionDraws.id, { onDelete: 'cascade' }),
    inputs: jsonbColumn('inputs', drawPrivateInputsSchema).notNull(),
  },
  (table) => [jsonbIsObject('room_resolution_draw_inputs', table.inputs)],
);

export const roomResolutionDrawItems = pgTable(
  'room_resolution_draw_items',
  {
    drawId: text('draw_id').notNull(),
    position: integer('position').notNull(),
    sourceKind: text('source_kind').$type<'bank' | 'host'>().notNull(),
    drawSize: integer('draw_size').notNull(),
    candidateId: text('candidate_id').notNull(),
    bankEntryId: text('bank_entry_id').references(
      () => resolutionBankEntries.id,
      { onDelete: 'restrict' },
    ),
    text: text('text').notNull(),
    category: text('category').$type<(typeof resolutionCategories)[number]>(),
  },
  (table) => [
    primaryKey({ columns: [table.drawId, table.position] }),
    foreignKey({
      name: 'room_resolution_draw_items_kind_fk',
      columns: [table.drawId, table.sourceKind],
      foreignColumns: [roomResolutionDraws.id, roomResolutionDraws.sourceKind],
    }).onDelete('cascade'),
    foreignKey({
      name: 'room_resolution_draw_items_size_fk',
      columns: [table.drawId, table.drawSize],
      foreignColumns: [roomResolutionDraws.id, roomResolutionDraws.drawSize],
    }).onDelete('cascade'),
    check(
      'room_resolution_draw_items_bank_entry_check',
      sql`(${table.sourceKind} = 'bank') = (${table.bankEntryId} is not null)`,
    ),
    check(
      'room_resolution_draw_items_position_check',
      sql`${table.position} >= 0 and ${table.position} < ${table.drawSize}`,
    ),
  ],
);

export const roomResolutionStrikes = pgTable(
  'room_resolution_strikes',
  {
    drawId: text('draw_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    position: integer('position').notNull(),
    drawSize: integer('draw_size').notNull(),
    side: text('side').$type<'affirmative' | 'negative'>().notNull(),
    kind: text('kind').$type<'debater' | 'timeout' | 'automatic'>().notNull(),
    actorId: text('actor_id').references(() => actors.id, {
      onDelete: 'restrict',
    }),
    commandId: text('command_id'),
    struckAt: timestampColumn('struck_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.drawId, table.ordinal] }),
    unique('room_resolution_strikes_position_unique').on(
      table.drawId,
      table.position,
    ),
    foreignKey({
      name: 'room_resolution_strikes_item_fk',
      columns: [table.drawId, table.position],
      foreignColumns: [
        roomResolutionDrawItems.drawId,
        roomResolutionDrawItems.position,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'room_resolution_strikes_size_fk',
      columns: [table.drawId, table.drawSize],
      foreignColumns: [roomResolutionDraws.id, roomResolutionDraws.drawSize],
    }).onDelete('cascade'),
    check(
      'room_resolution_strikes_ordinal_check',
      sql`${table.ordinal} >= 0 and ${table.ordinal} < ${table.drawSize} - 1`,
    ),
    check(
      'room_resolution_strikes_side_check',
      oneOf(table.side, ['affirmative', 'negative']),
    ),
    check(
      'room_resolution_strikes_kind_check',
      oneOf(table.kind, ['debater', 'timeout', 'automatic']),
    ),
    check(
      'room_resolution_strikes_debater_check',
      sql`(${table.kind} = 'debater') = (${table.actorId} is not null and ${table.commandId} is not null)`,
    ),
  ],
);

/** The Round's draw seed: secret, immutable, never deleted. */
export const roundDrawSeeds = pgTable(
  'round_draw_seeds',
  {
    roundId: text('round_id')
      .primaryKey()
      .references(() => rounds.id, { onDelete: 'restrict' }),
    seed: text('seed').notNull(),
  },
  (table) => [check('round_draw_seeds_seed_hex', hex64(table.seed))],
);

/** The drawn texts frozen at Launch; never updated, deleted only by erasure. */
export const roundResolutionDrawTexts = pgTable(
  'round_resolution_draw_texts',
  {
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    text: text('text').notNull(),
  },
  (table) => [primaryKey({ columns: [table.roundId, table.position] })],
);

/** The draw's private inputs frozen at Launch; never updated, deleted only by erasure. */
export const roundDrawPrivateInputs = pgTable(
  'round_draw_private_inputs',
  {
    roundId: text('round_id')
      .primaryKey()
      .references(() => rounds.id, { onDelete: 'restrict' }),
    inputs: jsonbColumn('inputs', drawPrivateInputsSchema).notNull(),
  },
  (table) => [jsonbIsObject('round_draw_private_inputs', table.inputs)],
);
