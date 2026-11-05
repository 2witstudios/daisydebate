import { accountEntitlements } from '@daisy/auth/authorization';
import type {
  EntitlementGrant,
  RoomAssemblyState,
  RoomView,
} from '@daisy/protocol';

/** This account may seat an AI judge on a casual Round (WATCH-16). */
export const hostHoldsCasualAiJudge = (
  grants: readonly EntitlementGrant[],
  betaGrantsPremium: boolean,
  now: string,
): boolean =>
  accountEntitlements(grants, { betaGrantsPremium, now }).casualAiJudge;

/**
 * What seating an AI judge means to this viewer, for display. Only the host
 * of an open Room seats, and only a casual host's own grants are read.
 */
export async function roomAiJudgeSeating(
  state: Pick<RoomAssemblyState, 'hostActorId' | 'status' | 'competitionType'>,
  actorId: string,
  holds: () => Promise<boolean>,
): Promise<RoomView['aiJudgeSeating']> {
  if (
    state.hostActorId !== actorId ||
    state.status === 'started' ||
    state.status === 'closed'
  )
    return null;
  if (state.competitionType === 'ranked') return 'free';
  return (await holds()) ? 'included' : 'premium';
}
