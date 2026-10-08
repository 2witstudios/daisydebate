import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { oneOf, timestampColumn } from './columns';
import { actors } from './actors';
import { rounds } from './rounds';

/** The reservation kinds, until a second billable surface arrives. */
export const usageReservationKinds = ['ai_practice'] as const;

/**
 * Entitlement accounting, kept off the kernel (ADR 0058 §8): one row per
 * actor, round and kind answers "when did this member begin consuming an
 * AI-practice allowance?" — a question a human-human, ranked or tournament
 * round has no use for. `counted_at` is null until the first billable call.
 */
export const usageReservations = pgTable(
  'usage_reservations',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'restrict' }),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    countedAt: timestampColumn('counted_at'),
  },
  (table) => [
    uniqueIndex('usage_reservations_actor_round_kind_unique').on(
      table.actorId,
      table.roundId,
      table.kind,
    ),
    index('usage_reservations_counted_idx').on(table.countedAt),
    index('usage_reservations_round_idx').on(table.roundId),
    check(
      'usage_reservations_kind_check',
      oneOf(table.kind, usageReservationKinds),
    ),
  ],
);
