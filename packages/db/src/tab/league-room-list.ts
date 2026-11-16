import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { rooms, roomParticipants } from '../schema/rooms';
import { rounds } from '../schema/rounds';
import { actors } from '../schema/actors';
import { users } from '../schema/users';
import { settings } from '../schema/settings';
import { scopeTransaction } from '../tenant-scope';
import type { TabTransaction } from './tab-transaction';

/** Current standing-lobby list metadata; no ballots, results or contact details. */
export async function loadLeagueRoomList(
  tx: TabTransaction,
  input: {
    readonly viewerUserId: string;
    readonly organizationId: string;
    readonly lobbyId: string | null;
  },
) {
  if (!input.lobbyId)
    return {
      standingRooms: [],
      standingParticipants: [],
      standingRounds: [],
      standingPostingSettings: [],
    };
  await scopeTransaction(tx, {
    subjectUserId: input.viewerUserId,
    organizationId: input.organizationId,
    lobbyId: input.lobbyId,
  });
  const standingRooms = await tx
    .select()
    .from(rooms)
    .where(
      and(
        eq(rooms.lobbyId, input.lobbyId),
        inArray(rooms.status, ['assembling', 'ready', 'started']),
      ),
    )
    .orderBy(desc(rooms.createdAt))
    .limit(100)
    .for('share');
  const roomIds = standingRooms.map((room) => room.id);
  const standingParticipants = roomIds.length
    ? await tx
        .select({
          roomId: roomParticipants.roomId,
          actorId: roomParticipants.actorId,
          seatKind: roomParticipants.seatKind,
          username: users.username,
        })
        .from(roomParticipants)
        .innerJoin(actors, eq(actors.id, roomParticipants.actorId))
        .leftJoin(users, eq(users.id, actors.userId))
        .where(inArray(roomParticipants.roomId, roomIds))
    : [];
  const standingRounds = roomIds.length
    ? await tx
        .select({
          roomId: rounds.roomId,
          id: rounds.id,
          status: rounds.status,
          currentStage: rounds.currentStage,
        })
        .from(rounds)
        .where(and(inArray(rounds.roomId, roomIds), isNull(rounds.completedAt)))
        .for('share')
    : [];
  const standingPostingSettings = await tx
    .select()
    .from(settings)
    .where(
      or(
        and(
          eq(settings.scopeKind, 'organization'),
          eq(settings.organizationId, input.organizationId),
        ),
        and(
          eq(settings.scopeKind, 'lobby'),
          eq(settings.lobbyId, input.lobbyId),
        ),
      ),
    );
  return {
    standingRooms,
    standingParticipants,
    standingRounds,
    standingPostingSettings,
  };
}
