import { and, eq, inArray, or } from 'drizzle-orm';
import type { RoomAssemblyState } from '@daisy/protocol';
import { rooms, roomParticipants, roomSeatHolds } from './schema/rooms';
import { roomFacts, type Tx } from './room-command-facts';
import { persistRoomOutsideCommands } from './room-mutation-persistence';
import { roomIsOpen } from './room-open';

/** The engine's pure Room rules a restriction applies, injected by the caller. */
export type RoomReleaseRules = {
  readonly releaseMember: (
    room: RoomAssemblyState,
    actorId: string,
  ) => RoomAssemblyState;
  readonly activeRoomMembers: (room: RoomAssemblyState) => readonly string[];
};

/**
 * What a restriction does to the open Rooms a member sits in or hosts
 * (DEC-331), under each Room's row lock and the subject's account fence, never
 * through the public Room command fence. A started Room's seats are the Round's
 * record and are not touched here.
 */
export async function releaseMemberFromRooms(
  tx: Tx,
  actorId: string,
  context: { readonly now: string; readonly rules: RoomReleaseRules },
): Promise<void> {
  // A seat held for them would make the others wait out its time.
  await tx.delete(roomSeatHolds).where(eq(roomSeatHolds.actorId, actorId));
  const seated = tx
    .select({ id: roomParticipants.roomId })
    .from(roomParticipants)
    .where(eq(roomParticipants.actorId, actorId));
  const held = await tx
    .select()
    .from(rooms)
    .where(
      and(
        or(eq(rooms.hostActorId, actorId), inArray(rooms.id, seated)),
        roomIsOpen(),
      ),
    )
    .orderBy(rooms.id)
    .for('update');
  for (const row of held) {
    const { state } = await roomFacts(tx, row);
    await persistRoomOutsideCommands(
      tx,
      state,
      context.rules.releaseMember(state, actorId),
      context.rules.activeRoomMembers,
      context.now,
    );
  }
}
