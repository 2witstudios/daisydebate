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
  createdAtColumn,
  oneOf,
  timestampColumn,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { debateParticipants } from './debate-participants';
import { debates } from './debates';
import { formats } from './formats';

export const seasonStatuses = ['scheduled', 'active', 'closed'] as const;

/**
 * Strictly positive and finite. PostgreSQL orders NaN and +infinity above
 * every number, so `> 0` alone would let an unstable calculation poison the
 * ledger for good.
 */
const positiveFinite = (column: PgColumn) =>
  sql`${column} > 0 and ${column} < 'infinity'::double precision`;

/** The rating band both the projection and its ledger rows must stay inside. */
const ratingBand = (column: PgColumn) => sql`${column} between 0 and 4000`;

export const seasons = pgTable(
  'seasons',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    startsAt: timestampColumn('starts_at').notNull(),
    endsAt: timestampColumn('ends_at'),
    status: text('status').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    /** At most one active season. */
    uniqueIndex('seasons_single_active')
      .on(table.status)
      .where(sql`${table.status} = 'active'`),
    check('seasons_status_check', oneOf(table.status, seasonStatuses)),
    versionPositive('seasons', table.version),
  ],
);

/** The key every rating row shares; builders are single-use, hence a factory. */
const ratingScope = () => ({
  actorId: text('actor_id')
    .notNull()
    .references(() => actors.id, { onDelete: 'restrict' }),
  formatId: text('format_id')
    .notNull()
    .references(() => formats.id, { onDelete: 'restrict' }),
  seasonId: text('season_id')
    .notNull()
    .references(() => seasons.id, { onDelete: 'restrict' }),
});

/**
 * Current Glicko-2 state per actor, format and season: a projection of
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
    primaryKey({ columns: [table.actorId, table.formatId, table.seasonId] }),
    index('ratings_leaderboard_idx').on(
      table.formatId,
      table.seasonId,
      table.rating.desc(),
    ),
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
    debateId: text('debate_id')
      .notNull()
      .references(() => debates.id, { onDelete: 'restrict' }),
    ...ratingScope(),
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
    /** Only a seat holder in that debate can be rated for it. */
    foreignKey({
      name: 'rating_changes_participant_fk',
      columns: [table.debateId, table.actorId],
      foreignColumns: [debateParticipants.debateId, debateParticipants.actorId],
    }).onDelete('restrict'),
    /** The change is posted to the debate's own format, never another. */
    foreignKey({
      name: 'rating_changes_debate_format_fk',
      columns: [table.debateId, table.formatId],
      foreignColumns: [debates.id, debates.format],
    }).onDelete('restrict'),
    uniqueIndex('rating_changes_debate_actor_unique').on(
      table.debateId,
      table.actorId,
    ),
    index('rating_changes_actor_format_occurred_idx').on(
      table.actorId,
      table.formatId,
      table.occurredAt,
    ),
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
