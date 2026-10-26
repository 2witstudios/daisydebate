import type { RoomAssemblyState } from '@daisy/protocol';
import { acceptedRoomMutation, assemblyOpen } from './room-assembly-facts';

/**
 * Idle means no accepted Room command (creation, seat, settings, consent or
 * prep) since `lastCommandAt`; a running pre-round prep counts as activity
 * until its clock runs out.
 */
const lastActivityMs = (
  room: Pick<RoomAssemblyState, 'prepStartedAt' | 'prepRemainingMs'>,
  lastCommandAt: string,
) =>
  Math.max(
    Date.parse(lastCommandAt),
    room.prepStartedAt !== null && room.prepRemainingMs !== null
      ? Date.parse(room.prepStartedAt) + room.prepRemainingMs
      : Number.NEGATIVE_INFINITY,
  );

/**
 * Closes an open Room idle for at least `idleTimeoutMs` as of `now`, the
 * maintenance sweep's injected instant. Anything else is not expired: null.
 */
export function expireIdleRoom(
  room: RoomAssemblyState,
  input: {
    readonly lastCommandAt: string;
    readonly now: string;
    readonly idleTimeoutMs: number;
  },
) {
  if (
    !assemblyOpen(room) ||
    lastActivityMs(room, input.lastCommandAt) + input.idleTimeoutMs >
      Date.parse(input.now)
  )
    return null;
  return acceptedRoomMutation({
    ...room,
    status: 'abandoned',
    changeVersion: room.changeVersion + 1,
  });
}
