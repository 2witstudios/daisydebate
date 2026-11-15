import { eq } from 'drizzle-orm';
import { rooms } from './schema/rooms';
import { readDatabaseTime } from './database-clock';
import { fenceTabAccountRead } from './tab/account-read-fence';
import {
  loadRoundDirection,
  type RoomDirectionInput,
} from './tab/room-direction';
import type { TabTransaction } from './tab/tab-transaction';

/** Missing event authority is explicit; it never falls through to an ordinary public Round. */
export type RoundRoomAuthority =
  | { readonly kind: 'ordinary'; readonly checkedAt: string }
  | {
      readonly kind: 'event';
      readonly checkedAt: string;
      readonly direction: RoomDirectionInput | null;
    }
  | { readonly kind: 'unavailable'; readonly checkedAt: string };

/** Caller already holds its canonical account fence; no capture/funding source grants reading rights. */
export const readRoundRoomAuthority = async (
  tx: TabTransaction,
  input: { readonly roomId: string | null; readonly userId: string },
): Promise<RoundRoomAuthority> => {
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
      checkedAt: (await readDatabaseTime(tx)).toISOString(),
    };
  if (!room || room.lobbyKind !== 'tournament')
    return {
      kind: 'ordinary',
      checkedAt: (await readDatabaseTime(tx)).toISOString(),
    };
  await fenceTabAccountRead(tx, input.userId);
  const direction = await loadRoundDirection(tx, {
    room,
    userId: input.userId,
  });
  return {
    kind: 'event',
    direction,
    checkedAt: (await readDatabaseTime(tx)).toISOString(),
  };
};
