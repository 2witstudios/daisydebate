import { ballotScreeningStatuses } from '@daisy/protocol/lobby';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text } from 'drizzle-orm/pg-core';
import { ballots } from './ballots';
import {
  createdAtColumn,
  jsonbColumnNullable,
  jsonbIsObject,
  jsonObjectSchema,
  oneOf,
  timestampColumn,
  updatedAtColumn,
} from './columns';
import { lobbies } from './lobbies';

/**
 * Screening of one ballot's written text before release. It may hold text
 * back; it never rewrites the ballot, and tab keeps the original.
 * `released_text` is the screened copy an audience is shown.
 */
export const ballotScreenings = pgTable(
  'ballot_screenings',
  {
    ballotId: text('ballot_id')
      .primaryKey()
      .references(() => ballots.id, { onDelete: 'cascade' }),
    lobbyId: text('lobby_id')
      .notNull()
      .references(() => lobbies.id, { onDelete: 'restrict' }),
    status: text('status')
      .$type<(typeof ballotScreeningStatuses)[number]>()
      .notNull()
      .default('pending'),
    /** Its contract is the ballot's written fields, which slice F owns. */
    releasedText: jsonbColumnNullable('released_text', jsonObjectSchema),
    screenedAt: timestampColumn('screened_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('ballot_screenings_lobby_idx').on(table.lobbyId, table.status),
    check(
      'ballot_screenings_status_check',
      oneOf(table.status, ballotScreeningStatuses),
    ),
    check(
      'ballot_screenings_screened_consistent',
      sql`(${table.status} <> 'pending') = (${table.screenedAt} is not null)`,
    ),
    jsonbIsObject('ballot_screenings', table.releasedText),
  ],
);
