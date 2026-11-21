import { sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import {
  check,
  doublePrecision,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { actors } from './actors';
import {
  timestampColumn,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { formats } from './formats';
import { ladders } from './ladders';
import { roundParticipants } from './round-participants';
import { rounds } from './rounds';
import { seasons } from './seasons';

/**
 * Strictly positive and finite. PostgreSQL orders NaN and +infinity above
 * every number, so `> 0` alone would let an unstable calculation poison the
 * ledger for good.
 */
const positiveFinite = (column: PgColumn) =>
  sql`${column} > 0 and ${column} < 'infinity'::double precision`;

/** The rating band both the projection and its ledger rows must stay inside. */
const ratingBand = (column: PgColumn) => sql`${column} between 0 and 4000`;

/** The key every rating row shares; builders are single-use, hence a factory. */
const ratingScope = () => ({
  actorId: text('actor_id')
    .notNull()
    .references(() => actors.id, { onDelete: 'restrict' }),
  seasonId: text('season_id').notNull(),
  ladder: text('ladder').notNull(),
  lobbyId: text('lobby_id').notNull(),
});

const ratingPool = (
  name: string,
  table: { seasonId: PgColumn; ladder: PgColumn; lobbyId: PgColumn },
) => [
  index(`${name}_season_lobby_idx`).on(table.seasonId, table.lobbyId),
  index(`${name}_ladder_lobby_idx`).on(table.ladder, table.lobbyId),
  foreignKey({
    name: `${name}_season_lobby_fk`,
    columns: [table.seasonId, table.lobbyId],
    foreignColumns: [seasons.id, seasons.lobbyId],
  }).onDelete('restrict'),
  foreignKey({
    name: `${name}_ladder_lobby_fk`,
    columns: [table.ladder, table.lobbyId],
    foreignColumns: [ladders.id, ladders.lobbyId],
  }).onDelete('restrict'),
];

/**
 * Current Glicko-2 state per actor, ladder and season: a projection of
 * `rating_changes`, written in the same transaction. Provisional status,
 * tier, games played, peak and last-rated time are derived, never stored.
 */
export const ratings = pgTable(
  'ratings',
  {
    ...ratingScope(),
    rating: doublePrecision('rating').notNull(),
    deviation: doublePrecision('deviation').notNull(),
    volatility: doublePrecision('volatility').notNull(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    primaryKey({
      columns: [table.actorId, table.ladder, table.seasonId],
    }),
    index('ratings_leaderboard_idx').on(
      table.seasonId,
      table.ladder,
      table.rating.desc(),
    ),
    ...ratingPool('ratings', table),
    check('ratings_rating_range', ratingBand(table.rating)),
    check('ratings_deviation_positive', positiveFinite(table.deviation)),
    check('ratings_volatility_positive', positiveFinite(table.volatility)),
    versionPositive('ratings', table.version),
  ],
);

/**
 * Append-only ledger. One rated debate is one Glicko-2 rating period per
 * actor (ADR 0029); `calculation_version` names the formula that produced
 * the row so a later change never rewrites history. Composite keys tie each
 * row to a participant of the debate and to the debate's format.
 */
export const ratingChanges = pgTable(
  'rating_changes',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'restrict' }),
    ...ratingScope(),
    formatId: text('format_id')
      .notNull()
      .references(() => formats.id, { onDelete: 'restrict' }),
    ratingBefore: doublePrecision('rating_before').notNull(),
    ratingAfter: doublePrecision('rating_after').notNull(),
    deviationBefore: doublePrecision('deviation_before').notNull(),
    deviationAfter: doublePrecision('deviation_after').notNull(),
    volatilityBefore: doublePrecision('volatility_before').notNull(),
    volatilityAfter: doublePrecision('volatility_after').notNull(),
    calculationVersion: text('calculation_version').notNull(),
    occurredAt: timestampColumn('occurred_at').notNull(),
  },
  (table) => [
    /** Only a seat holder in that round can be rated for it. */
    foreignKey({
      name: 'rating_changes_participant_fk',
      columns: [table.roundId, table.actorId],
      foreignColumns: [
        roundParticipants.roundId,
        roundParticipants.ratingActorId,
      ],
    }).onDelete('restrict'),
    ...ratingPool('rating_changes', table),
    index('rating_changes_round_pool_idx').on(
      table.roundId,
      table.ladder,
      table.seasonId,
    ),
    foreignKey({
      name: 'rating_changes_round_pool_fk',
      columns: [table.roundId, table.ladder, table.seasonId],
      foreignColumns: [rounds.id, rounds.ladderId, rounds.seasonId],
    }).onDelete('restrict'),
    /** The change is posted to the round's own format, never another. */
    foreignKey({
      name: 'rating_changes_round_format_fk',
      columns: [table.roundId, table.formatId],
      foreignColumns: [rounds.id, rounds.formatId],
    }).onDelete('restrict'),
    uniqueIndex('rating_changes_round_actor_unique').on(
      table.roundId,
      table.actorId,
    ),
    index('rating_changes_actor_format_occurred_idx').on(
      table.actorId,
      table.formatId,
      table.ladder,
      table.occurredAt,
    ),
    index('rating_changes_round_format_idx').on(table.roundId, table.formatId),
    index('rating_changes_format_idx').on(table.formatId),
    check(
      'rating_changes_rating_range',
      sql`${ratingBand(table.ratingBefore)} and ${ratingBand(table.ratingAfter)}`,
    ),
    check(
      'rating_changes_deviation_positive',
      sql`${positiveFinite(table.deviationBefore)} and ${positiveFinite(table.deviationAfter)}`,
    ),
    check(
      'rating_changes_volatility_positive',
      sql`${positiveFinite(table.volatilityBefore)} and ${positiveFinite(table.volatilityAfter)}`,
    ),
  ],
);
