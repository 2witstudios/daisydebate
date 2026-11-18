import type { RatingDivision } from '@daisy/protocol';

/**
 * A league Room on a ladder rates its seats on the league's ladder, and a
 * league has no division yet (PYL S9), so its ladder is Open: in such a Room
 * a person under 18, or with no age record, holds no eligible seat (owner
 * decision 79). Every seating path and Start refuse them under the same
 * fenced read. Daisy's own ranked Rooms route by division in the engine
 * instead (`rankedSeatClaimRefusal`, `roundCompetition`).
 */
type LeagueRoomFacts = { readonly leagueLadderId: string | null };

/** Whether a Room's Round rates on a league ladder. */
export const roomOnLeagueLadder = (room: LeagueRoomFacts): boolean =>
  room.leagueLadderId !== null;

/** Whether this actor may sit in this Room; a bot always may. */
export const leagueLadderSeatFits = (
  room: LeagueRoomFacts,
  actor: {
    readonly kind: 'human' | 'bot';
    readonly division: RatingDivision | null;
  },
): boolean =>
  actor.kind !== 'human' ||
  actor.division === 'open' ||
  !roomOnLeagueLadder(room);

/** The same actor, ineligible for a seat its division keeps it from here. */
export const seatableInRoom = <
  A extends {
    readonly kind: 'human' | 'bot';
    readonly division: RatingDivision | null;
    readonly eligible: boolean;
  },
>(
  room: LeagueRoomFacts,
  actor: A | null,
): A | null =>
  actor && {
    ...actor,
    eligible: actor.eligible && leagueLadderSeatFits(room, actor),
  };
