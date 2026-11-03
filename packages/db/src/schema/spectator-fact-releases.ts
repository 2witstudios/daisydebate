import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { oneOf, timestampColumn } from './columns';
import { rounds } from './rounds';

export const spectatorFactKinds = [
  'stage',
  'result',
  'ballot',
  'rating',
  'caption',
] as const;

/**
 * Why a fact left. `watermark`: released media passed it. `clock_fallback`: a
 * ranked Round with no Broadcast, at completion plus the ranked delay.
 * `broadcast_ended`: a stopped or finished Broadcast, by its policy.
 * `no_broadcast`: a casual Round with no audience delay to keep.
 */
export const spectatorReleaseBases = [
  'watermark',
  'clock_fallback',
  'broadcast_ended',
  'no_broadcast',
] as const;

/**
 * Append-only: what was public about a Round and when, so it can be audited
 * (BCAST-5). One row per fact, written when the timeline first passed it and
 * never changed; a trigger refuses any update, and any delete except with the
 * Round's own erasure. `watermarkAt` is null when no watermark released it.
 */
export const spectatorFactReleases = pgTable(
  'spectator_fact_releases',
  {
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<(typeof spectatorFactKinds)[number]>().notNull(),
    /** The fact's own row: the Round for a result, else the segment, ballot, posting or line. */
    factId: text('fact_id').notNull(),
    capturedAt: timestampColumn('captured_at').notNull(),
    releasedAt: timestampColumn('released_at').notNull(),
    watermarkAt: timestampColumn('watermark_at'),
    basis: text('basis')
      .$type<(typeof spectatorReleaseBases)[number]>()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roundId, table.kind, table.factId] }),
    index('spectator_fact_releases_round_idx').on(
      table.roundId,
      table.releasedAt,
    ),
    check(
      'spectator_fact_releases_kind_check',
      oneOf(table.kind, spectatorFactKinds),
    ),
    check(
      'spectator_fact_releases_basis_check',
      oneOf(table.basis, spectatorReleaseBases),
    ),
    check(
      'spectator_fact_releases_after_capture_check',
      sql`${table.releasedAt} >= ${table.capturedAt}`,
    ),
  ],
);
