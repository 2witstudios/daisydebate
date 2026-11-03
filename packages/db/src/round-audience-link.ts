import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { rounds } from './schema/rounds';

/**
 * An unlisted Round's link (DEC-302): its hash and nothing else, on the Round
 * whose audience it admits. Reads here are never memoized, so replacing the hash
 * refuses the old link on the next read.
 */
export const roundAudienceLinkOperations = ({
  database,
}: {
  readonly database: BunSQLDatabase;
}) => ({
  async readRoundAudienceLink(roundId: string) {
    const [round] = await database
      .select({
        roomId: rounds.roomId,
        visibility: rounds.visibility,
        audienceLinkHash: rounds.audienceLinkHash,
      })
      .from(rounds)
      .where(eq(rounds.id, roundId));
    return round ?? null;
  },

  /** Replaces the Round's one hash, and only an unlisted Round ever has one. */
  async setRoundAudienceLink(input: {
    readonly roundId: string;
    readonly hash: string;
  }): Promise<boolean> {
    const updated = await database
      .update(rounds)
      .set({ audienceLinkHash: input.hash })
      .where(
        and(eq(rounds.id, input.roundId), eq(rounds.visibility, 'unlisted')),
      )
      .returning({ id: rounds.id });
    return updated.length === 1;
  },
});
