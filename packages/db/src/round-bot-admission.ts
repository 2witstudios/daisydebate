import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';
import { lockAuthorizationActors } from './authorization';
import { roundAgentNow } from './round-agent-runs';
import { rounds } from './schema/rounds';
import { usageReservations } from './schema/usage-reservations';
import {
  admissionRefusal,
  requireAdmissionTarget,
  requireBusyCap,
  requireOwnReservation,
  requireUnrefundedReservation,
  requireSponsor,
  utcMonth,
} from './round-bot-admission-rules';

type Target = { readonly actorId: string; readonly roundId: string };
type SponsorAccount = Awaited<
  ReturnType<typeof lockAuthorizationActors>
>[number];
/**
 * The trusted quota policy (ISSUE-646), injected by composition and applied
 * only to the account fact locked in the admitting transaction. Null admits
 * no AI Round.
 */
export type AiRoundAllowance = (account: SponsorAccount) => number | null;
type Reservation = Target & { readonly id: string };
/** Acquire before account/Room/Round locks in both admission and billable-call composition. */
export const lockBotAdmission = (tx: BoundedTransactionContext) =>
  tx.execute(sql`select pg_advisory_xact_lock(59003, 1)`);
async function lockSponsor(
  tx: BoundedTransactionContext,
  target: Target,
): Promise<SponsorAccount> {
  requireAdmissionTarget(target);
  const [account] = await lockAuthorizationActors(tx, [target.actorId], {
    maxActors: 1,
  });
  const [round] = await tx
    .select()
    .from(rounds)
    .where(eq(rounds.id, target.roundId))
    .for('no key update');
  requireSponsor(account ?? null, round, target.actorId);
  return account ?? null;
}
function reservationWhere(target: Target) {
  return and(
    eq(usageReservations.actorId, target.actorId),
    eq(usageReservations.roundId, target.roundId),
    eq(usageReservations.kind, 'ai_practice'),
  );
}
async function existingReservation(
  tx: BoundedTransactionContext,
  target: Target,
) {
  const [row] = await tx
    .select()
    .from(usageReservations)
    .where(reservationWhere(target))
    .for('update');
  return requireUnrefundedReservation(row);
}
/** The first bot-debater model call counts the reservation, once. */
async function countLockedReservation(
  tx: BoundedTransactionContext,
  reservation: Reservation,
) {
  await lockSponsor(tx, reservation);
  const current = requireOwnReservation(
    await existingReservation(tx, reservation),
    reservation.id,
  );
  if (current.countedAt) return;
  await tx
    .update(usageReservations)
    .set({ countedAt: sql`clock_timestamp()` })
    .where(eq(usageReservations.id, reservation.id));
}
/**
 * Called once a Round turns terminal, under its lock. A counted AI practice
 * whose every bot-debater model call definitely failed, none received or
 * unknown, gives its allowance back; the free AI judge never counts or
 * decides a refund (DEC-186). An AI practice never counted needs no
 * refund: the allowance spends a reservation only once counted or while its
 * Round is live (ISSUE-469). The refunded_at guard makes a repeat a no-op on
 * any instance (ADR 0058, DEC-211).
 */
export async function refundUnservedPracticeLocked(
  tx: Pick<BoundedTransactionContext, 'execute'>,
  roundId: string,
) {
  await tx.execute(sql`
    update usage_reservations set refunded_at = clock_timestamp()
    where round_id = ${roundId} and kind = 'ai_practice' and refunded_at is null
      and counted_at is not null
      and not exists (
        select 1 from agent_runs a
        join round_participants p on p.id = a.round_participant_id
        where p.round_id = ${roundId} and p.role <> 'judge'
          and a.configuration_snapshot->>'providerOutcome' in ('received', 'unknown'))`);
}
/** Bot-debater calls only: the AI judge is free (DEC-186). Caller acquires admission serialization before command/account/Round fences. Never creates a reservation. */
export async function markLockedRoundBotModelCall(
  tx: BoundedTransactionContext,
  roundId: string,
) {
  const [round] = await tx
    .select({ actorId: rounds.createdByActorId })
    .from(rounds)
    .where(eq(rounds.id, roundId));
  if (!round?.actorId) throw createAppError('AUTHORIZATION');
  const target = { roundId, actorId: round.actorId };
  const current = await existingReservation(tx, target);
  if (!current) throw createAppError('CONFLICT', 'Bot reservation missing');
  const reservation = { ...target, id: current.id };
  await countLockedReservation(tx, reservation);
  return reservation;
}
async function admissionStatus(
  tx: BoundedTransactionContext,
  input: {
    readonly actorId: string;
    readonly limit: number | null;
    readonly busyCap: number;
    readonly now: Date;
  },
) {
  const { actorId, limit, busyCap } = input;
  const period = utcMonth(input.now);
  const [facts] = await tx.execute(sql`select
    (select count(*)::int from usage_reservations u where u.actor_id=${actorId} and u.kind='ai_practice' and u.refunded_at is null
      and u.reserved_at>=${period.start} and u.reserved_at<${period.end}
      and (u.counted_at is not null
        or exists(select 1 from rounds r where r.id=u.round_id and r.status in ('scheduled','active')))) as spent,
    (select count(distinct u.round_id)::int from usage_reservations u join rounds r on r.id=u.round_id
      where u.kind='ai_practice' and r.status in ('scheduled','active')) as busy`);
  const value = facts as { spent: number; busy: number };
  return {
    limit: limit ?? 0,
    remaining: Math.max(0, (limit ?? 0) - value.spent),
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    refusal: admissionRefusal(value, limit, busyCap),
  };
}
/** Trusted composition supplies a real bound and quota policy; no environment/default entitlement is inferred. */
export function createRoundBotAdmission(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly busyCap: number;
  readonly allowance: AiRoundAllowance;
}) {
  requireBusyCap(input.busyCap);
  const reserveLocked = async (
    tx: BoundedTransactionContext,
    target: Target,
  ): Promise<Reservation> => {
    const account = await lockSponsor(tx, target);
    const current = await existingReservation(tx, target);
    if (current) return { ...target, id: current.id };
    const now = await roundAgentNow(tx);
    const status = await admissionStatus(tx, {
      actorId: target.actorId,
      limit: input.allowance(account),
      busyCap: input.busyCap,
      now,
    });
    if (status.refusal)
      throw createAppError(
        'CONFLICT',
        `Bot admission refused: ${status.refusal}`,
      );
    const id = input.nextId();
    await tx
      .insert(usageReservations)
      .values({ id, ...target, kind: 'ai_practice', reservedAt: now });
    return { ...target, id };
  };
  return {
    lock: lockBotAdmission,
    readStatus: (actorId: string) =>
      input.run(async (tx) => {
        const [account] = await lockAuthorizationActors(tx, [actorId], {
          maxActors: 1,
        });
        if (!account?.member || account.erased)
          throw createAppError('AUTHORIZATION');
        return admissionStatus(tx, {
          actorId,
          limit: input.allowance(account),
          busyCap: input.busyCap,
          now: await roundAgentNow(tx),
        });
      }),
    reserveLocked,
    reserve: (target: Target): Promise<Reservation> =>
      input.run(async (tx) => {
        await lockBotAdmission(tx);
        return reserveLocked(tx, target);
      }),
  };
}

export type RoundBotAdmission = ReturnType<typeof createRoundBotAdmission>;

export type BotAdmissionStatus = Awaited<
  ReturnType<RoundBotAdmission['readStatus']>
>;
