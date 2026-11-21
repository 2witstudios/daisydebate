import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { query } from './raw-rows';
import { readRoundYouth } from './round-youth-read';
import { readYouthRecordingPeople } from './youth-recording-people';
import { readStudentLiveRounds } from './youth-students-live';
import type { TxSource } from './tx';
import { youthReuseFencedSql } from './youth-round-sql';

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
  readStudentLiveRounds: (adultUserId: string, lobbyId?: string) =>
    readStudentLiveRounds(database, adultUserId, lobbyId),
  /**
   * Whether this Round's content may not leave Daisy (the reuse fence, ADR
   * 0161). The web asks it beside the shared spectator read, which the
   * audience publisher also runs and whose role never reads media releases.
   */
  readRoundReuseFenced: async (roundId: string): Promise<boolean> => {
    const [row] = await query(
      database,
      z.object({ fenced: z.boolean() }),
      sql`select ${youthReuseFencedSql(sql`${roundId}`)} as fenced`,
    );
    return row?.fenced ?? true;
  },
});
