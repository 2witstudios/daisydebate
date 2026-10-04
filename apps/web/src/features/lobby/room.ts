/**
 * A room as the lobby lists it (ADR 0049 section 1: the lobby is the public
 * browsing surface of open rooms). This is a read model for the list, not the
 * stored room: the backend listing fills it from `rooms`, seats and presence.
 */

export type RoomMode = 'ranked' | 'casual';

/** Who judges: a person, the placeholder AI judge, or Daisy's assignment. */
type RoomJudge = 'person' | 'ai' | 'assigned';

/** One seated debater: a public username and their rating. */
type RoomPlayer = {
  readonly handle: string;
  readonly rating: number;
};

/** Accepted ratings for the open seat; a `null` end is unbounded. */
export type RatingBand = {
  readonly min: number | null;
  readonly max: number | null;
};

type RoomBase = {
  readonly id: string;
  /** Host-chosen display name. Not in ADR 0049's room yet. */
  readonly name: string;
  readonly mode: RoomMode;
  /** Casual only: ranked always runs the canonical rules (ADR 0030). */
  readonly customRules: boolean;
  /** Ranked rooms always have Daisy assign the judge. */
  readonly judge: RoomJudge;
  readonly host: RoomPlayer;
};

/** A table with an open seat, waiting for an opponent. */
export type OpenRoom = RoomBase & {
  readonly status: 'open';
  readonly band: RatingBand;
  /** UTC ISO timestamp. */
  readonly waitingSince: string;
};

/** A debate in progress that anyone can spectate. */
export type LiveRoom = RoomBase & {
  readonly status: 'live';
  readonly opponent: RoomPlayer;
  readonly watching: number;
};

export type RoomListItem = OpenRoom | LiveRoom;

/** The rating a room is ranked by: the host's, or both players' mean. */
export const roomRating = (room: RoomListItem): number =>
  room.status === 'open'
    ? room.host.rating
    : Math.round((room.host.rating + room.opponent.rating) / 2);

/** Whether a rating falls inside the band, both ends inclusive. */
export const bandAccepts = (band: RatingBand, rating: number): boolean =>
  (band.min === null || rating >= band.min) &&
  (band.max === null || rating <= band.max);
