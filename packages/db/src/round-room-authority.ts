import { eq } from 'drizzle-orm';
import { rooms } from './schema/rooms';
import { fenceTabAccountRead } from './tab/account-read-fence';
import {
  loadRoundDirection,
  type RoomDirectionInput,
} from './tab/room-direction';
import type { Tx } from './tx';

/** Missing event authority is explicit; it never falls through to an ordinary public Round. */
export type RoundRoomAuthority =
  | { readonly kind: 'ordinary'; readonly checkedAt: string }
  | {
      readonly kind: 'event';
      readonly checkedAt: string;
      readonly direction: RoomDirectionInput | null;
    }
  | { readonly kind: 'unavailable'; readonly checkedAt: string };

export type RoundRoomSource =
  | { readonly kind: 'ordinary' }
  | { readonly kind: 'event'; readonly direction: RoomDirectionInput | null }
  | { readonly kind: 'unavailable' };

/** Caller already holds its canonical account fence; no capture/funding source grants reading rights. */
export const readRoundRoomAuthority = async (
  tx: Tx,
  input: { readonly roomId: string | null; readonly userId: string },
): Promise<RoundRoomSource> => {
  const [room] =
    input.roomId === null
      ? []
      : await tx
          .select({
            id: rooms.id,
            lobbyId: rooms.lobbyId,
            lobbyKind: rooms.lobbyKind,
            hostActorId: rooms.hostActorId,
          })
          .from(rooms)
          .where(eq(rooms.id, input.roomId));
  if (input.roomId !== null && !room)
    return {
      kind: 'unavailable',
    };
  if (!room || room.lobbyKind !== 'tournament')
    return {
      kind: 'ordinary',
    };
  await fenceTabAccountRead(tx, input.userId);
  const direction = await loadRoundDirection(tx, {
    room,
    userId: input.userId,
  });
  return {
    kind: 'event',
    direction,
  };
};
