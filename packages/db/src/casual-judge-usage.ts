import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { usageStateSchema } from '@daisy/protocol/billing';
import { readAuthorizationActors } from './authorization';
import { rounds } from './schema/rounds';
import { usageReservations } from './schema/usage-reservations';
import {
  advanceUsageLocked,
  type AllowanceAccountPolicy,
} from './usage-ledger';
import type { BoundedTransactionContext } from './transaction-context';

type Tx = Pick<BoundedTransactionContext, 'select' | 'update' | 'execute'>;
const judgeReservation = async (tx: Tx, roundId: string) =>
  (
    await tx
      .select()
      .from(usageReservations)
      .where(
        and(
          eq(usageReservations.roundId, roundId),
          eq(usageReservations.kind, 'casual_ai_judge'),
        ),
      )
      .for('update')
  )[0];

/** Caller already fenced the Round's accounts before locking Round, run and job. */
export async function countCasualJudgeModelCall(
  tx: BoundedTransactionContext,
  input: {
    readonly roundId: string;
    readonly before: string;
    readonly accountEligible: AllowanceAccountPolicy;
  },
) {
  const [round] = await tx
    .select()
    .from(rounds)
    .where(eq(rounds.id, input.roundId));
  if (!round) throw createAppError('NOT_FOUND');
  if (round.competitionType === 'ranked') return;
  if (!round.createdByActorId) throw createAppError('AUTHORIZATION');
  // Re-read current facts under the weaker fence the caller's exclusive fence covers.
  const [account] = await readAuthorizationActors(
    tx,
    [round.createdByActorId],
    { maxActors: 1 },
  );
  if (!input.accountEligible(account ?? null))
    throw createAppError('AUTHORIZATION');
  const reservation = await judgeReservation(tx, input.roundId);
  if (!reservation || reservation.actorId !== round.createdByActorId)
    throw createAppError('CONFLICT', 'Casual judge reservation missing');
  await advanceUsageLocked(tx, {
    reservationId: reservation.id,
    actorId: reservation.actorId,
    roundId: input.roundId,
    event: { kind: 'dispatch', before: input.before },
    authorized: true,
  });
}

/** Round lock held. Provider evidence may resolve after closure; it never creates a reservation. */
export async function settleCasualJudgeUsageLocked(tx: Tx, roundId: string) {
  const [round] = await tx.select().from(rounds).where(eq(rounds.id, roundId));
  if (!round || round.competitionType === 'ranked') return;
  const [jobs] = await tx.execute(sql`select count(*)::int as total,
    count(*) filter(where j.status is null or j.status in ('queued','leased','recovering','blocked'))::int as open
    from round_participants p join actors a on a.id=p.actor_id and a.kind='bot'
    left join round_judging_jobs j on j.round_id=p.round_id and j.judge_participant_id=p.id
    where p.round_id=${roundId} and p.role='judge'`);
  if (
    !['completed', 'abandoned'].includes(round.status) &&
    (!jobs?.total || jobs.open !== 0)
  )
    return;
  const reservation = await judgeReservation(tx, roundId);
  if (!reservation) return;
  const state = usageStateSchema.parse(reservation.state);
  if (state.kind === 'released') return;
  const [calls] =
    await tx.execute(sql`select coalesce(sum(a.requests),0)::int as total,
    count(*) filter(where t.answered_at is not null)::int as received,
    count(*) filter(where t.answered_at is null and t.category='provider_refused')::int as failed
    from agent_runs a join round_participants p on p.id=a.round_participant_id
    left join round_judging_attempts t on t.agent_run_id=a.id
    where p.round_id=${roundId} and p.role='judge' and a.kind='judging' and a.requests>0`);
  const outcome =
    !calls?.total ||
    Number(calls.received) + Number(calls.failed) !== calls.total
      ? 'unknown'
      : Number(calls.received) > 0
        ? 'delivered'
        : 'definite_failure';
  await advanceUsageLocked(tx, {
    reservationId: reservation.id,
    actorId: reservation.actorId,
    roundId,
    authorized: false,
    event:
      state.kind === 'reserved'
        ? { kind: 'abandon' }
        : { kind: 'settle', outcome },
  });
}
