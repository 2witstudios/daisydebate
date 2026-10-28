import { sql } from 'drizzle-orm';
import {
  foreignKey,
  integer,
  pgTable,
  text,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { rounds } from './rounds';
import { roundCommands } from './round-commands';
import { roundTranscriptFreezes } from './round-transcript-freezes';
import { ballots } from './ballots';

/** Provenance of the first terminal transition; the outcome belongs only to Round. */
export const roundFinalizations = pgTable(
  'round_finalizations',
  {
    roundId: text('round_id')
      .primaryKey()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    commandId: text('command_id').notNull(),
    resultingVersion: integer('resulting_version').notNull(),
    freezeRevision: integer('freeze_revision'),
  },
  (table) => [
    uniqueIndex('round_finalizations_round_freeze').on(
      table.roundId,
      table.freezeRevision,
    ),
    index('round_finalizations_command_idx').on(
      table.commandId,
      table.roundId,
      table.resultingVersion,
    ),
    check(
      'round_finalizations_version_positive',
      sql`${table.resultingVersion} > 0`,
    ),
    foreignKey({
      name: 'round_finalizations_command_fk',
      columns: [table.commandId, table.roundId, table.resultingVersion],
      foreignColumns: [
        roundCommands.commandId,
        roundCommands.roundId,
        roundCommands.resultingVersion,
      ],
    }),
    foreignKey({
      name: 'round_finalizations_freeze_fk',
      columns: [table.roundId, table.freezeRevision],
      foreignColumns: [
        roundTranscriptFreezes.roundId,
        roundTranscriptFreezes.revision,
      ],
    }),
  ],
);

/** Exact ballot membership at finalization; subsequent ballot state never reselects it. */
export const roundFinalizationBallots = pgTable(
  'round_finalization_ballots',
  {
    ballotId: text('ballot_id')
      .primaryKey()
      .references(() => ballots.id, { onDelete: 'no action' }),
    roundId: text('round_id').notNull(),
    freezeRevision: integer('freeze_revision').notNull(),
  },
  (table) => [
    index('round_finalization_ballots_round_idx').on(
      table.roundId,
      table.freezeRevision,
    ),
    foreignKey({
      name: 'round_finalization_ballots_input_fk',
      columns: [table.roundId, table.freezeRevision],
      foreignColumns: [
        roundFinalizations.roundId,
        roundFinalizations.freezeRevision,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'round_finalization_ballots_membership_fk',
      columns: [table.ballotId, table.roundId, table.freezeRevision],
      foreignColumns: [ballots.id, ballots.roundId, ballots.freezeRevision],
    }),
  ],
);
