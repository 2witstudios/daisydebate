import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { RoomAssemblyState } from '@daisy/protocol';
import { rooms, roomParticipants, roomSeatHolds } from './schema/rooms';
import { appendRoomChanged, roomFacts, type Tx } from './room-command-facts';
import { persistRoomOutsideCommands } from './room-mutation-persistence';
import { endMemberRoomInvitations } from './room-invitations/store';
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
  const released = await tx
    .delete(roomSeatHolds)
    .where(eq(roomSeatHolds.actorId, actorId))
    .returning({ roomId: roomSeatHolds.roomId });
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
  // Those Rooms' seats did not change, so nobody is asked to ready again; a
  // member on the page only needs to read that the seat is free.
  const written = new Set(held.map((row) => row.id));
  // Their invitations, sent or received, end with them (ADR 0124).
  const invited = await endMemberRoomInvitations(tx, actorId, {
    now: context.now,
    written,
  });
  const heldOnly = [
    ...new Set([...released.map((hold) => hold.roomId), ...invited]),
  ]
    .filter((roomId) => !written.has(roomId))
    .sort();
  for (const roomId of heldOnly) {
    const [rung] = await tx
      .update(rooms)
      .set({ changeVersion: sql`${rooms.changeVersion} + 1` })
      .where(and(eq(rooms.id, roomId), roomIsOpen()))
      .returning({ changeVersion: rooms.changeVersion });
    if (rung) await appendRoomChanged(tx, roomId, rung.changeVersion);
  }
}
