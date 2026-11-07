import { roundHasAiJudge } from './round-ai-judge';
import { and, eq, inArray } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { FreeBindingReleaseFacts } from '@daisy/protocol/billing';
import { usageStateSchema } from '@daisy/protocol/billing';
import { lockAuthorizationActors } from './authorization';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';
import { rounds } from './schema/rounds';
import { usageReservations } from './schema/usage-reservations';
import { advanceUsageLocked } from './usage-ledger';
import { readDatabaseTime } from './database-clock';
import { requireAdmissionTarget } from './round-usage-authority';

type ReleasePolicy = (facts: FreeBindingReleaseFacts) => boolean;

type Row = typeof usageReservations.$inferSelect;
async function releaseReservedRows(
  tx: BoundedTransactionContext,
  rows: readonly Row[],
  target: { readonly actorId: string; readonly roundId: string },
) {
  const released = new Map<string, ReturnType<typeof usageStateSchema.parse>>();
  for (const row of rows) {
    const state = usageStateSchema.parse(row.state);
    if (state.kind !== 'reserved' && state.kind !== 'released') {
      released.set(row.kind, state);
      continue;
    }
    const result = await advanceUsageLocked(tx, {
      ...target,
      reservationId: row.id,
      event: { kind: 'abandon' },
      authorized: true,
    });
    released.set(row.kind, result.state);
  }
  return released;
}
function bindingFacts(
  bot: Row | undefined,
  released: Map<string, ReturnType<typeof usageStateSchema.parse>>,
  roundId: string,
  judgeSelected: boolean,
): FreeBindingReleaseFacts {
  const judge = released.get('casual_ai_judge');
  return {
    boundRoundId: bot?.bindsFreeJudge ? bot.roundId : null,
    roundId,
    abandoned: true,
    bot: released.get('ai_round') ?? null,
    judge: judge
      ? { kind: 'selected', state: judge }
      : judgeSelected
        ? { kind: 'missing' }
        : { kind: 'unselected' },
  };
}

/**
 * DEC-367: the account fence excludes every new reservation/dispatch; the
 * Round fence proves abandonment and its immutable selected cast. This is
 * separate from a provider refund or platform credit, neither of which may
 * erase the binding. The old rows remain terminal replay identities.
 */
export function createUsageRelease(input: {
  readonly run: BoundedTransaction;
  readonly releaseBinding: ReleasePolicy;
}) {
  return (target: { readonly actorId: string; readonly roundId: string }) =>
    input.run(async (tx) => {
      requireAdmissionTarget(target);
      const [account] = await lockAuthorizationActors(tx, [target.actorId], {
        maxActors: 1,
      });
      if (!account?.member || account.erased)
        throw createAppError('AUTHORIZATION');
      const [round] = await tx
        .select()
        .from(rounds)
        .where(eq(rounds.id, target.roundId))
        .for('no key update');
      if (!round || round.createdByActorId !== target.actorId)
        throw createAppError('AUTHORIZATION');
      if (round.status !== 'abandoned') throw createAppError('CONFLICT');
      const judgeSelected = await roundHasAiJudge(tx, target.roundId);
      const rows = await tx
        .select()
        .from(usageReservations)
        .where(
          and(
            eq(usageReservations.actorId, target.actorId),
            eq(usageReservations.roundId, target.roundId),
            inArray(usageReservations.kind, ['ai_round', 'casual_ai_judge']),
          ),
        )
        .orderBy(usageReservations.kind)
        .for('update');
      const released = await releaseReservedRows(tx, rows, target);
      const bot = rows.find((row) => row.kind === 'ai_round');
      const mayRelease = input.releaseBinding(
        bindingFacts(bot, released, target.roundId, judgeSelected),
      );
      if (mayRelease && bot && bot.bindingReleasedAt === null)
        await tx
          .update(usageReservations)
          .set({ bindingReleasedAt: await readDatabaseTime(tx) })
          .where(eq(usageReservations.id, bot.id));
      return { bindingReleased: mayRelease };
    });
}
