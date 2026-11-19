import type { RatingDivision } from '@daisy/protocol';

/**
 * A league Room on a ladder rates its seats on the league's ladder, and a
 * league carries one division (PYL-16, decision 79): Open is 18 and over,
 * Youth under 18. In such a Room a person outside the league's division,
 * or with no age record, holds no eligible seat; every seating path and
 * Start refuse them under the same fenced read. Daisy's own ranked Rooms
 * route by division in the engine instead (`rankedSeatClaimRefusal`,
 * `roundCompetition`).
 */
export type LeagueRoomFacts = {
  /** The division of the league ladder this Room rates on; null when it rates on none. */
  readonly leagueDivision: RatingDivision | null;
};

/** Whether a Room's Round rates on a league ladder. */
const roomOnLeagueLadder = (room: LeagueRoomFacts): boolean =>
  room.leagueDivision !== null;

/** Whether this actor may sit in this Room; a bot always may. */
export const leagueLadderSeatFits = (
  room: LeagueRoomFacts,
  actor: {
    readonly kind: 'human' | 'bot';
    readonly division: RatingDivision | null;
  },
): boolean =>
  actor.kind !== 'human' ||
  !roomOnLeagueLadder(room) ||
  actor.division === room.leagueDivision;

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
