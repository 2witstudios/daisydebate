import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol/primitives';
import { MAX_FORMAT_SEATS } from '@daisy/protocol/format-seating';
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
import { inTransaction, type TxSource } from './tx';

/**
 * A caller's own round analysis facts: the caller must hold a human debater
 * seat in the Round, or the Round is NOT_FOUND to them, spectators, judges
 * and hosts alike. The injected read decision runs before private report
 * facts are loaded. Every human participant's account shares its canonical
 * fence with erasure for the entire read, in the single canonical lock order.
 */
export const roundAnalysisReads = ({
  database,
  allowance,
}: {
  readonly database: TxSource;
  readonly allowance?: AiAllowanceOptions | undefined;
}) => ({
  async readRoundAnalysis(input: {
    readonly roundId: string;
    readonly caller: Caller;
    readonly authorize: (access: RoundAnalysisAccess) => boolean;
  }): Promise<{
    readonly access: RoundAnalysisAccess;
    readonly facts: RoundAnalysisFacts;
    readonly allowance:
      'included' | 'free' | 'used' | 'fair-use' | 'unavailable';
  }> {
    if (!idSchema.safeParse(input.roundId).success)
      throw createAppError('VALIDATION');
    requireOwnScope(input.caller);
    return inTransaction(database, async (tx) => {
      const participants = await tx
        .select({
          id: roundParticipants.id,
          actorId: roundParticipants.actorId,
          seatKind: roundParticipants.seatKind,
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
          p.seatKind === 'side',
      );
      if (!seat) throw createAppError('NOT_FOUND');
      // The shared selector accepts user-backed actors, not accountless bot seats.
      const humans = participants.filter((p) => p.userId !== null);
      const accounts = await readAuthorizationActors(
        tx,
        humans.map((p) => p.actorId),
        { maxActors: MAX_FORMAT_SEATS },
      );
      if (
        humans.some(
          (_participant, index) => !accounts[index] || accounts[index].erased,
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
          : quote?.decision.reason === 'abuse-ceiling'
            ? 'fair-use'
            : quote?.decision.reason === 'free-limit-reached'
              ? 'used'
              : 'unavailable';
      return {
        access,
        facts: await readRoundAnalysisFacts(tx, target),
        allowance: availability,
      };
    });
  },
});
