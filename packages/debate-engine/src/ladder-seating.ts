import {
  isDebatingSeat,
  seatedDivision,
  type RatingDivision,
  type RoomAssemblyState,
  type RoomRefusal,
  type SeatRef,
} from '@daisy/protocol';

/**
 * A ranked Room's ladder follows who sits (owner decision 79, ADR 0147): its
 * seated human debaters set the division, judges never do, and a bot holds
 * no ranked debater seat at all.
 */
type Seated = Pick<
  RoomAssemblyState['participants'][number],
  'actorId' | 'kind' | 'seat' | 'division'
>;

/**
 * Whether a member may take this ranked debater seat themselves. A member's
 * own claim must fit the ladder the others already set, so an adult takes no
 * Youth debater seat and a minor no Open one; with no division they take no
 * ranked debater seat. A host's assignment is not refused here: a seating the
 * host mixes plays casual (`roundCompetition`). Judge seats take anyone.
 */
export function rankedSeatClaimRefusal(
  room: {
    readonly competitionType: RoomAssemblyState['competitionType'];
    readonly participants: readonly Seated[];
  },
  claim: {
    readonly type: 'claim-seat' | 'assign-seat';
    readonly seat: SeatRef;
  },
  target: {
    readonly actorId: string;
    readonly kind: 'human' | 'bot';
    readonly division: RatingDivision | null;
  },
): RoomRefusal | null {
  if (
    room.competitionType !== 'ranked' ||
    claim.type !== 'claim-seat' ||
    target.kind !== 'human' ||
    !isDebatingSeat(claim.seat)
  )
    return null;
  if (target.division === null) return 'ranked-division';
  const others = seatedDivision(
    room.participants.filter((p) => p.actorId !== target.actorId),
  );
  return (others === 'open' || others === 'youth') && others !== target.division
    ? 'ranked-division'
    : null;
}
