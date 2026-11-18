import { activeRoomHref, isRoundRunning } from '@daisy/protocol';
import type {
  ActiveRoom,
  ActiveRoomFacts,
  OpenRoomStatus,
  RoomAssemblyState,
  RoomRoundLink,
  RoundStatus,
} from '@daisy/protocol';

type Holding = RoomRoundLink & {
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
}) => isRoundRunning(round.status) && !round.debateEnded;

/** Where a Room holds its members, with the Round a live one is held by; null once it holds no one. */
const holdOf = (
  room: Holding,
):
  | { readonly phase: OpenRoomStatus; readonly roundId: null }
  | { readonly phase: 'live'; readonly roundId: string }
  | null => {
  switch (room.status) {
    case 'assembling':
    case 'ready':
      return { phase: room.status, roundId: null };
    case 'started':
      return roundHoldsMembers({
        status: room.roundRef.status,
        debateEnded: room.debateEnded ?? false,
      })
        ? { phase: 'live', roundId: room.roundRef.id }
        : null;
    case 'closed':
      return null;
  }
};

/**
 * The human actors a Room holds as its active members (ADR 0070, TAB-6):
 * every seated human while it assembles or its Round is live. A seat is what
 * holds a person; a host without one is not held, so a seatless host may host
 * several standing Rooms (TAB-6.16) and an organiser acting by grant is never
 * held. The one exception is a Room that `holdsHost`: a Train practice, which
 * holds its creator from create and through every later command, so a second
 * Start practice returns to it (decision 75). Bots hold no membership. A
 * closed Room and a finished Round hold no one, so every terminal state frees
 * its members for a new Room.
 */
export const activeRoomMembers = (
  room: Holding &
    Pick<RoomAssemblyState, 'participants'> &
    Partial<Pick<RoomAssemblyState, 'hostActorId' | 'holdsHost'>>,
): readonly string[] =>
  holdOf(room) === null
    ? []
    : [
        ...new Set([
          ...(room.holdsHost === true && room.hostActorId
            ? [room.hostActorId]
            : []),
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
  const hold = holdOf(facts);
  const role = facts.room.hostActorId === actorId ? 'host' : facts.seatKind;
  if (hold === null || role === null) return null;
  return {
    version: 1,
    id: facts.room.id,
    title: facts.room.title,
    phase: hold.phase,
    role,
    seated: facts.seatKind !== null,
    href: activeRoomHref({ ...hold, roomId: facts.room.id }),
  };
}
