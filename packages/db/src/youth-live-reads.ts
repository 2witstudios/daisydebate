import { readRoundYouth } from './round-youth-read';
import { readYouthRecordingPeople } from './youth-recording-people';
import { readStudentLiveRounds } from './youth-students-live';
import type { TxSource } from './tx';

/**
 * The live audience's own reads (ADR 0155): whether a Round is a Youth one,
 * its youth debaters' linked adults (ADR 0150's people read, as a named
 * input), and the live Rounds an adult's
 * students debate in, for Watch.
 */
export const youthLiveReadOperations = ({
  database,
}: {
  readonly database: TxSource;
}) => ({
  readRoundYouth: (roundId: string) => readRoundYouth(database, roundId),
  /**
   * A Youth Round's youth debaters and their linked adults (ADR 0150, ADR
   * 0158), one statement. The Recording's audience and the live audience
   * both read it; the Recording's takedown reads it fresh, past any cache.
   */
  readYouthRoundPeople: (roundId: string) =>
    readYouthRecordingPeople(database, roundId),
  readStudentLiveRounds: (adultUserId: string) =>
    readStudentLiveRounds(database, adultUserId),
});
