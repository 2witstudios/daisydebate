import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { rooms, roomParticipants } from './schema/rooms';
import { lockedAccount, type Caller } from './room-command-facts';

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
        const account = await lockedAccount(tx, caller);
        // One statement snapshot keeps membership and Room revision coherent.
        const rows = await tx
          .select({
            roomId: rooms.id,
            hostActorId: rooms.hostActorId,
            visibility: rooms.visibility,
            status: rooms.status,
            revision: rooms.version,
            actorId: roomParticipants.actorId,
            role: roomParticipants.role,
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
            participants: rows.flatMap(({ actorId, role, slot }) =>
              actorId === null || role === null || slot === null
                ? []
                : [{ actorId, role, slot }],
            ),
          },
        };
      });
    },
  };
}
