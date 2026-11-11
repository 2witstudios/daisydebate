import { accountEntitlements } from '@daisy/auth/authorization';
import {
  isOpenRoomStatus,
  type EntitlementGrant,
  type RoomAssemblyState,
  type RoomView,
} from '@daisy/protocol';

/** This account may broadcast or record a casual Round (WATCH-8). */
export const hostHoldsCasualCapture = (
  grants: readonly EntitlementGrant[],
  betaGrantsPremium: boolean,
  now: string,
): boolean =>
  accountEntitlements(grants, { betaGrantsPremium, now }).casualCapture;

/**
 * What this viewer can choose, for display: only the host of an open casual
 * Room is offered anything, and only their own grants are read.
 */
export async function roomCaptureOffer(
  state: Pick<RoomAssemblyState, 'hostActorId' | 'status' | 'competitionType'>,
  actorId: string,
  holds: () => Promise<boolean>,
): Promise<RoomView['captureOffer']> {
  if (
    state.competitionType === 'ranked' ||
    state.hostActorId !== actorId ||
    !isOpenRoomStatus(state.status)
  )
    return null;
  return (await holds()) ? 'included' : 'premium';
}
