import type { RatingDivision } from '@daisy/protocol';
import {
  divisionAudiences,
  ladderLabel,
} from '../ratings/ladder-labels';

/**
 * The words a member meets about which ladder they debate on (owner decision
 * 79, ADR 0146). A page only ever names a ladder, never anyone's age.
 */

/** Open is for 18 and over, Youth for under 18. */
const audienceSentence: Readonly<Record<RatingDivision, string>> = {
  open: 'Open ladders are for members 18 and over.',
  youth: 'Youth ladders are for members under 18.',
};

/** Why a member's own claim of a ranked debater seat was refused. */
export const rankedDivisionReason =
  'That debater seat is on the other ladder: Open – Freestyle is for members 18 and over, Youth – Freestyle for members under 18. You can still judge it.';

/**
 * Why a debater seat on this ranked Room's ladder is not the viewer's, as
 * YRoomPreRound words it: the seat's audience, the ladder, and what they can
 * do instead.
 */
export const seatOnOtherLadder = (
  roomDivision: RatingDivision,
  viewerDivision: RatingDivision,
): { readonly title: string; readonly body: string } => ({
  title: `That seat is for a debater ${divisionAudiences[roomDivision].toLowerCase()}.`,
  body: `This is a ${ladderLabel({ style: 'freestyle', division: roomDivision })} ranked Room, so its debater seats are for members ${divisionAudiences[roomDivision].toLowerCase()}. You can judge it, or play on ${ladderLabel({ style: 'freestyle', division: viewerDivision })}.`,
});

/** The line under a ladder a member cannot debate on. */
export const lockedLadderLine = (division: RatingDivision): string =>
  division === 'open'
    ? `${audienceSentence.open} Turn 18 mid-season and you finish the season on Youth; Open starts with the next season, and your Youth rating stays in your history.`
    : `${ladderLabel({ style: 'freestyle', division: 'youth' })} is for members under 18. You can still judge Youth Rounds.`;

/** For a member with no ladder at all: no valid age record. */
export const noLadderReason =
  'Ranked play needs your age on record. Casual play is open to you.';
