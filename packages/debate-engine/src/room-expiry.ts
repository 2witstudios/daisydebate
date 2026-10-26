import type { RoomAssemblyState } from '@daisy/protocol';
import { acceptedRoomMutation, assemblyOpen } from './room-assembly-facts';
import { preRoundPhase } from './pre-round-phase';
import { settleRoom, survivorOf } from './resolution-draw';

/**
 * Idle means no accepted participant command since `lastCommandAt`; a
 * reveal and a running pre-round prep count as activity at their own
 * instants, never at processing time.
 */
const lastActivityMs = (room: RoomAssemblyState, lastCommandAt: string) =>
  Math.max(
    Date.parse(lastCommandAt),
    room.resolutionDraw
      ? Date.parse(survivorOf(room.resolutionDraw)?.at ?? lastCommandAt)
      : Number.NEGATIVE_INFINITY,
    room.prepStartedAt !== null && room.prepRemainingMs !== null
      ? Date.parse(room.prepStartedAt) + room.prepRemainingMs
      : Number.NEGATIVE_INFINITY,
  );

/**
 * One locked maintenance step for an open Room at the sweep's injected
 * `now`: settle any due draw strikes first, then close the Room if it is
 * idle for at least `idleTimeoutMs`. Expiry is optional (ADR 0070) and
 * never applies during an unfinished draw. Null when nothing changes.
 */
export function maintainRoom(
  room: RoomAssemblyState,
  input: {
    readonly lastCommandAt: string;
    readonly now: string;
    readonly idleTimeoutMs: number | null;
    readonly drawSeed: Uint8Array | null;
  },
) {
  if (!assemblyOpen(room)) return null;
  const settled = settleRoom(room, input.drawSeed, input.now);
  const expired =
    input.idleTimeoutMs !== null &&
    preRoundPhase(settled, input.now).phase !== 'striking' &&
    lastActivityMs(settled, input.lastCommandAt) + input.idleTimeoutMs <=
      Date.parse(input.now);
  if (!expired && settled === room) return null;
  return acceptedRoomMutation({
    ...settled,
    status: expired ? 'abandoned' : settled.status,
    changeVersion: room.changeVersion + 1,
  });
}
