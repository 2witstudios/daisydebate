import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import {
  roomLadderOf,
  roomRoundLinkOf,
  type ActiveRoomFacts,
  type RatingDivision,
} from '@daisy/protocol';
import { seatedDebaterDivisionsSql } from './ladder-division-band';
import { createRefusal } from '@daisy/errors';
import { activeSeats, roomParticipants, rooms } from './schema/rooms';
import { hostPersonOf } from './room-host';
import { rounds } from './schema/rounds';

type Tx = Pick<BunSQLDatabase, 'select' | 'insert' | 'delete'>;

/**
 * Makes a Room's active seats exactly the engine's member set (ADR 0070,
 * TAB-6): its seated humans. A member another Room already holds refuses the whole command with
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
    .delete(activeSeats)
    .where(
      and(
        eq(activeSeats.roomId, roomId),
        members.length > 0
          ? notInArray(activeSeats.actorId, members)
          : undefined,
      ),
    );
  if (members.length === 0) return;
  await tx
    .insert(activeSeats)
    .values(members.map((actorId) => ({ actorId, roomId })))
    .onConflictDoNothing({ target: activeSeats.actorId });
  const held = await tx
    .select({ roomId: activeSeats.roomId })
    .from(activeSeats)
    .where(inArray(activeSeats.actorId, members));
  if (held.length !== members.length || held.some((r) => r.roomId !== roomId))
    throw createRefusal('CONFLICT', 'active-room');
}

/** A Round that ends frees every member of its Room: no terminal state holds anyone. */
export const releaseRoundRoomMembers = (
  tx: Pick<BunSQLDatabase, 'execute'>,
  roundId: string,
) =>
  tx.execute(
    sql`delete from ${activeSeats} where ${activeSeats.roomId} = (select ${rounds.roomId} from ${rounds} where ${rounds.id} = ${roundId})`,
  );

/** A seat that left a Round frees its member alone: the Room holds the rest (TAB-6.8). */
export const releaseLeftMembers = (
  tx: Pick<BunSQLDatabase, 'execute'>,
  roundId: string,
  actorIds: readonly string[],
) =>
  actorIds.length === 0
    ? Promise.resolve()
    : tx.execute(
        sql`delete from ${activeSeats} where ${activeSeats.roomId} = (select ${rounds.roomId} from ${rounds} where ${rounds.id} = ${roundId}) and ${inArray(activeSeats.actorId, [...actorIds])}`,
      );

/** The persisted facts of the one Room an actor's active seat names, or null. */
export async function activeRoomFacts(
  tx: Pick<BunSQLDatabase, 'select'>,
  actorId: string,
): Promise<ActiveRoomFacts | null> {
  const [row] = await tx
    .select({
      id: rooms.id,
      title: rooms.title,
      hostActorId: rooms.hostActorId,
      lobbyKind: rooms.lobbyKind,
      status: rooms.status,
      roundId: rounds.id,
      roundStatus: rounds.status,
      finalSegmentEndedAt: rounds.finalSegmentEndedAt,
      seatKind: roomParticipants.seatKind,
      competitionType: rooms.competitionType,
      roundDivision: rounds.ladderDivision,
      debaterDivisions: sql<
        (RatingDivision | null)[]
      >`${seatedDebaterDivisionsSql(sql`${rooms.id}`)}`,
    })
    .from(activeSeats)
    .innerJoin(rooms, eq(rooms.id, activeSeats.roomId))
    .leftJoin(rounds, eq(rounds.roomId, rooms.id))
    .leftJoin(
      roomParticipants,
      and(
        eq(roomParticipants.roomId, rooms.id),
        eq(roomParticipants.actorId, activeSeats.actorId),
      ),
    )
    .where(eq(activeSeats.actorId, actorId));
  if (!row) return null;
  return {
    room: { id: row.id, title: row.title, hostActorId: hostPersonOf(row) },
    ...roomRoundLinkOf(
      row.status,
      row.roundId !== null && row.roundStatus !== null
        ? { id: row.roundId, status: row.roundStatus }
        : null,
    ),
    seatKind: row.seatKind,
    debateEnded: row.finalSegmentEndedAt !== null,
    ladder: roomLadderOf({
      competitionType: row.competitionType,
      launched: row.roundId !== null,
      roundDivision: row.roundDivision,
      debaterDivisions: row.debaterDivisions,
    }),
  };
}
