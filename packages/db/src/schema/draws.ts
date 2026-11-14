import { drawMethods, drawStatuses } from '@daisy/protocol/lobby';
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
} from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  jsonbColumn,
  jsonbIsObject,
  jsonObjectSchema,
  oneOf,
  timestampColumn,
} from './columns';
import { tabRounds } from './events';
import { fixtures } from './fixtures';
import { results } from './results';

/**
 * A version of the plan for one tab round: which fixtures it has
 * (`draw_fixtures`), the results it was computed from
 * (`draw_result_inputs`) and `inputs`, the tab engine's record of the
 * resolved settings, seed, digests and any rule the host overrode with its
 * reason. `version` numbers the tab round's versions; it is not an
 * optimistic counter. Once published, a trigger refuses any change to the
 * row or to its two child lists.
 */
export const draws = pgTable(
  'draws',
  {
    id: text('id').primaryKey(),
    lobbyId: text('lobby_id').notNull(),
    eventId: text('event_id').notNull(),
    tabRoundId: text('tab_round_id').notNull(),
    version: integer('version').notNull(),
    status: text('status')
      .$type<(typeof drawStatuses)[number]>()
      .notNull()
      .default('draft'),
    publishedAt: timestampColumn('published_at'),
    basedOnDrawId: text('based_on_draw_id'),
    method: text('method').$type<(typeof drawMethods)[number]>().notNull(),
    engineVersion: text('engine_version'),
    /** Its contract is the tab engine's inputs record, which slice G owns. */
    inputs: jsonbColumn('inputs', jsonObjectSchema).notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('draws_id_tab_round_unique').on(
      table.id,
      table.tabRoundId,
      table.eventId,
      table.lobbyId,
    ),
    unique('draws_version_unique').on(table.tabRoundId, table.version),
    index('draws_tab_round_idx').on(
      table.tabRoundId,
      table.eventId,
      table.lobbyId,
    ),
    index('draws_based_on_idx').on(
      table.basedOnDrawId,
      table.tabRoundId,
      table.eventId,
      table.lobbyId,
    ),
    foreignKey({
      name: 'draws_tab_round_fk',
      columns: [table.tabRoundId, table.eventId, table.lobbyId],
      foreignColumns: [tabRounds.id, tabRounds.eventId, tabRounds.lobbyId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'draws_based_on_fk',
      columns: [
        table.basedOnDrawId,
        table.tabRoundId,
        table.eventId,
        table.lobbyId,
      ],
      foreignColumns: [
        table.id,
        table.tabRoundId,
        table.eventId,
        table.lobbyId,
      ],
    }).onDelete('restrict'),
    check('draws_version_positive', sql`${table.version} > 0`),
    check('draws_status_check', oneOf(table.status, drawStatuses)),
    check('draws_method_check', oneOf(table.method, drawMethods)),
    check(
      'draws_published_consistent',
      sql`(${table.status} = 'published') = (${table.publishedAt} is not null)`,
    ),
    check(
      'draws_engine_when_computed',
      sql`(${table.method} = 'computed') = (${table.engineVersion} is not null)`,
    ),
    jsonbIsObject('draws', table.inputs),
  ],
);

/** The draw a child row belongs to, with the ancestry that proves it. */
const drawChild = () => ({
  drawId: text('draw_id').notNull(),
  tabRoundId: text('tab_round_id').notNull(),
  eventId: text('event_id').notNull(),
  lobbyId: text('lobby_id').notNull(),
});

/**
 * The results of its own event a draw was computed from, so "which
 * published draws used this result" is a join.
 */
export const drawResultInputs = pgTable(
  'draw_result_inputs',
  {
    ...drawChild(),
    resultId: text('result_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.drawId, table.resultId] }),
    index('draw_result_inputs_draw_idx').on(
      table.drawId,
      table.tabRoundId,
      table.eventId,
      table.lobbyId,
    ),
    index('draw_result_inputs_result_idx').on(
      table.resultId,
      table.eventId,
      table.lobbyId,
    ),
    foreignKey({
      name: 'draw_result_inputs_draw_fk',
      columns: [table.drawId, table.tabRoundId, table.eventId, table.lobbyId],
      foreignColumns: [
        draws.id,
        draws.tabRoundId,
        draws.eventId,
        draws.lobbyId,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'draw_result_inputs_result_fk',
      columns: [table.resultId, table.eventId, table.lobbyId],
      foreignColumns: [results.id, results.eventId, results.lobbyId],
    }).onDelete('restrict'),
  ],
);

/**
 * Which fixtures a draw version has, all of its own tab round. A fixture in
 * two versions is one `fixtures` row with two rows here.
 */
export const drawFixtures = pgTable(
  'draw_fixtures',
  {
    ...drawChild(),
    fixtureId: text('fixture_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.drawId, table.fixtureId] }),
    index('draw_fixtures_draw_idx').on(
      table.drawId,
      table.tabRoundId,
      table.eventId,
      table.lobbyId,
    ),
    index('draw_fixtures_fixture_idx').on(
      table.fixtureId,
      table.tabRoundId,
      table.eventId,
      table.lobbyId,
    ),
    foreignKey({
      name: 'draw_fixtures_draw_fk',
      columns: [table.drawId, table.tabRoundId, table.eventId, table.lobbyId],
      foreignColumns: [
        draws.id,
        draws.tabRoundId,
        draws.eventId,
        draws.lobbyId,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'draw_fixtures_fixture_fk',
      columns: [
        table.fixtureId,
        table.tabRoundId,
        table.eventId,
        table.lobbyId,
      ],
      foreignColumns: [
        fixtures.id,
        fixtures.tabRoundId,
        fixtures.eventId,
        fixtures.lobbyId,
      ],
    }).onDelete('restrict'),
  ],
);
