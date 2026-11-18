import type { RatingDivision } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { divisionAgeBand, divisionOfBandSql } from './ladder-division-band';
import { rowsOf } from './raw-rows';

/**
 * A member's ladder division as their pages show it (ADR 0147): the same
 * season-fixed rule every ranked command decides again under its fence.
 * Null without a valid age record. The birth month never leaves SQL.
 */
export const memberDivisionOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  readMemberDivision: (userId: string): Promise<RatingDivision | null> =>
    instrumented(eventSink, 'readMemberDivision', async () => {
      const [row] = await rowsOf<{ division: RatingDivision | null }>(
        database,
        sql`select ${divisionOfBandSql(divisionAgeBand())} as division
          from account_age where account_age.user_id = ${userId}`,
      );
      return row?.division ?? null;
    }),
});
