import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { ActiveRoomFacts } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { roomActiveMemberships, roomParticipants, rooms } from './schema/rooms';
import { rounds } from './schema/rounds';

type Tx = Pick<BunSQLDatabase, 'select' | 'insert' | 'delete'>;

/**
 * Makes a Room's active memberships exactly the engine's member set (ADR
 * 0070). A member another Room already holds refuses the whole command with
 * `active-room`, so the transaction rolls back and nothing it wrote stays.
 * A competing writer's uncommitted row makes the insert wait for its
 * outcome, so of two concurrent claims on one actor exactly one commits.
 */
export async function holdActiveRoomMembers(
  tx: Tx,
  roomId: string,
  memberIds: readonly string[],
): Promise<void> {
  // Sorted, so two Rooms claiming overlapping members lock them in one order.
  const members = [...new Set(memberIds)].sort();
  await tx
    .delete(roomActiveMemberships)
    .where(
      and(
        eq(roomActiveMemberships.roomId, roomId),
        members.length > 0
          ? notInArray(roomActiveMemberships.actorId, members)
          : undefined,
      ),
    );
  if (members.length === 0) return;
  await tx
    .insert(roomActiveMemberships)
    .values(members.map((actorId) => ({ actorId, roomId })))
    .onConflictDoNothing({ target: roomActiveMemberships.actorId });
  const held = await tx
    .select({ roomId: roomActiveMemberships.roomId })
    .from(roomActiveMemberships)
    .where(inArray(roomActiveMemberships.actorId, members));
  if (held.length !== members.length || held.some((r) => r.roomId !== roomId))
    throw createAppError('CONFLICT', 'active-room');
}

/** A Round that ends frees every member of its Room: no terminal state holds anyone. */
export const releaseRoundRoomMembers = (
  tx: Pick<BunSQLDatabase, 'execute'>,
  roundId: string,
) =>
  tx.execute(
    sql`delete from ${roomActiveMemberships} where ${roomActiveMemberships.roomId} = (select ${rounds.roomId} from ${rounds} where ${rounds.id} = ${roundId})`,
  );

/** The persisted facts of the one Room an actor's membership names, or null. */
export async function activeRoomFacts(
  tx: Pick<BunSQLDatabase, 'select'>,
  actorId: string,
): Promise<ActiveRoomFacts | null> {
  const [row] = await tx
    .select({
      id: rooms.id,
      title: rooms.title,
      hostActorId: rooms.hostActorId,
      status: rooms.status,
      roundId: rounds.id,
      roundStatus: rounds.status,
      finalSegmentEndedAt: rounds.finalSegmentEndedAt,
      seatRole: roomParticipants.role,
    })
    .from(roomActiveMemberships)
    .innerJoin(rooms, eq(rooms.id, roomActiveMemberships.roomId))
    .leftJoin(rounds, eq(rounds.roomId, rooms.id))
    .leftJoin(
      roomParticipants,
      and(
        eq(roomParticipants.roomId, rooms.id),
        eq(roomParticipants.actorId, roomActiveMemberships.actorId),
      ),
    )
    .where(eq(roomActiveMemberships.actorId, actorId));
  if (!row) return null;
  return {
    room: { id: row.id, title: row.title, hostActorId: row.hostActorId },
    status: row.status,
    roundRef:
      row.roundId !== null && row.roundStatus !== null
        ? { id: row.roundId, status: row.roundStatus }
        : null,
    seatRole: row.seatRole,
    debateEnded: row.finalSegmentEndedAt !== null,
  };
}
