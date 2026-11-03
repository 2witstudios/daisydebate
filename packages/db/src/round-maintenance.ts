import { requireCurrentWeb } from './round-service-authority';
import { and, asc, eq, gt, or, sql, type SQL } from 'drizzle-orm';
import { AUTOMATIC_STRIKE_DELAY_MS } from '@daisy/protocol/resolution-draw';
import {
  roundResolutionDraws,
  roundResolutionStrikes,
} from './schema/resolution-draws';
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
     * Rounds the clock can move now: active ones, and opening ones with a
     * strike or a prep end due. A prefilter only: the engine decides under the
     * Round lock. A Round with no Room is a proof fixture with no cast to open.
     */
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
      // The engine's openingStep in SQL. The next strike falls due when its turn
      // opens plus the side's window; prep ends after the reveal or Start round.
      const turnSide = sql`case when st.n % 2 = 0 then d.manifest->>'firstStriker' when d.manifest->>'firstStriker' = 'affirmative' then 'negative' else 'affirmative' end`;
      const turnWindowMs = sql`case when d.manifest->'controllers'->>(${turnSide}) = 'automatic' then ${AUTOMATIC_STRIKE_DELAY_MS} else (d.manifest->>'strikeWindowMs')::int end`;
      const prepEnd = (anchor: SQL) =>
        sql`${anchor} + coalesce(${rounds.preRoundPrepMs}, 0) * interval '1 millisecond' <= statement_timestamp()`;
      const dueDraw = sql`exists (select 1 from ${roundResolutionDraws} d cross join lateral (select count(*)::int as n, max(s.struck_at) as last from ${roundResolutionStrikes} s where s.draw_id = d.id) st where d.round_id = ${rounds.id} and case when st.n < d.draw_size - 1 then coalesce(st.last, d.started_at) + ${turnWindowMs} * interval '1 millisecond' <= statement_timestamp() else ${prepEnd(sql`st.last`)} end)`;
      const noDraw = sql`not exists (select 1 from ${roundResolutionDraws} d where d.round_id = ${rounds.id}) and ${prepEnd(sql`${rounds.createdAt}`)}`;
      // An incident only delays these deadlines, so the checks above can read
      // early and never late; the engine decides. Its countdown must still end.
      const heldOpening = sql`${rounds.runtimeState}->'incident'->>'phase' <> 'none'`;
      const dueOpening = sql`${rounds.status} = 'opening' and ${rounds.roomId} is not null and (${heldOpening} or ${dueDraw} or (${noDraw}))`;
      return run(async (tx) => {
        await requireCurrentWeb(tx, input.instanceId);
        const rows = await tx
          .select({ id: rounds.id, status: rounds.status })
          .from(rounds)
          .where(
            and(
              or(eq(rounds.status, 'active'), dueOpening),
              ...(input.afterId ? [gt(rounds.id, input.afterId)] : []),
            ),
          )
          .orderBy(asc(rounds.id))
          .limit(input.limit);
        return {
          roundIds: rows.map((row) => row.id),
          openingIds: rows
            .filter((row) => row.status === 'opening')
            .map((row) => row.id),
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
