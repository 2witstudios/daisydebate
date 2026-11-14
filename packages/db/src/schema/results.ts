import {
  administrativeResultReasons,
  resultKinds,
} from '@daisy/protocol/lobby';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { actors } from './actors';
import { oneOf, timestampColumn } from './columns';
import { fixtureEntries, fixtures } from './fixtures';
import { actionHistory } from './grants';
import { rounds } from './rounds';
import { constantText } from './tenant-keys';

/**
 * The outcome of a fixture: `decided` from its panel's ballots, or
 * `administrative`, entered by tab. A correction is a result that
 * supersedes an earlier one of the same fixture, with a reason; the earlier
 * row stays. One original per fixture and at most one correction of any
 * result, so a fixture's history is a line. A result is recorded only on a
 * live fixture, and the same key means a fixture with a result cannot be
 * withdrawn. Append-only: the runtime role holds no UPDATE or DELETE and a
 * trigger refuses both. `round_id` is the only path from the tab record to
 * a Round; standings read `result_entries` and `result_speakers`, never it.
 */
export const results = pgTable(
  'results',
  {
    id: text('id').primaryKey(),
    lobbyId: text('lobby_id').notNull(),
    eventId: text('event_id').notNull(),
    tabRoundId: text('tab_round_id').notNull(),
    fixtureId: text('fixture_id').notNull(),
    fixtureStatus: constantText('fixture_status', 'published'),
    kind: text('kind').$type<(typeof resultKinds)[number]>().notNull(),
    administrativeReason: text('administrative_reason').$type<
      (typeof administrativeResultReasons)[number]
    >(),
    roundId: text('round_id').references(() => rounds.id, {
      onDelete: 'restrict',
    }),
    supersedesResultId: text('supersedes_result_id'),
    correctionReason: text('correction_reason'),
    commandId: text('command_id').notNull(),
    recordedAt: timestampColumn('recorded_at').notNull(),
  },
  (table) => [
    unique('results_id_fixture_unique').on(
      table.id,
      table.fixtureId,
      table.lobbyId,
    ),
    unique('results_id_event_unique').on(
      table.id,
      table.eventId,
      table.lobbyId,
    ),
    unique('results_superseded_once').on(table.supersedesResultId),
    uniqueIndex('results_one_original_per_fixture')
      .on(table.fixtureId)
      .where(sql`${table.supersedesResultId} is null`),
    index('results_fixture_idx').on(
      table.fixtureId,
      table.tabRoundId,
      table.eventId,
      table.lobbyId,
    ),
    index('results_fixture_status_idx').on(
      table.fixtureId,
      table.fixtureStatus,
    ),
    index('results_round_idx').on(table.roundId),
    index('results_supersedes_idx').on(
      table.supersedesResultId,
      table.fixtureId,
      table.lobbyId,
    ),
    index('results_command_idx').on(table.commandId, table.lobbyId),
    index('results_event_idx').on(table.eventId, table.recordedAt),
    foreignKey({
      name: 'results_fixture_fk',
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
    foreignKey({
      name: 'results_live_fixture_fk',
      columns: [table.fixtureId, table.fixtureStatus],
      foreignColumns: [fixtures.id, fixtures.status],
    }),
    foreignKey({
      name: 'results_supersedes_fk',
      columns: [table.supersedesResultId, table.fixtureId, table.lobbyId],
      foreignColumns: [table.id, table.fixtureId, table.lobbyId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'results_command_fk',
      columns: [table.commandId, table.lobbyId],
      foreignColumns: [actionHistory.commandId, actionHistory.lobbyId],
    }).onDelete('restrict'),
    check('results_kind_check', oneOf(table.kind, resultKinds)),
    check(
      'results_administrative_reason_check',
      sql`case when ${table.kind} = 'administrative'
        then ${table.administrativeReason} is not null and ${oneOf(table.administrativeReason, administrativeResultReasons)}
        else ${table.administrativeReason} is null end`,
    ),
    check(
      'results_decided_has_round',
      sql`${table.kind} <> 'decided' or ${table.roundId} is not null`,
    ),
    check(
      'results_correction_has_reason',
      sql`case when ${table.supersedesResultId} is null
        then ${table.correctionReason} is null
        else ${table.correctionReason} is not null and length(trim(${table.correctionReason})) > 0 end`,
    ),
    check(
      'results_not_its_own_correction',
      sql`${table.supersedesResultId} is distinct from ${table.id}`,
    ),
  ],
);

/**
 * What a result gave each entry of its fixture: a win or loss, a rank, the
 * ballots won. With `result_speakers` these are every input standings need.
 * Append-only with its result.
 */
export const resultEntries = pgTable(
  'result_entries',
  {
    resultId: text('result_id').notNull(),
    entryId: text('entry_id').notNull(),
    fixtureId: text('fixture_id').notNull(),
    lobbyId: text('lobby_id').notNull(),
    won: boolean('won'),
    rank: integer('rank'),
    ballotsWon: integer('ballots_won'),
  },
  (table) => [
    primaryKey({ columns: [table.resultId, table.entryId] }),
    unique('result_entries_result_entry_lobby_unique').on(
      table.resultId,
      table.entryId,
      table.lobbyId,
    ),
    index('result_entries_result_idx').on(
      table.resultId,
      table.fixtureId,
      table.lobbyId,
    ),
    index('result_entries_fixture_entry_idx').on(
      table.fixtureId,
      table.entryId,
    ),
    foreignKey({
      name: 'result_entries_result_fk',
      columns: [table.resultId, table.fixtureId, table.lobbyId],
      foreignColumns: [results.id, results.fixtureId, results.lobbyId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'result_entries_fixture_entry_fk',
      columns: [table.fixtureId, table.entryId],
      foreignColumns: [fixtureEntries.fixtureId, fixtureEntries.entryId],
    }).onDelete('restrict'),
    check(
      'result_entries_rank_positive',
      sql`${table.rank} is null or ${table.rank} > 0`,
    ),
    check(
      'result_entries_ballots_won_nonnegative',
      sql`${table.ballotsWon} is null or ${table.ballotsWon} >= 0`,
    ),
  ],
);

/**
 * What a result gave each speaker of one of its entries: points and a rank.
 * Append-only with its result.
 */
export const resultSpeakers = pgTable(
  'result_speakers',
  {
    resultId: text('result_id').notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'restrict' }),
    entryId: text('entry_id').notNull(),
    lobbyId: text('lobby_id').notNull(),
    points: numeric('points'),
    rank: integer('rank'),
  },
  (table) => [
    primaryKey({ columns: [table.resultId, table.actorId] }),
    index('result_speakers_result_entry_idx').on(
      table.resultId,
      table.entryId,
      table.lobbyId,
    ),
    index('result_speakers_actor_idx').on(table.actorId),
    foreignKey({
      name: 'result_speakers_result_entry_fk',
      columns: [table.resultId, table.entryId, table.lobbyId],
      foreignColumns: [
        resultEntries.resultId,
        resultEntries.entryId,
        resultEntries.lobbyId,
      ],
    }).onDelete('restrict'),
    check(
      'result_speakers_points_nonnegative',
      sql`${table.points} is null or ${table.points} >= 0`,
    ),
    check(
      'result_speakers_rank_positive',
      sql`${table.rank} is null or ${table.rank} > 0`,
    ),
  ],
);
