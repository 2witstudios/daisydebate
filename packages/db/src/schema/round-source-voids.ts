import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text } from 'drizzle-orm/pg-core';
import { timestampColumn } from './columns';
import { roundCommands } from './round-commands';
import { rounds } from './rounds';

/** Competitive source invalidation is separate from the Round's immutable historical ending. */
export const roundSourceVoids = pgTable(
  'round_source_voids',
  {
    roundId: text('round_id')
      .primaryKey()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    commandId: text('command_id').notNull(),
    recordedAt: timestampColumn('recorded_at').notNull(),
  },
  (table) => [
    index('round_source_voids_command_idx').on(table.commandId, table.roundId),
    check('round_source_voids_time_check', sql`isfinite(${table.recordedAt})`),
    foreignKey({
      name: 'round_source_voids_command_fk',
      columns: [table.commandId, table.roundId],
      foreignColumns: [roundCommands.commandId, roundCommands.roundId],
    }),
  ],
);
