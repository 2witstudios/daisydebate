import type { Ladder, RatingDivision } from '@daisy/protocol';

/**
 * The words a member meets about the ladder they debate on (ADR 0147, ADR
 * 0156). Inside a lobby no page names a division; a page never names an age.
 */

/** Ranked Rooms debate Freestyle, the one rated style (ADR 0142), in their lobby's division. */
export const rankedRoomLadder = (division: RatingDivision): Ladder => ({
  style: 'freestyle',
  division,
});

/** For a member with no ladder at all: no valid age record. */
export const noLadderReason =
  'Ranked play needs your age on record. Casual play is open to you.';
