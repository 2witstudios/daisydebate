import { requireCurrentWeb } from './round-service-authority';
import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';
import {
  executeLockedRoundTick,
  type LockedRoundTickInput,
} from './round-clock-transaction';
import {
  lockedRoundVersion,
  writeProjectionWithPhaseSignal,
} from './round-projection-writer';
import { hydrateRoundRows } from './round-hydration';
import { sampleRoundExecutionTime } from './round-execution-time';
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
     * Active Rounds, and scheduled ones whose start horizon passed on the
     * database clock (DEC-214), so maintenance can abandon them.
     */
    readRoundMaintenanceCandidates(input: {
      readonly instanceId: string;
      readonly afterId?: string;
      readonly limit: number;
      readonly startHorizonMs: number;
    }) {
      if (
        !idSchema.safeParse(input.instanceId).success ||
        (input.afterId !== undefined &&
          !idSchema.safeParse(input.afterId).success) ||
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 1000 ||
        !Number.isSafeInteger(input.startHorizonMs) ||
        input.startHorizonMs < 1
      )
        throw createAppError('VALIDATION');
      return run(async (tx) => {
        await requireCurrentWeb(tx, input.instanceId);
        const rows = await tx
          .select({ id: rounds.id })
          .from(rounds)
          .where(
            and(
              or(
                eq(rounds.status, 'active'),
                and(
                  eq(rounds.status, 'scheduled'),
                  sql`${rounds.createdAt} <= statement_timestamp() - ${input.startHorizonMs} * interval '1 millisecond'`,
                ),
              ),
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
    /**
     * A scheduled Round is offered to the projection first, which abandons it
     * once its start horizon passed (DEC-214); the clock tick then moves only
     * active Rounds, as before.
     */
    tickDueRound: (input: DueInput) =>
      withRound(input, async (tx) => {
        await abandonUnstartedLocked(tx, input);
        return executeLockedRoundTick(tx, input);
      }),
    finalizeDueRoundTranscript: (
      input: DueInput & Pick<FreezeRequest, 'ballotDeadlineMs'>,
    ) =>
      withRound(input, (tx, assertCurrent) =>
        finalizeLockedRoundTranscript(tx, input, assertCurrent),
      ),
  };
}

/** Under the held Round lock: write the projection's abandonment of a still-scheduled Round. */
async function abandonUnstartedLocked(
  tx: BoundedTransactionContext,
  input: LockedRoundTickInput,
) {
  const current = await lockedRoundVersion(tx, input.roundId);
  if (current.status !== 'scheduled') return;
  const round = await hydrateRoundRows(tx, input.roundId);
  if (!round) throw createAppError('NOT_FOUND');
  const now = await sampleRoundExecutionTime(tx);
  // Unchanged unless the horizon passed; the writer refunds a Round it ends.
  await writeProjectionWithPhaseSignal(
    tx,
    input.roundId,
    current,
    input.buildProjection({ round, now }),
    now,
  );
}
