import { rooms, roomParticipants } from './schema/rooms';
import { rounds } from './schema/rounds';
import { roundParticipants } from './schema/round-participants';

/** Minimal Room audience columns shared by every Room authority reader. */
export const roomAudienceColumns = {
  roomId: rooms.id,
  hostActorId: rooms.hostActorId,
  visibility: rooms.visibility,
  status: rooms.status,
  revision: rooms.version,
  actorId: roomParticipants.actorId,
  role: roomParticipants.role,
  slot: roomParticipants.slot,
};
/** Minimal Round audience columns shared by every Round authority reader. */
export const roundAudienceColumns = {
  roundId: rounds.id,
  createdByActorId: rounds.createdByActorId,
  visibility: rounds.visibility,
  status: rounds.status,
  revision: rounds.version,
  actorId: roundParticipants.actorId,
  role: roundParticipants.role,
  slot: roundParticipants.slot,
};
/** Seats from a left-joined audience read; an unseated parent row contributes none. */
export function audienceParticipants<Role>(
  rows: readonly {
    readonly actorId: string | null;
    readonly role: Role | null;
    readonly slot: number | null;
  }[],
) {
  return rows.flatMap(({ actorId, role, slot }) =>
    actorId === null || role === null || slot === null
      ? []
      : [{ actorId, role, slot }],
  );
}
