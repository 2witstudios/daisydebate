import {
  YOUTH_CARRY_MONTHS,
  type Ladder,
  type RatingDivision,
  type SeatedDivision,
} from '@daisy/protocol';
import {
  divisionAudiences,
  divisionLabels,
  ladderLabel,
} from '../ratings/ladder-labels';

/**
 * The words a member meets about which ladder they debate on (owner decision
 * 79, ADR 0147). A page only ever names a ladder, never anyone's age.
 */

/**
 * Ranked Rooms debate Freestyle, the one rated style (ADR 0142): a Room's
 * ladder is Freestyle in the division its seated debaters set.
 */
export const rankedRoomLadder = (division: RatingDivision): Ladder => ({
  style: 'freestyle',
  division,
});

/** How long a birthday carries on Youth (ADR 0147 §3), in words. */
const carryWords =
  YOUTH_CARRY_MONTHS % 12 === 0
    ? YOUTH_CARRY_MONTHS === 12
      ? 'a year'
      : `${YOUTH_CARRY_MONTHS / 12} years`
    : `${YOUTH_CARRY_MONTHS} months`;

/** "members under 18", "members 18 and over". */
const membersOf = (division: RatingDivision) =>
  `members ${divisionAudiences[division].toLowerCase()}`;

/** Why a member's own claim of a ranked debater seat was refused. */
export const rankedDivisionReason = `That debater seat is on the other ladder: ${ladderLabel(rankedRoomLadder('open'))} is for ${membersOf('open')}, ${ladderLabel(rankedRoomLadder('youth'))} for ${membersOf('youth')}. You can still judge it.`;

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
  body: `This is a ${ladderLabel(rankedRoomLadder(roomDivision))} ranked Room, so its debater seats are for ${membersOf(roomDivision)}. You can judge it, or play on ${ladderLabel(rankedRoomLadder(viewerDivision))}.`,
});

/** The line under a ladder a member cannot debate on. */
export const lockedLadderLine = (division: RatingDivision): string =>
  division === 'open'
    ? `${divisionLabels.open} ladders are for ${membersOf('open')}. Turn 18 mid-season and you stay on ${divisionLabels.youth} until the season ends, for up to ${carryWords}; then ${divisionLabels.open} starts, and your ${divisionLabels.youth} rating stays in your history.`
    : `${ladderLabel(rankedRoomLadder('youth'))} is for ${membersOf('youth')}. You can still judge ${divisionLabels.youth} Rounds.`;

/** For a member with no ladder at all: no valid age record. */
export const noLadderReason =
  'Ranked play needs your age on record. Casual play is open to you.';

/**
 * A ranked Room's ladder as its chip names it (ADR 0147): the ladder once its
 * debaters set one, who sets it while none sits, and casual when they mix.
 */
export function seatedLadderLabel(seated: SeatedDivision): string {
  switch (seated) {
    case 'open':
    case 'youth':
      return ladderLabel(rankedRoomLadder(seated));
    case 'unset':
      return 'Ladder set by who sits';
    case 'mixed':
      return 'Plays casual · mixed ladders';
  }
}

/** Under a ranked Room no debater has sat in yet. */
export const firstDebaterSetsLadder =
  'The first debater to sit sets the ladder: Youth or Open.';

/** Under a Youth Room's open judge seat: judging has no ladder. */
export const anyoneJudgesYouth = 'Anyone can judge a Youth Round.';

/** The Ranked page's lede: the ladder this member plays ranked on. */
export const rankedLadderLead = (division: RatingDivision): string =>
  division === 'youth'
    ? 'You play ranked on the Youth ladder: against other members under 18.'
    : 'You play ranked on the Open ladder.';

/** Under a member's own ladder card: whom its ranked Rooms seat. */
export const ladderRoomsLine = (division: RatingDivision): string =>
  division === 'youth'
    ? 'Ranked Rooms where every debater is under 18.'
    : 'Ranked Rooms where every debater is 18 or over.';
