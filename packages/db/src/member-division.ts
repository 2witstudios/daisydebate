import { type RatingDivision, ratingDivisions } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { divisionAgeBand, divisionOfBandSql } from './ladder-division-band';
import { query } from './raw-rows';
import { readRoomCreator } from './room-creator';
import { inTransaction, type TxSource } from './tx';
import { z } from 'zod';

/**
 * A member's ladder division as their pages show it (ADR 0147): the same
 * season-fixed rule every ranked command decides again under its fence.
 * Null without a valid age record. The birth month never leaves SQL.
 */
export const memberDivisionOperations = ({
  database,
  eventSink,
}: {
  readonly database: TxSource;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  readMemberDivision: (userId: string): Promise<RatingDivision | null> =>
    instrumented(eventSink, 'readMemberDivision', async () => {
      const [row] = await query(
        database,
        z.object({ division: z.enum(ratingDivisions).nullable() }),
        sql`select ${divisionOfBandSql(divisionAgeBand())} as division
          from account_age where account_age.user_id = ${userId}`,
      );
      return row?.division ?? null;
    }),
  /**
   * The create form's landing preference, club staff standing and guardian
   * grants. Submission checks the selected lobby again under its lock.
   */
  readRoomCreatorFact: (userId: string) =>
    instrumented(eventSink, 'readRoomCreatorFact', () =>
      inTransaction(database, (tx) => readRoomCreator(tx, userId)),
    ),
});
