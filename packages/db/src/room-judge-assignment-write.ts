import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { RoomAssemblyState } from '@daisy/protocol';
import { rooms, roomParticipants } from './schema/rooms';
import { rounds } from './schema/rounds';
import { persistRoomOutsideCommands } from './room-mutation-persistence';
import { roomFacts } from './room-command-facts';
import type { Tx } from './tx';

export type JudgeRoomMembers = (
  state: RoomAssemblyState & { readonly debateEnded: boolean },
) => readonly string[];
/** The ordinary Room owner changes its mirror atomically; a replacement has no inherited Ready consent. */
export async function writeLockedRoomJudge(
  tx: Tx,
  input: {
    readonly roomId: string;
    readonly slot: number;
    readonly previousParticipantId: string | null;
    readonly next: { readonly id: string; readonly actorId: string } | null;
    readonly now: string;
    readonly members: JudgeRoomMembers;
    readonly afterChange: (state: RoomAssemblyState) => RoomAssemblyState;
  },
) {
  const [mirror] = await tx
    .select()
    .from(roomParticipants)
    .where(
      and(
        eq(roomParticipants.roomId, input.roomId),
        eq(roomParticipants.seatKind, 'judge'),
        eq(roomParticipants.slot, input.slot),
      ),
    );
  if ((mirror?.id ?? null) !== input.previousParticipantId)
    throw createAppError('CONFLICT', 'Room judge identity changed');
  if (mirror)
    await tx.delete(roomParticipants).where(eq(roomParticipants.id, mirror.id));
  if (input.next)
    await tx.insert(roomParticipants).values({
      id: input.next.id,
      roomId: input.roomId,
      actorId: input.next.actorId,
      seatKind: 'judge',
      side: null,
      slot: input.slot,
      readinessCommandId: null,
      readinessVersion: 0,
    });
  const [room] = await tx
    .update(rooms)
    .set({
      version: sql`${rooms.version}+1`,
      updatedAt: new Date(input.now),
      lastCommandAt: new Date(input.now),
    })
    .where(eq(rooms.id, input.roomId))
    .returning();
  if (!room) throw createAppError('INVARIANT');
  const { state } = await roomFacts(tx, room);
  const [source] =
    state.status === 'started'
      ? await tx
          .select({ endedAt: rounds.finalSegmentEndedAt })
          .from(rounds)
          .where(
            and(eq(rounds.id, state.roundRef.id), eq(rounds.roomId, room.id)),
          )
      : [];
  if (state.status === 'started' && !source) throw createAppError('INVARIANT');
  const next = input.afterChange(state);
  await persistRoomOutsideCommands(
    tx,
    state,
    next,
    (current) =>
      input.members({
        ...current,
        debateEnded: source !== undefined && source.endedAt !== null,
      }),
    input.now,
  );
  return next;
}
