import { fixtureKinds, fixtureStatuses } from '@daisy/protocol/lobby';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  oneOf,
  timestampColumn,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { entries } from './entries';
import { tabRounds } from './events';
import { rooms } from './rooms';
import { tournamentJudges } from './tournament-judges';

/**
 * What is scheduled for one Room in one tab round: a pairing, a section or
 * a bye. It belongs to its tab round for life and is the same row in every
 * draw version that holds it. It is live while `published`. A bye and a
 * draft have no Room; any other fixture has one from the moment it is
 * published, in its own lobby. The fixture points at its Room and nothing
 * on the Room or the Round points back; `room_id` changes only when the
 * fixture's Room is restarted. A trigger lets the status move only from
 * draft to published to withdrawn, fixes the tab round and kind once
 * published, and refuses deleting anything but a draft.
 */
export const fixtures = pgTable(
  'fixtures',
  {
    id: text('id').primaryKey(),
    lobbyId: text('lobby_id').notNull(),
    eventId: text('event_id').notNull(),
    tabRoundId: text('tab_round_id').notNull(),
    kind: text('kind').$type<(typeof fixtureKinds)[number]>().notNull(),
    status: text('status')
      .$type<(typeof fixtureStatuses)[number]>()
      .notNull()
      .default('draft'),
    publishedAt: timestampColumn('published_at'),
    withdrawnAt: timestampColumn('withdrawn_at'),
    roomId: text('room_id'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    unique('fixtures_id_tab_round_unique').on(
      table.id,
      table.tabRoundId,
      table.eventId,
      table.lobbyId,
    ),
    unique('fixtures_id_lobby_unique').on(table.id, table.lobbyId),
    unique('fixtures_id_status_unique').on(table.id, table.status),
    uniqueIndex('fixtures_room_unique').on(table.roomId),
    index('fixtures_tab_round_idx').on(
      table.tabRoundId,
      table.eventId,
      table.lobbyId,
    ),
    index('fixtures_room_lobby_idx').on(table.roomId, table.lobbyId),
    foreignKey({
      name: 'fixtures_tab_round_fk',
      columns: [table.tabRoundId, table.eventId, table.lobbyId],
      foreignColumns: [tabRounds.id, tabRounds.eventId, tabRounds.lobbyId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fixtures_room_fk',
      columns: [table.roomId, table.lobbyId],
      foreignColumns: [rooms.id, rooms.lobbyId],
    }).onDelete('restrict'),
    check('fixtures_kind_check', oneOf(table.kind, fixtureKinds)),
    check('fixtures_status_check', oneOf(table.status, fixtureStatuses)),
    check(
      'fixtures_lifecycle_instants',
      sql`(${table.publishedAt} is not null) = (${table.status} <> 'draft') and (${table.withdrawnAt} is not null) = (${table.status} = 'withdrawn')`,
    ),
    check(
      'fixtures_room_when_published',
      sql`(${table.roomId} is not null) = (${table.status} <> 'draft' and ${table.kind} <> 'bye')`,
    ),
    versionPositive('fixtures', table.version),
  ],
);

/** The fixture a child row belongs to, with the ancestry that proves it. */
const fixtureChild = () => ({
  fixtureId: text('fixture_id').notNull(),
  tabRoundId: text('tab_round_id').notNull(),
  eventId: text('event_id').notNull(),
  lobbyId: text('lobby_id').notNull(),
  /**
   * The fixture's status, kept equal to it by the cascading foreign key and
   * written by nothing else, so "one live fixture per tab round" is an index.
   */
  fixtureStatus: text('fixture_status')
    .$type<(typeof fixtureStatuses)[number]>()
    .notNull()
    .default('draft'),
});

/**
 * Who meets whom: an entry of the fixture's own event, at a position, on a
 * side where the format has sides (the side vocabulary is the format's).
 * Once the fixture is published a trigger refuses inserting, deleting or
 * changing any of this; a different pairing is a new fixture. An entry is
 * in one live fixture per tab round.
 */
export const fixtureEntries = pgTable(
  'fixture_entries',
  {
    ...fixtureChild(),
    entryId: text('entry_id').notNull(),
    position: integer('position').notNull(),
    side: text('side'),
  },
  (table) => [
    primaryKey({ columns: [table.fixtureId, table.entryId] }),
    unique('fixture_entries_position_unique').on(
      table.fixtureId,
      table.position,
    ),
    uniqueIndex('fixture_entries_one_live_per_tab_round')
      .on(table.tabRoundId, table.entryId)
      .where(sql`${table.fixtureStatus} = 'published'`),
    index('fixture_entries_fixture_idx').on(
      table.fixtureId,
      table.tabRoundId,
      table.eventId,
      table.lobbyId,
    ),
    index('fixture_entries_fixture_status_idx').on(
      table.fixtureId,
      table.fixtureStatus,
    ),
    index('fixture_entries_entry_idx').on(
      table.entryId,
      table.eventId,
      table.lobbyId,
    ),
    foreignKey({
      name: 'fixture_entries_fixture_fk',
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
    }),
    foreignKey({
      name: 'fixture_entries_fixture_status_fk',
      columns: [table.fixtureId, table.fixtureStatus],
      foreignColumns: [fixtures.id, fixtures.status],
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      name: 'fixture_entries_entry_fk',
      columns: [table.entryId, table.eventId, table.lobbyId],
      foreignColumns: [entries.id, entries.eventId, entries.lobbyId],
    }).onDelete('restrict'),
    check('fixture_entries_position_nonnegative', sql`${table.position} >= 0`),
    check(
      'fixture_entries_side_nonempty',
      sql`${table.side} is null or length(trim(${table.side})) > 0`,
    ),
  ],
);

/**
 * The panel, which belongs to the fixture and not to a draw. Rows are
 * inserted and deleted by the judge commands before and after publishing;
 * none makes a draw version. A judge is in one live fixture per tab round.
 */
export const fixtureJudges = pgTable(
  'fixture_judges',
  {
    ...fixtureChild(),
    tournamentJudgeId: text('tournament_judge_id').notNull(),
    /**
     * Whether this judge chairs the panel: at most one per fixture. Whether
     * a fixture needs a chair, and who may be one, is the command's rule
     * under the `judging.chair` setting.
     */
    chair: boolean('chair').notNull().default(false),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.fixtureId, table.tournamentJudgeId] }),
    uniqueIndex('fixture_judges_one_chair')
      .on(table.fixtureId)
      .where(sql`${table.chair}`),
    uniqueIndex('fixture_judges_one_live_per_tab_round')
      .on(table.tabRoundId, table.tournamentJudgeId)
      .where(sql`${table.fixtureStatus} = 'published'`),
    index('fixture_judges_fixture_idx').on(
      table.fixtureId,
      table.tabRoundId,
      table.eventId,
      table.lobbyId,
    ),
    index('fixture_judges_fixture_status_idx').on(
      table.fixtureId,
      table.fixtureStatus,
    ),
    index('fixture_judges_judge_idx').on(
      table.tournamentJudgeId,
      table.lobbyId,
    ),
    foreignKey({
      name: 'fixture_judges_fixture_fk',
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
    }),
    foreignKey({
      name: 'fixture_judges_fixture_status_fk',
      columns: [table.fixtureId, table.fixtureStatus],
      foreignColumns: [fixtures.id, fixtures.status],
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      name: 'fixture_judges_judge_fk',
      columns: [table.tournamentJudgeId, table.lobbyId],
      foreignColumns: [tournamentJudges.id, tournamentJudges.lobbyId],
    }).onDelete('restrict'),
  ],
);
