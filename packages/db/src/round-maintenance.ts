import { requireCurrentWeb } from './round-service-authority';
import { and, asc, eq, gt } from 'drizzle-orm';
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
    readRoundMaintenanceCandidates(input: {
      readonly instanceId: string;
      readonly afterId?: string;
      readonly limit: number;
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
          .select({ id: rounds.id })
          .from(rounds)
          .where(
            and(
              eq(rounds.status, 'active'),
              ...(input.afterId ? [gt(rounds.id, input.afterId)] : []),
            ),
          )
          .orderBy(asc(rounds.id))
          .limit(input.limit);
        return {
          roundIds: rows.map((row) => row.id),
          afterId: rows.at(-1)?.id ?? null,
          exhausted: rows.length < input.limit,
        };
      });
    },
    tickDueRound: (input: DueInput) =>
      withRound(input, (tx) => executeLockedRoundTick(tx, input)),
    finalizeDueRoundTranscript: (
      input: DueInput & Pick<FreezeRequest, 'planJudging'>,
    ) =>
      withRound(input, (tx, assertCurrent) =>
        finalizeLockedRoundTranscript(tx, input, assertCurrent),
      ),
  };
}
