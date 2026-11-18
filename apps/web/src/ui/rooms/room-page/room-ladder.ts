import {
  isDebatingSeat,
  isNamedSeat,
  type RatingDivision,
  type RoomView,
  type SeatedDivision,
} from '@daisy/protocol';
import {
  anyoneJudgesYouth,
  rankedRoomLadder,
  seatOnOtherLadder,
} from '../../../features/play/ladder-division-words';
import { ladderLabel } from '../../../features/ratings/ladder-labels';

/**
 * A ranked Room's ladder as the pre-round page shows it (owner decision 79,
 * ADR 0147): the first debater to sit sets it, and debaters on different
 * ladders make the Round play casual. The page names ladders, never ages.
 */

type LadderView = Pick<RoomView, 'competitionType' | 'ladder'>;

/** The ladder the header's status line carries; null on a casual Room. */
export const roomLadder = (view: LadderView): SeatedDivision | null =>
  view.competitionType === 'ranked' ? view.ladder : null;

/** True when a ranked Room's seated debaters mix ladders: its Round plays casual. */
export const playsCasual = (view: LadderView): boolean =>
  roomLadder(view) === 'mixed';

/** The header's competition word: a mixed ranked Room still says it is ranked. */
export const competitionWords = (view: LadderView): string => {
  if (view.competitionType === 'casual') return 'Casual';
  return playsCasual(view) ? 'Ranked, playing casual' : 'Ranked';
};

/** The host's Start: a mixed ranked Room starts a casual Round, and says so. */
export const startRoundLabel = (view: LadderView): string =>
  playsCasual(view) ? 'Start casual round' : 'Start round';

/**
 * The ladder chip a seated debater's row carries while the Room's debaters
 * mix ladders, so the host sees who is on which; null otherwise.
 */
export const rowDivision = (
  view: LadderView,
  participant: { readonly division: RatingDivision | null },
): RatingDivision | null => (playsCasual(view) ? participant.division : null);

/** The line under an open judge seat: a Youth Room's judge needs no ladder. */
export const judgeSeatLine = (view: LadderView): string | null =>
  roomLadder(view) === 'youth' ? anyoneJudgesYouth : null;

/**
 * Why this Room's debater seats are not the viewer's, once their own claim is
 * refused for it: its ladder is set and the viewer is on the other one. Null
 * while its ladder is open to them, or when they have no ladder at all.
 */
export function otherLadderSeat(
  view: LadderView,
  viewer: RatingDivision | null,
): ReturnType<typeof seatOnOtherLadder> | null {
  const ladder = roomLadder(view);
  if (viewer === null || (ladder !== 'open' && ladder !== 'youth')) return null;
  return ladder === viewer ? null : seatOnOtherLadder(ladder, viewer);
}

/** What the host is told before a mixed ranked Room's Start. */
export type MixedLadderNotice = {
  readonly title: string;
  readonly body: string;
  readonly remedy: string;
};

type Debater = {
  readonly label: string;
  readonly division: RatingDivision | null;
};

const debaterLadder = ({ label, division }: Debater): string =>
  division === null
    ? `${label} has no ladder`
    : `${label} plays ${ladderLabel(rankedRoomLadder(division))}`;

/** "a, b and c": the words of a list. */
const listed = (parts: readonly string[]): string =>
  parts.length < 2
    ? parts.join('')
    : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;

/**
 * Before Start of a ranked Room whose debaters mix ladders: that the Round
 * plays casual, naming each human debater and their ladder, and how to keep
 * it ranked. Null for any other Room.
 */
export function mixedLadderNotice(
  view: LadderView & Pick<RoomView, 'participants'>,
): MixedLadderNotice | null {
  if (!playsCasual(view)) return null;
  const debaters = view.participants
    .filter(isNamedSeat)
    .filter((p) => p.kind === 'human' && isDebatingSeat(p.seat));
  return {
    title: 'This Round will be casual',
    body: `The debaters are on different ladders: ${listed(debaters.map(debaterLadder))}. A ranked Round needs every debater on one ladder, so this one plays casual and no ratings change.`,
    remedy: `To keep it ranked, seat ${debaters.length === 2 ? 'two debaters' : 'every debater'} from the same ladder before you start.`,
  };
}
