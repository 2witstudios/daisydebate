import { activeRoomHref } from '@daisy/protocol';
import type {
  ActiveRoom,
  ActiveRoomFacts,
  ActiveRoomPhase,
  RoomAssemblyState,
  RoundStatus,
} from '@daisy/protocol';

type Holding = Pick<RoomAssemblyState, 'status' | 'roundRef'> & {
  /** Whether the launched Round's last speech has ended; false before Launch. */
  readonly debateEnded?: boolean;
};

/**
 * Whether a launched Round still holds its Room's members (ADR 0070): it is
 * scheduled or active and its last speech has not ended. Judges ballot from
 * their Round seats, so a Round awaiting ballots holds no one.
 */
export const roundHoldsMembers = (round: {
  readonly status: RoundStatus;
  readonly debateEnded: boolean;
}) =>
  (round.status === 'scheduled' || round.status === 'active') &&
  !round.debateEnded;

const phaseOf = (room: Holding): ActiveRoomPhase | null => {
  if (room.status === 'assembling' || room.status === 'ready')
    return room.status;
  // A started Room with no Round yet is the Launch being frozen: the Round
  // its adapter inserts in the same transaction is scheduled, so it is live.
  return room.status === 'started' &&
    (room.roundRef === null ||
      roundHoldsMembers({
        status: room.roundRef.status,
        debateEnded: room.debateEnded ?? false,
      }))
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
