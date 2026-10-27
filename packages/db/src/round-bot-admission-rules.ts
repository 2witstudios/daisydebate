import { createAppError } from '@daisy/errors';
import { idSchema, type botAdmissionRefusals } from '@daisy/protocol';

type Account = {
  readonly member: boolean;
  readonly erased: boolean;
} | null;
type Round = {
  readonly createdByActorId: string | null;
  readonly competitionType: string;
  readonly status: string;
};
type ReservationRow = {
  readonly id: string;
  readonly reservedAt: Date;
  readonly countedAt: Date | null;
  readonly refundedAt: Date | null;
};

export function requireAdmissionTarget(target: {
  readonly actorId: string;
  readonly roundId: string;
}): void {
  if (
    ![target.actorId, target.roundId].every(
      (id) => idSchema.safeParse(id).success,
    )
  )
    throw createAppError('VALIDATION');
}

/**
 * Only the Round's host sponsors a bot, with a live member account and an
 * unranked Round that has not finished.
 */
export function requireSponsor(
  account: Account,
  round: Round | undefined,
  actorId: string,
): void {
  if (!round || round.createdByActorId !== actorId)
    throw createAppError('AUTHORIZATION');
  if (!account?.member || account.erased || round.competitionType === 'ranked')
    throw createAppError('AUTHORIZATION');
  if (!['scheduled', 'active'].includes(round.status))
    throw createAppError('CONFLICT');
}

/** A refunded reservation is never reused (refunds happen at Round end, DEC-211). */
export function requireUnrefundedReservation<R extends ReservationRow>(
  row: R | undefined,
): R | undefined {
  if (row?.refundedAt) throw createAppError('CONFLICT', 'Reservation refunded');
  return row;
}

/** The reservation found under lock is the one being counted. */
export function requireOwnReservation<R extends ReservationRow>(
  current: R | undefined,
  reservationId: string,
): R {
  if (!current || current.id !== reservationId)
    throw createAppError('AUTHORIZATION');
  return current;
}

/**
 * Refusal order: the sponsor's eligibility (a null limit), its allowance,
 * then global live bot-debater capacity.
 */
export function admissionRefusal(
  facts: { readonly spent: number; readonly busy: number },
  limit: number | null,
  busyCap: number,
): (typeof botAdmissionRefusals)[number] | null {
  if (limit === null) return 'not-eligible';
  if (facts.spent >= limit) return 'allowance';
  return capacityRefusal(facts.busy, busyCap);
}

/** Global live bot-debater capacity, the only check a ranked bot Round takes. */
export const capacityRefusal = (busy: number, busyCap: number) =>
  busy >= busyCap ? ('capacity' as const) : null;

/** DEC-183: the allowance period is the exact UTC calendar month holding `now`. */
export function utcMonth(now: Date) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

export function requireBusyCap(busyCap: number): void {
  if (!Number.isSafeInteger(busyCap) || busyCap < 1)
    throw createAppError(
      'VALIDATION',
      'Explicit positive bot capacity required',
    );
}
