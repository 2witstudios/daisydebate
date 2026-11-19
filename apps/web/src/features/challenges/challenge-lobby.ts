import {
  lobbyOf,
  type CompetitionType,
  type RatingDivision,
  type RatingStyle,
} from '@daisy/protocol';
import { noLadderReason } from '../play/ladder-division-words';
import { styleLabels } from '../ratings/ladder-labels';

/**
 * Challenges stay inside one lobby (owner decision 85, ADR 0156): a member of
 * the other lobby is offered no Challenge at all, and nothing says why. These
 * are hints for the menus; the send decides again under the pair's lock.
 */

/** Whether the viewer may challenge this member: they share a lobby. */
export const mayChallenge = (
  own: RatingDivision | null,
  theirs: RatingDivision | null,
): boolean => lobbyOf({ division: own }) === lobbyOf({ division: theirs });

/** Ranked needs both members to hold a division (an age record), as a ranked seat does. */
export const offersRanked = (
  own: RatingDivision | null,
  theirs: RatingDivision | null,
): boolean => own !== null && theirs !== null && own === theirs;

/**
 * The line under the Ranked and Casual choice: the age prompt when the
 * viewer has no age on record, so Ranked is not theirs; otherwise none.
 */
export const challengeModeLine = (own: RatingDivision | null): string | null =>
  own === null ? noLadderReason : null;

const modeLabels: Readonly<Record<CompetitionType, string>> = {
  ranked: 'Ranked',
  casual: 'Casual',
};

/** A challenge card's one line: "Freestyle · Ranked" (YChallenge). */
export const challengeSummary = (offer: {
  readonly mode: CompetitionType;
  readonly format: RatingStyle;
}): string => `${styleLabels[offer.format]} · ${modeLabels[offer.mode]}`;
