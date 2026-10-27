import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { sharedAccount, type Caller } from './room-command-facts';
import {
  readRoundAnalysisAccess,
  type RoundAnalysisAccess,
} from './round-analysis-access';
import {
  readRoundAnalysisFacts,
  type RoundAnalysisFacts,
} from './round-analysis-facts';
import { roundParticipants } from './schema/round-participants';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * A caller's own round analysis facts: the caller must hold a human debater
 * seat in the Round, or the Round is NOT_FOUND to them, spectators, judges
 * and hosts alike. Whether they may read the report is the round-analysis
 * feature's decision, from the access facts.
 */
export const roundAnalysisReads = ({
  database,
}: {
  readonly database: BunSQLDatabase;
}) => ({
  async readRoundAnalysis(input: {
    readonly roundId: string;
    readonly caller: Caller;
  }): Promise<{
    readonly access: RoundAnalysisAccess;
    readonly facts: RoundAnalysisFacts;
  }> {
    if (!idSchema.safeParse(input.roundId).success)
      throw createAppError('VALIDATION');
    return database.transaction(async (tx) => {
      await sharedAccount(tx, input.caller);
      const [seat] = await tx
        .select({ id: roundParticipants.id })
        .from(roundParticipants)
        .where(
          and(
            eq(roundParticipants.roundId, input.roundId),
            eq(roundParticipants.actorId, input.caller.actorId),
            inArray(roundParticipants.role, ['affirmative', 'negative']),
          ),
        );
      if (!seat) throw createAppError('NOT_FOUND');
      const target = { roundId: input.roundId, roundParticipantId: seat.id };
      const access = await readRoundAnalysisAccess(tx, target, 'claim');
      if (access.seat.actorId !== input.caller.actorId)
        throw createAppError('NOT_FOUND');
      return { access, facts: await readRoundAnalysisFacts(tx, target) };
    });
  },
});
