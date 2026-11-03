import { requireCurrentWeb } from './round-service-authority';
import { and, asc, eq, exists, gt, inArray } from 'drizzle-orm';
import type { RoundOpeningClock } from '@daisy/protocol/resolution-draw';
import { readOpeningClocks } from './round-opening-read';
import { transactionNow } from './room-command-facts';
import { roundParticipants } from './schema/round-participants';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';
import {
  executeLockedRoundTick,
  type LockedRoundTickInput,
} from './round-clock-transaction';
import { lockedRoundVersion } from './round-projection-writer';
import {
  finalizeLockedRoundTranscript,
  type FreezeRequest,
} from './transcript-finalization';
import { rounds } from './schema/rounds';

type DueInput = LockedRoundTickInput & { readonly instanceId: string };
/** Internal service authority, one canonical clock and the existing bounded pool. */
export function roundMaintenanceOperations(run: BoundedTransaction) {
  const withRound = <T>(
    input: DueInput,
    work: (
      tx: BoundedTransactionContext,
      assertCurrent: () => Promise<void>,
    ) => Promise<T>,
  ) => {
    if (
      !idSchema.safeParse(input.instanceId).success ||
      !idSchema.safeParse(input.roundId).success
    )
      throw createAppError('VALIDATION');
    return run(async (tx) => {
      await requireCurrentWeb(tx, input.instanceId);
      await lockedRoundVersion(tx, input.roundId);
      await requireCurrentWeb(tx, input.instanceId, true);
      const assertCurrent = () => requireCurrentWeb(tx, input.instanceId);
      const result = await work(tx, assertCurrent);
      await assertCurrent();
      return result;
    });
  };
  return {
    /**
     * Rounds the clock can move now: active ones, and opening ones the engine's
     * `openingDue` rule, injected, finds due. A prefilter only: the engine decides
     * again under the Round lock.
     */
    readRoundMaintenanceCandidates(input: {
      readonly instanceId: string;
      readonly afterId?: string;
      readonly limit: number;
      readonly openingDue: (opening: RoundOpeningClock, now: string) => boolean;
    }) {
      if (
        !idSchema.safeParse(input.instanceId).success ||
        (input.afterId !== undefined &&
          !idSchema.safeParse(input.afterId).success) ||
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 1000
      )
        throw createAppError('VALIDATION');
      return run(async (tx) => {
        await requireCurrentWeb(tx, input.instanceId);
        const rows = await tx
          .select({
            id: rounds.id,
            status: rounds.status,
            createdAt: rounds.createdAt,
            preRoundPrepMs: rounds.preRoundPrepMs,
          })
          .from(rounds)
          .where(
            and(
              inArray(rounds.status, ['active', 'opening']),
              // A Round with no seats, a proof, has nothing for the clock to move.
              exists(
                tx
                  .select({ id: roundParticipants.id })
                  .from(roundParticipants)
                  .where(eq(roundParticipants.roundId, rounds.id)),
              ),
              ...(input.afterId ? [gt(rounds.id, input.afterId)] : []),
            ),
          )
          .orderBy(asc(rounds.id))
          .limit(input.limit);
        const opening = rows.filter((row) => row.status === 'opening');
        const clocks = await readOpeningClocks(tx, opening);
        const now = await transactionNow(tx);
        const dueOpening = opening.filter((row) =>
          input.openingDue(clocks.get(row.id)!, now),
        );
        const due = new Set(dueOpening.map((row) => row.id));
        return {
          roundIds: rows
            .filter((row) => row.status === 'active' || due.has(row.id))
            .map((row) => row.id),
          openingIds: dueOpening.map((row) => row.id),
          afterId: rows.at(-1)?.id ?? null,
          exhausted: rows.length < input.limit,
        };
      });
    },
    tickDueRound: (input: DueInput) =>
      withRound(input, (tx) => executeLockedRoundTick(tx, input)),
    finalizeDueRoundTranscript: (
      input: DueInput & Pick<FreezeRequest, 'planJudging' | 'botGrantUnused'>,
    ) =>
      withRound(input, (tx, assertCurrent) =>
        finalizeLockedRoundTranscript(tx, input, assertCurrent),
      ),
  };
}
