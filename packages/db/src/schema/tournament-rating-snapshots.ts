import { tournamentRatingSnapshotSchema } from '@daisy/protocol/lobby/rating-snapshot';
import { check, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAtColumn, jsonbColumn, jsonbIsObject } from './columns';
import { tournaments } from './lobbies';

/** Private, immutable input frozen once by the tournament's first accepted draw. */
export const tournamentRatingSnapshots = pgTable(
  'tournament_rating_snapshots',
  {
    lobbyId: text('lobby_id')
      .primaryKey()
      .references(() => tournaments.lobbyId, { onDelete: 'restrict' }),
    snapshot: jsonbColumn('snapshot', tournamentRatingSnapshotSchema).notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    check('tournament_rating_snapshots_object', jsonbIsObject(table.snapshot)),
  ],
);
