import { sql } from 'drizzle-orm';
import { check, pgTable, text } from 'drizzle-orm/pg-core';
import { rounds } from './rounds';

/**
 * The Round's one seed, minted at Start round: secret, immutable, never
 * deleted. Both the seat draw (ADR 0143) and the resolution draw (ADR 0076)
 * read their own domain-separated streams from it.
 */
export const roundDrawSeeds = pgTable(
  'round_draw_seeds',
  {
    roundId: text('round_id')
      .primaryKey()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    seed: text('seed').notNull(),
  },
  (table) => [
    check('round_draw_seeds_seed_hex', sql`${table.seed} ~ '^[0-9a-f]{64}$'`),
  ],
);
