import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { readRoundYouth } from './round-youth-read';
import { readYouthRoundPeople } from './youth-recording-people';
import { readStudentLiveRounds } from './youth-students-live';

/**
 * The live audience's own reads (ADR 0155): whether a Round is a Youth one,
 * its youth debaters' linked adults (ADR 0150's people read, as a named
 * input, in its own read-only snapshot), and the live Rounds an adult's
 * students debate in, for Watch.
 */
export const youthLiveReadOperations = ({
  database,
}: {
  readonly database: BunSQLDatabase;
}) => ({
  readRoundYouth: (roundId: string) => readRoundYouth(database, roundId),
  readYouthRoundPeople: (roundId: string) =>
    readYouthRoundPeople(database, roundId),
  readStudentLiveRounds: (adultUserId: string) =>
    readStudentLiveRounds(database, adultUserId),
});
