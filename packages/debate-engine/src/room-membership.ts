import { activeRoomHref } from '@daisy/protocol';
import type {
  ActiveRoom,
  ActiveRoomFacts,
  ActiveRoomPhase,
  RoomAssemblyState,
} from '@daisy/protocol';

type Holding = Pick<RoomAssemblyState, 'status' | 'roundRef'>;

const phaseOf = (room: Holding): ActiveRoomPhase | null => {
  if (room.status === 'assembling' || room.status === 'ready')
    return room.status;
  // A started Room with no Round yet is the Launch being frozen: the Round
  // its adapter inserts in the same transaction is scheduled, so it is live.
  return room.status === 'started' &&
    (room.roundRef === null ||
      room.roundRef.status === 'scheduled' ||
      room.roundRef.status === 'active')
    ? 'live'
    : null;
};

/**
 * The human actors a Room holds as its active members (ADR 0070): the host
 * and every seated human while it assembles or its Round is live. Bots hold
 * no membership. A closed Room and a finished Round hold no one, so every
 * terminal state frees its members for a new Room.
 */
export const activeRoomMembers = (
  room: Holding & Pick<RoomAssemblyState, 'hostActorId' | 'participants'>,
): readonly string[] =>
  phaseOf(room) === null
    ? []
    : [
        ...new Set([
          room.hostActorId,
          ...room.participants
            .filter((p) => p.kind === 'human')
            .map((p) => p.actorId),
        ]),
      ];

/** The member's own read of their active Room, or null once it holds them no longer. */
export function projectActiveRoom(
  facts: ActiveRoomFacts,
  actorId: string,
): ActiveRoom | null {
  const phase = phaseOf(facts);
  const role =
    facts.room.hostActorId === actorId
      ? 'host'
      : facts.seatRole === null
        ? null
        : facts.seatRole === 'judge'
          ? 'judge'
          : 'debater';
  if (phase === null || role === null) return null;
  if (phase === 'live' && facts.roundRef === null) return null;
  return {
    version: 1,
    id: facts.room.id,
    title: facts.room.title,
    phase,
    role,
    href: activeRoomHref({
      phase,
      roomId: facts.room.id,
      roundId: facts.roundRef?.id ?? null,
    }),
  };
}
