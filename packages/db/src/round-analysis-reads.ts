import { createAppError } from '@daisy/errors';
import { idSchema, MAX_FORMAT_SEATS } from '@daisy/protocol';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { Caller } from './room-command-facts';
import {
  readRoundAnalysisAccess,
  type RoundAnalysisAccess,
} from './round-analysis-access';
import {
  readRoundAnalysisFacts,
  type RoundAnalysisFacts,
} from './round-analysis-facts';
import { roundParticipants } from './schema/round-participants';
import { actors } from './schema/actors';
import { readAuthorizationActors, requireOwnScope } from './authorization';
import { eq } from 'drizzle-orm';
import { readAllowanceLocked, type AiAllowanceOptions } from './usage-ledger';

/**
 * A caller's own round analysis facts: the caller must hold a human debater
 * seat in the Round, or the Round is NOT_FOUND to them, spectators, judges
 * and hosts alike. The injected read decision runs before private report
 * facts are loaded. Every frozen participant's account shares its canonical
 * fence with erasure for the entire read, in the single canonical lock order.
 */
export const roundAnalysisReads = ({
  database,
  allowance,
}: {
  readonly database: BunSQLDatabase;
  readonly allowance?: AiAllowanceOptions | undefined;
}) => ({
  async readRoundAnalysis(input: {
    readonly roundId: string;
    readonly caller: Caller;
    readonly authorize: (access: RoundAnalysisAccess) => boolean;
  }): Promise<{
    readonly access: RoundAnalysisAccess;
    readonly facts: RoundAnalysisFacts;
    readonly allowance: 'included' | 'free' | 'unavailable';
  }> {
    if (!idSchema.safeParse(input.roundId).success)
      throw createAppError('VALIDATION');
    requireOwnScope(input.caller);
    return database.transaction(async (tx) => {
      const participants = await tx
        .select({
          id: roundParticipants.id,
          actorId: roundParticipants.actorId,
          role: roundParticipants.role,
          userId: actors.userId,
        })
        .from(roundParticipants)
        .innerJoin(actors, eq(actors.id, roundParticipants.actorId))
        .where(eq(roundParticipants.roundId, input.roundId))
        .limit(MAX_FORMAT_SEATS + 1);
      if (participants.length > MAX_FORMAT_SEATS)
        throw createAppError('INVARIANT');
      const seat = participants.find(
        (p) =>
          p.actorId === input.caller.actorId &&
          p.userId === input.caller.userId &&
          ['affirmative', 'negative'].includes(p.role),
      );
      if (!seat) throw createAppError('NOT_FOUND');
      const accounts = await readAuthorizationActors(
        tx,
        participants.map((p) => p.actorId),
        { maxActors: MAX_FORMAT_SEATS },
      );
      if (
        participants.some(
          (p, index) =>
            p.userId !== null && (!accounts[index] || accounts[index]!.erased),
        )
      )
        throw createAppError('NOT_FOUND');
      const target = { roundId: input.roundId, roundParticipantId: seat.id };
      // All account fences are already held; never upgrade a shared fence.
      const access = await readRoundAnalysisAccess(tx, target);
      if (
        access.seat.actorId !== input.caller.actorId ||
        access.account?.userId !== input.caller.userId ||
        !input.authorize(access)
      )
        throw createAppError('NOT_FOUND');
      const quote = allowance
        ? await readAllowanceLocked(tx, {
            account: access.account,
            request: { kind: 'round_analysis', roundId: input.roundId },
            decide: allowance.decide,
          })
        : null;
      const availability =
        quote?.decision.kind === 'admit'
          ? quote.decision.reservations[0]?.source.kind === 'lifetime'
            ? 'free'
            : 'included'
          : 'unavailable';
      return {
        access,
        facts: await readRoundAnalysisFacts(tx, target),
        allowance: availability,
      };
    });
  },
});
