import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { idSchema, type SeatKind } from '@daisy/protocol';
import { seatOfColumns } from './seat-columns';
import { createAppError } from '@daisy/errors';
import { rooms, roomParticipants } from './schema/rooms';
import { rounds } from './schema/rounds';
import { roundParticipants } from './schema/round-participants';
import { sharedAccount, type Caller } from './room-command-facts';

type AuthorizationParticipant = {
  readonly actorId: string | null;
  readonly seatKind: SeatKind | null;
  readonly side: string | null;
  readonly slot: number | null;
};

function projectParticipants(rows: readonly AuthorizationParticipant[]) {
  return rows.flatMap(({ actorId, seatKind, side, slot }) =>
    actorId === null || seatKind === null || slot === null
      ? []
      : [{ actorId, seat: seatOfColumns({ seatKind, side, slot }) }],
  );
}

/** Minimal durable authority facts; no Room content, format or display-label hydration. */
export function roomAuthorizationRead({
  database,
}: {
  readonly database: BunSQLDatabase;
}) {
  return {
    readRoomAuthorizationFacts: async (roomId: string, caller: Caller) => {
      if (!idSchema.safeParse(roomId).success)
        throw createAppError('VALIDATION');
      return database.transaction(async (tx) => {
        const account = await sharedAccount(tx, caller);
        // One statement snapshot keeps membership and Room revision coherent.
        const rows = await tx
          .select({
            roomId: rooms.id,
            hostActorId: rooms.hostActorId,
            visibility: rooms.visibility,
            status: rooms.status,
            revision: rooms.version,
            actorId: roomParticipants.actorId,
            seatKind: roomParticipants.seatKind,
            side: roomParticipants.side,
            slot: roomParticipants.slot,
          })
          .from(rooms)
          .leftJoin(roomParticipants, eq(roomParticipants.roomId, rooms.id))
          .where(eq(rooms.id, roomId));
        const room = rows[0];
        if (!room) return null;
        return {
          account,
          resource: {
            kind: 'room' as const,
            roomId: room.roomId,
            hostActorId: room.hostActorId,
            visibility: room.visibility,
            status: room.status,
            revision: room.revision,
            participants: projectParticipants(rows),
          },
        };
      });
    },
    readRoundAuthorizationFacts: async (roundId: string, caller: Caller) => {
      if (!idSchema.safeParse(roundId).success)
        throw createAppError('VALIDATION');
      return database.transaction(async (tx) => {
        const account = await sharedAccount(tx, caller);
        const rows = await tx
          .select({
            roundId: rounds.id,
            createdByActorId: rounds.createdByActorId,
            visibility: rounds.visibility,
            status: rounds.status,
            revision: rounds.version,
            actorId: roundParticipants.actorId,
            seatKind: roundParticipants.seatKind,
            side: roundParticipants.side,
            slot: roundParticipants.slot,
          })
          .from(rounds)
          .leftJoin(roundParticipants, eq(roundParticipants.roundId, rounds.id))
          .where(eq(rounds.id, roundId));
        const round = rows[0];
        // Older standalone rows have no persisted audience. They cannot be
        // assigned a visibility by inference from their creator or seats.
        if (
          !round ||
          (round.visibility !== 'public' &&
            round.visibility !== 'unlisted' &&
            round.visibility !== 'private')
        )
          return null;
        return {
          account,
          resource: {
            kind: 'round' as const,
            roundId: round.roundId,
            createdByActorId: round.createdByActorId,
            visibility: round.visibility,
            status: round.status,
            revision: round.revision,
            participants: projectParticipants(rows),
          },
        };
      });
    },
  };
}
