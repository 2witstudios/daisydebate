import { createAppError } from '@daisy/errors';
import { idSchema, isRoundRunning, type RoundStatus } from '@daisy/protocol';

type Account = {
  readonly member: boolean;
  readonly erased: boolean;
} | null;
type Round = {
  readonly createdByActorId: string | null;
  readonly competitionType: string;
  readonly status: RoundStatus;
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
 * Only the Round's host sponsors casual AI usage, with a live member account and an
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
  if (!isRoundRunning(round.status)) throw createAppError('CONFLICT');
}
