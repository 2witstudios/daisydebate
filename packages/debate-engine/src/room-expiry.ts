import { isOpenRoomStatus, type RoomAssemblyState } from '@daisy/protocol';
import { acceptedRoomMutation } from './room-assembly-facts';
import { closeRoom } from './room-consent-transitions';

/**
 * One locked maintenance step for an open Room at the sweep's injected
 * `now`: close it if no participant has acted for at least `idleTimeoutMs`.
 * Expiry is optional (ADR 0070). Null when nothing changes.
 */
export function maintainRoom(
  room: RoomAssemblyState,
  input: {
    readonly lastCommandAt: string;
    readonly now: string;
    readonly idleTimeoutMs: number | null;
  },
) {
  if (!isOpenRoomStatus(room.status) || input.idleTimeoutMs === null)
    return null;
  if (
    Date.parse(input.lastCommandAt) + input.idleTimeoutMs >
    Date.parse(input.now)
  )
    return null;
  return acceptedRoomMutation({
    ...closeRoom(room),
    changeVersion: room.changeVersion + 1,
  });
}
