import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';

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
 * Only the Round's host sponsors a bot. Admission also needs a live member
 * account and an unranked Round that has not finished; settlement does not.
 */
export function requireSponsor(
  account: Account,
  round: Round | undefined,
  actorId: string,
  purpose: 'admission' | 'settlement',
): void {
  if (!round || round.createdByActorId !== actorId)
    throw createAppError('AUTHORIZATION');
  if (purpose === 'settlement') return;
  if (!account?.member || account.erased || round.competitionType === 'ranked')
    throw createAppError('AUTHORIZATION');
  if (!['scheduled', 'active'].includes(round.status))
    throw createAppError('CONFLICT');
}

/** A refunded reservation is never reused outside its own refund. */
export function requireUnrefundedReservation<R extends ReservationRow>(
  row: R | undefined,
  allowRefunded: boolean,
): R | undefined {
  if (row?.refundedAt && !allowRefunded)
    throw createAppError('CONFLICT', 'Reservation refunded');
  return row;
}

/**
 * Counting is idempotent at the first model call; a refund needs a counted
 * reservation and happens once.
 */
export function reservationMutation(
  current: ReservationRow | undefined,
  reservationId: string,
  refund: boolean,
): 'count' | 'refund' | 'none' {
  if (!current || current.id !== reservationId)
    throw createAppError('AUTHORIZATION');
  if (!refund) return 'count';
  if (!current.countedAt) throw createAppError('CONFLICT');
  return current.refundedAt ? 'none' : 'refund';
}

/** Refusal order: the sponsor's allowance, then global capacity. */
export function admissionRefusal(
  facts: { readonly spent: number; readonly busy: number },
  limit: number,
  busyCap: number,
): 'allowance' | 'capacity' | null {
  if (facts.spent >= limit) return 'allowance';
  return facts.busy >= busyCap ? 'capacity' : null;
}

export function requireBusyCap(busyCap: number): void {
  if (!Number.isSafeInteger(busyCap) || busyCap < 1)
    throw createAppError(
      'VALIDATION',
      'Explicit positive bot capacity required',
    );
}
