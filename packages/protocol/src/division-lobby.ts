import type { RatingDivision } from './ladder';
import { isDebatingSeat, type SeatRef } from './seats';

/**
 * Two lobbies, Open and Youth (owner decision 85, ADR 0155). They are the
 * divisions of ADR 0147 as members browse them, not the `lobbies` container a
 * Room lives in: every Room still sits in its container, and carries the
 * division it was created in. These rules decide who lands where, which
 * division a new Room takes, who may sit, and who may watch a Round live.
 */

/**
 * The lobby a member lands in: their own division. A member with no valid
 * age record has no division; they browse Open and debate nowhere ranked.
 */
export const lobbyOf = (viewer: {
  readonly division: RatingDivision | null;
}): RatingDivision => viewer.division ?? 'open';

/** Who creates a Room, as its division is decided. */
export type RoomCreator = {
  readonly division: RatingDivision | null;
  /** Owns a club, or is staff of a school club: may host their students. */
  readonly clubStaff: boolean;
};

/**
 * The division a new Room takes, or why the choice is refused. A member
 * creates in their own lobby; club staff may also create a Youth Room for
 * their students. No choice means the creator's own lobby.
 */
export function roomLobbyAtCreation(
  creator: RoomCreator,
  choice: RatingDivision | null,
):
  | { readonly kind: 'division'; readonly division: RatingDivision }
  | { readonly kind: 'refused'; readonly refusal: 'other-division' } {
  const own = lobbyOf(creator);
  if (choice === null || choice === own) return { kind: 'division', division: own };
  if (choice === 'youth' && creator.clubStaff)
    return { kind: 'division', division: 'youth' };
  return { kind: 'refused', refusal: 'other-division' };
}

/** Who would take a seat, as a seat rule sees them. */
export type SeatTaker = {
  readonly kind: 'human' | 'bot';
  /** A person's division; null for a bot and for no age record. */
  readonly division: RatingDivision | null;
};

/**
 * Whether this person may hold this seat in a Room of this division. Judge
 * seats take anyone. Debater seats, ranked and casual, are for the Room's own
 * lobby: a member of that division, or a member with no age record in an Open
 * casual Room. A bot debates only casually, wherever it is seated.
 */
export function seatAllowed(
  taker: SeatTaker,
  room: {
    readonly division: RatingDivision;
    readonly competitionType: 'ranked' | 'casual';
  },
  seat: SeatRef,
): boolean {
  if (!isDebatingSeat(seat)) return true;
  if (taker.kind === 'bot') return room.competitionType === 'casual';
  if (taker.division !== null) return taker.division === room.division;
  return room.division === 'open' && room.competitionType === 'casual';
}

/** Where someone stands towards a running Round. */
export type LiveStanding = 'seat' | 'seatless-host' | 'none';

/**
 * Whether a member may watch a Round while it runs. An Open Round is for
 * every member. A Youth Round is for its own audience only: its seats and its
 * seatless host. (Its debaters' linked coaches and parents join that audience
 * with ADR 0150's amendment, YLS-7.)
 */
export const canWatchLive = (
  viewer: { readonly standing: LiveStanding },
  round: { readonly division: RatingDivision },
): boolean => round.division === 'open' || viewer.standing !== 'none';
