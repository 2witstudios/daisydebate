import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';
import { lockAuthorizationActors } from './authorization';
import { roundAgentNow } from './round-agent-runs';
import { readBotAllowance } from './round-bot-allowance';
import { rounds } from './schema/rounds';
import { usageReservations } from './schema/usage-reservations';
import {
  admissionRefusal,
  requireAdmissionTarget,
  requireBusyCap,
  requireReservationProvenance,
  requireSponsor,
  reservationMutation,
} from './round-bot-admission-rules';

type Target = { readonly actorId: string; readonly roundId: string };
type Reservation = Target & { readonly id: string };
/** Acquire before account/Room/Round locks in both admission and billable-call composition. */
export const lockBotAdmission = (tx: BoundedTransactionContext) =>
  tx.execute(sql`select pg_advisory_xact_lock(59003, 1)`);
async function lockSponsor(
  tx: BoundedTransactionContext,
  target: Target,
  purpose: 'admission' | 'settlement' = 'admission',
) {
  requireAdmissionTarget(target);
  const [account] = await lockAuthorizationActors(tx, [target.actorId], {
    maxActors: 1,
  });
  const [round] = await tx
    .select()
    .from(rounds)
    .where(eq(rounds.id, target.roundId))
    .for('no key update');
  requireSponsor(account ?? null, round, target.actorId, purpose);
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
  allowRefunded = false,
) {
  const [row] = await tx
    .select()
    .from(usageReservations)
    .where(reservationWhere(target))
    .for('update');
  return requireReservationProvenance(row, allowRefunded);
}
async function mutateLockedReservation(
  tx: BoundedTransactionContext,
  reservation: Reservation,
  refund: boolean,
) {
  await lockSponsor(tx, reservation, refund ? 'settlement' : 'admission');
  const current = await existingReservation(tx, reservation, refund);
  const mutation = reservationMutation(current, reservation.id, refund);
  if (mutation === 'none') return;
  await tx
    .update(usageReservations)
    .set(
      mutation === 'refund'
        ? { refundedAt: sql`clock_timestamp()` }
        : { countedAt: current!.countedAt ?? sql`clock_timestamp()` },
    )
    .where(eq(usageReservations.id, reservation.id));
}
/** Caller acquires admission serialization before command/account/Round fences. Never creates a reservation. */
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
  await mutateLockedReservation(tx, reservation, false);
  return reservation;
}
async function admissionStatus(
  tx: BoundedTransactionContext,
  actorId: string,
  busyCap: number,
  now: Date,
) {
  const allowance = await readBotAllowance(tx, actorId, now);
  const [facts] = await tx.execute(sql`select
    (select count(*)::int from usage_reservations where actor_id=${actorId} and kind='ai_practice' and reserved_at is null) as unknown,
    (select count(*)::int from usage_reservations where actor_id=${actorId} and kind='ai_practice' and refunded_at is null
      and reserved_at>=${allowance.start} and reserved_at<${allowance.end}) as spent,
    (select count(distinct u.round_id)::int from usage_reservations u join rounds r on r.id=u.round_id
      where u.kind='ai_practice' and r.status in ('scheduled','active')) as busy`);
  const value = facts as { unknown: number; spent: number; busy: number };
  return {
    limit: allowance.limit,
    remaining: Math.max(0, allowance.limit - value.spent),
    periodStart: allowance.start.toISOString(),
    periodEnd: allowance.end.toISOString(),
    refusal: admissionRefusal(value, allowance.limit, busyCap),
  };
}
/** Trusted composition supplies a real bound; no environment/default entitlement is inferred. */
export function createRoundBotAdmission(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly busyCap: number;
}) {
  requireBusyCap(input.busyCap);
  const mutate = (reservation: Reservation, refund: boolean) =>
    input.run(async (tx) => {
      await lockBotAdmission(tx);
      await mutateLockedReservation(tx, reservation, refund);
    });
  const reserveLocked = async (
    tx: BoundedTransactionContext,
    target: Target,
  ): Promise<Reservation> => {
    await lockSponsor(tx, target);
    const current = await existingReservation(tx, target);
    if (current) return { ...target, id: current.id };
    const status = await admissionStatus(
      tx,
      target.actorId,
      input.busyCap,
      await roundAgentNow(tx),
    );
    if (status.refusal)
      throw createAppError(
        'CONFLICT',
        `Bot admission refused: ${status.refusal}`,
      );
    const id = input.nextId();
    await tx
      .insert(usageReservations)
      .values({ id, ...target, kind: 'ai_practice' });
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
        return admissionStatus(
          tx,
          actorId,
          input.busyCap,
          await roundAgentNow(tx),
        );
      }),
    reserveLocked,
    reserve: (target: Target): Promise<Reservation> =>
      input.run(async (tx) => {
        await lockBotAdmission(tx);
        return reserveLocked(tx, target);
      }),
    markFirstModelCall: (reservation: Reservation) =>
      mutate(reservation, false),
    /** Trusted server known-vendor-abort settlement, never a public client reason or new model authorization. */
    refundVendorFailure: (reservation: Reservation) =>
      mutate(reservation, true),
  };
}

export type RoundBotAdmission = ReturnType<typeof createRoundBotAdmission>;

export type BotAdmissionStatus = Awaited<
  ReturnType<RoundBotAdmission['readStatus']>
>;
