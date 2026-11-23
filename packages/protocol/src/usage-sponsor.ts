import { isRoundRunning, type RoundStatus } from './round';

/**
 * Who may sponsor casual AI usage in a Round (a bot debater or a casual AI
 * judge): only the Round's host, with a live member account, in an unranked
 * Round that has not finished. The store applies the refusal to the account
 * and Round it read under their locks.
 */
export const casualUsageSponsorRefusal = (
  account: { readonly member: boolean; readonly erased: boolean } | null,
  round:
    | {
        readonly createdByActorId: string | null;
        readonly competitionType: string;
        readonly status: RoundStatus;
      }
    | undefined,
  actorId: string,
): 'AUTHORIZATION' | 'CONFLICT' | null => {
  if (!round || round.createdByActorId !== actorId) return 'AUTHORIZATION';
  if (!account?.member || account.erased || round.competitionType === 'ranked')
    return 'AUTHORIZATION';
  return isRoundRunning(round.status) ? null : 'CONFLICT';
};
